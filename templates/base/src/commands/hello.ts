// templates/base/src/commands/hello.ts
import { BaseCommand } from '../base-command.js';

export default class Hello extends BaseCommand {
  static description = 'Say hello';
  static args = {};
  static flags = {};

  async run(): Promise<void> {
    await this.parse(Hello);
    this.log('Hello from your new CLI!');
  }
}
