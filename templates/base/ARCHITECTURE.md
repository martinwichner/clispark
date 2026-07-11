# {{projectName}} Architecture

This document explains the conventions this project was generated with, so the automatic behavior (command discovery, logging, error handling) doesn't feel like unexplained magic.

## Commands

Every command lives in `src/commands/` and extends `BaseCommand` (`src/base-command.ts`) instead of oclif's own `Command` class directly:

```ts
import { BaseCommand } from '../base-command.js';

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

## Command Discovery

oclif discovers commands at runtime from the `oclif.commands` path in `package.json` (`./dist/commands`) — there is no custom filesystem-scanning code. Dropping a new file in `src/commands/` and building the project is enough for oclif to pick it up; nothing needs to be manually registered.

## Logging

`src/logger.ts` writes structured JSON logs via `pino`, one file per command invocation, to an OS-appropriate log directory (via `env-paths`) — never to the project's own working directory. Every log line includes the command name. On failure, the full error (including stack trace) is logged, while the terminal only ever shows a clean `Error: <message>` — never a raw stack trace.

## Testing

Tests use `@oclif/test`'s `runCommand()` helper and live next to the command they test (e.g. `src/commands/hello.test.ts`). Running `npm test` first runs a build (via the `pretest` script) — `runCommand()` reads compiled output from `dist/commands`, so a stale or missing build produces empty, unhelpful output instead of a clear error. Every command's `run()` must call `await this.parse(<CommandClass>)`, even with no flags/args, to avoid an oclif `UnparsedCommand` warning.
