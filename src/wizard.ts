// src/wizard.ts
import { intro, outro, text, log, isCancel, cancel } from '@clack/prompts';
import { select } from './prompt-utils';
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

  let commandConventionEnabled = false;
  if (lintEnabled) {
    const commandConventionEnabledValue = await select({
      message: 'Enforce command convention rule (BaseCommand / [CommandPath])?',
      options: [
        { value: false, label: 'No' },
        { value: true, label: 'Yes' },
      ],
      initialValue: false,
    });
    exitIfCancelled(commandConventionEnabledValue);
    commandConventionEnabled = commandConventionEnabledValue as boolean;
  }

  let autocompleteEnabled = false;
  if (pack.supportsAutocompleteOptIn) {
    const autocompleteEnabledValue = await select({
      message: 'Set up shell autocompletion?',
      options: [
        { value: false, label: 'No' },
        { value: true, label: 'Yes' },
      ],
      initialValue: false,
    });
    exitIfCancelled(autocompleteEnabledValue);
    autocompleteEnabled = autocompleteEnabledValue as boolean;
  }

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

  return {
    language: pack.id,
    projectName,
    profile,
    registryUrl,
    publishIntent,
    nameAvailability,
    lintEnabled,
    autocompleteEnabled,
    commandConventionEnabled,
  };
}

export interface WizardQuestionCatalogEntry {
  id: string;
  prompt: string;
  why: string;
}

// Read by `clispark demo`'s wizard-flags reference mode (src/demo/wizard-flags-reference.ts).
// This is a deliberate, colocated-but-manually-maintained list, not automatic introspection --
// wizard.ts's control flow is sequential and conditionally branching, not a declarative array.
// When you add a new wizard question here, add its entry below too -- src/wizard.test.ts has a
// regression test that runs the real wizard and checks the prompt count against this array's
// length, so a forgotten entry (or a removed question left behind here) fails that test.
export const WIZARD_QUESTION_CATALOG: WizardQuestionCatalogEntry[] = [
  {
    id: 'language',
    prompt: 'Which language?',
    why: 'Picks which LanguagePack scaffolds the project — Node/oclif, .NET/System.CommandLine, or PowerShell. Everything downstream (registry, lint tooling, autocompletion) adapts to this choice.',
  },
  {
    id: 'projectName',
    prompt: 'Project name',
    why: 'Becomes the package/tool name and the directory clispark scaffolds into. Validated per-language (lowercase-hyphenated for Node, PascalCase for .NET).',
  },
  {
    id: 'profile',
    prompt: 'Is this a work or private project?',
    why: '"work" unlocks a custom registry URL question next, for projects that need to publish to a private company registry instead of the public one.',
  },
  {
    id: 'registryUrl',
    prompt: 'Custom registry URL (e.g. "Custom npm registry URL (leave empty for npmjs.org)")',
    why: 'Only asked if you chose a work project. Defaults to the public registry (npmjs.org / nuget.org) if left empty.',
  },
  {
    id: 'publishIntent',
    prompt: 'Do you plan to publish this?',
    why: 'If yes, clispark checks your chosen project name is actually available on the registry before scaffolding, and lets you pick a different name if it is taken.',
  },
  {
    id: 'lintEnabled',
    prompt: 'Set up lint tooling?',
    why: 'Opt-in ESLint + Prettier (Node) or broadened Roslyn analyzers (.NET), tracked as core-managed so `clispark update` keeps it current. Declined by default so a minimal scaffold stays minimal.',
  },
  {
    id: 'commandConventionEnabled',
    prompt: 'Enforce command convention rule (BaseCommand / [CommandPath])?',
    why: 'Only asked when lint tooling is set up. Opt-in lint rule (Node ESLint) or Roslyn analyzer (.NET) that fails the build when a command class skips the shared base-command/attribute convention, catching commands that bypass shared logging/error-handling.',
  },
  {
    id: 'autocompleteEnabled',
    prompt: 'Set up shell autocompletion?',
    why: 'Only asked for languages that need a scaffolding choice (Node) — PowerShell tab-completion is built-in with zero setup, and .NET completion is already wired in but needs a one-time dotnet-suggest setup rather than a scaffolding toggle. Wires up @oclif/plugin-autocomplete when accepted.',
  },
];
