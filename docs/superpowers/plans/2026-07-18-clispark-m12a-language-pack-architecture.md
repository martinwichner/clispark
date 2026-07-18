# M12a: Language-Pack-Architektur Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generalize `wizard.ts`/`scaffold.ts`/`cli.ts` so no code path hardcodes npm/oclif specifics — every language-specific concern (template location, scaffold-time commands, registry name-check, project-name validation, the update system's `UpdateAdapter`) is bundled behind a new `LanguagePack` interface, with exactly one concrete pack (`nodeOclifPack`) preserving today's behavior unchanged.

**Architecture:** A new `LanguagePack` interface (`src/languages/pack.ts`) and `RegistryChecker` interface (`src/languages/registry-checker.ts`) capture everything template/language-specific beyond what `UpdateAdapter` (from M11 Tier 3) already covers. `src/languages/packs/node-oclif.ts` bundles the existing `nodeOclifAdapter`, a new npm `RegistryChecker` implementation, and today's npm-specific scaffold/validation behavior into the one concrete pack. `wizard.ts`, `scaffold.ts`, and `cli.ts` take the pack (or, for `update`/`releasenotes`, resolve it from the target project's own manifest) as a required parameter — no default, no hardcoded import of the concrete pack outside `cli.ts` — so the generic layer cannot silently regain npm/oclif knowledge.

**Tech Stack:** TypeScript (ESM, `"type": "module"`, no `.js` import extensions), vitest, existing DI pattern (`ScaffoldDeps`/`UpdateDeps`/`WizardDeps` — injectable dependencies with defaults where appropriate).

Full design: `docs/superpowers/specs/2026-07-18-clispark-m12-language-packs-design.md`

This plan covers ONLY the architecture generalization (M12a). The .NET template itself is a separate, later plan (M12b) that consumes this architecture as its second concrete `LanguagePack`.

## Global Constraints

- No `.js` extensions on relative imports (project uses `moduleResolution: "Bundler"`).
- `src/update/manifest.ts` and `src/update/update.ts` must never import a concrete `LanguagePack`/adapter — every language-specific value is a required parameter, never a default. This is the actual proof of decoupling; a default value would silently reintroduce the coupling.
- `src/languages/packs/node-oclif.ts` is the only file allowed to import `nodeOclifAdapter` from `../../update/adapters/node-oclif` (this plan doesn't touch that file at all). `src/cli.ts` is the only file allowed to import the `LANGUAGE_PACKS` lookup map to resolve a concrete pack for scaffold/update.
- `UserError` (`src/errors.ts`) for expected, user-fixable failures; never for internal/unexpected ones.
- Every behavior change must be zero for existing Node/oclif projects, with exactly one named, deliberate exception (see Task 7): when BOTH the git working tree is dirty AND `.clispark/manifest.json` is missing, `clispark update` now reports "no manifest found" instead of "working tree is not clean" — because `cli.ts` must read the manifest first to resolve which `LanguagePack` to use. Any other test whose assertions change value (not just call-signature) is a bug.
- All existing tests keep testing the exact same behavior they test today (file names may change, e.g. `registry.test.ts` → `registry-checkers/npm.test.ts`, but no assertion's expected VALUE changes) unless explicitly noted as intentional in a task below.

---

## Task 1: `findPackageRoot()` utility + `LanguagePack`/`RegistryChecker`/`ScaffoldCommand` interfaces

**Files:**
- Create: `src/package-root.ts`
- Create: `src/package-root.test.ts`
- Create: `src/languages/pack.ts`
- Create: `src/languages/registry-checker.ts`

**Interfaces:**
- Produces: `findPackageRoot(): string` (`src/package-root.ts`)
- Produces: `NameCheckResult`, `RegistryChecker` (`src/languages/registry-checker.ts`), exact shapes below
- Produces: `ScaffoldCommand`, `LanguageRegistry`, `LanguagePack` (`src/languages/pack.ts`), exact shapes below

This task only adds new utilities/type declarations — nothing imports them yet except `findPackageRoot`'s own test, so there is no other runtime behavior to verify. `findPackageRoot()` exists because a future task (Task 3) needs to locate `templates/node` relative to clispark's own package root, and a naive fixed relative path (`path.join(__dirname, '..', '..', '..', 'templates', 'node')`) would silently break once bundled: tsup flattens every source file into one `dist/cli.js`, so a module's depth below the package root at runtime differs from its depth in source — this is the exact bug class that broke `getGeneratorVersion()` after the M6 `src/update/` folder move. `findPackageRoot()` walks up from its own location until it finds a `package.json` with `"name": "clispark"`, which works correctly regardless of how deep the calling code lives, bundled or not.

- [ ] **Step 1: Write `findPackageRoot()`'s test**

Create `src/package-root.test.ts`:

```ts
// src/package-root.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { findPackageRoot } from './package-root';

describe('findPackageRoot', () => {
  it('finds the directory containing package.json with name "clispark"', () => {
    const root = findPackageRoot();
    const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { name: string };
    expect(pkg.name).toBe('clispark');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails (module doesn't exist yet)**

Run: `npx vitest run src/package-root.test.ts`
Expected: FAIL — `Cannot find module './package-root'`

- [ ] **Step 3: Implement `src/package-root.ts`**

```ts
// src/package-root.ts
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Finds clispark's own package root by walking up from this module's
 * location. A fixed relative path can't work here: this module's depth
 * below the package root differs between running from source (tests) and
 * running as part of the bundled `dist/cli.js` (tsup flattens everything
 * into one file, so `import.meta.url` no longer reflects the original
 * per-module nesting) — but the walk-up strategy is depth-independent
 * either way, since it doesn't matter where exactly the walk starts.
 */
export function findPackageRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  while (true) {
    const pkgPath = path.join(dir, 'package.json');
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { name?: string };
      if (pkg.name === 'clispark') return dir;
    }
    const parentDir = path.dirname(dir);
    if (parentDir === dir) {
      throw new Error("Could not locate clispark's own package.json.");
    }
    dir = parentDir;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/package-root.test.ts`
Expected: PASS

- [ ] **Step 5: Create `src/languages/registry-checker.ts`**

```ts
// src/languages/registry-checker.ts
export type NameCheckResult = 'available' | 'taken' | 'unverified' | 'skipped';

/**
 * Isolates how a language's package registry (npm, NuGet, ...) is queried
 * for name availability, and what "don't publish this" means for that
 * ecosystem's manifest file — from the generic wizard flow.
 */
export interface RegistryChecker {
  checkNameAvailability(name: string, registryUrl: string): Promise<NameCheckResult>;
  applyPrivateIntent(targetDir: string): Promise<void>;
}
```

- [ ] **Step 6: Create `src/languages/pack.ts`**

```ts
// src/languages/pack.ts
import type { UpdateAdapter } from '../update/adapter';
import type { RegistryChecker } from './registry-checker';

export interface ScaffoldCommand {
  command: string;
  args: string[];
}

export interface LanguageRegistry extends RegistryChecker {
  /** Shown as the default value / used when the wizard's registry-URL question is skipped. */
  defaultUrl: string;
  /** Wizard prompt label for the custom-registry-URL question, e.g. "Custom npm registry URL". */
  promptLabel: string;
}

/**
 * Isolates everything template/language-specific from the generic wizard,
 * scaffold, and CLI-composition layers: where the template lives, which
 * commands turn a fresh copy into a working project, how project names are
 * validated, how the package registry is queried, and (via the existing
 * `UpdateAdapter` from M11 Tier 3) how the update system reads/writes/merges
 * this language's package manifest. One concrete implementation exists today
 * (`packs/node-oclif.ts`); a future non-Node template adds a sibling pack
 * without touching `wizard.ts`, `scaffold.ts`, `update.ts`, or `manifest.ts`.
 */
export interface LanguagePack {
  readonly id: string;
  readonly displayName: string;
  readonly templateDir: string;
  readonly scaffoldCommands: readonly ScaffoldCommand[];
  validateProjectName(value: string): string | undefined;
  readonly updateAdapter: UpdateAdapter;
  readonly registry: LanguageRegistry;
}
```

- [ ] **Step 7: Verify it all compiles and lints**

Run: `npm run typecheck && npm run lint`
Expected: both PASS with no errors (the new files aren't imported anywhere else yet, but `tsc --noEmit` type-checks everything under `src/` regardless).

- [ ] **Step 8: Commit**

```bash
git add src/package-root.ts src/package-root.test.ts src/languages/pack.ts src/languages/registry-checker.ts
git commit -m "feat: add findPackageRoot utility and LanguagePack/RegistryChecker interfaces"
```

---

## Task 2: npm `RegistryChecker`

**Files:**
- Create: `src/languages/registry-checkers/npm.ts`
- Create: `src/languages/registry-checkers/npm.test.ts`
- Delete: `src/registry.ts`
- Delete: `src/registry.test.ts`

**Interfaces:**
- Consumes: `RegistryChecker`, `NameCheckResult` (`../registry-checker`)
- Produces: `npmRegistryChecker: RegistryChecker`, `NPM_DEFAULT_REGISTRY_URL: string` (both from `src/languages/registry-checkers/npm.ts`)

This is a pure move: today's `src/registry.ts` (`checkPackageNameAvailability`, `DEFAULT_REGISTRY_URL`) and `scaffold.ts`'s private `markPackageJsonPrivate` function land here unchanged in behavior, wrapped by `npmRegistryChecker`. `scaffold.ts` itself is NOT touched in this task (its own `markPackageJsonPrivate` stays in place, still used by its current callers) — that migration happens in Task 5. This task's deletion of `src/registry.ts` means `wizard.ts`, `types.ts`, and `scaffold.test.ts` (which import from it) will fail typecheck until Tasks 5–6 update them — expected and resolved by the end of Task 6. Confirm at the end of this task that the *only* typecheck errors are in those files.

- [ ] **Step 1: Write the npm registry checker's tests**

Create `src/languages/registry-checkers/npm.test.ts`:

```ts
// src/languages/registry-checkers/npm.test.ts
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { npmRegistryChecker, NPM_DEFAULT_REGISTRY_URL } from './npm';

describe('npmRegistryChecker.checkNameAvailability', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns "available" when the registry responds 404', async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 404 } as Response);
    const result = await npmRegistryChecker.checkNameAvailability('some-free-name', NPM_DEFAULT_REGISTRY_URL);
    expect(result).toBe('available');
    expect(global.fetch).toHaveBeenCalledWith(
      `${NPM_DEFAULT_REGISTRY_URL}/some-free-name`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('returns "taken" when the registry responds 200', async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 200 } as Response);
    const result = await npmRegistryChecker.checkNameAvailability('express', NPM_DEFAULT_REGISTRY_URL);
    expect(result).toBe('taken');
  });

  it('returns "unverified" on an unexpected status code', async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 500 } as Response);
    const result = await npmRegistryChecker.checkNameAvailability('some-name', NPM_DEFAULT_REGISTRY_URL);
    expect(result).toBe('unverified');
  });

  it('returns "unverified" when the network request throws', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network down'));
    const result = await npmRegistryChecker.checkNameAvailability('some-name', NPM_DEFAULT_REGISTRY_URL);
    expect(result).toBe('unverified');
  });

  it('uses a custom registry URL when provided', async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 404 } as Response);
    await npmRegistryChecker.checkNameAvailability('my-cli', 'https://npm.mycompany.dev');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://npm.mycompany.dev/my-cli',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('returns "unverified" when the request times out', async () => {
    global.fetch = vi.fn().mockRejectedValue(new DOMException('The operation was aborted.', 'TimeoutError'));
    const result = await npmRegistryChecker.checkNameAvailability('some-name', NPM_DEFAULT_REGISTRY_URL);
    expect(result).toBe('unverified');
  });
});

describe('npmRegistryChecker.applyPrivateIntent', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(path.join(tmpdir(), 'clispark-npm-registry-checker-test-'));
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it('sets "private": true on the target package.json', async () => {
    await writeFile(path.join(tmpRoot, 'package.json'), JSON.stringify({ name: 'my-cli', version: '0.0.0' }));

    await npmRegistryChecker.applyPrivateIntent(tmpRoot);

    const pkg = JSON.parse(await readFile(path.join(tmpRoot, 'package.json'), 'utf8'));
    expect(pkg.private).toBe(true);
    expect(pkg.name).toBe('my-cli');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail (module doesn't exist yet)**

Run: `npx vitest run src/languages/registry-checkers/npm.test.ts`
Expected: FAIL — `Cannot find module './npm'`

- [ ] **Step 3: Implement `src/languages/registry-checkers/npm.ts`**

```ts
// src/languages/registry-checkers/npm.ts
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { NameCheckResult, RegistryChecker } from '../registry-checker';

export const NPM_DEFAULT_REGISTRY_URL = 'https://registry.npmjs.org';

const FETCH_TIMEOUT_MS = 5000;

async function checkNameAvailability(name: string, registryUrl: string): Promise<NameCheckResult> {
  const url = `${registryUrl.replace(/\/$/, '')}/${encodeURIComponent(name)}`;

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (response.status === 404) return 'available';
    if (response.status === 200) return 'taken';
    return 'unverified';
  } catch {
    return 'unverified';
  }
}

async function applyPrivateIntent(targetDir: string): Promise<void> {
  const packageJsonPath = path.join(targetDir, 'package.json');
  const pkg = JSON.parse(await readFile(packageJsonPath, 'utf8')) as Record<string, unknown>;
  pkg.private = true;
  await writeFile(packageJsonPath, JSON.stringify(pkg, null, 2) + '\n');
}

export const npmRegistryChecker: RegistryChecker = {
  checkNameAvailability,
  applyPrivateIntent,
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/languages/registry-checkers/npm.test.ts`
Expected: PASS, all tests green

- [ ] **Step 5: Delete the superseded files**

```bash
git rm src/registry.ts src/registry.test.ts
```

- [ ] **Step 6: Confirm the resulting typecheck failures are confined to the expected files**

Run: `npm run typecheck`
Expected: FAILS — confirm the *only* errors are in `src/wizard.ts`, `src/wizard.test.ts`, `src/types.ts`, and `src/scaffold.test.ts` (all reference the now-deleted `./registry` module). These are resolved by Tasks 5–6, not this task.

- [ ] **Step 7: Commit**

```bash
git add src/languages/registry-checkers/npm.ts src/languages/registry-checkers/npm.test.ts
git commit -m "feat: add npm RegistryChecker, remove superseded registry.ts"
```

---

## Task 3: `nodeOclifPack` + `LANGUAGE_PACKS` lookup

**Files:**
- Create: `src/languages/packs/node-oclif.ts`
- Create: `src/languages/packs/node-oclif.test.ts`
- Create: `src/languages/index.ts`
- Create: `src/languages/index.test.ts`

**Interfaces:**
- Consumes: `LanguagePack` (`../pack`); `nodeOclifAdapter` (`../../update/adapters/node-oclif`); `npmRegistryChecker`, `NPM_DEFAULT_REGISTRY_URL` (`../registry-checkers/npm`); `findPackageRoot` (`../../package-root`)
- Produces: `nodeOclifPack: LanguagePack` (`src/languages/packs/node-oclif.ts`); `LANGUAGE_PACKS: Record<string, LanguagePack>`, `getPackById(id: string): LanguagePack | undefined` (`src/languages/index.ts`)

**Important — do not assert real filesystem paths in this task's tests.** `nodeOclifPack.templateDir` will be computed as `<package root>/templates/node`, but the actual directory is still named `templates/base` at this point in the plan (the rename happens in Task 5, together with `scaffold.ts`'s generalization — doing it earlier would break every scaffold-dependent test in the suite, since `scaffold.ts` itself isn't updated to use the pack until Task 5). This task's tests check the pack object's *shape* only (string suffix, function identity, static values) — never that `templateDir` points at a directory that currently exists on disk. That real-filesystem proof comes from Task 5 onward.

- [ ] **Step 1: Write `nodeOclifPack`'s test**

Create `src/languages/packs/node-oclif.test.ts`:

```ts
// src/languages/packs/node-oclif.test.ts
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { nodeOclifPack } from './node-oclif';
import { nodeOclifAdapter } from '../../update/adapters/node-oclif';
import { npmRegistryChecker, NPM_DEFAULT_REGISTRY_URL } from '../registry-checkers/npm';

describe('nodeOclifPack', () => {
  it('has the expected static identity', () => {
    expect(nodeOclifPack.id).toBe('node');
    expect(nodeOclifPack.displayName).toBe('Node.js / TypeScript (oclif)');
  });

  it('points templateDir at templates/node, relative to the package root', () => {
    expect(nodeOclifPack.templateDir.endsWith(path.join('templates', 'node'))).toBe(true);
  });

  it('runs npm install then npm run build as scaffold commands', () => {
    expect(nodeOclifPack.scaffoldCommands).toEqual([
      { command: 'npm', args: ['install'] },
      { command: 'npm', args: ['run', 'build'] },
    ]);
  });

  it('reuses the existing node-oclif UpdateAdapter unchanged', () => {
    expect(nodeOclifPack.updateAdapter).toBe(nodeOclifAdapter);
  });

  it('reuses the npm RegistryChecker for name checks and private-marking', () => {
    expect(nodeOclifPack.registry.checkNameAvailability).toBe(npmRegistryChecker.checkNameAvailability);
    expect(nodeOclifPack.registry.applyPrivateIntent).toBe(npmRegistryChecker.applyPrivateIntent);
    expect(nodeOclifPack.registry.defaultUrl).toBe(NPM_DEFAULT_REGISTRY_URL);
  });

  it('validates project names with the existing npm-style rule', () => {
    expect(nodeOclifPack.validateProjectName('my-cli')).toBeUndefined();
    expect(nodeOclifPack.validateProjectName('')).toMatch(/required/i);
    expect(nodeOclifPack.validateProjectName('My-CLI')).toMatch(/lowercase/i);
    expect(nodeOclifPack.validateProjectName('-leading-hyphen')).toMatch(/lowercase/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails (module doesn't exist yet)**

Run: `npx vitest run src/languages/packs/node-oclif.test.ts`
Expected: FAIL — `Cannot find module './node-oclif'`

- [ ] **Step 3: Implement `src/languages/packs/node-oclif.ts`**

```ts
// src/languages/packs/node-oclif.ts
import path from 'node:path';
import { findPackageRoot } from '../../package-root';
import type { LanguagePack } from '../pack';
import { nodeOclifAdapter } from '../../update/adapters/node-oclif';
import { npmRegistryChecker, NPM_DEFAULT_REGISTRY_URL } from '../registry-checkers/npm';

function validateProjectName(value: string): string | undefined {
  if (!value || value.trim().length === 0) return 'Project name is required.';
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(value)) {
    return 'Use lowercase letters and numbers, with single hyphens between words (no leading, trailing, or repeated hyphens).';
  }
  return undefined;
}

export const nodeOclifPack: LanguagePack = {
  id: 'node',
  displayName: 'Node.js / TypeScript (oclif)',
  templateDir: path.join(findPackageRoot(), 'templates', 'node'),
  scaffoldCommands: [
    { command: 'npm', args: ['install'] },
    { command: 'npm', args: ['run', 'build'] },
  ],
  validateProjectName,
  updateAdapter: nodeOclifAdapter,
  registry: {
    defaultUrl: NPM_DEFAULT_REGISTRY_URL,
    promptLabel: 'Custom npm registry URL (leave empty for npmjs.org)',
    checkNameAvailability: npmRegistryChecker.checkNameAvailability,
    applyPrivateIntent: npmRegistryChecker.applyPrivateIntent,
  },
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/languages/packs/node-oclif.test.ts`
Expected: PASS, all tests green

- [ ] **Step 5: Write the `LANGUAGE_PACKS` lookup's test**

Create `src/languages/index.test.ts`:

```ts
// src/languages/index.test.ts
import { describe, it, expect } from 'vitest';
import { LANGUAGE_PACKS, getPackById } from './index';
import { nodeOclifPack } from './packs/node-oclif';

describe('LANGUAGE_PACKS', () => {
  it('includes the node-oclif pack, keyed by its id', () => {
    expect(LANGUAGE_PACKS.node).toBe(nodeOclifPack);
  });
});

describe('getPackById', () => {
  it('returns the pack for a known id', () => {
    expect(getPackById('node')).toBe(nodeOclifPack);
  });

  it('returns undefined for an unknown id', () => {
    expect(getPackById('nonexistent')).toBeUndefined();
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `npx vitest run src/languages/index.test.ts`
Expected: FAIL — `Cannot find module './index'`

- [ ] **Step 7: Implement `src/languages/index.ts`**

```ts
// src/languages/index.ts
import type { LanguagePack } from './pack';
import { nodeOclifPack } from './packs/node-oclif';

export const LANGUAGE_PACKS: Record<string, LanguagePack> = {
  [nodeOclifPack.id]: nodeOclifPack,
};

export function getPackById(id: string): LanguagePack | undefined {
  return LANGUAGE_PACKS[id];
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npx vitest run src/languages/index.test.ts`
Expected: PASS

- [ ] **Step 9: Typecheck and lint**

Run: `npm run typecheck`
Expected: still FAILS at this point, confined to the same files named at the end of Task 2 (`wizard.ts`, `wizard.test.ts`, `types.ts`, `scaffold.test.ts`) — this task doesn't touch any of them.

Run: `npm run lint`
Expected: PASS (lint doesn't type-check across files the way `tsc` does, so the files broken by Task 2's deletion don't block it — if it unexpectedly fails, read the output before assuming it's the same pre-existing issue).

- [ ] **Step 10: Commit**

```bash
git add src/languages/packs/node-oclif.ts src/languages/packs/node-oclif.test.ts src/languages/index.ts src/languages/index.test.ts
git commit -m "feat: add nodeOclifPack and LANGUAGE_PACKS lookup"
```

---

## Task 4: Generalize `manifest.ts` (add `language` field)

**Files:**
- Modify: `src/update/manifest.ts`
- Modify: `src/update/manifest.test.ts`

**Interfaces:**
- Produces: `Manifest` gains `language: string` (right after `generatorVersion`); `buildManifest(targetDir: string, generatorVersion: string, language: string, adapter: UpdateAdapter)` — `language` is a new required third parameter, inserted before `adapter`

This task does NOT touch `getGeneratorVersion()` or any other manifest.ts function — only `Manifest`'s shape and `buildManifest`'s signature change. `hashCoreFiles()` is untouched (it only ever reads files already present in the target directory, never needs to know the language).

- [ ] **Step 1: Update `manifest.test.ts`'s assertions for the new field/signature**

In `src/update/manifest.test.ts`, update the `buildManifest` call and its assertion:

```ts
  it('buildManifest assembles a full manifest from a target directory', async () => {
    const manifest = await buildManifest(tmpRoot, '9.9.9', 'node', nodeOclifAdapter);
    expect(manifest.generatorVersion).toBe('9.9.9');
    expect(manifest.language).toBe('node');
    expect(manifest.coreFiles['tsconfig.json']).toBe(hashContent('content of tsconfig.json'));
    expect(manifest.coreDependencies).toEqual({ pino: '^9.0.0', vitest: '^2.0.0' });
    expect(manifest.coreScripts.build).toBe('build');
    expect(manifest.coreFields.engines).toEqual({ node: '>=18' });
  });
```

(This replaces the existing `it('buildManifest assembles a full manifest from a target directory', ...)` block. The `hashCoreFiles` test right above it is unchanged — it doesn't call `buildManifest` and doesn't need `language`.)

Also update `sampleManifest` (used by the `writeManifest`/`readManifest`/`requireManifest` tests) to include the new field:

```ts
  const sampleManifest = {
    generatorVersion: '1.0.0',
    language: 'node',
    coreFiles: { 'tsconfig.json': 'abc' },
    coreDependencies: {},
    coreScripts: {},
    coreFields: { engines: {}, oclif: {} },
  };
```

- [ ] **Step 2: Run the tests to verify they fail (manifest.ts hasn't changed yet)**

Run: `npx vitest run src/update/manifest.test.ts`
Expected: FAIL — `buildManifest(tmpRoot, '9.9.9', 'node', nodeOclifAdapter)` passes 4 arguments but the current implementation only accepts 3; `manifest.language` is `undefined`, not `'node'`.

- [ ] **Step 3: Modify `src/update/manifest.ts`**

Change the `Manifest` interface:

```ts
export interface Manifest {
  generatorVersion: string;
  language: string;
  coreFiles: Record<string, string>;
  coreDependencies: Record<string, string>;
  coreScripts: Record<string, string>;
  coreFields: Record<string, unknown>;
}
```

Change `buildManifest`:

```ts
export async function buildManifest(
  targetDir: string,
  generatorVersion: string,
  language: string,
  adapter: UpdateAdapter,
): Promise<Manifest> {
  const coreFiles = await hashCoreFiles(targetDir, adapter);
  const manifestFile = await adapter.readManifestFile(targetDir);
  const { coreDependencies, coreScripts, coreFields } = adapter.extractCoreFields(manifestFile);
  return { generatorVersion, language, coreFiles, coreDependencies, coreScripts, coreFields };
}
```

Every other function in the file (`hashContent`, `hashCoreFiles`, `writeManifest`, `readManifest`, `requireManifest`, `getGeneratorVersion`, the `MANIFEST_RELATIVE_PATH` constant) is unchanged.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/update/manifest.test.ts`
Expected: PASS, all tests green

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: still FAILS — confirm the error set is now the Task 2 set (`wizard.ts`, `wizard.test.ts`, `types.ts`, `scaffold.test.ts`) PLUS `src/update/update.ts` and `src/update/update.test.ts` (both call `buildManifest`/reference `Manifest` indirectly through `scaffold.ts`'s test fixtures — read the actual error list rather than assuming; if `update.ts`/`update.test.ts` don't yet show errors from this change alone, that's fine too, they get rewritten in Task 5 regardless).

- [ ] **Step 6: Commit**

```bash
git add src/update/manifest.ts src/update/manifest.test.ts
git commit -m "feat: add language field to Manifest and buildManifest"
```

---

## Task 5: Generalize `scaffold.ts` and `update.ts`; rename `templates/base` → `templates/node`

**Files:**
- Rename: `templates/base/` → `templates/node/`
- Modify: `src/scaffold.ts`
- Modify: `src/scaffold.test.ts`
- Modify: `src/update/update.ts`
- Modify: `src/update/update.test.ts`

**Interfaces:**
- Consumes: `LanguagePack` (`./languages/pack`, `../languages/pack`); `nodeOclifPack` (`./languages/packs/node-oclif`, `../languages/packs/node-oclif`); `NPM_DEFAULT_REGISTRY_URL` (`./languages/registry-checkers/npm`, test-only)
- Produces: `copyTemplate(options: ScaffoldOptions, pack: LanguagePack)`, `scaffoldProject(options: ScaffoldOptions, pack: LanguagePack, deps: ScaffoldDeps = defaultScaffoldDeps)` — both now take `pack` as a required parameter, no default; `updateProject(targetDir: string, adapter: UpdateAdapter, templateDir: string, language: string, deps: UpdateDeps = defaultUpdateDeps)` — `templateDir` and `language` are new required parameters, inserted before `deps`

This task combines what would otherwise be two separate changes, because they're genuinely coupled: `update.ts` currently imports the `TEMPLATE_DIR` constant directly from `scaffold.ts` (`import { applyPlaceholders, TEMPLATE_DIR } from '../scaffold';`) — a leftover coupling M11 Tier 3 didn't address, since at the time there was only one template. Removing `TEMPLATE_DIR` from `scaffold.ts` (replaced by `pack.templateDir`) and fixing `update.ts` to take `templateDir` as an explicit parameter have to happen together, or one half of the codebase breaks at runtime (not just typecheck) against the other half mid-task. The `templates/base` → `templates/node` rename rides along here too, for the same reason: `scaffold.ts`'s own template-copy logic is the only thing that still hardcodes the old path.

- [ ] **Step 1: Rename the template directory**

```bash
git mv templates/base templates/node
```

- [ ] **Step 2: Rewrite `scaffold.test.ts` to use `nodeOclifPack`**

Replace `src/scaffold.test.ts` entirely with:

```ts
// src/scaffold.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { copyTemplate, scaffoldProject } from './scaffold';
import { nodeOclifPack } from './languages/packs/node-oclif';
import { NPM_DEFAULT_REGISTRY_URL } from './languages/registry-checkers/npm';
import { UserError } from './errors';

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

    await copyTemplate({ projectName: 'my-cli', targetDir }, nodeOclifPack);

    const pkg = JSON.parse(await readFile(path.join(targetDir, 'package.json'), 'utf8'));
    expect(pkg.name).toBe('my-cli');
    expect(pkg.bin).toEqual({ 'my-cli': './bin/run.ts' });
    expect(pkg.oclif.bin).toBe('my-cli');
    expect(pkg.oclif.dirname).toBe('my-cli');

    const readme = await readFile(path.join(targetDir, 'README.md'), 'utf8');
    expect(readme).toContain('# my-cli');

    const gitignore = await readFile(path.join(targetDir, '.gitignore'), 'utf8');
    expect(gitignore).toContain('node_modules');

    const runTs = await readFile(path.join(targetDir, 'bin', 'run.ts'), 'utf8');
    expect(runTs).toContain('execute');

    const indexTs = await readFile(path.join(targetDir, 'src', 'index.ts'), 'utf8');
    expect(indexTs).toContain("export { run } from '@oclif/core';");

    const loggerTs = await readFile(path.join(targetDir, 'src', 'logger.ts'), 'utf8');
    expect(loggerTs).toContain("envPaths('my-cli'");
    expect(loggerTs).not.toContain('{{projectName}}');

    const baseCommandTs = await readFile(path.join(targetDir, 'src', 'base-command.ts'), 'utf8');
    expect(baseCommandTs).toContain('export abstract class BaseCommand extends Command');

    const helloTs = await readFile(path.join(targetDir, 'src', 'commands', 'hello.ts'), 'utf8');
    expect(helloTs).toContain('export default class Hello extends BaseCommand');

    const helloTestTs = await readFile(path.join(targetDir, 'src', 'commands', 'hello.test.ts'), 'utf8');
    expect(helloTestTs).toContain("runCommand('hello')");

    const architectureMd = await readFile(path.join(targetDir, 'ARCHITECTURE.md'), 'utf8');
    expect(architectureMd).toContain('# my-cli Architecture');
    expect(architectureMd).not.toContain('{{projectName}}');
  });

  it('writes a .npmrc with the custom registry when registryUrl differs from the default', async () => {
    const targetDir = path.join(tmpRoot, 'custom-registry');

    await copyTemplate(
      { projectName: 'custom-registry', targetDir, registryUrl: 'https://registry.example.com' },
      nodeOclifPack,
    );

    const npmrc = await readFile(path.join(targetDir, '.npmrc'), 'utf8');
    expect(npmrc).toBe('registry=https://registry.example.com\n');
  });

  it('does not write a .npmrc when registryUrl is omitted or equal to the default', async () => {
    const targetDirNoUrl = path.join(tmpRoot, 'no-registry-url');
    await copyTemplate({ projectName: 'no-registry-url', targetDir: targetDirNoUrl }, nodeOclifPack);
    await expect(readFile(path.join(targetDirNoUrl, '.npmrc'), 'utf8')).rejects.toThrow();

    const targetDirDefaultUrl = path.join(tmpRoot, 'default-registry-url');
    await copyTemplate(
      {
        projectName: 'default-registry-url',
        targetDir: targetDirDefaultUrl,
        registryUrl: NPM_DEFAULT_REGISTRY_URL,
      },
      nodeOclifPack,
    );
    await expect(readFile(path.join(targetDirDefaultUrl, '.npmrc'), 'utf8')).rejects.toThrow();
  });

  it('marks the generated package.json private when publishIntent is false', async () => {
    const targetDir = path.join(tmpRoot, 'no-publish');

    await copyTemplate({ projectName: 'no-publish', targetDir, publishIntent: false }, nodeOclifPack);

    const pkg = JSON.parse(await readFile(path.join(targetDir, 'package.json'), 'utf8'));
    expect(pkg.private).toBe(true);
  });

  it('does not add a private field when publishIntent is true or omitted', async () => {
    const targetDirTrue = path.join(tmpRoot, 'publish-true');
    await copyTemplate({ projectName: 'publish-true', targetDir: targetDirTrue, publishIntent: true }, nodeOclifPack);
    const pkgTrue = JSON.parse(await readFile(path.join(targetDirTrue, 'package.json'), 'utf8'));
    expect(pkgTrue.private).toBeUndefined();

    const targetDirOmitted = path.join(tmpRoot, 'publish-omitted');
    await copyTemplate({ projectName: 'publish-omitted', targetDir: targetDirOmitted }, nodeOclifPack);
    const pkgOmitted = JSON.parse(await readFile(path.join(targetDirOmitted, 'package.json'), 'utf8'));
    expect(pkgOmitted.private).toBeUndefined();
  });

  it('creates the target directory when it does not exist yet', async () => {
    const targetDir = path.join(tmpRoot, 'new-project');

    await copyTemplate({ projectName: 'new-project', targetDir }, nodeOclifPack);

    const pkg = JSON.parse(await readFile(path.join(targetDir, 'package.json'), 'utf8'));
    expect(pkg.name).toBe('new-project');
  });

  it('succeeds when the target directory exists but is empty', async () => {
    const targetDir = path.join(tmpRoot, 'empty-dir');
    await mkdir(targetDir);

    await copyTemplate({ projectName: 'empty-dir', targetDir }, nodeOclifPack);

    const pkg = JSON.parse(await readFile(path.join(targetDir, 'package.json'), 'utf8'));
    expect(pkg.name).toBe('empty-dir');
  });

  it('throws a clear UserError when the target directory already exists and is not empty', async () => {
    const targetDir = path.join(tmpRoot, 'occupied');
    await mkdir(targetDir);
    await writeFile(path.join(targetDir, 'existing-file.txt'), 'hello');

    await expect(copyTemplate({ projectName: 'occupied', targetDir }, nodeOclifPack)).rejects.toThrow(
      /already exists and is not empty/,
    );
    await expect(copyTemplate({ projectName: 'occupied', targetDir }, nodeOclifPack)).rejects.toBeInstanceOf(
      UserError,
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

    await scaffoldProject({ projectName: 'my-cli', targetDir }, nodeOclifPack, { runCommand });

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

    await expect(scaffoldProject({ projectName: 'fails', targetDir }, nodeOclifPack, { runCommand })).rejects.toThrow(
      'npm install failed',
    );
  });

  it('writes a .clispark/manifest.json with generatorVersion, language, and core file hashes', async () => {
    const targetDir = path.join(tmpRoot, 'manifest-project');
    const runCommand = vi.fn(async () => {});

    await scaffoldProject({ projectName: 'manifest-project', targetDir }, nodeOclifPack, { runCommand });

    const manifest = JSON.parse(await readFile(path.join(targetDir, '.clispark', 'manifest.json'), 'utf8'));
    expect(typeof manifest.generatorVersion).toBe('string');
    expect(manifest.generatorVersion.length).toBeGreaterThan(0);
    expect(manifest.language).toBe('node');
    expect(manifest.coreFiles['src/base-command.ts']).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.coreDependencies['@oclif/core']).toBe('^4.0.0');
    expect(manifest.coreScripts.build).toBe('tsup');
    expect(manifest.coreFields.engines).toEqual({ node: '>=24' });
  });
});
```

- [ ] **Step 3: Run `scaffold.test.ts` to verify it fails**

Run: `npx vitest run src/scaffold.test.ts`
Expected: FAIL — `copyTemplate`/`scaffoldProject` don't accept a `pack` argument yet, and `templates/base` (which the current `scaffold.ts` still points at) no longer exists after Step 1's rename.

- [ ] **Step 4: Rewrite `src/scaffold.ts`**

Replace the file entirely with:

```ts
// src/scaffold.ts
import { cp, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import spawn from 'cross-spawn';
import type { LanguagePack } from './languages/pack';
import { buildManifest, getGeneratorVersion, writeManifest } from './update/manifest';
import { UserError } from './errors';

export interface ScaffoldOptions {
  projectName: string;
  targetDir: string;
  registryUrl?: string;
  publishIntent?: boolean;
}

async function assertTargetDirIsUsable(targetDir: string): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(targetDir);
  } catch {
    return;
  }
  if (entries.length > 0) {
    throw new UserError(`Directory "${targetDir}" already exists and is not empty.`);
  }
}

export function applyPlaceholders(content: string, projectName: string): string {
  return content.replaceAll('{{projectName}}', projectName);
}

async function collectFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const fullPath = path.join(dir, entry.name);
      return entry.isDirectory() ? collectFiles(fullPath) : Promise.resolve([fullPath]);
    }),
  );
  return files.flat();
}

// Scans every copied file rather than a hardcoded list, so a new template file
// that needs {{projectName}} substituted can't silently be forgotten here.
async function replacePlaceholdersInTree(targetDir: string, projectName: string): Promise<void> {
  const files = await collectFiles(targetDir);
  await Promise.all(
    files.map(async (filePath) => {
      const content = await readFile(filePath, 'utf8');
      if (content.includes('{{projectName}}')) {
        await writeFile(filePath, applyPlaceholders(content, projectName));
      }
    }),
  );
}

export async function copyTemplate(options: ScaffoldOptions, pack: LanguagePack): Promise<void> {
  const { projectName, targetDir, registryUrl, publishIntent } = options;

  await assertTargetDirIsUsable(targetDir);
  await cp(pack.templateDir, targetDir, { recursive: true });

  await rename(path.join(targetDir, 'gitignore'), path.join(targetDir, '.gitignore'));

  await replacePlaceholdersInTree(targetDir, projectName);

  if (publishIntent === false) {
    await pack.registry.applyPrivateIntent(targetDir);
  }

  if (registryUrl && registryUrl !== pack.registry.defaultUrl) {
    await writeFile(path.join(targetDir, '.npmrc'), `registry=${registryUrl}\n`);
  }
}

export interface ScaffoldDeps {
  runCommand: (command: string, args: string[], cwd: string) => Promise<void>;
}

async function defaultRunCommand(command: string, args: string[], cwd: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit' });
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
  pack: LanguagePack,
  deps: ScaffoldDeps = defaultScaffoldDeps,
): Promise<void> {
  await copyTemplate(options, pack);

  const { targetDir } = options;
  const manifest = await buildManifest(targetDir, getGeneratorVersion(), pack.id, pack.updateAdapter);
  await writeManifest(targetDir, manifest);

  await deps.runCommand('git', ['init'], targetDir);
  await deps.runCommand('git', ['add', '-A'], targetDir);
  await deps.runCommand('git', ['commit', '-m', 'chore: initial scaffold from clispark'], targetDir);

  for (const scaffoldCommand of pack.scaffoldCommands) {
    await deps.runCommand(scaffoldCommand.command, scaffoldCommand.args, targetDir);
  }
}
```

Note: `git init`/`git add`/`git commit` stay hardcoded and universal (every language gets a git repo the same way) — only the install/build step became data-driven via `pack.scaffoldCommands`. For `nodeOclifPack`, that's still exactly `npm install` then `npm run build`, so the resulting command sequence for Node projects is byte-for-byte identical to today's.

- [ ] **Step 5: Run `scaffold.test.ts` to verify it passes**

Run: `npx vitest run src/scaffold.test.ts`
Expected: PASS, all tests green

- [ ] **Step 6: Rewrite `update.test.ts` to use `nodeOclifPack` and the new `updateProject` signature**

Replace `src/update/update.test.ts` entirely with:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { scaffoldProject } from '../scaffold';
import { formatUpdateSummary, updateProject } from './update';
import { getGeneratorVersion, hashContent, readManifest, type Manifest } from './manifest';
import { CORE_FILE_PATHS } from './adapters/node-oclif';
import { nodeOclifPack } from '../languages/packs/node-oclif';
import { UserError } from '../errors';
import type { UpdateAdapter } from './adapter';

async function scaffoldFixture(tmpRoot: string, name: string): Promise<string> {
  const targetDir = path.join(tmpRoot, name);
  await scaffoldProject({ projectName: name, targetDir }, nodeOclifPack, { runCommand: vi.fn(async () => {}) });
  return targetDir;
}

function cleanGitDeps() {
  return { runCommand: vi.fn(async () => {}), captureCommand: vi.fn(async () => '') };
}

describe('updateProject', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(path.join(tmpdir(), 'clispark-update-test-'));
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it('aborts with a clear UserError when the git working tree is dirty', async () => {
    const targetDir = await scaffoldFixture(tmpRoot, 'dirty-project');
    const deps = {
      runCommand: vi.fn(async () => {}),
      captureCommand: vi.fn(async () => ' M src/commands/hello.ts'),
    };

    await expect(
      updateProject(targetDir, nodeOclifPack.updateAdapter, nodeOclifPack.templateDir, 'node', deps),
    ).rejects.toThrow(/working tree is not clean/i);
    await expect(
      updateProject(targetDir, nodeOclifPack.updateAdapter, nodeOclifPack.templateDir, 'node', deps),
    ).rejects.toBeInstanceOf(UserError);
    expect(deps.runCommand).not.toHaveBeenCalled();
  });

  it('aborts with a clear error when no manifest exists', async () => {
    const targetDir = path.join(tmpRoot, 'no-manifest-project');
    await scaffoldProject({ projectName: 'no-manifest-project', targetDir }, nodeOclifPack, {
      runCommand: vi.fn(async () => {}),
    });
    await rm(path.join(targetDir, '.clispark'), { recursive: true, force: true });

    await expect(
      updateProject(targetDir, nodeOclifPack.updateAdapter, nodeOclifPack.templateDir, 'node', cleanGitDeps()),
    ).rejects.toThrow(/no \.clispark\/manifest\.json found/i);
  });

  it('reports "up-to-date" and makes no changes when the manifest already matches the running version', async () => {
    const targetDir = await scaffoldFixture(tmpRoot, 'fresh-project');
    const deps = cleanGitDeps();

    const result = await updateProject(targetDir, nodeOclifPack.updateAdapter, nodeOclifPack.templateDir, 'node', deps);

    expect(result.status).toBe('up-to-date');
    expect(deps.runCommand).not.toHaveBeenCalled();
  });

  it('reports "up-to-date" and makes no changes when the manifest version is newer than the running version', async () => {
    const targetDir = await scaffoldFixture(tmpRoot, 'ahead-project');

    const manifestPath = path.join(targetDir, '.clispark', 'manifest.json');
    const oldManifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Manifest;
    oldManifest.generatorVersion = '99.0.0';
    await writeFile(manifestPath, JSON.stringify(oldManifest, null, 2) + '\n');

    const deps = cleanGitDeps();
    const result = await updateProject(targetDir, nodeOclifPack.updateAdapter, nodeOclifPack.templateDir, 'node', deps);

    expect(result.status).toBe('up-to-date');
    expect(result.fromVersion).toBe('99.0.0');
    expect(result.toVersion).toBe(getGeneratorVersion());
    expect(result.files).toEqual([]);
    expect(deps.runCommand).not.toHaveBeenCalled();

    const manifestAfter = JSON.parse(await readFile(manifestPath, 'utf8')) as Manifest;
    expect(manifestAfter.generatorVersion).toBe('99.0.0');
  });

  it('replaces unmodified core files, skips a locally-modified one, and commits the result', async () => {
    const targetDir = await scaffoldFixture(tmpRoot, 'stale-project');

    const manifestPath = path.join(targetDir, '.clispark', 'manifest.json');
    const oldManifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Manifest;
    oldManifest.generatorVersion = '0.0.1';
    await writeFile(manifestPath, JSON.stringify(oldManifest, null, 2) + '\n');

    const tsconfigPath = path.join(targetDir, 'tsconfig.json');
    const originalTsconfig = await readFile(tsconfigPath, 'utf8');
    await writeFile(tsconfigPath, originalTsconfig.replace('"strict": true', '"strict": false'));

    const deps = cleanGitDeps();
    const result = await updateProject(targetDir, nodeOclifPack.updateAdapter, nodeOclifPack.templateDir, 'node', deps);

    expect(result.status).toBe('updated');
    expect(result.fromVersion).toBe('0.0.1');
    expect(result.toVersion).toBe(getGeneratorVersion());

    expect(result.files.find((f) => f.path === 'tsconfig.json')?.outcome).toBe('skipped');
    expect(result.files.find((f) => f.path === 'src/base-command.ts')?.outcome).toBe('replaced');

    const tsconfigAfter = await readFile(tsconfigPath, 'utf8');
    expect(tsconfigAfter).toContain('"strict": false');

    const newManifest = await readManifest(targetDir);
    expect(newManifest?.generatorVersion).toBe(getGeneratorVersion());
    expect(newManifest?.language).toBe('node');
    expect(newManifest?.coreFiles['tsconfig.json']).toBe(oldManifest.coreFiles['tsconfig.json']);

    expect(deps.runCommand).toHaveBeenCalledWith('git', ['add', '-A'], targetDir);
    expect(deps.runCommand).toHaveBeenCalledWith(
      'git',
      ['commit', '-m', `chore: update clispark core to v${getGeneratorVersion()}`],
      targetDir,
    );
  });

  it('reports "no-changes" and commits nothing when every core file was modified locally', async () => {
    const targetDir = await scaffoldFixture(tmpRoot, 'fully-diverged-project');

    const manifestPath = path.join(targetDir, '.clispark', 'manifest.json');
    const oldManifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Manifest;
    oldManifest.generatorVersion = '0.0.1';
    await writeFile(manifestPath, JSON.stringify(oldManifest, null, 2) + '\n');

    for (const relativePath of CORE_FILE_PATHS) {
      const filePath = path.join(targetDir, relativePath);
      await writeFile(filePath, (await readFile(filePath, 'utf8')) + '\n// locally modified\n');
    }

    const deps = cleanGitDeps();
    const result = await updateProject(targetDir, nodeOclifPack.updateAdapter, nodeOclifPack.templateDir, 'node', deps);

    expect(result.status).toBe('no-changes');
    expect(result.files.every((f) => f.outcome === 'skipped')).toBe(true);
    expect(deps.runCommand).not.toHaveBeenCalled();

    const manifestAfter = JSON.parse(await readFile(manifestPath, 'utf8')) as Manifest;
    expect(manifestAfter.generatorVersion).toBe('0.0.1');
  });

  it('converges the manifest when the only change is a stale no-longer-core entry, even if every real core file is locally modified', async () => {
    const targetDir = await scaffoldFixture(tmpRoot, 'stale-core-entry-project');

    const manifestPath = path.join(targetDir, '.clispark', 'manifest.json');
    const oldManifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Manifest;
    oldManifest.generatorVersion = '0.0.1';
    oldManifest.coreFiles['src/some-removed-file.ts'] = 'deadbeef';
    await writeFile(manifestPath, JSON.stringify(oldManifest, null, 2) + '\n');
    // The stale entry must still exist on disk locally — the no-longer-core loop only
    // reports paths it can actually find under targetDir.
    await writeFile(path.join(targetDir, 'src', 'some-removed-file.ts'), '// leftover from an older core version\n');

    for (const relativePath of CORE_FILE_PATHS) {
      const filePath = path.join(targetDir, relativePath);
      await writeFile(filePath, (await readFile(filePath, 'utf8')) + '\n// locally modified\n');
    }

    const deps = cleanGitDeps();
    const result = await updateProject(targetDir, nodeOclifPack.updateAdapter, nodeOclifPack.templateDir, 'node', deps);

    expect(result.status).toBe('updated');
    expect(
      result.files
        .filter((f) => (CORE_FILE_PATHS as readonly string[]).includes(f.path))
        .every((f) => f.outcome === 'skipped'),
    ).toBe(true);
    expect(result.files.find((f) => f.path === 'src/some-removed-file.ts')?.outcome).toBe('no-longer-core');

    expect(deps.runCommand).toHaveBeenCalledWith('git', ['add', '-A'], targetDir);
    expect(deps.runCommand).toHaveBeenCalledWith(
      'git',
      ['commit', '-m', `chore: update clispark core to v${getGeneratorVersion()}`],
      targetDir,
    );

    const newManifest = await readManifest(targetDir);
    expect(newManifest?.generatorVersion).toBe(getGeneratorVersion());
    expect(newManifest?.coreFiles['src/some-removed-file.ts']).toBeUndefined();
  });

  it('drives entirely off a fake adapter, proving the generic engine has no hardcoded npm/oclif knowledge', async () => {
    const targetDir = await scaffoldFixture(tmpRoot, 'fake-adapter-project');

    // A hypothetical non-Node adapter: tracks a single core file, and does no
    // package-manifest field merging at all (some ecosystems, e.g. a bare
    // PowerShell module, may not have a meaningful "dependencies" concept).
    const fakeAdapter: UpdateAdapter = {
      coreFilePaths: ['tsconfig.json'],
      templateSourcePath: (relativePath) => relativePath,
      manifestFileName: 'package.json',
      readManifestFile: async (dir) => JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8')),
      writeManifestFile: async () => {
        throw new Error('fakeAdapter never writes the manifest file');
      },
      parseManifestFile: (rawContent) => JSON.parse(rawContent),
      readProjectName: (manifestFile) => (manifestFile as { name: string }).name,
      extractCoreFields: () => ({ coreDependencies: {}, coreScripts: {}, coreFields: {} }),
      mergeManifestFile: () => ({
        updatedFile: {},
        changed: false,
        dependencies: [],
        scripts: [],
        fields: [],
        coreDependencies: {},
        coreScripts: {},
        coreFields: {},
      }),
    };

    const tsconfigHash = hashContent(await readFile(path.join(targetDir, 'tsconfig.json'), 'utf8'));
    const manifestPath = path.join(targetDir, '.clispark', 'manifest.json');
    await writeFile(
      manifestPath,
      JSON.stringify(
        {
          generatorVersion: '0.0.1',
          language: 'fake-language',
          coreFiles: { 'tsconfig.json': tsconfigHash },
          coreDependencies: {},
          coreScripts: {},
          coreFields: {},
        },
        null,
        2,
      ) + '\n',
    );

    const deps = cleanGitDeps();
    const result = await updateProject(targetDir, fakeAdapter, nodeOclifPack.templateDir, 'fake-language', deps);

    expect(result.status).toBe('updated');
    expect(result.files).toEqual([{ path: 'tsconfig.json', outcome: 'replaced' }]);
    expect(result.dependencies).toEqual([]);
    expect(result.scripts).toEqual([]);
    expect(result.fields).toEqual([]);

    const newManifest = await readManifest(targetDir);
    expect(newManifest?.language).toBe('fake-language');
    expect(newManifest?.coreDependencies).toEqual({});
    expect(newManifest?.coreScripts).toEqual({});
    expect(newManifest?.coreFields).toEqual({});
  });
});

describe('formatUpdateSummary', () => {
  it('formats an up-to-date result', () => {
    const summary = formatUpdateSummary({
      status: 'up-to-date',
      fromVersion: '1.0.0',
      toVersion: '1.0.0',
      files: [],
      dependencies: [],
      scripts: [],
      fields: [],
    });
    expect(summary).toContain('Already up to date');
  });

  it('formats an updated result with added/replaced/skipped files', () => {
    const summary = formatUpdateSummary({
      status: 'updated',
      fromVersion: '1.0.0',
      toVersion: '1.1.0',
      files: [
        { path: 'src/new-core-file.ts', outcome: 'added' },
        { path: 'src/base-command.ts', outcome: 'replaced' },
        { path: 'tsconfig.json', outcome: 'skipped' },
      ],
      dependencies: [],
      scripts: [],
      fields: [],
    });
    expect(summary).toContain('src/new-core-file.ts');
    expect(summary).toContain('src/base-command.ts');
    expect(summary).toContain('tsconfig.json');
    expect(summary).toContain('releasenotes');
  });
});
```

(The fake-adapter test now reads its template files from `nodeOclifPack.templateDir` — the fake adapter's `templateSourcePath`/`manifestFileName` still resolve to real files that exist there, so this is a legitimate read, not a mock. Its manifest's `language` is deliberately set to `'fake-language'`, a value `LANGUAGE_PACKS` doesn't even recognize — reinforcing that `updateProject()` itself never looks language up anywhere; it only carries the string through.)

- [ ] **Step 7: Run `update.test.ts` to verify it fails**

Run: `npx vitest run src/update/update.test.ts`
Expected: FAIL — `updateProject` doesn't accept `templateDir`/`language` arguments yet.

- [ ] **Step 8: Rewrite `src/update/update.ts`**

Replace the file entirely with:

```ts
// src/update/update.ts
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import spawn from 'cross-spawn';
import { applyPlaceholders } from '../scaffold';
import { getGeneratorVersion, hashContent, requireManifest, writeManifest, type Manifest } from './manifest';
import { reconcileEntry, stringEquals, type FieldOutcome } from './reconcile';
import { UserError } from '../errors';
import { compareVersions } from './releasenotes';
import type { UpdateAdapter } from './adapter';

export interface UpdateDeps {
  runCommand: (command: string, args: string[], cwd: string) => Promise<void>;
  captureCommand: (command: string, args: string[], cwd: string) => Promise<string>;
}

async function defaultRunCommand(command: string, args: string[], cwd: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command "${command} ${args.join(' ')}" exited with code ${code}`));
    });
  });
}

async function defaultCaptureCommand(command: string, args: string[], cwd: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, { cwd });
    let stdout = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`Command "${command} ${args.join(' ')}" exited with code ${code}`));
    });
  });
}

const defaultUpdateDeps: UpdateDeps = { runCommand: defaultRunCommand, captureCommand: defaultCaptureCommand };

export interface FileOutcomeEntry {
  path: string;
  outcome: 'added' | 'replaced' | 'skipped' | 'no-longer-core';
}

export interface UpdateResult {
  status: 'up-to-date' | 'no-changes' | 'updated';
  fromVersion: string;
  toVersion: string;
  files: FileOutcomeEntry[];
  dependencies: FieldOutcome[];
  scripts: FieldOutcome[];
  fields: FieldOutcome[];
}

export async function updateProject(
  targetDir: string,
  adapter: UpdateAdapter,
  templateDir: string,
  language: string,
  deps: UpdateDeps = defaultUpdateDeps,
): Promise<UpdateResult> {
  const status = (await deps.captureCommand('git', ['status', '--porcelain'], targetDir)).trim();
  if (status.length > 0) {
    throw new UserError('Working tree is not clean. Commit or stash your changes before running update.');
  }

  const oldManifest = await requireManifest(targetDir);
  const toVersion = getGeneratorVersion();
  const fromVersion = oldManifest.generatorVersion;

  if (compareVersions(fromVersion, toVersion) >= 0) {
    return { status: 'up-to-date', fromVersion, toVersion, files: [], dependencies: [], scripts: [], fields: [] };
  }

  const currentManifestFile = await adapter.readManifestFile(targetDir);
  const projectName = adapter.readProjectName(currentManifestFile);

  const newTemplateRaw = applyPlaceholders(
    await readFile(path.join(templateDir, adapter.manifestFileName), 'utf8'),
    projectName,
  );
  const newTemplateManifestFile = adapter.parseManifestFile(newTemplateRaw);

  const files: FileOutcomeEntry[] = [];
  const newCoreFiles: Record<string, string> = {};
  const fileWrites: { targetPath: string; content: string }[] = [];

  // Reads + hashes run in parallel; results are then applied in adapter.coreFilePaths
  // order below so files/fileWrites stay deterministic regardless of I/O timing.
  const perFileResults = await Promise.all(
    adapter.coreFilePaths.map(async (relativePath) => {
      const newContent = applyPlaceholders(
        await readFile(path.join(templateDir, adapter.templateSourcePath(relativePath)), 'utf8'),
        projectName,
      );
      const newHash = hashContent(newContent);

      let currentHash: string | undefined;
      try {
        currentHash = hashContent(await readFile(path.join(targetDir, relativePath), 'utf8'));
      } catch {
        currentHash = undefined;
      }

      const result = reconcileEntry(currentHash, oldManifest.coreFiles[relativePath], newHash, stringEquals);
      return { relativePath, newContent, result };
    }),
  );

  for (const { relativePath, newContent, result } of perFileResults) {
    files.push({ path: relativePath, outcome: result.outcome });
    newCoreFiles[relativePath] = result.value;

    if (result.outcome === 'added' || result.outcome === 'replaced') {
      fileWrites.push({ targetPath: path.join(targetDir, relativePath), content: newContent });
    }
  }

  for (const relativePath of Object.keys(oldManifest.coreFiles)) {
    if (adapter.coreFilePaths.includes(relativePath)) continue;
    try {
      await readFile(path.join(targetDir, relativePath), 'utf8');
      files.push({ path: relativePath, outcome: 'no-longer-core' });
    } catch {
      // already gone locally, nothing to report
    }
  }

  const fileMerge = adapter.mergeManifestFile(currentManifestFile, oldManifest, newTemplateManifestFile);

  const hasFileChanges = files.some(
    (f) => f.outcome === 'added' || f.outcome === 'replaced' || f.outcome === 'no-longer-core',
  );
  const hasChanges = hasFileChanges || fileMerge.changed;

  if (!hasChanges) {
    return {
      status: 'no-changes',
      fromVersion,
      toVersion,
      files,
      dependencies: fileMerge.dependencies,
      scripts: fileMerge.scripts,
      fields: fileMerge.fields,
    };
  }

  for (const write of fileWrites) {
    await mkdir(path.dirname(write.targetPath), { recursive: true });
    await writeFile(write.targetPath, write.content);
  }

  if (fileMerge.changed) {
    await adapter.writeManifestFile(targetDir, fileMerge.updatedFile);
  }

  const newManifest: Manifest = {
    generatorVersion: toVersion,
    language,
    coreFiles: newCoreFiles,
    coreDependencies: fileMerge.coreDependencies,
    coreScripts: fileMerge.coreScripts,
    coreFields: fileMerge.coreFields,
  };
  await writeManifest(targetDir, newManifest);

  await deps.runCommand('git', ['add', '-A'], targetDir);
  await deps.runCommand('git', ['commit', '-m', `chore: update clispark core to v${toVersion}`], targetDir);

  return {
    status: 'updated',
    fromVersion,
    toVersion,
    files,
    dependencies: fileMerge.dependencies,
    scripts: fileMerge.scripts,
    fields: fileMerge.fields,
  };
}

export function formatUpdateSummary(result: UpdateResult): string {
  if (result.status === 'up-to-date') {
    return `Already up to date (v${result.toVersion}).`;
  }

  const added = result.files.filter((f) => f.outcome === 'added');
  const replaced = result.files.filter((f) => f.outcome === 'replaced');
  const skipped = result.files.filter((f) => f.outcome === 'skipped');
  const noLongerCore = result.files.filter((f) => f.outcome === 'no-longer-core');

  const lines: string[] = [];
  if (result.status === 'no-changes') {
    lines.push(
      noLongerCore.length
        ? `No changes applied: nothing to update since v${result.fromVersion}.`
        : `No changes applied: every core file/field has been modified locally since v${result.fromVersion}.`,
    );
  } else {
    lines.push(`Updated core from v${result.fromVersion} to v${result.toVersion}.`);
  }

  if (added.length) lines.push(`  New: ${added.map((f) => f.path).join(', ')}`);
  if (replaced.length) lines.push(`  Updated: ${replaced.map((f) => f.path).join(', ')}`);
  if (skipped.length) lines.push(`  Skipped (locally modified): ${skipped.map((f) => f.path).join(', ')}`);
  if (noLongerCore.length) {
    lines.push(
      `  No longer part of the core, safe to remove manually: ${noLongerCore.map((f) => f.path).join(', ')}`,
    );
  }

  const fieldOutcomes = [...result.dependencies, ...result.scripts, ...result.fields].filter(
    (o) => o.outcome !== 'skipped',
  );
  if (fieldOutcomes.length) {
    lines.push(`  Manifest: ${fieldOutcomes.map((o) => `${o.key} (${o.outcome})`).join(', ')}`);
  }

  if (result.status === 'updated') {
    lines.push('Run "clispark releasenotes" to see what changed.');
  }

  return lines.join('\n');
}
```

- [ ] **Step 9: Run `update.test.ts` to verify it passes**

Run: `npx vitest run src/update/update.test.ts`
Expected: PASS, all tests green

- [ ] **Step 10: Typecheck**

Run: `npm run typecheck`
Expected: still FAILS — confirm the *only* remaining errors are in `src/wizard.ts`, `src/wizard.test.ts`, `src/types.ts`, and `src/cli.ts` (all still reference the old `./registry` module and/or the old `scaffoldProject`/`updateProject` signatures). Resolved by Tasks 6–7.

- [ ] **Step 11: Commit**

```bash
git add templates/ src/scaffold.ts src/scaffold.test.ts src/update/update.ts src/update/update.test.ts
git commit -m "refactor: generalize scaffold.ts and update.ts to take a LanguagePack; rename templates/base to templates/node"
```

---

## Task 6: Generalize `wizard.ts` and `types.ts`

**Files:**
- Modify: `src/wizard.ts`
- Modify: `src/wizard.test.ts`
- Modify: `src/types.ts`

**Interfaces:**
- Consumes: `LANGUAGE_PACKS` (`./languages`); `LanguagePack` (`./languages/pack`); `NameCheckResult` (`./languages/registry-checker`)
- Produces: `WizardAnswers` gains `language: string` (new first field); `runWizard(deps: WizardDeps = defaultDeps)` — `WizardDeps` changes shape from `{ checkAvailability }` to `{ languagePacks: Record<string, LanguagePack> }`

The wizard gains a new first question (language selection, sourced from `deps.languagePacks`) and stops hardcoding npm-specific copy/behavior: project-name validation comes from the selected pack's `validateProjectName`, the registry-URL question's label/default from `pack.registry.promptLabel`/`pack.registry.defaultUrl`, and the availability check from `pack.registry.checkNameAvailability`. The "Do you plan to publish this to npm?" question becomes the language-neutral "Do you plan to publish this?", since the concrete registry (npm today, NuGet later) is no longer implied by the question itself.

- [ ] **Step 1: Update `types.ts`**

Replace `src/types.ts` entirely with:

```ts
// src/types.ts
import type { NameCheckResult } from './languages/registry-checker';

export type Profile = 'work' | 'private';

export interface WizardAnswers {
  language: string;
  projectName: string;
  profile: Profile;
  registryUrl: string;
  publishIntent: boolean;
  nameAvailability: NameCheckResult;
}
```

- [ ] **Step 2: Rewrite `wizard.test.ts`**

Replace `src/wizard.test.ts` entirely with:

```ts
// src/wizard.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NameCheckResult } from './languages/registry-checker';
import type { LanguagePack } from './languages/pack';

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
import { runWizard } from './wizard';

const fakeUpdateAdapter: LanguagePack['updateAdapter'] = {
  coreFilePaths: [],
  templateSourcePath: (p) => p,
  manifestFileName: 'package.json',
  readManifestFile: async () => ({}),
  writeManifestFile: async () => {},
  parseManifestFile: () => ({}),
  readProjectName: () => '',
  extractCoreFields: () => ({ coreDependencies: {}, coreScripts: {}, coreFields: {} }),
  mergeManifestFile: () => ({
    updatedFile: {},
    changed: false,
    dependencies: [],
    scripts: [],
    fields: [],
    coreDependencies: {},
    coreScripts: {},
    coreFields: {},
  }),
};

function fakePack(checkNameAvailability: ReturnType<typeof vi.fn>): LanguagePack {
  return {
    id: 'node',
    displayName: 'Node.js / TypeScript (oclif)',
    templateDir: '/fake/templates/node',
    scaffoldCommands: [],
    validateProjectName: () => undefined,
    updateAdapter: fakeUpdateAdapter,
    registry: {
      defaultUrl: 'https://registry.npmjs.org',
      promptLabel: 'Custom npm registry URL (leave empty for npmjs.org)',
      checkNameAvailability,
      applyPrivateIntent: vi.fn(),
    },
  };
}

describe('runWizard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('asks language, then name, then profile, then returns the answers when the name is available on first try', async () => {
    const checkNameAvailability = vi
      .fn<(name: string, registryUrl: string) => Promise<NameCheckResult>>()
      .mockResolvedValueOnce('available');
    const pack = fakePack(checkNameAvailability);

    vi.mocked(select).mockResolvedValueOnce('node').mockResolvedValueOnce('private').mockResolvedValueOnce(true);
    vi.mocked(text).mockResolvedValueOnce('my-cli');

    const result = await runWizard({ languagePacks: { node: pack } });

    expect(result).toEqual({
      language: 'node',
      projectName: 'my-cli',
      profile: 'private',
      registryUrl: 'https://registry.npmjs.org',
      publishIntent: true,
      nameAvailability: 'available',
    });
    expect(checkNameAvailability).toHaveBeenCalledTimes(1);
    // language is asked before name
    expect(vi.mocked(select).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(text).mock.invocationCallOrder[0]);
  });

  it('warns and re-prompts for the name only (not language/profile) when it is taken, then succeeds', async () => {
    const checkNameAvailability = vi
      .fn<(name: string, registryUrl: string) => Promise<NameCheckResult>>()
      .mockResolvedValueOnce('taken')
      .mockResolvedValueOnce('available');
    const pack = fakePack(checkNameAvailability);

    vi.mocked(select).mockResolvedValueOnce('node').mockResolvedValueOnce('private').mockResolvedValueOnce(true);
    vi.mocked(text).mockResolvedValueOnce('taken-name').mockResolvedValueOnce('free-name');

    const result = await runWizard({ languagePacks: { node: pack } });

    expect(result.projectName).toBe('free-name');
    expect(checkNameAvailability).toHaveBeenCalledTimes(2);
    // language + profile + publish-intent, none re-asked during the name retry loop
    expect(select).toHaveBeenCalledTimes(3);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('taken-name'));
  });

  it('asks for a custom registry URL only when profile is "work"', async () => {
    const checkNameAvailability = vi
      .fn<(name: string, registryUrl: string) => Promise<NameCheckResult>>()
      .mockResolvedValueOnce('available');
    const pack = fakePack(checkNameAvailability);

    vi.mocked(select).mockResolvedValueOnce('node').mockResolvedValueOnce('work').mockResolvedValueOnce(true);
    vi.mocked(text).mockResolvedValueOnce('my-cli').mockResolvedValueOnce('https://npm.mycompany.dev');

    const result = await runWizard({ languagePacks: { node: pack } });

    expect(result.registryUrl).toBe('https://npm.mycompany.dev');
    expect(checkNameAvailability).toHaveBeenCalledWith('my-cli', 'https://npm.mycompany.dev');
  });

  it('continues with "unverified" and a warning when the registry check fails', async () => {
    const checkNameAvailability = vi
      .fn<(name: string, registryUrl: string) => Promise<NameCheckResult>>()
      .mockResolvedValueOnce('unverified');
    const pack = fakePack(checkNameAvailability);

    vi.mocked(select).mockResolvedValueOnce('node').mockResolvedValueOnce('private').mockResolvedValueOnce(true);
    vi.mocked(text).mockResolvedValueOnce('my-cli');

    const result = await runWizard({ languagePacks: { node: pack } });

    expect(result.nameAvailability).toBe('unverified');
    expect(log.warn).toHaveBeenCalled();
  });

  it('skips the availability check entirely when publish intent is No', async () => {
    const checkNameAvailability = vi.fn<(name: string, registryUrl: string) => Promise<NameCheckResult>>();
    const pack = fakePack(checkNameAvailability);

    vi.mocked(select).mockResolvedValueOnce('node').mockResolvedValueOnce('private').mockResolvedValueOnce(false);
    vi.mocked(text).mockResolvedValueOnce('my-cli');

    const result = await runWizard({ languagePacks: { node: pack } });

    expect(result.publishIntent).toBe(false);
    expect(result.nameAvailability).toBe('skipped');
    expect(checkNameAvailability).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/wizard.test.ts`
Expected: FAIL — `runWizard` doesn't accept a `languagePacks` dependency yet, and `./languages/registry-checker`/`./languages/pack` don't exist from `wizard.test.ts`'s perspective until `wizard.ts` itself is rewritten (the test file's own new imports are fine; it's `runWizard`'s current implementation that doesn't match).

- [ ] **Step 4: Rewrite `src/wizard.ts`**

Replace the file entirely with:

```ts
// src/wizard.ts
import { intro, outro, text, select, log, isCancel, cancel } from '@clack/prompts';
import { LANGUAGE_PACKS } from './languages';
import type { LanguagePack } from './languages/pack';
import type { NameCheckResult } from './languages/registry-checker';
import type { Profile, WizardAnswers } from './types';

export interface WizardDeps {
  languagePacks: Record<string, LanguagePack>;
}

const defaultDeps: WizardDeps = {
  languagePacks: LANGUAGE_PACKS,
};

function exitIfCancelled(value: unknown): void {
  if (isCancel(value)) {
    cancel('Operation cancelled.');
    process.exit(1);
  }
}

export async function runWizard(deps: WizardDeps = defaultDeps): Promise<WizardAnswers> {
  intro('clispark — scaffold a new CLI project');

  const packs = Object.values(deps.languagePacks);
  const languageValue = await select({
    message: 'Which language?',
    options: packs.map((pack) => ({ value: pack.id, label: pack.displayName })),
  });
  exitIfCancelled(languageValue);
  const pack = deps.languagePacks[languageValue as string];

  const nameValue = await text({
    message: 'Project name',
    validate: pack.validateProjectName,
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

  let registryUrl = pack.registry.defaultUrl;
  if (profile === 'work') {
    const registryValue = await text({
      message: pack.registry.promptLabel,
      placeholder: pack.registry.defaultUrl,
      defaultValue: pack.registry.defaultUrl,
    });
    exitIfCancelled(registryValue);
    registryUrl = (registryValue as string) || pack.registry.defaultUrl;
  }

  const publishIntentValue = await select({
    message: 'Do you plan to publish this?',
    options: [
      { value: false, label: 'No' },
      { value: true, label: 'Yes' },
    ],
    initialValue: false,
  });
  exitIfCancelled(publishIntentValue);
  const publishIntent = publishIntentValue as boolean;

  let nameAvailability: NameCheckResult = 'skipped';

  if (publishIntent) {
    nameAvailability = await pack.registry.checkNameAvailability(projectName, registryUrl);

    while (nameAvailability === 'taken') {
      log.warn(`"${projectName}" is already taken on ${registryUrl}. Please choose a different name.`);

      const retryValue = await text({
        message: 'Project name',
        validate: pack.validateProjectName,
      });
      exitIfCancelled(retryValue);
      projectName = retryValue as string;

      nameAvailability = await pack.registry.checkNameAvailability(projectName, registryUrl);
    }

    if (nameAvailability === 'unverified') {
      log.warn(`Could not verify availability of "${projectName}" on ${registryUrl}. Continuing anyway.`);
    }
  }

  outro(`Ready to scaffold "${projectName}".`);

  return { language: pack.id, projectName, profile, registryUrl, publishIntent, nameAvailability };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/wizard.test.ts`
Expected: PASS, all tests green

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: still FAILS — confirm the *only* remaining errors are in `src/cli.ts` (still calls `scaffoldProject`/`updateProject` with the old signatures and imports the now-removed `nodeOclifAdapter` directly). Resolved by Task 7.

- [ ] **Step 7: Commit**

```bash
git add src/wizard.ts src/wizard.test.ts src/types.ts
git commit -m "refactor: generalize wizard.ts to select a LanguagePack instead of hardcoding npm"
```

---

## Task 7: Generalize `cli.ts`

**Files:**
- Modify: `src/cli.ts`

**Interfaces:**
- Consumes: `LANGUAGE_PACKS` (`./languages`); `LanguagePack` (`./languages/pack`); `requireManifest` (`./update/manifest`, newly imported here); `UserError` (`./errors`)
- Produces: nothing new — this is the composition root where everything converges

`cli.ts` is one of the two files allowed to resolve a concrete `LanguagePack` (the other being the wizard's default `LANGUAGE_PACKS` dependency). The `scaffold` action resolves the pack the user picked in the wizard. The `update` action resolves the pack from the *target project's own manifest* — `clispark update` runs inside an already-scaffolded project and must pick the right pack without asking, via the manifest's `language` field. **Backward compatibility:** projects scaffolded before this plan have no `language` field in their manifest at all; `manifest.language ?? 'node'` falls back to the only language that existed before this field was introduced. This fallback lives here, in `cli.ts` — not in `manifest.ts`/`update.ts`, which stay fully generic per this plan's Global Constraints.

**Named, deliberate exception to "zero behavior change" (see Global Constraints):** `cli.ts`'s `update` action now calls `requireManifest()` itself, before calling `updateProject()` (which also calls `requireManifest()` internally, unchanged, for its own dirty-tree-then-manifest check sequence — a small, harmless duplication, not worth restructuring `updateProject()`'s public API to avoid). If a target directory has BOTH a dirty git tree AND a missing manifest, the error reported changes from "Working tree is not clean" to "No .clispark/manifest.json found" — because `cli.ts` needs to know the manifest's `language` field before it can even construct the arguments `updateProject()` needs. No test today asserts the ordering of these two independent error conditions when both apply simultaneously, and arguably the new message is more useful here (a missing manifest means the target isn't a clispark project at all, which matters more than its git status).

- [ ] **Step 1: Rewrite `src/cli.ts`**

Replace the file entirely with:

```ts
// src/cli.ts
import path from 'node:path';
import { Command } from 'commander';
import { runWizard } from './wizard';
import { scaffoldProject } from './scaffold';
import { withLogging } from './logger';
import { formatUpdateSummary, updateProject } from './update/update';
import { fetchReleaseNotes, formatReleaseNotes } from './update/releasenotes';
import { getGeneratorVersion, requireManifest } from './update/manifest';
import { LANGUAGE_PACKS } from './languages';
import type { LanguagePack } from './languages/pack';
import { UserError } from './errors';

const program = new Command();

program
  .name('clispark')
  .description('Interactive scaffolding tool for new CLI projects')
  .version(getGeneratorVersion());

function resolvePack(language: string): LanguagePack {
  const pack = LANGUAGE_PACKS[language];
  if (!pack) {
    throw new UserError(`Unknown language "${language}" — is your clispark installation out of date?`);
  }
  return pack;
}

program.action(
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
  }),
);

program
  .command('update')
  .description('Update generator-managed core files and dependencies to the latest clispark version')
  .action(
    withLogging('update', async (logger) => {
      const targetDir = process.cwd();
      const manifest = await requireManifest(targetDir);
      const language = manifest.language ?? 'node';
      const pack = resolvePack(language);
      logger.info({ targetDir, language }, 'update started');
      const result = await updateProject(targetDir, pack.updateAdapter, pack.templateDir, language);
      logger.info({ status: result.status }, 'update completed');
      console.log(formatUpdateSummary(result));
    }),
  );

program
  .command('releasenotes')
  .description("Show what changed between this project's generator version and the latest clispark version")
  .action(
    withLogging('releasenotes', async (logger) => {
      const targetDir = process.cwd();
      logger.info({ targetDir }, 'releasenotes started');
      const result = await fetchReleaseNotes(targetDir);
      logger.info({ status: result.status }, 'releasenotes completed');
      console.log(formatReleaseNotes(result));
    }),
  );

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
```

`cli.ts` has no dedicated unit test file today (it's the composition root, verified via typecheck plus the real end-to-end verification in Task 8) — this task doesn't add one, consistent with that existing pattern.

- [ ] **Step 2: Full typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: both PASS with zero errors — this is the first point in the plan where the whole codebase compiles again.

- [ ] **Step 3: Full test suite**

Run: `npm test`
Expected: PASS, all tests green.

- [ ] **Step 4: Commit**

```bash
git add src/cli.ts
git commit -m "refactor: wire cli.ts to resolve a LanguagePack for scaffold and update"
```

---

## Task 8: Full verification (automated + real end-to-end, including backward compatibility)

**Files:**
- Create (temporary, deleted at the end): `scripts/verify-m12a-manual.ts`

No new interfaces — this task verifies the prior seven tasks produced working, behavior-preserving software, plus proves the one genuinely new risk this plan introduces: a project scaffolded *before* this plan (no `language` field in its manifest) must still `clispark update` correctly.

- [ ] **Step 1: Full automated suite**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all three PASS.

- [ ] **Step 2: Write a real end-to-end verification script**

Create `scripts/verify-m12a-manual.ts`:

```ts
// Temporary manual verification script for M12a — deleted after use, not committed.
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { scaffoldProject } from '../src/scaffold';
import { updateProject, formatUpdateSummary } from '../src/update/update';
import { nodeOclifPack } from '../src/languages/packs/node-oclif';
import type { Manifest } from '../src/update/manifest';

async function main() {
  const tmpRoot = await mkdtemp(path.join(tmpdir(), 'clispark-m12a-verify-'));

  // Part 1: real scaffold via the new LanguagePack-driven flow, unchanged Node behavior
  const targetDir = path.join(tmpRoot, 'verify-project');
  console.log('Scaffolding a real project via nodeOclifPack...');
  await scaffoldProject({ projectName: 'verify-project', targetDir }, nodeOclifPack);

  const manifestPath = path.join(targetDir, '.clispark', 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Manifest;
  if (manifest.language !== 'node') {
    throw new Error(`Expected manifest.language "node", got "${manifest.language}"`);
  }
  console.log('Manifest correctly records language: node.');

  console.log('Downgrading the manifest to simulate an old project...');
  manifest.generatorVersion = '0.0.1';
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  spawnSync('git', ['add', '-A'], { cwd: targetDir, stdio: 'inherit' });
  spawnSync('git', ['commit', '-m', 'chore: simulate old manifest'], { cwd: targetDir, stdio: 'inherit' });

  console.log('Running updateProject() with nodeOclifPack...');
  const result = await updateProject(targetDir, nodeOclifPack.updateAdapter, nodeOclifPack.templateDir, 'node');
  console.log(formatUpdateSummary(result));
  if (result.status !== 'updated') {
    throw new Error(`Expected status "updated", got "${result.status}"`);
  }

  console.log("Running the generated project's own test suite after the update...");
  const testRun = spawnSync('npm', ['test'], { cwd: targetDir, stdio: 'inherit' });
  if (testRun.status !== 0) {
    throw new Error('Generated project tests failed after update');
  }

  // Part 2: backward compatibility — a manifest with NO language field (pre-M12a projects)
  const legacyTargetDir = path.join(tmpRoot, 'legacy-project');
  console.log('\nScaffolding a second project to simulate a pre-M12a legacy manifest...');
  await scaffoldProject({ projectName: 'legacy-project', targetDir: legacyTargetDir }, nodeOclifPack);

  const legacyManifestPath = path.join(legacyTargetDir, '.clispark', 'manifest.json');
  const legacyManifestRaw = JSON.parse(await readFile(legacyManifestPath, 'utf8')) as Record<string, unknown>;
  delete legacyManifestRaw.language;
  legacyManifestRaw.generatorVersion = '0.0.1';
  await writeFile(legacyManifestPath, JSON.stringify(legacyManifestRaw, null, 2) + '\n');
  spawnSync('git', ['add', '-A'], { cwd: legacyTargetDir, stdio: 'inherit' });
  spawnSync('git', ['commit', '-m', 'chore: simulate pre-M12a manifest without language field'], {
    cwd: legacyTargetDir,
    stdio: 'inherit',
  });

  console.log('Resolving the legacy project the same way cli.ts does (manifest.language ?? "node")...');
  const legacyManifestParsed = JSON.parse(await readFile(legacyManifestPath, 'utf8')) as Manifest;
  const legacyLanguage = legacyManifestParsed.language ?? 'node';
  if (legacyLanguage !== 'node') {
    throw new Error(`Expected fallback language "node", got "${legacyLanguage}"`);
  }

  const legacyResult = await updateProject(
    legacyTargetDir,
    nodeOclifPack.updateAdapter,
    nodeOclifPack.templateDir,
    legacyLanguage,
  );
  if (legacyResult.status !== 'updated') {
    throw new Error(`Expected legacy project status "updated", got "${legacyResult.status}"`);
  }

  const legacyManifestAfter = JSON.parse(await readFile(legacyManifestPath, 'utf8')) as Manifest;
  if (legacyManifestAfter.language !== 'node') {
    throw new Error('Expected the legacy manifest to be self-healed with language: "node" after update');
  }
  console.log('Legacy manifest (no language field) correctly fell back to "node" and is now self-healed.');

  console.log(`\nAll checks passed. Verified projects left at: ${tmpRoot}`);
  await rm(tmpRoot, { recursive: true, force: true });
  console.log('Cleaned up temp directory.');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 3: Run it**

Run: `npx tsx scripts/verify-m12a-manual.ts`
Expected: both parts succeed — a fresh scaffold via `nodeOclifPack` produces a manifest with `language: "node"`, `update` reports `status: 'updated'` with real file replacements, the generated project's own `npm test` passes; separately, a manifest with the `language` field manually stripped (simulating a pre-M12a project) still resolves to `'node'` and successfully updates, and the manifest is self-healed with the field present afterward.

If it fails: read the error, fix the underlying issue in the relevant task's files (not in this script), re-run from Step 1 of this task.

- [ ] **Step 4: Delete the verification script**

```bash
rm scripts/verify-m12a-manual.ts
```

Confirm it's gone and not staged:

```bash
git status --short scripts/
```

Expected: no output (clean).

- [ ] **Step 5: Final full check**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all three PASS — confirms the deleted verification script left no trace and nothing regressed.

No commit for this task (nothing but the deleted temp script changed, and that was never committed).

---

## After This Plan

The generic scaffold/wizard/CLI layer now takes a `LanguagePack` wherever it previously hardcoded npm/oclif specifics, mirroring what M11 Tier 3 already did for the update system. The next plan (M12b, separate) adds the second concrete pack — a `.NET` template consuming this same architecture (System.CommandLine, Serilog, xUnit, `dotnet tool install -g` packaging, a NuGet `UpdateAdapter` and `RegistryChecker`) — without needing further changes to `wizard.ts`, `scaffold.ts`, `cli.ts`, `manifest.ts`, `update.ts`, or `reconcile.ts`. Update `project-ideas/clispark.plan.md`'s M12 entry with a summary once this plan's tasks are merged, per the project's standing "keep plans updated" convention.

