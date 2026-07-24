// src/languages/command-generators/powershell.ts
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { select, text, isCancel, cancel } from '@clack/prompts';
import type { CommandGenerator, CommandSpec, ExistingCommandNode, GeneratedFiles, ParameterSpec } from '../command-generator';
import { buildCommandTree } from '../command-generator';

/** A representative subset of PowerShell's approved verbs (see `Get-Verb`) — common categories,
 *  not an exhaustive/canonical copy (Microsoft occasionally adds more; the dropdown works the
 *  same either way). */
export const APPROVED_VERBS = [
  'Get',
  'Set',
  'New',
  'Remove',
  'Add',
  'Clear',
  'Invoke',
  'Start',
  'Stop',
  'Test',
  'Update',
  'Export',
  'Import',
] as const;

function exitIfCancelled(value: unknown): void {
  if (isCancel(value)) {
    cancel('Operation cancelled.');
    process.exit(1);
  }
}

async function listExistingCommands(targetDir: string): Promise<ExistingCommandNode[]> {
  const publicDir = path.join(targetDir, 'Public');
  const files = await readdir(publicDir);
  const paths = files.filter((f) => f.endsWith('.ps1')).map((f) => f.replace(/\.ps1$/, ''));
  return buildCommandTree(paths);
}

function powershellParamType(param: ParameterSpec): string {
  if (param.type === 'integer') return '[int]';
  if (param.type === 'boolean') return '[switch]';
  return '[string]';
}

function parameterDeclaration(param: ParameterSpec): string {
  const lines: string[] = [];
  if (param.type === 'enum') {
    lines.push(`    [ValidateSet(${(param.allowedValues ?? []).map((v) => `'${v}'`).join(', ')})]`);
  }
  // Booleans use [switch], which is structurally always-optional — never marked Mandatory,
  // matching the clispark-add-established invariant that boolean parameters must be optional.
  if (param.required && param.type !== 'boolean') {
    lines.push('    [Parameter(Mandatory)]');
  }
  lines.push(`    ${powershellParamType(param)}$${param.name}`);
  return lines.join('\n');
}

function generateCommandFileContent(spec: CommandSpec): string {
  const funcName = spec.pathSegments[spec.pathSegments.length - 1];
  const paramLines = spec.parameters.map(parameterDeclaration).join(',\n\n');
  const paramBlock = spec.parameters.length > 0 ? `\n${paramLines}\n` : '';
  // Echoes back received parameters rather than a bare "TODO" comment — same convention as
  // the Node generator (`this.log(...)` with the arg values), giving the scaffolded stub real,
  // runnable content the user replaces, and something for the generated Pester test to assert on.
  const echoLines =
    spec.parameters.length > 0
      ? spec.parameters.map((p) => `        Write-Output "${p.name}=$${p.name}"`).join('\n')
      : `        Write-Output '${funcName} ran'`;

  return `function ${funcName} {
    [CmdletBinding()]
    param(${paramBlock})
    process {
${echoLines}
    }
}
`;
}

/** Same purpose as the Node generator's `sampleArgValue()` — a required (Mandatory) parameter
 *  left unfilled would make the generated smoke test hang/fail on parameter binding, not just
 *  produce a wrong result. Only Mandatory parameters need a sample value here; optional ones
 *  (including all [switch] booleans, which are never Mandatory) can be safely omitted. */
function sampleParamValue(param: ParameterSpec): string {
  if (param.type === 'enum') return param.allowedValues?.[0] ?? '';
  if (param.type === 'integer') return '1';
  return 'value';
}

function generateTestFileContent(spec: CommandSpec): string {
  const funcName = spec.pathSegments[spec.pathSegments.length - 1];
  const mandatoryArgs = spec.parameters
    .filter((p) => p.required && p.type !== 'boolean')
    .map((p) => `-${p.name} '${sampleParamValue(p)}'`)
    .join(' ');
  const invocation = mandatoryArgs ? `${funcName} ${mandatoryArgs}` : funcName;

  return `Describe '${funcName}' {
    It 'runs without error' {
        { ${invocation} } | Should -Not -Throw
    }
}
`;
}

async function generateCommand(targetDir: string, spec: CommandSpec): Promise<GeneratedFiles> {
  const funcName = spec.pathSegments[spec.pathSegments.length - 1];
  const commandRelPath = path.join('Public', `${funcName}.ps1`);
  const testRelPath = path.join('tests', `${funcName}.Tests.ps1`);

  await mkdir(path.join(targetDir, 'Public'), { recursive: true });
  await mkdir(path.join(targetDir, 'tests'), { recursive: true });
  await writeFile(path.join(targetDir, commandRelPath), generateCommandFileContent(spec));
  await writeFile(path.join(targetDir, testRelPath), generateTestFileContent(spec));

  return { commandFile: commandRelPath.replace(/\\/g, '/'), testFile: testRelPath.replace(/\\/g, '/') };
}

async function promptCommandIdentity(_pathSegments: string[], existingPaths: Set<string>): Promise<string[]> {
  const verbValue = await select({
    message: 'Verb (from PowerShell’s approved-verb list)',
    options: APPROVED_VERBS.map((v) => ({ value: v, label: v })),
  });
  exitIfCancelled(verbValue);

  const nounValue = await text({
    message: 'Noun',
    validate: (value) => {
      if (!/^[A-Z][A-Za-z0-9]*$/.test(value)) return 'Use PascalCase, starting with an uppercase letter (e.g. TaskList).';
      const fullName = `${verbValue as string}-${value}`;
      if (existingPaths.has(fullName)) return `"${fullName}" already exists.`;
      return undefined;
    },
  });
  exitIfCancelled(nounValue);

  return [`${verbValue as string}-${nounValue as string}`];
}

export const powershellCommandGenerator: CommandGenerator = {
  listExistingCommands,
  generateCommand,
  promptCommandIdentity,
};
