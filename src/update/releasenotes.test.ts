import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getGeneratorVersion, writeManifest, type Manifest } from './manifest';
import { compareVersions, fetchReleaseNotes, formatReleaseNotes } from './releasenotes';

function baseManifest(generatorVersion: string): Manifest {
  return {
    generatorVersion,
    coreFiles: {},
    coreDependencies: {},
    coreScripts: {},
    coreFields: { engines: {}, oclif: {} },
  };
}

describe('compareVersions', () => {
  it('compares semantic versions numerically, ignoring a leading "v"', () => {
    expect(compareVersions('1.2.0', 'v1.10.0')).toBeLessThan(0);
    expect(compareVersions('2.0.0', '1.9.9')).toBeGreaterThan(0);
    expect(compareVersions('1.1.0', '1.1.0')).toBe(0);
  });
});

describe('fetchReleaseNotes', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(path.join(tmpdir(), 'clispark-releasenotes-test-'));
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it('throws when no manifest exists', async () => {
    await expect(fetchReleaseNotes(tmpRoot)).rejects.toThrow(/no \.clispark\/manifest\.json found/i);
  });

  it('reports "up-to-date" without calling the network when already on the latest version', async () => {
    await writeManifest(tmpRoot, baseManifest(getGeneratorVersion()));
    const fetchFn = vi.fn();

    const result = await fetchReleaseNotes(tmpRoot, fetchFn as unknown as typeof fetch);

    expect(result.status).toBe('up-to-date');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('filters releases to those strictly newer than the project version and up to the running version', async () => {
    await writeManifest(tmpRoot, baseManifest('1.0.0'));
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        { tag_name: `v${getGeneratorVersion()}`, name: 'latest', body: 'latest notes' },
        { tag_name: 'v1.0.1', name: 'patch', body: 'patch notes' },
        { tag_name: 'v1.0.0', name: 'too old', body: 'should be excluded' },
      ],
    });

    const result = await fetchReleaseNotes(tmpRoot, fetchFn as unknown as typeof fetch);

    expect(result.status).toBe('releases-found');
    expect(result.releases.map((r) => r.tag_name)).toEqual([`v${getGeneratorVersion()}`, 'v1.0.1']);
  });

  it('throws a clear error when the GitHub API responds with an error status', async () => {
    await writeManifest(tmpRoot, baseManifest('1.0.0'));
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 500 });

    await expect(fetchReleaseNotes(tmpRoot, fetchFn as unknown as typeof fetch)).rejects.toThrow(/500/);
  });

  it('passes an abort signal so a hung request times out instead of blocking forever', async () => {
    await writeManifest(tmpRoot, baseManifest('1.0.0'));
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });

    await fetchReleaseNotes(tmpRoot, fetchFn as unknown as typeof fetch);

    expect(fetchFn).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('propagates a timeout as a normal rejection', async () => {
    await writeManifest(tmpRoot, baseManifest('1.0.0'));
    const fetchFn = vi.fn().mockRejectedValue(new DOMException('The operation was aborted.', 'TimeoutError'));

    await expect(fetchReleaseNotes(tmpRoot, fetchFn as unknown as typeof fetch)).rejects.toThrow();
  });
});

describe('formatReleaseNotes', () => {
  it('formats an up-to-date result', () => {
    const text = formatReleaseNotes({ status: 'up-to-date', fromVersion: '1.0.0', toVersion: '1.0.0', releases: [] });
    expect(text).toContain('latest clispark version');
  });

  it('formats releases newest-first with tag and body', () => {
    const text = formatReleaseNotes({
      status: 'releases-found',
      fromVersion: '1.0.0',
      toVersion: '1.1.0',
      releases: [{ tag_name: 'v1.1.0', name: 'v1.1.0', body: 'feat: added update command' }],
    });
    expect(text).toContain('v1.1.0');
    expect(text).toContain('feat: added update command');
  });
});
