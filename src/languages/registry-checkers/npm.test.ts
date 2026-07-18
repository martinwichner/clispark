// src/languages/registry-checkers/npm.test.ts
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { npmRegistryChecker, NPM_DEFAULT_REGISTRY_URL } from './npm';

describe('npmRegistryChecker.checkNameAvailability', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns "available" when the registry responds 404', async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 404 } as Response);
    const result = await npmRegistryChecker.checkNameAvailability('some-free-name', NPM_DEFAULT_REGISTRY_URL);
    expect(result).toBe('available');
    expect(global.fetch).toHaveBeenCalledWith(
      `${NPM_DEFAULT_REGISTRY_URL}/some-free-name`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('returns "taken" when the registry responds 200', async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 200 } as Response);
    const result = await npmRegistryChecker.checkNameAvailability('express', NPM_DEFAULT_REGISTRY_URL);
    expect(result).toBe('taken');
  });

  it('returns "unverified" on an unexpected status code', async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 500 } as Response);
    const result = await npmRegistryChecker.checkNameAvailability('some-name', NPM_DEFAULT_REGISTRY_URL);
    expect(result).toBe('unverified');
  });

  it('returns "unverified" when the network request throws', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network down'));
    const result = await npmRegistryChecker.checkNameAvailability('some-name', NPM_DEFAULT_REGISTRY_URL);
    expect(result).toBe('unverified');
  });

  it('uses a custom registry URL when provided', async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 404 } as Response);
    await npmRegistryChecker.checkNameAvailability('my-cli', 'https://npm.mycompany.dev');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://npm.mycompany.dev/my-cli',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('returns "unverified" when the request times out', async () => {
    global.fetch = vi.fn().mockRejectedValue(new DOMException('The operation was aborted.', 'TimeoutError'));
    const result = await npmRegistryChecker.checkNameAvailability('some-name', NPM_DEFAULT_REGISTRY_URL);
    expect(result).toBe('unverified');
  });
});

describe('npmRegistryChecker.applyPrivateIntent', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(path.join(tmpdir(), 'clispark-npm-registry-checker-test-'));
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it('sets "private": true on the target package.json', async () => {
    await writeFile(path.join(tmpRoot, 'package.json'), JSON.stringify({ name: 'my-cli', version: '0.0.0' }));

    await npmRegistryChecker.applyPrivateIntent(tmpRoot);

    const pkg = JSON.parse(await readFile(path.join(tmpRoot, 'package.json'), 'utf8'));
    expect(pkg.private).toBe(true);
    expect(pkg.name).toBe('my-cli');
  });
});
