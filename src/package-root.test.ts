// src/package-root.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { findPackageRoot } from './package-root';

describe('findPackageRoot', () => {
  it('finds the directory containing package.json with name "clispark"', () => {
    const root = findPackageRoot();
    const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { name: string };
    expect(pkg.name).toBe('clispark');
  });
});
