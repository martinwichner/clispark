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

// TOML keys repeat across tables (e.g. a [tool.foo] table can have its own "version"/
// "dependencies" keys) -- scanning the whole raw file for the first "version = ..."/
// "dependencies = [...]" match would silently rewrite the wrong table if it happens to appear
// before [project]. Find [project]'s own body range first (from its heading to the next table
// heading of any kind, per TOML's table-scoping rules -- this also correctly stops at a nested
// heading like "[project.scripts]", not just an unrelated top-level table), so field edits are
// scoped to it. See Finding 2 of the final branch review.
function findProjectTableRange(content: string): { start: number; end: number } {
  const headingRegex = /^\[([^[\]]+)\][ \t]*$/gm;
  let projectHeadingEnd = -1;
  let nextHeadingStart = content.length;
  let match: RegExpExecArray | null;
  while ((match = headingRegex.exec(content)) !== null) {
    if (projectHeadingEnd === -1) {
      if (match[1] === 'project') {
        projectHeadingEnd = match.index + match[0].length;
      }
      continue;
    }
    nextHeadingStart = match.index;
    break;
  }
  if (projectHeadingEnd === -1) {
    throw new Error('pyproject.toml is missing a [project] table heading');
  }
  return { start: projectHeadingEnd, end: nextHeadingStart };
}

function replaceWithinProjectTable(content: string, edit: (projectSlice: string) => string): string {
  const { start, end } = findProjectTableRange(content);
  const slice = content.slice(start, end);
  return content.slice(0, start) + edit(slice) + content.slice(end);
}

function setVersion(content: string, version: string): string {
  return replaceWithinProjectTable(content, (slice) => {
    const match = slice.match(/^version = "[^"]*"/m);
    // A failed targeted write must never be reported as a successful one -- throw instead of
    // silently returning the slice unchanged (mergeManifestFile would still mark `changed: true`
    // and record the new value in the manifest snapshot, permanently desyncing it from the
    // untouched live file). See Finding 1 of the final branch review.
    if (!match) {
      throw new Error('Could not find [project].version in pyproject.toml to update');
    }
    const matchStart = match.index ?? 0;
    return slice.slice(0, matchStart) + `version = "${version}"` + slice.slice(matchStart + match[0].length);
  });
}

function setDependencies(content: string, dependencies: string[]): string {
  return replaceWithinProjectTable(content, (slice) => {
    // Lazy match up to the first "]" after the opening bracket -- matches both the multi-line
    // array form (closing bracket on its own line) and a single-line form
    // (`dependencies = ["a", "b"]`, e.g. after a formatter collapses it), since dependency
    // strings themselves don't contain "]" in practice.
    const match = slice.match(/^dependencies = \[[\s\S]*?\]/m);
    if (!match) {
      throw new Error('Could not find [project].dependencies array in pyproject.toml to update');
    }
    // Preserve whichever bracket style the file already used -- don't force-convert a
    // single-line array to multi-line, or vice versa.
    const isMultiLine = match[0].includes('\n');
    const formatted = isMultiLine
      ? `dependencies = [\n${dependencies.map((d) => `    "${d}",`).join('\n')}\n]`
      : `dependencies = [${dependencies.map((d) => `"${d}"`).join(', ')}]`;
    const matchStart = match.index ?? 0;
    return slice.slice(0, matchStart) + formatted + slice.slice(matchStart + match[0].length);
  });
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
