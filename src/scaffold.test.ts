// src/scaffold.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { copyTemplate, scaffoldProject } from './scaffold.js';
import { DEFAULT_REGISTRY_URL } from './registry.js';

describe('copyTemplate', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(path.join(tmpdir(), 'clispark-test-'));
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it('copies all template files into a new target directory, replacing {{projectName}}', async () => {
    const targetDir = path.join(tmpRoot, 'my-cli');

    await copyTemplate({ projectName: 'my-cli', targetDir });

    const pkg = JSON.parse(await readFile(path.join(targetDir, 'package.json'), 'utf8'));
    expect(pkg.name).toBe('my-cli');
    expect(pkg.bin).toEqual({ 'my-cli': './bin/run.js' });
    expect(pkg.oclif.bin).toBe('my-cli');
    expect(pkg.oclif.dirname).toBe('my-cli');

    const readme = await readFile(path.join(targetDir, 'README.md'), 'utf8');
    expect(readme).toContain('# my-cli');

    const gitignore = await readFile(path.join(targetDir, '.gitignore'), 'utf8');
    expect(gitignore).toContain('node_modules');

    const runJs = await readFile(path.join(targetDir, 'bin', 'run.js'), 'utf8');
    expect(runJs).toContain('execute');

    const indexTs = await readFile(path.join(targetDir, 'src', 'index.ts'), 'utf8');
    expect(indexTs).toContain("export { run } from '@oclif/core';");

    const loggerTs = await readFile(path.join(targetDir, 'src', 'logger.ts'), 'utf8');
    expect(loggerTs).toContain("envPaths('my-cli'");
    expect(loggerTs).not.toContain('{{projectName}}');

    const baseCommandTs = await readFile(path.join(targetDir, 'src', 'base-command.ts'), 'utf8');
    expect(baseCommandTs).toContain('export abstract class BaseCommand extends Command');

    const helloTs = await readFile(path.join(targetDir, 'src', 'commands', 'hello.ts'), 'utf8');
    expect(helloTs).toContain('export default class Hello extends BaseCommand');

    const helloTestTs = await readFile(path.join(targetDir, 'src', 'commands', 'hello.test.ts'), 'utf8');
    expect(helloTestTs).toContain("runCommand('hello')");

    const architectureMd = await readFile(path.join(targetDir, 'ARCHITECTURE.md'), 'utf8');
    expect(architectureMd).toContain('# my-cli Architecture');
    expect(architectureMd).not.toContain('{{projectName}}');
  });

  it('writes a .npmrc with the custom registry when registryUrl differs from the default', async () => {
    const targetDir = path.join(tmpRoot, 'custom-registry');

    await copyTemplate({
      projectName: 'custom-registry',
      targetDir,
      registryUrl: 'https://registry.example.com',
    });

    const npmrc = await readFile(path.join(targetDir, '.npmrc'), 'utf8');
    expect(npmrc).toBe('registry=https://registry.example.com\n');
  });

  it('does not write a .npmrc when registryUrl is omitted or equal to the default', async () => {
    const targetDirNoUrl = path.join(tmpRoot, 'no-registry-url');
    await copyTemplate({ projectName: 'no-registry-url', targetDir: targetDirNoUrl });
    await expect(readFile(path.join(targetDirNoUrl, '.npmrc'), 'utf8')).rejects.toThrow();

    const targetDirDefaultUrl = path.join(tmpRoot, 'default-registry-url');
    await copyTemplate({
      projectName: 'default-registry-url',
      targetDir: targetDirDefaultUrl,
      registryUrl: DEFAULT_REGISTRY_URL,
    });
    await expect(readFile(path.join(targetDirDefaultUrl, '.npmrc'), 'utf8')).rejects.toThrow();
  });

  it('creates the target directory when it does not exist yet', async () => {
    const targetDir = path.join(tmpRoot, 'new-project');

    await copyTemplate({ projectName: 'new-project', targetDir });

    const pkg = JSON.parse(await readFile(path.join(targetDir, 'package.json'), 'utf8'));
    expect(pkg.name).toBe('new-project');
  });

  it('succeeds when the target directory exists but is empty', async () => {
    const targetDir = path.join(tmpRoot, 'empty-dir');
    await mkdir(targetDir);

    await copyTemplate({ projectName: 'empty-dir', targetDir });

    const pkg = JSON.parse(await readFile(path.join(targetDir, 'package.json'), 'utf8'));
    expect(pkg.name).toBe('empty-dir');
  });

  it('throws a clear error when the target directory already exists and is not empty', async () => {
    const targetDir = path.join(tmpRoot, 'occupied');
    await mkdir(targetDir);
    await writeFile(path.join(targetDir, 'existing-file.txt'), 'hello');

    await expect(copyTemplate({ projectName: 'occupied', targetDir })).rejects.toThrow(
      /already exists and is not empty/,
    );
  });
});

describe('scaffoldProject', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(path.join(tmpdir(), 'clispark-test-'));
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it('copies the template, then runs git init/add/commit and npm install/build in order', async () => {
    const targetDir = path.join(tmpRoot, 'my-cli');
    const calls: Array<{ command: string; args: string[]; cwd: string }> = [];
    const runCommand = vi.fn(async (command: string, args: string[], cwd: string) => {
      calls.push({ command, args, cwd });
    });

    await scaffoldProject({ projectName: 'my-cli', targetDir }, { runCommand });

    expect(calls.map((c) => `${c.command} ${c.args.join(' ')}`)).toEqual([
      'git init',
      'git add -A',
      'git commit -m chore: initial scaffold from clispark',
      'npm install',
      'npm run build',
    ]);
    expect(calls.every((c) => c.cwd === targetDir)).toBe(true);

    // template files were actually copied before any command ran
    const pkg = JSON.parse(await readFile(path.join(targetDir, 'package.json'), 'utf8'));
    expect(pkg.name).toBe('my-cli');
  });

  it('propagates an error from a failing command without swallowing it', async () => {
    const targetDir = path.join(tmpRoot, 'fails');
    const runCommand = vi.fn(async (command: string) => {
      if (command === 'npm') throw new Error('npm install failed');
    });

    await expect(scaffoldProject({ projectName: 'fails', targetDir }, { runCommand })).rejects.toThrow(
      'npm install failed',
    );
  });
});
