import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/commands/**/*.ts', '!src/commands/**/*.test.ts'],
  format: ['esm'],
  target: 'node18',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
});
