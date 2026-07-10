import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
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

export function createLogger(commandName: string, logDir: string = paths.log): LoggerHandle {
  mkdirSync(logDir, { recursive: true });

  const logFilePath = path.join(logDir, buildLogFileName(commandName));
  const logger = pino(pino.destination({ dest: logFilePath, sync: true }));

  return { logger, logFilePath };
}

export function withLogging(
  commandName: string,
  action: (logger: Logger) => Promise<void>,
  logDir: string = paths.log,
): () => Promise<void> {
  return async () => {
    const { logger, logFilePath } = createLogger(commandName, logDir);

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
