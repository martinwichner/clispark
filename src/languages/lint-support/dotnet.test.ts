import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { stripLintTooling } from './dotnet';

describe('stripLintTooling (dotnet)', () => {
  let targetDir: string;

  beforeEach(async () => {
    targetDir = await mkdtemp(path.join(tmpdir(), 'clispark-strip-lint-dotnet-test-'));
    await mkdir(path.join(targetDir, 'src'), { recursive: true });
    await writeFile(
      path.join(targetDir, 'src', 'Cli.csproj'),
      [
        '<Project Sdk="Microsoft.NET.Sdk">',
        '',
        '  <PropertyGroup>',
        '    <TargetFramework>net10.0</TargetFramework>',
        '  </PropertyGroup>',
        '',
        '  <PropertyGroup>',
        '    <EnableNETAnalyzers>true</EnableNETAnalyzers>',
        '    <AnalysisLevel>latest</AnalysisLevel>',
        '    <AnalysisMode>Recommended</AnalysisMode>',
        '    <EnforceCodeStyleInBuild>true</EnforceCodeStyleInBuild>',
        '  </PropertyGroup>',
        '',
        '</Project>',
        '',
      ].join('\n'),
    );
  });

  afterEach(async () => {
    await rm(targetDir, { recursive: true, force: true });
  });

  it('removes the analyzer PropertyGroup, leaves the rest of the file intact', async () => {
    await stripLintTooling(targetDir);
    const content = await readFile(path.join(targetDir, 'src', 'Cli.csproj'), 'utf8');
    expect(content).not.toContain('EnableNETAnalyzers');
    expect(content).toContain('<TargetFramework>net10.0</TargetFramework>');
  });

  // The real template file (and any project scaffolded on Windows) has CRLF line
  // endings, not the LF the fixture above uses -- a regex anchored on bare \n would
  // silently fail to match and leave the analyzer PropertyGroup in place.
  it('also strips the analyzer PropertyGroup when the file uses CRLF line endings', async () => {
    const crlfContent = [
      '<Project Sdk="Microsoft.NET.Sdk">',
      '',
      '  <PropertyGroup>',
      '    <TargetFramework>net10.0</TargetFramework>',
      '  </PropertyGroup>',
      '',
      '  <PropertyGroup>',
      '    <EnableNETAnalyzers>true</EnableNETAnalyzers>',
      '    <AnalysisLevel>latest</AnalysisLevel>',
      '    <AnalysisMode>Recommended</AnalysisMode>',
      '    <EnforceCodeStyleInBuild>true</EnforceCodeStyleInBuild>',
      '  </PropertyGroup>',
      '',
      '</Project>',
      '',
    ].join('\r\n');
    await writeFile(path.join(targetDir, 'src', 'Cli.csproj'), crlfContent);

    await stripLintTooling(targetDir);
    const content = await readFile(path.join(targetDir, 'src', 'Cli.csproj'), 'utf8');
    expect(content).not.toContain('EnableNETAnalyzers');
    expect(content).toContain('<TargetFramework>net10.0</TargetFramework>');
  });
});
