# clispark M6: Update Mechanism Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an already-generated project pull in core (generator-managed) improvements from newer clispark versions without touching custom (user-owned) code, and let a user see what changed between the generator version their project last updated to and the latest one.

**Architecture:** A `.clispark/manifest.json` written at scaffold time (and rewritten at each successful update) records the generator version, a sha256 hash per core file, and the last-known-generator-set values for the core `package.json` fields (dependencies, a fixed set of scripts, `engines`, `oclif`). `npx clispark update` compares the live project against this manifest and against the *current* (`npx`-resolved latest) template: unmodified core state gets replaced with the new template's version, anything the user has changed is skipped and reported, nothing is ever deleted. `clispark releasenotes` reads the same manifest and lists GitHub releases between the project's recorded version and the running one.

**Tech Stack:** TypeScript, Node built-ins only (`node:crypto`, `node:fs/promises`, `node:path`, global `fetch`) plus the already-present `cross-spawn` — no new dependencies.

## Global Constraints

- Node >=18, TypeScript, ESM (`"type": "module"`) — matches the existing generator package.
- No new npm dependencies for this milestone.
- File I/O tests use real `fs/promises` against real temp directories (no mocking of the filesystem) — matches `scaffold.test.ts`'s existing convention.
- Git/process interaction is injectable via a `deps` parameter (mirroring `ScaffoldDeps` in `src/scaffold.ts`), so tests never shell out for real.
- Core files/fields are **never deleted or auto-removed** — only added, replaced (when unmodified since the last generator write), or skipped-and-reported (when the user has changed them). This is a hard constraint from the spec, not a default to be second-guessed per task.
- ESLint (`eslint.config.js`: `eslint:recommended` + `typescript-eslint` recommended) must pass on every new/changed file under `src/**/*.ts`.

Full design reasoning: `docs/superpowers/specs/2026-07-12-clispark-m6-update-mechanism-design.md`.

---

### Task 1: Manifest module + wire into `scaffoldProject()`

**Files:**
- Create: `src/manifest.ts`
- Create: `src/manifest.test.ts`
- Modify: `src/scaffold.ts`
- Modify: `src/scaffold.test.ts`

**Interfaces:**
- Produces: `CORE_FILE_PATHS: readonly string[]`, `CORE_SCRIPT_NAMES: readonly string[]`, `templateSourcePath(relativePath: string): string`, `hashContent(content: string): string`, `hashCoreFiles(dir: string): Promise<Record<string, string>>`, `interface PackageJsonCore { dependencies?: Record<string,string>; devDependencies?: Record<string,string>; scripts?: Record<string,string>; engines?: Record<string,string>; oclif?: Record<string, unknown>; }`, `extractCoreFields(pkg: PackageJsonCore): { coreDependencies: Record<string,string>; coreScripts: Record<string,string>; coreFields: { engines: Record<string,string>; oclif: Record<string,unknown> } }`, `interface Manifest { generatorVersion: string; coreFiles: Record<string,string>; coreDependencies: Record<string,string>; coreScripts: Record<string,string>; coreFields: { engines: Record<string,string>; oclif: Record<string,unknown> }; }`, `buildManifest(targetDir: string, generatorVersion: string): Promise<Manifest>`, `writeManifest(targetDir: string, manifest: Manifest): Promise<void>`, `readManifest(targetDir: string): Promise<Manifest | undefined>`, `requireManifest(targetDir: string): Promise<Manifest>` (throws if missing), `getGeneratorVersion(): string`.
- Also produces from `src/scaffold.ts`: `export const TEMPLATE_DIR` (was module-private), `export function applyPlaceholders(content: string, projectName: string): string` (extracted from the existing private `replacePlaceholder`).

- [ ] **Step 1: Write the failing tests for `src/manifest.ts`**

```typescript
// src/manifest.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  CORE_FILE_PATHS,
  CORE_SCRIPT_NAMES,
  buildManifest,
  extractCoreFields,
  getGeneratorVersion,
  hashContent,
  hashCoreFiles,
  readManifest,
  requireManifest,
  templateSourcePath,
  writeManifest,
} from './manifest.js';

describe('hashContent', () => {
  it('produces a stable sha256 hex digest', () => {
    expect(hashContent('hello')).toBe(hashContent('hello'));
    expect(hashContent('hello')).not.toBe(hashContent('world'));
    expect(hashContent('hello')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('templateSourcePath', () => {
  it('maps .gitignore to the un-dotted "gitignore" template file', () => {
    expect(templateSourcePath('.gitignore')).toBe('gitignore');
  });

  it('leaves every other path unchanged', () => {
    expect(templateSourcePath('src/base-command.ts')).toBe('src/base-command.ts');
  });
});

describe('extractCoreFields', () => {
  it('merges dependencies and devDependencies into coreDependencies', () => {
    const result = extractCoreFields({
      dependencies: { pino: '^9.0.0' },
      devDependencies: { vitest: '^2.0.0' },
    });
    expect(result.coreDependencies).toEqual({ pino: '^9.0.0', vitest: '^2.0.0' });
  });

  it('only includes known core script names', () => {
    const result = extractCoreFields({
      scripts: { build: 'tsup', 'my-custom-script': 'do-thing' },
    });
    expect(result.coreScripts).toEqual({ build: 'tsup' });
    expect(result.coreScripts).not.toHaveProperty('my-custom-script');
  });

  it('defaults engines/oclif/dependencies/scripts to empty objects when missing', () => {
    const result = extractCoreFields({});
    expect(result.coreFields).toEqual({ engines: {}, oclif: {} });
    expect(result.coreDependencies).toEqual({});
    expect(result.coreScripts).toEqual({});
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
    const hashes = await hashCoreFiles(tmpRoot);
    expect(Object.keys(hashes).sort()).toEqual([...CORE_FILE_PATHS].sort());
    expect(hashes['tsconfig.json']).toBe(hashContent('content of tsconfig.json'));
  });

  it('buildManifest assembles a full manifest from a target directory', async () => {
    const manifest = await buildManifest(tmpRoot, '9.9.9');
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

  it('requireManifest throws a clear error when no manifest exists', async () => {
    await expect(requireManifest(tmpRoot)).rejects.toThrow(/no \.clispark\/manifest\.json found/i);
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

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/manifest.test.ts`
Expected: FAIL — `Cannot find module './manifest.js'` (file doesn't exist yet).

- [ ] **Step 3: Implement `src/manifest.ts`**

```typescript
// src/manifest.ts
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const CORE_FILE_PATHS = [
  'bin/run.js',
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

/** The base template stores .gitignore as "gitignore" (renamed on copy); every other core path is identical in the template and in a generated project. */
export function templateSourcePath(relativePath: string): string {
  return relativePath === '.gitignore' ? 'gitignore' : relativePath;
}

export interface Manifest {
  generatorVersion: string;
  coreFiles: Record<string, string>;
  coreDependencies: Record<string, string>;
  coreScripts: Record<string, string>;
  coreFields: {
    engines: Record<string, string>;
    oclif: Record<string, unknown>;
  };
}

export interface PackageJsonCore {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
  engines?: Record<string, string>;
  oclif?: Record<string, unknown>;
}

export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export async function hashCoreFiles(dir: string): Promise<Record<string, string>> {
  const hashes: Record<string, string> = {};
  for (const relativePath of CORE_FILE_PATHS) {
    const content = await readFile(path.join(dir, relativePath), 'utf8');
    hashes[relativePath] = hashContent(content);
  }
  return hashes;
}

export function extractCoreFields(
  pkg: PackageJsonCore,
): Pick<Manifest, 'coreDependencies' | 'coreScripts' | 'coreFields'> {
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

export async function buildManifest(targetDir: string, generatorVersion: string): Promise<Manifest> {
  const coreFiles = await hashCoreFiles(targetDir);
  const pkg = JSON.parse(await readFile(path.join(targetDir, 'package.json'), 'utf8')) as PackageJsonCore;
  const { coreDependencies, coreScripts, coreFields } = extractCoreFields(pkg);
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
    throw new Error(
      'No .clispark/manifest.json found — this project predates update support, or is not a clispark project.',
    );
  }
  return manifest;
}

const require = createRequire(import.meta.url);

export function getGeneratorVersion(): string {
  return (require('../package.json') as { version: string }).version;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/manifest.test.ts`
Expected: PASS (all cases green).

- [ ] **Step 5: Commit**

```bash
git add src/manifest.ts src/manifest.test.ts
git commit -m "feat: add version manifest module for tracking generator-owned core state"
```

- [ ] **Step 6: Write the failing test for wiring the manifest into `scaffoldProject()`**

Add to `src/scaffold.test.ts`, inside the existing `describe('scaffoldProject', ...)` block:

```typescript
  it('writes a .clispark/manifest.json with generatorVersion and core file hashes', async () => {
    const targetDir = path.join(tmpRoot, 'manifest-project');
    const runCommand = vi.fn(async () => {});

    await scaffoldProject({ projectName: 'manifest-project', targetDir }, { runCommand });

    const manifest = JSON.parse(await readFile(path.join(targetDir, '.clispark', 'manifest.json'), 'utf8'));
    expect(typeof manifest.generatorVersion).toBe('string');
    expect(manifest.generatorVersion.length).toBeGreaterThan(0);
    expect(manifest.coreFiles['src/base-command.ts']).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.coreDependencies['@oclif/core']).toBe('^4.0.0');
    expect(manifest.coreScripts.build).toBe('tsup');
    expect(manifest.coreFields.engines).toEqual({ node: '>=18' });
  });
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `npx vitest run src/scaffold.test.ts -t "writes a .clispark/manifest.json"`
Expected: FAIL — no `.clispark/manifest.json` written yet.

- [ ] **Step 8: Wire manifest writing into `scaffoldProject()`, and export `TEMPLATE_DIR`/`applyPlaceholders`**

In `src/scaffold.ts`:

```typescript
import spawn from 'cross-spawn';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { cp, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { DEFAULT_REGISTRY_URL } from './registry.js';
import { buildManifest, getGeneratorVersion, writeManifest } from './manifest.js';

export interface ScaffoldOptions {
  projectName: string;
  targetDir: string;
  registryUrl?: string;
}

export const TEMPLATE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'base');

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

export function applyPlaceholders(content: string, projectName: string): string {
  return content.replaceAll('{{projectName}}', projectName);
}

async function replacePlaceholder(filePath: string, projectName: string): Promise<void> {
  const content = applyPlaceholders(await readFile(filePath, 'utf8'), projectName);
  await writeFile(filePath, content);
}

export async function copyTemplate(options: ScaffoldOptions): Promise<void> {
  const { projectName, targetDir, registryUrl } = options;

  await assertTargetDirIsUsable(targetDir);
  await cp(TEMPLATE_DIR, targetDir, { recursive: true });

  await rename(path.join(targetDir, 'gitignore'), path.join(targetDir, '.gitignore'));

  await replacePlaceholder(path.join(targetDir, 'package.json'), projectName);
  await replacePlaceholder(path.join(targetDir, 'README.md'), projectName);
  await replacePlaceholder(path.join(targetDir, 'src', 'logger.ts'), projectName);
  await replacePlaceholder(path.join(targetDir, 'ARCHITECTURE.md'), projectName);

  if (registryUrl && registryUrl !== DEFAULT_REGISTRY_URL) {
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
  deps: ScaffoldDeps = defaultScaffoldDeps,
): Promise<void> {
  await copyTemplate(options);

  const { targetDir } = options;
  const manifest = await buildManifest(targetDir, getGeneratorVersion());
  await writeManifest(targetDir, manifest);

  await deps.runCommand('git', ['init'], targetDir);
  await deps.runCommand('git', ['add', '-A'], targetDir);
  await deps.runCommand('git', ['commit', '-m', 'chore: initial scaffold from clispark'], targetDir);
  await deps.runCommand('npm', ['install'], targetDir);
  await deps.runCommand('npm', ['run', 'build'], targetDir);
}
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `npx vitest run src/scaffold.test.ts`
Expected: PASS — all existing scaffold tests plus the new manifest test are green.

- [ ] **Step 10: Commit**

```bash
git add src/scaffold.ts src/scaffold.test.ts
git commit -m "feat: write .clispark/manifest.json during scaffold, export TEMPLATE_DIR/applyPlaceholders"
```

---

### Task 2: Generic reconciliation logic

**Files:**
- Create: `src/reconcile.ts`
- Create: `src/reconcile.test.ts`

**Interfaces:**
- Consumes: nothing (pure, standalone module).
- Produces: `type ReconcileOutcome = 'added' | 'replaced' | 'skipped'`, `interface ReconcileResult<T> { outcome: ReconcileOutcome; value: T }`, `function reconcileEntry<T>(currentLiveValue: T | undefined, oldManifestValue: T | undefined, newTemplateValue: T, isEqual: (a: T, b: T) => boolean): ReconcileResult<T>`, `function stringEquals(a: string, b: string): boolean`, `function deepEquals(a: unknown, b: unknown): boolean`.

This is the single algorithm every later task builds on: *not present locally → added; present and unchanged since the last generator write → replaced; present but changed by the user → skipped, keeping whatever value was last known-good (falling back to the current live value if this entry was never tracked before).*

- [ ] **Step 1: Write the failing tests**

```typescript
// src/reconcile.test.ts
import { describe, it, expect } from 'vitest';
import { deepEquals, reconcileEntry, stringEquals } from './reconcile.js';

describe('reconcileEntry', () => {
  it('returns "added" when the value does not exist locally yet', () => {
    const result = reconcileEntry(undefined, undefined, 'new-value', stringEquals);
    expect(result).toEqual({ outcome: 'added', value: 'new-value' });
  });

  it('returns "replaced" when the local value matches the last-known generator value', () => {
    const result = reconcileEntry('old-value', 'old-value', 'new-value', stringEquals);
    expect(result).toEqual({ outcome: 'replaced', value: 'new-value' });
  });

  it('returns "skipped" and keeps the old manifest value when the local value diverged', () => {
    const result = reconcileEntry('user-edited-value', 'old-value', 'new-value', stringEquals);
    expect(result).toEqual({ outcome: 'skipped', value: 'old-value' });
  });

  it('returns "skipped" and adopts the current live value when it was never tracked before', () => {
    const result = reconcileEntry('pre-existing-value', undefined, 'new-value', stringEquals);
    expect(result).toEqual({ outcome: 'skipped', value: 'pre-existing-value' });
  });

  it('supports deep equality for object values', () => {
    const replaced = reconcileEntry({ node: '>=18' }, { node: '>=18' }, { node: '>=20' }, deepEquals);
    expect(replaced.outcome).toBe('replaced');

    const skipped = reconcileEntry({ node: '>=16' }, { node: '>=18' }, { node: '>=20' }, deepEquals);
    expect(skipped).toEqual({ outcome: 'skipped', value: { node: '>=18' } });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/reconcile.test.ts`
Expected: FAIL — `Cannot find module './reconcile.js'`.

- [ ] **Step 3: Implement `src/reconcile.ts`**

```typescript
// src/reconcile.ts
export type ReconcileOutcome = 'added' | 'replaced' | 'skipped';

export interface ReconcileResult<T> {
  outcome: ReconcileOutcome;
  value: T;
}

export function reconcileEntry<T>(
  currentLiveValue: T | undefined,
  oldManifestValue: T | undefined,
  newTemplateValue: T,
  isEqual: (a: T, b: T) => boolean,
): ReconcileResult<T> {
  if (currentLiveValue === undefined) {
    return { outcome: 'added', value: newTemplateValue };
  }
  if (oldManifestValue !== undefined && isEqual(currentLiveValue, oldManifestValue)) {
    return { outcome: 'replaced', value: newTemplateValue };
  }
  return { outcome: 'skipped', value: oldManifestValue ?? currentLiveValue };
}

export function stringEquals(a: string, b: string): boolean {
  return a === b;
}

export function deepEquals(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/reconcile.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/reconcile.ts src/reconcile.test.ts
git commit -m "feat: add generic added/replaced/skipped reconciliation logic"
```

---

### Task 3: `package.json` selective merge

**Files:**
- Create: `src/update-package-json.ts`
- Create: `src/update-package-json.test.ts`

**Interfaces:**
- Consumes: `CORE_SCRIPT_NAMES`, `type Manifest` from `./manifest.js` (Task 1); `reconcileEntry`, `stringEquals`, `deepEquals`, `type ReconcileOutcome` from `./reconcile.js` (Task 2).
- Produces: `interface PackageJsonShape { name: string; version: string; dependencies?: Record<string,string>; devDependencies?: Record<string,string>; scripts?: Record<string,string>; engines?: Record<string,string>; oclif?: Record<string, unknown>; [key: string]: unknown }`, `interface FieldOutcome { key: string; outcome: ReconcileOutcome }`, `interface PackageJsonMergeResult { updatedPkg: PackageJsonShape; changed: boolean; dependencies: FieldOutcome[]; scripts: FieldOutcome[]; fields: FieldOutcome[]; coreDependencies: Record<string,string>; coreScripts: Record<string,string>; coreFields: Manifest['coreFields'] }`, `function mergePackageJson(currentPkg: PackageJsonShape, oldManifest: Manifest, newTemplatePkg: PackageJsonShape): PackageJsonMergeResult`.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/update-package-json.test.ts
import { describe, it, expect } from 'vitest';
import { mergePackageJson, type PackageJsonShape } from './update-package-json.js';
import type { Manifest } from './manifest.js';

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

describe('mergePackageJson', () => {
  it('adds a brand-new core dependency the project never had', () => {
    const current: PackageJsonShape = { name: 'my-cli', version: '0.0.0', dependencies: {} };
    const newTemplate: PackageJsonShape = {
      name: '{{projectName}}',
      version: '0.0.0',
      dependencies: { pino: '^9.6.0' },
    };

    const result = mergePackageJson(current, baseManifest(), newTemplate);

    expect(result.changed).toBe(true);
    expect(result.updatedPkg.dependencies).toEqual({ pino: '^9.6.0' });
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

    const result = mergePackageJson(current, manifest, newTemplate);

    expect(result.changed).toBe(true);
    expect(result.updatedPkg.dependencies).toEqual({ pino: '^9.7.0' });
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

    const result = mergePackageJson(current, manifest, newTemplate);

    expect(result.updatedPkg.dependencies).toEqual({ pino: '^8.0.0' });
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

    const result = mergePackageJson(current, baseManifest(), newTemplate);

    expect(result.updatedPkg.dependencies).toEqual({ 'my-own-lib': '^1.0.0' });
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

    const result = mergePackageJson(current, manifest, newTemplate);

    expect(result.updatedPkg.scripts).toEqual({ build: 'tsup', 'my-script': 'do-thing' });
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

    const result = mergePackageJson(current, manifest, newTemplate);

    expect(result.updatedPkg.engines).toEqual({ node: '>=20' });
    expect(result.updatedPkg.oclif).toEqual({ bin: '{{projectName}}', commands: './dist/commands' });
    expect(result.fields).toEqual([
      { key: 'engines', outcome: 'replaced' },
      { key: 'oclif', outcome: 'replaced' },
    ]);
  });

  it('reports changed:false when every value already matches (nothing to write)', () => {
    const current: PackageJsonShape = { name: 'my-cli', version: '0.0.0', dependencies: { pino: '^9.6.0' } };
    const newTemplate: PackageJsonShape = {
      name: '{{projectName}}',
      version: '0.0.0',
      dependencies: { pino: '^9.6.0' },
    };
    const manifest = baseManifest({ coreDependencies: { pino: '^9.6.0' } });

    const result = mergePackageJson(current, manifest, newTemplate);

    expect(result.changed).toBe(false);
    expect(result.dependencies).toEqual([{ key: 'pino', outcome: 'replaced' }]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/update-package-json.test.ts`
Expected: FAIL — `Cannot find module './update-package-json.js'`.

- [ ] **Step 3: Implement `src/update-package-json.ts`**

```typescript
// src/update-package-json.ts
import { CORE_SCRIPT_NAMES, type Manifest } from './manifest.js';
import { deepEquals, reconcileEntry, stringEquals, type ReconcileOutcome } from './reconcile.js';

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

export interface FieldOutcome {
  key: string;
  outcome: ReconcileOutcome;
}

export interface PackageJsonMergeResult {
  updatedPkg: PackageJsonShape;
  changed: boolean;
  dependencies: FieldOutcome[];
  scripts: FieldOutcome[];
  fields: FieldOutcome[];
  coreDependencies: Record<string, string>;
  coreScripts: Record<string, string>;
  coreFields: Manifest['coreFields'];
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

export function mergePackageJson(
  currentPkg: PackageJsonShape,
  oldManifest: Manifest,
  newTemplatePkg: PackageJsonShape,
): PackageJsonMergeResult {
  const updatedPkg: PackageJsonShape = { ...currentPkg };
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
      updatedPkg[section] = { ...currentPkg[section], [name]: result.value };
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
      updatedPkg.scripts = { ...currentPkg.scripts, [name]: result.value };
    }
  }

  const fields: FieldOutcome[] = [];

  const enginesResult = reconcileEntry(
    currentPkg.engines,
    oldManifest.coreFields.engines,
    newTemplatePkg.engines ?? {},
    deepEquals,
  );
  fields.push({ key: 'engines', outcome: enginesResult.outcome });
  if (enginesResult.outcome !== 'skipped' && !deepEquals(enginesResult.value, currentPkg.engines)) {
    changed = true;
    updatedPkg.engines = enginesResult.value;
  }

  const oclifResult = reconcileEntry(
    currentPkg.oclif,
    oldManifest.coreFields.oclif,
    newTemplatePkg.oclif ?? {},
    deepEquals,
  );
  fields.push({ key: 'oclif', outcome: oclifResult.outcome });
  if (oclifResult.outcome !== 'skipped' && !deepEquals(oclifResult.value, currentPkg.oclif)) {
    changed = true;
    updatedPkg.oclif = oclifResult.value;
  }

  return {
    updatedPkg,
    changed,
    dependencies,
    scripts,
    fields,
    coreDependencies,
    coreScripts,
    coreFields: { engines: enginesResult.value, oclif: oclifResult.value },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/update-package-json.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/update-package-json.ts src/update-package-json.test.ts
git commit -m "feat: add selective package.json merge for core dependencies/scripts/fields"
```

---

### Task 4: `update` orchestration + CLI wiring

**Files:**
- Create: `src/update.ts`
- Create: `src/update.test.ts`
- Modify: `src/cli.ts`

**Interfaces:**
- Consumes: `CORE_FILE_PATHS`, `getGeneratorVersion`, `hashContent`, `requireManifest`, `writeManifest`, `templateSourcePath`, `type Manifest` from `./manifest.js` (Task 1); `applyPlaceholders`, `TEMPLATE_DIR` from `./scaffold.js` (Task 1); `reconcileEntry`, `stringEquals` from `./reconcile.js` (Task 2); `mergePackageJson`, `type PackageJsonShape` from `./update-package-json.js` (Task 3); `withLogging` from `./logger.js` (existing).
- Produces: `interface UpdateDeps { runCommand: (command: string, args: string[], cwd: string) => Promise<void>; captureCommand: (command: string, args: string[], cwd: string) => Promise<string> }`, `interface FileOutcomeEntry { path: string; outcome: 'added' | 'replaced' | 'skipped' | 'no-longer-core' }`, `interface UpdateResult { status: 'up-to-date' | 'no-changes' | 'updated'; fromVersion: string; toVersion: string; files: FileOutcomeEntry[]; dependencies: FieldOutcome[]; scripts: FieldOutcome[]; fields: FieldOutcome[] }`, `function updateProject(targetDir: string, deps?: UpdateDeps): Promise<UpdateResult>`, `function formatUpdateSummary(result: UpdateResult): string`.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/update.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { scaffoldProject } from './scaffold.js';
import { formatUpdateSummary, updateProject } from './update.js';
import { CORE_FILE_PATHS, getGeneratorVersion, readManifest, type Manifest } from './manifest.js';

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

  it('aborts with a clear error when the git working tree is dirty', async () => {
    const targetDir = await scaffoldFixture(tmpRoot, 'dirty-project');
    const deps = {
      runCommand: vi.fn(async () => {}),
      captureCommand: vi.fn(async () => ' M src/commands/hello.ts'),
    };

    await expect(updateProject(targetDir, deps)).rejects.toThrow(/working tree is not clean/i);
    expect(deps.runCommand).not.toHaveBeenCalled();
  });

  it('aborts with a clear error when no manifest exists', async () => {
    const targetDir = path.join(tmpRoot, 'no-manifest-project');
    await scaffoldProject({ projectName: 'no-manifest-project', targetDir }, { runCommand: vi.fn(async () => {}) });
    await rm(path.join(targetDir, '.clispark'), { recursive: true, force: true });

    await expect(updateProject(targetDir, cleanGitDeps())).rejects.toThrow(/no \.clispark\/manifest\.json found/i);
  });

  it('reports "up-to-date" and makes no changes when the manifest already matches the running version', async () => {
    const targetDir = await scaffoldFixture(tmpRoot, 'fresh-project');
    const deps = cleanGitDeps();

    const result = await updateProject(targetDir, deps);

    expect(result.status).toBe('up-to-date');
    expect(deps.runCommand).not.toHaveBeenCalled();
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
    const result = await updateProject(targetDir, deps);

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
    const result = await updateProject(targetDir, deps);

    expect(result.status).toBe('no-changes');
    expect(result.files.every((f) => f.outcome === 'skipped')).toBe(true);
    expect(deps.runCommand).not.toHaveBeenCalled();

    const manifestAfter = JSON.parse(await readFile(manifestPath, 'utf8')) as Manifest;
    expect(manifestAfter.generatorVersion).toBe('0.0.1');
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

Run: `npx vitest run src/update.test.ts`
Expected: FAIL — `Cannot find module './update.js'`.

- [ ] **Step 3: Implement `src/update.ts`**

```typescript
// src/update.ts
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import spawn from 'cross-spawn';
import { applyPlaceholders, TEMPLATE_DIR } from './scaffold.js';
import {
  CORE_FILE_PATHS,
  getGeneratorVersion,
  hashContent,
  requireManifest,
  templateSourcePath,
  writeManifest,
  type Manifest,
} from './manifest.js';
import { reconcileEntry, stringEquals } from './reconcile.js';
import { mergePackageJson, type FieldOutcome, type PackageJsonShape } from './update-package-json.js';

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

export async function updateProject(targetDir: string, deps: UpdateDeps = defaultUpdateDeps): Promise<UpdateResult> {
  const status = (await deps.captureCommand('git', ['status', '--porcelain'], targetDir)).trim();
  if (status.length > 0) {
    throw new Error('Working tree is not clean. Commit or stash your changes before running update.');
  }

  const oldManifest = await requireManifest(targetDir);
  const toVersion = getGeneratorVersion();
  const fromVersion = oldManifest.generatorVersion;

  if (fromVersion === toVersion) {
    return { status: 'up-to-date', fromVersion, toVersion, files: [], dependencies: [], scripts: [], fields: [] };
  }

  const currentPkg = JSON.parse(await readFile(path.join(targetDir, 'package.json'), 'utf8')) as PackageJsonShape;
  const projectName = currentPkg.name;

  const newTemplatePkg = JSON.parse(
    applyPlaceholders(await readFile(path.join(TEMPLATE_DIR, 'package.json'), 'utf8'), projectName),
  ) as PackageJsonShape;

  const files: FileOutcomeEntry[] = [];
  const newCoreFiles: Record<string, string> = {};
  const fileWrites: { targetPath: string; content: string }[] = [];

  for (const relativePath of CORE_FILE_PATHS) {
    const newContent = applyPlaceholders(
      await readFile(path.join(TEMPLATE_DIR, templateSourcePath(relativePath)), 'utf8'),
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
    files.push({ path: relativePath, outcome: result.outcome });
    newCoreFiles[relativePath] = result.value;

    if (result.outcome === 'added' || result.outcome === 'replaced') {
      fileWrites.push({ targetPath: path.join(targetDir, relativePath), content: newContent });
    }
  }

  for (const relativePath of Object.keys(oldManifest.coreFiles)) {
    if ((CORE_FILE_PATHS as readonly string[]).includes(relativePath)) continue;
    try {
      await readFile(path.join(targetDir, relativePath), 'utf8');
      files.push({ path: relativePath, outcome: 'no-longer-core' });
    } catch {
      // already gone locally, nothing to report
    }
  }

  const pkgMerge = mergePackageJson(currentPkg, oldManifest, newTemplatePkg);

  const hasFileChanges = files.some((f) => f.outcome === 'added' || f.outcome === 'replaced');
  const hasChanges = hasFileChanges || pkgMerge.changed;

  if (!hasChanges) {
    return {
      status: 'no-changes',
      fromVersion,
      toVersion,
      files,
      dependencies: pkgMerge.dependencies,
      scripts: pkgMerge.scripts,
      fields: pkgMerge.fields,
    };
  }

  for (const write of fileWrites) {
    await mkdir(path.dirname(write.targetPath), { recursive: true });
    await writeFile(write.targetPath, write.content);
  }

  if (pkgMerge.changed) {
    await writeFile(path.join(targetDir, 'package.json'), JSON.stringify(pkgMerge.updatedPkg, null, 2) + '\n');
  }

  const newManifest: Manifest = {
    generatorVersion: toVersion,
    coreFiles: newCoreFiles,
    coreDependencies: pkgMerge.coreDependencies,
    coreScripts: pkgMerge.coreScripts,
    coreFields: pkgMerge.coreFields,
  };
  await writeManifest(targetDir, newManifest);

  await deps.runCommand('git', ['add', '-A'], targetDir);
  await deps.runCommand('git', ['commit', '-m', `chore: update clispark core to v${toVersion}`], targetDir);

  return {
    status: 'updated',
    fromVersion,
    toVersion,
    files,
    dependencies: pkgMerge.dependencies,
    scripts: pkgMerge.scripts,
    fields: pkgMerge.fields,
  };
}

export function formatUpdateSummary(result: UpdateResult): string {
  if (result.status === 'up-to-date') {
    return `Already up to date (v${result.toVersion}).`;
  }

  const lines: string[] = [];
  if (result.status === 'no-changes') {
    lines.push(`No changes applied: every core file/field has been modified locally since v${result.fromVersion}.`);
  } else {
    lines.push(`Updated core from v${result.fromVersion} to v${result.toVersion}.`);
  }

  const added = result.files.filter((f) => f.outcome === 'added');
  const replaced = result.files.filter((f) => f.outcome === 'replaced');
  const skipped = result.files.filter((f) => f.outcome === 'skipped');
  const noLongerCore = result.files.filter((f) => f.outcome === 'no-longer-core');

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
    lines.push(`  package.json: ${fieldOutcomes.map((o) => `${o.key} (${o.outcome})`).join(', ')}`);
  }

  if (result.status === 'updated') {
    lines.push('Run "clispark releasenotes" to see what changed.');
  }

  return lines.join('\n');
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/update.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the `update` subcommand into the CLI**

In `src/cli.ts`, add the import and register a new subcommand (keep the existing default-action wizard block unchanged):

```typescript
// src/cli.ts
import { createRequire } from 'node:module';
import path from 'node:path';
import { Command } from 'commander';
import { runWizard } from './wizard.js';
import { scaffoldProject } from './scaffold.js';
import { withLogging } from './logger.js';
import { formatUpdateSummary, updateProject } from './update.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };

const program = new Command();

program
  .name('clispark')
  .description('Interactive scaffolding tool for new CLI projects')
  .version(pkg.version);

program.action(
  withLogging('scaffold', async (logger) => {
    const answers = await runWizard();
    const targetDir = path.join(process.cwd(), answers.projectName);

    logger.info({ projectName: answers.projectName, targetDir }, 'scaffold started');
    await scaffoldProject({ projectName: answers.projectName, targetDir, registryUrl: answers.registryUrl });
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
      logger.info({ targetDir }, 'update started');
      const result = await updateProject(targetDir);
      logger.info({ status: result.status }, 'update completed');
      console.log(formatUpdateSummary(result));
    }),
  );

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 6: Build and manually smoke-test the CLI wiring**

Run: `npm run build && node dist/cli.js update --help`
Expected: oclif/commander help output for the `update` subcommand, no crash.

- [ ] **Step 7: Commit**

```bash
git add src/update.ts src/update.test.ts src/cli.ts
git commit -m "feat: add clispark update command"
```

---

### Task 5: `clispark releasenotes`

**Files:**
- Create: `src/releasenotes.ts`
- Create: `src/releasenotes.test.ts`
- Modify: `src/cli.ts`

**Interfaces:**
- Consumes: `getGeneratorVersion`, `requireManifest` from `./manifest.js` (Task 1); `withLogging` from `./logger.js` (existing).
- Produces: `interface GitHubRelease { tag_name: string; name: string; body: string }`, `function compareVersions(a: string, b: string): number`, `interface ReleaseNotesResult { status: 'up-to-date' | 'releases-found'; fromVersion: string; toVersion: string; releases: GitHubRelease[] }`, `function fetchReleaseNotes(targetDir: string, fetchFn?: typeof fetch): Promise<ReleaseNotesResult>`, `function formatReleaseNotes(result: ReleaseNotesResult): string`.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/releasenotes.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getGeneratorVersion, writeManifest, type Manifest } from './manifest.js';
import { compareVersions, fetchReleaseNotes, formatReleaseNotes } from './releasenotes.js';

function baseManifest(generatorVersion: string): Manifest {
  return {
    generatorVersion,
    coreFiles: {},
    coreDependencies: {},
    coreScripts: {},
    coreFields: { engines: {}, oclif: {} },
  };
}

describe('compareVersions', () => {
  it('compares semantic versions numerically, ignoring a leading "v"', () => {
    expect(compareVersions('1.2.0', 'v1.10.0')).toBeLessThan(0);
    expect(compareVersions('2.0.0', '1.9.9')).toBeGreaterThan(0);
    expect(compareVersions('1.1.0', '1.1.0')).toBe(0);
  });
});

describe('fetchReleaseNotes', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(path.join(tmpdir(), 'clispark-releasenotes-test-'));
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it('throws when no manifest exists', async () => {
    await expect(fetchReleaseNotes(tmpRoot)).rejects.toThrow(/no \.clispark\/manifest\.json found/i);
  });

  it('reports "up-to-date" without calling the network when already on the latest version', async () => {
    await writeManifest(tmpRoot, baseManifest(getGeneratorVersion()));
    const fetchFn = vi.fn();

    const result = await fetchReleaseNotes(tmpRoot, fetchFn as unknown as typeof fetch);

    expect(result.status).toBe('up-to-date');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('filters releases to those strictly newer than the project version and up to the running version', async () => {
    await writeManifest(tmpRoot, baseManifest('1.0.0'));
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        { tag_name: `v${getGeneratorVersion()}`, name: 'latest', body: 'latest notes' },
        { tag_name: 'v1.0.1', name: 'patch', body: 'patch notes' },
        { tag_name: 'v1.0.0', name: 'too old', body: 'should be excluded' },
      ],
    });

    const result = await fetchReleaseNotes(tmpRoot, fetchFn as unknown as typeof fetch);

    expect(result.status).toBe('releases-found');
    expect(result.releases.map((r) => r.tag_name)).toEqual([`v${getGeneratorVersion()}`, 'v1.0.1']);
  });

  it('throws a clear error when the GitHub API responds with an error status', async () => {
    await writeManifest(tmpRoot, baseManifest('1.0.0'));
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 500 });

    await expect(fetchReleaseNotes(tmpRoot, fetchFn as unknown as typeof fetch)).rejects.toThrow(/500/);
  });
});

describe('formatReleaseNotes', () => {
  it('formats an up-to-date result', () => {
    const text = formatReleaseNotes({ status: 'up-to-date', fromVersion: '1.0.0', toVersion: '1.0.0', releases: [] });
    expect(text).toContain('latest clispark version');
  });

  it('formats releases newest-first with tag and body', () => {
    const text = formatReleaseNotes({
      status: 'releases-found',
      fromVersion: '1.0.0',
      toVersion: '1.1.0',
      releases: [{ tag_name: 'v1.1.0', name: 'v1.1.0', body: 'feat: added update command' }],
    });
    expect(text).toContain('v1.1.0');
    expect(text).toContain('feat: added update command');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/releasenotes.test.ts`
Expected: FAIL — `Cannot find module './releasenotes.js'`.

- [ ] **Step 3: Implement `src/releasenotes.ts`**

```typescript
// src/releasenotes.ts
import { getGeneratorVersion, requireManifest } from './manifest.js';

export interface GitHubRelease {
  tag_name: string;
  name: string;
  body: string;
}

function stripV(version: string): string {
  return version.startsWith('v') ? version.slice(1) : version;
}

export function compareVersions(a: string, b: string): number {
  const partsA = stripV(a).split('.').map(Number);
  const partsB = stripV(b).split('.').map(Number);
  const length = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < length; i++) {
    const diff = (partsA[i] ?? 0) - (partsB[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export interface ReleaseNotesResult {
  status: 'up-to-date' | 'releases-found';
  fromVersion: string;
  toVersion: string;
  releases: GitHubRelease[];
}

const RELEASES_URL = 'https://api.github.com/repos/martinwichner/clispark/releases';

export async function fetchReleaseNotes(
  targetDir: string,
  fetchFn: typeof fetch = fetch,
): Promise<ReleaseNotesResult> {
  const manifest = await requireManifest(targetDir);
  const fromVersion = manifest.generatorVersion;
  const toVersion = getGeneratorVersion();

  if (compareVersions(fromVersion, toVersion) >= 0) {
    return { status: 'up-to-date', fromVersion, toVersion, releases: [] };
  }

  const response = await fetchFn(RELEASES_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch release notes: GitHub API responded with ${response.status}`);
  }
  const allReleases = (await response.json()) as GitHubRelease[];

  const releases = allReleases
    .filter((r) => compareVersions(r.tag_name, fromVersion) > 0 && compareVersions(r.tag_name, toVersion) <= 0)
    .sort((a, b) => compareVersions(b.tag_name, a.tag_name));

  return { status: 'releases-found', fromVersion, toVersion, releases };
}

export function formatReleaseNotes(result: ReleaseNotesResult): string {
  if (result.status === 'up-to-date') {
    return `You're on the latest clispark version (v${result.toVersion}), nothing to show.`;
  }
  if (result.releases.length === 0) {
    return `No published releases found between v${result.fromVersion} and v${result.toVersion}.`;
  }
  return result.releases.map((r) => `## ${r.tag_name}\n\n${r.body}`).join('\n\n');
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/releasenotes.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the `releasenotes` subcommand into the CLI**

In `src/cli.ts`, add the import and a second subcommand registration, right after the `update` subcommand block:

```typescript
import { fetchReleaseNotes, formatReleaseNotes } from './releasenotes.js';
```

```typescript
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
```

- [ ] **Step 6: Build and manually smoke-test the CLI wiring**

Run: `npm run build && node dist/cli.js releasenotes --help`
Expected: help output for the `releasenotes` subcommand, no crash.

- [ ] **Step 7: Commit**

```bash
git add src/releasenotes.ts src/releasenotes.test.ts src/cli.ts
git commit -m "feat: add clispark releasenotes command"
```

---

### Task 6: README restructure

**Files:**
- Modify: `README.md`

No test cycle (documentation-only); verification is a manual read-through plus confirming every relative link resolves.

- [ ] **Step 1: Replace the full contents of `README.md`**

```markdown
# clispark

Interactive scaffolding tool for new CLI projects. Run `npx clispark` to generate a new, ready-to-run TypeScript CLI project with consistent logging, error handling, and command structure — no manual setup required.

[![npm version](https://img.shields.io/npm/v/clispark.svg)](https://www.npmjs.com/package/clispark)
[![CI](https://github.com/martinwichner/clispark/actions/workflows/ci.yml/badge.svg)](https://github.com/martinwichner/clispark/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/clispark.svg)](LICENSE)

## Quickstart

```bash
npx clispark
```

Answer three prompts — project name, work/private profile, and (for "work") an optional private registry URL — and clispark scaffolds a new directory, running `git init`, `npm install`, and `npm run build` for you. Thirty seconds later:

```bash
cd my-cli
node bin/run.js hello
```

...prints a greeting from your first working command, with structured logging and clean error handling already wired up.

## What you get

Every generated project includes:

- **oclif-based CLI structure** with convention-based command discovery — drop a file in `src/commands/`, no manual registration needed
- **Structured logging** (`pino`, one log file per invocation in an OS-appropriate log directory) that automatically covers every command
- **Consistent error handling** with no opt-out — clean `Error: <message>` output on failure, full stack trace captured in the log file
- **A working test setup** (`vitest` + `@oclif/test`) with an example test to copy from
- **A first example command** (`hello`) as a starting point for your own commands
- **A clean build pipeline** (`tsup`) producing a directly runnable binary

## Usage

```bash
npx clispark
```

The wizard asks:

1. **Project name** — checked for availability against the target npm registry as you type; a taken name prompts you to try another instead of blocking hard.
2. **Profile** — `work` or `private`. `work` unlocks an optional registry URL prompt.
3. **Registry URL** (work profile only) — leave empty for the public npm registry, or point at a private/company registry. If set, an `.npmrc` is generated so every future `npm install` in the project uses it automatically.

Scaffolding then happens automatically: files are copied, `git init` plus an initial commit run, and `npm install && npm run build` leave you with a directly runnable project.

## Updating a project

Generated projects track which files and `package.json` fields are generator-managed ("core") versus yours, in a `.clispark/manifest.json` written at scaffold time. From inside a generated project:

```bash
npx clispark update
```

pulls in the latest core improvements (base command, logger, build/test config, `ARCHITECTURE.md`, and the relevant `package.json` dependencies/scripts) from whichever clispark version `npx` resolves. It never touches anything under `src/commands/`, your `README.md`, or an `.npmrc` you added — those are yours. If you've hand-edited a core file yourself, `update` leaves it alone and reports it as skipped rather than overwriting your changes. It refuses to run against an unclean git working tree, and commits its own changes as a single, easily revertible commit.

```bash
npx clispark releasenotes
```

shows what changed between the clispark version your project last updated to and the latest one available, pulled straight from the project's GitHub releases.

## Tech stack

**Generator itself (`clispark`):** TypeScript, [commander](https://github.com/tj/commander.js) (CLI structure), [@clack/prompts](https://github.com/bombshell-dev/clack) (interactive wizard), `cross-spawn` (cross-platform shelling out to git/npm), `pino` + `env-paths` (own logging), `tsup` + `vitest`.

**Generated boilerplate:** TypeScript, [oclif](https://oclif.io/) (command framework), `pino` + `env-paths` (logging), `tsup` (build), `vitest` + `@oclif/test` (testing).

## Releases & CI

Releases are automated via [release-please](https://github.com/googleapis/release-please): commits to `master` follow [Conventional Commits](https://www.conventionalcommits.org/), and merging the running release PR publishes to npm via [Trusted Publishing](https://docs.npmjs.com/trusted-publishers) (OIDC) — no long-lived npm token involved. `ci.yml` runs on every push/PR: unit tests, typecheck, build, a blocking `npm audit`, and an end-to-end scaffold smoke test.

## Development status

clispark is under active development — see [`CHANGELOG.md`](CHANGELOG.md) for the full release history and the [implementation plans](docs/superpowers/plans/) for the reasoning behind each milestone.

## Development notes

This project is being built with the help of [Claude](https://claude.com/claude-code). Implementation plans are written before coding starts and committed alongside the code under [`docs/superpowers/plans/`](docs/superpowers/plans/), so the reasoning and step-by-step approach behind each milestone stays visible in version control.

Planning and execution follow the [Superpowers](https://github.com/obra/superpowers) skill set for Claude Code (brainstorming → writing-plans → subagent-driven-development) — credit to [obra](https://github.com/obra) for that workflow.

## License

[MIT](LICENSE)
```

- [ ] **Step 2: Verify every relative link resolves**

Run: `ls CHANGELOG.md LICENSE docs/superpowers/plans/ 2>&1`
Expected: all three paths exist (no "No such file or directory").

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: restructure README with quickstart, badges, and an update-mechanism section"
```

---

### Task 7: Manual end-to-end verification + whole-branch review

No new code — this validates the real, un-mocked behavior the unit tests above can't reach (real `npx`/`node` invocation, real git repository, real GitHub API), matching the verification pattern used for M1–M5.

- [ ] **Step 1: Full local build + test suite**

Run: `npm run build && npm test && npm run lint && npm run typecheck`
Expected: all green.

- [ ] **Step 2: Real scaffold + real update against an unmodified project**

```bash
cd /tmp
node /path/to/clispark/dist/cli.js   # or: npx clispark, if testing a published version
# wizard: name "e2e-update-test", profile "private"
cd e2e-update-test
node ../clispark/dist/cli.js update
```

Expected: prints "Already up to date" (the project was just scaffolded with the same generator build) and makes no git changes (`git status` stays clean).

- [ ] **Step 3: Real update after simulating an older project**

In the same `e2e-update-test` directory: hand-edit `.clispark/manifest.json`, setting `generatorVersion` to a fake old value (e.g. `"0.0.1"`), then hand-edit one core file (e.g. append a comment to `tsconfig.json`). Run `node ../clispark/dist/cli.js update` again.

Expected: summary reports the edited file as skipped, other core files as replaced, a new commit appears in `git log`, and `git status` is clean afterward.

- [ ] **Step 4: Real `releasenotes` call**

Run: `node ../clispark/dist/cli.js releasenotes` (against the manifest still showing the fake `0.0.1` version from Step 3)
Expected: real GitHub release data for `martinwichner/clispark` prints to the terminal, newest first.

- [ ] **Step 5: Dirty-tree and missing-manifest guards**

```bash
echo "x" >> README.md   # make the tree dirty
node ../clispark/dist/cli.js update
```
Expected: clear error, no changes made. Then `git checkout README.md`, delete `.clispark/`, run `update` again — expect a clear "no manifest found" error.

- [ ] **Step 6: Final whole-branch review**

Run the project's established review pass (as done at the end of M2–M5) over the full diff before merging: check for consistency between `manifest.ts`/`update.ts`/`update-package-json.ts`/`releasenotes.ts`, confirm no dependency was added to `package.json` unintentionally, and confirm `README.md` renders correctly on GitHub (badges resolve, links work).

- [ ] **Step 7: Update the project plan and README status**

Mark M6 complete in `project-ideas/clispark.plan.md` with a summary of what shipped and any bugs found during Steps 1–6, following the existing per-milestone changelog convention.
