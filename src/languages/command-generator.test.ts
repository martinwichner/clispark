// src/languages/command-generator.test.ts
import { describe, it, expect } from 'vitest';
import { buildCommandTree } from './command-generator';

describe('buildCommandTree', () => {
  it('builds top-level nodes with no children for flat paths', () => {
    const tree = buildCommandTree(['hello']);
    expect(tree).toEqual([{ path: 'hello', displayLabel: 'hello', children: [] }]);
  });

  it('nests subcommands under their parent', () => {
    const tree = buildCommandTree(['task', 'task complete', 'task list']);
    expect(tree).toEqual([
      {
        path: 'task',
        displayLabel: 'task',
        children: [
          { path: 'task complete', displayLabel: 'task > complete', children: [] },
          { path: 'task list', displayLabel: 'task > list', children: [] },
        ],
      },
    ]);
  });

  it('handles multiple independent top-level trees', () => {
    const tree = buildCommandTree(['hello', 'task', 'task list']);
    expect(tree).toHaveLength(2);
    expect(tree[0].path).toBe('hello');
    expect(tree[1].path).toBe('task');
    expect(tree[1].children).toHaveLength(1);
  });

  it('synthesizes a placeholder parent node for a path whose parent has no own entry', () => {
    const tree = buildCommandTree(['task list']);
    expect(tree).toEqual([
      {
        path: 'task',
        displayLabel: 'task',
        children: [{ path: 'task list', displayLabel: 'task > list', children: [] }],
      },
    ]);
  });

  it('handles arbitrarily deep nesting', () => {
    const tree = buildCommandTree(['a b c']);
    expect(tree[0].path).toBe('a');
    expect(tree[0].children[0].path).toBe('a b');
    expect(tree[0].children[0].children[0].path).toBe('a b c');
  });

  it('returns an empty array for no paths', () => {
    expect(buildCommandTree([])).toEqual([]);
  });
});
