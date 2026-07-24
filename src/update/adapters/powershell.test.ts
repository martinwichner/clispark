// src/update/adapters/powershell.test.ts
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { powershellAdapter, parseManifestFile, escapeSingleQuotedPowerShellString, type PowershellManifestFile } from './powershell';
import type { Manifest } from '../manifest';

const SAMPLE_MANIFEST = `@{
    RootModule        = 'Module.psm1'
    ModuleVersion     = '0.1.0'
    GUID              = '11111111-1111-1111-1111-111111111111'
    Author            = 'Unknown'
    FunctionsToExport = @('Get-Hello')
    RequiredModules   = @('PSFramework', 'Pester', 'Microsoft.PowerShell.PSResourceGet')
}
`;

describe('powershellAdapter.readManifestFile / parseManifestFile', () => {
  it('reads real ModuleVersion and RequiredModules from a real .psd1 via pwsh', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'ps-manifest-'));
    await writeFile(path.join(dir, 'Module.psd1'), SAMPLE_MANIFEST);

    const manifestFile = (await powershellAdapter.readManifestFile(dir)) as PowershellManifestFile;

    expect(manifestFile.version).toBe('0.1.0');
    expect(manifestFile.requiredModules).toEqual(['PSFramework', 'Pester', 'Microsoft.PowerShell.PSResourceGet']);
  });
});

describe('parseManifestFile', () => {
  it('extracts version and requiredModules from a raw .psd1 string', () => {
    const manifestFile = parseManifestFile(SAMPLE_MANIFEST);

    expect(manifestFile.raw).toBe(SAMPLE_MANIFEST);
    expect(manifestFile.version).toBe('0.1.0');
    expect(manifestFile.requiredModules).toEqual(['PSFramework', 'Pester', 'Microsoft.PowerShell.PSResourceGet']);
  });

  it('returns an empty requiredModules array when RequiredModules is absent', () => {
    const noModules = SAMPLE_MANIFEST.replace(
      "    RequiredModules   = @('PSFramework', 'Pester', 'Microsoft.PowerShell.PSResourceGet')\n",
      '',
    );

    const manifestFile = parseManifestFile(noModules);

    expect(manifestFile.version).toBe('0.1.0');
    expect(manifestFile.requiredModules).toEqual([]);
  });

  it('throws when ModuleVersion is missing', () => {
    const noVersion = SAMPLE_MANIFEST.replace("ModuleVersion     = '0.1.0'\n", '');

    expect(() => parseManifestFile(noVersion)).toThrow('Module.psd1 is missing a ModuleVersion field');
  });
});

describe('escapeSingleQuotedPowerShellString', () => {
  it('doubles a single embedded single quote', () => {
    expect(escapeSingleQuotedPowerShellString("O'Brien")).toBe("O''Brien");
  });

  it('leaves strings with no single quotes unchanged', () => {
    expect(escapeSingleQuotedPowerShellString('plain-path')).toBe('plain-path');
  });

  it('doubles every single quote when there are several', () => {
    expect(escapeSingleQuotedPowerShellString("it's O'Brien's")).toBe("it''s O''Brien''s");
  });
});

describe('powershellAdapter.readManifestFile with a single quote in the path', () => {
  it("reads a real .psd1 whose containing directory name contains a literal single quote (e.g. O'Brien)", async () => {
    // Regression test for the pwsh command-injection/parse-break bug: readManifestViaPwsh used to
    // interpolate manifestPath into a PowerShell single-quoted string literal unescaped, so a path
    // containing a single quote (a real possibility on Windows, e.g. C:\Users\O'Brien\...) would
    // break out of the string literal. This test proves the fix works against a real directory
    // with a real embedded quote, not just the escaping helper in isolation.
    const dir = await mkdtemp(path.join(tmpdir(), "ps-manifest-o'brien-"));
    await writeFile(path.join(dir, 'Module.psd1'), SAMPLE_MANIFEST);

    const manifestFile = (await powershellAdapter.readManifestFile(dir)) as PowershellManifestFile;

    expect(manifestFile.version).toBe('0.1.0');
    expect(manifestFile.requiredModules).toEqual(['PSFramework', 'Pester', 'Microsoft.PowerShell.PSResourceGet']);
  });
});

describe('powershellAdapter.extractCoreFields', () => {
  it('exposes RequiredModules as coreDependencies (version-less — module names only)', () => {
    const manifestFile: PowershellManifestFile = {
      raw: SAMPLE_MANIFEST,
      version: '0.1.0',
      requiredModules: ['PSFramework', 'Pester'],
    };
    const extraction = powershellAdapter.extractCoreFields(manifestFile);
    expect(extraction.coreDependencies).toEqual({ PSFramework: '*', Pester: '*' });
    expect(extraction.coreScripts).toEqual({});
  });
});

describe('powershellAdapter.mergeManifestFile', () => {
  it('adds a new RequiredModules entry that the current file is missing', () => {
    const current: PowershellManifestFile = {
      raw: SAMPLE_MANIFEST.replace(
        "RequiredModules   = @('PSFramework', 'Pester', 'Microsoft.PowerShell.PSResourceGet')",
        "RequiredModules   = @('PSFramework', 'Pester')",
      ),
      version: '0.1.0',
      requiredModules: ['PSFramework', 'Pester'],
    };
    const newTemplate: PowershellManifestFile = {
      raw: SAMPLE_MANIFEST,
      version: '0.2.0',
      requiredModules: ['PSFramework', 'Pester', 'Microsoft.PowerShell.PSResourceGet'],
    };
    const oldManifest = {
      generatorVersion: '0.1.0',
      language: 'powershell',
      coreDependencies: { PSFramework: '*', Pester: '*' },
      coreScripts: {},
      coreFields: {},
      coreFileHashes: {},
    } as unknown as Manifest;

    const result = powershellAdapter.mergeManifestFile(current, oldManifest, newTemplate);

    expect(result.changed).toBe(true);
    expect((result.updatedFile as PowershellManifestFile).raw).toContain(
      "RequiredModules   = @('PSFramework', 'Pester', 'Microsoft.PowerShell.PSResourceGet')",
    );
  });

  it('reports no change when current, old, and new template are already all in sync', () => {
    // current already has all three modules, matching both oldManifest.coreDependencies and
    // newTemplate exactly — confirms mergeManifestFile doesn't spuriously report `changed: true`
    // (and doesn't rewrite `raw`) when there is genuinely nothing to reconcile. Removal handling
    // itself reuses reconcileEntry's existing added/replaced/skipped logic, already covered by
    // the Node/.NET adapters' own tests — not re-tested here to avoid duplicating that coverage.
    const current: PowershellManifestFile = {
      raw: SAMPLE_MANIFEST,
      version: '0.1.0',
      requiredModules: ['PSFramework', 'Pester', 'Microsoft.PowerShell.PSResourceGet'],
    };
    const newTemplate: PowershellManifestFile = { ...current };
    const oldManifest = {
      generatorVersion: '0.1.0',
      language: 'powershell',
      coreDependencies: { PSFramework: '*', Pester: '*', 'Microsoft.PowerShell.PSResourceGet': '*' },
      coreScripts: {},
      coreFields: {},
      coreFileHashes: {},
    } as unknown as Manifest;

    const result = powershellAdapter.mergeManifestFile(current, oldManifest, newTemplate);

    expect(result.changed).toBe(false);
  });
});

describe('powershellAdapter.readProjectName', () => {
  it('returns a fixed sentinel — the manifest has no per-project name field to read', () => {
    // Unlike Node (package.json "name") / .NET (<PackageId>), the manifest's own fixed-filename
    // convention (see plan Global Constraints) means the manifest itself carries no per-project
    // name field — readProjectName returns a fixed sentinel; the real project name always comes
    // from the scaffold's own targetDir/projectName, never round-tripped through the manifest.
    const manifestFile: PowershellManifestFile = { raw: SAMPLE_MANIFEST, version: '0.1.0', requiredModules: [] };
    expect(powershellAdapter.readProjectName(manifestFile)).toBe('__scaffolded-from-targetDir__');
  });
});
