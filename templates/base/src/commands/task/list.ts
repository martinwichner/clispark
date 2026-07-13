// templates/base/src/commands/task/list.ts
import { Args } from '@oclif/core';
import { BaseCommand } from '../../base-command';

export default class TaskList extends BaseCommand {
  static description = 'List tasks (demonstrates a subcommand with two optional arguments of different types)';
  static args = {
    filter: Args.string({ required: false, description: 'Optional filter term' }),
    done: Args.boolean({ required: false, description: 'Only show completed tasks (true/false)' }),
  };
  static flags = {};

  async run(): Promise<void> {
    const { args } = await this.parse(TaskList);
    const base = args.filter ? `Listing tasks matching "${args.filter}"` : 'Listing all tasks';
    this.log(args.done !== undefined ? `${base} (completed only: ${args.done})` : base);
  }
}
