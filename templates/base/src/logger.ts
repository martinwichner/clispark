// templates/base/src/logger.ts
import { randomBytes } from 'node:crypto';
import { mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
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
  try {
    const markerPath = path.join(logDir, SWEEP_MARKER_FILE);
    try {
      if (Date.now() - statSync(markerPath).mtimeMs < SWEEP_THROTTLE_MS) return;
    } catch {
      // no marker yet (first run in this directory) - sweep now
    }

    const cutoffMs = Date.now() - getRetentionDays() * 24 * 60 * 60 * 1000;
    for (const file of readdirSync(logDir)) {
      if (file === SWEEP_MARKER_FILE) continue;
      const filePath = path.join(logDir, file);
      if (statSync(filePath).mtimeMs < cutoffMs) {
        unlinkSync(filePath);
      }
    }
    writeFileSync(markerPath, '');
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
  const logger = pino({ redact: buildRedactPaths(SENSITIVE_LOG_KEYS) }, destination);

  return { logger, logFilePath };
}
