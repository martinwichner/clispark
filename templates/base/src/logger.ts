// templates/base/src/logger.ts
import { randomBytes } from 'node:crypto';
import { mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
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
