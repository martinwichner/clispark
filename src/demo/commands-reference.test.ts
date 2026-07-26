import { describe, it, expect, vi } from 'vitest';
import { Command } from 'commander';

describe('collectCommandInfo', () => {
  it('reads name, description, and options off each registered subcommand', async () => {
    const { collectCommandInfo } = await import('./commands-reference');
    const program = new Command();
    program.command('whoami').description('A little something extra').option('--joke', 'Always show a joke');
    program.command('hook').description('Show the post-scaffold hook file location and whether one is configured');

    expect(collectCommandInfo(program)).toEqual([
      {
        name: 'whoami',
        description: 'A little something extra',
        flags: [{ flags: '--joke', description: 'Always show a joke' }],
      },
      {
        name: 'hook',
        description: 'Show the post-scaffold hook file location and whether one is configured',
        flags: [],
      },
    ]);
  });
});

vi.mock('@clack/prompts', () => ({ note: vi.fn() }));

describe('runCommandsReference', () => {
  it('shows the root default action and every registered subcommand', async () => {
    const { note } = await import('@clack/prompts');
    const { runCommandsReference } = await import('./commands-reference');
    const program = new Command();
    program.command('whoami').description('A little something extra').option('--joke', 'Always show a joke');

    await runCommandsReference(program);

    const calls = vi.mocked(note).mock.calls;
    const titles = calls.map(([, title]) => title);
    expect(titles).toContain('clispark (default action)');
    expect(titles).toContain('clispark whoami');

    // Verify the flag actually appears in the rendered content for whoami
    const whoamiCall = calls.find(([, title]) => title === 'clispark whoami');
    expect(whoamiCall).toBeDefined();
    const whoamiContent = whoamiCall?.[0];
    expect(whoamiContent).toContain('--joke');
    expect(whoamiContent).toContain('Always show a joke');
  });
});
