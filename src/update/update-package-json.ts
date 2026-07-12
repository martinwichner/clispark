import { CORE_SCRIPT_NAMES, type Manifest } from './manifest';
import { deepEquals, reconcileEntry, stringEquals, type ReconcileOutcome } from './reconcile';

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
      updatedPkg[section] = { ...updatedPkg[section], [name]: result.value };
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
      updatedPkg.scripts = { ...updatedPkg.scripts, [name]: result.value };
    }
  }

  const fields: FieldOutcome[] = [];
  let enginesValue = oldManifest.coreFields.engines;
  let oclifValue = oldManifest.coreFields.oclif;

  if (newTemplatePkg.engines !== undefined) {
    const enginesResult = reconcileEntry(
      currentPkg.engines,
      oldManifest.coreFields.engines,
      newTemplatePkg.engines,
      deepEquals,
    );
    fields.push({ key: 'engines', outcome: enginesResult.outcome });
    enginesValue = enginesResult.value;
    if (enginesResult.outcome !== 'skipped' && !deepEquals(enginesResult.value, currentPkg.engines)) {
      changed = true;
      updatedPkg.engines = enginesResult.value;
    }
  }

  if (newTemplatePkg.oclif !== undefined) {
    const oclifResult = reconcileEntry(
      currentPkg.oclif,
      oldManifest.coreFields.oclif,
      newTemplatePkg.oclif,
      deepEquals,
    );
    fields.push({ key: 'oclif', outcome: oclifResult.outcome });
    oclifValue = oclifResult.value;
    if (oclifResult.outcome !== 'skipped' && !deepEquals(oclifResult.value, currentPkg.oclif)) {
      changed = true;
      updatedPkg.oclif = oclifResult.value;
    }
  }

  return {
    updatedPkg,
    changed,
    dependencies,
    scripts,
    fields,
    coreDependencies,
    coreScripts,
    coreFields: { engines: enginesValue, oclif: oclifValue },
  };
}
