# clispark M8: Logging Hardening — Design

**Goal:** Milestone 8 from `project-ideas/clispark.plan.md`. Close five logging-related gaps flagged in M2.5's completion review (2026-07-10) but deliberately deferred: sensitive-data redaction, unbounded log growth, limited failure/debug visibility, unguarded write calls, and permissive log-file permissions. Applies symmetrically to both loggers in the codebase — clispark's own (`src/logger.ts` + `src/cli.ts`'s `withLogging`) and the generated boilerplate's (`templates/base/src/logger.ts` + `templates/base/src/base-command.ts`) — since both are near-identical copies with the same structural risks (confirmed 2026-07-13 during brainstorming).

## Scope

Five sub-features, all touching both `logger.ts` copies plus `src/cli.ts` (clispark) and `base-command.ts` (generated boilerplate):

1. Sensitive-data redaction (pino `redact`)
2. Log retention (env-var-configurable cleanup)
3. Failure/debug visibility (`DEBUG` env var + consistent failure-path log-path display)
4. Hardened write calls (try/catch around logger writes)
5. Restrictive log-file permissions (`mode: 0o600`)

**Explicitly out of scope (descoped during brainstorming, 2026-07-13):**
- A generic pattern-based redaction mechanism (e.g. regex-matching field names like `token`/`secret`) — YAGNI, only 5 known log fields exist project-wide today; a fixed list covers the one concretely named risk (`registryUrl`).
- A real `--verbose`/`-v` CLI flag with oclif `baseFlags` inheritance across every command file — descoped in favor of the `DEBUG` env var, consistent with `LOG_RETENTION_DAYS` and avoiding an invasive per-command-file change (every existing and future command would otherwise need to merge a base flag set).
- Retroactive migration/cleanup of log files already on disk from before this milestone beyond what the new retention sweep naturally picks up on its next run.

## Design

### 1. Sensitive-data redaction

`createLogger()` (both copies) passes pino's built-in `redact` option:

```ts
const logger = pino(
  { redact: ['registryUrl', '*.registryUrl'] },
  pino.destination({ dest: logFilePath, sync: true, mode: 0o600 }),
);
```

`registryUrl` is not logged by any current call site (confirmed by grepping `src/` — it's passed to `scaffoldProject()` but never included in a `logger.info`/`logger.error` context object). This is preventive, guarding against a future call site accidentally including it (e.g. if a future feature logs the full wizard `answers` object). pino replaces any matching key's value with `[Redacted]` at serialization time regardless of nesting depth (the `*.registryUrl` wildcard covers one level of nesting; top-level `registryUrl` covers the flat case) — no custom sanitization code needed.

### 2. Log retention

New env var `LOG_RETENTION_DAYS` (same name on both sides), default `14` if unset or non-numeric. `createLogger()` runs a best-effort sweep of `logDir` *before* creating the new log file: list files in the directory, delete any whose mtime is older than the threshold. Wrapped in try/catch — any failure (permission error, file in use, malformed directory) is silently swallowed; the sweep never blocks or fails the actual command. Runs on every invocation (directories will typically hold a handful of files for a personal-use tool; the cost of a `readdir` + `stat` per file is negligible).

### 3. Failure/debug visibility

**Failure path (both sides, always, not gated by `DEBUG`):** both `src/cli.ts`'s `withLogging` (already does this today) and `templates/base/src/base-command.ts`'s `catch()` (currently does **not** — this asymmetry was found during brainstorming) print `Details: <logFilePath>` alongside the clean `Error: <message>`. This requires `BaseCommand` to retain `logFilePath` (not just `logger`) as an instance field, set in `init()`.

**Success path (gated by `DEBUG`):** when `process.env.DEBUG` is truthy, both sides additionally print the log file path after a successful run (`withLogging`'s success branch; `BaseCommand.finally()` when `!err`). When `DEBUG` is unset, success stays silent, matching today's behavior exactly.

**Live streaming (gated by `DEBUG`):** when `process.env.DEBUG` is truthy, `createLogger()` uses `pino.multistream()` to write to both the file destination and `process.stdout` (raw JSON lines — no `pino-pretty` dependency added, consistent with the file logs' own raw-JSON format). When unset, behavior is unchanged (file-only, sync destination).

### 4. Hardened write calls

Both sides wrap their logger write calls in try/catch so a rare I/O failure *during a write* (e.g. `ENOSPC`/`EIO`) never escalates into an unhandled, raw-stack-trace crash:

- `src/cli.ts`'s `withLogging`: the `logger.info(..., 'completed')` call in the success branch, and the `logger.error(..., 'failed')` call in the catch branch, each get their own try/catch (swallow-and-continue — the existing clean `console.error` output still happens regardless of whether the log write itself succeeded).
- `templates/base/src/base-command.ts`: the `this.logger?.info(...)` calls in `init()`/`finally()` and the `this.logger?.error(...)` call in `catch()` each get the same treatment.

**Explicitly not changed:** `BaseCommand.init()`'s `createLogger(...)` call itself does not need new try/catch. Traced against oclif's own `Command._run()` lifecycle (approximately `try { init(); run() } catch (err) { this.catch(err) } finally { this.finally(err) }`), a throw from `init()` is already caught by oclif's own outer try/catch and routed through `catch()`, which already clean-formats it via `super.catch(err)`. This differs from clispark's own commander-based CLI, which has no equivalent automatic net — that's why `withLogging` needed its own explicit try/catch around `createLogger()` back in M2.5. The gap that *does* exist on the oclif side is a write failing *inside* `catch()`/`finally()` themselves, since a throw from those methods is not caught by anything further out in oclif's lifecycle — that's what this milestone actually fixes on that side.

### 5. Log-file permissions

Both `pino.destination({ ... })` calls get `mode: 0o600` (owner read/write only) — verified as a real, supported option: `sonic-boom` 5.0.0's `index.js` (the stream pino's `destination()` wraps) reads `mode` from its options object and passes it straight through to `fs.open`/`fs.openSync`. No-op on Windows (no POSIX permission bits to set), harmless to pass regardless of platform.

## Error Handling

- Retention sweep failures: silently swallowed, never surfaced to the user, never blocks the actual command (item 2).
- Log-write failures during `completed`/`failed`/`started` logging: silently swallowed after the fact; the user still sees the pre-existing clean console output either way (item 4).
- No new error paths introduced — every change in this milestone is either purely additive (redaction, permissions, debug streaming) or defensive (hardened writes), never something that can newly fail a previously-succeeding command.

## Testing

Same pattern as prior milestones: unit tests with real `fs`/temp directories (no mocks) plus manual end-to-end verification.

**Unit tests (both `logger.ts` copies get their own, near-identical test additions):**
- Retention: seed a temp log dir with files of varying mtimes (some older than the configured threshold, some newer), run `createLogger`, assert only the old ones are deleted. Test both the default (14-day) and a `LOG_RETENTION_DAYS`-overridden threshold, plus an invalid value (falls back to default).
- Redaction: log an object containing `registryUrl` (and one nested one level down), read the resulting log file, assert the value never appears in the raw file content and `[Redacted]` does.
- Permissions: after `createLogger`, `fs.statSync` the log file and assert its mode is `0o600` (POSIX only — skip/adjust the assertion on Windows via a `process.platform` check, since Windows won't reflect the same bits).
- Hardened writes: inject a logger whose `.info`/`.error` throws, confirm `withLogging`/`BaseCommand`'s surrounding code doesn't propagate that throw (i.e. the existing clean-error console output still happens, and no unhandled exception surfaces).
- `DEBUG`-gated behavior: with `DEBUG` set/unset, assert stdout does/doesn't receive the piped log lines and the log path is/isn't printed on success.

**Manual end-to-end verification (same shape as M1–M7):** real scaffold, real command runs, real `DEBUG=1`/`LOG_RETENTION_DAYS=<n>` env var invocations, confirming actual file permissions on disk, actual retention behavior against manually-aged fixture files, and actual live-streamed output — on both clispark itself and a freshly scaffolded project.
