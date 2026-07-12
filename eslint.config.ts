import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'templates/**'],
  },
  {
    files: ['src/**/*.ts', 'scripts/**/*.ts'],
    extends: [eslint.configs.recommended, ...tseslint.configs.recommended],
  },
);
