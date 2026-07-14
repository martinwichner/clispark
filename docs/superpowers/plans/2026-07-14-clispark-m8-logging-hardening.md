# clispark M8: Logging Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Milestone 8 from `project-ideas/clispark.plan.md` — close five logging-related gaps deferred since M2.5's completion review (2026-07-10): sensitive-data redaction, unbounded log growth, limited failure/debug visibility, unguarded write calls, and permissive log-file permissions. Applied symmetrically to both loggers in the codebase — clispark's own (`src/logger.ts`) and the generated boilerplate's (`templates/base/src/logger.ts` + `templates/base/src/base-command.ts`).

**Architecture:** All five sub-features live inside `createLogger()`/`withLogging()` (clispark's own side, both in `src/logger.ts`) and `createLogger()`/`BaseCommand` (generated side, `templates/base/src/logger.ts` + `templates/base/src/base-command.ts`). `src/cli.ts` needs **no changes** — `withLogging` is defined in and exported from `src/logger.ts`, not `cli.ts`; `cli.ts` only calls it with its existing 2-argument form, which stays valid since the new parameters this plan adds all have defaults.

**Tech Stack:** `pino` 9.x (`redact` option, `pino.destination({ mode })`, `pino.multistream()`), Node's `node:fs` (`readdirSync`/`statSync`/`unlinkSync` for the retention sweep), `@oclif/core`'s `Config.load()` for a real (non-mocked) `BaseCommand` test harness, `@oclif/test`'s `runCommand()`. No new dependencies.

## Global Constraints

- Full design context: `docs/superpowers/specs/2026-07-13-clispark-m8-logging-hardening-design.md`.
- Redaction is a fixed list (`['registryUrl', '*.registryUrl']`), not a generic pattern-based mechanism — YAGNI, only one field is a known risk today (per spec, explicitly descoped).
- No `--verbose`/`-v` CLI flag — `DEBUG` env var only, consistent with `LOG_RETENTION_DAYS` (per spec, explicitly descoped).
- No retroactive cleanup of log files already on disk beyond what the new retention sweep naturally picks up on its next run (per spec, explicitly descoped).
- **Spec-wording correction:** the spec attributes `withLogging` to `src/cli.ts`, but it is actually defined in and exported from `src/logger.ts`; `cli.ts` merely imports and calls it. Every `withLogging` change in this plan therefore lands in `src/logger.ts`. `src/cli.ts` is not touched by this milestone at all.
- **Deliberate scope addition beyond the spec's literal Task-4 enumeration:** the spec's "hardened write calls" section only lists `withLogging`'s `'completed'`/`'failed'` writes for wrapping, omitting the initial `logger.info(..., 'started')` write — while `templates/base/src/base-command.ts`'s equivalent (`init()`'s `'started'` write) *is* explicitly listed. This asymmetry has no stated rationale (unlike the spec's other, justified "explicitly out of scope" items) and today an I/O failure on that specific write would still produce the exact raw-stack-trace crash this milestone exists to close (verified empirically during planning — see Task 4). This plan wraps it on both sides for consistency and to fully close the milestone's own stated goal.
- `withLogging` gains a 4th parameter, `loggerFactory: typeof createLogger = createLogger`, mirroring the injectable-dependency pattern `scaffoldProject()` already uses for its `runCommand` dependency. This is what makes the hardened-write tests possible without mocking the `pino` module. Existing call sites in `src/cli.ts` are unaffected — they only ever pass the first two arguments.
- `BaseCommand.init()`'s `createLogger(...)` call itself is **not** wrapped in try/catch — a throw there is already caught by oclif's own outer `_run()` try/catch and routed cleanly through `catch()` (traced against `@oclif/core`'s `Command._run()`/`.catch()` source, confirmed empirically during planning). Only the subsequent `this.logger.info(..., 'started')` *write* call needs wrapping, for the same reason `withLogging`'s `'started'` write does (see the constraint above): a throw from that specific write would otherwise make oclif report a successful run as a confusing, unrelated failure.
- `BaseCommand.catch()`/`.finally()` are `protected` — tests that call them directly must go through a narrow interface cast (see Task 3/4 test code below), not `any`.
- `templates/base` is a real, independent npm project (own `package.json`/`vitest.config.ts`) and can be built+tested in complete isolation, with no scaffold needed: `cd templates/base && npm install && npm test` (confirmed empirically during planning — the `{{projectName}}` placeholder in `package.json` does not block `npm install`/`npm run build`/`vitest run`). Use this for fast, real, per-task TDD verification of every template-side task below. Task 5 still performs one full real scaffold end-to-end, mirroring the M7 plan's Task 5 convention, as the final proof that the generator actually copies these files correctly with the placeholder replaced.
- Do not touch `templates/base/package.json`'s outdated `vitest: ^2.1.8` (vs. the generator's own `^4.1.10`) — that is M9 backlog, out of scope here.

---

### Task 1: Sensitive-data redaction + log-file permissions (both `logger.ts` copies)

**Files:**
- Modify: `src/logger.ts`
- Modify: `src/logger.test.ts`
- Modify: `templates/base/src/logger.ts`
- Create: `templates/base/src/logger.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `createLogger()`'s pino instance now redacts `registryUrl` (top-level and one level nested) and creates its file with `mode: 0o600`. Both signatures (`createLogger(commandName, logDir?)`) are unchanged — later tasks build on top of this same function body.

- [ ] **Step 1: Write the failing tests in `src/logger.test.ts`**

Change the top of the file:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createLogger, withLogging } from './logger';
```

(only change: `statSync` added to the `node:fs` import)

Inside `describe('createLogger', ...)`, immediately after the existing `'writes structured JSON log entries to the file'` test, add:

```ts
  it('redacts registryUrl values, including one level of nesting', async () => {
    const { logger, logFilePath } = createLogger('scaffold', tmpRoot);

    logger.info(
      {
        registryUrl: 'https://registry.example.com/secret-token',
        nested: { registryUrl: 'https://nested.example.com/other-secret' },
      },
      'scaffold started',
    );
    await logger.flush();

    const content = await readFile(logFilePath, 'utf8');
    expect(content).not.toContain('secret-token');
    expect(content).not.toContain('nested.example.com');
    expect(content).toContain('[Redacted]');
  });

  it('sets the log file to owner-only read/write permissions (POSIX only)', () => {
    if (process.platform === 'win32') return;

    const { logFilePath } = createLogger('scaffold', tmpRoot);

    const mode = statSync(logFilePath).mode & 0o777;
    expect(mode).toBe(0o600);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- logger.test.ts`
Expected: 2 new FAILs — `content` still contains `'secret-token'`/`'nested.example.com'` and does not contain `'[Redacted]'` (no `redact` option yet); the permissions test only fails on non-Windows (skips on `win32`, so on this Windows dev machine it will unconditionally pass even before the fix — that's expected, real verification of this specific assertion happens in CI/on a POSIX machine, or can be spot-checked manually if needed).

- [ ] **Step 3: Implement the redaction + permissions change in `src/logger.ts`**

Change the `createLogger` function body:

```ts
export function createLogger(commandName: string, logDir: string = paths.log): LoggerHandle {
  mkdirSync(logDir, { recursive: true });

  const logFilePath = path.join(logDir, buildLogFileName(commandName));
  const logger = pino(
    { redact: ['registryUrl', '*.registryUrl'] },
    pino.destination({ dest: logFilePath, sync: true, mode: 0o600 }),
  );

  return { logger, logFilePath };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- logger.test.ts`
Expected: PASS (21 tests: 19 existing + 2 new)

- [ ] **Step 5: Create `templates/base/src/logger.test.ts` (failing)**

Create `templates/base/src/logger.test.ts`:

```ts
// templates/base/src/logger.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFile, rm, mkdtemp } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createLogger } from './logger';

describe('createLogger', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(path.join(tmpdir(), 'clispark-template-logger-test-'));
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it('creates a timestamped log file for the given command inside the given directory', () => {
    const { logFilePath } = createLogger('hello', tmpRoot);

    expect(path.dirname(logFilePath)).toBe(tmpRoot);
    expect(path.basename(logFilePath)).toMatch(/^hello-.+\.log$/);
    expect(existsSync(logFilePath)).toBe(true);
  });

  it('creates the log directory if it does not exist yet', () => {
    const nestedDir = path.join(tmpRoot, 'nested', 'logs');

    const { logFilePath } = createLogger('hello', nestedDir);

    expect(existsSync(nestedDir)).toBe(true);
    expect(path.dirname(logFilePath)).toBe(nestedDir);
  });

  it('generates a distinct file for each call, even for the same command in the same millisecond', () => {
    const first = createLogger('hello', tmpRoot);
    const second = createLogger('hello', tmpRoot);

    expect(first.logFilePath).not.toBe(second.logFilePath);
  });

  it('writes structured JSON log entries to the file', async () => {
    const { logger, logFilePath } = createLogger('hello', tmpRoot);

    logger.info({ command: 'hello' }, 'started');
    await logger.flush();

    const content = await readFile(logFilePath, 'utf8');
    const entry = JSON.parse(content.trim().split('\n')[0]);
    expect(entry.msg).toBe('started');
    expect(entry.command).toBe('hello');
  });

  it('redacts registryUrl values, including one level of nesting', async () => {
    const { logger, logFilePath } = createLogger('hello', tmpRoot);

    logger.info(
      {
        registryUrl: 'https://registry.example.com/secret-token',
        nested: { registryUrl: 'https://nested.example.com/other-secret' },
      },
      'started',
    );
    await logger.flush();

    const content = await readFile(logFilePath, 'utf8');
    expect(content).not.toContain('secret-token');
    expect(content).not.toContain('nested.example.com');
    expect(content).toContain('[Redacted]');
  });

  it('sets the log file to owner-only read/write permissions (POSIX only)', () => {
    if (process.platform === 'win32') return;

    const { logFilePath } = createLogger('hello', tmpRoot);

    const mode = statSync(logFilePath).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});
```

Run: `cd templates/base && npm install && npm test -- logger.test.ts`
Expected: FAIL — `templates/base/src/logger.ts` doesn't redact or set `mode` yet, same two failure modes as Step 2.

- [ ] **Step 6: Implement the same change in `templates/base/src/logger.ts`**

Change the `createLogger` function body (identical shape to Step 3):

```ts
export function createLogger(commandName: string, logDir: string = paths.log): LoggerHandle {
  mkdirSync(logDir, { recursive: true });

  const logFilePath = path.join(logDir, buildLogFileName(commandName));
  const logger = pino(
    { redact: ['registryUrl', '*.registryUrl'] },
    pino.destination({ dest: logFilePath, sync: true, mode: 0o600 }),
  );

  return { logger, logFilePath };
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd templates/base && npm test -- logger.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 8: Full local verification + commit**

Run: `cd "<repo root>" && npm test && npm run typecheck && npm run lint`
Expected: all green.

```bash
git add src/logger.ts src/logger.test.ts templates/base/src/logger.ts templates/base/src/logger.test.ts
git commit -m "feat: redact registryUrl and restrict log file permissions to 0o600"
```

---

### Task 2: Log retention (both `logger.ts` copies)

**Files:**
- Modify: `src/logger.ts`
- Modify: `src/logger.test.ts`
- Modify: `templates/base/src/logger.ts`
- Modify: `templates/base/src/logger.test.ts`

**Interfaces:**
- Consumes: `createLogger()` from Task 1 (already redacts + sets permissions).
- Produces: `createLogger()` now also sweeps `logDir` for files older than `LOG_RETENTION_DAYS` (default 14) before creating the new log file. No signature change.

- [ ] **Step 1: Write the failing tests in `src/logger.test.ts`**

Change the `node:fs/promises` import to add `utimes`:

```ts
import { mkdtemp, readFile, rm, writeFile, utimes } from 'node:fs/promises';
```

Inside `describe('createLogger', ...)`, after the permissions test from Task 1, add:

```ts
  it('deletes log files older than the default 14-day retention window', async () => {
    const oldFilePath = path.join(tmpRoot, 'old-scaffold.log');
    const newFilePath = path.join(tmpRoot, 'new-scaffold.log');
    await writeFile(oldFilePath, '{}');
    await writeFile(newFilePath, '{}');
    const fifteenDaysAgo = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);
    await utimes(oldFilePath, fifteenDaysAgo, fifteenDaysAgo);

    createLogger('scaffold', tmpRoot);

    expect(existsSync(oldFilePath)).toBe(false);
    expect(existsSync(newFilePath)).toBe(true);
  });

  it('honors a LOG_RETENTION_DAYS override', async () => {
    const filePath = path.join(tmpRoot, 'three-days-old.log');
    await writeFile(filePath, '{}');
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    await utimes(filePath, threeDaysAgo, threeDaysAgo);

    process.env.LOG_RETENTION_DAYS = '1';
    try {
      createLogger('scaffold', tmpRoot);
    } finally {
      delete process.env.LOG_RETENTION_DAYS;
    }

    expect(existsSync(filePath)).toBe(false);
  });

  it('falls back to the 14-day default when LOG_RETENTION_DAYS is not a number', async () => {
    const filePath = path.join(tmpRoot, 'five-days-old.log');
    await writeFile(filePath, '{}');
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    await utimes(filePath, fiveDaysAgo, fiveDaysAgo);

    process.env.LOG_RETENTION_DAYS = 'not-a-number';
    try {
      createLogger('scaffold', tmpRoot);
    } finally {
      delete process.env.LOG_RETENTION_DAYS;
    }

    expect(existsSync(filePath)).toBe(true);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- logger.test.ts`
Expected: 3 new FAILs — no sweep happens yet, so `old-scaffold.log`/the `LOG_RETENTION_DAYS=1`-aged file still exist after `createLogger`.

- [ ] **Step 3: Implement the retention sweep in `src/logger.ts`**

Change the `node:fs` import:

```ts
import { mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
```

Add these two functions above `createLogger` (after `buildLogFileName`):

```ts
function getRetentionDays(): number {
  const parsed = Number(process.env.LOG_RETENTION_DAYS);
  return Number.isFinite(parsed) ? parsed : 14;
}

function sweepOldLogs(logDir: string): void {
  try {
    const cutoffMs = Date.now() - getRetentionDays() * 24 * 60 * 60 * 1000;
    for (const file of readdirSync(logDir)) {
      const filePath = path.join(logDir, file);
      if (statSync(filePath).mtimeMs < cutoffMs) {
        unlinkSync(filePath);
      }
    }
  } catch {
    // best-effort cleanup; a broken sweep must never block the actual command
  }
}
```

Change `createLogger` to call the sweep before building the new file's path:

```ts
export function createLogger(commandName: string, logDir: string = paths.log): LoggerHandle {
  mkdirSync(logDir, { recursive: true });
  sweepOldLogs(logDir);

  const logFilePath = path.join(logDir, buildLogFileName(commandName));
  const logger = pino(
    { redact: ['registryUrl', '*.registryUrl'] },
    pino.destination({ dest: logFilePath, sync: true, mode: 0o600 }),
  );

  return { logger, logFilePath };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- logger.test.ts`
Expected: PASS (24 tests)

- [ ] **Step 5: Write the failing tests in `templates/base/src/logger.test.ts`**

Change the `node:fs/promises` import:

```ts
import { readFile, rm, mkdtemp, writeFile, utimes } from 'node:fs/promises';
```

Add the same three tests as Step 1 (adjusted for the `'hello'` command name and file-name prefixes used in this file):

```ts
  it('deletes log files older than the default 14-day retention window', async () => {
    const oldFilePath = path.join(tmpRoot, 'old-hello.log');
    const newFilePath = path.join(tmpRoot, 'new-hello.log');
    await writeFile(oldFilePath, '{}');
    await writeFile(newFilePath, '{}');
    const fifteenDaysAgo = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);
    await utimes(oldFilePath, fifteenDaysAgo, fifteenDaysAgo);

    createLogger('hello', tmpRoot);

    expect(existsSync(oldFilePath)).toBe(false);
    expect(existsSync(newFilePath)).toBe(true);
  });

  it('honors a LOG_RETENTION_DAYS override', async () => {
    const filePath = path.join(tmpRoot, 'three-days-old.log');
    await writeFile(filePath, '{}');
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    await utimes(filePath, threeDaysAgo, threeDaysAgo);

    process.env.LOG_RETENTION_DAYS = '1';
    try {
      createLogger('hello', tmpRoot);
    } finally {
      delete process.env.LOG_RETENTION_DAYS;
    }

    expect(existsSync(filePath)).toBe(false);
  });

  it('falls back to the 14-day default when LOG_RETENTION_DAYS is not a number', async () => {
    const filePath = path.join(tmpRoot, 'five-days-old.log');
    await writeFile(filePath, '{}');
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    await utimes(filePath, fiveDaysAgo, fiveDaysAgo);

    process.env.LOG_RETENTION_DAYS = 'not-a-number';
    try {
      createLogger('hello', tmpRoot);
    } finally {
      delete process.env.LOG_RETENTION_DAYS;
    }

    expect(existsSync(filePath)).toBe(true);
  });
```

Run: `cd templates/base && npm test -- logger.test.ts`
Expected: 3 new FAILs, same reason as Step 2.

- [ ] **Step 6: Implement the same retention sweep in `templates/base/src/logger.ts`**

Change the `node:fs` import:

```ts
import { mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
```

Add these two functions above `createLogger` (after `buildLogFileName`):

```ts
function getRetentionDays(): number {
  const parsed = Number(process.env.LOG_RETENTION_DAYS);
  return Number.isFinite(parsed) ? parsed : 14;
}

function sweepOldLogs(logDir: string): void {
  try {
    const cutoffMs = Date.now() - getRetentionDays() * 24 * 60 * 60 * 1000;
    for (const file of readdirSync(logDir)) {
      const filePath = path.join(logDir, file);
      if (statSync(filePath).mtimeMs < cutoffMs) {
        unlinkSync(filePath);
      }
    }
  } catch {
    // best-effort cleanup; a broken sweep must never block the actual command
  }
}
```

Change `createLogger` to call the sweep before building the new file's path:

```ts
export function createLogger(commandName: string, logDir: string = paths.log): LoggerHandle {
  mkdirSync(logDir, { recursive: true });
  sweepOldLogs(logDir);

  const logFilePath = path.join(logDir, buildLogFileName(commandName));
  const logger = pino(
    { redact: ['registryUrl', '*.registryUrl'] },
    pino.destination({ dest: logFilePath, sync: true, mode: 0o600 }),
  );

  return { logger, logFilePath };
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd templates/base && npm test -- logger.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 8: Full local verification + commit**

Run: `cd "<repo root>" && npm test && npm run typecheck && npm run lint`
Expected: all green.

```bash
git add src/logger.ts src/logger.test.ts templates/base/src/logger.ts templates/base/src/logger.test.ts
git commit -m "feat: sweep log files older than LOG_RETENTION_DAYS (default 14) on every invocation"
```

---

### Task 3: Failure/debug visibility (DEBUG-gated live streaming, success-path log path, failure-path parity)

**Files:**
- Modify: `src/logger.ts`
- Modify: `src/logger.test.ts`
- Modify: `templates/base/src/logger.ts`
- Modify: `templates/base/src/logger.test.ts`
- Modify: `templates/base/src/base-command.ts`
- Create: `templates/base/src/base-command.test.ts`

**Interfaces:**
- Consumes: `createLogger()` from Tasks 1–2.
- Produces: `BaseCommand` gains a `protected logFilePath?: string` field (in addition to the existing `protected logger?: Logger`), set in `init()` alongside `logger`. Later tasks (Task 4) rely on this field already existing.

- [ ] **Step 1: Write the failing DEBUG-streaming tests in `src/logger.test.ts`**

Inside `describe('createLogger', ...)`, after the retention tests from Task 2, add:

```ts
  it('streams log lines to stdout when DEBUG is set', async () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    process.env.DEBUG = '1';

    try {
      const { logger } = createLogger('scaffold', tmpRoot);
      logger.info({ command: 'scaffold' }, 'started');
      await new Promise<void>((resolve) => logger.flush(() => resolve()));
    } finally {
      delete process.env.DEBUG;
    }

    const written = writeSpy.mock.calls.map((call) => String(call[0])).join('');
    expect(written).toContain('started');
    writeSpy.mockRestore();
  });

  it('does not stream to stdout when DEBUG is unset', async () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    delete process.env.DEBUG;

    const { logger } = createLogger('scaffold', tmpRoot);
    logger.info({ command: 'scaffold' }, 'started');
    await new Promise<void>((resolve) => logger.flush(() => resolve()));

    expect(writeSpy).not.toHaveBeenCalled();
    writeSpy.mockRestore();
  });
```

**Pitfall to avoid:** call `.mockRestore()` *after* reading `writeSpy.mock.calls`, never before — `mockRestore()` also clears the recorded call history, which will make the assertion see an empty array even though the real write happened (found and fixed during planning's own empirical validation of this exact test).

Inside `describe('withLogging', ...)`, after the existing `'logs the full error...'` test, add:

```ts
  it('prints the log file path on success when DEBUG is set', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const action = vi.fn(async () => {});
    process.env.DEBUG = '1';

    try {
      const wrapped = withLogging('scaffold', action, tmpRoot);
      await wrapped();
    } finally {
      delete process.env.DEBUG;
    }

    const printedLines = logSpy.mock.calls.map((call) => String(call[0]));
    expect(printedLines.some((line) => line.includes('Details:'))).toBe(true);

    exitSpy.mockRestore();
    logSpy.mockRestore();
    writeSpy.mockRestore();
  });

  it('stays silent on success when DEBUG is unset', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const action = vi.fn(async () => {});
    delete process.env.DEBUG;

    const wrapped = withLogging('scaffold', action, tmpRoot);
    await wrapped();

    expect(logSpy).not.toHaveBeenCalled();

    exitSpy.mockRestore();
    logSpy.mockRestore();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- logger.test.ts`
Expected: 4 new FAILs — no multistream yet (nothing reaches `process.stdout.write`), no DEBUG-gated success print yet (`console.log` never called).

- [ ] **Step 3: Implement DEBUG-gated multistream + success print in `src/logger.ts`**

Change `createLogger`:

```ts
export function createLogger(commandName: string, logDir: string = paths.log): LoggerHandle {
  mkdirSync(logDir, { recursive: true });
  sweepOldLogs(logDir);

  const logFilePath = path.join(logDir, buildLogFileName(commandName));
  const fileDestination = pino.destination({ dest: logFilePath, sync: true, mode: 0o600 });
  const destination = process.env.DEBUG
    ? pino.multistream([{ stream: fileDestination }, { stream: process.stdout }])
    : fileDestination;
  const logger = pino({ redact: ['registryUrl', '*.registryUrl'] }, destination);

  return { logger, logFilePath };
}
```

Change `withLogging`'s success branch (inside the inner `try { await action(logger); ... }`):

```ts
    try {
      await action(logger);
      logger.info({ command: commandName }, 'completed');
      if (process.env.DEBUG) {
        console.log(`Details: ${logFilePath}`);
      }
    } catch (error) {
```

(only the `if (process.env.DEBUG) { ... }` block is new; the rest of `withLogging` is unchanged in this step — hardening comes in Task 4)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- logger.test.ts`
Expected: PASS (28 tests)

- [ ] **Step 5: Write the failing DEBUG-streaming tests in `templates/base/src/logger.test.ts`, then implement**

There is no `withLogging` on the template side — that role (DEBUG-gated success/failure visibility) is played by `BaseCommand`, handled separately in Steps 6–8 below. Only the `createLogger`-level multistream behavior needs mirroring here.

Inside `templates/base/src/logger.test.ts`'s `describe('createLogger', ...)`, after the retention tests from Task 2, add:

```ts
  it('streams log lines to stdout when DEBUG is set', async () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    process.env.DEBUG = '1';

    try {
      const { logger } = createLogger('hello', tmpRoot);
      logger.info({ command: 'hello' }, 'started');
      await new Promise<void>((resolve) => logger.flush(() => resolve()));
    } finally {
      delete process.env.DEBUG;
    }

    const written = writeSpy.mock.calls.map((call) => String(call[0])).join('');
    expect(written).toContain('started');
    writeSpy.mockRestore();
  });

  it('does not stream to stdout when DEBUG is unset', async () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    delete process.env.DEBUG;

    const { logger } = createLogger('hello', tmpRoot);
    logger.info({ command: 'hello' }, 'started');
    await new Promise<void>((resolve) => logger.flush(() => resolve()));

    expect(writeSpy).not.toHaveBeenCalled();
    writeSpy.mockRestore();
  });
```

This requires `vi` to be imported from `vitest` in this file — change the top import to:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
```

Run: `cd templates/base && npm test -- logger.test.ts`
Expected: 2 new FAILs, same reason as Step 2.

Change `templates/base/src/logger.ts`'s `createLogger` function body:

```ts
export function createLogger(commandName: string, logDir: string = paths.log): LoggerHandle {
  mkdirSync(logDir, { recursive: true });
  sweepOldLogs(logDir);

  const logFilePath = path.join(logDir, buildLogFileName(commandName));
  const fileDestination = pino.destination({ dest: logFilePath, sync: true, mode: 0o600 });
  const destination = process.env.DEBUG
    ? pino.multistream([{ stream: fileDestination }, { stream: process.stdout }])
    : fileDestination;
  const logger = pino({ redact: ['registryUrl', '*.registryUrl'] }, destination);

  return { logger, logFilePath };
}
```

Run: `cd templates/base && npm test -- logger.test.ts`
Expected: PASS (11 tests)

- [ ] **Step 6: Write the failing failure/debug-visibility tests for `BaseCommand`**

Create `templates/base/src/base-command.test.ts`:

```ts
// templates/base/src/base-command.test.ts
import { describe, it, expect } from 'vitest';
import { runCommand } from '@oclif/test';

describe('BaseCommand failure/debug visibility', () => {
  it('prints the log file path on failure', async () => {
    const { error, stderr } = await runCommand('task');

    expect(error?.message).toContain('Missing 1 required arg');
    expect(stderr).toContain('Details:');
  });

  it('prints the log file path on success when DEBUG is set', async () => {
    process.env.DEBUG = '1';
    let stdout: string;
    try {
      ({ stdout } = await runCommand('hello'));
    } finally {
      delete process.env.DEBUG;
    }

    expect(stdout).toContain('Details:');
  });

  it('stays silent about the log path on success when DEBUG is unset', async () => {
    delete process.env.DEBUG;
    const { stdout } = await runCommand('hello');

    expect(stdout).not.toContain('Details:');
  });
});
```

`runCommand`'s captured `stdout`/`stderr` pick up plain `console.log`/`console.error` calls too, not just oclif's own `this.log()` (confirmed empirically during planning) — no special interception flag needed for these three tests.

Run: `cd templates/base && npm test -- base-command.test.ts`
Expected: all 3 FAIL — `task`'s missing-arg failure currently prints no `Details:` line at all (only `BaseCommand`'s `catch()` logs internally, nothing to stdout/stderr), and `hello`'s success path never prints anything regardless of `DEBUG`.

- [ ] **Step 7: Implement `logFilePath` field + Details printing in `templates/base/src/base-command.ts`**

Replace the whole file:

```ts
// templates/base/src/base-command.ts
import { Command, type Interfaces } from '@oclif/core';
import type { Logger } from 'pino';
import { createLogger } from './logger';

export abstract class BaseCommand extends Command {
  protected logger?: Logger;
  protected logFilePath?: string;

  async init(): Promise<void> {
    await super.init();

    const { logger, logFilePath } = createLogger(this.id ?? 'unknown');
    this.logger = logger;
    this.logFilePath = logFilePath;
    this.logger.info({ command: this.id }, 'started');
  }

  protected async catch(err: Interfaces.CommandError): Promise<unknown> {
    this.logger?.error({ command: this.id, err }, 'failed');
    if (this.logFilePath) {
      console.error(`Details: ${this.logFilePath}`);
    }
    return super.catch(err);
  }

  protected async finally(err: Error | undefined): Promise<unknown> {
    if (!err) {
      this.logger?.info({ command: this.id }, 'completed');
      if (process.env.DEBUG && this.logFilePath) {
        console.log(`Details: ${this.logFilePath}`);
      }
    }
    return super.finally(err);
  }
}
```

(the `if (this.logFilePath)` guards protect against printing `Details: undefined` in the — currently unreachable, since `createLogger`'s own setup never throws under normal conditions — edge case where `init()`'s `createLogger(...)` call itself fails before `logFilePath` is ever set; try/catch hardening around the three write calls above is added in Task 4, not here)

Note on print ordering: oclif's own default `Command.catch()` does not itself print `Error: <message>` — it just re-throws, and the actual clean-error printing happens later, inside `@oclif/core`'s top-level `execute()` (in `bin/run.ts`), after `BaseCommand.catch()` has already returned/thrown. This means `Details: <path>` will print *before* `Error: <message>` on the generated-project side — the reverse of clispark's own `withLogging` ordering. The spec only requires both lines to appear "alongside" each other, not a specific order; this was confirmed empirically during planning (see Task 5's manual verification for the exact real-world output).

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd templates/base && npm test -- base-command.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 9: Full local verification + commit**

Run: `cd "<repo root>" && npm test && npm run typecheck && npm run lint`
Expected: all green (scaffold-smoke-test-related flakiness aside — see Task 5's note on the pre-existing, unrelated `scaffold.test.ts` timeout issue).

```bash
git add src/logger.ts src/logger.test.ts templates/base/src/logger.ts templates/base/src/logger.test.ts templates/base/src/base-command.ts templates/base/src/base-command.test.ts
git commit -m "feat: DEBUG-gated live log streaming and log-path visibility on success and failure"
```

---

### Task 4: Hardened write calls (both sides)

**Files:**
- Modify: `src/logger.ts`
- Modify: `src/logger.test.ts`
- Modify: `templates/base/src/base-command.ts`
- Modify: `templates/base/src/base-command.test.ts`

**Interfaces:**
- Consumes: `withLogging()` from Task 3 (`src/logger.ts`), `BaseCommand` from Task 3 (`templates/base/src/base-command.ts`, already has `logFilePath`).
- Produces: `withLogging(commandName, action, logDir?, loggerFactory?)` — new 4th parameter, `loggerFactory: typeof createLogger = createLogger`. Nothing outside this task calls `withLogging` with a 4th argument except its own tests.

- [ ] **Step 1: Write the failing hardened-write tests in `src/logger.test.ts`**

Add `import type { Logger } from 'pino';` near the top (after the `vitest`/`node:*` imports, before the `./logger` import):

```ts
import type { Logger } from 'pino';
import { createLogger, withLogging } from './logger';
```

Inside `describe('withLogging', ...)`, after the DEBUG tests from Task 3, add:

```ts
  it('does not propagate a throw from a failing logger write on success', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const action = vi.fn(async () => {});
    const throwingLoggerFactory: typeof createLogger = (commandName, logDir) => {
      const handle = createLogger(commandName, logDir);
      handle.logger.info = (() => {
        throw new Error('disk full');
      }) as Logger['info'];
      return handle;
    };

    const wrapped = withLogging('scaffold', action, tmpRoot, throwingLoggerFactory);
    await expect(wrapped()).resolves.toBeUndefined();

    expect(action).toHaveBeenCalledTimes(1);
    expect(exitSpy).not.toHaveBeenCalled();

    exitSpy.mockRestore();
  });

  it('does not propagate a throw from a failing logger write on failure, and still prints the clean error', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const action = vi.fn(async () => {
      throw new Error('npm install failed');
    });
    const throwingLoggerFactory: typeof createLogger = (commandName, logDir) => {
      const handle = createLogger(commandName, logDir);
      handle.logger.error = (() => {
        throw new Error('disk full');
      }) as Logger['error'];
      return handle;
    };

    const wrapped = withLogging('scaffold', action, tmpRoot, throwingLoggerFactory);
    await wrapped();

    const printedLines = errorSpy.mock.calls.map((call) => String(call[0]));
    expect(printedLines.some((line) => line.includes('✖ npm install failed'))).toBe(true);
    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });
```

**Type note:** declare `throwingLoggerFactory` with the explicit type `typeof createLogger` (not a hand-written signature) — a hand-written `(commandName: string, logDir: string) => LoggerHandle` fails `tsc --noEmit` because `createLogger`'s real `logDir` parameter is optional (`string = paths.log`), making its type `(commandName: string, logDir?: string) => LoggerHandle`; a required-`logDir` function is not assignable to that optional-parameter type (found during planning's own typecheck pass).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- logger.test.ts`
Expected: 2 new FAILs with `TypeError`-style failures — `withLogging` doesn't accept a 4th argument yet (it's silently ignored by JS, so `loggerFactory` is never actually used, meaning the *real* `createLogger` runs and its logger's real, unpatched `.info`/`.error` never throw) — the test's own throwing override therefore never gets exercised, and more importantly the two new assertions about `action`/`console.error` still incidentally pass while `exitSpy`/`action` assertions could look right for the wrong reason. To make the test meaningfully red before the fix, confirm instead via the `resolves.toBeUndefined()`/exit-code assertions still passing is expected either way — the real signal is Step 4's typecheck, since without the 4th parameter TypeScript itself will flag the extra argument as an error under `tsc --noEmit` (run `npm run typecheck` here too, expect 2 errors: "Expected 1-3 arguments, but got 4").

- [ ] **Step 3: Implement the injectable `loggerFactory` + hardened writes in `src/logger.ts`**

Change `withLogging`'s signature and body:

```ts
export function withLogging(
  commandName: string,
  action: (logger: Logger) => Promise<void>,
  logDir: string = paths.log,
  loggerFactory: typeof createLogger = createLogger,
): () => Promise<void> {
  return async () => {
    let handle: LoggerHandle;
    try {
      handle = loggerFactory(commandName, logDir);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`\n✖ ${message}`);
      process.exit(1);
      return;
    }

    const { logger, logFilePath } = handle;
    try {
      logger.info({ command: commandName }, 'started');
    } catch {
      // best-effort logging; a write failure here must not abort a command that hasn't run yet
    }

    try {
      await action(logger);
      try {
        logger.info({ command: commandName }, 'completed');
      } catch {
        // best-effort logging; the command still succeeded
      }
      if (process.env.DEBUG) {
        console.log(`Details: ${logFilePath}`);
      }
    } catch (error) {
      try {
        logger.error({ command: commandName, err: error }, 'failed');
      } catch {
        // best-effort logging; never let a log-write failure mask the real error
      }
      const message = error instanceof Error ? error.message : String(error);
      console.error(`\n✖ ${message}`);
      console.error(`Details: ${logFilePath}`);
      process.exit(1);
    }
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- logger.test.ts && npm run typecheck`
Expected: PASS (30 tests), typecheck clean.

- [ ] **Step 5: Write the failing hardened-write test for `BaseCommand`**

Append to `templates/base/src/base-command.test.ts`:

```ts
import { Config } from '@oclif/core';
import Hello from './commands/hello';
import type { Logger } from 'pino';

interface TestableCommand {
  logger?: Logger;
  catch(err: unknown): Promise<unknown>;
  finally(err: Error | undefined): Promise<unknown>;
}

describe('BaseCommand hardened write calls', () => {
  it('does not propagate a throw from a failing logger write in catch() or finally()', async () => {
    const config = await Config.load(process.cwd());
    const hello = new Hello([], config);
    await hello.init();
    const cmd = hello as unknown as TestableCommand;

    const logger = cmd.logger as Logger;
    logger.info = (() => {
      throw new Error('disk full');
    }) as Logger['info'];
    logger.error = (() => {
      throw new Error('disk full');
    }) as Logger['error'];

    const originalError = new Error('boom');
    let catchRethrewOriginalError = false;
    try {
      await cmd.catch(originalError);
    } catch (caught) {
      catchRethrewOriginalError = caught === originalError;
    }
    expect(catchRethrewOriginalError).toBe(true);

    await expect(cmd.finally(undefined)).resolves.toBeUndefined();
  });
});
```

(add the three new imports — `Config`, `Hello`, `type Logger` — to the top of the file, alongside the existing `describe`/`it`/`expect`/`runCommand` imports)

`Config.load(process.cwd())` + `new Hello([], config)` + `hello.init()` builds a fully real, unmocked `BaseCommand` instance (bypassing oclif's argv-parsing/command-discovery layer entirely) — this is what makes it possible to directly override `this.logger`'s methods and call the `protected` `catch()`/`finally()` methods to simulate a write failure, without mocking the `pino` module or shipping a throwaway command file (this exact technique, and the two real bugs it found, were verified empirically during planning — see the failure output below).

Run: `cd templates/base && npm test -- base-command.test.ts`
Expected: FAIL. Confirmed during planning that *today's* (pre-Task-4) code throws exactly like this:
```
Error: disk full
    at Pino.cmd.logger.error (.../base-command.test.ts:...)
    at Hello.catch (.../src/base-command.ts:18:18)
```
and separately, from `finally()`:
```
Error: disk full
    at Pino.cmd.logger.info (.../base-command.test.ts:...)
    at Hello.finally (.../src/base-command.ts:24:20)
```
— i.e. both `catch()` and `finally()` currently let a logger-write failure escape as an unhandled throw, which is exactly the milestone's stated problem.

- [ ] **Step 6: Implement hardened writes in `templates/base/src/base-command.ts`**

Replace the whole file:

```ts
// templates/base/src/base-command.ts
import { Command, type Interfaces } from '@oclif/core';
import type { Logger } from 'pino';
import { createLogger } from './logger';

export abstract class BaseCommand extends Command {
  protected logger?: Logger;
  protected logFilePath?: string;

  async init(): Promise<void> {
    await super.init();

    const { logger, logFilePath } = createLogger(this.id ?? 'unknown');
    this.logger = logger;
    this.logFilePath = logFilePath;
    try {
      this.logger.info({ command: this.id }, 'started');
    } catch {
      // best-effort logging; a write failure here must not abort a command that hasn't run yet
    }
  }

  protected async catch(err: Interfaces.CommandError): Promise<unknown> {
    try {
      this.logger?.error({ command: this.id, err }, 'failed');
    } catch {
      // best-effort logging; never let a log-write failure mask the real error
    }
    if (this.logFilePath) {
      console.error(`Details: ${this.logFilePath}`);
    }
    return super.catch(err);
  }

  protected async finally(err: Error | undefined): Promise<unknown> {
    if (!err) {
      try {
        this.logger?.info({ command: this.id }, 'completed');
      } catch {
        // best-effort logging; never let a log-write failure crash a successful run
      }
      if (process.env.DEBUG && this.logFilePath) {
        console.log(`Details: ${this.logFilePath}`);
      }
    }
    return super.finally(err);
  }
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd templates/base && npm test -- base-command.test.ts && npm run typecheck`
Expected: PASS (4 tests), typecheck clean.

- [ ] **Step 8: Full local verification + commit**

Run:
```bash
cd "<repo root>" && npm test && npm run typecheck && npm run lint
cd templates/base && npm install && npm test && npm run typecheck
```
Expected: all green (aside from the pre-existing, unrelated `scaffold.test.ts` `npm install` timeout flake — see Task 5).

```bash
git add src/logger.ts src/logger.test.ts templates/base/src/base-command.ts templates/base/src/base-command.test.ts
git commit -m "fix: harden logger write calls against I/O failures on both sides"
```

---

### Task 5: Manual end-to-end verification + plan/changelog update

No new code — proves the generator actually copies the modified template files with the `{{projectName}}` placeholder correctly replaced, and that real file-system behavior (permissions, retention, live streaming) matches what Tasks 1–4 assumed and unit-tested in isolation.

- [ ] **Step 1: Full local test suite for the generator itself**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all green. If `src/scaffold.test.ts`'s `'does not write a .npmrc when registryUrl is omitted or equal to the default'` test fails with `Error: Test timed out in 5000ms` followed by `ENOTEMPTY: directory not empty, rmdir '...node_modules\<some-package>\...'`, this is a pre-existing, unrelated environmental flake (a real `npm install` racing a Windows temp-directory cleanup) confirmed during planning — unrelated to any file this milestone touches. Re-run in isolation (`npx vitest run src/scaffold.test.ts`) to confirm it passes on retry; do not attempt to fix it as part of this milestone.

- [ ] **Step 2: Real scaffold**

```bash
cat > m8-verify.mjs << 'EOF'
import { scaffoldProject } from './src/scaffold.js';
import path from 'node:path';
import os from 'node:os';

const targetDir = path.join(os.tmpdir(), 'clispark-m8-verify', 'm8-test-cli');
await scaffoldProject({ projectName: 'm8-test-cli', targetDir });
console.log('scaffold complete:', targetDir);
EOF
npx tsx m8-verify.mjs
rm m8-verify.mjs
```

Expected: prints `scaffold complete: <path>`; the generated project includes `src/logger.test.ts` and `src/base-command.test.ts` with the `{{projectName}}` placeholder correctly replaced throughout.

- [ ] **Step 3: Run the generated project's own test suite**

```bash
cd "$(node -e "console.log(require('os').tmpdir())")/clispark-m8-verify/m8-test-cli"
npm test
```

Expected: all tests pass, including the new `logger.test.ts` (11 tests) and `base-command.test.ts` (4 tests).

- [ ] **Step 4: Real CLI invocations — success, DEBUG success, and failure paths**

Still inside `m8-test-cli`:

```bash
echo "=== normal run (no DEBUG) ===" && node bin/run.ts hello
echo "=== DEBUG run ===" && DEBUG=1 node bin/run.ts hello
echo "=== failing run (missing arg) ===" && node bin/run.ts task
```

Expected (confirmed during planning): the normal run prints only `Hello from your new CLI!`, silent about logging. The `DEBUG` run additionally streams raw JSON `started`/`completed` lines to stdout and prints `Details: <path>` after the greeting. The failing run prints `Details: <path>` (before the error block, per Task 3's noted ordering caveat) followed by oclif's own clean `Error: Missing 1 required arg: ...` usage output — no raw stack trace, exit code 2.

- [ ] **Step 5: Real file-system verification — permissions and retention**

Still inside `m8-test-cli`, find the platform log directory (printed in the `Details:` lines above, typically `%LOCALAPPDATA%\m8-test-cli\Log` on Windows or `~/.local/state/m8-test-cli/log` on Linux/macOS via `env-paths`).

```bash
LOGDIR="<path from a Details: line above>"
ls -la "$LOGDIR"
```

On POSIX, expect each `.log` file's mode to show `rw-------` (`0o600`). On Windows, expect no visible difference (documented no-op).

Age one file and re-run with a low retention threshold to prove the sweep on real files:

```bash
touch -d "20 days ago" "$LOGDIR"/hello-*.log   # ages the oldest matching file; adjust per-platform touch syntax if needed
LOG_RETENTION_DAYS=14 node bin/run.ts hello
ls "$LOGDIR"   # the 20-day-old file should be gone; newer files remain
```

- [ ] **Step 6: Clean up verification artifacts**

```bash
cd -
rm -rf "$(node -e "console.log(require('os').tmpdir())")/clispark-m8-verify"
rm -rf "<the real LOGDIR from Step 5, e.g. %LOCALAPPDATA%\m8-test-cli>"
```

- [ ] **Step 7: Final whole-branch review**

Run the project's established review pass over the full diff before merging: confirm `src/cli.ts` is genuinely untouched (per this plan's Global Constraints correction of the spec's wording); confirm both `logger.ts` copies stayed structurally identical to each other (redact list, retention function, multistream logic); confirm `BaseCommand`'s three write call sites (`init`/`catch`/`finally`) are each individually wrapped, not just the two the spec literally enumerated; confirm no leftover `console.log`/`debugger` statements from the empirical planning investigation made it into the diff.

- [ ] **Step 8: Update the project plan**

Mark M8 complete (`- [x]` on all five bullets) in `project-ideas/clispark.plan.md`, add a changelog line summarizing what shipped (redaction, retention, DEBUG visibility, hardened writes, permissions — all five original M2.5-deferred items closed) and any bugs found during Task 4/5's real verification (the two real, empirically-confirmed `BaseCommand` write-hardening bugs), following the existing per-milestone changelog convention.

- [ ] **Step 9: Commit the plan update**

```bash
git add project-ideas/clispark.plan.md
git commit -m "docs: mark M8 complete in clispark plan"
```
