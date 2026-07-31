// src/languages/command-convention/node.ts
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const COMMAND_CONVENTION_DEPENDENCY_NAME = '@typescript-eslint/utils';

export async function stripCommandConvention(targetDir: string): Promise<void> {
  await rm(path.join(targetDir, 'eslint-rules', 'require-base-command.js'), { force: true });

  const pkgPath = path.join(targetDir, 'package.json');
  const pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
  delete pkg.devDependencies?.[COMMAND_CONVENTION_DEPENDENCY_NAME];
  await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
}
