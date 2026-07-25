// templates/base/src/commands/task/list.ts
import { Args, Flags } from '@oclif/core';
import { BaseCommand } from '../../base-command';

export default class TaskList extends BaseCommand {
  static description =
    'List tasks (demonstrates an optional argument combined with a boolean flag)';
  static examples = [
    {
      command: '<%= config.bin %> task list',
      description: 'Lists all tasks',
    },
    {
      command: '<%= config.bin %> task list groceries',
      description: 'Lists tasks matching a filter term',
    },
    {
      command: '<%= config.bin %> task list groceries --done',
      description: 'Lists tasks matching a filter, showing only completed ones',
    },
  ];
  static args = {
    filter: Args.string({
      required: false,
      description: 'Optional filter term',
    }),
  };
  static flags = {
    done: Flags.boolean({ description: 'Only show completed tasks' }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(TaskList);
    const base = args.filter
      ? `Listing tasks matching "${args.filter}"`
      : 'Listing all tasks';
    this.log(flags.done ? `${base} (completed only: true)` : base);
  }
}
