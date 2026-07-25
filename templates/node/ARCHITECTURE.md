# {{projectName}} Architecture

This document explains the conventions this project was generated with, so the automatic behavior (command discovery, logging, error handling) doesn't feel like unexplained magic.

## Commands

Every command lives in `src/commands/` and extends `BaseCommand` (`src/base-command.ts`) instead of oclif's own `Command` class directly:

```ts
import { BaseCommand } from '../base-command';

export default class MyCommand extends BaseCommand {
  static description = 'What this command does';
  static args = {};
  static flags = {};

  async run(): Promise<void> {
    await this.parse(MyCommand);
    // ...
  }
}
```

`BaseCommand` overrides oclif's `init()`/`catch()`/`finally()` lifecycle methods to log every command's start, failure, and completion automatically — no manual logging calls needed inside `run()`.

## Argument Types

Every entry in a command's `static args` is built from `@oclif/core`'s `Args` helpers. `task.ts` / `task/complete.ts` / `task/list.ts` use a few of these; the full set `@oclif/core` ships:

- **`Args.string()`** — plain text, no parsing/validation. The default choice.
  ```ts
  title: Args.string({ description: 'Task title' });
  ```
- **`Args.integer({ min?, max? })`** — parses digits into a real `number`, rejects non-numeric input, optional bounds.
  ```ts
  id: Args.integer({ description: 'Task ID' });
  // `task complete abc` → "Expected an integer but received: abc"
  ```
- **`Args.boolean()`** — parses into a real `boolean`. Any input is `true` except (case-insensitive) `0`, `false`, `n`, `no`, which parse to `false`.
  ```ts
  done: Args.boolean({ description: 'Only completed tasks' });
  // `task list true` → done === true; `task list no` → done === false
  ```
- **`Args.file({ exists? })`** / **`Args.directory({ exists? })`** — plain string path by default; with `exists: true`, verifies the path actually exists on disk (as a file/directory respectively) and throws otherwise.
  ```ts
  config: Args.file({ exists: true, description: 'Path to a config file' });
  // missing file → "No file found at <path>"
  ```
- **`Args.url()`** — parses into a real `URL` object, throws if the input isn't a valid URL.
  ```ts
  endpoint: Args.url({ description: 'API endpoint' });
  ```
- **`Args.custom<T, Opts>({ parse })`** — build your own type when none of the above fit.
  ```ts
  const semver = Args.custom<string>({
    parse: async (input) => {
      if (!/^\d+\.\d+\.\d+$/.test(input))
        throw new Error(`Not a valid semver: ${input}`);
      return input;
    },
  });
  ```
- **`options: [...]`** — a cross-cutting constraint any arg type can add (not a type itself): restricts input to a fixed list of values.
  ```ts
  priority: Args.string({ options: ['low', 'medium', 'high'] });
  // `task <title> urgent` → "Expected urgent to be one of: low, medium, high"
  ```

See `task.ts` (string + enum-constrained string), `task/complete.ts` (integer), and `task/list.ts` (string arg + boolean flag) for these in a real, runnable command.

## Flags

Flags (`--name`/`-n`) are `@oclif/core`'s other input mechanism, declared in `static flags` alongside (or instead of) `static args`. Unlike args, they're named and order-independent — the more common choice for optional inputs once a command has more than one or two of them.

- **`Flags.boolean()`** — presence-based: passing the flag sets it to `true`, omitting it leaves it `undefined`.
  ```ts
  done: Flags.boolean({ description: 'Only show completed tasks' });
  // `task list --done` → done === true; omitted → done === undefined
  ```
- Flags otherwise mirror the `Args` catalogue above (`Flags.string()`, `Flags.integer()`, `options: [...]`, etc.) — the choice between an arg and a flag is about calling convention (positional vs. named), not available types.

See `task/list.ts`'s `--done` flag for this in a real, runnable command.

## Command Discovery

oclif discovers commands at runtime from the `oclif.commands` path in `package.json` (`./dist/commands`) — there is no custom filesystem-scanning code. Dropping a new file in `src/commands/` and building the project is enough for oclif to pick it up; nothing needs to be manually registered.

## Logging

`src/logger.ts` writes structured JSON logs via `pino`, one file per command invocation, to an OS-appropriate log directory (via `env-paths`) — never to the project's own working directory. Every log line includes the command name. On failure, the full error (including stack trace) is logged, while the terminal only ever shows a clean `Error: <message>` — never a raw stack trace; the terminal also prints `Details: <path to the log file>` so the full error is one file away.

A few things run automatically around every log call:

- **Retention:** before opening a new log file, `sweepOldLogs()` deletes files older than `LOG_RETENTION_DAYS` (default `14`).
- **Redaction:** `pino`'s `redact` option is configured with `SENSITIVE_LOG_KEYS` — a plain, exported array of secret-shaped field names (`password`, `token`, `apiKey`, etc., matched at the top level and one level of nesting). It's just a `const` in `src/logger.ts`; add to it directly if your commands log other sensitive fields.
- **`DEBUG=1`:** streams every log line to stdout live (via `pino.multistream()`) in addition to the file, and prints `Details: <path>` on success too, not just on failure — useful while developing a new command.
- **File permissions:** the log file itself is created with mode `0o600` (owner read/write only); this is a no-op on Windows, which has no POSIX permission bits.

## Testing

Tests use `@oclif/test`'s `runCommand()` helper and live next to the command they test (e.g. `src/commands/hello.test.ts`). Running `npm test` first runs a build (via the `pretest` script) — `runCommand()` reads compiled output from `dist/commands`, so a stale or missing build produces empty, unhelpful output instead of a clear error. Every command's `run()` must call `await this.parse(<CommandClass>)`, even with no flags/args, to avoid an oclif `UnparsedCommand` warning.
