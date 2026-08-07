import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'smol-toml';
import type { Manifest } from '../manifest';
import type { CoreFieldsExtraction, ManifestFileMergeResult, UpdateAdapter } from '../adapter';
import { reconcileEntry, stringEquals, type FieldOutcome } from '../reconcile';

// pyproject.toml is deliberately NOT in this list -- it has its own dedicated
// read/write/merge path via manifestFileName/readManifestFile/writeManifestFile/mergeManifestFile
// below, exactly like package.json/Cli.csproj/Module.psd1 are excluded from their own adapters'
// CORE_FILE_PATHS. `cli/` is a fixed package directory name (not derived from the project name)
// -- see the spec's "Echter Architektur-Fund" section for why a src/<project>/ layout would break
// this static list.
export const CORE_FILE_PATHS = ['cli/base_command.py', 'cli/discover.py', 'cli/cli.py', 'ARCHITECTURE.md', '.gitignore'] as const;

export interface PyprojectFile {
  raw: string;
  name: string;
  version: string;
  dependencies: string[];
}

interface ParsedPyproject {
  project?: { name?: string; version?: string; dependencies?: string[] };
}

export function parsePyprojectFile(rawContent: string): PyprojectFile {
  const parsed = parse(rawContent) as ParsedPyproject;
  if (!parsed.project?.name) throw new Error('pyproject.toml is missing [project].name');
  if (!parsed.project?.version) throw new Error('pyproject.toml is missing [project].version');
  return {
    raw: rawContent,
    name: parsed.project.name,
    version: parsed.project.version,
    dependencies: parsed.project.dependencies ?? [],
  };
}

// PEP 508 dependency strings embed the version spec in the same string (e.g. "typer>=0.12"),
// unlike npm/NuGet's separate name/version fields -- split so reconciliation can key by name,
// the same way the Node/.NET adapters do, without falsely treating a version bump as
// "unrelated new entry" (a full-string comparison would).
function parseDependency(dep: string): { name: string; spec: string } {
  const match = dep.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)\s*(.*)$/);
  if (!match) throw new Error(`Could not parse dependency string: "${dep}"`);
  return { name: match[1], spec: match[2].trim() };
}

function dependencyMap(deps: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const dep of deps) {
    const { name, spec } = parseDependency(dep);
    map.set(name, spec);
  }
  return map;
}

function setVersion(content: string, version: string): string {
  return content.replace(/^version = "[^"]*"/m, `version = "${version}"`);
}

function setDependencies(content: string, dependencies: string[]): string {
  const formatted = dependencies.map((d) => `    "${d}",`).join('\n');
  return content.replace(/^dependencies = \[[\s\S]*?\n\]/m, `dependencies = [\n${formatted}\n]`);
}

function extractCoreFields(pyproject: PyprojectFile): CoreFieldsExtraction {
  const coreDependencies: Record<string, string> = {};
  for (const dep of pyproject.dependencies) {
    const { name, spec } = parseDependency(dep);
    coreDependencies[name] = spec;
  }
  return { coreDependencies, coreScripts: {}, coreFields: { version: pyproject.version } };
}

function mergeManifestFile(current: PyprojectFile, oldManifest: Manifest, newTemplate: PyprojectFile): ManifestFileMergeResult {
  let raw = current.raw;
  let changed = false;

  const currentMap = dependencyMap(current.dependencies);
  const newMap = dependencyMap(newTemplate.dependencies);
  const mergedMap = new Map(currentMap);

  const dependencies: FieldOutcome[] = [];
  const coreDependencies: Record<string, string> = {};

  for (const [name, newSpec] of newMap) {
    const currentSpec = currentMap.get(name);
    const oldSpec = oldManifest.coreDependencies[name];
    const result = reconcileEntry(currentSpec, oldSpec, newSpec, stringEquals);
    dependencies.push({ key: name, outcome: result.outcome });
    coreDependencies[name] = result.value;
    // Guard mirrors node-oclif.ts's mergePackageJson: on 'skipped', reconcileEntry's returned
    // value is the OLD manifest snapshot, not the user's actual live edit -- writing it here
    // would silently clobber a manually-pinned dependency version. Only apply the result to
    // the file when the outcome isn't 'skipped'; coreDependencies (the *next* manifest
    // snapshot) still records result.value either way, same as Node's adapter.
    if (result.outcome !== 'skipped') {
      mergedMap.set(name, result.value);
    }
  }

  const mergedDeps = [...mergedMap.entries()].map(([name, spec]) => (spec ? `${name}${spec}` : name));
  if (mergedDeps.join('\n') !== current.dependencies.join('\n')) {
    changed = true;
    raw = setDependencies(raw, mergedDeps);
  }

  const oldCoreFields = oldManifest.coreFields as { version?: string };
  const versionResult = reconcileEntry(current.version, oldCoreFields.version, newTemplate.version, stringEquals);
  // Same 'skipped' guard as above: on 'skipped', versionResult.value is the OLD manifest
  // snapshot, not the user's real current version -- write it back only when the outcome
  // isn't 'skipped', otherwise the file (and updatedFile.version, which must match raw)
  // keeps the user's actual live version.
  let writtenVersion = current.version;
  if (versionResult.outcome !== 'skipped' && versionResult.value !== current.version) {
    changed = true;
    raw = setVersion(raw, versionResult.value);
    writtenVersion = versionResult.value;
  }

  return {
    updatedFile: { ...current, raw, dependencies: mergedDeps, version: writtenVersion },
    changed,
    dependencies,
    scripts: [],
    fields: [],
    coreDependencies,
    coreScripts: {},
    coreFields: { version: versionResult.value },
  };
}

export const pythonAdapter: UpdateAdapter = {
  coreFilePaths() {
    return CORE_FILE_PATHS;
  },

  templateSourcePath(relativePath) {
    return relativePath === '.gitignore' ? 'gitignore' : relativePath;
  },

  manifestFileName: 'pyproject.toml',

  async readManifestFile(dir) {
    const raw = await readFile(path.join(dir, 'pyproject.toml'), 'utf8');
    return parsePyprojectFile(raw);
  },

  async writeManifestFile(dir, content) {
    await writeFile(path.join(dir, 'pyproject.toml'), (content as PyprojectFile).raw);
  },

  parseManifestFile: parsePyprojectFile,

  readProjectName(manifestFile) {
    return (manifestFile as PyprojectFile).name;
  },

  extractCoreFields(manifestFile) {
    return extractCoreFields(manifestFile as PyprojectFile);
  },

  mergeManifestFile(current, oldManifest, newTemplate) {
    return mergeManifestFile(current as PyprojectFile, oldManifest, newTemplate as PyprojectFile);
  },
};
