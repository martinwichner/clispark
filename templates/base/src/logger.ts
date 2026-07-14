// templates/base/src/logger.ts
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import envPaths from 'env-paths';
import pino, { type Logger } from 'pino';

const paths = envPaths('{{projectName}}', { suffix: '' });

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
  const logger = pino(
    { redact: ['registryUrl', '*.registryUrl'] },
    pino.destination({ dest: logFilePath, sync: true, mode: 0o600 }),
  );

  return { logger, logFilePath };
}
