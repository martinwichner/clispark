import { randomBytes } from 'node:crypto';
import { mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import envPaths from 'env-paths';
import pino, { type Logger } from 'pino';

const paths = envPaths('clispark', { suffix: '' });

/** Runs fn, silently swallowing any error — for best-effort work that must never abort the caller. */
export function safely(fn: () => void): void {
  try {
    fn();
  } catch {
    // best-effort; a failure here must never affect the surrounding operation
  }
}

export interface LoggerHandle {
  logger: Logger;
  logFilePath: string;
}

function buildLogFileName(commandName: string): string {
  const timestamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
  const suffix = randomBytes(3).toString('hex');
  return `${commandName}-${timestamp}-${suffix}.log`;
}

function getRetentionDays(): number {
  const parsed = Number(process.env.LOG_RETENTION_DAYS);
  return Number.isFinite(parsed) ? parsed : 14;
}

// Common secret-shaped field names, redacted at the top level and one level of
// nesting (`*.<key>`). Edit this list directly if your own logging needs more.
export const SENSITIVE_LOG_KEYS = [
  'password',
  'secret',
  'token',
  'apiKey',
  'accessToken',
  'refreshToken',
  'clientSecret',
  'authorization',
];

function buildRedactPaths(keys: string[]): string[] {
  return keys.flatMap((key) => [key, `*.${key}`]);
}

const SWEEP_MARKER_FILE = '.last-sweep';
const SWEEP_THROTTLE_MS = 24 * 60 * 60 * 1000; // once a day is enough given day-granularity retention

function sweepOldLogs(logDir: string): void {
  safely(() => {
    const markerPath = path.join(logDir, SWEEP_MARKER_FILE);
    let shouldSweep = true;
    try {
      shouldSweep = Date.now() - statSync(markerPath).mtimeMs >= SWEEP_THROTTLE_MS;
    } catch {
      // no marker yet (first run in this directory) - sweep now
    }
    if (!shouldSweep) return;

    const cutoffMs = Date.now() - getRetentionDays() * 24 * 60 * 60 * 1000;
    for (const file of readdirSync(logDir)) {
      if (file === SWEEP_MARKER_FILE) continue;
      const filePath = path.join(logDir, file);
      if (statSync(filePath).mtimeMs < cutoffMs) {
        unlinkSync(filePath);
      }
    }
    writeFileSync(markerPath, '');
  });
}

export function createLogger(commandName: string, logDir: string = paths.log): LoggerHandle {
  mkdirSync(logDir, { recursive: true });
  sweepOldLogs(logDir);

  const logFilePath = path.join(logDir, buildLogFileName(commandName));
  const fileDestination = pino.destination({ dest: logFilePath, sync: true, mode: 0o600 });
  const destination = process.env.DEBUG
    ? pino.multistream([{ stream: fileDestination }, { stream: process.stdout }])
    : fileDestination;
  const logger = pino({ redact: buildRedactPaths([...SENSITIVE_LOG_KEYS, 'registryUrl']) }, destination);

  return { logger, logFilePath };
}

export function withLogging(
  commandName: string,
  action: (logger: Logger) => Promise<void>,
  logDir: string = paths.log,
  loggerFactory: typeof createLogger = createLogger,
): () => Promise<void> {
  return async () => {
    let handle: LoggerHandle;
    try {
      handle = loggerFactory(commandName, logDir);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`\n✖ ${message}`);
      process.exit(1);
      return;
    }

    const { logger, logFilePath } = handle;
    safely(() => logger.info({ command: commandName }, 'started'));

    try {
      await action(logger);
      safely(() => logger.info({ command: commandName }, 'completed'));
      if (process.env.DEBUG) {
        console.log(`Details: ${logFilePath}`);
      }
    } catch (error) {
      safely(() => logger.error({ command: commandName, err: error }, 'failed'));
      const message = error instanceof Error ? error.message : String(error);
      console.error(`\n✖ ${message}`);
      console.error(`Details: ${logFilePath}`);
      process.exit(1);
    }
  };
}
