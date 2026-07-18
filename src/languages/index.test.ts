// src/languages/index.test.ts
import { describe, it, expect } from 'vitest';
import { LANGUAGE_PACKS, getPackById } from './index';
import { nodeOclifPack } from './packs/node-oclif';

describe('LANGUAGE_PACKS', () => {
  it('includes the node-oclif pack, keyed by its id', () => {
    expect(LANGUAGE_PACKS.node).toBe(nodeOclifPack);
  });
});

describe('getPackById', () => {
  it('returns the pack for a known id', () => {
    expect(getPackById('node')).toBe(nodeOclifPack);
  });

  it('returns undefined for an unknown id', () => {
    expect(getPackById('nonexistent')).toBeUndefined();
  });
});
