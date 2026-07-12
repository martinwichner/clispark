// templates/base/src/base-command.ts
import { Command, type Interfaces } from '@oclif/core';
import type { Logger } from 'pino';
import { createLogger } from './logger';

export abstract class BaseCommand extends Command {
  protected logger?: Logger;

  async init(): Promise<void> {
    await super.init();

    const { logger } = createLogger(this.id ?? 'unknown');
    this.logger = logger;
    this.logger.info({ command: this.id }, 'started');
  }

  protected async catch(err: Interfaces.CommandError): Promise<unknown> {
    this.logger?.error({ command: this.id, err }, 'failed');
    return super.catch(err);
  }

  protected async finally(err: Error | undefined): Promise<unknown> {
    if (!err) {
      this.logger?.info({ command: this.id }, 'completed');
    }
    return super.finally(err);
  }
}
