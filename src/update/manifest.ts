// src/update/manifest.ts
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const CORE_FILE_PATHS = [
  'bin/run.js',
  'src/index.ts',
  'src/base-command.ts',
  'src/logger.ts',
  'tsup.config.ts',
  'vitest.config.ts',
  'tsconfig.json',
  'ARCHITECTURE.md',
  '.gitignore',
] as const;

export const CORE_SCRIPT_NAMES = ['build', 'postbuild', 'pretest', 'test', 'typecheck'] as const;

/** The base template stores .gitignore as "gitignore" (renamed on copy); every other core path is identical in the template and in a generated project. */
export function templateSourcePath(relativePath: string): string {
  return relativePath === '.gitignore' ? 'gitignore' : relativePath;
}

export interface Manifest {
  generatorVersion: string;
  coreFiles: Record<string, string>;
  coreDependencies: Record<string, string>;
  coreScripts: Record<string, string>;
  coreFields: {
    engines: Record<string, string>;
    oclif: Record<string, unknown>;
  };
}

export interface PackageJsonCore {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
  engines?: Record<string, string>;
  oclif?: Record<string, unknown>;
}

export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export async function hashCoreFiles(dir: string): Promise<Record<string, string>> {
  const hashes: Record<string, string> = {};
  for (const relativePath of CORE_FILE_PATHS) {
    const content = await readFile(path.join(dir, relativePath), 'utf8');
    hashes[relativePath] = hashContent(content);
  }
  return hashes;
}

export function extractCoreFields(
  pkg: PackageJsonCore,
): Pick<Manifest, 'coreDependencies' | 'coreScripts' | 'coreFields'> {
  const coreDependencies = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };

  const coreScripts: Record<string, string> = {};
  for (const name of CORE_SCRIPT_NAMES) {
    const value = pkg.scripts?.[name];
    if (value !== undefined) coreScripts[name] = value;
  }

  return {
    coreDependencies,
    coreScripts,
    coreFields: {
      engines: pkg.engines ?? {},
      oclif: pkg.oclif ?? {},
    },
  };
}

export async function buildManifest(targetDir: string, generatorVersion: string): Promise<Manifest> {
  const coreFiles = await hashCoreFiles(targetDir);
  const pkg = JSON.parse(await readFile(path.join(targetDir, 'package.json'), 'utf8')) as PackageJsonCore;
  const { coreDependencies, coreScripts, coreFields } = extractCoreFields(pkg);
  return { generatorVersion, coreFiles, coreDependencies, coreScripts, coreFields };
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
    throw new Error(
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
