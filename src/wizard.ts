// src/wizard.ts
import { intro, outro, text, select, log, isCancel, cancel } from '@clack/prompts';
import { LANGUAGE_PACKS } from './languages';
import type { LanguagePack } from './languages/pack';
import type { NameCheckResult } from './languages/registry-checker';
import type { Profile, WizardAnswers } from './types';

export interface WizardDeps {
  languagePacks: Record<string, LanguagePack>;
}

const defaultDeps: WizardDeps = {
  languagePacks: LANGUAGE_PACKS,
};

function exitIfCancelled(value: unknown): void {
  if (isCancel(value)) {
    cancel('Operation cancelled.');
    process.exit(1);
  }
}

export async function runWizard(deps: WizardDeps = defaultDeps): Promise<WizardAnswers> {
  intro('clispark — scaffold a new CLI project');

  const packs = Object.values(deps.languagePacks);
  const languageValue = await select({
    message: 'Which language?',
    options: packs.map((pack) => ({ value: pack.id, label: pack.displayName })),
  });
  exitIfCancelled(languageValue);
  const pack = deps.languagePacks[languageValue as string];

  const nameValue = await text({
    message: 'Project name',
    validate: pack.validateProjectName,
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

  let registryUrl = pack.registry.defaultUrl;
  if (profile === 'work') {
    const registryValue = await text({
      message: pack.registry.promptLabel,
      placeholder: pack.registry.defaultUrl,
      defaultValue: pack.registry.defaultUrl,
    });
    exitIfCancelled(registryValue);
    registryUrl = (registryValue as string) || pack.registry.defaultUrl;
  }

  const publishIntentValue = await select({
    message: 'Do you plan to publish this?',
    options: [
      { value: false, label: 'No' },
      { value: true, label: 'Yes' },
    ],
    initialValue: false,
  });
  exitIfCancelled(publishIntentValue);
  const publishIntent = publishIntentValue as boolean;

  const lintEnabledValue = await select({
    message: 'Set up lint tooling?',
    options: [
      { value: false, label: 'No' },
      { value: true, label: 'Yes' },
    ],
    initialValue: false,
  });
  exitIfCancelled(lintEnabledValue);
  const lintEnabled = lintEnabledValue as boolean;

  let nameAvailability: NameCheckResult = 'skipped';

  if (publishIntent) {
    nameAvailability = await pack.registry.checkNameAvailability(projectName, registryUrl);

    while (nameAvailability === 'taken') {
      log.warn(`"${projectName}" is already taken on ${registryUrl}. Please choose a different name.`);

      const retryValue = await text({
        message: 'Project name',
        validate: pack.validateProjectName,
      });
      exitIfCancelled(retryValue);
      projectName = retryValue as string;

      nameAvailability = await pack.registry.checkNameAvailability(projectName, registryUrl);
    }

    if (nameAvailability === 'unverified') {
      log.warn(`Could not verify availability of "${projectName}" on ${registryUrl}. Continuing anyway.`);
    }
  }

  outro(`Ready to scaffold "${projectName}".`);

  return { language: pack.id, projectName, profile, registryUrl, publishIntent, nameAvailability, lintEnabled };
}
