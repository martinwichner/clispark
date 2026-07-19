// src/languages/registry-checkers/nuget.ts
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { NameCheckResult, RegistryChecker } from '../registry-checker';

export const NUGET_DEFAULT_REGISTRY_URL = 'https://api.nuget.org/v3/index.json';

const NUGET_FLATCONTAINER_BASE = 'https://api.nuget.org/v3-flatcontainer';
const FETCH_TIMEOUT_MS = 5000;

async function checkNameAvailability(name: string): Promise<NameCheckResult> {
  const url = `${NUGET_FLATCONTAINER_BASE}/${encodeURIComponent(name.toLowerCase())}/index.json`;

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
  const csprojPath = path.join(targetDir, 'src', 'Cli.csproj');
  const content = await readFile(csprojPath, 'utf8');
  const updated = content.replace(
    /(<PropertyGroup>\s*\n)/,
    '$1    <IsPackable>false</IsPackable>\n',
  );
  await writeFile(csprojPath, updated);
}

async function applyRegistryUrl(targetDir: string, registryUrl: string): Promise<void> {
  const config = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<configuration>',
    '  <packageSources>',
    '    <clear />',
    `    <add key="custom" value="${registryUrl}" />`,
    '  </packageSources>',
    '</configuration>',
    '',
  ].join('\n');
  await mkdir(targetDir, { recursive: true });
  await writeFile(path.join(targetDir, 'NuGet.config'), config);
}

export const nugetRegistryChecker: RegistryChecker = {
  checkNameAvailability,
  applyPrivateIntent,
  applyRegistryUrl,
};
