import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { stripLintTooling } from './node';

describe('stripLintTooling', () => {
  let targetDir: string;

  beforeEach(async () => {
    targetDir = await mkdtemp(path.join(tmpdir(), 'clispark-strip-lint-test-'));
    await writeFile(path.join(targetDir, 'eslint.config.js'), 'export default [];\n');
    await writeFile(path.join(targetDir, '.prettierrc'), '{}\n');
    await writeFile(path.join(targetDir, '.prettierignore'), '.clispark/\n');
    await writeFile(
      path.join(targetDir, 'package.json'),
      JSON.stringify({
        scripts: { build: 'tsup', lint: 'eslint src', format: 'prettier --write .' },
        devDependencies: {
          tsup: '^8.0.0',
          eslint: '^9.0.0',
          '@eslint/js': '^9.0.0',
          'typescript-eslint': '^8.0.0',
          prettier: '^3.0.0',
          'eslint-config-prettier': '^9.0.0',
        },
      }),
    );
  });

  afterEach(async () => {
    await rm(targetDir, { recursive: true, force: true });
  });

  it('deletes eslint.config.js, .prettierrc, and .prettierignore', async () => {
    await stripLintTooling(targetDir);
    await expect(readFile(path.join(targetDir, 'eslint.config.js'), 'utf8')).rejects.toThrow();
    await expect(readFile(path.join(targetDir, '.prettierrc'), 'utf8')).rejects.toThrow();
    await expect(readFile(path.join(targetDir, '.prettierignore'), 'utf8')).rejects.toThrow();
  });

  it('removes lint/format scripts and lint devDependencies from package.json, keeps the rest', async () => {
    await stripLintTooling(targetDir);
    const pkg = JSON.parse(await readFile(path.join(targetDir, 'package.json'), 'utf8'));
    expect(pkg.scripts).toEqual({ build: 'tsup' });
    expect(pkg.devDependencies).toEqual({ tsup: '^8.0.0' });
  });
});
