import { describe, it, expect, vi, afterEach } from 'vitest';
import { powershellGalleryRegistryChecker, POWERSHELL_GALLERY_DEFAULT_URL } from './powershell-gallery';

describe('powershellGalleryRegistryChecker.checkNameAvailability', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns "taken" when the feed contains at least one <entry>', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<feed><entry>x</entry></feed>', { status: 200 })),
    );
    const result = await powershellGalleryRegistryChecker.checkNameAvailability('Pester', POWERSHELL_GALLERY_DEFAULT_URL);
    expect(result).toBe('taken');
    vi.unstubAllGlobals();
  });

  it('returns "available" when the feed has zero <entry> elements', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<feed></feed>', { status: 200 })),
    );
    const result = await powershellGalleryRegistryChecker.checkNameAvailability('DefinitelyFreeName', POWERSHELL_GALLERY_DEFAULT_URL);
    expect(result).toBe('available');
    vi.unstubAllGlobals();
  });

  it('returns "unverified" on a non-200 response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 500 })),
    );
    const result = await powershellGalleryRegistryChecker.checkNameAvailability('Anything', POWERSHELL_GALLERY_DEFAULT_URL);
    expect(result).toBe('unverified');
    vi.unstubAllGlobals();
  });

  it('returns "unverified" when fetch throws (network error)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );
    const result = await powershellGalleryRegistryChecker.checkNameAvailability('Anything', POWERSHELL_GALLERY_DEFAULT_URL);
    expect(result).toBe('unverified');
    vi.unstubAllGlobals();
  });
});

describe('powershellGalleryRegistryChecker.applyPrivateIntent', () => {
  it('is a documented no-op: resolves without touching the filesystem', async () => {
    await expect(powershellGalleryRegistryChecker.applyPrivateIntent('/tmp/whatever')).resolves.toBeUndefined();
  });
});

describe('powershellGalleryRegistryChecker.applyRegistryUrl', () => {
  it('writes a PSResourceGet repository-registration hint file', async () => {
    const { mkdtemp, readFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const path = await import('node:path');
    const dir = await mkdtemp(path.join(tmpdir(), 'ps-registry-'));

    await powershellGalleryRegistryChecker.applyRegistryUrl(dir, 'https://pkgs.example.internal/psresource/v1');

    const content = await readFile(path.join(dir, '.psresource-repository'), 'utf8');
    expect(content).toContain('https://pkgs.example.internal/psresource/v1');
  });
});
