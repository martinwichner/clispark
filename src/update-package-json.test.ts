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
