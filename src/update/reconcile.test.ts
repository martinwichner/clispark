import { describe, it, expect } from 'vitest';
import { deepEquals, reconcileEntry, stringEquals } from './reconcile';

describe('reconcileEntry', () => {
  it('returns "added" when the value does not exist locally yet', () => {
    const result = reconcileEntry(undefined, undefined, 'new-value', stringEquals);
    expect(result).toEqual({ outcome: 'added', value: 'new-value' });
  });

  it('returns "replaced" when the local value matches the last-known generator value', () => {
    const result = reconcileEntry('old-value', 'old-value', 'new-value', stringEquals);
    expect(result).toEqual({ outcome: 'replaced', value: 'new-value' });
  });

  it('returns "skipped" and keeps the old manifest value when the local value diverged', () => {
    const result = reconcileEntry('user-edited-value', 'old-value', 'new-value', stringEquals);
    expect(result).toEqual({ outcome: 'skipped', value: 'old-value' });
  });

  it('returns "skipped" and adopts the current live value when it was never tracked before', () => {
    const result = reconcileEntry('pre-existing-value', undefined, 'new-value', stringEquals);
    expect(result).toEqual({ outcome: 'skipped', value: 'pre-existing-value' });
  });

  it('supports deep equality for object values', () => {
    const replaced = reconcileEntry({ node: '>=18' }, { node: '>=18' }, { node: '>=20' }, deepEquals);
    expect(replaced.outcome).toBe('replaced');

    const skipped = reconcileEntry({ node: '>=16' }, { node: '>=18' }, { node: '>=20' }, deepEquals);
    expect(skipped).toEqual({ outcome: 'skipped', value: { node: '>=18' } });
  });
});
