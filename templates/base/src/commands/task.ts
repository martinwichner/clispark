// templates/base/src/commands/task.ts
import { Args } from '@oclif/core';
import { BaseCommand } from '../base-command';

export default class Task extends BaseCommand {
  static description = 'Create a task (demonstrates a required string arg and an optional enum-constrained arg)';
  static args = {
    title: Args.string({ required: true, description: 'Task title' }),
    priority: Args.string({
      required: false,
      options: ['low', 'medium', 'high'],
      description: 'Optional priority',
    }),
  };
  static flags = {};

  async run(): Promise<void> {
    const { args } = await this.parse(Task);
    this.log(`Created task: "${args.title}"${args.priority ? ` (priority: ${args.priority})` : ''}`);
  }
}
