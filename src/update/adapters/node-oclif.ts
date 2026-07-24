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
  coreFilePaths() {
    return CORE_FILE_PATHS;
  },

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
