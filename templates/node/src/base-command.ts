// templates/base/src/base-command.ts
import { Command, type Interfaces } from '@oclif/core';
import type { Logger } from 'pino';
import { createLogger, safely } from './logger';

export abstract class BaseCommand extends Command {
  protected logger?: Logger;
  protected logFilePath?: string;

  async init(): Promise<void> {
    await super.init();

    const { logger, logFilePath } = createLogger(this.id ?? 'unknown');
    this.logger = logger;
    this.logFilePath = logFilePath;
    safely(() => this.logger?.info({ command: this.id }, 'started'));
  }

  protected async catch(err: Interfaces.CommandError): Promise<unknown> {
    safely(() => this.logger?.error({ command: this.id, err }, 'failed'));
    if (this.logFilePath) {
      console.error(`Details: ${this.logFilePath}`);
    }
    return super.catch(err);
  }

  protected async finally(err: Error | undefined): Promise<unknown> {
    if (!err) {
      safely(() => this.logger?.info({ command: this.id }, 'completed'));
      if (process.env.DEBUG && this.logFilePath) {
        console.log(`Details: ${this.logFilePath}`);
      }
    }
    return super.finally(err);
  }
}
