// templates/base/src/base-command.test.ts
import { describe, it, expect } from 'vitest';
import { runCommand } from '@oclif/test';

describe('BaseCommand failure/debug visibility', () => {
  it('prints the log file path on failure', async () => {
    const { error, stderr } = await runCommand('task');

    expect(error?.message).toContain('Missing 1 required arg');
    expect(stderr).toContain('Details:');
  });

  it('prints the log file path on success when DEBUG is set', async () => {
    process.env.DEBUG = '1';
    let stdout: string;
    try {
      ({ stdout } = await runCommand('hello'));
    } finally {
      delete process.env.DEBUG;
    }

    expect(stdout).toContain('Details:');
  });

  it('stays silent about the log path on success when DEBUG is unset', async () => {
    delete process.env.DEBUG;
    const { stdout } = await runCommand('hello');

    expect(stdout).not.toContain('Details:');
  });
});
