import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pypiRegistryChecker, PYPI_DEFAULT_URL } from './pypi';

describe('pypiRegistryChecker.checkNameAvailability', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns "available" when PyPI responds 404', async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 404 } as Response);
    const result = await pypiRegistryChecker.checkNameAvailability('some-free-name', PYPI_DEFAULT_URL);
    expect(result).toBe('available');
    expect(global.fetch).toHaveBeenCalledWith(
      `${PYPI_DEFAULT_URL}/some-free-name/json`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('returns "taken" when PyPI responds 200', async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 200 } as Response);
    const result = await pypiRegistryChecker.checkNameAvailability('requests', PYPI_DEFAULT_URL);
    expect(result).toBe('taken');
  });

  it('returns "unverified" on an unexpected status code', async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 500 } as Response);
    const result = await pypiRegistryChecker.checkNameAvailability('some-name', PYPI_DEFAULT_URL);
    expect(result).toBe('unverified');
  });

  it('returns "unverified" when the network request throws', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network down'));
    const result = await pypiRegistryChecker.checkNameAvailability('some-name', PYPI_DEFAULT_URL);
    expect(result).toBe('unverified');
  });
});

describe('pypiRegistryChecker.applyPrivateIntent', () => {
  it('is a documented no-op: resolves without touching the filesystem', async () => {
    await expect(pypiRegistryChecker.applyPrivateIntent('/tmp/whatever')).resolves.toBeUndefined();
  });
});

describe('pypiRegistryChecker.applyRegistryUrl', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(path.join(tmpdir(), 'clispark-pypi-registry-checker-test-'));
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it('writes a uv.toml with a custom index pointing at the given URL', async () => {
    await pypiRegistryChecker.applyRegistryUrl(tmpRoot, 'https://pypi.example.internal/simple');

    const content = await readFile(path.join(tmpRoot, 'uv.toml'), 'utf8');
    expect(content).toContain('https://pypi.example.internal/simple');
    expect(content).toContain('[[index]]');
  });
});
