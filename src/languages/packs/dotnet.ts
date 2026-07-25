// src/languages/packs/dotnet.ts
import path from 'node:path';
import { findPackageRoot } from '../../package-root';
import type { LanguagePack } from '../pack';
import { dotnetAdapter } from '../../update/adapters/dotnet';
import { nugetRegistryChecker, NUGET_DEFAULT_REGISTRY_URL } from '../registry-checkers/nuget';
import { dotnetCommandGenerator } from '../command-generators/dotnet';
import { stripLintTooling } from '../lint-support/dotnet';

function validateProjectName(value: string): string | undefined {
  if (!value || value.trim().length === 0) return 'Project name is required.';
  if (!/^[A-Z][A-Za-z0-9]*$/.test(value)) {
    return 'Use PascalCase, starting with an uppercase letter (e.g. MyTool).';
  }
  return undefined;
}

export const dotnetPack: LanguagePack = {
  id: 'dotnet',
  displayName: '.NET / C# (System.CommandLine)',
  templateDir: path.join(findPackageRoot(), 'templates', 'dotnet'),
  scaffoldCommands: [
    { command: 'dotnet', args: ['restore'] },
    { command: 'dotnet', args: ['build'] },
  ],
  validateProjectName,
  updateAdapter: dotnetAdapter,
  registry: {
    defaultUrl: NUGET_DEFAULT_REGISTRY_URL,
    promptLabel: 'Custom NuGet feed URL (leave empty for nuget.org)',
    checkNameAvailability: nugetRegistryChecker.checkNameAvailability,
    applyPrivateIntent: nugetRegistryChecker.applyPrivateIntent,
    applyRegistryUrl: nugetRegistryChecker.applyRegistryUrl,
  },
  commandGenerator: dotnetCommandGenerator,
  stripLintTooling,
  supportsAutocompleteOptIn: false,
  stripAutocompleteSupport: async () => {},
};
