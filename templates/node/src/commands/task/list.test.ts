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

  it('combines a filter with the --done flag', async () => {
    const { stdout } = await runCommand('task list groceries --done');
    expect(stdout).toContain('Listing tasks matching "groceries" (completed only: true)');
  });

  it('omits the completed-only note when --done is not passed', async () => {
    const { stdout } = await runCommand('task list groceries');
    expect(stdout).not.toContain('completed only');
  });

  it('shows usage examples in --help', async () => {
    const { stdout } = await runCommand('task list --help');
    expect(stdout).toContain('EXAMPLES');
    expect(stdout).toContain('task list');
    expect(stdout).toContain('task list groceries');
    expect(stdout).toContain('task list groceries --done');
  });
});
