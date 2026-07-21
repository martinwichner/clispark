// src/languages/command-generators/node-oclif.ts
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  CommandGenerator,
  CommandSpec,
  ExistingCommandNode,
  GeneratedFiles,
  ParameterSpec,
} from '../command-generator';
import { buildCommandTree } from '../command-generator';

async function collectCommandFiles(dir: string, baseDir: string = dir): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectCommandFiles(fullPath, baseDir)));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      files.push(path.relative(baseDir, fullPath));
    }
  }
  return files;
}

function toCommandPath(relativeFilePath: string): string {
  return relativeFilePath.replace(/\.ts$/, '').split(path.sep).join(' ');
}

async function listExistingCommands(targetDir: string): Promise<ExistingCommandNode[]> {
  const commandsDir = path.join(targetDir, 'src', 'commands');
  const files = await collectCommandFiles(commandsDir);
  return buildCommandTree(files.map(toCommandPath));
}

function toClassName(pathSegments: string[]): string {
  return pathSegments.map((seg) => seg[0].toUpperCase() + seg.slice(1)).join('');
}

function argFor(param: ParameterSpec): string {
  const opts = [`required: ${param.required}`, `description: '${param.name}'`];
  if (param.type === 'enum') {
    opts.push(`options: [${(param.allowedValues ?? []).map((v) => `'${v}'`).join(', ')}]`);
  }
  const argsMethod = param.type === 'enum' ? 'string' : param.type;
  return `Args.${argsMethod}({ ${opts.join(', ')} })`;
}

function generateCommandFileContent(spec: CommandSpec): string {
  const className = toClassName(spec.pathSegments);
  const argsLines = spec.parameters.map((p) => `    ${p.name}: ${argFor(p)},`).join('\n');
  const logExpr = spec.parameters.map((p) => `${p.name}=\${args.${p.name}}`).join(' ');
  const depth = spec.pathSegments.length;
  const baseCommandImportPath = '../'.repeat(depth) + 'base-command';

  return `import { Args } from '@oclif/core';
import { BaseCommand } from '${baseCommandImportPath}';

export default class ${className} extends BaseCommand {
  static description = '${spec.pathSegments[spec.pathSegments.length - 1]} command';
  static args = {
${argsLines}
  };
  static flags = {};

  async run(): Promise<void> {
    const { args } = await this.parse(${className});
    this.log(\`${logExpr}\`);
  }
}
`;
}

function sampleArgValue(param: ParameterSpec): string {
  if (param.type === 'enum') return param.allowedValues?.[0] ?? '';
  if (param.type === 'integer') return '1';
  if (param.type === 'boolean') return 'true';
  return 'value';
}

function generateTestFileContent(spec: CommandSpec): string {
  const commandInvocation = spec.pathSegments.join(' ');
  const sampleArgs = spec.parameters.map(sampleArgValue).join(' ');
  const fullInvocation = sampleArgs ? `${commandInvocation} ${sampleArgs}` : commandInvocation;

  return `import { describe, it, expect } from 'vitest';
import { runCommand } from '@oclif/test';

describe('${commandInvocation}', () => {
  it('runs successfully', async () => {
    const { error } = await runCommand('${fullInvocation}');
    expect(error).toBeUndefined();
  });
});
`;
}

async function generateCommand(targetDir: string, spec: CommandSpec): Promise<GeneratedFiles> {
  const relDir = path.join('src', 'commands', ...spec.pathSegments.slice(0, -1));
  const fileName = spec.pathSegments[spec.pathSegments.length - 1];
  const commandRelPath = path.join(relDir, `${fileName}.ts`);
  const testRelPath = path.join(relDir, `${fileName}.test.ts`);

  await mkdir(path.join(targetDir, relDir), { recursive: true });
  await writeFile(path.join(targetDir, commandRelPath), generateCommandFileContent(spec));
  await writeFile(path.join(targetDir, testRelPath), generateTestFileContent(spec));

  return { commandFile: commandRelPath, testFile: testRelPath };
}

export const nodeOclifCommandGenerator: CommandGenerator = {
  listExistingCommands,
  generateCommand,
};
