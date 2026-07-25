// src/languages/autocomplete-support/node.ts
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const AUTOCOMPLETE_DEPENDENCY_NAME = '@oclif/plugin-autocomplete';

interface OclifFieldShape {
  plugins?: unknown;
  [key: string]: unknown;
}

export function withoutAutocompletePlugin(oclif: unknown): unknown {
  if (!oclif || typeof oclif !== 'object') return oclif;
  const shape = oclif as OclifFieldShape;
  if (!Array.isArray(shape.plugins)) return oclif;
  return { ...shape, plugins: shape.plugins.filter((name) => name !== AUTOCOMPLETE_DEPENDENCY_NAME) };
}

export async function stripAutocompleteSupport(targetDir: string): Promise<void> {
  const pkgPath = path.join(targetDir, 'package.json');
  const pkg = JSON.parse(await readFile(pkgPath, 'utf8'));

  delete pkg.dependencies?.[AUTOCOMPLETE_DEPENDENCY_NAME];
  pkg.oclif = withoutAutocompletePlugin(pkg.oclif);

  await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
}
