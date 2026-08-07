// src/languages/index.test.ts
import { describe, it, expect } from 'vitest';
import { LANGUAGE_PACKS, getPackById } from './index';
import { nodeOclifPack } from './packs/node-oclif';
import { pythonPack } from './packs/python';

describe('LANGUAGE_PACKS', () => {
  it('includes the node-oclif pack, keyed by its id', () => {
    expect(LANGUAGE_PACKS.node).toBe(nodeOclifPack);
  });

  it('includes the python pack, keyed by its id', () => {
    expect(LANGUAGE_PACKS.python).toBe(pythonPack);
  });
});

describe('getPackById', () => {
  it('returns the pack for a known id', () => {
    expect(getPackById('node')).toBe(nodeOclifPack);
  });

  it('returns undefined for an unknown id', () => {
    expect(getPackById('nonexistent')).toBeUndefined();
  });

  it('returns the python pack for id "python"', () => {
    expect(getPackById('python')).toBe(pythonPack);
  });
});
