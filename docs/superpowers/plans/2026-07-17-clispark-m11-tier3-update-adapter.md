# M11 Tier 3: Update-System Adapter Decoupling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract an `UpdateAdapter` interface out of the update system so `src/update/manifest.ts` and `src/update/update.ts` no longer hardcode npm/oclif specifics (file lists, `package.json`, the `oclif`/`engines` fields) — with exactly one concrete adapter (`node-oclif`) preserving today's behavior unchanged.

**Architecture:** A new `UpdateAdapter` interface (`src/update/adapter.ts`) captures everything template/language-specific: which files are generator-managed, and how the package manifest is read/written/merged. `src/update/adapters/node-oclif.ts` is the one concrete implementation (today's npm/oclif behavior, moved behind the interface). `manifest.ts` and `update.ts` take the adapter as a required parameter — no default, no import of the concrete adapter — so they cannot silently regain npm/oclif knowledge. `scaffold.ts` and `cli.ts`, which already hardcode the Node/oclif template elsewhere (`TEMPLATE_DIR`), are the two places that explicitly wire in `nodeOclifAdapter`.

**Tech Stack:** TypeScript (ESM, `"type": "module"`, no `.js` import extensions), vitest, existing DI pattern (`ScaffoldDeps`/`UpdateDeps` — injectable dependencies with defaults where appropriate).

Full design: `docs/superpowers/specs/2026-07-17-clispark-m11-tier3-update-adapter-design.md`

## Global Constraints

- No `.js` extensions on relative imports (project uses `moduleResolution: "Bundler"`).
- `manifest.ts` and `update.ts` must never import `src/update/adapters/node-oclif.ts` — the adapter is always a required parameter, never a default. This is the actual proof of decoupling; a default value would silently reintroduce the coupling.
- `scaffold.ts` and `cli.ts` are the only two files allowed to import `nodeOclifAdapter` directly (they already hardcode the Node/oclif template elsewhere: `TEMPLATE_DIR`, `npm install`).
- Follow the existing DI pattern: injectable dependencies are plain parameters, with a `defaultXDeps` constant only where the existing code already has one (`UpdateDeps`, `ScaffoldDeps` keep their defaults — only the new `adapter` parameter is required with no default).
- `UserError` (`src/errors.ts`) for expected, user-fixable failures; never for internal/unexpected ones.
- Every behavior change must be zero for existing Node/oclif projects — this is a structural refactor, not a feature change. Any test whose assertions change value (not just call-signature) is a bug.

---

## Task 1: `FieldOutcome` type and the `UpdateAdapter` interface

**Files:**
- Modify: `src/update/reconcile.ts`
- Create: `src/update/adapter.ts`

**Interfaces:**
- Produces: `FieldOutcome` (`src/update/reconcile.ts`): `{ key: string; outcome: ReconcileOutcome }`
- Produces: `UpdateAdapter`, `CoreFieldsExtraction`, `ManifestFileMergeResult` (`src/update/adapter.ts`), exact shapes below

This task only adds new type declarations — nothing imports them yet, so there is no runtime behavior to unit-test. Verification is `tsc --noEmit` and `eslint`.

- [ ] **Step 1: Add `FieldOutcome` to `reconcile.ts`**

Modify `src/update/reconcile.ts` — insert the new interface directly after `ReconcileOutcome`:

```ts
export type ReconcileOutcome = 'added' | 'replaced' | 'skipped';

/** A named field/dependency/script whose reconciliation outcome should be reported to the user (e.g. "pino: replaced"). */
export interface FieldOutcome {
  key: string;
  outcome: ReconcileOutcome;
}

export interface ReconcileResult<T> {
  outcome: ReconcileOutcome;
  value: T;
}
```

(The rest of the file — `reconcileEntry`, `stringEquals`, `deepEquals` — is unchanged.)

- [ ] **Step 2: Create `src/update/adapter.ts`**

```ts
// src/update/adapter.ts
import type { Manifest } from './manifest';
import type { FieldOutcome } from './reconcile';

export interface CoreFieldsExtraction {
  coreDependencies: Record<string, string>;
  coreScripts: Record<string, string>;
  coreFields: Record<string, unknown>;
}

export interface ManifestFileMergeResult extends CoreFieldsExtraction {
  updatedFile: unknown;
  changed: boolean;
  dependencies: FieldOutcome[];
  scripts: FieldOutcome[];
  fields: FieldOutcome[];
}

/**
 * Isolates everything template/language-specific from the generic update
 * engine (manifest.ts, update.ts): which files are generator-managed, and
 * how the package manifest is read, written, and three-way-merged. One
 * concrete implementation exists today (adapters/node-oclif.ts); a future
 * non-Node template would add a sibling adapter without touching the
 * generic engine.
 */
export interface UpdateAdapter {
  readonly coreFilePaths: readonly string[];
  templateSourcePath(relativePath: string): string;

  readonly manifestFileName: string;
  readManifestFile(dir: string): Promise<unknown>;
  writeManifestFile(dir: string, content: unknown): Promise<void>;
  parseManifestFile(rawContent: string): unknown;
  readProjectName(manifestFile: unknown): string;
  extractCoreFields(manifestFile: unknown): CoreFieldsExtraction;
  mergeManifestFile(current: unknown, oldManifest: Manifest, newTemplate: unknown): ManifestFileMergeResult;
}
```

- [ ] **Step 3: Verify it compiles and lints**

Run: `npm run typecheck && npm run lint`
Expected: both PASS with no errors (the new file isn't imported anywhere yet, but `tsc --noEmit` type-checks everything under `src/` regardless).

- [ ] **Step 4: Commit**

```bash
git add src/update/reconcile.ts src/update/adapter.ts
git commit -m "feat: add UpdateAdapter interface for update-system decoupling"
```

---

## Task 2: Concrete `node-oclif` adapter

**Files:**
- Create: `src/update/adapters/node-oclif.ts`
- Create: `src/update/adapters/node-oclif.test.ts`

**Interfaces:**
- Consumes: `UpdateAdapter`, `CoreFieldsExtraction`, `ManifestFileMergeResult` (`../adapter`); `Manifest` (`../manifest`, still today's shape at this point in the plan); `FieldOutcome`, `reconcileEntry`, `stringEquals`, `deepEquals` (`../reconcile`)
- Produces: `nodeOclifAdapter: UpdateAdapter`, `CORE_FILE_PATHS`, `CORE_SCRIPT_NAMES`, `PackageJsonShape` (all from `src/update/adapters/node-oclif.ts`)

This is a pure move: `manifest.ts`'s `CORE_FILE_PATHS`/`CORE_SCRIPT_NAMES`/`templateSourcePath`/`extractCoreFields` and `update-package-json.ts`'s `mergePackageJson` land here unchanged in behavior, wrapped by `nodeOclifAdapter`. The old files are untouched in this task (still exported, still used by `update.ts` — removed in Tasks 3–4), so nothing else in the codebase is affected yet.

- [ ] **Step 1: Write the adapter's tests**

Create `src/update/adapters/node-oclif.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { nodeOclifAdapter, type PackageJsonShape } from './node-oclif';
import type { Manifest } from '../manifest';

function baseManifest(overrides: Partial<Manifest> = {}): Manifest {
  return {
    generatorVersion: '1.0.0',
    coreFiles: {},
    coreDependencies: {},
    coreScripts: {},
    coreFields: { engines: {}, oclif: {} },
    ...overrides,
  };
}

describe('nodeOclifAdapter.templateSourcePath', () => {
  it('maps .gitignore to the un-dotted "gitignore" template file', () => {
    expect(nodeOclifAdapter.templateSourcePath('.gitignore')).toBe('gitignore');
  });

  it('leaves every other path unchanged', () => {
    expect(nodeOclifAdapter.templateSourcePath('src/base-command.ts')).toBe('src/base-command.ts');
  });
});

describe('nodeOclifAdapter.extractCoreFields', () => {
  it('merges dependencies and devDependencies into coreDependencies', () => {
    const result = nodeOclifAdapter.extractCoreFields({
      dependencies: { pino: '^9.0.0' },
      devDependencies: { vitest: '^2.0.0' },
    });
    expect(result.coreDependencies).toEqual({ pino: '^9.0.0', vitest: '^2.0.0' });
  });

  it('only includes known core script names', () => {
    const result = nodeOclifAdapter.extractCoreFields({
      scripts: { build: 'tsup', 'my-custom-script': 'do-thing' },
    });
    expect(result.coreScripts).toEqual({ build: 'tsup' });
    expect(result.coreScripts).not.toHaveProperty('my-custom-script');
  });

  it('defaults engines/oclif/dependencies/scripts to empty objects when missing', () => {
    const result = nodeOclifAdapter.extractCoreFields({});
    expect(result.coreFields).toEqual({ engines: {}, oclif: {} });
    expect(result.coreDependencies).toEqual({});
    expect(result.coreScripts).toEqual({});
  });
});

describe('nodeOclifAdapter.readProjectName', () => {
  it('reads the name field from a parsed manifest file', () => {
    expect(nodeOclifAdapter.readProjectName({ name: 'my-cli', version: '0.0.0' })).toBe('my-cli');
  });
});

describe('nodeOclifAdapter.parseManifestFile', () => {
  it('parses JSON content into an object', () => {
    expect(nodeOclifAdapter.parseManifestFile('{"name":"my-cli"}')).toEqual({ name: 'my-cli' });
  });
});

describe('nodeOclifAdapter.readManifestFile / writeManifestFile', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(path.join(tmpdir(), 'clispark-node-oclif-adapter-test-'));
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it('round-trips a package.json through write then read', async () => {
    await nodeOclifAdapter.writeManifestFile(tmpRoot, { name: 'my-cli', version: '1.0.0' });
    const content = await readFile(path.join(tmpRoot, 'package.json'), 'utf8');
    expect(content.endsWith('\n')).toBe(true);
    expect(await nodeOclifAdapter.readManifestFile(tmpRoot)).toEqual({ name: 'my-cli', version: '1.0.0' });
  });
});

describe('nodeOclifAdapter.mergeManifestFile', () => {
  it('adds a brand-new core dependency the project never had', () => {
    const current: PackageJsonShape = { name: 'my-cli', version: '0.0.0', dependencies: {} };
    const newTemplate: PackageJsonShape = {
      name: '{{projectName}}',
      version: '0.0.0',
      dependencies: { pino: '^9.6.0' },
    };

    const result = nodeOclifAdapter.mergeManifestFile(current, baseManifest(), newTemplate);

    expect(result.changed).toBe(true);
    expect((result.updatedFile as PackageJsonShape).dependencies).toEqual({ pino: '^9.6.0' });
    expect(result.dependencies).toEqual([{ key: 'pino', outcome: 'added' }]);
    expect(result.coreDependencies).toEqual({ pino: '^9.6.0' });
  });

  it('bumps a dependency version the user never touched', () => {
    const current: PackageJsonShape = { name: 'my-cli', version: '0.0.0', dependencies: { pino: '^9.6.0' } };
    const newTemplate: PackageJsonShape = {
      name: '{{projectName}}',
      version: '0.0.0',
      dependencies: { pino: '^9.7.0' },
    };
    const manifest = baseManifest({ coreDependencies: { pino: '^9.6.0' } });

    const result = nodeOclifAdapter.mergeManifestFile(current, manifest, newTemplate);

    expect(result.changed).toBe(true);
    expect((result.updatedFile as PackageJsonShape).dependencies).toEqual({ pino: '^9.7.0' });
    expect(result.dependencies).toEqual([{ key: 'pino', outcome: 'replaced' }]);
  });

  it('skips a dependency version the user manually changed, keeping their value', () => {
    const current: PackageJsonShape = { name: 'my-cli', version: '0.0.0', dependencies: { pino: '^8.0.0' } };
    const newTemplate: PackageJsonShape = {
      name: '{{projectName}}',
      version: '0.0.0',
      dependencies: { pino: '^9.7.0' },
    };
    const manifest = baseManifest({ coreDependencies: { pino: '^9.6.0' } });

    const result = nodeOclifAdapter.mergeManifestFile(current, manifest, newTemplate);

    expect((result.updatedFile as PackageJsonShape).dependencies).toEqual({ pino: '^8.0.0' });
    expect(result.dependencies).toEqual([{ key: 'pino', outcome: 'skipped' }]);
    expect(result.coreDependencies).toEqual({ pino: '^9.6.0' });
  });

  it('never touches a dependency the user added themselves', () => {
    const current: PackageJsonShape = {
      name: 'my-cli',
      version: '0.0.0',
      dependencies: { 'my-own-lib': '^1.0.0' },
    };
    const newTemplate: PackageJsonShape = { name: '{{projectName}}', version: '0.0.0', dependencies: {} };

    const result = nodeOclifAdapter.mergeManifestFile(current, baseManifest(), newTemplate);

    expect((result.updatedFile as PackageJsonShape).dependencies).toEqual({ 'my-own-lib': '^1.0.0' });
    expect(result.dependencies).toEqual([]);
  });

  it('only merges known core script names, ignoring custom scripts', () => {
    const current: PackageJsonShape = {
      name: 'my-cli',
      version: '0.0.0',
      scripts: { build: 'old-build', 'my-script': 'do-thing' },
    };
    const newTemplate: PackageJsonShape = {
      name: '{{projectName}}',
      version: '0.0.0',
      scripts: { build: 'tsup' },
    };
    const manifest = baseManifest({ coreScripts: { build: 'old-build' } });

    const result = nodeOclifAdapter.mergeManifestFile(current, manifest, newTemplate);

    expect((result.updatedFile as PackageJsonShape).scripts).toEqual({ build: 'tsup', 'my-script': 'do-thing' });
    expect(result.scripts).toEqual([{ key: 'build', outcome: 'replaced' }]);
  });

  it('replaces engines/oclif as whole objects when unmodified, skips when the user edited them', () => {
    const current: PackageJsonShape = {
      name: 'my-cli',
      version: '0.0.0',
      engines: { node: '>=18' },
      oclif: { bin: 'my-cli', commands: './dist/commands' },
    };
    const newTemplate: PackageJsonShape = {
      name: '{{projectName}}',
      version: '0.0.0',
      engines: { node: '>=20' },
      oclif: { bin: '{{projectName}}', commands: './dist/commands' },
    };
    const manifest = baseManifest({
      coreFields: { engines: { node: '>=18' }, oclif: { bin: 'my-cli', commands: './dist/commands' } },
    });

    const result = nodeOclifAdapter.mergeManifestFile(current, manifest, newTemplate);

    expect((result.updatedFile as PackageJsonShape).engines).toEqual({ node: '>=20' });
    expect((result.updatedFile as PackageJsonShape).oclif).toEqual({
      bin: '{{projectName}}',
      commands: './dist/commands',
    });
    expect(result.fields).toEqual([
      { key: 'engines', outcome: 'replaced' },
      { key: 'oclif', outcome: 'replaced' },
    ]);
  });

  it('accumulates multiple dependency updates in the same section instead of losing all but the last', () => {
    const current: PackageJsonShape = {
      name: 'my-cli',
      version: '0.0.0',
      dependencies: { pino: '^9.6.0', chalk: '^5.0.0' },
    };
    const newTemplate: PackageJsonShape = {
      name: '{{projectName}}',
      version: '0.0.0',
      dependencies: { pino: '^9.7.0', chalk: '^5.1.0' },
    };
    const manifest = baseManifest({ coreDependencies: { pino: '^9.6.0', chalk: '^5.0.0' } });

    const result = nodeOclifAdapter.mergeManifestFile(current, manifest, newTemplate);

    expect((result.updatedFile as PackageJsonShape).dependencies).toEqual({ pino: '^9.7.0', chalk: '^5.1.0' });
  });

  it('accumulates multiple core script updates in the same call instead of losing all but the last', () => {
    const current: PackageJsonShape = {
      name: 'my-cli',
      version: '0.0.0',
      scripts: { build: 'old-build', test: 'old-test' },
    };
    const newTemplate: PackageJsonShape = {
      name: '{{projectName}}',
      version: '0.0.0',
      scripts: { build: 'tsup', test: 'vitest run' },
    };
    const manifest = baseManifest({ coreScripts: { build: 'old-build', test: 'old-test' } });

    const result = nodeOclifAdapter.mergeManifestFile(current, manifest, newTemplate);

    expect((result.updatedFile as PackageJsonShape).scripts).toEqual({ build: 'tsup', test: 'vitest run' });
  });

  it('reports changed:false when every value already matches (nothing to write)', () => {
    const current: PackageJsonShape = { name: 'my-cli', version: '0.0.0', dependencies: { pino: '^9.6.0' } };
    const newTemplate: PackageJsonShape = {
      name: '{{projectName}}',
      version: '0.0.0',
      dependencies: { pino: '^9.6.0' },
    };
    const manifest = baseManifest({ coreDependencies: { pino: '^9.6.0' } });

    const result = nodeOclifAdapter.mergeManifestFile(current, manifest, newTemplate);

    expect(result.changed).toBe(false);
    expect(result.dependencies).toEqual([{ key: 'pino', outcome: 'replaced' }]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail (module doesn't exist yet)**

Run: `npx vitest run src/update/adapters/node-oclif.test.ts`
Expected: FAIL — `Cannot find module './node-oclif'`

- [ ] **Step 3: Implement `src/update/adapters/node-oclif.ts`**

```ts
// src/update/adapters/node-oclif.ts
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Manifest } from '../manifest';
import type { CoreFieldsExtraction, ManifestFileMergeResult, UpdateAdapter } from '../adapter';
import { deepEquals, reconcileEntry, stringEquals, type FieldOutcome } from '../reconcile';

export const CORE_FILE_PATHS = [
  'bin/run.ts',
  'src/index.ts',
  'src/base-command.ts',
  'src/logger.ts',
  'tsup.config.ts',
  'vitest.config.ts',
  'tsconfig.json',
  'ARCHITECTURE.md',
  '.gitignore',
] as const;

export const CORE_SCRIPT_NAMES = ['build', 'postbuild', 'pretest', 'test', 'typecheck'] as const;

export interface PackageJsonShape {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
  engines?: Record<string, string>;
  oclif?: Record<string, unknown>;
  [key: string]: unknown;
}

function currentDependencyValue(
  pkg: PackageJsonShape,
  name: string,
): { section: 'dependencies' | 'devDependencies'; value: string } | undefined {
  if (pkg.dependencies?.[name] !== undefined) return { section: 'dependencies', value: pkg.dependencies[name] };
  if (pkg.devDependencies?.[name] !== undefined) {
    return { section: 'devDependencies', value: pkg.devDependencies[name] };
  }
  return undefined;
}

function extractCoreFields(pkg: PackageJsonShape): CoreFieldsExtraction {
  const coreDependencies = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };

  const coreScripts: Record<string, string> = {};
  for (const name of CORE_SCRIPT_NAMES) {
    const value = pkg.scripts?.[name];
    if (value !== undefined) coreScripts[name] = value;
  }

  return {
    coreDependencies,
    coreScripts,
    coreFields: {
      engines: pkg.engines ?? {},
      oclif: pkg.oclif ?? {},
    },
  };
}

function mergePackageJson(
  currentPkg: PackageJsonShape,
  oldManifest: Manifest,
  newTemplatePkg: PackageJsonShape,
): ManifestFileMergeResult {
  const updatedFile: PackageJsonShape = { ...currentPkg };
  let changed = false;

  const dependencies: FieldOutcome[] = [];
  const coreDependencies: Record<string, string> = {};
  const dependencyNames = new Set([
    ...Object.keys(newTemplatePkg.dependencies ?? {}),
    ...Object.keys(newTemplatePkg.devDependencies ?? {}),
  ]);

  for (const name of dependencyNames) {
    const inNewDependencies = newTemplatePkg.dependencies?.[name] !== undefined;
    const newValue = (inNewDependencies ? newTemplatePkg.dependencies : newTemplatePkg.devDependencies)![name];
    const current = currentDependencyValue(currentPkg, name);
    const oldValue = oldManifest.coreDependencies[name];

    const result = reconcileEntry(current?.value, oldValue, newValue, stringEquals);
    dependencies.push({ key: name, outcome: result.outcome });
    coreDependencies[name] = result.value;

    if (result.outcome !== 'skipped' && result.value !== current?.value) {
      changed = true;
      const section = current?.section ?? (inNewDependencies ? 'dependencies' : 'devDependencies');
      updatedFile[section] = { ...updatedFile[section], [name]: result.value };
    }
  }

  const scripts: FieldOutcome[] = [];
  const coreScripts: Record<string, string> = {};

  for (const name of CORE_SCRIPT_NAMES) {
    const newValue = newTemplatePkg.scripts?.[name];
    if (newValue === undefined) continue;
    const currentValue = currentPkg.scripts?.[name];
    const oldValue = oldManifest.coreScripts[name];

    const result = reconcileEntry(currentValue, oldValue, newValue, stringEquals);
    scripts.push({ key: name, outcome: result.outcome });
    coreScripts[name] = result.value;

    if (result.outcome !== 'skipped' && result.value !== currentValue) {
      changed = true;
      updatedFile.scripts = { ...updatedFile.scripts, [name]: result.value };
    }
  }

  const oldCoreFields = oldManifest.coreFields as {
    engines?: Record<string, string>;
    oclif?: Record<string, unknown>;
  };
  const fields: FieldOutcome[] = [];
  let enginesValue: Record<string, string> = oldCoreFields.engines ?? {};
  let oclifValue: Record<string, unknown> = oldCoreFields.oclif ?? {};

  if (newTemplatePkg.engines !== undefined) {
    const enginesResult = reconcileEntry(
      currentPkg.engines,
      oldCoreFields.engines,
      newTemplatePkg.engines,
      deepEquals,
    );
    fields.push({ key: 'engines', outcome: enginesResult.outcome });
    enginesValue = enginesResult.value;
    if (enginesResult.outcome !== 'skipped' && !deepEquals(enginesResult.value, currentPkg.engines)) {
      changed = true;
      updatedFile.engines = enginesResult.value;
    }
  }

  if (newTemplatePkg.oclif !== undefined) {
    const oclifResult = reconcileEntry(currentPkg.oclif, oldCoreFields.oclif, newTemplatePkg.oclif, deepEquals);
    fields.push({ key: 'oclif', outcome: oclifResult.outcome });
    oclifValue = oclifResult.value;
    if (oclifResult.outcome !== 'skipped' && !deepEquals(oclifResult.value, currentPkg.oclif)) {
      changed = true;
      updatedFile.oclif = oclifResult.value;
    }
  }

  return {
    updatedFile,
    changed,
    dependencies,
    scripts,
    fields,
    coreDependencies,
    coreScripts,
    coreFields: { engines: enginesValue, oclif: oclifValue },
  };
}

export const nodeOclifAdapter: UpdateAdapter = {
  coreFilePaths: CORE_FILE_PATHS,

  templateSourcePath(relativePath) {
    return relativePath === '.gitignore' ? 'gitignore' : relativePath;
  },

  manifestFileName: 'package.json',

  async readManifestFile(dir) {
    const content = await readFile(path.join(dir, 'package.json'), 'utf8');
    return JSON.parse(content) as PackageJsonShape;
  },

  async writeManifestFile(dir, content) {
    await writeFile(path.join(dir, 'package.json'), JSON.stringify(content, null, 2) + '\n');
  },

  parseManifestFile(rawContent) {
    return JSON.parse(rawContent) as PackageJsonShape;
  },

  readProjectName(manifestFile) {
    return (manifestFile as PackageJsonShape).name;
  },

  extractCoreFields(manifestFile) {
    return extractCoreFields(manifestFile as PackageJsonShape);
  },

  mergeManifestFile(current, oldManifest, newTemplate) {
    return mergePackageJson(current as PackageJsonShape, oldManifest, newTemplate as PackageJsonShape);
  },
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/update/adapters/node-oclif.test.ts`
Expected: PASS, all tests green

- [ ] **Step 5: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: both PASS

- [ ] **Step 6: Commit**

```bash
git add src/update/adapters/node-oclif.ts src/update/adapters/node-oclif.test.ts
git commit -m "feat: add node-oclif UpdateAdapter implementation"
```

---

## Task 3: Generalize `manifest.ts`

**Files:**
- Modify: `src/update/manifest.ts`
- Modify: `src/update/manifest.test.ts`

**Interfaces:**
- Consumes: `UpdateAdapter` (`./adapter`); `nodeOclifAdapter`, `CORE_FILE_PATHS`, `CORE_SCRIPT_NAMES` (`./adapters/node-oclif`, test-only)
- Produces: `Manifest` with `coreFields: Record<string, unknown>` (was `{ engines; oclif }`); `hashCoreFiles(dir: string, adapter: UpdateAdapter)`; `buildManifest(targetDir: string, generatorVersion: string, adapter: UpdateAdapter)` — both now take `adapter` as a required third/second parameter

This removes `CORE_FILE_PATHS`, `CORE_SCRIPT_NAMES`, `templateSourcePath`, `extractCoreFields`, and `PackageJsonCore` from `manifest.ts` — they now live only in `adapters/node-oclif.ts` (Task 2). `manifest.ts` no longer imports or knows about `package.json`, `oclif`, or npm scripts.

- [ ] **Step 1: Rewrite `manifest.test.ts`'s failing/updated assertions first**

Replace `src/update/manifest.test.ts` entirely with:

```ts
// src/update/manifest.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  buildManifest,
  getGeneratorVersion,
  hashContent,
  hashCoreFiles,
  readManifest,
  requireManifest,
  writeManifest,
} from './manifest';
import { nodeOclifAdapter, CORE_FILE_PATHS, CORE_SCRIPT_NAMES } from './adapters/node-oclif';
import { UserError } from '../errors';

describe('hashContent', () => {
  it('produces a stable sha256 hex digest', () => {
    expect(hashContent('hello')).toBe(hashContent('hello'));
    expect(hashContent('hello')).not.toBe(hashContent('world'));
    expect(hashContent('hello')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('hashCoreFiles / buildManifest', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(path.join(tmpdir(), 'clispark-manifest-test-'));
    for (const relativePath of CORE_FILE_PATHS) {
      const filePath = path.join(tmpRoot, relativePath);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, `content of ${relativePath}`);
    }
    await writeFile(
      path.join(tmpRoot, 'package.json'),
      JSON.stringify({
        dependencies: { pino: '^9.0.0' },
        devDependencies: { vitest: '^2.0.0' },
        scripts: Object.fromEntries(CORE_SCRIPT_NAMES.map((name) => [name, name])),
        engines: { node: '>=18' },
        oclif: { bin: 'test-cli' },
      }),
    );
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it('hashCoreFiles returns a hash per core file path', async () => {
    const hashes = await hashCoreFiles(tmpRoot, nodeOclifAdapter);
    expect(Object.keys(hashes).sort()).toEqual([...CORE_FILE_PATHS].sort());
    expect(hashes['tsconfig.json']).toBe(hashContent('content of tsconfig.json'));
  });

  it('buildManifest assembles a full manifest from a target directory', async () => {
    const manifest = await buildManifest(tmpRoot, '9.9.9', nodeOclifAdapter);
    expect(manifest.generatorVersion).toBe('9.9.9');
    expect(manifest.coreFiles['tsconfig.json']).toBe(hashContent('content of tsconfig.json'));
    expect(manifest.coreDependencies).toEqual({ pino: '^9.0.0', vitest: '^2.0.0' });
    expect(manifest.coreScripts.build).toBe('build');
    expect(manifest.coreFields.engines).toEqual({ node: '>=18' });
  });
});

describe('writeManifest / readManifest / requireManifest', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(path.join(tmpdir(), 'clispark-manifest-test-'));
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  const sampleManifest = {
    generatorVersion: '1.0.0',
    coreFiles: { 'tsconfig.json': 'abc' },
    coreDependencies: {},
    coreScripts: {},
    coreFields: { engines: {}, oclif: {} },
  };

  it('writes the manifest to .clispark/manifest.json with a trailing newline', async () => {
    await writeManifest(tmpRoot, sampleManifest);
    const content = await readFile(path.join(tmpRoot, '.clispark', 'manifest.json'), 'utf8');
    expect(content.endsWith('\n')).toBe(true);
    expect(JSON.parse(content)).toEqual(sampleManifest);
  });

  it('readManifest returns undefined when no manifest exists', async () => {
    expect(await readManifest(tmpRoot)).toBeUndefined();
  });

  it('readManifest returns the parsed manifest when it exists', async () => {
    await writeManifest(tmpRoot, sampleManifest);
    expect(await readManifest(tmpRoot)).toEqual(sampleManifest);
  });

  it('requireManifest throws a clear UserError when no manifest exists', async () => {
    await expect(requireManifest(tmpRoot)).rejects.toThrow(/no \.clispark\/manifest\.json found/i);
    await expect(requireManifest(tmpRoot)).rejects.toBeInstanceOf(UserError);
  });

  it('requireManifest returns the manifest when it exists', async () => {
    await writeManifest(tmpRoot, sampleManifest);
    expect(await requireManifest(tmpRoot)).toEqual(sampleManifest);
  });
});

describe('getGeneratorVersion', () => {
  it("returns clispark's own package.json version", () => {
    expect(getGeneratorVersion()).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
```

(The `templateSourcePath` and `extractCoreFields` describe blocks are gone — that behavior is now covered by `adapters/node-oclif.test.ts`, added in Task 2.)

- [ ] **Step 2: Run the tests to verify they fail (manifest.ts signatures haven't changed yet)**

Run: `npx vitest run src/update/manifest.test.ts`
Expected: FAIL — `hashCoreFiles`/`buildManifest` calls now pass an extra `nodeOclifAdapter` argument the current implementation doesn't accept; TS will also fail to compile until Step 3.

- [ ] **Step 3: Rewrite `src/update/manifest.ts`**

Replace the file entirely with:

```ts
// src/update/manifest.ts
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UserError } from '../errors';
import type { UpdateAdapter } from './adapter';

export interface Manifest {
  generatorVersion: string;
  coreFiles: Record<string, string>;
  coreDependencies: Record<string, string>;
  coreScripts: Record<string, string>;
  coreFields: Record<string, unknown>;
}

export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export async function hashCoreFiles(dir: string, adapter: UpdateAdapter): Promise<Record<string, string>> {
  const entries = await Promise.all(
    adapter.coreFilePaths.map(async (relativePath) => {
      const content = await readFile(path.join(dir, relativePath), 'utf8');
      return [relativePath, hashContent(content)] as const;
    }),
  );
  return Object.fromEntries(entries);
}

export async function buildManifest(
  targetDir: string,
  generatorVersion: string,
  adapter: UpdateAdapter,
): Promise<Manifest> {
  const coreFiles = await hashCoreFiles(targetDir, adapter);
  const manifestFile = await adapter.readManifestFile(targetDir);
  const { coreDependencies, coreScripts, coreFields } = adapter.extractCoreFields(manifestFile);
  return { generatorVersion, coreFiles, coreDependencies, coreScripts, coreFields };
}

export const MANIFEST_RELATIVE_PATH = path.join('.clispark', 'manifest.json');

export async function writeManifest(targetDir: string, manifest: Manifest): Promise<void> {
  const manifestPath = path.join(targetDir, MANIFEST_RELATIVE_PATH);
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
}

export async function readManifest(targetDir: string): Promise<Manifest | undefined> {
  try {
    const content = await readFile(path.join(targetDir, MANIFEST_RELATIVE_PATH), 'utf8');
    return JSON.parse(content) as Manifest;
  } catch {
    return undefined;
  }
}

export async function requireManifest(targetDir: string): Promise<Manifest> {
  const manifest = await readManifest(targetDir);
  if (!manifest) {
    throw new UserError(
      'No .clispark/manifest.json found — this project predates update support, or is not a clispark project.',
    );
  }
  return manifest;
}

/**
 * Finds clispark's own package.json by walking up from this file's location.
 * A fixed relative path (`../package.json`) can't work here: this module's
 * depth below the package root differs between running from source (tests)
 * and running as part of the bundled `dist/cli.js` (tsup flattens everything
 * into one file, so `import.meta.url` no longer reflects the original
 * per-module nesting).
 */
export function getGeneratorVersion(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  while (true) {
    const pkgPath = path.join(dir, 'package.json');
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { name?: string; version: string };
      if (pkg.name === 'clispark') return pkg.version;
    }
    const parentDir = path.dirname(dir);
    if (parentDir === dir) {
      throw new Error("Could not locate clispark's own package.json.");
    }
    dir = parentDir;
  }
}
```

Note: `src/update/update.ts`, `src/scaffold.ts`, and `src/cli.ts` still call `hashCoreFiles`/`buildManifest`/reference the old `CORE_FILE_PATHS` export at this point in the plan — they are fixed in Tasks 4 and 5. Expect `npm run typecheck` to still fail after this step; that's expected and resolved by the end of Task 5.

- [ ] **Step 4: Run manifest.test.ts to verify it passes in isolation**

Run: `npx vitest run src/update/manifest.test.ts src/update/adapters/node-oclif.test.ts`
Expected: PASS, all tests green (this subset of the suite doesn't touch `update.ts`/`scaffold.ts`/`cli.ts`, so it's safe to verify in isolation even though the full typecheck is red until Task 5).

- [ ] **Step 5: Commit**

```bash
git add src/update/manifest.ts src/update/manifest.test.ts
git commit -m "refactor: generalize manifest.ts to take an UpdateAdapter instead of hardcoding npm/oclif"
```

---

## Task 4: Generalize `update.ts`, remove `update-package-json.ts`

**Files:**
- Modify: `src/update/update.ts`
- Modify: `src/update/update.test.ts`
- Delete: `src/update/update-package-json.ts`
- Delete: `src/update/update-package-json.test.ts`

**Interfaces:**
- Consumes: `UpdateAdapter` (`./adapter`); `nodeOclifAdapter`, `CORE_FILE_PATHS` (`./adapters/node-oclif`, test-only); generalized `hashContent`/`requireManifest`/`writeManifest`/`getGeneratorVersion` (`./manifest`, Task 3)
- Produces: `updateProject(targetDir: string, adapter: UpdateAdapter, deps: UpdateDeps = defaultUpdateDeps)` — `adapter` is now a required second parameter with no default; `formatUpdateSummary` unchanged in signature, output wording tweaked (`package.json:` → `Manifest:`, since the generic function can no longer assume the manifest file is named `package.json`)

- [ ] **Step 1: Rewrite `update.test.ts`, adding the adapter parameter everywhere plus a new fake-adapter test**

Replace `src/update/update.test.ts` entirely with:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { scaffoldProject } from '../scaffold';
import { formatUpdateSummary, updateProject } from './update';
import { getGeneratorVersion, hashContent, readManifest, type Manifest } from './manifest';
import { nodeOclifAdapter, CORE_FILE_PATHS } from './adapters/node-oclif';
import { UserError } from '../errors';
import type { UpdateAdapter } from './adapter';

async function scaffoldFixture(tmpRoot: string, name: string): Promise<string> {
  const targetDir = path.join(tmpRoot, name);
  await scaffoldProject({ projectName: name, targetDir }, { runCommand: vi.fn(async () => {}) });
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

    await expect(updateProject(targetDir, nodeOclifAdapter, deps)).rejects.toThrow(/working tree is not clean/i);
    await expect(updateProject(targetDir, nodeOclifAdapter, deps)).rejects.toBeInstanceOf(UserError);
    expect(deps.runCommand).not.toHaveBeenCalled();
  });

  it('aborts with a clear error when no manifest exists', async () => {
    const targetDir = path.join(tmpRoot, 'no-manifest-project');
    await scaffoldProject({ projectName: 'no-manifest-project', targetDir }, { runCommand: vi.fn(async () => {}) });
    await rm(path.join(targetDir, '.clispark'), { recursive: true, force: true });

    await expect(updateProject(targetDir, nodeOclifAdapter, cleanGitDeps())).rejects.toThrow(
      /no \.clispark\/manifest\.json found/i,
    );
  });

  it('reports "up-to-date" and makes no changes when the manifest already matches the running version', async () => {
    const targetDir = await scaffoldFixture(tmpRoot, 'fresh-project');
    const deps = cleanGitDeps();

    const result = await updateProject(targetDir, nodeOclifAdapter, deps);

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
    const result = await updateProject(targetDir, nodeOclifAdapter, deps);

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
    const result = await updateProject(targetDir, nodeOclifAdapter, deps);

    expect(result.status).toBe('updated');
    expect(result.fromVersion).toBe('0.0.1');
    expect(result.toVersion).toBe(getGeneratorVersion());

    expect(result.files.find((f) => f.path === 'tsconfig.json')?.outcome).toBe('skipped');
    expect(result.files.find((f) => f.path === 'src/base-command.ts')?.outcome).toBe('replaced');

    const tsconfigAfter = await readFile(tsconfigPath, 'utf8');
    expect(tsconfigAfter).toContain('"strict": false');

    const newManifest = await readManifest(targetDir);
    expect(newManifest?.generatorVersion).toBe(getGeneratorVersion());
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
    const result = await updateProject(targetDir, nodeOclifAdapter, deps);

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
    const result = await updateProject(targetDir, nodeOclifAdapter, deps);

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
    const result = await updateProject(targetDir, fakeAdapter, deps);

    expect(result.status).toBe('updated');
    expect(result.files).toEqual([{ path: 'tsconfig.json', outcome: 'replaced' }]);
    expect(result.dependencies).toEqual([]);
    expect(result.scripts).toEqual([]);
    expect(result.fields).toEqual([]);

    const newManifest = await readManifest(targetDir);
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

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/update/update.test.ts`
Expected: FAIL — `updateProject` doesn't accept an adapter parameter yet.

- [ ] **Step 3: Rewrite `src/update/update.ts`**

Replace the file entirely with:

```ts
// src/update/update.ts
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import spawn from 'cross-spawn';
import { applyPlaceholders, TEMPLATE_DIR } from '../scaffold';
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
    await readFile(path.join(TEMPLATE_DIR, adapter.manifestFileName), 'utf8'),
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
        await readFile(path.join(TEMPLATE_DIR, adapter.templateSourcePath(relativePath)), 'utf8'),
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

Note the one intentional wording change: the `package.json:` summary label became `Manifest:` — the generic function can no longer assume the manifest file is named `package.json`.

- [ ] **Step 4: Delete the superseded files**

```bash
git rm src/update/update-package-json.ts src/update/update-package-json.test.ts
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/update/update.test.ts`
Expected: PASS, all tests green including the new fake-adapter test.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: still FAILS at this point — `scaffold.ts` and `cli.ts` haven't been updated yet (Task 5). Confirm the *only* remaining errors are in those two files (calls to `buildManifest`/`updateProject` missing the new required `adapter` argument).

- [ ] **Step 7: Commit**

```bash
git add src/update/update.ts src/update/update.test.ts
git commit -m "refactor: generalize update.ts to take an UpdateAdapter instead of hardcoding npm/oclif"
```

---

## Task 5: Wire `scaffold.ts` and `cli.ts` to the concrete adapter

**Files:**
- Modify: `src/scaffold.ts`
- Modify: `src/cli.ts`

**Interfaces:**
- Consumes: `nodeOclifAdapter` (`./update/adapters/node-oclif`); `buildManifest`/`updateProject` new signatures from Tasks 3–4

- [ ] **Step 1: Wire `scaffold.ts`**

In `src/scaffold.ts`, add the adapter import next to the existing manifest import:

```ts
import { buildManifest, getGeneratorVersion, writeManifest } from './update/manifest';
```

becomes:

```ts
import { buildManifest, getGeneratorVersion, writeManifest } from './update/manifest';
import { nodeOclifAdapter } from './update/adapters/node-oclif';
```

And update the `buildManifest` call inside `scaffoldProject()`:

```ts
  const manifest = await buildManifest(targetDir, getGeneratorVersion());
```

becomes:

```ts
  const manifest = await buildManifest(targetDir, getGeneratorVersion(), nodeOclifAdapter);
```

- [ ] **Step 2: Wire `cli.ts`**

In `src/cli.ts`, add the adapter import next to the existing update import:

```ts
import { formatUpdateSummary, updateProject } from './update/update';
```

becomes:

```ts
import { formatUpdateSummary, updateProject } from './update/update';
import { nodeOclifAdapter } from './update/adapters/node-oclif';
```

And update the `updateProject` call inside the `update` command's action:

```ts
      const result = await updateProject(targetDir);
```

becomes:

```ts
      const result = await updateProject(targetDir, nodeOclifAdapter);
```

- [ ] **Step 3: Full typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: both PASS with zero errors — this is the first point in the plan where the whole codebase compiles again.

- [ ] **Step 4: Full test suite**

Run: `npm test`
Expected: PASS, all tests green (this includes `scaffold.test.ts`, which exercises `scaffoldProject()` → `buildManifest()` end-to-end and was not touched in this plan — it must still pass unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/scaffold.ts src/cli.ts
git commit -m "refactor: wire scaffold and update commands to the node-oclif adapter explicitly"
```

---

## Task 6: Full verification (automated + real end-to-end)

**Files:**
- Create (temporary, deleted at the end): `scripts/verify-tier3-manual.ts`

No new interfaces — this task only verifies the four prior tasks produced working, behavior-preserving software, the same way every previous clispark milestone's final task did.

- [ ] **Step 1: Full automated suite**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all three PASS.

- [ ] **Step 2: Write a real end-to-end verification script**

Create `scripts/verify-tier3-manual.ts`:

```ts
// Temporary manual verification script for M11 Tier 3 — deleted after use, not committed.
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { scaffoldProject } from '../src/scaffold';
import { updateProject, formatUpdateSummary } from '../src/update/update';
import { nodeOclifAdapter } from '../src/update/adapters/node-oclif';
import type { Manifest } from '../src/update/manifest';

async function main() {
  const tmpRoot = await mkdtemp(path.join(tmpdir(), 'clispark-tier3-verify-'));
  const targetDir = path.join(tmpRoot, 'verify-project');

  console.log('Scaffolding a real project...');
  await scaffoldProject({ projectName: 'verify-project', targetDir });

  console.log('Downgrading the manifest to simulate an old project...');
  const manifestPath = path.join(targetDir, '.clispark', 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Manifest;
  manifest.generatorVersion = '0.0.1';
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

  console.log('Committing the downgrade so the working tree is clean...');
  spawnSync('git', ['add', '-A'], { cwd: targetDir, stdio: 'inherit' });
  spawnSync('git', ['commit', '-m', 'chore: simulate old manifest'], { cwd: targetDir, stdio: 'inherit' });

  console.log('Running updateProject() with the real node-oclif adapter...');
  const result = await updateProject(targetDir, nodeOclifAdapter);
  console.log(formatUpdateSummary(result));
  if (result.status !== 'updated') {
    throw new Error(`Expected status "updated", got "${result.status}"`);
  }

  console.log('Running the generated project\'s own test suite after the update...');
  const testRun = spawnSync('npm', ['test'], { cwd: targetDir, stdio: 'inherit' });
  if (testRun.status !== 0) {
    throw new Error('Generated project tests failed after update');
  }

  console.log(`\nAll checks passed. Verified project left at: ${targetDir}`);
  await rm(tmpRoot, { recursive: true, force: true });
  console.log('Cleaned up temp directory.');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 3: Run it**

Run: `npx tsx scripts/verify-tier3-manual.ts`
Expected: scaffold succeeds, `update` reports `status: 'updated'` with real file replacements (e.g. `src/base-command.ts`), the generated project's own `npm test` passes, cleanup runs. This is the real proof that the refactor preserved end-to-end behavior — a fresh scaffold, a real downgrade, a real `updateProject()` call through the real adapter, and a real `npm test` inside the result.

If it fails: read the error, fix the underlying issue in the relevant task's files (not in this script), re-run from Step 1 of this task.

- [ ] **Step 4: Delete the verification script**

```bash
rm scripts/verify-tier3-manual.ts
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

The task-level next step from the design doc's "Ergebnis" section: a future second template needs a new `UpdateAdapter` implementation plus separate scaffold/wizard work (its own design session) — not further changes to `manifest.ts`/`update.ts`. Update `project-ideas/clispark.plan.md`'s M11 Tier 3 entry to "✅ abgeschlossen" with a summary once this plan's tasks are merged, per the project's standing "keep plans updated" convention.
