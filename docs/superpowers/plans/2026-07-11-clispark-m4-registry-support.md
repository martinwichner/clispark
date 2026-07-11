# clispark M4: Registry Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Milestone 4 from `project-ideas/clispark.plan.md` — make the `registryUrl` the wizard has collected since Milestone 1 actually take effect: the generated project gets an `.npmrc` pointing at it, and `scaffoldProject()`'s own automatic `npm install` picks it up as a side effect.

**Architecture:** `ScaffoldOptions` (`src/scaffold.ts`) gains an optional `registryUrl?: string` field. `copyTemplate()` writes a `.npmrc` file (`registry=<url>`) into the target directory whenever `registryUrl` is set and differs from `DEFAULT_REGISTRY_URL` (`src/registry.ts`) — otherwise no `.npmrc` is created at all, matching default npm behavior. Because npm resolves project-level `.npmrc` from the current working directory, and `scaffoldProject()` already runs `npm install`/`npm run build` with `cwd: targetDir`, no change to the install command itself is needed. `cli.ts` passes `answers.registryUrl` through to `scaffoldProject()`.

**Tech Stack:** Same as Milestones 1-3 — TypeScript, vitest, `node:fs/promises` (no new dependency).

## Global Constraints

- Project language is English (code, comments, docs, commit messages).
- Full design context: `docs/superpowers/specs/2026-07-11-clispark-m4-registry-support-design.md`.
- Descoped during brainstorming (do not implement): further profile-dependent defaults beyond `registryUrl` (no concrete need identified), and scoped-registry (`@org:registry=...`) support — this milestone only ever writes a single unscoped `registry=<url>` line.
- A `.npmrc` must never be written when `registryUrl` is absent or equals `DEFAULT_REGISTRY_URL` — this is the only thing distinguishing a "private" profile (or a "work" profile left at its default) from a "work" profile with a real custom registry.
- No changes to `runCommand`/the `npm install` invocation itself in `scaffoldProject()` — writing `.npmrc` before that call is the entire fix, per the design doc.

---

### Task 1: `.npmrc` Generation in `copyTemplate()`

**Files:**
- Modify: `src/scaffold.ts`
- Modify: `src/scaffold.test.ts`

**Interfaces:**
- Produces: `ScaffoldOptions` gains `registryUrl?: string` (consumed by `copyTemplate()` and `scaffoldProject()`, and by Task 2's `cli.ts` change)

- [ ] **Step 1: Write the failing tests**

Add these two `it` blocks inside the existing `describe('copyTemplate', ...)` block in `src/scaffold.test.ts`, right after the `'copies all template files...'` test. Also add `DEFAULT_REGISTRY_URL` to the existing import from `./registry.js` (new import line, since `scaffold.test.ts` does not currently import from `registry.js`):

```ts
import { DEFAULT_REGISTRY_URL } from './registry.js';
```

```ts
  it('writes a .npmrc with the custom registry when registryUrl differs from the default', async () => {
    const targetDir = path.join(tmpRoot, 'custom-registry');

    await copyTemplate({
      projectName: 'custom-registry',
      targetDir,
      registryUrl: 'https://registry.example.com',
    });

    const npmrc = await readFile(path.join(targetDir, '.npmrc'), 'utf8');
    expect(npmrc).toBe('registry=https://registry.example.com\n');
  });

  it('does not write a .npmrc when registryUrl is omitted or equal to the default', async () => {
    const targetDirNoUrl = path.join(tmpRoot, 'no-registry-url');
    await copyTemplate({ projectName: 'no-registry-url', targetDir: targetDirNoUrl });
    await expect(readFile(path.join(targetDirNoUrl, '.npmrc'), 'utf8')).rejects.toThrow();

    const targetDirDefaultUrl = path.join(tmpRoot, 'default-registry-url');
    await copyTemplate({
      projectName: 'default-registry-url',
      targetDir: targetDirDefaultUrl,
      registryUrl: DEFAULT_REGISTRY_URL,
    });
    await expect(readFile(path.join(targetDirDefaultUrl, '.npmrc'), 'utf8')).rejects.toThrow();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/scaffold.test.ts`
Expected: FAIL — `copyTemplate()` does not accept `registryUrl` yet and never writes `.npmrc`, so both new tests fail (first test: `.npmrc` doesn't exist; second test's assertions on rejection would actually pass by accident since no `.npmrc` is ever written yet — confirm by reading the failure output that it's specifically the first new test failing, not a type error from `ScaffoldOptions`).

- [ ] **Step 3: Modify `src/scaffold.ts`**

Add the import at the top of the file:

```ts
import { DEFAULT_REGISTRY_URL } from './registry.js';
```

Change:

```ts
export interface ScaffoldOptions {
  projectName: string;
  targetDir: string;
}
```

to:

```ts
export interface ScaffoldOptions {
  projectName: string;
  targetDir: string;
  registryUrl?: string;
}
```

Change the end of `copyTemplate()` from:

```ts
export async function copyTemplate(options: ScaffoldOptions): Promise<void> {
  const { projectName, targetDir } = options;

  await assertTargetDirIsUsable(targetDir);
  await cp(TEMPLATE_DIR, targetDir, { recursive: true });

  await rename(path.join(targetDir, 'gitignore'), path.join(targetDir, '.gitignore'));

  await replacePlaceholder(path.join(targetDir, 'package.json'), projectName);
  await replacePlaceholder(path.join(targetDir, 'README.md'), projectName);
  await replacePlaceholder(path.join(targetDir, 'src', 'logger.ts'), projectName);
}
```

to:

```ts
export async function copyTemplate(options: ScaffoldOptions): Promise<void> {
  const { projectName, targetDir, registryUrl } = options;

  await assertTargetDirIsUsable(targetDir);
  await cp(TEMPLATE_DIR, targetDir, { recursive: true });

  await rename(path.join(targetDir, 'gitignore'), path.join(targetDir, '.gitignore'));

  await replacePlaceholder(path.join(targetDir, 'package.json'), projectName);
  await replacePlaceholder(path.join(targetDir, 'README.md'), projectName);
  await replacePlaceholder(path.join(targetDir, 'src', 'logger.ts'), projectName);

  if (registryUrl && registryUrl !== DEFAULT_REGISTRY_URL) {
    await writeFile(path.join(targetDir, '.npmrc'), `registry=${registryUrl}\n`);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/scaffold.test.ts`
Expected: PASS (8 tests: 6 from Milestone 1-3 plus these 2 new ones)

- [ ] **Step 5: Commit**

```bash
git add src/scaffold.ts src/scaffold.test.ts
git commit -m "feat: write .npmrc for a non-default registry during scaffold"
```

---

### Task 2: Wire `registryUrl` Through `cli.ts`

**Files:**
- Modify: `src/cli.ts`

**Interfaces:**
- Consumes: `ScaffoldOptions.registryUrl` from Task 1, `WizardAnswers.registryUrl` (already exists, `src/types.ts`)

- [ ] **Step 1: Modify `src/cli.ts`**

Change:

```ts
    logger.info({ projectName: answers.projectName, targetDir }, 'scaffold started');
    await scaffoldProject({ projectName: answers.projectName, targetDir });
    logger.info({ projectName: answers.projectName }, 'scaffold completed');
```

to:

```ts
    logger.info({ projectName: answers.projectName, targetDir }, 'scaffold started');
    await scaffoldProject({ projectName: answers.projectName, targetDir, registryUrl: answers.registryUrl });
    logger.info({ projectName: answers.projectName }, 'scaffold completed');
```

- [ ] **Step 2: Run the full test suite**

Run: `npx vitest run`
Expected: PASS (same 8 tests as Task 1 plus the other existing suites — this change has no dedicated unit test, matching how `cli.ts`'s wiring was left untested in Milestones 2 and 3 too; it is covered by Task 3's manual verification instead)

- [ ] **Step 3: Commit**

```bash
git add src/cli.ts
git commit -m "feat: pass wizard registryUrl through to scaffoldProject"
```

---

### Task 3: Manual End-to-End Verification

**Files:**
- None (verification only — no source changes)

**Interfaces:**
- None

- [ ] **Step 1: Scaffold a real project with a custom registryUrl, bypassing the wizard's TTY-only prompts**

Same approach as Milestones 1-3's manual verification. Write the script to a file in the repo root, run it with `npx tsx`, then delete it:

```bash
cat > m4-verify.mjs << 'EOF'
import { copyTemplate } from './src/scaffold.js';
import path from 'node:path';
import os from 'node:os';

const targetDir = path.join(os.tmpdir(), 'clispark-m4-verify', 'm4-test-cli');
await copyTemplate({
  projectName: 'm4-test-cli',
  targetDir,
  registryUrl: 'https://registry.example.com',
});
console.log('copyTemplate complete:', targetDir);
EOF
npx tsx m4-verify.mjs
rm m4-verify.mjs
```

Expected: prints `copyTemplate complete: <path>`.

- [ ] **Step 2: Verify the generated `.npmrc` content**

Run:

```bash
cat "$(node -e "console.log(require('os').tmpdir())")/clispark-m4-verify/m4-test-cli/.npmrc"
```

Expected: exactly `registry=https://registry.example.com` (one line).

- [ ] **Step 3: Prove `npm install` actually reads it (not just that the file exists)**

Run `npm install` directly inside the generated directory against the fake registry from Step 1, which is unreachable, and confirm the failure is specifically about *that* URL — proving npm is reading the project's `.npmrc` rather than silently falling back to the real default registry (a fallback would instead succeed or fail against `registry.npmjs.org`):

```bash
cd "$(node -e "console.log(require('os').tmpdir())")/clispark-m4-verify/m4-test-cli"
npm install 2>&1 | head -20
cd -
```

Expected: an error mentioning `registry.example.com` (e.g. DNS resolution failure or connection error against that host) — not any output referencing `registry.npmjs.org`.

- [ ] **Step 4: Confirm the no-`.npmrc` path still works end-to-end (regression check)**

Run the full real scaffold (git init/add/commit + real `npm install`/`npm run build` against the real default registry), same as Milestones 1-3's manual verification, to confirm a normal scaffold with no custom registry is unaffected:

```bash
cat > m4-verify-default.mjs << 'EOF'
import { scaffoldProject } from './src/scaffold.js';
import path from 'node:path';
import os from 'node:os';

const targetDir = path.join(os.tmpdir(), 'clispark-m4-verify', 'm4-default-cli');
await scaffoldProject({ projectName: 'm4-default-cli', targetDir });
console.log('scaffold complete:', targetDir);
EOF
npx tsx m4-verify-default.mjs
rm m4-verify-default.mjs
ls -la "$(node -e "console.log(require('os').tmpdir())")/clispark-m4-verify/m4-default-cli/.npmrc" 2>&1
```

Expected: `scaffold complete: <path>` printed, real `npm install`/`npm run build` succeed, and the final `ls` on `.npmrc` reports "No such file or directory" (confirming no stray `.npmrc` for a default-registry scaffold).

- [ ] **Step 5: Clean up all manual-verification artifacts**

```bash
rm -rf "$(node -e "console.log(require('os').tmpdir())")/clispark-m4-verify"
```

- [ ] **Step 6: No commit needed for this task** (verification only; if any step reveals a bug, fix it in Task 1's files, re-run `npx vitest run src/scaffold.test.ts`, then re-do this verification from Step 1).

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
Expected: pushes all M4 commits (after this branch has been merged into `master` per the project's established workflow — merge happens outside this plan, in the main session, same as Milestones 1-3).

- [ ] **Step 3: Verify on GitHub**

Run: `git log --oneline -1` and compare against the GitHub repo's latest commit to confirm the push landed.
