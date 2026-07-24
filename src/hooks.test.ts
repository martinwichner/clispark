// src/hooks.test.ts
import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import { getPostScaffoldHookPath, runPostScaffoldHook, type HooksDeps } from './hooks';
import type { PostScaffoldHookContext } from './index';

describe('getPostScaffoldHookPath', () => {
  it('joins the given config dir with hooks/post-scaffold.mjs', () => {
    const result = getPostScaffoldHookPath('/some/config/dir');
    expect(result).toBe(path.join('/some/config/dir', 'hooks', 'post-scaffold.mjs'));
  });
});

describe('runPostScaffoldHook', () => {
  const context: PostScaffoldHookContext = {
    projectName: 'demo',
    targetDir: '/tmp/demo',
    language: 'node',
    registryUrl: undefined,
    publishIntent: true,
  };
  const hookPath = '/fake/hooks/post-scaffold.mjs';

  function makeDeps(overrides: Partial<HooksDeps> = {}): { deps: HooksDeps; warnCalls: string[] } {
    const warnCalls: string[] = [];
    const deps: HooksDeps = {
      fileExists: vi.fn(() => true),
      importHookModule: vi.fn(async () => ({ default: vi.fn() })),
      warn: (message: string) => warnCalls.push(message),
      ...overrides,
    };
    return { deps, warnCalls };
  }

  it('does nothing when the hook file does not exist', async () => {
    const { deps, warnCalls } = makeDeps({ fileExists: vi.fn(() => false) });

    await runPostScaffoldHook(context, hookPath, deps);

    expect(deps.importHookModule).not.toHaveBeenCalled();
    expect(warnCalls).toEqual([]);
  });

  it('imports the hook via a file:// URL and calls its default export with the context', async () => {
    const defaultFn = vi.fn();
    const { deps, warnCalls } = makeDeps({ importHookModule: vi.fn(async () => ({ default: defaultFn })) });

    await runPostScaffoldHook(context, hookPath, deps);

    expect(deps.importHookModule).toHaveBeenCalledWith('file:///fake/hooks/post-scaffold.mjs');
    expect(defaultFn).toHaveBeenCalledWith(context);
    expect(warnCalls).toEqual([]);
  });

  it('awaits an async default export before completing', async () => {
    let resolved = false;
    const defaultFn = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 1));
      resolved = true;
    });
    const { deps } = makeDeps({ importHookModule: vi.fn(async () => ({ default: defaultFn })) });

    await runPostScaffoldHook(context, hookPath, deps);

    expect(resolved).toBe(true);
  });

  it('warns clearly and does not throw when the default export is missing', async () => {
    const { deps, warnCalls } = makeDeps({ importHookModule: vi.fn(async () => ({})) });

    await expect(runPostScaffoldHook(context, hookPath, deps)).resolves.toBeUndefined();

    expect(warnCalls).toHaveLength(1);
    expect(warnCalls[0]).toContain('Post-scaffold hook failed');
    expect(warnCalls[0]).toContain('default export');
    expect(warnCalls[0]).toContain('still created successfully');
  });

  it('warns clearly and does not throw when the default export is not a function', async () => {
    const { deps, warnCalls } = makeDeps({ importHookModule: vi.fn(async () => ({ default: 'not a function' })) });

    await runPostScaffoldHook(context, hookPath, deps);

    expect(warnCalls).toHaveLength(1);
    expect(warnCalls[0]).toContain('Post-scaffold hook failed');
  });

  it('warns clearly and does not throw when the import itself throws (e.g. invalid ESM syntax)', async () => {
    const { deps, warnCalls } = makeDeps({
      importHookModule: vi.fn(async () => {
        throw new SyntaxError('Unexpected identifier');
      }),
    });

    await runPostScaffoldHook(context, hookPath, deps);

    expect(warnCalls).toHaveLength(1);
    expect(warnCalls[0]).toContain('Unexpected identifier');
    expect(warnCalls[0]).toContain('still created successfully');
  });

  it('warns clearly and does not throw when the hook function itself throws', async () => {
    const defaultFn = vi.fn(() => {
      throw new Error('boom');
    });
    const { deps, warnCalls } = makeDeps({ importHookModule: vi.fn(async () => ({ default: defaultFn })) });

    await runPostScaffoldHook(context, hookPath, deps);

    expect(warnCalls).toHaveLength(1);
    expect(warnCalls[0]).toContain('boom');
  });

  it('warns clearly and does not throw when the hook function rejects', async () => {
    const defaultFn = vi.fn(async () => {
      throw new Error('async boom');
    });
    const { deps, warnCalls } = makeDeps({ importHookModule: vi.fn(async () => ({ default: defaultFn })) });

    await runPostScaffoldHook(context, hookPath, deps);

    expect(warnCalls).toHaveLength(1);
    expect(warnCalls[0]).toContain('async boom');
  });
});
