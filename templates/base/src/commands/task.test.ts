// templates/base/src/commands/task.test.ts
import { describe, it, expect } from 'vitest';
import { runCommand } from '@oclif/test';

describe('task', () => {
  it('creates a task with just a title', async () => {
    const { stdout } = await runCommand('task "Buy milk"');
    expect(stdout).toContain('Created task: "Buy milk"');
    expect(stdout).not.toContain('priority');
  });

  it('creates a task with a priority', async () => {
    const { stdout } = await runCommand('task "Buy milk" high');
    expect(stdout).toContain('Created task: "Buy milk" (priority: high)');
  });

  it('rejects a priority outside the allowed values', async () => {
    const { error } = await runCommand('task "Buy milk" urgent');
    expect(error?.message).toContain('Expected urgent to be one of: low, medium, high');
  });

  it('requires a title', async () => {
    const { error } = await runCommand('task');
    expect(error?.message).toContain('Missing 1 required arg');
  });

  it('shows usage examples in --help', async () => {
    const { stdout } = await runCommand('task --help');
    expect(stdout).toContain('EXAMPLES');
    expect(stdout).toContain('task "Buy milk"');
    expect(stdout).toContain('task "Buy milk" high');
  });
});
