// templates/base/src/logger.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFile, rm, mkdtemp, writeFile, utimes } from 'node:fs/promises';
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

  it('deletes log files older than the default 14-day retention window', async () => {
    const oldFilePath = path.join(tmpRoot, 'old-hello.log');
    const newFilePath = path.join(tmpRoot, 'new-hello.log');
    await writeFile(oldFilePath, '{}');
    await writeFile(newFilePath, '{}');
    const fifteenDaysAgo = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);
    await utimes(oldFilePath, fifteenDaysAgo, fifteenDaysAgo);

    createLogger('hello', tmpRoot);

    expect(existsSync(oldFilePath)).toBe(false);
    expect(existsSync(newFilePath)).toBe(true);
  });

  it('honors a LOG_RETENTION_DAYS override', async () => {
    const filePath = path.join(tmpRoot, 'three-days-old.log');
    await writeFile(filePath, '{}');
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    await utimes(filePath, threeDaysAgo, threeDaysAgo);

    process.env.LOG_RETENTION_DAYS = '1';
    try {
      createLogger('hello', tmpRoot);
    } finally {
      delete process.env.LOG_RETENTION_DAYS;
    }

    expect(existsSync(filePath)).toBe(false);
  });

  it('falls back to the 14-day default when LOG_RETENTION_DAYS is not a number', async () => {
    const filePath = path.join(tmpRoot, 'five-days-old.log');
    await writeFile(filePath, '{}');
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    await utimes(filePath, fiveDaysAgo, fiveDaysAgo);

    process.env.LOG_RETENTION_DAYS = 'not-a-number';
    try {
      createLogger('hello', tmpRoot);
    } finally {
      delete process.env.LOG_RETENTION_DAYS;
    }

    expect(existsSync(filePath)).toBe(true);
  });

  it('streams log lines to stdout when DEBUG is set', async () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    process.env.DEBUG = '1';

    try {
      const { logger } = createLogger('hello', tmpRoot);
      logger.info({ command: 'hello' }, 'started');
      await new Promise<void>((resolve) => logger.flush(() => resolve()));
    } finally {
      delete process.env.DEBUG;
    }

    const written = writeSpy.mock.calls.map((call) => String(call[0])).join('');
    expect(written).toContain('started');
    writeSpy.mockRestore();
  });

  it('does not stream to stdout when DEBUG is unset', async () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    delete process.env.DEBUG;

    const { logger } = createLogger('hello', tmpRoot);
    logger.info({ command: 'hello' }, 'started');
    await new Promise<void>((resolve) => logger.flush(() => resolve()));

    expect(writeSpy).not.toHaveBeenCalled();
    writeSpy.mockRestore();
  });
});
