# clispark M1: Generator Scaffold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `clispark` generator's own package skeleton, wizard flow, and npm package-name availability check (Milestone 1 from `project-ideas/clispark.plan.md`). This milestone ends once the wizard collects and validates answers — it does not generate any target project files yet (that's M2).

**Architecture:** A single npm package (`clispark`) with a commander-based CLI entry (`src/cli.ts`) whose default action runs an interactive wizard (`src/wizard.ts`, built on `@clack/prompts`). The wizard asks for a project name, then profile (work/private), then — only for "work" — an optional custom registry URL, then checks the name against an npm registry check (`src/registry.ts`), re-prompting for the name only (looping) until it isn't reported as taken. Built with `tsup`, tested with `vitest`.

**Tech Stack:** TypeScript (ESM), commander, @clack/prompts, tsup, vitest, Node.js >=18 (for global `fetch`).

## Global Constraints

- Project language is English: all code, identifiers, comments, docs, and CLI copy are in English (per `project-ideas/clispark.plan.md` Rahmenbedingungen).
- Node.js >=18 required (uses global `fetch`, no `node-fetch` dependency).
- Package uses ESM only (`"type": "module"` in package.json).
- M1 scope boundary: the wizard returns validated answers; it must NOT write any files to disk or scaffold a target project — that is M2's responsibility.
- Name-availability check: "taken" → warn and re-prompt for the name only (loop), never hard-block and never silently ignore. Network/unexpected-status failures → treat as "unverified", warn, and continue (do not abort the wizard).
- Registry URL question only appears when profile is "work"; default registry is `https://registry.npmjs.org`.

---

### Task 1: Package Scaffold & Build Tooling

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsup.config.ts`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `README.md`

**Interfaces:**
- Produces: an installable, buildable, testable npm package shell that later tasks add source files into (`src/`, built to `dist/` via `npm run build`, tested via `npm test`).

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "clispark",
  "version": "0.1.0",
  "description": "Interactive scaffolding tool for new CLI projects",
  "type": "module",
  "bin": {
    "clispark": "./dist/cli.js"
  },
  "files": [
    "dist"
  ],
  "engines": {
    "node": ">=18"
  },
  "scripts": {
    "build": "tsup",
    "postbuild": "shx chmod +x dist/cli.js",
    "dev": "tsx src/cli.ts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@clack/prompts": "^0.9.1",
    "commander": "^13.1.0"
  },
  "devDependencies": {
    "@types/node": "^22.10.5",
    "shx": "^0.3.4",
    "tsup": "^8.3.5",
    "tsx": "^4.19.2",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

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

- [ ] **Step 3: Write `tsup.config.ts`**

```ts
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm'],
  target: 'node18',
  banner: { js: '#!/usr/bin/env node' },
  clean: true,
  sourcemap: true,
});
```

- [ ] **Step 4: Write `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
  },
});
```

- [ ] **Step 5: Write `.gitignore`**

```
node_modules
dist
*.log
```

- [ ] **Step 6: Write `README.md`**

```markdown
# clispark

Interactive scaffolding tool for new CLI projects. Run `npx clispark` to generate a new, ready-to-run CLI project with consistent logging, error handling, and command structure.

**Status:** work in progress (M1 — generator scaffold).

## Development notes

This project is being built with the help of [Claude](https://claude.com/claude-code). Implementation plans are written before coding starts and committed alongside the code under [`docs/superpowers/plans/`](docs/superpowers/plans/), so the reasoning and step-by-step approach behind each milestone stays visible in version control.

Planning and execution follow the [Superpowers](https://github.com/obra/superpowers) skill set for Claude Code (brainstorming → writing-plans → subagent-driven-development) — credit to [obra](https://github.com/obra) for that workflow.
```

- [ ] **Step 7: Install dependencies**

Run: `npm install`
Expected: installs without errors, creates `package-lock.json` and `node_modules/`.

- [ ] **Step 8: Verify the empty build succeeds (no src yet, so this should fail — confirming tooling is wired up)**

Run: `npm run build`
Expected: FAIL with an error that `src/cli.ts` does not exist (confirms tsup is invoked correctly; entry file comes in Task 4).

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json tsconfig.json tsup.config.ts vitest.config.ts .gitignore README.md
git commit -m "chore: scaffold clispark package and build tooling"
```

---

### Task 2: Registry Name-Check Module

**Files:**
- Create: `src/registry.ts`
- Test: `src/registry.test.ts`

**Interfaces:**
- Produces:
  - `DEFAULT_REGISTRY_URL: string` (value: `'https://registry.npmjs.org'`)
  - `type NameCheckResult = 'available' | 'taken' | 'unverified'`
  - `async function checkPackageNameAvailability(name: string, registryUrl?: string): Promise<NameCheckResult>`

- [ ] **Step 1: Write the failing test**

```ts
// src/registry.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { checkPackageNameAvailability, DEFAULT_REGISTRY_URL } from './registry.js';

describe('checkPackageNameAvailability', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns "available" when the registry responds 404', async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 404 } as Response);
    const result = await checkPackageNameAvailability('some-free-name');
    expect(result).toBe('available');
    expect(global.fetch).toHaveBeenCalledWith(`${DEFAULT_REGISTRY_URL}/some-free-name`);
  });

  it('returns "taken" when the registry responds 200', async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 200 } as Response);
    const result = await checkPackageNameAvailability('express');
    expect(result).toBe('taken');
  });

  it('returns "unverified" on an unexpected status code', async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 500 } as Response);
    const result = await checkPackageNameAvailability('some-name');
    expect(result).toBe('unverified');
  });

  it('returns "unverified" when the network request throws', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network down'));
    const result = await checkPackageNameAvailability('some-name');
    expect(result).toBe('unverified');
  });

  it('uses a custom registry URL when provided', async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 404 } as Response);
    await checkPackageNameAvailability('my-cli', 'https://npm.mycompany.dev');
    expect(global.fetch).toHaveBeenCalledWith('https://npm.mycompany.dev/my-cli');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/registry.test.ts`
Expected: FAIL — `Cannot find module './registry.js'` (or similar resolution error), since `src/registry.ts` doesn't exist yet.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/registry.ts
export const DEFAULT_REGISTRY_URL = 'https://registry.npmjs.org';

export type NameCheckResult = 'available' | 'taken' | 'unverified';

export async function checkPackageNameAvailability(
  name: string,
  registryUrl: string = DEFAULT_REGISTRY_URL,
): Promise<NameCheckResult> {
  const url = `${registryUrl.replace(/\/$/, '')}/${encodeURIComponent(name)}`;

  try {
    const response = await fetch(url);
    if (response.status === 404) return 'available';
    if (response.status === 200) return 'taken';
    return 'unverified';
  } catch {
    return 'unverified';
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/registry.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/registry.ts src/registry.test.ts
git commit -m "feat: add npm registry package-name availability check"
```

---

### Task 3: Wizard Flow

**Files:**
- Create: `src/types.ts`
- Create: `src/wizard.ts`
- Test: `src/wizard.test.ts`

**Interfaces:**
- Consumes: `checkPackageNameAvailability`, `DEFAULT_REGISTRY_URL`, `NameCheckResult` from `./registry.js` (Task 2)
- Produces:
  - `type Profile = 'work' | 'private'` (`src/types.ts`)
  - `interface WizardAnswers { projectName: string; profile: Profile; registryUrl: string; nameAvailability: NameCheckResult }` (`src/types.ts`)
  - `interface WizardDeps { checkAvailability: typeof checkPackageNameAvailability }` (`src/wizard.ts`)
  - `async function runWizard(deps?: WizardDeps): Promise<WizardAnswers>` (`src/wizard.ts`) — consumed by `src/cli.ts` in Task 4

- [ ] **Step 1: Write `src/types.ts`**

```ts
// src/types.ts
import type { NameCheckResult } from './registry.js';

export type Profile = 'work' | 'private';

export interface WizardAnswers {
  projectName: string;
  profile: Profile;
  registryUrl: string;
  nameAvailability: NameCheckResult;
}
```

- [ ] **Step 2: Write the failing test**

```ts
// src/wizard.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NameCheckResult } from './registry.js';

vi.mock('@clack/prompts', () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  text: vi.fn(),
  select: vi.fn(),
  log: { warn: vi.fn(), info: vi.fn() },
  isCancel: vi.fn(() => false),
  cancel: vi.fn(),
}));

import { text, select, log } from '@clack/prompts';
import { runWizard } from './wizard.js';

describe('runWizard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('asks name, then profile, then returns the answers when the name is available on first try', async () => {
    vi.mocked(text).mockResolvedValueOnce('my-cli');
    vi.mocked(select).mockResolvedValueOnce('private');
    const checkAvailability = vi
      .fn<(name: string, registryUrl?: string) => Promise<NameCheckResult>>()
      .mockResolvedValueOnce('available');

    const result = await runWizard({ checkAvailability });

    expect(result).toEqual({
      projectName: 'my-cli',
      profile: 'private',
      registryUrl: 'https://registry.npmjs.org',
      nameAvailability: 'available',
    });
    expect(checkAvailability).toHaveBeenCalledTimes(1);
    // name is asked before profile
    expect(vi.mocked(text).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(select).mock.invocationCallOrder[0],
    );
  });

  it('warns and re-prompts for the name only (not profile/registry) when it is taken, then succeeds', async () => {
    vi.mocked(text)
      .mockResolvedValueOnce('taken-name')
      .mockResolvedValueOnce('free-name');
    vi.mocked(select).mockResolvedValueOnce('private');
    const checkAvailability = vi
      .fn<(name: string, registryUrl?: string) => Promise<NameCheckResult>>()
      .mockResolvedValueOnce('taken')
      .mockResolvedValueOnce('available');

    const result = await runWizard({ checkAvailability });

    expect(result.projectName).toBe('free-name');
    expect(checkAvailability).toHaveBeenCalledTimes(2);
    expect(select).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('taken-name'));
  });

  it('asks for a custom registry URL only when profile is "work"', async () => {
    vi.mocked(text)
      .mockResolvedValueOnce('my-cli')
      .mockResolvedValueOnce('https://npm.mycompany.dev');
    vi.mocked(select).mockResolvedValueOnce('work');
    const checkAvailability = vi
      .fn<(name: string, registryUrl?: string) => Promise<NameCheckResult>>()
      .mockResolvedValueOnce('available');

    const result = await runWizard({ checkAvailability });

    expect(result.registryUrl).toBe('https://npm.mycompany.dev');
    expect(checkAvailability).toHaveBeenCalledWith('my-cli', 'https://npm.mycompany.dev');
  });

  it('continues with "unverified" and a warning when the registry check fails', async () => {
    vi.mocked(text).mockResolvedValueOnce('my-cli');
    vi.mocked(select).mockResolvedValueOnce('private');
    const checkAvailability = vi
      .fn<(name: string, registryUrl?: string) => Promise<NameCheckResult>>()
      .mockResolvedValueOnce('unverified');

    const result = await runWizard({ checkAvailability });

    expect(result.nameAvailability).toBe('unverified');
    expect(log.warn).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/wizard.test.ts`
Expected: FAIL — `Cannot find module './wizard.js'`, since `src/wizard.ts` doesn't exist yet.

- [ ] **Step 4: Write minimal implementation**

```ts
// src/wizard.ts
import { intro, outro, text, select, log, isCancel, cancel } from '@clack/prompts';
import { checkPackageNameAvailability, DEFAULT_REGISTRY_URL } from './registry.js';
import type { Profile, WizardAnswers } from './types.js';

export interface WizardDeps {
  checkAvailability: typeof checkPackageNameAvailability;
}

const defaultDeps: WizardDeps = {
  checkAvailability: checkPackageNameAvailability,
};

function exitIfCancelled(value: unknown): void {
  if (isCancel(value)) {
    cancel('Operation cancelled.');
    process.exit(1);
  }
}

function validateProjectName(value: string): string | undefined {
  if (!value || value.trim().length === 0) return 'Project name is required.';
  if (!/^[a-z0-9-]+$/.test(value)) return 'Use lowercase letters, numbers and hyphens only.';
  return undefined;
}

export async function runWizard(deps: WizardDeps = defaultDeps): Promise<WizardAnswers> {
  intro('clispark — scaffold a new CLI project');

  const nameValue = await text({
    message: 'Project name',
    validate: validateProjectName,
  });
  exitIfCancelled(nameValue);
  let projectName = nameValue as string;

  const profileValue = await select({
    message: 'Is this a work or private project?',
    options: [
      { value: 'private', label: 'Private' },
      { value: 'work', label: 'Work' },
    ],
  });
  exitIfCancelled(profileValue);
  const profile = profileValue as Profile;

  let registryUrl = DEFAULT_REGISTRY_URL;
  if (profile === 'work') {
    const registryValue = await text({
      message: 'Custom npm registry URL (leave empty for npmjs.org)',
      placeholder: DEFAULT_REGISTRY_URL,
      defaultValue: DEFAULT_REGISTRY_URL,
    });
    exitIfCancelled(registryValue);
    registryUrl = (registryValue as string) || DEFAULT_REGISTRY_URL;
  }

  let nameAvailability = await deps.checkAvailability(projectName, registryUrl);

  while (nameAvailability === 'taken') {
    log.warn(`"${projectName}" is already taken on ${registryUrl}. Please choose a different name.`);

    const retryValue = await text({
      message: 'Project name',
      validate: validateProjectName,
    });
    exitIfCancelled(retryValue);
    projectName = retryValue as string;

    nameAvailability = await deps.checkAvailability(projectName, registryUrl);
  }

  if (nameAvailability === 'unverified') {
    log.warn(`Could not verify availability of "${projectName}" on ${registryUrl}. Continuing anyway.`);
  }

  outro(`Ready to scaffold "${projectName}".`);

  return { projectName, profile, registryUrl, nameAvailability };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/wizard.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/wizard.ts src/wizard.test.ts
git commit -m "feat: add interactive wizard flow with name-check retry loop"
```

---

### Task 4: CLI Entry Point & Manual Verification

**Files:**
- Create: `src/cli.ts`

**Interfaces:**
- Consumes: `runWizard` from `./wizard.js` (Task 3)
- Produces: the package's `bin` executable (`dist/cli.js` after build), invoked via `npx clispark` or `npm link`

- [ ] **Step 1: Write `src/cli.ts`**

```ts
// src/cli.ts
import { createRequire } from 'node:module';
import { Command } from 'commander';
import { runWizard } from './wizard.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };

const program = new Command();

program
  .name('clispark')
  .description('Interactive scaffolding tool for new CLI projects')
  .version(pkg.version);

program.action(async () => {
  const answers = await runWizard();
  console.log('\nCollected wizard answers:');
  console.log(JSON.stringify(answers, null, 2));
});

program.parseAsync(process.argv);
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: succeeds, produces `dist/cli.js` (with `#!/usr/bin/env node` banner) and makes it executable via the `postbuild` script.

- [ ] **Step 4: Manual end-to-end run**

Run: `node dist/cli.js`
Expected: wizard runs interactively —
1. Prompts "Project name" — type an obviously-taken name like `react` — expect no rejection yet (name isn't checked until after profile/registry are collected).
2. Prompts "Is this a work or private project?" — choose "Private" (registry question is skipped).
3. After confirming, expect a warning that `react` is taken and a re-prompt for "Project name" only.
4. Type a name that's very unlikely to be taken, e.g. `clispark-manual-test-<random>` — expect it to proceed.
5. Ends with an `outro` message and prints the JSON answers object with `nameAvailability: "available"`.

- [ ] **Step 5: Manual `npx`-style verification via `npm link`**

Run: `npm link` then `clispark` (from any directory), then `npm unlink -g clispark` to clean up.
Expected: same interactive flow as Step 4, confirming the `bin` entry works as it would via `npx clispark` once published.

- [ ] **Step 6: Commit**

```bash
git add src/cli.ts
git commit -m "feat: add commander-based CLI entry point running the wizard"
```

---

### Task 5: Push to GitHub

**Files:**
- None (repository-level operation only)

**Interfaces:**
- None

- [ ] **Step 1: Verify remote and branch**

Run: `git remote -v && git branch --show-current`
Expected: `origin` points to `git@github.com:martinwichner/clispark.git`; confirm current branch name (create/rename to `main` if needed: `git branch -M main`).

- [ ] **Step 2: Push**

Run: `git push -u origin main`
Expected: pushes all M1 commits, sets upstream tracking.

- [ ] **Step 3: Verify on GitHub**

Run: `git log --oneline -1` and compare against the GitHub repo's latest commit (via `gh repo view martinwichner/clispark --web` or checking the repo page) to confirm the push landed.
