// src/wizard.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NameCheckResult } from './registry';

vi.mock('@clack/prompts', () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  text: vi.fn(),
  select: vi.fn(),
  log: { warn: vi.fn(), info: vi.fn() },
  isCancel: vi.fn(() => false),
  cancel: vi.fn(),
}));

import { text, select, log } from '@clack/prompts';
import { runWizard } from './wizard';

describe('runWizard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('asks name, then profile, then returns the answers when the name is available on first try', async () => {
    vi.mocked(text).mockResolvedValueOnce('my-cli');
    vi.mocked(select).mockResolvedValueOnce('private');
    const checkAvailability = vi.fn<(name: string, registryUrl?: string) => Promise<NameCheckResult>>().mockResolvedValueOnce('available');

    const result = await runWizard({ checkAvailability });

    expect(result).toEqual({
      projectName: 'my-cli',
      profile: 'private',
      registryUrl: 'https://registry.npmjs.org',
      nameAvailability: 'available',
    });
    expect(checkAvailability).toHaveBeenCalledTimes(1);
    // name is asked before profile
    expect(vi.mocked(text).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(select).mock.invocationCallOrder[0],
    );
  });

  it('warns and re-prompts for the name only (not profile/registry) when it is taken, then succeeds', async () => {
    vi.mocked(text)
      .mockResolvedValueOnce('taken-name')
      .mockResolvedValueOnce('free-name');
    vi.mocked(select).mockResolvedValueOnce('private');
    const checkAvailability = vi
      .fn<(name: string, registryUrl?: string) => Promise<NameCheckResult>>()
      .mockResolvedValueOnce('taken')
      .mockResolvedValueOnce('available');

    const result = await runWizard({ checkAvailability });

    expect(result.projectName).toBe('free-name');
    expect(checkAvailability).toHaveBeenCalledTimes(2);
    expect(select).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('taken-name'));
  });

  it('asks for a custom registry URL only when profile is "work"', async () => {
    vi.mocked(text)
      .mockResolvedValueOnce('my-cli')
      .mockResolvedValueOnce('https://npm.mycompany.dev');
    vi.mocked(select).mockResolvedValueOnce('work');
    const checkAvailability = vi.fn<(name: string, registryUrl?: string) => Promise<NameCheckResult>>().mockResolvedValueOnce('available');

    const result = await runWizard({ checkAvailability });

    expect(result.registryUrl).toBe('https://npm.mycompany.dev');
    expect(checkAvailability).toHaveBeenCalledWith('my-cli', 'https://npm.mycompany.dev');
  });

  it('continues with "unverified" and a warning when the registry check fails', async () => {
    vi.mocked(text).mockResolvedValueOnce('my-cli');
    vi.mocked(select).mockResolvedValueOnce('private');
    const checkAvailability = vi.fn<(name: string, registryUrl?: string) => Promise<NameCheckResult>>().mockResolvedValueOnce('unverified');

    const result = await runWizard({ checkAvailability });

    expect(result.nameAvailability).toBe('unverified');
    expect(log.warn).toHaveBeenCalled();
  });
});
