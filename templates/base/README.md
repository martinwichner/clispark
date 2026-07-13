# {{projectName}}

Generated with [clispark](https://github.com/martinwichner/clispark).

## Requirements

Node.js **>=24** — this project's entry point (`bin/run.ts`) runs directly via Node's native TypeScript execution, with no build step. On an older Node version it fails with an `ERR_UNKNOWN_FILE_EXTENSION` error rather than a clear version message, so if you hit that, check `node --version` first.

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
