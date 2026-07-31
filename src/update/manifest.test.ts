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
    const hashes = await hashCoreFiles(tmpRoot, nodeOclifAdapter, {
      lintEnabled: false,
      autocompleteEnabled: false,
      commandConventionEnabled: false,
    });
    expect(Object.keys(hashes).sort()).toEqual([...CORE_FILE_PATHS].sort());
    expect(hashes['tsconfig.json']).toBe(hashContent('content of tsconfig.json'));
  });

  it('buildManifest assembles a full manifest from a target directory', async () => {
    const manifest = await buildManifest(tmpRoot, '9.9.9', 'node', nodeOclifAdapter, false, false, false);
    expect(manifest.generatorVersion).toBe('9.9.9');
    expect(manifest.language).toBe('node');
    expect(manifest.coreFiles['tsconfig.json']).toBe(hashContent('content of tsconfig.json'));
    expect(manifest.coreDependencies).toEqual({ pino: '^9.0.0', vitest: '^2.0.0' });
    expect(manifest.coreScripts.build).toBe('build');
    expect(manifest.coreFields.engines).toEqual({ node: '>=18' });
  });
});

describe('buildManifest lintEnabled', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(path.join(tmpdir(), 'clispark-manifest-test-'));
    for (const relativePath of CORE_FILE_PATHS) {
      const filePath = path.join(tmpRoot, relativePath);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, `content of ${relativePath}`);
    }
    // Also present so buildManifest(..., true) can hash them via the now-conditional coreFilePaths.
    await writeFile(path.join(tmpRoot, 'eslint.config.js'), 'content of eslint.config.js');
    await writeFile(path.join(tmpRoot, '.prettierrc'), 'content of .prettierrc');
    await writeFile(path.join(tmpRoot, '.prettierignore'), 'content of .prettierignore');
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

  it('records lintEnabled: true when passed', async () => {
    const manifest = await buildManifest(tmpRoot, '1.0.0', 'node', nodeOclifAdapter, true, false, false);
    expect(manifest.lintEnabled).toBe(true);
  });

  it('records lintEnabled: false when passed', async () => {
    const manifest = await buildManifest(tmpRoot, '1.0.0', 'node', nodeOclifAdapter, false, false, false);
    expect(manifest.lintEnabled).toBe(false);
  });
});

describe('buildManifest autocompleteEnabled', () => {
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

  it('records autocompleteEnabled: true when passed', async () => {
    const manifest = await buildManifest(tmpRoot, '1.0.0', 'node', nodeOclifAdapter, false, true, false);
    expect(manifest.autocompleteEnabled).toBe(true);
  });

  it('records autocompleteEnabled: false when passed', async () => {
    const manifest = await buildManifest(tmpRoot, '1.0.0', 'node', nodeOclifAdapter, false, false, false);
    expect(manifest.autocompleteEnabled).toBe(false);
  });
});

describe('buildManifest commandConventionEnabled', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(path.join(tmpdir(), 'clispark-manifest-test-'));
    for (const relativePath of CORE_FILE_PATHS) {
      const filePath = path.join(tmpRoot, relativePath);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, `content of ${relativePath}`);
    }
    // Also present so buildManifest(..., true, false, ...) can hash them via the
    // lintEnabled-conditional coreFilePaths (these tests pass lintEnabled: true).
    await writeFile(path.join(tmpRoot, 'eslint.config.js'), 'content of eslint.config.js');
    await writeFile(path.join(tmpRoot, '.prettierrc'), 'content of .prettierrc');
    await writeFile(path.join(tmpRoot, '.prettierignore'), 'content of .prettierignore');
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

  it('records commandConventionEnabled: true when passed', async () => {
    const manifest = await buildManifest(tmpRoot, '1.0.0', 'node', nodeOclifAdapter, true, false, true);
    expect(manifest.commandConventionEnabled).toBe(true);
  });

  it('records commandConventionEnabled: false when passed', async () => {
    const manifest = await buildManifest(tmpRoot, '1.0.0', 'node', nodeOclifAdapter, true, false, false);
    expect(manifest.commandConventionEnabled).toBe(false);
  });
});

describe('coreFilePaths is now manifest-aware', () => {
  it('nodeOclifAdapter.coreFilePaths includes the lint files only when lintEnabled is true', () => {
    expect(
      nodeOclifAdapter.coreFilePaths({ lintEnabled: false, autocompleteEnabled: false, commandConventionEnabled: false }),
    ).toEqual(CORE_FILE_PATHS);
    expect(
      nodeOclifAdapter.coreFilePaths({ lintEnabled: true, autocompleteEnabled: false, commandConventionEnabled: false }),
    ).toEqual([...CORE_FILE_PATHS, 'eslint.config.js', '.prettierrc', '.prettierignore']);
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
    language: 'node',
    lintEnabled: false,
    autocompleteEnabled: false,
    commandConventionEnabled: false,
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
