import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { scaffoldProject } from '../scaffold.js';
import { formatUpdateSummary, updateProject } from './update.js';
import { CORE_FILE_PATHS, getGeneratorVersion, readManifest, type Manifest } from './manifest.js';

async function scaffoldFixture(tmpRoot: string, name: string): Promise<string> {
  const targetDir = path.join(tmpRoot, name);
  await scaffoldProject({ projectName: name, targetDir }, { runCommand: vi.fn(async () => {}) });
  return targetDir;
}

function cleanGitDeps() {
  return { runCommand: vi.fn(async () => {}), captureCommand: vi.fn(async () => '') };
}

describe('updateProject', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(path.join(tmpdir(), 'clispark-update-test-'));
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it('aborts with a clear error when the git working tree is dirty', async () => {
    const targetDir = await scaffoldFixture(tmpRoot, 'dirty-project');
    const deps = {
      runCommand: vi.fn(async () => {}),
      captureCommand: vi.fn(async () => ' M src/commands/hello.ts'),
    };

    await expect(updateProject(targetDir, deps)).rejects.toThrow(/working tree is not clean/i);
    expect(deps.runCommand).not.toHaveBeenCalled();
  });

  it('aborts with a clear error when no manifest exists', async () => {
    const targetDir = path.join(tmpRoot, 'no-manifest-project');
    await scaffoldProject({ projectName: 'no-manifest-project', targetDir }, { runCommand: vi.fn(async () => {}) });
    await rm(path.join(targetDir, '.clispark'), { recursive: true, force: true });

    await expect(updateProject(targetDir, cleanGitDeps())).rejects.toThrow(/no \.clispark\/manifest\.json found/i);
  });

  it('reports "up-to-date" and makes no changes when the manifest already matches the running version', async () => {
    const targetDir = await scaffoldFixture(tmpRoot, 'fresh-project');
    const deps = cleanGitDeps();

    const result = await updateProject(targetDir, deps);

    expect(result.status).toBe('up-to-date');
    expect(deps.runCommand).not.toHaveBeenCalled();
  });

  it('reports "up-to-date" and makes no changes when the manifest version is newer than the running version', async () => {
    const targetDir = await scaffoldFixture(tmpRoot, 'ahead-project');

    const manifestPath = path.join(targetDir, '.clispark', 'manifest.json');
    const oldManifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Manifest;
    oldManifest.generatorVersion = '99.0.0';
    await writeFile(manifestPath, JSON.stringify(oldManifest, null, 2) + '\n');

    const deps = cleanGitDeps();
    const result = await updateProject(targetDir, deps);

    expect(result.status).toBe('up-to-date');
    expect(result.fromVersion).toBe('99.0.0');
    expect(result.toVersion).toBe(getGeneratorVersion());
    expect(result.files).toEqual([]);
    expect(deps.runCommand).not.toHaveBeenCalled();

    const manifestAfter = JSON.parse(await readFile(manifestPath, 'utf8')) as Manifest;
    expect(manifestAfter.generatorVersion).toBe('99.0.0');
  });

  it('replaces unmodified core files, skips a locally-modified one, and commits the result', async () => {
    const targetDir = await scaffoldFixture(tmpRoot, 'stale-project');

    const manifestPath = path.join(targetDir, '.clispark', 'manifest.json');
    const oldManifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Manifest;
    oldManifest.generatorVersion = '0.0.1';
    await writeFile(manifestPath, JSON.stringify(oldManifest, null, 2) + '\n');

    const tsconfigPath = path.join(targetDir, 'tsconfig.json');
    const originalTsconfig = await readFile(tsconfigPath, 'utf8');
    await writeFile(tsconfigPath, originalTsconfig.replace('"strict": true', '"strict": false'));

    const deps = cleanGitDeps();
    const result = await updateProject(targetDir, deps);

    expect(result.status).toBe('updated');
    expect(result.fromVersion).toBe('0.0.1');
    expect(result.toVersion).toBe(getGeneratorVersion());

    expect(result.files.find((f) => f.path === 'tsconfig.json')?.outcome).toBe('skipped');
    expect(result.files.find((f) => f.path === 'src/base-command.ts')?.outcome).toBe('replaced');

    const tsconfigAfter = await readFile(tsconfigPath, 'utf8');
    expect(tsconfigAfter).toContain('"strict": false');

    const newManifest = await readManifest(targetDir);
    expect(newManifest?.generatorVersion).toBe(getGeneratorVersion());
    expect(newManifest?.coreFiles['tsconfig.json']).toBe(oldManifest.coreFiles['tsconfig.json']);

    expect(deps.runCommand).toHaveBeenCalledWith('git', ['add', '-A'], targetDir);
    expect(deps.runCommand).toHaveBeenCalledWith(
      'git',
      ['commit', '-m', `chore: update clispark core to v${getGeneratorVersion()}`],
      targetDir,
    );
  });

  it('reports "no-changes" and commits nothing when every core file was modified locally', async () => {
    const targetDir = await scaffoldFixture(tmpRoot, 'fully-diverged-project');

    const manifestPath = path.join(targetDir, '.clispark', 'manifest.json');
    const oldManifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Manifest;
    oldManifest.generatorVersion = '0.0.1';
    await writeFile(manifestPath, JSON.stringify(oldManifest, null, 2) + '\n');

    for (const relativePath of CORE_FILE_PATHS) {
      const filePath = path.join(targetDir, relativePath);
      await writeFile(filePath, (await readFile(filePath, 'utf8')) + '\n// locally modified\n');
    }

    const deps = cleanGitDeps();
    const result = await updateProject(targetDir, deps);

    expect(result.status).toBe('no-changes');
    expect(result.files.every((f) => f.outcome === 'skipped')).toBe(true);
    expect(deps.runCommand).not.toHaveBeenCalled();

    const manifestAfter = JSON.parse(await readFile(manifestPath, 'utf8')) as Manifest;
    expect(manifestAfter.generatorVersion).toBe('0.0.1');
  });

  it('converges the manifest when the only change is a stale no-longer-core entry, even if every real core file is locally modified', async () => {
    const targetDir = await scaffoldFixture(tmpRoot, 'stale-core-entry-project');

    const manifestPath = path.join(targetDir, '.clispark', 'manifest.json');
    const oldManifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Manifest;
    oldManifest.generatorVersion = '0.0.1';
    oldManifest.coreFiles['src/some-removed-file.ts'] = 'deadbeef';
    await writeFile(manifestPath, JSON.stringify(oldManifest, null, 2) + '\n');
    // The stale entry must still exist on disk locally — the no-longer-core loop only
    // reports paths it can actually find under targetDir.
    await writeFile(path.join(targetDir, 'src', 'some-removed-file.ts'), '// leftover from an older core version\n');

    for (const relativePath of CORE_FILE_PATHS) {
      const filePath = path.join(targetDir, relativePath);
      await writeFile(filePath, (await readFile(filePath, 'utf8')) + '\n// locally modified\n');
    }

    const deps = cleanGitDeps();
    const result = await updateProject(targetDir, deps);

    expect(result.status).toBe('updated');
    expect(
      result.files
        .filter((f) => (CORE_FILE_PATHS as readonly string[]).includes(f.path))
        .every((f) => f.outcome === 'skipped'),
    ).toBe(true);
    expect(result.files.find((f) => f.path === 'src/some-removed-file.ts')?.outcome).toBe('no-longer-core');

    expect(deps.runCommand).toHaveBeenCalledWith('git', ['add', '-A'], targetDir);
    expect(deps.runCommand).toHaveBeenCalledWith(
      'git',
      ['commit', '-m', `chore: update clispark core to v${getGeneratorVersion()}`],
      targetDir,
    );

    const newManifest = await readManifest(targetDir);
    expect(newManifest?.generatorVersion).toBe(getGeneratorVersion());
    expect(newManifest?.coreFiles['src/some-removed-file.ts']).toBeUndefined();
  });
});

describe('formatUpdateSummary', () => {
  it('formats an up-to-date result', () => {
    const summary = formatUpdateSummary({
      status: 'up-to-date',
      fromVersion: '1.0.0',
      toVersion: '1.0.0',
      files: [],
      dependencies: [],
      scripts: [],
      fields: [],
    });
    expect(summary).toContain('Already up to date');
  });

  it('formats an updated result with added/replaced/skipped files', () => {
    const summary = formatUpdateSummary({
      status: 'updated',
      fromVersion: '1.0.0',
      toVersion: '1.1.0',
      files: [
        { path: 'src/new-core-file.ts', outcome: 'added' },
        { path: 'src/base-command.ts', outcome: 'replaced' },
        { path: 'tsconfig.json', outcome: 'skipped' },
      ],
      dependencies: [],
      scripts: [],
      fields: [],
    });
    expect(summary).toContain('src/new-core-file.ts');
    expect(summary).toContain('src/base-command.ts');
    expect(summary).toContain('tsconfig.json');
    expect(summary).toContain('releasenotes');
  });
});
