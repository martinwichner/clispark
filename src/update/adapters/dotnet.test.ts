// src/update/adapters/dotnet.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { dotnetAdapter, type DotnetManifestFile } from './dotnet';
import type { Manifest } from '../manifest';

const SAMPLE_CSPROJ = `<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net10.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
    <RootNamespace>Cli</RootNamespace>
    <AssemblyName>MyTool</AssemblyName>
    <Version>0.1.0</Version>
    <PackAsTool>true</PackAsTool>
    <ToolCommandName>MyTool</ToolCommandName>
    <PackageId>MyTool</PackageId>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="System.CommandLine" Version="2.0.10" />
    <PackageReference Include="Serilog" Version="4.4.0" />
  </ItemGroup>

</Project>
`;

function baseManifest(overrides: Partial<Manifest> = {}): Manifest {
  return {
    generatorVersion: '1.0.0',
    language: 'dotnet',
    coreFiles: {},
    coreDependencies: {},
    coreScripts: {},
    coreFields: { TargetFramework: 'net10.0' },
    ...overrides,
  };
}

describe('dotnetAdapter.parseManifestFile', () => {
  it('extracts version, targetFramework, packageId, toolCommandName, and packageReferences', () => {
    const parsed = dotnetAdapter.parseManifestFile(SAMPLE_CSPROJ) as DotnetManifestFile;
    expect(parsed.version).toBe('0.1.0');
    expect(parsed.targetFramework).toBe('net10.0');
    expect(parsed.packageId).toBe('MyTool');
    expect(parsed.toolCommandName).toBe('MyTool');
    expect(parsed.packageReferences).toEqual({ 'System.CommandLine': '2.0.10', Serilog: '4.4.0' });
  });
});

describe('dotnetAdapter.readProjectName', () => {
  it('reads the PackageId as the project name', () => {
    const parsed = dotnetAdapter.parseManifestFile(SAMPLE_CSPROJ);
    expect(dotnetAdapter.readProjectName(parsed)).toBe('MyTool');
  });
});

describe('dotnetAdapter.extractCoreFields', () => {
  it('puts every PackageReference into coreDependencies', () => {
    const parsed = dotnetAdapter.parseManifestFile(SAMPLE_CSPROJ);
    const result = dotnetAdapter.extractCoreFields(parsed);
    expect(result.coreDependencies).toEqual({ 'System.CommandLine': '2.0.10', Serilog: '4.4.0' });
  });

  it('has no coreScripts (.NET has no script-map equivalent)', () => {
    const parsed = dotnetAdapter.parseManifestFile(SAMPLE_CSPROJ);
    const result = dotnetAdapter.extractCoreFields(parsed);
    expect(result.coreScripts).toEqual({});
  });

  it('puts only TargetFramework into coreFields, not PackageId/ToolCommandName', () => {
    const parsed = dotnetAdapter.parseManifestFile(SAMPLE_CSPROJ);
    const result = dotnetAdapter.extractCoreFields(parsed);
    expect(result.coreFields).toEqual({ TargetFramework: 'net10.0' });
  });
});

describe('dotnetAdapter.mergeManifestFile', () => {
  it('replaces a dependency version that matches the old manifest (untouched by the user)', () => {
    const current = dotnetAdapter.parseManifestFile(SAMPLE_CSPROJ);
    const newTemplate = dotnetAdapter.parseManifestFile(
      SAMPLE_CSPROJ.replace('Version="2.0.10"', 'Version="2.1.0"'),
    );
    const oldManifest = baseManifest({
      coreDependencies: { 'System.CommandLine': '2.0.10', Serilog: '4.4.0' },
    });

    const result = dotnetAdapter.mergeManifestFile(current, oldManifest, newTemplate);

    expect(result.changed).toBe(true);
    expect(result.dependencies).toContainEqual({ key: 'System.CommandLine', outcome: 'replaced' });
    expect((result.updatedFile as DotnetManifestFile).raw).toContain('<PackageReference Include="System.CommandLine" Version="2.1.0" />');
  });

  it('skips a dependency version the user changed locally', () => {
    const current = dotnetAdapter.parseManifestFile(SAMPLE_CSPROJ.replace('Version="2.0.10"', 'Version="9.9.9"'));
    const newTemplate = dotnetAdapter.parseManifestFile(
      SAMPLE_CSPROJ.replace('Version="2.0.10"', 'Version="2.1.0"'),
    );
    const oldManifest = baseManifest({
      coreDependencies: { 'System.CommandLine': '2.0.10', Serilog: '4.4.0' },
    });

    const result = dotnetAdapter.mergeManifestFile(current, oldManifest, newTemplate);

    expect(result.dependencies).toContainEqual({ key: 'System.CommandLine', outcome: 'skipped' });
    expect((result.updatedFile as DotnetManifestFile).raw).toContain('Version="9.9.9"');
  });

  it('adds a brand-new dependency the current file does not have yet', () => {
    const current = dotnetAdapter.parseManifestFile(SAMPLE_CSPROJ);
    const newTemplate = dotnetAdapter.parseManifestFile(
      SAMPLE_CSPROJ.replace(
        '</ItemGroup>',
        '    <PackageReference Include="Xdg.Directories" Version="0.1.2" />\n  </ItemGroup>',
      ),
    );
    const oldManifest = baseManifest({
      coreDependencies: { 'System.CommandLine': '2.0.10', Serilog: '4.4.0' },
    });

    const result = dotnetAdapter.mergeManifestFile(current, oldManifest, newTemplate);

    expect(result.dependencies).toContainEqual({ key: 'Xdg.Directories', outcome: 'added' });
    expect((result.updatedFile as DotnetManifestFile).raw).toContain('Xdg.Directories');
  });

  it('replaces TargetFramework when unchanged from the old manifest', () => {
    const current = dotnetAdapter.parseManifestFile(SAMPLE_CSPROJ);
    const newTemplate = dotnetAdapter.parseManifestFile(SAMPLE_CSPROJ.replace('net10.0', 'net11.0'));
    const oldManifest = baseManifest({ coreFields: { TargetFramework: 'net10.0' } });

    const result = dotnetAdapter.mergeManifestFile(current, oldManifest, newTemplate);

    expect(result.fields).toContainEqual({ key: 'TargetFramework', outcome: 'replaced' });
    expect((result.updatedFile as DotnetManifestFile).raw).toContain('<TargetFramework>net11.0</TargetFramework>');
  });

  it('leaves everything else in the file byte-identical', () => {
    const current = dotnetAdapter.parseManifestFile(SAMPLE_CSPROJ);
    const newTemplate = dotnetAdapter.parseManifestFile(
      SAMPLE_CSPROJ.replace('Version="2.0.10"', 'Version="2.1.0"'),
    );
    const oldManifest = baseManifest({
      coreDependencies: { 'System.CommandLine': '2.0.10', Serilog: '4.4.0' },
    });

    const result = dotnetAdapter.mergeManifestFile(current, oldManifest, newTemplate);
    const updatedRaw = (result.updatedFile as DotnetManifestFile).raw;

    expect(updatedRaw).toContain('<AssemblyName>MyTool</AssemblyName>');
    expect(updatedRaw).toContain('<RootNamespace>Cli</RootNamespace>');
    expect(updatedRaw).toContain('<PackAsTool>true</PackAsTool>');
  });
});

describe('dotnetAdapter.readManifestFile / writeManifestFile', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(path.join(tmpdir(), 'clispark-dotnet-adapter-test-'));
    await mkdir(path.join(tmpRoot, 'src'), { recursive: true });
    await writeFile(path.join(tmpRoot, 'src', 'Cli.csproj'), SAMPLE_CSPROJ);
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it('reads src/Cli.csproj and parses it', async () => {
    const manifestFile = (await dotnetAdapter.readManifestFile(tmpRoot)) as DotnetManifestFile;
    expect(manifestFile.version).toBe('0.1.0');
  });

  it('writes the raw content back to src/Cli.csproj', async () => {
    const manifestFile = (await dotnetAdapter.readManifestFile(tmpRoot)) as DotnetManifestFile;
    const modified: DotnetManifestFile = { ...manifestFile, raw: manifestFile.raw.replace('0.1.0', '0.2.0') };

    await dotnetAdapter.writeManifestFile(tmpRoot, modified);

    const written = await readFile(path.join(tmpRoot, 'src', 'Cli.csproj'), 'utf8');
    expect(written).toContain('<Version>0.2.0</Version>');
  });
});

describe('dotnetAdapter.coreFilePaths / templateSourcePath', () => {
  it('lists the .NET infrastructure files as core files', () => {
    expect(dotnetAdapter.coreFilePaths).toContain('src/Program.cs');
    expect(dotnetAdapter.coreFilePaths).toContain('src/CommandDiscovery.cs');
    expect(dotnetAdapter.coreFilePaths).toContain('Cli.slnx');
    expect(dotnetAdapter.coreFilePaths).not.toContain('src/Commands/HelloCommand.cs');
  });

  it('maps .gitignore to the un-dotted "gitignore" template file', () => {
    expect(dotnetAdapter.templateSourcePath('.gitignore')).toBe('gitignore');
  });

  it('leaves every other path unchanged', () => {
    expect(dotnetAdapter.templateSourcePath('src/Program.cs')).toBe('src/Program.cs');
  });
});
