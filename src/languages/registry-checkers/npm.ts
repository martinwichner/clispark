// src/languages/registry-checkers/npm.ts
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { NameCheckResult, RegistryChecker } from '../registry-checker';

export const NPM_DEFAULT_REGISTRY_URL = 'https://registry.npmjs.org';

const FETCH_TIMEOUT_MS = 5000;

async function checkNameAvailability(name: string, registryUrl: string): Promise<NameCheckResult> {
  const url = `${registryUrl.replace(/\/$/, '')}/${encodeURIComponent(name)}`;

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (response.status === 404) return 'available';
    if (response.status === 200) return 'taken';
    return 'unverified';
  } catch {
    return 'unverified';
  }
}

async function applyPrivateIntent(targetDir: string): Promise<void> {
  const packageJsonPath = path.join(targetDir, 'package.json');
  const pkg = JSON.parse(await readFile(packageJsonPath, 'utf8')) as Record<string, unknown>;
  pkg.private = true;
  await writeFile(packageJsonPath, JSON.stringify(pkg, null, 2) + '\n');
}

async function applyRegistryUrl(targetDir: string, registryUrl: string): Promise<void> {
  await writeFile(path.join(targetDir, '.npmrc'), `registry=${registryUrl}\n`);
}

export const npmRegistryChecker: RegistryChecker = {
  checkNameAvailability,
  applyPrivateIntent,
  applyRegistryUrl,
};
