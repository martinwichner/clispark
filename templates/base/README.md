# {{projectName}}

Generated with [clispark](https://github.com/martinwichner/clispark).

## Requirements

Node.js **>=24** — the CLI entry point (`bin/run.ts`) runs directly via Node's native TypeScript execution, with no separate build step for that file. On an older Node version it fails with an `ERR_UNKNOWN_FILE_EXTENSION` error rather than a clear version message, so if you hit that, check `node --version` first.

Commands themselves are still discovered from the compiled `dist/commands` output (`oclif.commands` in `package.json`), so a build is still required at least once before any command runs — clispark already does this for you during scaffolding (`npm install && npm run build`). You'll only need to run `npm run build` again yourself after a fresh clone, or if `dist/` gets deleted.

## Example commands

Two example commands ship in `src/commands/` as copy-paste starting points:

- **`hello`** (`src/commands/hello.ts`) — the minimal case: no args, no subcommands.
  ```bash
  node bin/run.ts hello
  ```
- **`task`** / **`task complete`** / **`task list`** (`src/commands/task.ts`, `src/commands/task/`) — a reference for oclif's argument and subcommand patterns: required args, optional args, an enum-constrained arg, an integer arg, a boolean arg, and how a folder under `src/commands/` becomes a subcommand.
  ```bash
  node bin/run.ts task "Buy milk" high
  node bin/run.ts task complete 1
  node bin/run.ts task list groceries
  ```
  See `ARCHITECTURE.md`'s "Argument Types" section for the full set of argument types oclif supports, including a couple this example doesn't use.

## Logging & debugging

Every command run writes a structured JSON log file (one per invocation, in an OS-appropriate log directory — see `ARCHITECTURE.md`'s "Logging" section). By default the terminal only shows a clean `Error: <message>` on failure, or nothing on success.

- **`DEBUG=1`** — streams the raw JSON log lines to stdout live as the command runs, and prints `Details: <path>` to the log file on both success and failure (normally that line only appears on failure).
- **`LOG_RETENTION_DAYS`** — log files older than this many days are swept before each new run (default: `14`).
- Fields that look like secrets (`password`, `token`, `apiKey`, etc. — see `SENSITIVE_LOG_KEYS` in `src/logger.ts`) are redacted from log output automatically; edit that list directly in your own copy if you log other sensitive fields.
