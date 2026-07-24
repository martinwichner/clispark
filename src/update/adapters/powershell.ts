// src/update/adapters/powershell.ts
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import spawn from 'cross-spawn';
import type { Manifest } from '../manifest';
import type { CoreFieldsExtraction, ManifestFileMergeResult, UpdateAdapter } from '../adapter';
import { reconcileEntry, type FieldOutcome } from '../reconcile';

// The manifest (Module.psd1) is deliberately NOT in this list — it has its own dedicated
// read/write/merge path via manifestFileName/readManifestFile/writeManifestFile/mergeManifestFile
// below, exactly like Cli.csproj is excluded from the .NET adapter's CORE_FILE_PATHS (see
// src/update/adapters/dotnet.ts). Including it here too would make the generic coreFilePaths
// hash-compare-and-copy loop in update.ts fight over the same file with the manifest-merge logic.
export const CORE_FILE_PATHS = [
  'Module.psm1',
  'Logging/Initialize-Logging.ps1',
  'ARCHITECTURE.md',
  '.gitignore',
] as const;

export interface PowershellManifestFile {
  raw: string;
  version: string;
  requiredModules: string[];
}

function arrayEquals(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** PowerShell's escaping rule for a literal single quote inside a single-quoted string literal
 *  is to double it (`''`) — without this, a `manifestPath` containing a single quote (e.g. a
 *  real Windows path like `C:\Users\O'Brien\project\Module.psd1`) would break out of the
 *  `-Path '...'` string literal built below. */
export function escapeSingleQuotedPowerShellString(value: string): string {
  return value.replace(/'/g, "''");
}

/** Reads a real .psd1 via a `pwsh` subprocess — parsing PowerShell's data-language syntax
 *  ourselves in Node would mean re-implementing a real parser for a real language; shelling
 *  out to the one interpreter that already parses it correctly is the safer choice (see spec). */
function readManifestViaPwsh(manifestPath: string): Promise<{ ModuleVersion: string; RequiredModules: string[] }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'pwsh',
      [
        '-NoProfile',
        '-Command',
        `(Import-PowerShellDataFile -Path '${escapeSingleQuotedPowerShellString(manifestPath)}') | ConvertTo-Json -Depth 5 -Compress`,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => (stdout += chunk));
    child.stderr?.on('data', (chunk) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`pwsh exited with code ${code} reading ${manifestPath}: ${stderr}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (err) {
        reject(new Error(`Could not parse pwsh JSON output for ${manifestPath}: ${String(err)}\nOutput: ${stdout}`));
      }
    });
  });
}

export function parseManifestFile(rawContent: string): PowershellManifestFile {
  const versionMatch = rawContent.match(/ModuleVersion\s*=\s*'([^']*)'/);
  if (!versionMatch) throw new Error('Module.psd1 is missing a ModuleVersion field');
  const requiredModulesMatch = rawContent.match(/RequiredModules\s*=\s*@\(([^)]*)\)/);
  const requiredModules = requiredModulesMatch
    ? requiredModulesMatch[1]
        .split(',')
        .map((s) => s.trim().replace(/^'|'$/g, ''))
        .filter(Boolean)
    : [];
  return { raw: rawContent, version: versionMatch[1], requiredModules };
}

function setModuleVersion(content: string, version: string): string {
  return content.replace(/(ModuleVersion\s*=\s*')[^']*(')/, `$1${version}$2`);
}

function setRequiredModules(content: string, modules: string[]): string {
  const formatted = modules.map((m) => `'${m}'`).join(', ');
  return content.replace(/(RequiredModules\s*=\s*@\()[^)]*(\))/, `$1${formatted}$2`);
}

function extractCoreFields(manifestFile: PowershellManifestFile): CoreFieldsExtraction {
  const coreDependencies: Record<string, string> = {};
  for (const name of manifestFile.requiredModules) coreDependencies[name] = '*';
  return { coreDependencies, coreScripts: {}, coreFields: { RequiredModulesCount: manifestFile.requiredModules.length } };
}

function mergeManifestFile(
  current: PowershellManifestFile,
  oldManifest: Manifest,
  newTemplate: PowershellManifestFile,
): ManifestFileMergeResult {
  let raw = current.raw;
  let changed = false;

  const dependencies: FieldOutcome[] = [];
  const coreDependencies: Record<string, string> = {};
  const mergedModules: string[] = [];

  // Deliberate scope simplification vs. Node/.NET: RequiredModules here is a flat list of bare
  // module names, not name-to-version pairs (matching this template's Module.psd1, which doesn't
  // pin RequiredModules versions). reconcileEntry is reused for its added/replaced/skipped
  // presence logic, not for version-bump handling — there is no version to bump. If per-module
  // version pinning is ever added to the manifest, this loop needs revisiting.
  for (const name of newTemplate.requiredModules) {
    const currentHasIt = current.requiredModules.includes(name);
    const oldHadIt = Object.prototype.hasOwnProperty.call(oldManifest.coreDependencies, name);
    const result = reconcileEntry<string | undefined>(
      currentHasIt ? name : undefined,
      oldHadIt ? name : undefined,
      name,
      (a, b) => a === b,
    );
    dependencies.push({ key: name, outcome: result.outcome });
    if (result.value) {
      coreDependencies[name] = '*';
      mergedModules.push(result.value);
    }
  }
  // Preserve any modules the current file has that the new template doesn't mention
  // (a user's own added dependency) — never silently dropped by an update.
  for (const name of current.requiredModules) {
    if (!mergedModules.includes(name)) mergedModules.push(name);
  }

  if (!arrayEquals(mergedModules, current.requiredModules)) {
    changed = true;
    raw = setRequiredModules(raw, mergedModules);
  }

  const versionResult = reconcileEntry(current.version, oldManifest.generatorVersion, newTemplate.version, (a, b) => a === b);
  if (versionResult.value !== current.version) {
    changed = true;
    raw = setModuleVersion(raw, versionResult.value);
  }

  return {
    updatedFile: { ...current, raw, requiredModules: mergedModules },
    changed,
    dependencies,
    scripts: [],
    fields: [],
    coreDependencies,
    coreScripts: {},
    coreFields: { RequiredModulesCount: mergedModules.length },
  };
}

export const powershellAdapter: UpdateAdapter = {
  coreFilePaths: CORE_FILE_PATHS,

  templateSourcePath(relativePath) {
    return relativePath === '.gitignore' ? 'gitignore' : relativePath;
  },

  manifestFileName: 'Module.psd1',

  async readManifestFile(dir) {
    const manifestPath = path.join(dir, 'Module.psd1');
    const raw = await readFile(manifestPath, 'utf8');
    const parsedViaPwsh = await readManifestViaPwsh(manifestPath);
    return {
      raw,
      version: parsedViaPwsh.ModuleVersion,
      requiredModules: parsedViaPwsh.RequiredModules ?? [],
    } satisfies PowershellManifestFile;
  },

  async writeManifestFile(dir, content) {
    await writeFile(path.join(dir, 'Module.psd1'), (content as PowershellManifestFile).raw);
  },

  parseManifestFile,

  readProjectName() {
    // See Global Constraints: the manifest filename is always "Module.psd1" regardless of
    // project name, so there is no per-project name field to read back out of it — the real
    // project name always comes from scaffold's own targetDir, never round-tripped through
    // this file. This sentinel exists only to satisfy the interface; update.ts never displays
    // it for this language (verify in Task 6's manual check).
    return '__scaffolded-from-targetDir__';
  },

  extractCoreFields(manifestFile) {
    return extractCoreFields(manifestFile as PowershellManifestFile);
  },

  mergeManifestFile(current, oldManifest, newTemplate) {
    return mergeManifestFile(current as PowershellManifestFile, oldManifest, newTemplate as PowershellManifestFile);
  },
};
