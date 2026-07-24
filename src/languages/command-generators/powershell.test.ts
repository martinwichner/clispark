// src/languages/command-generators/powershell.test.ts
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { powershellCommandGenerator } from './powershell';
import type { CommandSpec } from '../command-generator';

describe('powershellCommandGenerator.listExistingCommands', () => {
  it('lists cmdlet names from Public/*.ps1 filenames', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'ps-list-'));
    await mkdir(path.join(dir, 'Public'), { recursive: true });
    await writeFile(path.join(dir, 'Public', 'Get-Hello.ps1'), 'function Get-Hello {}');
    await writeFile(path.join(dir, 'Public', 'Set-Config.ps1'), 'function Set-Config {}');

    const result = await powershellCommandGenerator.listExistingCommands(dir);

    expect(result.map((n) => n.path).sort()).toEqual(['Get-Hello', 'Set-Config']);
  });
});

describe('powershellCommandGenerator.generateCommand', () => {
  it('creates a Public/<Verb-Noun>.ps1 file with a typed param() block and a Pester test', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'ps-gen-'));
    await mkdir(path.join(dir, 'Public'), { recursive: true });
    await mkdir(path.join(dir, 'tests'), { recursive: true });

    const spec: CommandSpec = {
      pathSegments: ['Get-TaskList'],
      parameters: [
        { name: 'name', type: 'string', required: true },
        { name: 'count', type: 'integer', required: false },
        { name: 'verbose', type: 'boolean', required: false },
        { name: 'format', type: 'enum', required: false, allowedValues: ['json', 'table'] },
      ],
    };

    const result = await powershellCommandGenerator.generateCommand(dir, spec);

    expect(result.commandFile).toBe('Public/Get-TaskList.ps1');
    expect(result.testFile).toBe('tests/Get-TaskList.Tests.ps1');

    const content = await readFile(path.join(dir, 'Public', 'Get-TaskList.ps1'), 'utf8');
    expect(content).toContain('function Get-TaskList');
    expect(content).toContain('[Parameter(Mandatory)]');
    expect(content).toContain('[string]$name');
    expect(content).toContain('[int]$count');
    expect(content).toContain('[switch]$verbose');
    expect(content).toContain("[ValidateSet('json', 'table')]");
    expect(content).toContain('[string]$format');

    const testContent = await readFile(path.join(dir, 'tests', 'Get-TaskList.Tests.ps1'), 'utf8');
    expect(testContent).toContain('Describe');
    // The one Mandatory, non-boolean parameter (name) must get a sample value in the
    // generated invocation — otherwise the smoke test would hang/fail on parameter binding
    // instead of testing anything (real bug caught during plan self-review).
    expect(testContent).toContain("Get-TaskList -name 'value'");
  });

  it('boolean parameters are always [switch], never marked Mandatory (structurally optional)', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'ps-gen-bool-'));
    await mkdir(path.join(dir, 'Public'), { recursive: true });
    await mkdir(path.join(dir, 'tests'), { recursive: true });

    const spec: CommandSpec = {
      pathSegments: ['Set-Flag'],
      parameters: [{ name: 'enabled', type: 'boolean', required: false }],
    };

    await powershellCommandGenerator.generateCommand(dir, spec);
    const content = await readFile(path.join(dir, 'Public', 'Set-Flag.ps1'), 'utf8');

    expect(content).toContain('[switch]$enabled');
    expect(content).not.toContain('[Parameter(Mandatory)]\n    [switch]$enabled');
  });
});

describe('powershellCommandGenerator.promptCommandIdentity', () => {
  it('is present on the generator (add-wizard.ts uses it instead of the generic prompt)', () => {
    expect(typeof powershellCommandGenerator.promptCommandIdentity).toBe('function');
  });
});
