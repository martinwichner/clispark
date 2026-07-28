// src/demo/index.ts
import type { Command } from 'commander';
import { intro, outro, isCancel, cancel } from '@clack/prompts';
import { select } from '../prompt-utils';
import { runFullWalkthrough } from './full-walkthrough';
import { runCommandsReference } from './commands-reference';
import { runWizardFlagsReference } from './wizard-flags-reference';

function exitIfCancelled(value: unknown): void {
  if (isCancel(value)) {
    cancel('Operation cancelled.');
    process.exit(1);
  }
}

export async function runDemo(program: Command): Promise<void> {
  intro('clispark demo');

  const mode = await select({
    message: 'What do you want to see?',
    options: [
      { value: 'full', label: 'Complete walkthrough' },
      { value: 'commands', label: 'Just the commands' },
      { value: 'flags', label: 'Just the wizard flags' },
    ],
  });
  exitIfCancelled(mode);

  if (mode === 'full') {
    await runFullWalkthrough();
  } else if (mode === 'commands') {
    await runCommandsReference(program);
  } else {
    await runWizardFlagsReference();
  }

  outro("That's clispark in a nutshell — run `npx clispark` for real whenever you're ready.");
}
