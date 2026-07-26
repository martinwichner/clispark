import { describe, it, expect, vi, afterEach } from 'vitest';
import { readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';

vi.mock('@clack/prompts', () => ({ note: vi.fn(), log: { warn: vi.fn() } }));

function listDemoTempDirs(): string[] {
  return readdirSync(tmpdir()).filter((name) => name.startsWith('clispark-demo-'));
}

describe('runFullWalkthrough', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('scaffolds for real, narrates the key files, and removes the temp directory afterward', async () => {
    const { note } = await import('@clack/prompts');
    const { runFullWalkthrough } = await import('./full-walkthrough');
    const before = listDemoTempDirs();

    await runFullWalkthrough();

    expect(listDemoTempDirs()).toEqual(before);

    const titles = vi.mocked(note).mock.calls.map(([, title]) => title ?? '');
    expect(titles.some((t) => t.includes('base-command.ts'))).toBe(true);
    expect(titles.some((t) => t.includes('hello.ts'))).toBe(true);
    expect(titles.some((t) => t.includes('task.ts'))).toBe(true);
    expect(titles.some((t) => t.includes('task/list.ts'))).toBe(true);
    expect(titles.some((t) => t.includes('task/complete.ts'))).toBe(true);
    expect(titles.some((t) => t.includes('.NET') || t.includes('PowerShell'))).toBe(true);
  }, 30_000);

  it('falls back to a static description and still cleans up when the real scaffold throws', async () => {
    const scaffoldModule = await import('../scaffold');
    const { log, note } = await import('@clack/prompts');
    vi.spyOn(scaffoldModule, 'scaffoldProject').mockRejectedValueOnce(new Error('disk full'));
    const { runFullWalkthrough } = await import('./full-walkthrough');
    const before = listDemoTempDirs();

    await expect(runFullWalkthrough()).resolves.toBeUndefined();

    expect(vi.mocked(log.warn)).toHaveBeenCalledOnce();
    const titles = vi.mocked(note).mock.calls.map(([, title]) => title);
    expect(titles).toContain('What would happen');
    expect(listDemoTempDirs()).toEqual(before);
  });
});
