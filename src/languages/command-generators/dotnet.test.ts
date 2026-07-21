// src/languages/command-generators/dotnet.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { dotnetCommandGenerator } from './dotnet';
import type { CommandSpec } from '../command-generator';

describe('dotnetCommandGenerator.listExistingCommands', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(path.join(tmpdir(), 'clispark-dotnet-cmdgen-test-'));
    const commandsDir = path.join(tmpRoot, 'src', 'Commands');
    await mkdir(commandsDir, { recursive: true });
    await writeFile(
      path.join(commandsDir, 'HelloCommand.cs'),
      '[CommandPath("hello")]\npublic sealed class HelloCommand : ICliCommand {}',
    );
    await writeFile(
      path.join(commandsDir, 'TaskCommand.cs'),
      '[CommandPath("task")]\npublic sealed class TaskCommand : ICliCommand {}',
    );
    await writeFile(
      path.join(commandsDir, 'TaskListCommand.cs'),
      '[CommandPath("task list")]\npublic sealed class TaskListCommand : ICliCommand {}',
    );
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it('lists commands by extracting [CommandPath] attributes', async () => {
    const tree = await dotnetCommandGenerator.listExistingCommands(tmpRoot);
    const paths = flattenPaths(tree).sort();
    expect(paths).toEqual(['hello', 'task', 'task list']);
  });
});

function flattenPaths(nodes: { path: string; children: unknown[] }[]): string[] {
  return nodes.flatMap((n) => [n.path, ...flattenPaths(n.children as { path: string; children: unknown[] }[])]);
}

describe('dotnetCommandGenerator.generateCommand', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(path.join(tmpdir(), 'clispark-dotnet-cmdgen-test-'));
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

    const result = await dotnetCommandGenerator.generateCommand(tmpRoot, spec);

    expect(result).toEqual({
      commandFile: path.join('src', 'Commands', 'TaskExportCommand.cs'),
      testFile: path.join('tests', 'TaskExportCommandTests.cs'),
    });

    const content = await readFile(path.join(tmpRoot, result.commandFile), 'utf8');
    expect(content).toContain('[CommandPath("task export")]');
    expect(content).toContain('public sealed class TaskExportCommand : ICliCommand');
    expect(content).toContain('var formatArgument = new Argument<string>("format")');
    expect(content).toContain('var statusArgument = new Argument<string>("status")');
    expect(content).toContain('statusArgument.AcceptOnlyFromAmong("open", "done");');
    expect(content).toContain('var countArgument = new Argument<int?>("count")');
    expect(content).toContain('Arity = ArgumentArity.ZeroOrOne,');
    expect(content).toContain('var verboseArgument = new Argument<bool?>("verbose")');

    const testContent = await readFile(path.join(tmpRoot, result.testFile), 'utf8');
    expect(testContent).toContain('public class TaskExportCommandTests');
    expect(testContent).toContain('new TaskExportCommand().Build()');
  });

  it('generates a top-level command file', async () => {
    const spec: CommandSpec = { pathSegments: ['confirm'], parameters: [] };

    const result = await dotnetCommandGenerator.generateCommand(tmpRoot, spec);

    const content = await readFile(path.join(tmpRoot, result.commandFile), 'utf8');
    expect(content).toContain('[CommandPath("confirm")]');
    expect(content).toContain('public sealed class ConfirmCommand : ICliCommand');
  });

  it('generates a required parameter without Arity', async () => {
    const spec: CommandSpec = {
      pathSegments: ['greet'],
      parameters: [{ name: 'name', type: 'string', required: true }],
    };

    const result = await dotnetCommandGenerator.generateCommand(tmpRoot, spec);

    const content = await readFile(path.join(tmpRoot, result.commandFile), 'utf8');
    expect(content).toContain('var nameArgument = new Argument<string>("name")');
    expect(content).not.toContain('Arity = ArgumentArity.ZeroOrOne,\n        };\n\n        var command');
  });

  it('creates the src/Commands directory if missing', async () => {
    const spec: CommandSpec = { pathSegments: ['deploy'], parameters: [] };

    const result = await dotnetCommandGenerator.generateCommand(tmpRoot, spec);

    await expect(readFile(path.join(tmpRoot, result.commandFile), 'utf8')).resolves.toContain('DeployCommand');
  });
});
