# clispark M2: Project Scaffold Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the scaffold engine that turns a completed wizard answer (from M1) into a real, buildable, git-initialized oclif project on disk — Milestone 2 from `project-ideas/clispark.plan.md`. M2 deliberately produces a **command-less** oclif skeleton (valid, builds, `--help` shows an empty command list). Auto-registration, logging, error handling, and the first example command are entirely M3's job.

**Architecture:** A bundled `templates/base/` directory inside the `clispark` package ships the exact files a generated project needs (package.json, tsconfig.json, tsup.config.ts, vitest.config.ts, gitignore, bin/run.js, src/index.ts, README.md), using a `{{projectName}}` placeholder. `src/scaffold.ts` exposes `copyTemplate()` (pure file-copy + placeholder replace, tested against real temp directories) and `scaffoldProject()` (copies the template, then runs `git init`/`add`/`commit` and `npm install`/`npm run build` via an injectable `runCommand` dependency, mirroring the `WizardDeps` pattern from M1). `src/cli.ts`'s action handler calls `scaffoldProject()` after `runWizard()` instead of just logging the answers.

**Tech Stack:** Same as M1 (TypeScript ESM, tsup, vitest, Node.js >=18) plus, for the *generated* project only: `@oclif/core`, `@oclif/plugin-help`.

## Global Constraints

- Project language is English: all code, identifiers, comments, docs, and generated-project copy are in English.
- M2 scope boundary: the generated project has **no** `src/commands/` content, no logging, no custom error handling — it is a valid, buildable, empty oclif CLI. Do not add a placeholder command; that belongs to M3.
- Target directory: a new subdirectory of the current working directory, named after `projectName`. If it already exists and is non-empty, abort with a clear error naming the path. If it doesn't exist, or exists and is empty, proceed.
- After scaffolding files: run `git init`, `git add -A`, `git commit` automatically — then `npm install` **and** `npm run build` automatically (not just install). The generated project must be immediately runnable (`node bin/run.js --help` works) without the user doing anything manual.
- Template mechanism: a single bundled `templates/base/` directory shipped inside the `clispark` package, copied verbatim except for a literal `{{projectName}}` string replacement in `package.json` and `README.md`. No templating library/dependency.
- Generated project's tech choices (deliberately diverging from oclif's own default generator, verified against a real `oclif generate` reference run on 2026-07-10): **tsup** (not `tsc -b`) as build tool, with `entry: ['src/index.ts', 'src/commands/**/*.ts']` already prepared for M3; **vitest** (not mocha) as test framework; no eslint/prettier/CI workflow files (out of scope); dependencies limited to `@oclif/core` + `@oclif/plugin-help` (no `@oclif/plugin-plugins` — YAGNI); no `bin/dev.js` in M2 (not useful without commands yet, added in M3); no `oclif.manifest.json` prepack step (deferred, not needed for a working M2).
- Shell commands (git, npm) in the scaffold engine must go through an injectable dependency (`ScaffoldDeps.runCommand`) so unit tests never spawn real subprocesses. File-copy and placeholder-replacement logic uses real `node:fs/promises` calls against real temporary directories in tests (fast, no network) — it does not need mocking.
- The only place a *real* `npm install`/`npm run build`/`git` invocation happens is a manual, one-time verification step during implementation (Task 4) — never inside the automated `vitest` suite.

---

### Task 1: Bundle Project Templates

**Files:**
- Create: `templates/base/package.json`
- Create: `templates/base/tsconfig.json`
- Create: `templates/base/tsup.config.ts`
- Create: `templates/base/vitest.config.ts`
- Create: `templates/base/gitignore` (no leading dot — renamed to `.gitignore` at copy time by `src/scaffold.ts` in Task 2, so it isn't mistaken for clispark's own `.gitignore` while browsing this repo)
- Create: `templates/base/README.md`
- Create: `templates/base/bin/run.js`
- Create: `templates/base/src/index.ts`
- Modify: `package.json` (add `"templates"` to the `"files"` array so it ships when clispark is published)

**Interfaces:**
- Produces: the on-disk template tree consumed by `copyTemplate()` in Task 2, rooted at `templates/base/` relative to the `clispark` package root.

- [ ] **Step 1: Write `templates/base/package.json`**

```json
{
  "name": "{{projectName}}",
  "version": "0.0.0",
  "description": "",
  "type": "module",
  "bin": {
    "{{projectName}}": "./bin/run.js"
  },
  "files": [
    "bin",
    "dist"
  ],
  "engines": {
    "node": ">=18"
  },
  "oclif": {
    "bin": "{{projectName}}",
    "dirname": "{{projectName}}",
    "commands": "./dist/commands",
    "topicSeparator": " ",
    "plugins": [
      "@oclif/plugin-help"
    ]
  },
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
}
```

- [ ] **Step 2: Write `templates/base/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "outDir": "dist",
    "types": ["node"]
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Write `templates/base/tsup.config.ts`**

```ts
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/commands/**/*.ts'],
  format: ['esm'],
  target: 'node18',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
});
```

- [ ] **Step 4: Write `templates/base/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
  },
});
```

- [ ] **Step 5: Write `templates/base/gitignore`**

```
node_modules
dist
*.log
```

- [ ] **Step 6: Write `templates/base/README.md`**

```markdown
# {{projectName}}

Generated with [clispark](https://github.com/martinwichner/clispark).
```

- [ ] **Step 7: Write `templates/base/bin/run.js`**

```js
#!/usr/bin/env node

import { execute } from '@oclif/core';

await execute({ dir: import.meta.url });
```

- [ ] **Step 8: Write `templates/base/src/index.ts`**

```ts
export { run } from '@oclif/core';
```

- [ ] **Step 9: Add `templates` to clispark's own `package.json` `files` array**

In `package.json`, change:

```json
  "files": [
    "dist",
    "LICENSE",
    "README.md"
  ],
```

to:

```json
  "files": [
    "dist",
    "templates",
    "LICENSE",
    "README.md"
  ],
```

- [ ] **Step 10: Sanity-check the templated JSON files parse correctly**

Run: `node -e "JSON.parse(require('fs').readFileSync('templates/base/package.json','utf8').replaceAll('{{projectName}}','test-cli'))" && echo OK`
Expected: prints `OK` (confirms the placeholder substitution still yields valid JSON).

- [ ] **Step 11: Commit**

```bash
git add templates package.json
git commit -m "feat: add bundled project template for M2 scaffold engine"
```

---

### Task 2: Template Copy + Placeholder Replacement

**Files:**
- Create: `src/scaffold.ts`
- Test: `src/scaffold.test.ts`

**Interfaces:**
- Produces:
  - `interface ScaffoldOptions { projectName: string; targetDir: string }`
  - `async function copyTemplate(options: ScaffoldOptions): Promise<void>` — throws `Error` if `targetDir` exists and is non-empty
  - Consumed by `scaffoldProject()` in Task 3 (same file) and, transitively, by `src/cli.ts` in Task 4.

- [ ] **Step 1: Write the failing test**

```ts
// src/scaffold.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { copyTemplate } from './scaffold.js';

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/scaffold.test.ts`
Expected: FAIL — `Cannot find module './scaffold.js'`, since `src/scaffold.ts` doesn't exist yet.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/scaffold.ts
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { cp, readdir, readFile, rename, writeFile } from 'node:fs/promises';

export interface ScaffoldOptions {
  projectName: string;
  targetDir: string;
}

const TEMPLATE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'base');

async function assertTargetDirIsUsable(targetDir: string): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(targetDir);
  } catch {
    return;
  }
  if (entries.length > 0) {
    throw new Error(`Directory "${targetDir}" already exists and is not empty.`);
  }
}

async function replacePlaceholder(filePath: string, projectName: string): Promise<void> {
  const content = (await readFile(filePath, 'utf8')).replaceAll('{{projectName}}', projectName);
  await writeFile(filePath, content);
}

export async function copyTemplate(options: ScaffoldOptions): Promise<void> {
  const { projectName, targetDir } = options;

  await assertTargetDirIsUsable(targetDir);
  await cp(TEMPLATE_DIR, targetDir, { recursive: true });

  await rename(path.join(targetDir, 'gitignore'), path.join(targetDir, '.gitignore'));

  await replacePlaceholder(path.join(targetDir, 'package.json'), projectName);
  await replacePlaceholder(path.join(targetDir, 'README.md'), projectName);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/scaffold.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/scaffold.ts src/scaffold.test.ts
git commit -m "feat: add template copy and placeholder replacement"
```

---

### Task 3: Scaffold Orchestration (git + npm)

**Files:**
- Modify: `src/scaffold.ts` (add `scaffoldProject` alongside the existing `copyTemplate`)
- Modify: `src/scaffold.test.ts` (add tests for `scaffoldProject`)

**Interfaces:**
- Consumes: `copyTemplate`, `ScaffoldOptions` (same file, Task 2)
- Produces:
  - `interface ScaffoldDeps { runCommand: (command: string, args: string[], cwd: string) => Promise<void> }`
  - `async function scaffoldProject(options: ScaffoldOptions, deps?: ScaffoldDeps): Promise<void>` — consumed by `src/cli.ts` in Task 4

- [ ] **Step 1: Write the failing test**

Replace the entire contents of `src/scaffold.test.ts` with the following (it's the Task 2 file plus a new `describe('scaffoldProject', ...)` block, and `vi` added to the `vitest` import):

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

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/scaffold.test.ts`
Expected: FAIL — `scaffoldProject is not defined` / import error, since `scaffoldProject` doesn't exist yet.

- [ ] **Step 3: Write minimal implementation**

Replace the entire contents of `src/scaffold.ts` with the following (it's the Task 2 file plus the new `ScaffoldDeps`/`scaffoldProject` exports, and a `node:child_process` import added):

```ts
// src/scaffold.ts
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { cp, readdir, readFile, rename, writeFile } from 'node:fs/promises';

export interface ScaffoldOptions {
  projectName: string;
  targetDir: string;
}

const TEMPLATE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'base');

async function assertTargetDirIsUsable(targetDir: string): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(targetDir);
  } catch {
    return;
  }
  if (entries.length > 0) {
    throw new Error(`Directory "${targetDir}" already exists and is not empty.`);
  }
}

async function replacePlaceholder(filePath: string, projectName: string): Promise<void> {
  const content = (await readFile(filePath, 'utf8')).replaceAll('{{projectName}}', projectName);
  await writeFile(filePath, content);
}

export async function copyTemplate(options: ScaffoldOptions): Promise<void> {
  const { projectName, targetDir } = options;

  await assertTargetDirIsUsable(targetDir);
  await cp(TEMPLATE_DIR, targetDir, { recursive: true });

  await rename(path.join(targetDir, 'gitignore'), path.join(targetDir, '.gitignore'));

  await replacePlaceholder(path.join(targetDir, 'package.json'), projectName);
  await replacePlaceholder(path.join(targetDir, 'README.md'), projectName);
}

export interface ScaffoldDeps {
  runCommand: (command: string, args: string[], cwd: string) => Promise<void>;
}

async function defaultRunCommand(command: string, args: string[], cwd: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Command "${command} ${args.join(' ')}" exited with code ${code}`));
      }
    });
  });
}

const defaultScaffoldDeps: ScaffoldDeps = { runCommand: defaultRunCommand };

export async function scaffoldProject(
  options: ScaffoldOptions,
  deps: ScaffoldDeps = defaultScaffoldDeps,
): Promise<void> {
  await copyTemplate(options);

  const { targetDir } = options;
  await deps.runCommand('git', ['init'], targetDir);
  await deps.runCommand('git', ['add', '-A'], targetDir);
  await deps.runCommand('git', ['commit', '-m', 'chore: initial scaffold from clispark'], targetDir);
  await deps.runCommand('npm', ['install'], targetDir);
  await deps.runCommand('npm', ['run', 'build'], targetDir);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/scaffold.test.ts`
Expected: PASS (6 tests total: 4 from `copyTemplate`, 2 from `scaffoldProject`)

- [ ] **Step 5: Commit**

```bash
git add src/scaffold.ts src/scaffold.test.ts
git commit -m "feat: add scaffold orchestration (git init/commit, npm install/build)"
```

---

### Task 4: CLI Integration + Manual End-to-End Verification

**Files:**
- Modify: `src/cli.ts`

**Interfaces:**
- Consumes: `scaffoldProject` from `./scaffold.js` (Task 3)

- [ ] **Step 1: Modify `src/cli.ts`**

Change:

```ts
import { createRequire } from 'node:module';
import { Command } from 'commander';
import { runWizard } from './wizard.js';
```

to:

```ts
import { createRequire } from 'node:module';
import path from 'node:path';
import { Command } from 'commander';
import { runWizard } from './wizard.js';
import { scaffoldProject } from './scaffold.js';
```

Change:

```ts
program.action(async () => {
  const answers = await runWizard();
  console.log('\nCollected wizard answers:');
  console.log(JSON.stringify(answers, null, 2));
});
```

to:

```ts
program.action(async () => {
  const answers = await runWizard();
  const targetDir = path.join(process.cwd(), answers.projectName);

  await scaffoldProject({ projectName: answers.projectName, targetDir });

  console.log(`\nDone! Your new CLI project is ready at ${targetDir}`);
});
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: succeeds, produces `dist/cli.js`.

- [ ] **Step 4: Manual end-to-end verification (bypasses the wizard's TTY-only prompts, exercises the real scaffold engine directly)**

Run (adjust the temp path for your OS if needed; this uses a fixed subfolder under the OS temp dir so it's easy to inspect and clean up):

```bash
npx tsx -e "
import { scaffoldProject } from './src/scaffold.js';
import path from 'node:path';
import os from 'node:os';

const targetDir = path.join(os.tmpdir(), 'clispark-manual-verify', 'manual-test-cli');
await scaffoldProject({ projectName: 'manual-test-cli', targetDir });
console.log('scaffold complete:', targetDir);
"
```

Expected: prints `scaffold complete: <path>`, with real `git init`/`add`/`commit` and `npm install`/`npm run build` output visible (this uses real network access and takes a minute).

- [ ] **Step 5: Verify the generated project actually runs**

Run (`cd` into the path printed by Step 4, e.g.):

```bash
cd "$(node -e "console.log(require('os').tmpdir())")/clispark-manual-verify/manual-test-cli"
node bin/run.js --help
```

Expected: oclif's standard help output (USAGE, COMMANDS section — empty, since M2 has no commands yet — TOPICS, etc.), no stack trace, no error.

- [ ] **Step 6: Clean up the manual verification directory**

Run: remove `<os-tmpdir>/clispark-manual-verify` recursively (e.g. `rm -rf "$(node -e "console.log(require('os').tmpdir())")/clispark-manual-verify"` on a POSIX shell, or the equivalent on your platform). This is scratch output from Step 4/5, not part of the repo — do not leave it behind.

- [ ] **Step 7: Commit**

```bash
git add src/cli.ts
git commit -m "feat: wire scaffold engine into CLI action"
```

---

### Task 5: Push to GitHub

**Files:**
- None (repository-level operation only)

**Interfaces:**
- None

- [ ] **Step 1: Verify remote and branch**

Run: `git remote -v && git branch --show-current`
Expected: `origin` points to `git@github.com:martinwichner/clispark.git`.

- [ ] **Step 2: Push**

Run: `git push`
Expected: pushes all M2 commits.

- [ ] **Step 3: Verify on GitHub**

Run: `git log --oneline -1` and compare against the GitHub repo's latest commit to confirm the push landed.
