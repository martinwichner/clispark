// src/wizard.ts
import { intro, outro, text, select, log, isCancel, cancel } from '@clack/prompts';
import { checkPackageNameAvailability, DEFAULT_REGISTRY_URL } from './registry.js';
import type { Profile, WizardAnswers } from './types.js';

export interface WizardDeps {
  checkAvailability: typeof checkPackageNameAvailability;
}

const defaultDeps: WizardDeps = {
  checkAvailability: checkPackageNameAvailability,
};

function exitIfCancelled(value: unknown): void {
  if (isCancel(value)) {
    cancel('Operation cancelled.');
    process.exit(1);
  }
}

function validateProjectName(value: string): string | undefined {
  if (!value || value.trim().length === 0) return 'Project name is required.';
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(value)) {
    return 'Use lowercase letters and numbers, with single hyphens between words (no leading, trailing, or repeated hyphens).';
  }
  return undefined;
}

export async function runWizard(deps: WizardDeps = defaultDeps): Promise<WizardAnswers> {
  intro('clispark — scaffold a new CLI project');

  const nameValue = await text({
    message: 'Project name',
    validate: validateProjectName,
  });
  exitIfCancelled(nameValue);
  let projectName = nameValue as string;

  const profileValue = await select({
    message: 'Is this a work or private project?',
    options: [
      { value: 'private', label: 'Private' },
      { value: 'work', label: 'Work' },
    ],
  });
  exitIfCancelled(profileValue);
  const profile = profileValue as Profile;

  let registryUrl = DEFAULT_REGISTRY_URL;
  if (profile === 'work') {
    const registryValue = await text({
      message: 'Custom npm registry URL (leave empty for npmjs.org)',
      placeholder: DEFAULT_REGISTRY_URL,
      defaultValue: DEFAULT_REGISTRY_URL,
    });
    exitIfCancelled(registryValue);
    registryUrl = (registryValue as string) || DEFAULT_REGISTRY_URL;
  }

  let nameAvailability = await deps.checkAvailability(projectName, registryUrl);

  while (nameAvailability === 'taken') {
    log.warn(`"${projectName}" is already taken on ${registryUrl}. Please choose a different name.`);

    const retryValue = await text({
      message: 'Project name',
      validate: validateProjectName,
    });
    exitIfCancelled(retryValue);
    projectName = retryValue as string;

    nameAvailability = await deps.checkAvailability(projectName, registryUrl);
  }

  if (nameAvailability === 'unverified') {
    log.warn(`Could not verify availability of "${projectName}" on ${registryUrl}. Continuing anyway.`);
  }

  outro(`Ready to scaffold "${projectName}".`);

  return { projectName, profile, registryUrl, nameAvailability };
}
