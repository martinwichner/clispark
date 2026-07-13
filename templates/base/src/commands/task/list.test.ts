// templates/base/src/commands/task/list.test.ts
import { describe, it, expect } from 'vitest';
import { runCommand } from '@oclif/test';

describe('task list', () => {
  it('lists all tasks with no args', async () => {
    const { stdout } = await runCommand('task list');
    expect(stdout).toContain('Listing all tasks');
  });

  it('lists tasks matching a filter', async () => {
    const { stdout } = await runCommand('task list groceries');
    expect(stdout).toContain('Listing tasks matching "groceries"');
  });

  it('combines a filter with the done flag', async () => {
    const { stdout } = await runCommand('task list groceries true');
    expect(stdout).toContain('Listing tasks matching "groceries" (completed only: true)');
  });

  it('parses "no" as false for the done arg', async () => {
    const { stdout } = await runCommand('task list groceries no');
    expect(stdout).toContain('(completed only: false)');
  });
});
