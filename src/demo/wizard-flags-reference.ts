// src/demo/wizard-flags-reference.ts
import { note } from '@clack/prompts';
import { WIZARD_QUESTION_CATALOG } from '../wizard';

export async function runWizardFlagsReference(): Promise<void> {
  for (const entry of WIZARD_QUESTION_CATALOG) {
    note(`${entry.prompt}\n\n${entry.why}`, entry.id);
  }
}
