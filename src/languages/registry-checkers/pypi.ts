import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { NameCheckResult, RegistryChecker } from '../registry-checker';

export const PYPI_DEFAULT_URL = 'https://pypi.org/pypi';

const FETCH_TIMEOUT_MS = 5000;

async function checkNameAvailability(name: string, registryUrl: string): Promise<NameCheckResult> {
  const url = `${registryUrl.replace(/\/$/, '')}/${encodeURIComponent(name)}/json`;

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (response.status === 404) return 'available';
    if (response.status === 200) return 'taken';
    return 'unverified';
  } catch {
    return 'unverified';
  }
}

async function applyPrivateIntent(): Promise<void> {
  // Genuine no-op, same reasoning as the PowerShell Gallery checker: PyPI has no manifest
  // field that prevents accidental publishing (unlike npm's "private" or NuGet's
  // <IsPackable>false</IsPackable>) -- "don't publish this" is enforced by simply never
  // running `uv publish`, not by a pyproject.toml flag.
}

async function applyRegistryUrl(targetDir: string, registryUrl: string): Promise<void> {
  const content = [
    '# Custom package index for this project.',
    '# See https://docs.astral.sh/uv/configuration/indexes/ for details.',
    '',
    '[[index]]',
    'name = "custom"',
    `url = "${registryUrl}"`,
    'default = true',
    '',
  ].join('\n');
  await writeFile(path.join(targetDir, 'uv.toml'), content);
}

export const pypiRegistryChecker: RegistryChecker = {
  checkNameAvailability,
  applyPrivateIntent,
  applyRegistryUrl,
};
