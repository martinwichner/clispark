// src/languages/command-generators/node-oclif.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { nodeOclifCommandGenerator } from './node-oclif';
import type { CommandSpec } from '../command-generator';

describe('nodeOclifCommandGenerator.listExistingCommands', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(path.join(tmpdir(), 'clispark-node-cmdgen-test-'));
    const commandsDir = path.join(tmpRoot, 'src', 'commands');
    await mkdir(path.join(commandsDir, 'task'), { recursive: true });
    await writeFile(path.join(commandsDir, 'hello.ts'), '// hello');
    await writeFile(path.join(commandsDir, 'task.ts'), '// task');
    await writeFile(path.join(commandsDir, 'task', 'list.ts'), '// task list');
    await writeFile(path.join(commandsDir, 'task', 'list.test.ts'), '// should be excluded');
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it('lists commands from the folder structure, excluding test files', async () => {
    const tree = await nodeOclifCommandGenerator.listExistingCommands(tmpRoot);
    const paths = flattenPaths(tree).sort();
    expect(paths).toEqual(['hello', 'task', 'task list']);
  });
});

function flattenPaths(nodes: { path: string; children: unknown[] }[]): string[] {
  return nodes.flatMap((n) => [n.path, ...flattenPaths(n.children as { path: string; children: unknown[] }[])]);
}

describe('nodeOclifCommandGenerator.generateCommand', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(path.join(tmpdir(), 'clispark-node-cmdgen-test-'));
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it('generates a nested command file with all four parameter types', async () => {
    const spec: CommandSpec = {
      pathSegments: ['task', 'export'],
      parameters: [
        { name: 'format', type: 'string', required: true },
        { name: 'status', type: 'enum', required: true, allowedValues: ['open', 'done'] },
        { name: 'count', type: 'integer', required: false },
        { name: 'verbose', type: 'boolean', required: false },
      ],
    };

    const result = await nodeOclifCommandGenerator.generateCommand(tmpRoot, spec);

    expect(result).toEqual({
      commandFile: path.join('src', 'commands', 'task', 'export.ts'),
      testFile: path.join('src', 'commands', 'task', 'export.test.ts'),
    });

    const content = await readFile(path.join(tmpRoot, result.commandFile), 'utf8');
    expect(content).toContain('export default class TaskExport extends BaseCommand');
    expect(content).toContain("import { BaseCommand } from '../../base-command';");
    expect(content).toContain("format: Args.string({ required: true, description: 'format' })");
    expect(content).toContain(
      "status: Args.string({ required: true, description: 'status', options: ['open', 'done'] })",
    );
    expect(content).toContain("count: Args.integer({ required: false, description: 'count' })");
    expect(content).toContain("verbose: Args.boolean({ required: false, description: 'verbose' })");

    const testContent = await readFile(path.join(tmpRoot, result.testFile), 'utf8');
    expect(testContent).toContain("runCommand('task export value open 1 true')");
  });

  it('generates a top-level command with the correct base-command import depth', async () => {
    const spec: CommandSpec = {
      pathSegments: ['confirm'],
      parameters: [],
    };

    const result = await nodeOclifCommandGenerator.generateCommand(tmpRoot, spec);

    const content = await readFile(path.join(tmpRoot, result.commandFile), 'utf8');
    expect(content).toContain("import { BaseCommand } from '../base-command';");
    expect(content).toContain('export default class Confirm extends BaseCommand');
  });

  it('creates missing intermediate directories', async () => {
    const spec: CommandSpec = { pathSegments: ['deploy', 'run'], parameters: [] };

    const result = await nodeOclifCommandGenerator.generateCommand(tmpRoot, spec);

    await expect(readFile(path.join(tmpRoot, result.commandFile), 'utf8')).resolves.toContain('DeployRun');
  });
});
