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
  const logger = pino(
    { redact: ['registryUrl', '*.registryUrl'] },
    pino.destination({ dest: logFilePath, sync: true, mode: 0o600 }),
  );

  return { logger, logFilePath };
}

export function withLogging(
  commandName: string,
  action: (logger: Logger) => Promise<void>,
  logDir: string = paths.log,
): () => Promise<void> {
  return async () => {
    let handle: LoggerHandle;
    try {
      handle = createLogger(commandName, logDir);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`\n✖ ${message}`);
      process.exit(1);
      return;
    }

    const { logger, logFilePath } = handle;
    logger.info({ command: commandName }, 'started');

    try {
      await action(logger);
      logger.info({ command: commandName }, 'completed');
    } catch (error) {
      logger.error({ command: commandName, err: error }, 'failed');
      const message = error instanceof Error ? error.message : String(error);
      console.error(`\n✖ ${message}`);
      console.error(`Details: ${logFilePath}`);
      process.exit(1);
    }
  };
}
