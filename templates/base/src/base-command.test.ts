// templates/base/src/base-command.test.ts
import { describe, it, expect } from 'vitest';
import { runCommand } from '@oclif/test';
import { Config } from '@oclif/core';
import Hello from './commands/hello';
import type { Logger } from 'pino';

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

interface TestableCommand {
  logger?: Logger;
  catch(err: unknown): Promise<unknown>;
  finally(err: Error | undefined): Promise<unknown>;
}

describe('BaseCommand hardened write calls', () => {
  it('does not propagate a throw from a failing logger write in catch() or finally()', async () => {
    const config = await Config.load(process.cwd());
    const hello = new Hello([], config);
    await hello.init();
    const cmd = hello as unknown as TestableCommand;

    const logger = cmd.logger as Logger;
    logger.info = (() => {
      throw new Error('disk full');
    }) as Logger['info'];
    logger.error = (() => {
      throw new Error('disk full');
    }) as Logger['error'];

    const originalError = new Error('boom');
    let catchRethrewOriginalError = false;
    try {
      await cmd.catch(originalError);
    } catch (caught) {
      catchRethrewOriginalError = caught === originalError;
    }
    expect(catchRethrewOriginalError).toBe(true);

    await expect(cmd.finally(undefined)).resolves.toBeUndefined();
  });
});
