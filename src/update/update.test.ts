import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { scaffoldProject } from '../scaffold';
import { formatUpdateSummary, updateProject } from './update';
import { getGeneratorVersion, hashContent, readManifest, type Manifest } from './manifest';
import { CORE_FILE_PATHS } from './adapters/node-oclif';
import { nodeOclifPack } from '../languages/packs/node-oclif';
import { UserError } from '../errors';
import type { UpdateAdapter } from './adapter';

async function scaffoldFixture(tmpRoot: string, name: string, options: { lintEnabled?: boolean } = {}): Promise<string> {
  const targetDir = path.join(tmpRoot, name);
  await scaffoldProject(
    { projectName: name, targetDir, lintEnabled: options.lintEnabled },
    nodeOclifPack,
    { runCommand: vi.fn(async () => {}) },
  );
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

  it('aborts with a clear UserError when the git working tree is dirty', async () => {
    const targetDir = await scaffoldFixture(tmpRoot, 'dirty-project');
    const deps = {
      runCommand: vi.fn(async () => {}),
      captureCommand: vi.fn(async () => ' M src/commands/hello.ts'),
    };

    await expect(
      updateProject(targetDir, nodeOclifPack.updateAdapter, nodeOclifPack.templateDir, 'node', deps),
    ).rejects.toThrow(/working tree is not clean/i);
    await expect(
      updateProject(targetDir, nodeOclifPack.updateAdapter, nodeOclifPack.templateDir, 'node', deps),
    ).rejects.toBeInstanceOf(UserError);
    expect(deps.runCommand).not.toHaveBeenCalled();
  });

  it('aborts with a clear error when no manifest exists', async () => {
    const targetDir = path.join(tmpRoot, 'no-manifest-project');
    await scaffoldProject({ projectName: 'no-manifest-project', targetDir }, nodeOclifPack, {
      runCommand: vi.fn(async () => {}),
    });
    await rm(path.join(targetDir, '.clispark'), { recursive: true, force: true });

    await expect(
      updateProject(targetDir, nodeOclifPack.updateAdapter, nodeOclifPack.templateDir, 'node', cleanGitDeps()),
    ).rejects.toThrow(/no \.clispark\/manifest\.json found/i);
  });

  it('reports "up-to-date" and makes no changes when the manifest already matches the running version', async () => {
    const targetDir = await scaffoldFixture(tmpRoot, 'fresh-project');
    const deps = cleanGitDeps();

    const result = await updateProject(targetDir, nodeOclifPack.updateAdapter, nodeOclifPack.templateDir, 'node', deps);

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
    const result = await updateProject(targetDir, nodeOclifPack.updateAdapter, nodeOclifPack.templateDir, 'node', deps);

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
    const result = await updateProject(targetDir, nodeOclifPack.updateAdapter, nodeOclifPack.templateDir, 'node', deps);

    expect(result.status).toBe('updated');
    expect(result.fromVersion).toBe('0.0.1');
    expect(result.toVersion).toBe(getGeneratorVersion());

    expect(result.files.find((f) => f.path === 'tsconfig.json')?.outcome).toBe('skipped');
    expect(result.files.find((f) => f.path === 'src/base-command.ts')?.outcome).toBe('replaced');

    const tsconfigAfter = await readFile(tsconfigPath, 'utf8');
    expect(tsconfigAfter).toContain('"strict": false');

    const newManifest = await readManifest(targetDir);
    expect(newManifest?.generatorVersion).toBe(getGeneratorVersion());
    expect(newManifest?.language).toBe('node');
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
    const result = await updateProject(targetDir, nodeOclifPack.updateAdapter, nodeOclifPack.templateDir, 'node', deps);

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
    const result = await updateProject(targetDir, nodeOclifPack.updateAdapter, nodeOclifPack.templateDir, 'node', deps);

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

  it('drives entirely off a fake adapter, proving the generic engine has no hardcoded npm/oclif knowledge', async () => {
    const targetDir = await scaffoldFixture(tmpRoot, 'fake-adapter-project');

    // A hypothetical non-Node adapter: tracks a single core file, and does no
    // package-manifest field merging at all (some ecosystems, e.g. a bare
    // PowerShell module, may not have a meaningful "dependencies" concept).
    const fakeAdapter: UpdateAdapter = {
      coreFilePaths: () => ['tsconfig.json'],
      templateSourcePath: (relativePath) => relativePath,
      manifestFileName: 'package.json',
      readManifestFile: async (dir) => JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8')),
      writeManifestFile: async () => {
        throw new Error('fakeAdapter never writes the manifest file');
      },
      parseManifestFile: (rawContent) => JSON.parse(rawContent),
      readProjectName: (manifestFile) => (manifestFile as { name: string }).name,
      extractCoreFields: () => ({ coreDependencies: {}, coreScripts: {}, coreFields: {} }),
      mergeManifestFile: () => ({
        updatedFile: {},
        changed: false,
        dependencies: [],
        scripts: [],
        fields: [],
        coreDependencies: {},
        coreScripts: {},
        coreFields: {},
      }),
    };

    const tsconfigHash = hashContent(await readFile(path.join(targetDir, 'tsconfig.json'), 'utf8'));
    const manifestPath = path.join(targetDir, '.clispark', 'manifest.json');
    await writeFile(
      manifestPath,
      JSON.stringify(
        {
          generatorVersion: '0.0.1',
          language: 'fake-language',
          lintEnabled: false,
          coreFiles: { 'tsconfig.json': tsconfigHash },
          coreDependencies: {},
          coreScripts: {},
          coreFields: {},
        },
        null,
        2,
      ) + '\n',
    );

    const deps = cleanGitDeps();
    const result = await updateProject(targetDir, fakeAdapter, nodeOclifPack.templateDir, 'fake-language', deps);

    expect(result.status).toBe('updated');
    expect(result.files).toEqual([{ path: 'tsconfig.json', outcome: 'replaced' }]);
    expect(result.dependencies).toEqual([]);
    expect(result.scripts).toEqual([]);
    expect(result.fields).toEqual([]);

    const newManifest = await readManifest(targetDir);
    expect(newManifest?.language).toBe('fake-language');
    expect(newManifest?.coreDependencies).toEqual({});
    expect(newManifest?.coreScripts).toEqual({});
    expect(newManifest?.coreFields).toEqual({});
  });

  it('a project that opted into lint tooling gets its eslint devDependency version-bumped by update', async () => {
    const targetDir = await scaffoldFixture(tmpRoot, 'lint-project', { lintEnabled: true });

    const manifestPath = path.join(targetDir, '.clispark', 'manifest.json');
    const oldManifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Manifest;
    const realCurrentEslintVersion = oldManifest.coreDependencies.eslint;
    oldManifest.generatorVersion = '0.0.1';
    oldManifest.coreDependencies.eslint = '^0.0.1-fake-old'; // fabricate a stale recorded version

    const pkgPath = path.join(targetDir, 'package.json');
    const pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
    pkg.devDependencies.eslint = '^0.0.1-fake-old'; // local file matches the fabricated old manifest -> "unmodified"
    await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
    await writeFile(manifestPath, JSON.stringify(oldManifest, null, 2) + '\n');

    const result = await updateProject(targetDir, nodeOclifPack.updateAdapter, nodeOclifPack.templateDir, 'node', cleanGitDeps());

    const eslintOutcome = result.dependencies.find((d) => d.key === 'eslint');
    expect(eslintOutcome?.outcome).toBe('replaced');
    const pkgAfter = JSON.parse(await readFile(pkgPath, 'utf8'));
    expect(pkgAfter.devDependencies.eslint).toBe(realCurrentEslintVersion);
  });

  it('a project that declined lint tooling never gets eslint.config.js or eslint added by a later update', async () => {
    const targetDir = await scaffoldFixture(tmpRoot, 'no-lint-project', { lintEnabled: false });

    const manifestPath = path.join(targetDir, '.clispark', 'manifest.json');
    const oldManifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Manifest;
    oldManifest.generatorVersion = '0.0.1';
    await writeFile(manifestPath, JSON.stringify(oldManifest, null, 2) + '\n');

    const result = await updateProject(targetDir, nodeOclifPack.updateAdapter, nodeOclifPack.templateDir, 'node', cleanGitDeps());

    expect(result.files.find((f) => f.path === 'eslint.config.js')).toBeUndefined();
    await expect(readFile(path.join(targetDir, 'eslint.config.js'), 'utf8')).rejects.toThrow();
    expect(result.dependencies.find((d) => d.key === 'eslint')).toBeUndefined();
  });

  it('heals a legacy manifest (pre-#70, no lintEnabled field) to lintEnabled: false on disk after update', async () => {
    const targetDir = await scaffoldFixture(tmpRoot, 'legacy-manifest-project');

    const manifestPath = path.join(targetDir, '.clispark', 'manifest.json');
    const oldManifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Manifest;
    oldManifest.generatorVersion = '0.0.1';
    delete (oldManifest as Partial<Manifest>).lintEnabled;
    await writeFile(manifestPath, JSON.stringify(oldManifest, null, 2) + '\n');
    expect(JSON.parse(await readFile(manifestPath, 'utf8'))).not.toHaveProperty('lintEnabled');

    const result = await updateProject(targetDir, nodeOclifPack.updateAdapter, nodeOclifPack.templateDir, 'node', cleanGitDeps());

    expect(result.status).toBe('updated');
    const manifestAfter = JSON.parse(await readFile(manifestPath, 'utf8'));
    expect(manifestAfter).toHaveProperty('lintEnabled', false);
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
