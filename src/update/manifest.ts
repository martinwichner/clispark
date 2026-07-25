// src/update/manifest.ts
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UserError } from '../errors';
import type { CoreFilePathsFlags, UpdateAdapter } from './adapter';

export interface Manifest {
  generatorVersion: string;
  language: string;
  lintEnabled: boolean;
  autocompleteEnabled: boolean;
  coreFiles: Record<string, string>;
  coreDependencies: Record<string, string>;
  coreScripts: Record<string, string>;
  coreFields: Record<string, unknown>;
}

export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export async function hashCoreFiles(
  dir: string,
  adapter: UpdateAdapter,
  flags: CoreFilePathsFlags,
): Promise<Record<string, string>> {
  const entries = await Promise.all(
    adapter.coreFilePaths(flags).map(async (relativePath) => {
      const content = await readFile(path.join(dir, relativePath), 'utf8');
      return [relativePath, hashContent(content)] as const;
    }),
  );
  return Object.fromEntries(entries);
}

export async function buildManifest(
  targetDir: string,
  generatorVersion: string,
  language: string,
  adapter: UpdateAdapter,
  lintEnabled: boolean,
  autocompleteEnabled: boolean,
): Promise<Manifest> {
  const coreFiles = await hashCoreFiles(targetDir, adapter, { lintEnabled, autocompleteEnabled });
  const manifestFile = await adapter.readManifestFile(targetDir);
  const { coreDependencies, coreScripts, coreFields } = adapter.extractCoreFields(manifestFile, {
    lintEnabled,
    autocompleteEnabled,
  });
  return { generatorVersion, language, lintEnabled, autocompleteEnabled, coreFiles, coreDependencies, coreScripts, coreFields };
}

export const MANIFEST_RELATIVE_PATH = path.join('.clispark', 'manifest.json');

export async function writeManifest(targetDir: string, manifest: Manifest): Promise<void> {
  const manifestPath = path.join(targetDir, MANIFEST_RELATIVE_PATH);
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
}

export async function readManifest(targetDir: string): Promise<Manifest | undefined> {
  try {
    const content = await readFile(path.join(targetDir, MANIFEST_RELATIVE_PATH), 'utf8');
    return JSON.parse(content) as Manifest;
  } catch {
    return undefined;
  }
}

export async function requireManifest(targetDir: string): Promise<Manifest> {
  const manifest = await readManifest(targetDir);
  if (!manifest) {
    throw new UserError(
      'No .clispark/manifest.json found — this project predates update support, or is not a clispark project.',
    );
  }
  return manifest;
}

/**
 * Finds clispark's own package.json by walking up from this file's location.
 * A fixed relative path (`../package.json`) can't work here: this module's
 * depth below the package root differs between running from source (tests)
 * and running as part of the bundled `dist/cli.js` (tsup flattens everything
 * into one file, so `import.meta.url` no longer reflects the original
 * per-module nesting).
 */
export function getGeneratorVersion(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  while (true) {
    const pkgPath = path.join(dir, 'package.json');
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { name?: string; version: string };
      if (pkg.name === 'clispark') return pkg.version;
    }
    const parentDir = path.dirname(dir);
    if (parentDir === dir) {
      throw new Error("Could not locate clispark's own package.json.");
    }
    dir = parentDir;
  }
}
