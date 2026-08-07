import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { CommandSpec } from '../command-generator';
import { pythonCommandGenerator } from './python';

describe('pythonCommandGenerator.generateCommand', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(path.join(tmpdir(), 'clispark-python-generator-test-'));
    await mkdir(path.join(tmpRoot, 'cli', 'commands'), { recursive: true });
    await writeFile(path.join(tmpRoot, 'cli', 'commands', '__init__.py'), '');
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it('generates a top-level command file and test file', async () => {
    const spec: CommandSpec = {
      pathSegments: ['greet'],
      parameters: [{ name: 'name', type: 'string', required: true }],
    };

    const result = await pythonCommandGenerator.generateCommand(tmpRoot, spec);

    expect(result.commandFile).toBe(path.join('cli', 'commands', 'greet.py'));
    expect(result.testFile).toBe(path.join('tests', 'test_greet.py'));

    const content = await readFile(path.join(tmpRoot, result.commandFile), 'utf8');
    expect(content).toContain('class GreetCommand(BaseCommand):');
    expect(content).toContain('def greet(name: str)');
  });

  it('creates intermediate __init__.py files for nested commands', async () => {
    const spec: CommandSpec = {
      pathSegments: ['task', 'create'],
      parameters: [{ name: 'title', type: 'string', required: true }],
    };

    const result = await pythonCommandGenerator.generateCommand(tmpRoot, spec);

    expect(result.commandFile).toBe(path.join('cli', 'commands', 'task', 'create.py'));
    const initExists = await readFile(path.join(tmpRoot, 'cli', 'commands', 'task', '__init__.py'), 'utf8');
    expect(initExists).toBe('');
  });

  it('orders required parameters before optional ones (Python syntax requires it)', async () => {
    const spec: CommandSpec = {
      pathSegments: ['build'],
      parameters: [
        { name: 'verbose', type: 'boolean', required: false },
        { name: 'target', type: 'string', required: true },
      ],
    };

    const result = await pythonCommandGenerator.generateCommand(tmpRoot, spec);
    const content = await readFile(path.join(tmpRoot, result.commandFile), 'utf8');
    const defLine = content.split('\n').find((l) => l.trim().startsWith('def build('))!;
    expect(defLine.indexOf('target')).toBeLessThan(defLine.indexOf('verbose'));
  });
});

describe('pythonCommandGenerator.listExistingCommands', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(path.join(tmpdir(), 'clispark-python-generator-test-'));
    await mkdir(path.join(tmpRoot, 'cli', 'commands', 'task'), { recursive: true });
    await writeFile(path.join(tmpRoot, 'cli', 'commands', 'hello.py'), '');
    await writeFile(path.join(tmpRoot, 'cli', 'commands', '__init__.py'), '');
    await writeFile(path.join(tmpRoot, 'cli', 'commands', 'task', 'create.py'), '');
    await writeFile(path.join(tmpRoot, 'cli', 'commands', 'task', '__init__.py'), '');
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it('lists top-level and nested commands, excluding __init__.py', async () => {
    const tree = await pythonCommandGenerator.listExistingCommands(tmpRoot);
    const paths = tree.flatMap(function collect(node): string[] {
      return [node.path, ...node.children.flatMap(collect)];
    });
    expect(paths).toContain('hello');
    expect(paths).toContain('task create');
    expect(paths).not.toContain('task __init__');
  });
});
