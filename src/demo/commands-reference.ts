// src/demo/commands-reference.ts
import type { Command } from 'commander';
import { note } from '@clack/prompts';

export interface CommandFlagInfo {
  flags: string;
  description: string;
}

export interface CommandInfo {
  name: string;
  description: string;
  flags: CommandFlagInfo[];
}

const ROOT_ACTION_DESCRIPTION =
  'The default action — no subcommand needed. Runs the interactive wizard, then scaffolds a new project ' +
  'in a directory named after your answers.';

export const ROOT_GLOBAL_FLAGS: CommandFlagInfo[] = [
  { flags: '--no-confetti', description: 'Skip the confetti after a successful run' },
  { flags: '--no-hook', description: 'Skip the post-scaffold hook, even if one is configured' },
];

export function collectCommandInfo(program: Command): CommandInfo[] {
  return program.commands.map((cmd) => ({
    name: cmd.name(),
    description: cmd.description(),
    flags: cmd.options.map((opt) => ({ flags: opt.flags, description: opt.description })),
  }));
}

function formatFlags(flags: CommandFlagInfo[]): string {
  return flags.map((f) => `  ${f.flags}  ${f.description}`).join('\n');
}

export async function runCommandsReference(program: Command): Promise<void> {
  const rootContent = [ROOT_ACTION_DESCRIPTION, formatFlags(ROOT_GLOBAL_FLAGS)].filter(Boolean).join('\n\n');
  note(rootContent, 'clispark (default action)');

  for (const info of collectCommandInfo(program)) {
    const content = [info.description, formatFlags(info.flags)].filter(Boolean).join('\n\n');
    note(content, `clispark ${info.name}`);
  }
}
