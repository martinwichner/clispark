# Post-Scaffold Hooks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user (or company) configure a single global `post-scaffold.mjs` file that clispark runs automatically after every new project finishes scaffolding, plus a `clispark hook` command to discover the right file location and a `--no-hook` opt-out.

**Architecture:** A new `src/hooks.ts` module resolves the OS-appropriate hook path (via the `env-paths` dependency already used for logging) and, if a file exists there, dynamically `import()`s it and calls its default export with a context object — all wrapped in error handling that warns clearly but never fails the scaffold. A new type-only `src/index.ts` gives hook authors `PostScaffoldHookContext`/`PostScaffoldHook` types via clispark's `package.json` `"types"` field. `src/cli.ts` gains a `hook` command and wires the hook call into the existing scaffold action, at the same call site as the existing confetti call.

**Tech Stack:** Reuses everything already in the repo — `env-paths` (already a dependency), `node:fs`/`node:path`/`node:url` built-ins. No new dependencies.

## Global Constraints

- Design spec: `docs/superpowers/specs/2026-07-21-post-scaffold-hooks-design.md` — read it for full rationale; this plan implements it as written.
- Hooks fire **only** after a fresh scaffold (the root `clispark` action) — never after `clispark update` or `clispark add`.
- Hook path: `<envPaths('clispark', { suffix: '' }).config>/hooks/post-scaffold.mjs`. Verified for real on this project's dev machine (Windows): resolves to `C:\Users\<user>\AppData\Roaming\clispark\Config\hooks\post-scaffold.mjs`. Per `env-paths`' own documented behavior: Linux → `~/.config/clispark/hooks/post-scaffold.mjs`, macOS → `~/Library/Preferences/clispark/hooks/post-scaffold.mjs`.
- If the file doesn't exist: **completely silent**, no output, no log line. This is the default case for the overwhelming majority of users.
- If it exists: dynamically `import()`ed in-process (verified for real, including through esbuild/tsup bundling — the pattern `import(pathToFileURL(hookPath).href)` survives bundling untouched since the argument isn't statically analyzable), its `default` export (must be a function, sync or async) is called with exactly one argument: `{ projectName, targetDir, language, registryUrl, publishIntent }`. Return value is ignored.
- Any hook failure (file doesn't parse as valid ESM, no function default export, the function throws/rejects) is caught and reported as a **clear, visible console warning** — the scaffold has already succeeded by the time the hook runs, so nothing about the generated project is affected by a hook failure.
- New `--no-hook` flag on the root `program` only (not global via `optsWithGlobals()` — unlike `--no-confetti`, this flag is never needed by any other command, so it's declared and read directly on the root action).
- `src/index.ts` is a type-only library entry point — zero runtime logic, exists purely so `dist/index.d.ts` can be generated and shipped via `package.json`'s new `"types"` field. Verified for real: `dist/index.js` builds to essentially nothing but the shebang banner (harmless — verified that a leading shebang line does not break dynamically importing or requiring an ESM module), and `import type { PostScaffoldHookContext, PostScaffoldHook } from 'clispark'` resolves and typechecks cleanly from a real external project with clispark installed via `npm pack`.
- Every task ends in a state where `npx tsc --noEmit`, `npx eslint src scripts`, and `npx vitest run` all pass in the clispark repo root.
- Every new TypeScript file follows this project's existing DI convention (see `src/wizard.ts`'s `WizardDeps`/`defaultDeps` pattern for the exact shape to mirror: an exported `XDeps` interface, a `defaultDeps` constant, the consuming function takes `deps: XDeps = defaultDeps` as its last parameter).

---

## File Structure

```
src/
  index.ts              # CREATE — PostScaffoldHookContext, PostScaffoldHook types only, no runtime logic
  hooks.ts               # CREATE — getPostScaffoldHookPath(), runPostScaffoldHook()
  hooks.test.ts           # CREATE
  cli.ts                  # MODIFY — new `hook` command; --no-hook flag + runPostScaffoldHook call in the default action
tsup.config.ts            # MODIFY — second entry for src/index.ts with scoped .d.ts output
package.json              # MODIFY — "types" field
README.md                 # MODIFY — new "Post-scaffold hooks" section
```

---

### Task 1: `src/index.ts` — type-only library entry point

**Files:**
- Create: `src/index.ts`

**Interfaces:**
- Produces: `PostScaffoldHookContext`, `PostScaffoldHook`.

- [ ] **Step 1: Create the file**

Create `src/index.ts`:

```ts
// src/index.ts
export interface PostScaffoldHookContext {
  projectName: string;
  targetDir: string;
  language: string;
  registryUrl?: string;
  publishIntent?: boolean;
}

export type PostScaffoldHook = (context: PostScaffoldHookContext) => void | Promise<void>;
```

This file has no runtime logic (pure type declarations compile to nothing) — there is no TDD step here. It is verified for real in Task 6 by building the package and consuming the type from an external project.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean (this file introduces no new errors; nothing imports it yet).

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: add type-only library entry point for hook authors"
```

---

### Task 2: `src/hooks.ts` — hook path resolution and execution

**Files:**
- Create: `src/hooks.ts`
- Test: `src/hooks.test.ts`

**Interfaces:**
- Consumes: `PostScaffoldHookContext` (Task 1, `src/index.ts`).
- Produces: `getPostScaffoldHookPath(configDir?: string): string`, `HooksDeps` interface, `runPostScaffoldHook(context: PostScaffoldHookContext, hookPath?: string, deps?: HooksDeps): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

Create `src/hooks.test.ts`:

```ts
// src/hooks.test.ts
import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import { getPostScaffoldHookPath, runPostScaffoldHook, type HooksDeps } from './hooks';
import type { PostScaffoldHookContext } from './index';

describe('getPostScaffoldHookPath', () => {
  it('joins the given config dir with hooks/post-scaffold.mjs', () => {
    const result = getPostScaffoldHookPath('/some/config/dir');
    expect(result).toBe(path.join('/some/config/dir', 'hooks', 'post-scaffold.mjs'));
  });
});

describe('runPostScaffoldHook', () => {
  const context: PostScaffoldHookContext = {
    projectName: 'demo',
    targetDir: '/tmp/demo',
    language: 'node',
    registryUrl: undefined,
    publishIntent: true,
  };
  const hookPath = '/fake/hooks/post-scaffold.mjs';

  function makeDeps(overrides: Partial<HooksDeps> = {}): { deps: HooksDeps; warnCalls: string[] } {
    const warnCalls: string[] = [];
    const deps: HooksDeps = {
      fileExists: vi.fn(() => true),
      importHookModule: vi.fn(async () => ({ default: vi.fn() })),
      warn: (message: string) => warnCalls.push(message),
      ...overrides,
    };
    return { deps, warnCalls };
  }

  it('does nothing when the hook file does not exist', async () => {
    const { deps, warnCalls } = makeDeps({ fileExists: vi.fn(() => false) });

    await runPostScaffoldHook(context, hookPath, deps);

    expect(deps.importHookModule).not.toHaveBeenCalled();
    expect(warnCalls).toEqual([]);
  });

  it('imports the hook via a file:// URL and calls its default export with the context', async () => {
    const defaultFn = vi.fn();
    const { deps, warnCalls } = makeDeps({ importHookModule: vi.fn(async () => ({ default: defaultFn })) });

    await runPostScaffoldHook(context, hookPath, deps);

    expect(deps.importHookModule).toHaveBeenCalledWith('file:///fake/hooks/post-scaffold.mjs');
    expect(defaultFn).toHaveBeenCalledWith(context);
    expect(warnCalls).toEqual([]);
  });

  it('awaits an async default export before completing', async () => {
    let resolved = false;
    const defaultFn = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 1));
      resolved = true;
    });
    const { deps } = makeDeps({ importHookModule: vi.fn(async () => ({ default: defaultFn })) });

    await runPostScaffoldHook(context, hookPath, deps);

    expect(resolved).toBe(true);
  });

  it('warns clearly and does not throw when the default export is missing', async () => {
    const { deps, warnCalls } = makeDeps({ importHookModule: vi.fn(async () => ({})) });

    await expect(runPostScaffoldHook(context, hookPath, deps)).resolves.toBeUndefined();

    expect(warnCalls).toHaveLength(1);
    expect(warnCalls[0]).toContain('Post-scaffold hook failed');
    expect(warnCalls[0]).toContain('default export');
    expect(warnCalls[0]).toContain('still created successfully');
  });

  it('warns clearly and does not throw when the default export is not a function', async () => {
    const { deps, warnCalls } = makeDeps({ importHookModule: vi.fn(async () => ({ default: 'not a function' })) });

    await runPostScaffoldHook(context, hookPath, deps);

    expect(warnCalls).toHaveLength(1);
    expect(warnCalls[0]).toContain('Post-scaffold hook failed');
  });

  it('warns clearly and does not throw when the import itself throws (e.g. invalid ESM syntax)', async () => {
    const { deps, warnCalls } = makeDeps({
      importHookModule: vi.fn(async () => {
        throw new SyntaxError('Unexpected identifier');
      }),
    });

    await runPostScaffoldHook(context, hookPath, deps);

    expect(warnCalls).toHaveLength(1);
    expect(warnCalls[0]).toContain('Unexpected identifier');
    expect(warnCalls[0]).toContain('still created successfully');
  });

  it('warns clearly and does not throw when the hook function itself throws', async () => {
    const defaultFn = vi.fn(() => {
      throw new Error('boom');
    });
    const { deps, warnCalls } = makeDeps({ importHookModule: vi.fn(async () => ({ default: defaultFn })) });

    await runPostScaffoldHook(context, hookPath, deps);

    expect(warnCalls).toHaveLength(1);
    expect(warnCalls[0]).toContain('boom');
  });

  it('warns clearly and does not throw when the hook function rejects', async () => {
    const defaultFn = vi.fn(async () => {
      throw new Error('async boom');
    });
    const { deps, warnCalls } = makeDeps({ importHookModule: vi.fn(async () => ({ default: defaultFn })) });

    await runPostScaffoldHook(context, hookPath, deps);

    expect(warnCalls).toHaveLength(1);
    expect(warnCalls[0]).toContain('async boom');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/hooks.test.ts`
Expected: FAIL — `Cannot find module './hooks'`

- [ ] **Step 3: Implement `src/hooks.ts`**

Create `src/hooks.ts`:

```ts
// src/hooks.ts
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import envPaths from 'env-paths';
import type { PostScaffoldHookContext } from './index';

export function getPostScaffoldHookPath(
  configDir: string = envPaths('clispark', { suffix: '' }).config,
): string {
  return path.join(configDir, 'hooks', 'post-scaffold.mjs');
}

export interface HooksDeps {
  fileExists: (p: string) => boolean;
  importHookModule: (fileUrl: string) => Promise<{ default?: unknown }>;
  warn: (message: string) => void;
}

const defaultDeps: HooksDeps = {
  fileExists: existsSync,
  importHookModule: (fileUrl) => import(fileUrl),
  warn: (message) => console.warn(message),
};

function warnHookFailed(deps: HooksDeps, detail: string): void {
  deps.warn(
    `⚠ Post-scaffold hook failed: ${detail}\n  Your project was still created successfully — this only affects the optional hook.`,
  );
}

export async function runPostScaffoldHook(
  context: PostScaffoldHookContext,
  hookPath: string = getPostScaffoldHookPath(),
  deps: HooksDeps = defaultDeps,
): Promise<void> {
  if (!deps.fileExists(hookPath)) {
    return;
  }

  try {
    const mod = await deps.importHookModule(pathToFileURL(hookPath).href);
    if (typeof mod.default !== 'function') {
      throw new Error('post-scaffold.mjs must have a default export that is a function');
    }
    await (mod.default as (ctx: PostScaffoldHookContext) => unknown)(context);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    warnHookFailed(deps, detail);
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/hooks.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Full verification and commit**

Run: `npx tsc --noEmit && npx eslint src scripts && npx vitest run`
Expected: all pass.

```bash
git add src/hooks.ts src/hooks.test.ts
git commit -m "feat: add post-scaffold hook resolution and execution"
```

---

### Task 3: Wire hooks into `src/cli.ts`

**Files:**
- Modify: `src/cli.ts`

**Interfaces:**
- Consumes: `getPostScaffoldHookPath`, `runPostScaffoldHook` (Task 2, `src/hooks.ts`).

- [ ] **Step 1: Add the imports**

Edit `src/cli.ts` — add near the other local imports (after the `printConfetti` import):

```ts
import { getPostScaffoldHookPath, runPostScaffoldHook } from './hooks';
import { existsSync } from 'node:fs';
```

- [ ] **Step 2: Add the `--no-hook` flag to the root program**

Edit `src/cli.ts` — the root `program` currently declares (verify this exact block still matches before editing; if it has drifted, apply the same addition to whatever the current option-chain looks like):

```ts
program
  .name('clispark')
  .description('Interactive scaffolding tool for new CLI projects')
  .option('--no-confetti', 'Skip the confetti after a successful run')
  .configureHelp({ showGlobalOptions: true })
  .version(getGeneratorVersion());
```

Add a `.option('--no-hook', ...)` line:

```ts
program
  .name('clispark')
  .description('Interactive scaffolding tool for new CLI projects')
  .option('--no-confetti', 'Skip the confetti after a successful run')
  .option('--no-hook', 'Skip the post-scaffold hook, even if one is configured')
  .configureHelp({ showGlobalOptions: true })
  .version(getGeneratorVersion());
```

- [ ] **Step 3: Call the hook after scaffold succeeds**

Edit `src/cli.ts` — the root action currently reads:

```ts
program.action((options: { confetti?: boolean }) =>
  withLogging('scaffold', async (logger) => {
    const answers = await runWizard();
    const targetDir = path.join(process.cwd(), answers.projectName);
    const pack = resolvePack(answers.language);

    logger.info({ projectName: answers.projectName, targetDir, language: pack.id }, 'scaffold started');
    await scaffoldProject(
      {
        projectName: answers.projectName,
        targetDir,
        registryUrl: answers.registryUrl,
        publishIntent: answers.publishIntent,
      },
      pack,
    );
    logger.info({ projectName: answers.projectName }, 'scaffold completed');

    console.log(`\nDone! Your new CLI project is ready at ${targetDir}`);
    if (options.confetti !== false) printConfetti();
  })(),
);
```

Replace it with (adds the `hook` field to the options type, and calls `runPostScaffoldHook` between the "Done!" message and confetti — so any hook warning is visible before the celebratory confetti):

```ts
program.action((options: { confetti?: boolean; hook?: boolean }) =>
  withLogging('scaffold', async (logger) => {
    const answers = await runWizard();
    const targetDir = path.join(process.cwd(), answers.projectName);
    const pack = resolvePack(answers.language);

    logger.info({ projectName: answers.projectName, targetDir, language: pack.id }, 'scaffold started');
    await scaffoldProject(
      {
        projectName: answers.projectName,
        targetDir,
        registryUrl: answers.registryUrl,
        publishIntent: answers.publishIntent,
      },
      pack,
    );
    logger.info({ projectName: answers.projectName }, 'scaffold completed');

    console.log(`\nDone! Your new CLI project is ready at ${targetDir}`);

    if (options.hook !== false) {
      await runPostScaffoldHook({
        projectName: answers.projectName,
        targetDir,
        language: pack.id,
        registryUrl: answers.registryUrl,
        publishIntent: answers.publishIntent,
      });
    }

    if (options.confetti !== false) printConfetti();
  })(),
);
```

- [ ] **Step 4: Add the `hook` command**

Edit `src/cli.ts` — add a new command registration, placed after the existing `whoami` command block (at the end of the command registrations, before `program.parseAsync(...)`):

```ts
program
  .command('hook')
  .description('Show the post-scaffold hook file location and whether one is configured')
  .action(() =>
    withLogging('hook', async (logger) => {
      const hookPath = getPostScaffoldHookPath();
      const exists = existsSync(hookPath);
      logger.info({ hookPath, exists }, 'hook status checked');

      console.log('\nPost-scaffold hook\n');
      console.log(`Location: ${hookPath}`);
      if (exists) {
        console.log('Status:   found — will run after the next scaffold');
      } else {
        console.log('Status:   not found — no hook will run after the next scaffold');
        console.log(
          '\nTo add one, create that file as an ES module exporting a default function:\n\n' +
            '  export default async function postScaffold({ projectName, targetDir, language, registryUrl, publishIntent }) {\n' +
            '    // your code here\n' +
            '  }\n\n' +
            'It runs once, right after a new project finishes scaffolding.',
        );
      }
    })(),
  );
```

- [ ] **Step 5: Verify the CLI wires up correctly**

Run: `npx tsc --noEmit && npx eslint src scripts`
Expected: clean.

```bash
npx tsup
node dist/cli.js --help
```

Expected: help output lists `hook` alongside `update`/`releasenotes`/`whoami`/`add`, and `--no-hook` appears under Global Options (confirm via `node dist/cli.js hook --help` — should show `--no-hook` since `configureHelp({ showGlobalOptions: true })` is already set on the root program).

```bash
node dist/cli.js hook
```

Expected: prints the "Post-scaffold hook" block with a real OS-specific path and `Status: not found` (no hook exists yet on this machine at this point in the plan).

- [ ] **Step 6: Full verification and commit**

Run: `npx vitest run`
Expected: all pass (no new unit tests needed here — `cli.ts` is the composition root and is verified via real CLI invocation in Task 6, matching how `update`/`releasenotes`/`whoami`/`add` were wired in without their own `cli.test.ts`).

```bash
git add src/cli.ts
git commit -m "feat: wire post-scaffold hooks into the CLI (hook command, --no-hook flag)"
```

---

### Task 4: `tsup.config.ts` and `package.json` — ship the types

**Files:**
- Modify: `tsup.config.ts`
- Modify: `package.json`

**Interfaces:** none (build configuration only).

- [ ] **Step 1: Add the second build entry with scoped `.d.ts` output**

Edit `tsup.config.ts` — replace its full contents (verified for real: this produces exactly `dist/cli.js`, `dist/index.js`, and `dist/index.d.ts` — no `dist/cli.d.ts`):

```ts
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli.ts', 'src/index.ts'],
  format: ['esm'],
  target: 'node18',
  banner: { js: '#!/usr/bin/env node' },
  clean: true,
  sourcemap: true,
  dts: { entry: 'src/index.ts' },
});
```

Note: `dist/index.js` will contain nothing but the shebang banner and a sourcemap comment (verified for real — `src/index.ts` has no runtime code, since interfaces/type aliases compile to nothing). The shebang on a non-executable, `import()`-only file is harmless — verified for real that a leading `#!` line does not break dynamically importing or otherwise loading an ESM module that isn't the process entry point.

- [ ] **Step 2: Add the `"types"` field to `package.json`**

Edit `package.json` — add `"types"` right after `"bin"`:

```json
  "bin": {
    "clispark": "./dist/cli.js"
  },
  "types": "./dist/index.d.ts",
```

`"files"` already includes `"dist"`, so `dist/index.d.ts`/`dist/index.js` ship automatically without any further change there.

- [ ] **Step 3: Build and inspect the output**

```bash
npx tsup
```

Expected console output includes both `dist\cli.js` and `dist\index.js` under the ESM section, and a separate DTS section reporting `dist\index.d.ts` — no `dist\cli.d.ts` anywhere in the output.

```bash
node -e "console.log(require('fs').readdirSync('dist'))"
```

Expected: array includes `cli.js`, `index.js`, `index.d.ts` (and their `.map` files) — no `cli.d.ts`.

- [ ] **Step 4: Full verification and commit**

Run: `npx tsc --noEmit && npx eslint src scripts && npx vitest run`
Expected: all pass.

```bash
git add tsup.config.ts package.json
git commit -m "build: ship type declarations for post-scaffold hook authors"
```

---

### Task 5: Document hooks in `README.md`

**Files:**
- Modify: `README.md`

**Interfaces:** none (documentation only).

- [ ] **Step 1: Add the "Post-scaffold hooks" section**

Edit `README.md` — insert a new `## Post-scaffold hooks` section immediately after the existing `## Updating a project` section and before `## Tech stack` (i.e. right before the line `## Tech stack`):

```markdown
## Post-scaffold hooks

Right after a new project finishes scaffolding, clispark checks for a single, globally-configured hook file and runs it automatically if present — useful for anything you always want to happen after a fresh project, without answering a wizard question every time (auto-creating a GitHub repo, copying in a company-standard CI config, registering the project in an internal catalog, and so on).

```bash
npx clispark hook
```

prints the exact file location for your OS and whether one is currently configured. The location is fixed and not configurable:

| OS | Location |
|---|---|
| Linux | `~/.config/clispark/hooks/post-scaffold.mjs` (or `$XDG_CONFIG_HOME/clispark/hooks/post-scaffold.mjs`) |
| macOS | `~/Library/Preferences/clispark/hooks/post-scaffold.mjs` |
| Windows | `%APPDATA%\clispark\Config\hooks\post-scaffold.mjs` |

If the file doesn't exist, nothing happens — most users will never have one. If it exists, it must be an ES module with a default-exported function (sync or async), which receives one argument:

```js
export default async function postScaffold({ projectName, targetDir, language, registryUrl, publishIntent }) {
  // your code here
}
```

If clispark has the `clispark` package installed as a dev dependency, the shape of that argument is available as a type: `import type { PostScaffoldHookContext } from 'clispark'`.

A failing hook (throws, rejects, or doesn't export a function) prints a clear warning but never affects the outcome of the scaffold itself — your new project is already fully created by the time the hook runs. Pass `--no-hook` to skip it for a single run even if one is configured.

**Example** — push the new project to a freshly created GitHub repo:

```js
// post-scaffold.mjs
import { execFileSync } from 'node:child_process';

export default function postScaffold({ projectName, targetDir }) {
  execFileSync('gh', ['repo', 'create', projectName, '--private', '--source', targetDir, '--push'], {
    cwd: targetDir,
    stdio: 'inherit',
  });
}
```

Hooks only run after a fresh `clispark` scaffold — never after `clispark update` or `clispark add`.
```

- [ ] **Step 2: Full verification and commit**

Run: `npx tsc --noEmit && npx eslint src scripts && npx vitest run`
Expected: all pass (README changes don't affect these, but confirms the branch is still otherwise clean before this docs-only commit).

```bash
git add README.md
git commit -m "docs: document post-scaffold hooks"
```

---

### Task 6: Full manual end-to-end verification

Mirrors the verification depth of prior milestones' final task. Every piece of this task's checks were already prototyped once, standalone, before this plan was written — this task re-verifies the same things against the actual finished branch, not a throwaway sandbox.

**Files:** none (verification only).

- [ ] **Step 1: Build clispark itself**

```bash
npx tsc --noEmit && npx eslint src scripts && npx vitest run && npx tsup
```
Expected: all pass, `dist/cli.js`, `dist/index.js`, `dist/index.d.ts` all produced.

- [ ] **Step 2: `clispark hook` with no hook configured**

```bash
node dist/cli.js hook
```
Expected: prints the real OS-specific path (confirm it matches this machine's actual `env-paths` resolution) and `Status:   not found — ...` plus the contract snippet.

- [ ] **Step 3: Real E2E — a working hook actually runs**

Create the hook file at the real resolved location for this machine (substitute the actual path `clispark hook` printed in Step 2):

```bash
mkdir -p "<hook directory from Step 2's Location line>"
cat > "<Location path from Step 2>" << 'EOF'
export default function postScaffold(context) {
  console.log('POST-SCAFFOLD HOOK RAN:', JSON.stringify(context));
}
EOF
```

Then, from a scratch directory:

```bash
node <path-to-clispark-repo>/dist/cli.js
```

Answer the wizard prompts (any project name, e.g. `hook-verify-test`, any profile). Expected: after the "Done! Your new CLI project is ready at ..." line and before the confetti, a line `POST-SCAFFOLD HOOK RAN: {"projectName":"hook-verify-test","targetDir":"...","language":"node",...}` appears, with the actual answered values.

- [ ] **Step 4: `clispark hook` now reports the hook as found**

```bash
node dist/cli.js hook
```
Expected: `Status:   found — will run after the next scaffold`, no contract snippet printed.

- [ ] **Step 5: Real E2E — a broken hook warns but doesn't fail the scaffold**

Overwrite the same hook file with one that throws:

```bash
cat > "<Location path from Step 2>" << 'EOF'
export default function postScaffold() {
  throw new Error('deliberately broken for verification');
}
EOF
```

Run `node <path-to-clispark-repo>/dist/cli.js` again from a fresh scratch directory (different project name). Expected: the new project directory is fully created and runnable exactly as normal, AND a clearly visible warning appears containing `deliberately broken for verification` and `still created successfully` (the summary line, not just an internal log entry).

- [ ] **Step 6: Real E2E — `--no-hook` skips it even though one exists**

```bash
node <path-to-clispark-repo>/dist/cli.js --no-hook
```
(different project name again). Expected: no hook output at all (neither the success log line nor the broken-hook warning) — the hook file from Step 5 is still there but must not run.

- [ ] **Step 7: Real E2E — the shipped types actually resolve from an external project**

```bash
npm pack --pack-destination "$TEMP"
```

Then in a throwaway directory with its own minimal `package.json` (`{ "name": "x", "private": true, "type": "module" }`) and `tsconfig.json` (`{ "compilerOptions": { "strict": true, "module": "nodenext", "moduleResolution": "nodenext", "noEmit": true, "skipLibCheck": true } }`):

```bash
npm install --no-audit --no-fund <path-to-the-packed-tgz>
```

Create a file importing the type:

```ts
import type { PostScaffoldHookContext, PostScaffoldHook } from 'clispark';

const ctx: PostScaffoldHookContext = { projectName: 'demo', targetDir: '/tmp/demo', language: 'node' };
const hook: PostScaffoldHook = async (context) => { console.log(context.projectName); };
```

```bash
npx --yes -p typescript@5.7.2 tsc --noEmit --project tsconfig.json
```

Expected: no errors. This exact sequence was run for real while writing this plan (against the last released version before this feature) as a rehearsal for the mechanism — it must reproduce identically now that the real feature is built.

- [ ] **Step 8: Clean up**

Remove the real hook file created in Steps 3/5 (`rm "<Location path>"`), remove every throwaway scaffolded test project directory created during this task, and remove the packed `.tgz` and its throwaway consumer directory from Step 7.

- [ ] **Step 9: Update `project-ideas/clispark.plan.md`, the project's memory file, and issue #69**

Mark this feature complete with a summary (PR number, release version once shipped, any real bugs found during Steps 2-7 beyond what's already documented in this plan's Global Constraints), per this project's established convention. Update issue #69's body (not just a comment) to reflect the finished design/status, per the style agreed with the user: a `## Design` section linking this plan and the merged spec, a short "what it does" summary, and a `## Status` line — keep the original idea text below, don't delete it. Move its label from `status:backlog` to reflect completion (issue gets closed once shipped, per this project's "closed = done, no separate done label" convention).

- [ ] **Step 10: Final commit if Steps 2-8 required any fixes**

If any verification step required a code fix, commit it now with a clear message describing the real bug found and fixed.
