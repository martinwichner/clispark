import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Manifest } from '../manifest';
import { pythonAdapter, parsePyprojectFile, CORE_FILE_PATHS } from './python';

const SAMPLE_PYPROJECT = `[project]
name = "demo-tool"
version = "0.1.0"
description = ""
requires-python = ">=3.10"
dependencies = [
    "typer>=0.12",
    "structlog>=24.1",
]

[project.scripts]
demo-tool = "cli.cli:app"

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["cli"]
`;

describe('parsePyprojectFile', () => {
  it('extracts name, version, and dependencies from a real pyproject.toml', () => {
    const parsed = parsePyprojectFile(SAMPLE_PYPROJECT);
    expect(parsed.name).toBe('demo-tool');
    expect(parsed.version).toBe('0.1.0');
    expect(parsed.dependencies).toEqual(['typer>=0.12', 'structlog>=24.1']);
    expect(parsed.raw).toBe(SAMPLE_PYPROJECT);
  });

  it('throws when [project].name is missing', () => {
    expect(() => parsePyprojectFile('[project]\nversion = "0.1.0"\n')).toThrow(/name/);
  });
});

describe('pythonAdapter.coreFilePaths', () => {
  it('returns a fixed list regardless of flags', () => {
    const paths = pythonAdapter.coreFilePaths({ lintEnabled: true, autocompleteEnabled: true, commandConventionEnabled: true });
    expect(paths).toEqual(CORE_FILE_PATHS);
    expect(paths).toContain('cli/base_command.py');
    expect(paths).toContain('cli/discover.py');
    expect(paths).toContain('cli/cli.py');
  });
});

describe('pythonAdapter manifest file round trip', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(path.join(tmpdir(), 'clispark-python-adapter-test-'));
    await writeFile(path.join(tmpRoot, 'pyproject.toml'), SAMPLE_PYPROJECT);
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it('reads the real file from disk', async () => {
    const manifestFile = await pythonAdapter.readManifestFile(tmpRoot);
    expect(pythonAdapter.readProjectName(manifestFile)).toBe('demo-tool');
  });

  it('writes the raw content back unchanged when nothing changed', async () => {
    const manifestFile = await pythonAdapter.readManifestFile(tmpRoot);
    await pythonAdapter.writeManifestFile(tmpRoot, manifestFile);
    const written = await readFile(path.join(tmpRoot, 'pyproject.toml'), 'utf8');
    expect(written).toBe(SAMPLE_PYPROJECT);
  });
});

describe('pythonAdapter.mergeManifestFile', () => {
  const baseOldManifest: Manifest = {
    generatorVersion: '1.0.0',
    language: 'python',
    lintEnabled: false,
    autocompleteEnabled: false,
    commandConventionEnabled: false,
    coreFiles: {},
    coreDependencies: { typer: '>=0.12', structlog: '>=24.1' },
    coreScripts: {},
    coreFields: { version: '0.1.0' },
  };

  it('adds a new core dependency the user has not touched', () => {
    const current = parsePyprojectFile(SAMPLE_PYPROJECT);
    const newTemplate = parsePyprojectFile(
      SAMPLE_PYPROJECT.replace('"structlog>=24.1",', '"structlog>=24.1",\n    "rich>=13.0",'),
    );

    const result = pythonAdapter.mergeManifestFile(current, baseOldManifest, newTemplate);

    expect(result.changed).toBe(true);
    expect((result.updatedFile as ReturnType<typeof parsePyprojectFile>).dependencies).toContain('rich>=13.0');
    expect(result.dependencies).toContainEqual({ key: 'rich', outcome: 'added' });
  });

  it('preserves a dependency the user added on their own, even if the template does not know about it', () => {
    const current = parsePyprojectFile(SAMPLE_PYPROJECT.replace('"structlog>=24.1",', '"structlog>=24.1",\n    "requests>=2.0",'));
    const newTemplate = parsePyprojectFile(SAMPLE_PYPROJECT);

    const result = pythonAdapter.mergeManifestFile(current, baseOldManifest, newTemplate);

    expect((result.updatedFile as ReturnType<typeof parsePyprojectFile>).dependencies).toContain('requests>=2.0');
  });

  it('replaces a core dependency version bump the user never touched', () => {
    const current = parsePyprojectFile(SAMPLE_PYPROJECT);
    const newTemplate = parsePyprojectFile(SAMPLE_PYPROJECT.replace('typer>=0.12', 'typer>=0.13'));

    const result = pythonAdapter.mergeManifestFile(current, baseOldManifest, newTemplate);

    expect(result.changed).toBe(true);
    expect((result.updatedFile as ReturnType<typeof parsePyprojectFile>).dependencies).toContain('typer>=0.13');
    expect(result.dependencies).toContainEqual({ key: 'typer', outcome: 'replaced' });
  });

  it('does not touch a core dependency the user has manually edited', () => {
    const current = parsePyprojectFile(SAMPLE_PYPROJECT.replace('typer>=0.12', 'typer==0.11.9'));
    const newTemplate = parsePyprojectFile(SAMPLE_PYPROJECT.replace('typer>=0.12', 'typer>=0.13'));

    const result = pythonAdapter.mergeManifestFile(current, baseOldManifest, newTemplate);

    expect((result.updatedFile as ReturnType<typeof parsePyprojectFile>).dependencies).toContain('typer==0.11.9');
    expect(result.dependencies).toContainEqual({ key: 'typer', outcome: 'skipped' });
  });

  it('bumps [project].version when the user never touched it', () => {
    const current = parsePyprojectFile(SAMPLE_PYPROJECT);
    const newTemplate = parsePyprojectFile(SAMPLE_PYPROJECT.replace('version = "0.1.0"', 'version = "0.2.0"'));
    const oldManifest = { ...baseOldManifest, coreFields: { version: '0.1.0' } };

    const result = pythonAdapter.mergeManifestFile(current, oldManifest, newTemplate);

    expect(result.changed).toBe(true);
    expect((result.updatedFile as ReturnType<typeof parsePyprojectFile>).version).toBe('0.2.0');
    expect((result.updatedFile as ReturnType<typeof parsePyprojectFile>).raw).toContain('version = "0.2.0"');
  });

  it('does not revert a version the user has manually bumped past the template', () => {
    // Regression test for a real bug caught during plan review: reconcileEntry's 'skipped'
    // branch returns the OLD manifest snapshot value, not the user's current live value --
    // writing that back unconditionally would silently revert a manual version bump. The old
    // manifest still says '0.1.0' (never updated after the user's own edit); the user has
    // since manually bumped their live pyproject.toml to '3.0.0'; the template only offers
    // '0.2.0', which is older than what the user already has.
    const current = parsePyprojectFile(SAMPLE_PYPROJECT.replace('version = "0.1.0"', 'version = "3.0.0"'));
    const newTemplate = parsePyprojectFile(SAMPLE_PYPROJECT.replace('version = "0.1.0"', 'version = "0.2.0"'));
    const oldManifest = { ...baseOldManifest, coreFields: { version: '0.1.0' } };

    const result = pythonAdapter.mergeManifestFile(current, oldManifest, newTemplate);

    expect((result.updatedFile as ReturnType<typeof parsePyprojectFile>).version).toBe('3.0.0');
    expect((result.updatedFile as ReturnType<typeof parsePyprojectFile>).raw).toContain('version = "3.0.0"');
  });
});
