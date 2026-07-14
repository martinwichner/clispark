// templates/base/src/logger.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFile, rm, mkdtemp } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createLogger } from './logger';

describe('createLogger', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(path.join(tmpdir(), 'clispark-template-logger-test-'));
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it('creates a timestamped log file for the given command inside the given directory', () => {
    const { logFilePath } = createLogger('hello', tmpRoot);

    expect(path.dirname(logFilePath)).toBe(tmpRoot);
    expect(path.basename(logFilePath)).toMatch(/^hello-.+\.log$/);
    expect(existsSync(logFilePath)).toBe(true);
  });

  it('creates the log directory if it does not exist yet', () => {
    const nestedDir = path.join(tmpRoot, 'nested', 'logs');

    const { logFilePath } = createLogger('hello', nestedDir);

    expect(existsSync(nestedDir)).toBe(true);
    expect(path.dirname(logFilePath)).toBe(nestedDir);
  });

  it('generates a distinct file for each call, even for the same command in the same millisecond', () => {
    const first = createLogger('hello', tmpRoot);
    const second = createLogger('hello', tmpRoot);

    expect(first.logFilePath).not.toBe(second.logFilePath);
  });

  it('writes structured JSON log entries to the file', async () => {
    const { logger, logFilePath } = createLogger('hello', tmpRoot);

    logger.info({ command: 'hello' }, 'started');
    await logger.flush();

    const content = await readFile(logFilePath, 'utf8');
    const entry = JSON.parse(content.trim().split('\n')[0]);
    expect(entry.msg).toBe('started');
    expect(entry.command).toBe('hello');
  });

  it('redacts registryUrl values, including one level of nesting', async () => {
    const { logger, logFilePath } = createLogger('hello', tmpRoot);

    logger.info(
      {
        registryUrl: 'https://registry.example.com/secret-token',
        nested: { registryUrl: 'https://nested.example.com/other-secret' },
      },
      'started',
    );
    await logger.flush();

    const content = await readFile(logFilePath, 'utf8');
    expect(content).not.toContain('secret-token');
    expect(content).not.toContain('nested.example.com');
    expect(content).toContain('[Redacted]');
  });

  it('sets the log file to owner-only read/write permissions (POSIX only)', () => {
    if (process.platform === 'win32') return;

    const { logFilePath } = createLogger('hello', tmpRoot);

    const mode = statSync(logFilePath).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});
