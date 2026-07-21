// src/languages/command-generators/dotnet.ts
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  CommandGenerator,
  CommandSpec,
  ExistingCommandNode,
  GeneratedFiles,
  ParameterSpec,
} from '../command-generator';
import { buildCommandTree } from '../command-generator';

async function listExistingCommands(targetDir: string): Promise<ExistingCommandNode[]> {
  const commandsDir = path.join(targetDir, 'src', 'Commands');
  const files = await readdir(commandsDir);
  const paths: string[] = [];
  for (const file of files) {
    if (!file.endsWith('.cs')) continue;
    const content = await readFile(path.join(commandsDir, file), 'utf8');
    const match = content.match(/\[CommandPath\("([^"]+)"\)\]/);
    if (match) paths.push(match[1]);
  }
  return buildCommandTree(paths);
}

function toClassName(pathSegments: string[]): string {
  return pathSegments.map((seg) => seg[0].toUpperCase() + seg.slice(1)).join('') + 'Command';
}

function csharpDeclType(param: ParameterSpec): string {
  const baseType = param.type === 'integer' ? 'int' : param.type === 'boolean' ? 'bool' : 'string';
  if (param.required) return baseType;
  return `${baseType}?`;
}

function argumentDeclaration(param: ParameterSpec): string {
  const varName = `${param.name}Argument`;
  const declType = csharpDeclType(param);
  const arityLine = param.required ? '' : '\n            Arity = ArgumentArity.ZeroOrOne,';
  const lines = [
    `        var ${varName} = new Argument<${declType}>("${param.name}")`,
    `        {`,
    `            Description = "${param.name}",${arityLine}`,
    `        };`,
  ];
  if (param.type === 'enum') {
    lines.push(`        ${varName}.AcceptOnlyFromAmong(${(param.allowedValues ?? []).map((v) => `"${v}"`).join(', ')});`);
  }
  return lines.join('\n');
}

function generateCommandFileContent(spec: CommandSpec): string {
  const className = toClassName(spec.pathSegments);
  const commandPath = spec.pathSegments.join(' ');
  const lastSegment = spec.pathSegments[spec.pathSegments.length - 1];

  const argDecls = spec.parameters.map(argumentDeclaration).join('\n\n');
  const addLines = spec.parameters.map((p) => `        command.Arguments.Add(${p.name}Argument);`).join('\n');
  const getValueLines = spec.parameters
    .map((p) => `            var ${p.name} = parseResult.GetValue(${p.name}Argument);`)
    .join('\n');
  const interpolated = spec.parameters.map((p) => `${p.name}={${p.name}}`).join(' ');

  return `using System.CommandLine;

namespace Cli.Commands;

[CommandPath("${commandPath}")]
public sealed class ${className} : ICliCommand
{
    public Command Build()
    {
${argDecls}

        var command = new Command("${lastSegment}", "${lastSegment} command");
${addLines}
        command.SetAction(parseResult =>
        {
${getValueLines}
            Console.WriteLine($"${interpolated}");
        });

        return command;
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
  const className = toClassName(spec.pathSegments);
  const sampleArgs = spec.parameters.map(sampleArgValue);

  return `using System.CommandLine;
using Cli.Commands;

namespace Cli.Tests;

public class ${className}Tests
{
    [Fact]
    public void RunsSuccessfully()
    {
        var command = new ${className}().Build();
        var parseResult = command.Parse([${sampleArgs.map((a) => `"${a}"`).join(', ')}]);

        var exitCode = parseResult.Invoke();

        Assert.Equal(0, exitCode);
    }
}
`;
}

async function generateCommand(targetDir: string, spec: CommandSpec): Promise<GeneratedFiles> {
  const className = toClassName(spec.pathSegments);
  const commandRelPath = path.join('src', 'Commands', `${className}.cs`);
  const testRelPath = path.join('tests', `${className}Tests.cs`);

  await mkdir(path.join(targetDir, 'src', 'Commands'), { recursive: true });
  await mkdir(path.join(targetDir, 'tests'), { recursive: true });
  await writeFile(path.join(targetDir, commandRelPath), generateCommandFileContent(spec));
  await writeFile(path.join(targetDir, testRelPath), generateTestFileContent(spec));

  return { commandFile: commandRelPath, testFile: testRelPath };
}

export const dotnetCommandGenerator: CommandGenerator = {
  listExistingCommands,
  generateCommand,
};
