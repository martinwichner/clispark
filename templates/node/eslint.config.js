// eslint.config.js
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const ruleFilePath = path.join(dirname, 'eslint-rules', 'require-base-command.js');

const commandConventionConfig = existsSync(ruleFilePath)
  ? [
      {
        files: ['src/commands/**/*.ts'],
        // This rule is type-aware (it walks the class hierarchy via the TS
        // checker), so this glob needs its own project-backed parser info --
        // the base config block below only uses tseslint.configs.recommended,
        // which is not type-checked.
        languageOptions: {
          parserOptions: {
            projectService: true,
            tsconfigRootDir: dirname,
          },
        },
        plugins: {
          local: {
            rules: {
              'require-base-command': (await import('./eslint-rules/require-base-command.js')).default,
            },
          },
        },
        rules: {
          'local/require-base-command': 'error',
        },
      },
    ]
  : [];

export default tseslint.config(
  {
    ignores: ['dist/**'],
  },
  {
    files: ['src/**/*.ts', 'bin/**/*.ts'],
    extends: [
      eslint.configs.recommended,
      ...tseslint.configs.recommended,
      eslintConfigPrettier,
    ],
  },
  ...commandConventionConfig,
);
