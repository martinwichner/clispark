// src/update/adapters/dotnet.ts
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Manifest } from '../manifest';
import type { CoreFieldsExtraction, ManifestFileMergeResult, UpdateAdapter } from '../adapter';
import { reconcileEntry, stringEquals, type FieldOutcome } from '../reconcile';

export const CORE_FILE_PATHS = [
  'Cli.slnx',
  'src/Program.cs',
  'src/ICliCommand.cs',
  'src/CommandPathAttribute.cs',
  'src/CommandDiscovery.cs',
  'src/CliUserException.cs',
  'src/Logging/CliLoggerFactory.cs',
  'src/Logging/SensitivePropertyEnricher.cs',
  'tests/Cli.Tests.csproj',
  'ARCHITECTURE.md',
  '.gitignore',
] as const;

export interface DotnetManifestFile {
  raw: string;
  version: string;
  targetFramework: string;
  packageId: string;
  toolCommandName: string;
  packageReferences: Record<string, string>;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractTag(content: string, tag: string): string {
  const match = content.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
  if (!match) throw new Error(`.csproj is missing a <${tag}> tag`);
  return match[1];
}

function extractPackageReferences(content: string): Record<string, string> {
  const refs: Record<string, string> = {};
  const re = /<PackageReference\s+Include="([^"]+)"\s+Version="([^"]+)"\s*\/>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    refs[m[1]] = m[2];
  }
  return refs;
}

function setTag(content: string, tag: string, value: string): string {
  const escapedTag = escapeRegExp(tag);
  return content.replace(new RegExp(`(<${escapedTag}>)[^<]*(</${escapedTag}>)`), `$1${value}$2`);
}

function setPackageReferenceVersion(content: string, name: string, version: string): string {
  const re = new RegExp(`(<PackageReference\\s+Include="${escapeRegExp(name)}"\\s+Version=")[^"]+(")`);
  return content.replace(re, `$1${version}$2`);
}

function addPackageReference(content: string, name: string, version: string): string {
  // Reuses the indentation of the last existing <PackageReference> line
  // immediately preceding </ItemGroup>, so the new line matches siblings exactly.
  const re = /^([ \t]*)<PackageReference[^\n]*\/>\n(?=[ \t]*<\/ItemGroup>)/m;
  return content.replace(re, (match, indent: string) => `${match}${indent}<PackageReference Include="${name}" Version="${version}" />\n`);
}

function parseManifestFile(rawContent: string): DotnetManifestFile {
  return {
    raw: rawContent,
    version: extractTag(rawContent, 'Version'),
    targetFramework: extractTag(rawContent, 'TargetFramework'),
    packageId: extractTag(rawContent, 'PackageId'),
    toolCommandName: extractTag(rawContent, 'ToolCommandName'),
    packageReferences: extractPackageReferences(rawContent),
  };
}

function extractCoreFields(manifestFile: DotnetManifestFile): CoreFieldsExtraction {
  return {
    coreDependencies: manifestFile.packageReferences,
    coreScripts: {},
    coreFields: { TargetFramework: manifestFile.targetFramework },
  };
}

function mergeManifestFile(
  current: DotnetManifestFile,
  oldManifest: Manifest,
  newTemplate: DotnetManifestFile,
): ManifestFileMergeResult {
  let raw = current.raw;
  let changed = false;

  const dependencies: FieldOutcome[] = [];
  const coreDependencies: Record<string, string> = {};

  for (const name of Object.keys(newTemplate.packageReferences)) {
    const newValue = newTemplate.packageReferences[name];
    const currentValue = current.packageReferences[name];
    const oldValue = oldManifest.coreDependencies[name];

    const result = reconcileEntry(currentValue, oldValue, newValue, stringEquals);
    dependencies.push({ key: name, outcome: result.outcome });
    coreDependencies[name] = result.value;

    if (result.outcome === 'added') {
      changed = true;
      raw = addPackageReference(raw, name, result.value);
    } else if (result.outcome !== 'skipped' && result.value !== currentValue) {
      changed = true;
      raw = setPackageReferenceVersion(raw, name, result.value);
    }
  }

  const oldCoreFields = oldManifest.coreFields as { TargetFramework?: string };
  const fields: FieldOutcome[] = [];

  const targetFrameworkResult = reconcileEntry(
    current.targetFramework,
    oldCoreFields.TargetFramework,
    newTemplate.targetFramework,
    stringEquals,
  );
  fields.push({ key: 'TargetFramework', outcome: targetFrameworkResult.outcome });
  if (targetFrameworkResult.outcome !== 'skipped' && targetFrameworkResult.value !== current.targetFramework) {
    changed = true;
    raw = setTag(raw, 'TargetFramework', targetFrameworkResult.value);
  }

  return {
    updatedFile: { ...current, raw },
    changed,
    dependencies,
    scripts: [],
    fields,
    coreDependencies,
    coreScripts: {},
    coreFields: { TargetFramework: targetFrameworkResult.value },
  };
}

export const dotnetAdapter: UpdateAdapter = {
  coreFilePaths() {
    return CORE_FILE_PATHS;
  },

  templateSourcePath(relativePath) {
    return relativePath === '.gitignore' ? 'gitignore' : relativePath;
  },

  manifestFileName: 'src/Cli.csproj',

  async readManifestFile(dir) {
    const content = await readFile(path.join(dir, 'src', 'Cli.csproj'), 'utf8');
    return parseManifestFile(content);
  },

  async writeManifestFile(dir, content) {
    await writeFile(path.join(dir, 'src', 'Cli.csproj'), (content as DotnetManifestFile).raw);
  },

  parseManifestFile,

  readProjectName(manifestFile) {
    return (manifestFile as DotnetManifestFile).packageId;
  },

  extractCoreFields(manifestFile) {
    return extractCoreFields(manifestFile as DotnetManifestFile);
  },

  mergeManifestFile(current, oldManifest, newTemplate) {
    return mergeManifestFile(current as DotnetManifestFile, oldManifest, newTemplate as DotnetManifestFile);
  },
};
