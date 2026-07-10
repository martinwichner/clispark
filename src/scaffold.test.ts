import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { copyTemplate } from './scaffold.js';

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
