import { randomBytes } from 'node:crypto';
import { mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import envPaths from 'env-paths';
import pino, { type Logger } from 'pino';

const paths = envPaths('clispark', { suffix: '' });

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

function sweepOldLogs(logDir: string): void {
  try {
    const cutoffMs = Date.now() - getRetentionDays() * 24 * 60 * 60 * 1000;
    for (const file of readdirSync(logDir)) {
      const filePath = path.join(logDir, file);
      if (statSync(filePath).mtimeMs < cutoffMs) {
        unlinkSync(filePath);
      }
    }
  } catch {
    // best-effort cleanup; a broken sweep must never block the actual command
  }
}

export function createLogger(commandName: string, logDir: string = paths.log): LoggerHandle {
  mkdirSync(logDir, { recursive: true });
  sweepOldLogs(logDir);

  const logFilePath = path.join(logDir, buildLogFileName(commandName));
  const fileDestination = pino.destination({ dest: logFilePath, sync: true, mode: 0o600 });
  const destination = process.env.DEBUG
    ? pino.multistream([{ stream: fileDestination }, { stream: process.stdout }])
    : fileDestination;
  const logger = pino({ redact: ['registryUrl', '*.registryUrl'] }, destination);

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
    try {
      logger.info({ command: commandName }, 'started');
    } catch {
      // best-effort logging; a write failure here must not abort a command that hasn't run yet
    }

    try {
      await action(logger);
      try {
        logger.info({ command: commandName }, 'completed');
      } catch {
        // best-effort logging; the command still succeeded
      }
      if (process.env.DEBUG) {
        console.log(`Details: ${logFilePath}`);
      }
    } catch (error) {
      try {
        logger.error({ command: commandName, err: error }, 'failed');
      } catch {
        // best-effort logging; never let a log-write failure mask the real error
      }
      const message = error instanceof Error ? error.message : String(error);
      console.error(`\n✖ ${message}`);
      console.error(`Details: ${logFilePath}`);
      process.exit(1);
    }
  };
}
