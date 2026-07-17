import { describe, it, expect, vi, afterEach } from 'vitest';
import { checkPackageNameAvailability, DEFAULT_REGISTRY_URL } from './registry';

describe('checkPackageNameAvailability', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns "available" when the registry responds 404', async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 404 } as Response);
    const result = await checkPackageNameAvailability('some-free-name');
    expect(result).toBe('available');
    expect(global.fetch).toHaveBeenCalledWith(
      `${DEFAULT_REGISTRY_URL}/some-free-name`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('returns "taken" when the registry responds 200', async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 200 } as Response);
    const result = await checkPackageNameAvailability('express');
    expect(result).toBe('taken');
  });

  it('returns "unverified" on an unexpected status code', async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 500 } as Response);
    const result = await checkPackageNameAvailability('some-name');
    expect(result).toBe('unverified');
  });

  it('returns "unverified" when the network request throws', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network down'));
    const result = await checkPackageNameAvailability('some-name');
    expect(result).toBe('unverified');
  });

  it('uses a custom registry URL when provided', async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 404 } as Response);
    await checkPackageNameAvailability('my-cli', 'https://npm.mycompany.dev');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://npm.mycompany.dev/my-cli',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('returns "unverified" when the request times out', async () => {
    global.fetch = vi.fn().mockRejectedValue(new DOMException('The operation was aborted.', 'TimeoutError'));
    const result = await checkPackageNameAvailability('some-name');
    expect(result).toBe('unverified');
  });
});
