import { describe, it, expect } from 'vitest';
import { createProgram } from './program';

describe('createProgram', () => {
  it('registers all expected subcommands with non-empty descriptions', () => {
    const program = createProgram();
    const names = program.commands.map((cmd) => cmd.name());
    expect(names).toEqual(['update', 'releasenotes', 'add', 'whoami', 'hook']);
    for (const cmd of program.commands) {
      expect(cmd.description().length).toBeGreaterThan(0);
    }
  });

  it('returns a fresh, independent Command instance on every call', () => {
    const first = createProgram();
    const second = createProgram();
    expect(first).not.toBe(second);

    first.command('temp-marker');
    expect(second.commands.map((cmd) => cmd.name())).not.toContain('temp-marker');
  });
});
