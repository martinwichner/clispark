export abstract class Command {
  abstract run(): Promise<void>;
}

export abstract class BaseCommand extends Command {}
