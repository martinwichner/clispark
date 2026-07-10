import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createLogger, withLogging } from './logger.js';

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
});
