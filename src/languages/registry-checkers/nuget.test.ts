// src/languages/registry-checkers/nuget.test.ts
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { nugetRegistryChecker, NUGET_DEFAULT_REGISTRY_URL } from './nuget';

describe('nugetRegistryChecker.checkNameAvailability', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns "available" when the registry responds 404', async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 404 } as Response);
    const result = await nugetRegistryChecker.checkNameAvailability('SomeFreeTool', NUGET_DEFAULT_REGISTRY_URL);
    expect(result).toBe('available');
  });

  it('lowercases the package ID in the request URL', async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 404 } as Response);
    await nugetRegistryChecker.checkNameAvailability('MyTool', NUGET_DEFAULT_REGISTRY_URL);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.nuget.org/v3-flatcontainer/mytool/index.json',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('returns "taken" when the registry responds 200', async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 200 } as Response);
    const result = await nugetRegistryChecker.checkNameAvailability('Newtonsoft.Json', NUGET_DEFAULT_REGISTRY_URL);
    expect(result).toBe('taken');
  });

  it('returns "unverified" on an unexpected status code', async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 500 } as Response);
    const result = await nugetRegistryChecker.checkNameAvailability('SomeTool', NUGET_DEFAULT_REGISTRY_URL);
    expect(result).toBe('unverified');
  });

  it('returns "unverified" when the network request throws', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network down'));
    const result = await nugetRegistryChecker.checkNameAvailability('SomeTool', NUGET_DEFAULT_REGISTRY_URL);
    expect(result).toBe('unverified');
  });

  it('returns "unverified" when the request times out', async () => {
    global.fetch = vi.fn().mockRejectedValue(new DOMException('The operation was aborted.', 'TimeoutError'));
    const result = await nugetRegistryChecker.checkNameAvailability('SomeTool', NUGET_DEFAULT_REGISTRY_URL);
    expect(result).toBe('unverified');
  });
});

describe('nugetRegistryChecker.applyPrivateIntent', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(path.join(tmpdir(), 'clispark-nuget-registry-checker-test-'));
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it('adds <IsPackable>false</IsPackable> to the first PropertyGroup of src/Cli.csproj', async () => {
    const srcDir = path.join(tmpRoot, 'src');
    await import('node:fs/promises').then((fs) => fs.mkdir(srcDir, { recursive: true }));
    await writeFile(
      path.join(srcDir, 'Cli.csproj'),
      '<Project Sdk="Microsoft.NET.Sdk">\n\n  <PropertyGroup>\n    <TargetFramework>net10.0</TargetFramework>\n  </PropertyGroup>\n\n</Project>\n',
    );

    await nugetRegistryChecker.applyPrivateIntent(tmpRoot);

    const csproj = await readFile(path.join(srcDir, 'Cli.csproj'), 'utf8');
    expect(csproj).toContain('<IsPackable>false</IsPackable>');
    expect(csproj).toContain('<TargetFramework>net10.0</TargetFramework>');
  });
});

describe('nugetRegistryChecker.applyRegistryUrl', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(path.join(tmpdir(), 'clispark-nuget-registry-checker-test-'));
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it('writes a NuGet.config with <clear/> and the custom source', async () => {
    await nugetRegistryChecker.applyRegistryUrl(tmpRoot, 'https://nuget.mycompany.dev/v3/index.json');

    const config = await readFile(path.join(tmpRoot, 'NuGet.config'), 'utf8');
    expect(config).toContain('<clear />');
    expect(config).toContain('<add key="custom" value="https://nuget.mycompany.dev/v3/index.json" />');
  });
});
