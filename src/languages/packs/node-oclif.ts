// src/languages/packs/node-oclif.ts
import path from 'node:path';
import { findPackageRoot } from '../../package-root';
import type { LanguagePack } from '../pack';
import { nodeOclifAdapter } from '../../update/adapters/node-oclif';
import { npmRegistryChecker, NPM_DEFAULT_REGISTRY_URL } from '../registry-checkers/npm';
import { nodeOclifCommandGenerator } from '../command-generators/node-oclif';
import { stripLintTooling } from '../lint-support/node';
import { stripAutocompleteSupport } from '../autocomplete-support/node';

function validateProjectName(value: string): string | undefined {
  if (!value || value.trim().length === 0) return 'Project name is required.';
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(value)) {
    return 'Use lowercase letters and numbers, with single hyphens between words (no leading, trailing, or repeated hyphens).';
  }
  return undefined;
}

export const nodeOclifPack: LanguagePack = {
  id: 'node',
  displayName: 'Node.js / TypeScript (oclif)',
  templateDir: path.join(findPackageRoot(), 'templates', 'node'),
  scaffoldCommands: [
    { command: 'npm', args: ['install'] },
    { command: 'npm', args: ['run', 'build'] },
  ],
  validateProjectName,
  updateAdapter: nodeOclifAdapter,
  registry: {
    defaultUrl: NPM_DEFAULT_REGISTRY_URL,
    promptLabel: 'Custom npm registry URL (leave empty for npmjs.org)',
    checkNameAvailability: npmRegistryChecker.checkNameAvailability,
    applyPrivateIntent: npmRegistryChecker.applyPrivateIntent,
    applyRegistryUrl: npmRegistryChecker.applyRegistryUrl,
  },
  commandGenerator: nodeOclifCommandGenerator,
  stripLintTooling,
  supportsAutocompleteOptIn: true,
  stripAutocompleteSupport,
};
