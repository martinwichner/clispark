// src/languages/packs/node-oclif.test.ts
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { nodeOclifPack } from './node-oclif';
import { nodeOclifAdapter } from '../../update/adapters/node-oclif';
import { npmRegistryChecker, NPM_DEFAULT_REGISTRY_URL } from '../registry-checkers/npm';

describe('nodeOclifPack', () => {
  it('has the expected static identity', () => {
    expect(nodeOclifPack.id).toBe('node');
    expect(nodeOclifPack.displayName).toBe('Node.js / TypeScript (oclif)');
  });

  it('points templateDir at templates/node, relative to the package root', () => {
    expect(nodeOclifPack.templateDir.endsWith(path.join('templates', 'node'))).toBe(true);
  });

  it('runs npm install then npm run build as scaffold commands', () => {
    expect(nodeOclifPack.scaffoldCommands).toEqual([
      { command: 'npm', args: ['install'] },
      { command: 'npm', args: ['run', 'build'] },
    ]);
  });

  it('reuses the existing node-oclif UpdateAdapter unchanged', () => {
    expect(nodeOclifPack.updateAdapter).toBe(nodeOclifAdapter);
  });

  it('reuses the npm RegistryChecker for name checks and private-marking', () => {
    expect(nodeOclifPack.registry.checkNameAvailability).toBe(npmRegistryChecker.checkNameAvailability);
    expect(nodeOclifPack.registry.applyPrivateIntent).toBe(npmRegistryChecker.applyPrivateIntent);
    expect(nodeOclifPack.registry.defaultUrl).toBe(NPM_DEFAULT_REGISTRY_URL);
  });

  it('validates project names with the existing npm-style rule', () => {
    expect(nodeOclifPack.validateProjectName('my-cli')).toBeUndefined();
    expect(nodeOclifPack.validateProjectName('')).toMatch(/required/i);
    expect(nodeOclifPack.validateProjectName('My-CLI')).toMatch(/lowercase/i);
    expect(nodeOclifPack.validateProjectName('-leading-hyphen')).toMatch(/lowercase/i);
  });
});
