// templates/base/src/base-command.ts
import { Command, type Interfaces } from '@oclif/core';
import type { Logger } from 'pino';
import { createLogger } from './logger';

export abstract class BaseCommand extends Command {
  protected logger?: Logger;
  protected logFilePath?: string;

  async init(): Promise<void> {
    await super.init();

    const { logger, logFilePath } = createLogger(this.id ?? 'unknown');
    this.logger = logger;
    this.logFilePath = logFilePath;
    try {
      this.logger.info({ command: this.id }, 'started');
    } catch {
      // best-effort logging; a write failure here must not abort a command that hasn't run yet
    }
  }

  protected async catch(err: Interfaces.CommandError): Promise<unknown> {
    try {
      this.logger?.error({ command: this.id, err }, 'failed');
    } catch {
      // best-effort logging; never let a log-write failure mask the real error
    }
    if (this.logFilePath) {
      console.error(`Details: ${this.logFilePath}`);
    }
    return super.catch(err);
  }

  protected async finally(err: Error | undefined): Promise<unknown> {
    if (!err) {
      try {
        this.logger?.info({ command: this.id }, 'completed');
      } catch {
        // best-effort logging; never let a log-write failure crash a successful run
      }
      if (process.env.DEBUG && this.logFilePath) {
        console.log(`Details: ${this.logFilePath}`);
      }
    }
    return super.finally(err);
  }
}
