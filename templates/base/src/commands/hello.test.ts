// templates/base/src/commands/hello.test.ts
import { describe, it, expect } from 'vitest';
import { runCommand } from '@oclif/test';

describe('hello', () => {
  it('prints a greeting', async () => {
    const { stdout } = await runCommand('hello');
    expect(stdout).toContain('Hello from your new CLI!');
  });
});
