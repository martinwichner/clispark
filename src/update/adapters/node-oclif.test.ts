import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { nodeOclifAdapter, type PackageJsonShape } from './node-oclif';
import type { Manifest } from '../manifest';

function baseManifest(overrides: Partial<Manifest> = {}): Manifest {
  return {
    generatorVersion: '1.0.0',
    language: 'node',
    lintEnabled: false,
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
    const result = nodeOclifAdapter.extractCoreFields(
      {
        dependencies: { pino: '^9.0.0' },
        devDependencies: { vitest: '^2.0.0' },
      },
      { lintEnabled: false },
    );
    expect(result.coreDependencies).toEqual({ pino: '^9.0.0', vitest: '^2.0.0' });
  });

  it('only includes known core script names', () => {
    const result = nodeOclifAdapter.extractCoreFields(
      { scripts: { build: 'tsup', 'my-custom-script': 'do-thing' } },
      { lintEnabled: false },
    );
    expect(result.coreScripts).toEqual({ build: 'tsup' });
    expect(result.coreScripts).not.toHaveProperty('my-custom-script');
  });

  it('defaults engines/oclif/dependencies/scripts to empty objects when missing', () => {
    const result = nodeOclifAdapter.extractCoreFields({}, { lintEnabled: false });
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

describe('coreFilePaths with lintEnabled', () => {
  it('includes eslint.config.js, .prettierrc, and .prettierignore only when lintEnabled is true', () => {
    expect(nodeOclifAdapter.coreFilePaths({ lintEnabled: false })).not.toContain('eslint.config.js');
    expect(nodeOclifAdapter.coreFilePaths({ lintEnabled: true })).toContain('eslint.config.js');
    expect(nodeOclifAdapter.coreFilePaths({ lintEnabled: true })).toContain('.prettierrc');
    expect(nodeOclifAdapter.coreFilePaths({ lintEnabled: true })).toContain('.prettierignore');
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
