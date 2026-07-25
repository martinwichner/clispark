// eslint.config.js
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';

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
);
