// src/languages/command-generators/python.ts
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
    } else if (entry.name.endsWith('.py') && entry.name !== '__init__.py') {
      files.push(path.relative(baseDir, fullPath));
    }
  }
  return files;
}

function toCommandPath(relativeFilePath: string): string {
  return relativeFilePath.replace(/\.py$/, '').split(path.sep).join(' ');
}

async function listExistingCommands(targetDir: string): Promise<ExistingCommandNode[]> {
  const commandsDir = path.join(targetDir, 'cli', 'commands');
  const files = await collectCommandFiles(commandsDir);
  return buildCommandTree(files.map(toCommandPath));
}

function toClassName(pathSegments: string[]): string {
  return pathSegments.map((seg) => seg[0].toUpperCase() + seg.slice(1)).join('') + 'Command';
}

function pythonType(param: ParameterSpec): string {
  if (param.type === 'integer') return 'int';
  if (param.type === 'boolean') return 'bool';
  return 'str';
}

function defaultLiteral(param: ParameterSpec): string {
  if (param.type === 'boolean') return 'False';
  if (param.type === 'integer') return '0';
  if (param.type === 'enum') return `"${(param.allowedValues ?? [''])[0]}"`;
  return "''";
}

// Bare parameters, no explicit typer.Argument()/typer.Option() wrapper: Typer infers a
// positional argument for a no-default parameter and a --flag option for a defaulted one.
// Python's own syntax already forbids a no-default parameter after a defaulted one, which
// happens to be exactly the ordering CLI frameworks like oclif/System.CommandLine enforce at
// runtime -- see the spec's "required-nach-optional" section.
function parameterDeclaration(param: ParameterSpec): string {
  const pyType = pythonType(param);
  return param.required ? `${param.name}: ${pyType}` : `${param.name}: ${pyType} = ${defaultLiteral(param)}`;
}

function generateCommandFileContent(spec: CommandSpec): string {
  const className = toClassName(spec.pathSegments);
  const commandName = spec.pathSegments[spec.pathSegments.length - 1];
  const orderedParams = [...spec.parameters.filter((p) => p.required), ...spec.parameters.filter((p) => !p.required)];
  const paramList = orderedParams.map(parameterDeclaration).join(', ');
  const kwargList = orderedParams.map((p) => `${p.name}=${p.name}`).join(', ');
  const runParamList = orderedParams.map((p) => `${p.name}: ${pythonType(p)}`).join(', ');

  return `import typer

from cli.base_command import BaseCommand

app = typer.Typer()


class ${className}(BaseCommand):
    command_name = "${spec.pathSegments.join(' ')}"

    def run(self, ${runParamList}) -> None:
        typer.echo("${spec.pathSegments.join(' ')} ran")


@app.callback(invoke_without_command=True)
def ${commandName}(${paramList}) -> None:
    ${className}()(${kwargList})
`;
}

function sampleArgValue(param: ParameterSpec): string {
  if (param.type === 'enum') return param.allowedValues?.[0] ?? '';
  if (param.type === 'integer') return '1';
  if (param.type === 'boolean') return 'True';
  return 'value';
}

function generateTestFileContent(spec: CommandSpec): string {
  const requiredArgs = spec.parameters.filter((p) => p.required).map((p) => `"${sampleArgValue(p)}"`);
  const invocationArgs = [...spec.pathSegments.map((s) => `"${s}"`), ...requiredArgs].join(', ');

  return `from typer.testing import CliRunner

from cli.cli import app

runner = CliRunner()


def test_${spec.pathSegments.join('_')}_runs_successfully():
    result = runner.invoke(app, [${invocationArgs}])
    assert result.exit_code == 0
`;
}

async function generateCommand(targetDir: string, spec: CommandSpec): Promise<GeneratedFiles> {
  const relDir = path.join('cli', 'commands', ...spec.pathSegments.slice(0, -1));
  const fileName = spec.pathSegments[spec.pathSegments.length - 1];
  const commandRelPath = path.join(relDir, `${fileName}.py`);
  const testRelPath = path.join('tests', `test_${spec.pathSegments.join('_')}.py`);

  await mkdir(path.join(targetDir, relDir), { recursive: true });
  // Every intermediate command-group folder needs its own __init__.py so discover.py's
  // filesystem walk recognizes it as a mountable Typer sub-app group.
  for (let i = 1; i <= spec.pathSegments.length - 1; i++) {
    const groupDir = path.join(targetDir, 'cli', 'commands', ...spec.pathSegments.slice(0, i));
    await writeFile(path.join(groupDir, '__init__.py'), '');
  }
  await mkdir(path.join(targetDir, 'tests'), { recursive: true });
  await writeFile(path.join(targetDir, commandRelPath), generateCommandFileContent(spec));
  await writeFile(path.join(targetDir, testRelPath), generateTestFileContent(spec));

  return { commandFile: commandRelPath, testFile: testRelPath };
}

export const pythonCommandGenerator: CommandGenerator = {
  listExistingCommands,
  generateCommand,
};
