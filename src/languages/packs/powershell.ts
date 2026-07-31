// src/languages/packs/powershell.ts
import path from 'node:path';
import { findPackageRoot } from '../../package-root';
import type { LanguagePack } from '../pack';
import { powershellAdapter } from '../../update/adapters/powershell';
import { powershellGalleryRegistryChecker, POWERSHELL_GALLERY_DEFAULT_URL } from '../registry-checkers/powershell-gallery';
import { powershellCommandGenerator } from '../command-generators/powershell';

function validateProjectName(value: string | undefined): string | undefined {
  if (!value || value.trim().length === 0) return 'Project name is required.';
  if (!/^[A-Z][A-Za-z0-9]*$/.test(value)) {
    return 'Use PascalCase, starting with an uppercase letter (e.g. MyTool).';
  }
  return undefined;
}

export const powershellPack: LanguagePack = {
  id: 'powershell',
  displayName: 'PowerShell (7.4+)',
  templateDir: path.join(findPackageRoot(), 'templates', 'powershell'),
  scaffoldCommands: [
    {
      command: 'pwsh',
      args: ['-NoProfile', '-Command', 'Install-Module -Name PSFramework,Pester,Microsoft.PowerShell.PSResourceGet -Scope CurrentUser -Force -AllowClobber'],
    },
  ],
  validateProjectName,
  updateAdapter: powershellAdapter,
  registry: {
    defaultUrl: POWERSHELL_GALLERY_DEFAULT_URL,
    promptLabel: 'Custom PowerShell repository URL (leave empty for the PowerShell Gallery)',
    checkNameAvailability: powershellGalleryRegistryChecker.checkNameAvailability,
    applyPrivateIntent: powershellGalleryRegistryChecker.applyPrivateIntent,
    applyRegistryUrl: powershellGalleryRegistryChecker.applyRegistryUrl,
  },
  commandGenerator: powershellCommandGenerator,
  stripLintTooling: async () => {},
  supportsAutocompleteOptIn: false,
  stripAutocompleteSupport: async () => {},
  // PowerShell is out of scope for #80 (see plan's Global Constraints); permanent no-op.
  stripCommandConvention: async () => {},
};
