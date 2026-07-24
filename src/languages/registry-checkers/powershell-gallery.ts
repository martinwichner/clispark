import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { NameCheckResult, RegistryChecker } from '../registry-checker';

export const POWERSHELL_GALLERY_DEFAULT_URL = 'https://www.powershellgallery.com/api/v2';

const FETCH_TIMEOUT_MS = 5000;

async function checkNameAvailability(name: string, registryUrl: string): Promise<NameCheckResult> {
  const url = `${registryUrl}/FindPackagesById()?id='${encodeURIComponent(name)}'`;

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (response.status !== 200) return 'unverified';
    const body = await response.text();
    return body.includes('<entry>') ? 'taken' : 'available';
  } catch {
    return 'unverified';
  }
}

async function applyPrivateIntent(): Promise<void> {
  // Genuine no-op: unlike npm's "private" field or NuGet's <IsPackable>false</IsPackable>,
  // a PowerShell module manifest has no field that prevents accidental publishing — "don't
  // publish this" is enforced by simply never running Publish-PSResource, not by a manifest
  // flag. Nothing to write.
}

async function applyRegistryUrl(targetDir: string, registryUrl: string): Promise<void> {
  const content = [
    '# This file documents the private PSResourceGet repository configured for this project.',
    '# Register it once per machine before publishing or installing dependencies from it:',
    `#   Register-PSResourceRepository -Name "custom" -Uri "${registryUrl}" -Trusted`,
    '',
    registryUrl,
    '',
  ].join('\n');
  await mkdir(targetDir, { recursive: true });
  await writeFile(path.join(targetDir, '.psresource-repository'), content);
}

export const powershellGalleryRegistryChecker: RegistryChecker = {
  checkNameAvailability,
  applyPrivateIntent,
  applyRegistryUrl,
};
