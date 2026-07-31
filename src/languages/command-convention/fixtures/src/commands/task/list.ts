import { BaseCommand } from '../../../base-command';

abstract class TaskCommandBase extends BaseCommand {}

export default class TaskList extends TaskCommandBase {
  async run(): Promise<void> {}
}
