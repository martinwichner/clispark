import path from 'node:path';
import { findPackageRoot } from '../../package-root';
import type { LanguagePack } from '../pack';
import { pythonAdapter } from '../../update/adapters/python';
import { pypiRegistryChecker, PYPI_DEFAULT_URL } from '../registry-checkers/pypi';
import { pythonCommandGenerator } from '../command-generators/python';

function validateProjectName(value: string | undefined): string | undefined {
  if (!value || value.trim().length === 0) return 'Project name is required.';
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(value)) {
    return 'Use lowercase letters and numbers, with single hyphens between words (no leading, trailing, or repeated hyphens).';
  }
  return undefined;
}

export const pythonPack: LanguagePack = {
  id: 'python',
  displayName: 'Python (Typer)',
  templateDir: path.join(findPackageRoot(), 'templates', 'python'),
  scaffoldCommands: [{ command: 'uv', args: ['sync'] }],
  validateProjectName,
  updateAdapter: pythonAdapter,
  registry: {
    defaultUrl: PYPI_DEFAULT_URL,
    promptLabel: 'Custom PyPI-compatible index URL (leave empty for pypi.org)',
    checkNameAvailability: pypiRegistryChecker.checkNameAvailability,
    applyPrivateIntent: pypiRegistryChecker.applyPrivateIntent,
    applyRegistryUrl: pypiRegistryChecker.applyRegistryUrl,
  },
  commandGenerator: pythonCommandGenerator,
  // v1 is deliberately lean, matching the PowerShell template's precedent -- lint tooling
  // (ruff) and a command-convention rule are separate, later issues (see the spec's "Bewusst
  // nicht Teil dieser Arbeit"). Shell completion needs no opt-in at all: Typer ships
  // --install-completion out of the box, verified in the design session.
  stripLintTooling: async () => {},
  supportsAutocompleteOptIn: false,
  stripAutocompleteSupport: async () => {},
  stripCommandConvention: async () => {},
};
