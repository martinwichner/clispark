import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { stripCommandConvention } from './dotnet';

describe('stripCommandConvention (dotnet)', () => {
  let targetDir: string;

  beforeEach(async () => {
    targetDir = await mkdtemp(path.join(tmpdir(), 'clispark-strip-convention-test-'));
    await mkdir(path.join(targetDir, 'Cli.Analyzers'), { recursive: true });
    await writeFile(path.join(targetDir, 'Cli.Analyzers', 'Cli.Analyzers.csproj'), '<Project Sdk="Microsoft.NET.Sdk"></Project>\n');
    await writeFile(path.join(targetDir, 'Cli.Analyzers', 'CommandPathAnalyzer.cs'), 'namespace Cli.Analyzers;\n');
    await mkdir(path.join(targetDir, 'src'), { recursive: true });
    await writeFile(
      path.join(targetDir, 'src', 'Cli.csproj'),
      [
        '<Project Sdk="Microsoft.NET.Sdk">',
        '',
        '  <ItemGroup>',
        '    <PackageReference Include="System.CommandLine" Version="2.0.10" />',
        '  </ItemGroup>',
        '',
        '  <ItemGroup>',
        '    <ProjectReference Include="..\\Cli.Analyzers\\Cli.Analyzers.csproj" OutputItemType="Analyzer" ReferenceOutputAssembly="false" />',
        '  </ItemGroup>',
        '',
        '</Project>',
        '',
      ].join('\r\n'),
    );
  });

  afterEach(async () => {
    await rm(targetDir, { recursive: true, force: true });
  });

  it('removes the Cli.Analyzers directory entirely', async () => {
    await stripCommandConvention(targetDir);
    await expect(readFile(path.join(targetDir, 'Cli.Analyzers', 'Cli.Analyzers.csproj'), 'utf8')).rejects.toThrow();
  });

  it('removes the ProjectReference ItemGroup from Cli.csproj, keeps the rest', async () => {
    await stripCommandConvention(targetDir);
    const content = await readFile(path.join(targetDir, 'src', 'Cli.csproj'), 'utf8');
    expect(content).not.toContain('Cli.Analyzers');
    expect(content).toContain('System.CommandLine');
  });
});
