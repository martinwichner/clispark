// templates/base/src/commands/task/complete.test.ts
import { describe, it, expect } from 'vitest';
import { runCommand } from '@oclif/test';

describe('task complete', () => {
  it('completes a task by numeric id', async () => {
    const { stdout } = await runCommand('task complete 42');
    expect(stdout).toContain('Completed task 42');
  });

  it('rejects a non-numeric id', async () => {
    const { error } = await runCommand('task complete abc');
    expect(error?.message).toContain('Expected an integer but received: abc');
  });

  it('requires an id', async () => {
    const { error } = await runCommand('task complete');
    expect(error?.message).toContain('Missing 1 required arg');
  });

  it('shows a usage example in --help', async () => {
    const { stdout } = await runCommand('task complete --help');
    expect(stdout).toContain('EXAMPLES');
    expect(stdout).toContain('task complete 1');
  });
});
