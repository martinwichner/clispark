import { describe, it, expect, vi } from 'vitest';

vi.mock('@clack/prompts', () => ({ note: vi.fn() }));

describe('runWizardFlagsReference', () => {
  it('shows one note per catalog entry, titled by its id, containing its why text', async () => {
    const { note } = await import('@clack/prompts');
    const { WIZARD_QUESTION_CATALOG } = await import('../wizard');
    const { runWizardFlagsReference } = await import('./wizard-flags-reference');

    await runWizardFlagsReference();

    expect(vi.mocked(note)).toHaveBeenCalledTimes(WIZARD_QUESTION_CATALOG.length);
    for (const entry of WIZARD_QUESTION_CATALOG) {
      expect(vi.mocked(note)).toHaveBeenCalledWith(expect.stringContaining(entry.why), entry.id);
    }
  });
});
