# clispark M3: Core Runtime Features in the Generated Boilerplate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the *generated* oclif project (Milestone 2's command-less skeleton) the runtime features that were deliberately deferred: automatic per-command logging and error handling with no opt-out, a working testing setup, and a first example command — Milestone 3 from `project-ideas/clispark.plan.md`.

**Architecture:** `templates/base/src/logger.ts` is a trimmed copy of clispark's own (Milestone 2.5) `createLogger` — same sync pino destination, one log file per invocation, `env-paths`-based OS log directory — but with `{{projectName}}` as the `env-paths` namespace instead of a hardcoded name, and without the unused `withLogging` wrapper (oclif has its own lifecycle, see below). `templates/base/src/base-command.ts` defines a `BaseCommand` class that every generated command extends instead of oclif's own `Command`; it overrides oclif's `init()`/`catch()`/`finally()` lifecycle methods to log start/failure/completion automatically. `templates/base/src/commands/hello.ts` is the first example command, extending `BaseCommand`, tested via oclif's own `@oclif/test` helper.

**Tech Stack:** Same as Milestone 2 for the generated project (TypeScript ESM, oclif, tsup, vitest) plus `pino`, `env-paths` (both already clispark dependencies, now also needed inside the generated project) and `@oclif/test` (generated-project dev dependency only).

## Global Constraints

- Project language is English.
- **Auto-registration needs no custom code.** oclif already discovers commands at runtime from the `oclif.commands` path in `package.json` (`./dist/commands`) — this milestone does not add any filesystem-scanning logic. The `src/commands/**/*.ts` convention (and matching tsup entry glob) is already in place from Milestone 2.
- **`withLogging`-style wrapping of the CLI entry point does not work for the generated project and must not be attempted.** Verified empirically: oclif's `execute()` calls `process.exit()` internally on a command failure and never returns control to calling code, so a promise-based wrapper around `execute()` (the pattern used in clispark's own Milestone 2.5) cannot observe or log the failure.
- **Logging/error-handling must instead hook into oclif's `Command` lifecycle.** `Command.prototype.catch(err)` and `Command.prototype.finally(err)` are called by oclif's own `_run()` for every command invocation (verified by reading `@oclif/core`'s source), regardless of success or failure, and are properly awaited before the top-level error print/exit happens. `BaseCommand` overrides these; every generated command must extend `BaseCommand` (a documented convention, not a technically-unbypassable mechanism — acceptable, matching how the rest of the generated boilerplate already relies on documented conventions rather than framework-enforced ones).
- **Do not attempt to change or improve oclif's own default error message formatting.** Verified empirically: oclif already prints a clean `Error: <message>` with no raw stack trace and exits with code 1 for any uncaught command error, with zero custom code. `BaseCommand.catch()` only adds logging as a side effect and must call `super.catch(err)` (or return its result) to preserve this existing behavior — do not replace it with custom `console.error` output.
- **`disableConsoleIntercept: true` is required in the generated project's `vitest.config.ts`.** Verified empirically: without it, `@oclif/test`'s `runCommand()` stdout capture returns an empty string under vitest (the command's real output goes to the real terminal instead of being captured) — the same vitest version (`^2.1.8`, installed `2.1.9`) used in the generated project's own `package.json` was used to verify the fix.
- **The generated project's `package.json` needs a `"pretest": "npm run build"` script.** Verified empirically: `@oclif/test`'s `runCommand()` requires the compiled `dist/commands` directory to exist (`oclif.commands` in `package.json` points there) — without a prior build, `runCommand()` does not error, it silently returns empty output. npm runs `pretest` automatically before `test`.
- **Every generated command must call `this.parse(<CommandClass>)` in `run()`, even with no flags/args.** Verified empirically: without it, oclif emits an `UnparsedCommand` process warning on every invocation. The example command demonstrates this as the copy-paste starting point for future commands.
- No changes to clispark's own runtime behavior (`src/wizard.ts`, `src/cli.ts`'s own logging from Milestone 2.5) — this milestone only touches `templates/base/**` (the generated project) plus the parts of `src/scaffold.ts`/`src/scaffold.test.ts` needed to keep the `{{projectName}}` placeholder mechanism correct for the new template file.

---

### Task 1: Generated-Project Logger + BaseCommand Templates

**Files:**
- Create: `templates/base/src/logger.ts`
- Create: `templates/base/src/base-command.ts`
- Modify: `src/scaffold.ts`
- Modify: `src/scaffold.test.ts`

**Interfaces:**
- Produces (inside the generated project, not consumed by clispark itself):
  - `templates/base/src/logger.ts`: `interface LoggerHandle { logger: Logger; logFilePath: string }`, `function createLogger(commandName: string, logDir?: string): LoggerHandle`
  - `templates/base/src/base-command.ts`: `abstract class BaseCommand extends Command` — consumed by `templates/base/src/commands/hello.ts` in Task 2

- [ ] **Step 1: Write `templates/base/src/logger.ts`**

```ts
// templates/base/src/logger.ts
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import envPaths from 'env-paths';
import pino, { type Logger } from 'pino';

const paths = envPaths('{{projectName}}', { suffix: '' });

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
  const logger = pino(pino.destination({ dest: logFilePath, sync: true }));

  return { logger, logFilePath };
}
```

- [ ] **Step 2: Write `templates/base/src/base-command.ts`**

```ts
// templates/base/src/base-command.ts
import { Command, type Interfaces } from '@oclif/core';
import type { Logger } from 'pino';
import { createLogger } from './logger.js';

export abstract class BaseCommand extends Command {
  protected logger?: Logger;

  async init(): Promise<void> {
    await super.init();

    const { logger } = createLogger(this.id ?? 'unknown');
    this.logger = logger;
    this.logger.info({ command: this.id }, 'started');
  }

  protected async catch(err: Interfaces.CommandError): Promise<unknown> {
    this.logger?.error({ command: this.id, err }, 'failed');
    return super.catch(err);
  }

  protected async finally(err: Error | undefined): Promise<unknown> {
    if (!err) {
      this.logger?.info({ command: this.id }, 'completed');
    }
    return super.finally(err);
  }
}
```

- [ ] **Step 3: Write the failing test for the extended `copyTemplate` behavior**

Replace the entire contents of `src/scaffold.test.ts` with the following (it's the Milestone 2 file plus new assertions in the `'copies all template files...'` test, covering the two new template files):

```ts
// src/scaffold.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { copyTemplate, scaffoldProject } from './scaffold.js';

describe('copyTemplate', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(path.join(tmpdir(), 'clispark-test-'));
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it('copies all template files into a new target directory, replacing {{projectName}}', async () => {
    const targetDir = path.join(tmpRoot, 'my-cli');

    await copyTemplate({ projectName: 'my-cli', targetDir });

    const pkg = JSON.parse(await readFile(path.join(targetDir, 'package.json'), 'utf8'));
    expect(pkg.name).toBe('my-cli');
    expect(pkg.bin).toEqual({ 'my-cli': './bin/run.js' });
    expect(pkg.oclif.bin).toBe('my-cli');
    expect(pkg.oclif.dirname).toBe('my-cli');

    const readme = await readFile(path.join(targetDir, 'README.md'), 'utf8');
    expect(readme).toContain('# my-cli');

    const gitignore = await readFile(path.join(targetDir, '.gitignore'), 'utf8');
    expect(gitignore).toContain('node_modules');

    const runJs = await readFile(path.join(targetDir, 'bin', 'run.js'), 'utf8');
    expect(runJs).toContain('execute');

    const indexTs = await readFile(path.join(targetDir, 'src', 'index.ts'), 'utf8');
    expect(indexTs).toContain("export { run } from '@oclif/core';");

    const loggerTs = await readFile(path.join(targetDir, 'src', 'logger.ts'), 'utf8');
    expect(loggerTs).toContain("envPaths('my-cli'");
    expect(loggerTs).not.toContain('{{projectName}}');

    const baseCommandTs = await readFile(path.join(targetDir, 'src', 'base-command.ts'), 'utf8');
    expect(baseCommandTs).toContain('export abstract class BaseCommand extends Command');
  });

  it('creates the target directory when it does not exist yet', async () => {
    const targetDir = path.join(tmpRoot, 'new-project');

    await copyTemplate({ projectName: 'new-project', targetDir });

    const pkg = JSON.parse(await readFile(path.join(targetDir, 'package.json'), 'utf8'));
    expect(pkg.name).toBe('new-project');
  });

  it('succeeds when the target directory exists but is empty', async () => {
    const targetDir = path.join(tmpRoot, 'empty-dir');
    await mkdir(targetDir);

    await copyTemplate({ projectName: 'empty-dir', targetDir });

    const pkg = JSON.parse(await readFile(path.join(targetDir, 'package.json'), 'utf8'));
    expect(pkg.name).toBe('empty-dir');
  });

  it('throws a clear error when the target directory already exists and is not empty', async () => {
    const targetDir = path.join(tmpRoot, 'occupied');
    await mkdir(targetDir);
    await writeFile(path.join(targetDir, 'existing-file.txt'), 'hello');

    await expect(copyTemplate({ projectName: 'occupied', targetDir })).rejects.toThrow(
      /already exists and is not empty/,
    );
  });
});

describe('scaffoldProject', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(path.join(tmpdir(), 'clispark-test-'));
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it('copies the template, then runs git init/add/commit and npm install/build in order', async () => {
    const targetDir = path.join(tmpRoot, 'my-cli');
    const calls: Array<{ command: string; args: string[]; cwd: string }> = [];
    const runCommand = vi.fn(async (command: string, args: string[], cwd: string) => {
      calls.push({ command, args, cwd });
    });

    await scaffoldProject({ projectName: 'my-cli', targetDir }, { runCommand });

    expect(calls.map((c) => `${c.command} ${c.args.join(' ')}`)).toEqual([
      'git init',
      'git add -A',
      'git commit -m chore: initial scaffold from clispark',
      'npm install',
      'npm run build',
    ]);
    expect(calls.every((c) => c.cwd === targetDir)).toBe(true);

    // template files were actually copied before any command ran
    const pkg = JSON.parse(await readFile(path.join(targetDir, 'package.json'), 'utf8'));
    expect(pkg.name).toBe('my-cli');
  });

  it('propagates an error from a failing command without swallowing it', async () => {
    const targetDir = path.join(tmpRoot, 'fails');
    const runCommand = vi.fn(async (command: string) => {
      if (command === 'npm') throw new Error('npm install failed');
    });

    await expect(scaffoldProject({ projectName: 'fails', targetDir }, { runCommand })).rejects.toThrow(
      'npm install failed',
    );
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run src/scaffold.test.ts`
Expected: FAIL — the first test's new assertions fail because `src/logger.ts`'s `{{projectName}}` placeholder isn't replaced yet (`copyTemplate` doesn't know about this file), and/or `src/base-command.ts` doesn't exist in the copied output yet if Steps 1-2 weren't done first. (If you did Steps 1-2 before writing this test, the failure will specifically be about the un-replaced `{{projectName}}` in `logger.ts`, since `copyTemplate` only replaces placeholders in `package.json`/`README.md` today.)

- [ ] **Step 5: Modify `src/scaffold.ts` to also replace the placeholder in `src/logger.ts`**

Change:

```ts
  await replacePlaceholder(path.join(targetDir, 'package.json'), projectName);
  await replacePlaceholder(path.join(targetDir, 'README.md'), projectName);
}
```

to:

```ts
  await replacePlaceholder(path.join(targetDir, 'package.json'), projectName);
  await replacePlaceholder(path.join(targetDir, 'README.md'), projectName);
  await replacePlaceholder(path.join(targetDir, 'src', 'logger.ts'), projectName);
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/scaffold.test.ts`
Expected: PASS (6 tests: 4 from `copyTemplate`, 2 from `scaffoldProject`)

- [ ] **Step 7: Commit**

```bash
git add templates/base/src/logger.ts templates/base/src/base-command.ts src/scaffold.ts src/scaffold.test.ts
git commit -m "feat: add generated-project logger and BaseCommand templates"
```

---

### Task 2: Example Command + Test Tooling

**Files:**
- Create: `templates/base/src/commands/hello.ts`
- Create: `templates/base/src/commands/hello.test.ts`
- Modify: `templates/base/vitest.config.ts`
- Modify: `templates/base/package.json`
- Modify: `src/scaffold.test.ts`

**Interfaces:**
- Consumes: `BaseCommand` from `../base-command.js` (Task 1)

- [ ] **Step 1: Write `templates/base/src/commands/hello.ts`**

```ts
// templates/base/src/commands/hello.ts
import { BaseCommand } from '../base-command.js';

export default class Hello extends BaseCommand {
  static description = 'Say hello';
  static args = {};
  static flags = {};

  async run(): Promise<void> {
    await this.parse(Hello);
    this.log('Hello from your new CLI!');
  }
}
```

- [ ] **Step 2: Write `templates/base/src/commands/hello.test.ts`**

```ts
// templates/base/src/commands/hello.test.ts
import { describe, it, expect } from 'vitest';
import { runCommand } from '@oclif/test';

describe('hello', () => {
  it('prints a greeting', async () => {
    const { stdout } = await runCommand('hello');
    expect(stdout).toContain('Hello from your new CLI!');
  });
});
```

- [ ] **Step 3: Update `templates/base/vitest.config.ts`**

Change:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
  },
});
```

to:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    disableConsoleIntercept: true,
  },
});
```

- [ ] **Step 4: Update `templates/base/package.json`**

Change:

```json
  "scripts": {
    "build": "tsup",
    "postbuild": "shx chmod +x bin/run.js",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@oclif/core": "^4.0.0",
    "@oclif/plugin-help": "^6.0.0"
  },
  "devDependencies": {
    "@types/node": "^22.10.5",
    "shx": "^0.3.4",
    "tsup": "^8.3.5",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
```

to:

```json
  "scripts": {
    "build": "tsup",
    "postbuild": "shx chmod +x bin/run.js",
    "pretest": "npm run build",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@oclif/core": "^4.0.0",
    "@oclif/plugin-help": "^6.0.0",
    "env-paths": "^3.0.0",
    "pino": "^9.6.0"
  },
  "devDependencies": {
    "@oclif/test": "^4.0.0",
    "@types/node": "^22.10.5",
    "shx": "^0.3.4",
    "tsup": "^8.3.5",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
```

- [ ] **Step 5: Extend `src/scaffold.test.ts`'s file-existence assertions**

In the `'copies all template files into a new target directory, replacing {{projectName}}'` test in `src/scaffold.test.ts` (from Task 1), add these two assertions right after the existing `baseCommandTs` assertion:

```ts
    const helloTs = await readFile(path.join(targetDir, 'src', 'commands', 'hello.ts'), 'utf8');
    expect(helloTs).toContain('export default class Hello extends BaseCommand');

    const helloTestTs = await readFile(path.join(targetDir, 'src', 'commands', 'hello.test.ts'), 'utf8');
    expect(helloTestTs).toContain("runCommand('hello')");
```

- [ ] **Step 6: Run clispark's own test suite**

Run: `npx vitest run src/scaffold.test.ts`
Expected: PASS (6 tests, same count as Task 1 — these are new assertions inside the existing first test, not new `it()` blocks)

- [ ] **Step 7: Commit**

```bash
git add templates/base/src/commands/hello.ts templates/base/src/commands/hello.test.ts templates/base/vitest.config.ts templates/base/package.json src/scaffold.test.ts
git commit -m "feat: add example hello command with oclif test tooling"
```

---

### Task 3: Manual End-to-End Verification

**Files:**
- None (verification only — no source changes)

**Interfaces:**
- None

- [ ] **Step 1: Scaffold a real project, bypassing the wizard's TTY-only prompts**

Same approach as Milestones 1-2's manual verification — calls the real `scaffoldProject` directly against a real temp directory, exercising the real `git`/`npm install`/`npm run build` pipeline. Multi-line `tsx -e "..."` strings have proven unreliable on this Windows/Git-Bash setup (silent no-op in Milestone 2's manual verification) — write the script to a file in the repo root instead, run it with `npx tsx <file>`, then delete it:

```bash
cat > m3-verify.mjs << 'EOF'
import { scaffoldProject } from './src/scaffold.js';
import path from 'node:path';
import os from 'node:os';

const targetDir = path.join(os.tmpdir(), 'clispark-m3-verify', 'm3-test-cli');
await scaffoldProject({ projectName: 'm3-test-cli', targetDir });
console.log('scaffold complete:', targetDir);
EOF
npx tsx m3-verify.mjs
rm m3-verify.mjs
```

Expected: prints `scaffold complete: <path>`; real `git init`/`add`/`commit` and `npm install`/`npm run build` output visible, all succeeding (this uses real network access and takes a minute or two — `@oclif/core`, `@oclif/test`, `pino`, `env-paths` are new dependencies being installed for the first time in a generated project).

- [ ] **Step 2: Run the generated project's own test suite**

Run (`cd` into the path printed by Step 1):

```bash
cd "$(node -e "console.log(require('os').tmpdir())")/clispark-m3-verify/m3-test-cli"
npm test
```

Expected: `pretest` runs `npm run build` first (confirming the pretest→build→test chain works), then `vitest run` executes `src/commands/hello.test.ts`, which PASSES with real stdout capture (confirming `disableConsoleIntercept: true` fixes the empty-stdout bug for real, not just in clispark's own scratch testing). No `UnparsedCommand` warning should appear.

- [ ] **Step 3: Run the built `hello` command directly**

Run (from inside the generated project directory):

```bash
node bin/run.js hello
```

Expected: prints `Hello from your new CLI!`, exits with code 0, no warnings, no errors.

- [ ] **Step 4: Verify logging happened for the successful run**

Run (find the log directory via `env-paths` semantics — on most systems this is under the OS's standard app-log location; the exact command below asks Node to compute it the same way `env-paths` does). Note: `env-paths` is an ESM-only package (`"type": "module"`), so `require('env-paths')` does not work directly here — use dynamic `import()`:

```bash
node -e "import('env-paths').then((m) => console.log(m.default('m3-test-cli', { suffix: '' }).log))"
```

(Run this from inside the generated project directory so it resolves `env-paths` from that project's own `node_modules`.) Then list that directory and read the newest `hello-*.log` file. Expected: contains JSON lines with `"msg":"started"` and `"msg":"completed"`, both with `"command":"hello"`.

- [ ] **Step 5: Verify the failure path — add a deliberately-failing command, rebuild, run it**

Run (creates a throwaway command inside the generated project to exercise `BaseCommand.catch()`):

```bash
cat > src/commands/boom.ts << 'EOF'
import { BaseCommand } from '../base-command.js';

export default class Boom extends BaseCommand {
  static description = 'Deliberately throws, for M3 manual verification';
  static args = {};
  static flags = {};

  async run(): Promise<void> {
    await this.parse(Boom);
    throw new Error('deliberate-m3-verification-error');
  }
}
EOF
npm run build
node bin/run.js boom
echo "exit code: $?"
```

Expected: terminal shows oclif's own clean `    Error: deliberate-m3-verification-error` with **no raw stack trace**, exit code 1 (non-zero). Then read the newest `boom-*.log` file in the same log directory as Step 4 (substitute `boom` for `hello` in the `env-paths`-based lookup) — expected: contains a JSON line with `"msg":"failed"`, `"command":"boom"`, and an `err` field with `"stack"` containing the full stack trace.

- [ ] **Step 6: Clean up all manual-verification artifacts**

Remove: the scaffolded project directory (`<os-tmpdir>/clispark-m3-verify`), and the log directory found in Steps 4-5 (`env-paths('m3-test-cli', { suffix: '' }).log`'s parent tree, e.g. the whole `m3-test-cli` log namespace) — none of this is part of the repo, all of it is scratch output from this verification.

- [ ] **Step 7: No commit needed for this task** (verification only; if any of Steps 1-5 reveal a bug, fix it in Tasks 1-2's files, re-run the relevant clispark unit tests, then re-do this verification from Step 1).

---

### Task 4: Push to GitHub

**Files:**
- None (repository-level operation only)

**Interfaces:**
- None

- [ ] **Step 1: Verify remote and branch**

Run: `git remote -v && git branch --show-current`
Expected: `origin` points to `git@github.com:martinwichner/clispark.git`.

- [ ] **Step 2: Push**

Run: `git push`
Expected: pushes all M3 commits.

- [ ] **Step 3: Verify on GitHub**

Run: `git log --oneline -1` and compare against the GitHub repo's latest commit to confirm the push landed.
