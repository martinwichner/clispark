# clispark: Generator-Own Logging & Error Handling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `clispark` itself (the generator, not the projects it generates) structured file-based logging and consistent, no-opt-out global error handling — mirroring the same "auto-logging, auto-error-handling per command" principle the plan already commits to for generated projects, applied reflexively to clispark's own CLI.

**Architecture:** `src/logger.ts` exports `createLogger(commandName, logDir?)` (creates one timestamped, uniquely-named log file per invocation, in an OS-appropriate app-data log directory via `env-paths`) and `withLogging(commandName, action, logDir?)` — a generic action-handler wrapper that logs start/completion/failure, and on failure prints a clean one-line message to the terminal (never a raw stack trace) plus a pointer to the log file, then exits with code 1. `src/cli.ts`'s existing action handler is wrapped with `withLogging('scaffold', ...)`. No logging calls are added inside `wizard.ts`/`scaffold.ts` — those stay exactly as tested today; all logging is confined to `logger.ts` + `cli.ts`.

**Tech Stack:** Adds `pino` (structured logging) and `env-paths` (OS-correct app-data/log directory resolution) as dependencies.

## Global Constraints

- Project language is English.
- Log destination: an OS-appropriate log directory resolved via `env-paths('clispark', { suffix: '' }).log` — never the current working directory (avoids littering the folder the user is scaffolding into, and avoids losing logs from previous runs in different directories).
- One log file per invocation, never a shared growing file: filename pattern `<commandName>-<ISO-timestamp-with-colons-and-dots-replaced-by-dashes>-<6-hex-char-random-suffix>.log`. The random suffix guarantees uniqueness even for two invocations within the same millisecond.
- The command name (e.g. `"scaffold"`) is the only thing baked into the filename — reusable, per-invocation context (like the project name being scaffolded) is logged as a structured field inside the log entries, not encoded in the filename. This keeps `withLogging` generic enough to wrap future commands (e.g. Milestone 6's `update`/`releasenotes`) without any per-command special-casing.
- On failure: the terminal shows exactly `✖ <error.message>` followed by a line pointing at the log file path — never a raw stack trace. The full error (including stack, via pino's `err` field) goes only to the log file.
- No opt-out: every invocation wrapped in `withLogging` gets this behavior; there is no flag or code path to skip logging or fall back to raw error output.
- `createLogger` and `withLogging` must accept an optional `logDir` override (defaulting to the real `env-paths` location) so automated tests never create files in the real OS app-data directory — tests always pass a temporary directory.
- `pino.destination(...)` is async by default (unbuffered writes are not guaranteed to hit disk before the process terminates). Since `withLogging`'s failure path calls `process.exit(1)` immediately after logging the error — and Node's `process.exit()` does not wait for pending I/O — `withLogging` must `await logger.flush()` after `logger.error(...)` and before `process.exit(1)`, otherwise the one log entry the whole feature exists to preserve (the full error with stack, on failure) can be lost or truncated. Discovered during Task 1's review: the automated tests mock `process.exit` to a no-op, so this race is invisible to the test suite and only manifests in real failures — a case where passing tests were not sufficient evidence and manual/review scrutiny of the actual runtime behavior mattered.
- No logging calls inside `src/wizard.ts` or `src/scaffold.ts` — both stay exactly as already tested; this milestone's logging is confined to `src/logger.ts` and `src/cli.ts` (which, consistent with Milestones 1-2, has no automated test of its own — only typecheck, build, and manual end-to-end verification).

---

### Task 1: Logger Module (`createLogger` + `withLogging`)

**Files:**
- Create: `src/logger.ts`
- Test: `src/logger.test.ts`
- Modify: `package.json` (add `pino` and `env-paths` to `"dependencies"`)

**Interfaces:**
- Produces:
  - `interface LoggerHandle { logger: pino.Logger; logFilePath: string }`
  - `function createLogger(commandName: string, logDir?: string): LoggerHandle`
  - `function withLogging(commandName: string, action: (logger: pino.Logger) => Promise<void>, logDir?: string): () => Promise<void>` — consumed by `src/cli.ts` in Task 2

- [ ] **Step 1: Add dependencies to `package.json`**

In `package.json`, change:

```json
  "dependencies": {
    "@clack/prompts": "^0.9.1",
    "commander": "^13.1.0",
    "cross-spawn": "^7.0.3"
  },
```

to:

```json
  "dependencies": {
    "@clack/prompts": "^0.9.1",
    "commander": "^13.1.0",
    "cross-spawn": "^7.0.3",
    "env-paths": "^3.0.0",
    "pino": "^9.6.0"
  },
```

Then run: `npm install`
Expected: installs without errors.

- [ ] **Step 2: Write the failing test**

```ts
// src/logger.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createLogger, withLogging } from './logger.js';

describe('createLogger', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(path.join(tmpdir(), 'clispark-logger-test-'));
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it('creates a timestamped log file for the given command inside the given directory', () => {
    const { logFilePath } = createLogger('scaffold', tmpRoot);

    expect(path.dirname(logFilePath)).toBe(tmpRoot);
    expect(path.basename(logFilePath)).toMatch(/^scaffold-.+\.log$/);
    expect(existsSync(logFilePath)).toBe(true);
  });

  it('creates the log directory if it does not exist yet', () => {
    const nestedDir = path.join(tmpRoot, 'nested', 'logs');

    const { logFilePath } = createLogger('scaffold', nestedDir);

    expect(existsSync(nestedDir)).toBe(true);
    expect(path.dirname(logFilePath)).toBe(nestedDir);
  });

  it('generates a distinct file for each call, even for the same command in the same millisecond', () => {
    const first = createLogger('scaffold', tmpRoot);
    const second = createLogger('scaffold', tmpRoot);

    expect(first.logFilePath).not.toBe(second.logFilePath);
  });

  it('writes structured JSON log entries to the file', async () => {
    const { logger, logFilePath } = createLogger('scaffold', tmpRoot);

    logger.info({ projectName: 'my-cli' }, 'scaffold started');
    await logger.flush();

    const content = await readFile(logFilePath, 'utf8');
    const entry = JSON.parse(content.trim().split('\n')[0]);
    expect(entry.msg).toBe('scaffold started');
    expect(entry.projectName).toBe('my-cli');
  });
});

describe('withLogging', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(path.join(tmpdir(), 'clispark-logger-test-'));
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it('runs the action and does not exit the process on success', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const action = vi.fn(async () => {});

    const wrapped = withLogging('scaffold', action, tmpRoot);
    await wrapped();

    expect(action).toHaveBeenCalledTimes(1);
    expect(exitSpy).not.toHaveBeenCalled();

    exitSpy.mockRestore();
  });

  it('prints a clean one-line error message and exits with code 1 on failure, without a raw stack trace', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const action = vi.fn(async () => {
      throw new Error('npm install failed');
    });

    const wrapped = withLogging('scaffold', action, tmpRoot);
    await wrapped();

    const printedLines = errorSpy.mock.calls.map((call) => String(call[0]));
    expect(printedLines.some((line) => line.includes('✖ npm install failed'))).toBe(true);
    expect(printedLines.some((line) => line.includes('Details:'))).toBe(true);
    expect(printedLines.every((line) => !line.includes('at ') && !line.includes('.js:'))).toBe(true);
    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('logs the full error, including a stack, to the log file on failure', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const action = vi.fn(async () => {
      throw new Error('npm install failed');
    });

    const wrapped = withLogging('scaffold', action, tmpRoot);
    await wrapped();

    const files = await import('node:fs/promises').then((fs) => fs.readdir(tmpRoot));
    const logFile = files.find((f) => f.startsWith('scaffold-'));
    expect(logFile).toBeDefined();

    const content = await readFile(path.join(tmpRoot, logFile as string), 'utf8');
    expect(content).toContain('npm install failed');
    expect(content).toContain('"level":50');

    exitSpy.mockRestore();
    vi.restoreAllMocks();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/logger.test.ts`
Expected: FAIL — `Cannot find module './logger.js'`, since `src/logger.ts` doesn't exist yet.

- [ ] **Step 4: Write minimal implementation**

```ts
// src/logger.ts
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import envPaths from 'env-paths';
import pino, { type Logger } from 'pino';

const paths = envPaths('clispark', { suffix: '' });

export interface LoggerHandle {
  logger: Logger;
  logFilePath: string;
}

function buildLogFileName(commandName: string): string {
  const timestamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
  const suffix = randomBytes(3).toString('hex');
  return `${commandName}-${timestamp}-${suffix}.log`;
}

export function createLogger(commandName: string, logDir: string = paths.log): LoggerHandle {
  mkdirSync(logDir, { recursive: true });

  const logFilePath = path.join(logDir, buildLogFileName(commandName));
  const logger = pino(pino.destination(logFilePath));

  return { logger, logFilePath };
}

export function withLogging(
  commandName: string,
  action: (logger: Logger) => Promise<void>,
  logDir: string = paths.log,
): () => Promise<void> {
  return async () => {
    const { logger, logFilePath } = createLogger(commandName, logDir);

    logger.info({ command: commandName }, 'started');
    try {
      await action(logger);
      logger.info({ command: commandName }, 'completed');
    } catch (error) {
      logger.error({ command: commandName, err: error }, 'failed');
      await logger.flush();
      const message = error instanceof Error ? error.message : String(error);
      console.error(`\n✖ ${message}`);
      console.error(`Details: ${logFilePath}`);
      process.exit(1);
    }
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/logger.test.ts`
Expected: PASS (7 tests: 4 from `createLogger`, 3 from `withLogging`)

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/logger.ts src/logger.test.ts
git commit -m "feat: add generator-own structured logging and error-handling wrapper"
```

---

### Task 2: Wire Into CLI + Manual Verification

**Files:**
- Modify: `src/cli.ts`

**Interfaces:**
- Consumes: `withLogging` from `./logger.js` (Task 1)

- [ ] **Step 1: Modify `src/cli.ts`**

Change:

```ts
import { createRequire } from 'node:module';
import path from 'node:path';
import { Command } from 'commander';
import { runWizard } from './wizard.js';
import { scaffoldProject } from './scaffold.js';
```

to:

```ts
import { createRequire } from 'node:module';
import path from 'node:path';
import { Command } from 'commander';
import { runWizard } from './wizard.js';
import { scaffoldProject } from './scaffold.js';
import { withLogging } from './logger.js';
```

Change:

```ts
program.action(async () => {
  const answers = await runWizard();
  const targetDir = path.join(process.cwd(), answers.projectName);

  await scaffoldProject({ projectName: answers.projectName, targetDir });

  console.log(`\nDone! Your new CLI project is ready at ${targetDir}`);
});
```

to:

```ts
program.action(
  withLogging('scaffold', async (logger) => {
    const answers = await runWizard();
    const targetDir = path.join(process.cwd(), answers.projectName);

    logger.info({ projectName: answers.projectName, targetDir }, 'scaffold started');
    await scaffoldProject({ projectName: answers.projectName, targetDir });
    logger.info({ projectName: answers.projectName }, 'scaffold completed');

    console.log(`\nDone! Your new CLI project is ready at ${targetDir}`);
  }),
);
```

Leave the existing `program.parseAsync(process.argv).catch(...)` block at the bottom of the file unchanged — it stays as a last-resort safety net for failures outside the action handler (e.g. commander's own argument-parsing errors), which `withLogging` does not cover.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: succeeds, produces `dist/cli.js`.

- [ ] **Step 4: Manual verification — success path**

Run:

```bash
npx tsx -e "
import { scaffoldProject } from './src/scaffold.js';
import { withLogging } from './src/logger.js';
import path from 'node:path';
import os from 'node:os';

const logDir = path.join(os.tmpdir(), 'clispark-manual-verify-logs');
const targetDir = path.join(os.tmpdir(), 'clispark-manual-verify', 'logging-test-cli');

const run = withLogging('scaffold', async (logger) => {
  logger.info({ projectName: 'logging-test-cli' }, 'scaffold started');
  await scaffoldProject({ projectName: 'logging-test-cli', targetDir });
  logger.info({ projectName: 'logging-test-cli' }, 'scaffold completed');
  console.log('Done!');
}, logDir);

await run();
"
```

Expected: prints only `Done!` (no error output), and a single new file appears under `<os-tmpdir>/clispark-manual-verify-logs/` named `scaffold-<timestamp>-<suffix>.log`. Open it and confirm it contains JSON lines including `"msg":"started"`, `"msg":"scaffold started"`, `"projectName":"logging-test-cli"`, `"msg":"scaffold completed"`.

- [ ] **Step 5: Manual verification — failure path**

Run (same idea, but with a target directory that's already non-empty, to force `scaffoldProject` to reject):

```bash
node -e "require('node:fs').mkdirSync(require('node:path').join(require('node:os').tmpdir(), 'clispark-manual-verify-fail'), { recursive: true }); require('node:fs').writeFileSync(require('node:path').join(require('node:os').tmpdir(), 'clispark-manual-verify-fail', 'existing.txt'), 'x')"

npx tsx -e "
import { scaffoldProject } from './src/scaffold.js';
import { withLogging } from './src/logger.js';
import path from 'node:path';
import os from 'node:os';

const logDir = path.join(os.tmpdir(), 'clispark-manual-verify-logs');
const targetDir = path.join(os.tmpdir(), 'clispark-manual-verify-fail');

const run = withLogging('scaffold', async (logger) => {
  await scaffoldProject({ projectName: 'clispark-manual-verify-fail', targetDir });
  console.log('should not reach here');
}, logDir);

await run();
"
```

Expected: prints exactly two lines to stderr — `✖ Directory "<path>" already exists and is not empty.` and `Details: <logFilePath>` — no stack trace, no `console.log('should not reach here')` output. The process exits with code 1 (check with `echo $?` in a POSIX shell, or `echo %errorlevel%` / `$LASTEXITCODE` depending on your shell). A new log file appears in the same `logDir`, and its content includes the full error with a `"stack"` field and `"level":50` (pino's numeric level for `error`).

- [ ] **Step 6: Clean up manual verification artifacts**

Remove the following (they're scratch output, not part of the repo): `<os-tmpdir>/clispark-manual-verify`, `<os-tmpdir>/clispark-manual-verify-fail`, `<os-tmpdir>/clispark-manual-verify-logs`.

- [ ] **Step 7: Commit**

```bash
git add src/cli.ts
git commit -m "feat: wrap CLI action with generator-own structured logging"
```

---

### Task 3: Push to GitHub

**Files:**
- None (repository-level operation only)

**Interfaces:**
- None

- [ ] **Step 1: Verify remote and branch**

Run: `git remote -v && git branch --show-current`
Expected: `origin` points to `git@github.com:martinwichner/clispark.git`.

- [ ] **Step 2: Push**

Run: `git push`
Expected: pushes all commits from this milestone.

- [ ] **Step 3: Verify on GitHub**

Run: `git log --oneline -1` and compare against the GitHub repo's latest commit to confirm the push landed.
