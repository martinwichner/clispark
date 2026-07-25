// templates/base/src/commands/task/complete.ts
import { Args } from '@oclif/core';
import { BaseCommand } from '../../base-command';

export default class TaskComplete extends BaseCommand {
  static description =
    'Complete a task (demonstrates a subcommand with a required integer argument)';
  static examples = [
    {
      command: '<%= config.bin %> task complete 1',
      description: 'Marks task 1 as complete',
    },
  ];
  static args = {
    id: Args.integer({ required: true, description: 'Task ID to complete' }),
  };
  static flags = {};

  async run(): Promise<void> {
    const { args } = await this.parse(TaskComplete);
    this.log(`Completed task ${args.id}`);
  }
}
