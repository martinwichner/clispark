import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, writeFile, utimes } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Logger } from 'pino';
import { createLogger, withLogging } from './logger';

describe('createLogger', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(path.join(tmpdir(), 'clispark-logger-test-'));
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it('creates a timestamped log file for the given command inside the given directory', () => {
    const { logFilePath } = createLogger('scaffold', tmpRoot);

    expect(path.dirname(logFilePath)).toBe(tmpRoot);
    expect(path.basename(logFilePath)).toMatch(/^scaffold-.+\.log$/);
    expect(existsSync(logFilePath)).toBe(true);
  });

  it('creates the log directory if it does not exist yet', () => {
    const nestedDir = path.join(tmpRoot, 'nested', 'logs');

    const { logFilePath } = createLogger('scaffold', nestedDir);

    expect(existsSync(nestedDir)).toBe(true);
    expect(path.dirname(logFilePath)).toBe(nestedDir);
  });

  it('generates a distinct file for each call, even for the same command in the same millisecond', () => {
    const first = createLogger('scaffold', tmpRoot);
    const second = createLogger('scaffold', tmpRoot);

    expect(first.logFilePath).not.toBe(second.logFilePath);
  });

  it('writes structured JSON log entries to the file', async () => {
    const { logger, logFilePath } = createLogger('scaffold', tmpRoot);

    logger.info({ projectName: 'my-cli' }, 'scaffold started');
    await logger.flush();

    const content = await readFile(logFilePath, 'utf8');
    const entry = JSON.parse(content.trim().split('\n')[0]);
    expect(entry.msg).toBe('scaffold started');
    expect(entry.projectName).toBe('my-cli');
  });

  it('redacts registryUrl values, including one level of nesting', async () => {
    const { logger, logFilePath } = createLogger('scaffold', tmpRoot);

    logger.info(
      {
        registryUrl: 'https://registry.example.com/secret-token',
        nested: { registryUrl: 'https://nested.example.com/other-secret' },
      },
      'scaffold started',
    );
    await logger.flush();

    const content = await readFile(logFilePath, 'utf8');
    expect(content).not.toContain('secret-token');
    expect(content).not.toContain('nested.example.com');
    expect(content).toContain('[Redacted]');
  });

  it('redacts generic secret-shaped fields, including one level of nesting', async () => {
    const { logger, logFilePath } = createLogger('scaffold', tmpRoot);

    logger.info(
      {
        token: 'ghp_super-secret-value',
        nested: { apiKey: 'sk-another-secret-value' },
      },
      'scaffold started',
    );
    await logger.flush();

    const content = await readFile(logFilePath, 'utf8');
    expect(content).not.toContain('ghp_super-secret-value');
    expect(content).not.toContain('sk-another-secret-value');
    expect(content).toContain('[Redacted]');
  });

  it('sets the log file to owner-only read/write permissions (POSIX only)', () => {
    if (process.platform === 'win32') return;

    const { logFilePath } = createLogger('scaffold', tmpRoot);

    const mode = statSync(logFilePath).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('deletes log files older than the default 14-day retention window', async () => {
    const oldFilePath = path.join(tmpRoot, 'old-scaffold.log');
    const newFilePath = path.join(tmpRoot, 'new-scaffold.log');
    await writeFile(oldFilePath, '{}');
    await writeFile(newFilePath, '{}');
    const fifteenDaysAgo = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);
    await utimes(oldFilePath, fifteenDaysAgo, fifteenDaysAgo);

    createLogger('scaffold', tmpRoot);

    expect(existsSync(oldFilePath)).toBe(false);
    expect(existsSync(newFilePath)).toBe(true);
  });

  it('throttles the sweep: a second call within the same day does not re-scan for newly-aged files', async () => {
    const firstOldFile = path.join(tmpRoot, 'first-old.log');
    await writeFile(firstOldFile, '{}');
    const fifteenDaysAgo = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);
    await utimes(firstOldFile, fifteenDaysAgo, fifteenDaysAgo);

    createLogger('scaffold', tmpRoot);
    expect(existsSync(firstOldFile)).toBe(false); // first call always sweeps (no marker yet)

    const secondOldFile = path.join(tmpRoot, 'second-old.log');
    await writeFile(secondOldFile, '{}');
    await utimes(secondOldFile, fifteenDaysAgo, fifteenDaysAgo);

    createLogger('scaffold', tmpRoot);
    expect(existsSync(secondOldFile)).toBe(true); // throttled: no sweep this time

    const markerPath = path.join(tmpRoot, '.last-sweep');
    const overADayAgo = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await utimes(markerPath, overADayAgo, overADayAgo);

    createLogger('scaffold', tmpRoot);
    expect(existsSync(secondOldFile)).toBe(false); // throttle window elapsed: sweeps again
  });

  it('honors a LOG_RETENTION_DAYS override', async () => {
    const filePath = path.join(tmpRoot, 'three-days-old.log');
    await writeFile(filePath, '{}');
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    await utimes(filePath, threeDaysAgo, threeDaysAgo);

    process.env.LOG_RETENTION_DAYS = '1';
    try {
      createLogger('scaffold', tmpRoot);
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
      createLogger('scaffold', tmpRoot);
    } finally {
      delete process.env.LOG_RETENTION_DAYS;
    }

    expect(existsSync(filePath)).toBe(true);
  });

  it('streams log lines to stdout when DEBUG is set', async () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    process.env.DEBUG = '1';

    try {
      const { logger } = createLogger('scaffold', tmpRoot);
      logger.info({ command: 'scaffold' }, 'started');
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

    const { logger } = createLogger('scaffold', tmpRoot);
    logger.info({ command: 'scaffold' }, 'started');
    await new Promise<void>((resolve) => logger.flush(() => resolve()));

    expect(writeSpy).not.toHaveBeenCalled();
    writeSpy.mockRestore();
  });
});

describe('withLogging', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(path.join(tmpdir(), 'clispark-logger-test-'));
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it('runs the action and does not exit the process on success', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const action = vi.fn(async () => {});

    const wrapped = withLogging('scaffold', action, tmpRoot);
    await wrapped();

    expect(action).toHaveBeenCalledTimes(1);
    expect(exitSpy).not.toHaveBeenCalled();

    exitSpy.mockRestore();
  });

  it('prints a clean error and exits when logger setup itself fails, without a raw stack trace', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const action = vi.fn(async () => {});

    // Create a file where the log directory should be, so mkdirSync fails (setup error, not an action error).
    const blockingFilePath = path.join(tmpRoot, 'blocking-file');
    await writeFile(blockingFilePath, 'x');
    const invalidLogDir = path.join(blockingFilePath, 'nested');

    const wrapped = withLogging('scaffold', action, invalidLogDir);
    await wrapped();

    expect(action).not.toHaveBeenCalled();
    const printedLines = errorSpy.mock.calls.map((call) => String(call[0]));
    expect(printedLines.some((line) => line.includes('✖'))).toBe(true);
    expect(printedLines.every((line) => !line.includes('at ') && !line.includes('.js:'))).toBe(true);
    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('prints a clean one-line error message and exits with code 1 on failure, without a raw stack trace', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const action = vi.fn(async () => {
      throw new Error('npm install failed');
    });

    const wrapped = withLogging('scaffold', action, tmpRoot);
    await wrapped();

    const printedLines = errorSpy.mock.calls.map((call) => String(call[0]));
    expect(printedLines.some((line) => line.includes('✖ npm install failed'))).toBe(true);
    expect(printedLines.some((line) => line.includes('Details:'))).toBe(true);
    expect(printedLines.every((line) => !line.includes('at ') && !line.includes('.js:'))).toBe(true);
    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('logs the full error, including a stack, to the log file on failure', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const action = vi.fn(async () => {
      throw new Error('npm install failed');
    });

    const wrapped = withLogging('scaffold', action, tmpRoot);
    await wrapped();

    const files = await import('node:fs/promises').then((fs) => fs.readdir(tmpRoot));
    const logFile = files.find((f) => f.startsWith('scaffold-'));
    expect(logFile).toBeDefined();

    const content = await readFile(path.join(tmpRoot, logFile as string), 'utf8');
    expect(content).toContain('npm install failed');
    expect(content).toContain('"level":50');

    exitSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it('prints the log file path on success when DEBUG is set', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const action = vi.fn(async () => {});
    process.env.DEBUG = '1';

    try {
      const wrapped = withLogging('scaffold', action, tmpRoot);
      await wrapped();
    } finally {
      delete process.env.DEBUG;
    }

    const printedLines = logSpy.mock.calls.map((call) => String(call[0]));
    expect(printedLines.some((line) => line.includes('Details:'))).toBe(true);

    exitSpy.mockRestore();
    logSpy.mockRestore();
    writeSpy.mockRestore();
  });

  it('stays silent on success when DEBUG is unset', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const action = vi.fn(async () => {});
    delete process.env.DEBUG;

    const wrapped = withLogging('scaffold', action, tmpRoot);
    await wrapped();

    expect(logSpy).not.toHaveBeenCalled();

    exitSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('does not propagate a throw from a failing logger write on success', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const action = vi.fn(async () => {});
    const throwingLoggerFactory: typeof createLogger = (commandName, logDir) => {
      const handle = createLogger(commandName, logDir);
      handle.logger.info = (() => {
        throw new Error('disk full');
      }) as Logger['info'];
      return handle;
    };

    const wrapped = withLogging('scaffold', action, tmpRoot, throwingLoggerFactory);
    await expect(wrapped()).resolves.toBeUndefined();

    expect(action).toHaveBeenCalledTimes(1);
    expect(exitSpy).not.toHaveBeenCalled();

    exitSpy.mockRestore();
  });

  it('does not propagate a throw from a failing logger write on failure, and still prints the clean error', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const action = vi.fn(async () => {
      throw new Error('npm install failed');
    });
    const throwingLoggerFactory: typeof createLogger = (commandName, logDir) => {
      const handle = createLogger(commandName, logDir);
      handle.logger.error = (() => {
        throw new Error('disk full');
      }) as Logger['error'];
      return handle;
    };

    const wrapped = withLogging('scaffold', action, tmpRoot, throwingLoggerFactory);
    await wrapped();

    const printedLines = errorSpy.mock.calls.map((call) => String(call[0]));
    expect(printedLines.some((line) => line.includes('✖ npm install failed'))).toBe(true);
    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
