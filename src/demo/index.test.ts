import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';

vi.mock('@clack/prompts', () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  select: vi.fn(),
  isCancel: vi.fn(() => false),
  cancel: vi.fn(),
}));
vi.mock('./full-walkthrough', () => ({ runFullWalkthrough: vi.fn() }));
vi.mock('./commands-reference', () => ({ runCommandsReference: vi.fn() }));
vi.mock('./wizard-flags-reference', () => ({ runWizardFlagsReference: vi.fn() }));

describe('runDemo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('dispatches to the full walkthrough when chosen', async () => {
    const { select } = await import('@clack/prompts');
    const { runFullWalkthrough } = await import('./full-walkthrough');
    const { runCommandsReference } = await import('./commands-reference');
    const { runWizardFlagsReference } = await import('./wizard-flags-reference');
    const { runDemo } = await import('./index');
    vi.mocked(select).mockResolvedValueOnce('full');

    await runDemo(new Command());

    expect(runFullWalkthrough).toHaveBeenCalledOnce();
    expect(runCommandsReference).not.toHaveBeenCalled();
    expect(runWizardFlagsReference).not.toHaveBeenCalled();
  });

  it('dispatches to the commands reference, passing the program, when chosen', async () => {
    const { select } = await import('@clack/prompts');
    const { runCommandsReference } = await import('./commands-reference');
    const { runDemo } = await import('./index');
    const program = new Command();
    vi.mocked(select).mockResolvedValueOnce('commands');

    await runDemo(program);

    expect(runCommandsReference).toHaveBeenCalledWith(program);
  });

  it('dispatches to the wizard flags reference when chosen', async () => {
    const { select } = await import('@clack/prompts');
    const { runWizardFlagsReference } = await import('./wizard-flags-reference');
    const { runDemo } = await import('./index');
    vi.mocked(select).mockResolvedValueOnce('flags');

    await runDemo(new Command());

    expect(runWizardFlagsReference).toHaveBeenCalledOnce();
  });
});
