// src/update/adapters/node-oclif.ts
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Manifest } from '../manifest';
import type { CoreFieldsExtraction, CoreFilePathsFlags, ManifestFileMergeResult, UpdateAdapter } from '../adapter';
import { deepEquals, reconcileEntry, stringEquals, type FieldOutcome } from '../reconcile';
import { LINT_SCRIPT_NAMES, LINT_DEPENDENCY_NAMES } from '../../languages/lint-support/node';
import { AUTOCOMPLETE_DEPENDENCY_NAME, withoutAutocompletePlugin } from '../../languages/autocomplete-support/node';

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

function extractCoreFields(pkg: PackageJsonShape, flags: CoreFilePathsFlags): CoreFieldsExtraction {
  // coreDependencies stays exactly as-is: it's derived from whatever's actually present in pkg,
  // which stripLintTooling already made conditional at scaffold time -- no extra gating needed
  // here specifically (see spec review point 3 for why the *reconciliation* side, below, does).
  const coreDependencies = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };

  const scriptNames = flags.lintEnabled ? [...CORE_SCRIPT_NAMES, ...LINT_SCRIPT_NAMES] : CORE_SCRIPT_NAMES;
  const coreScripts: Record<string, string> = {};
  for (const name of scriptNames) {
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
  const dependencyNames = new Set(
    [...Object.keys(newTemplatePkg.dependencies ?? {}), ...Object.keys(newTemplatePkg.devDependencies ?? {})].filter(
      (name) =>
        (oldManifest.lintEnabled || !(LINT_DEPENDENCY_NAMES as readonly string[]).includes(name)) &&
        (oldManifest.autocompleteEnabled || name !== AUTOCOMPLETE_DEPENDENCY_NAME),
    ),
  );

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

  const scriptNames = oldManifest.lintEnabled ? [...CORE_SCRIPT_NAMES, ...LINT_SCRIPT_NAMES] : CORE_SCRIPT_NAMES;
  for (const name of scriptNames) {
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
    const effectiveTemplateOclif = oldManifest.autocompleteEnabled
      ? newTemplatePkg.oclif
      : (withoutAutocompletePlugin(newTemplatePkg.oclif) as Record<string, unknown>);
    const oclifResult = reconcileEntry(currentPkg.oclif, oldCoreFields.oclif, effectiveTemplateOclif, deepEquals);
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
  coreFilePaths(flags) {
    return flags.lintEnabled
      ? [...CORE_FILE_PATHS, 'eslint.config.js', '.prettierrc', '.prettierignore']
      : CORE_FILE_PATHS;
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

  extractCoreFields(manifestFile, flags) {
    return extractCoreFields(manifestFile as PackageJsonShape, flags);
  },

  mergeManifestFile(current, oldManifest, newTemplate) {
    return mergePackageJson(current as PackageJsonShape, oldManifest, newTemplate as PackageJsonShape);
  },
};
