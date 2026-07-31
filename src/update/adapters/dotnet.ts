// src/update/adapters/dotnet.ts
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Manifest } from '../manifest';
import type { CoreFieldsExtraction, CoreFilePathsFlags, ManifestFileMergeResult, UpdateAdapter } from '../adapter';
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

export const ANALYZER_FILE_PATHS = ['Cli.Analyzers/Cli.Analyzers.csproj', 'Cli.Analyzers/CommandPathAnalyzer.cs'] as const;

export interface DotnetManifestFile {
  raw: string;
  version: string;
  targetFramework: string;
  packageId: string;
  toolCommandName: string;
  packageReferences: Record<string, string>;
  analyzerProperties: Partial<Record<AnalyzerPropertyName, string>>;
  projectReference: string | undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractTag(content: string, tag: string): string {
  const match = content.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
  if (!match) throw new Error(`.csproj is missing a <${tag}> tag`);
  return match[1];
}

// Unlike extractTag, does not throw when the tag is missing: a project that declined
// lint tooling has stripped the whole analyzer <PropertyGroup>, so these four tags
// genuinely don't exist there -- that's a valid state, not a malformed .csproj.
function extractOptionalTag(content: string, tag: string): string | undefined {
  const match = content.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
  return match?.[1];
}

export const ANALYZER_PROPERTY_NAMES = [
  'EnableNETAnalyzers',
  'AnalysisLevel',
  'AnalysisMode',
  'EnforceCodeStyleInBuild',
] as const;

export type AnalyzerPropertyName = (typeof ANALYZER_PROPERTY_NAMES)[number];

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

function extractAnalyzerProperties(content: string): Partial<Record<AnalyzerPropertyName, string>> {
  const properties: Partial<Record<AnalyzerPropertyName, string>> = {};
  for (const name of ANALYZER_PROPERTY_NAMES) {
    const value = extractOptionalTag(content, name);
    if (value !== undefined) properties[name] = value;
  }
  return properties;
}

const PROJECT_REFERENCE_LINE = /<ProjectReference Include="\.\.\\Cli\.Analyzers\\Cli\.Analyzers\.csproj"[^\n]*\/>/;

function extractProjectReference(content: string): string | undefined {
  return content.match(PROJECT_REFERENCE_LINE)?.[0];
}

function setProjectReference(content: string, value: string): string {
  return content.replace(PROJECT_REFERENCE_LINE, value);
}

function parseManifestFile(rawContent: string): DotnetManifestFile {
  return {
    raw: rawContent,
    version: extractTag(rawContent, 'Version'),
    targetFramework: extractTag(rawContent, 'TargetFramework'),
    packageId: extractTag(rawContent, 'PackageId'),
    toolCommandName: extractTag(rawContent, 'ToolCommandName'),
    packageReferences: extractPackageReferences(rawContent),
    analyzerProperties: extractAnalyzerProperties(rawContent),
    projectReference: extractProjectReference(rawContent),
  };
}

function extractCoreFields(manifestFile: DotnetManifestFile, flags: CoreFilePathsFlags): CoreFieldsExtraction {
  const coreFields: Record<string, unknown> = { TargetFramework: manifestFile.targetFramework };
  if (flags.lintEnabled) {
    for (const name of ANALYZER_PROPERTY_NAMES) {
      const value = manifestFile.analyzerProperties[name];
      if (value !== undefined) coreFields[name] = value;
    }
  }
  if (flags.commandConventionEnabled && manifestFile.projectReference !== undefined) {
    coreFields.projectReference = manifestFile.projectReference;
  }
  return {
    coreDependencies: manifestFile.packageReferences,
    coreScripts: {},
    coreFields,
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

  const oldCoreFields = oldManifest.coreFields as { TargetFramework?: string; projectReference?: string } & Partial<
    Record<AnalyzerPropertyName, string>
  >;
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

  const coreFields: Record<string, unknown> = { TargetFramework: targetFrameworkResult.value };

  // Only reconcile the analyzer properties for a project that had them at scaffold time --
  // a declined project's .csproj lacks the whole analyzer PropertyGroup, and must never have
  // it reintroduced by an update (mirrors Task 3's lintEnabled gate on eslint/prettier).
  if (oldManifest.lintEnabled) {
    for (const name of ANALYZER_PROPERTY_NAMES) {
      const newValue = newTemplate.analyzerProperties[name];
      if (newValue === undefined) continue;
      const currentValue = current.analyzerProperties[name];

      // A hand-edited/partially-reverted .csproj can be missing one (or all) of the four
      // analyzer tags even though the project is opted in (oldManifest.lintEnabled). Unlike
      // PackageReference, this adapter has no insertion path for a missing analyzer tag, so
      // reconcileEntry's `currentValue === undefined` -> 'added' branch would be a lie here:
      // nothing gets written to the file. Treat it as a no-op instead -- report 'skipped' (which
      // formatUpdateSummary already omits from the printed summary) and leave coreFields alone
      // so the manifest only ever records values that actually exist on disk.
      if (currentValue === undefined) {
        fields.push({ key: name, outcome: 'skipped' });
        continue;
      }

      const oldValue = oldCoreFields[name];
      const result = reconcileEntry(currentValue, oldValue, newValue, stringEquals);
      fields.push({ key: name, outcome: result.outcome });
      coreFields[name] = result.value;

      if (result.outcome !== 'skipped' && result.value !== currentValue) {
        changed = true;
        raw = setTag(raw, name, result.value);
      }
    }
  }

  // Same "missing element on an opted-in project is a no-op, not an insertion" caveat as the
  // analyzer-properties block above: a hand-edited .csproj could have removed the
  // <ProjectReference> line while the manifest still says opted-in. This adapter has no
  // insertion path for a missing <ProjectReference> (unlike PackageReference), so treat a
  // missing current value as 'skipped' rather than lying about an 'added' write.
  if (oldManifest.commandConventionEnabled) {
    const newValue = newTemplate.projectReference;
    if (newValue !== undefined) {
      const currentValue = current.projectReference;
      if (currentValue === undefined) {
        fields.push({ key: 'projectReference', outcome: 'skipped' });
      } else {
        const oldValue = oldCoreFields.projectReference;
        const result = reconcileEntry(currentValue, oldValue, newValue, stringEquals);
        fields.push({ key: 'projectReference', outcome: result.outcome });
        coreFields.projectReference = result.value;
        if (result.outcome !== 'skipped' && result.value !== currentValue) {
          changed = true;
          raw = setProjectReference(raw, result.value);
        }
      }
    }
  }

  return {
    updatedFile: { ...current, raw },
    changed,
    dependencies,
    scripts: [],
    fields,
    coreDependencies,
    coreScripts: {},
    coreFields,
  };
}

export const dotnetAdapter: UpdateAdapter = {
  coreFilePaths(flags) {
    return flags.commandConventionEnabled ? [...CORE_FILE_PATHS, ...ANALYZER_FILE_PATHS] : CORE_FILE_PATHS;
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

  extractCoreFields(manifestFile, flags) {
    return extractCoreFields(manifestFile as DotnetManifestFile, flags);
  },

  mergeManifestFile(current, oldManifest, newTemplate) {
    return mergeManifestFile(current as DotnetManifestFile, oldManifest, newTemplate as DotnetManifestFile);
  },
};
