// src/languages/lint-support/node.ts
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const LINT_SCRIPT_NAMES = ['lint', 'format'] as const;
export const LINT_DEPENDENCY_NAMES = [
  'eslint',
  '@eslint/js',
  'typescript-eslint',
  'prettier',
  'eslint-config-prettier',
] as const;

export async function stripLintTooling(targetDir: string): Promise<void> {
  await rm(path.join(targetDir, 'eslint.config.js'), { force: true });
  await rm(path.join(targetDir, '.prettierrc'), { force: true });
  await rm(path.join(targetDir, '.prettierignore'), { force: true });

  const pkgPath = path.join(targetDir, 'package.json');
  const pkg = JSON.parse(await readFile(pkgPath, 'utf8'));

  for (const name of LINT_SCRIPT_NAMES) delete pkg.scripts?.[name];
  for (const name of LINT_DEPENDENCY_NAMES) delete pkg.devDependencies?.[name];

  await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
}
