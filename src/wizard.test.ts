// src/wizard.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NameCheckResult } from './languages/registry-checker';
import type { LanguagePack } from './languages/pack';

vi.mock('@clack/prompts', () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  text: vi.fn(),
  select: vi.fn(),
  log: { warn: vi.fn(), info: vi.fn() },
  isCancel: vi.fn(() => false),
  cancel: vi.fn(),
}));

import { text, select, log } from '@clack/prompts';
import { runWizard } from './wizard';

const fakeUpdateAdapter: LanguagePack['updateAdapter'] = {
  coreFilePaths: () => [],
  templateSourcePath: (p) => p,
  manifestFileName: 'package.json',
  readManifestFile: async () => ({}),
  writeManifestFile: async () => {},
  parseManifestFile: () => ({}),
  readProjectName: () => '',
  extractCoreFields: () => ({ coreDependencies: {}, coreScripts: {}, coreFields: {} }),
  mergeManifestFile: () => ({
    updatedFile: {},
    changed: false,
    dependencies: [],
    scripts: [],
    fields: [],
    coreDependencies: {},
    coreScripts: {},
    coreFields: {},
  }),
};

function fakePack(
  checkNameAvailability: (name: string, registryUrl: string) => Promise<NameCheckResult>,
  options: { supportsAutocompleteOptIn?: boolean } = {},
): LanguagePack {
  return {
    id: 'node',
    displayName: 'Node.js / TypeScript (oclif)',
    templateDir: '/fake/templates/node',
    scaffoldCommands: [],
    validateProjectName: () => undefined,
    updateAdapter: fakeUpdateAdapter,
    registry: {
      defaultUrl: 'https://registry.npmjs.org',
      promptLabel: 'Custom npm registry URL (leave empty for npmjs.org)',
      checkNameAvailability,
      applyPrivateIntent: vi.fn(),
      applyRegistryUrl: vi.fn(),
    },
    commandGenerator: {
      listExistingCommands: async () => [],
      generateCommand: async () => ({ commandFile: '', testFile: '' }),
    },
    stripLintTooling: vi.fn(),
    supportsAutocompleteOptIn: options.supportsAutocompleteOptIn ?? true,
    stripAutocompleteSupport: vi.fn(),
  };
}

describe('runWizard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('asks language, then name, then profile, then returns the answers when the name is available on first try', async () => {
    const checkNameAvailability = vi
      .fn<(name: string, registryUrl: string) => Promise<NameCheckResult>>()
      .mockResolvedValueOnce('available');
    const pack = fakePack(checkNameAvailability);

    vi.mocked(select)
      .mockResolvedValueOnce('node')
      .mockResolvedValueOnce('private')
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false);
    vi.mocked(text).mockResolvedValueOnce('my-cli');

    const result = await runWizard({ languagePacks: { node: pack } });

    expect(result).toEqual({
      language: 'node',
      projectName: 'my-cli',
      profile: 'private',
      registryUrl: 'https://registry.npmjs.org',
      publishIntent: true,
      nameAvailability: 'available',
      lintEnabled: false,
      autocompleteEnabled: false,
    });
    expect(checkNameAvailability).toHaveBeenCalledTimes(1);
    // language is asked before name
    expect(vi.mocked(select).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(text).mock.invocationCallOrder[0]);
  });

  it('warns and re-prompts for the name only (not language/profile) when it is taken, then succeeds', async () => {
    const checkNameAvailability = vi
      .fn<(name: string, registryUrl: string) => Promise<NameCheckResult>>()
      .mockResolvedValueOnce('taken')
      .mockResolvedValueOnce('available');
    const pack = fakePack(checkNameAvailability);

    vi.mocked(select)
      .mockResolvedValueOnce('node')
      .mockResolvedValueOnce('private')
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false);
    vi.mocked(text).mockResolvedValueOnce('taken-name').mockResolvedValueOnce('free-name');

    const result = await runWizard({ languagePacks: { node: pack } });

    expect(result.projectName).toBe('free-name');
    expect(checkNameAvailability).toHaveBeenCalledTimes(2);
    // language + profile + publish-intent + lint-enabled + autocomplete-enabled, none re-asked during the name retry loop
    expect(select).toHaveBeenCalledTimes(5);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('taken-name'));
  });

  it('asks for a custom registry URL only when profile is "work"', async () => {
    const checkNameAvailability = vi
      .fn<(name: string, registryUrl: string) => Promise<NameCheckResult>>()
      .mockResolvedValueOnce('available');
    const pack = fakePack(checkNameAvailability);

    vi.mocked(select)
      .mockResolvedValueOnce('node')
      .mockResolvedValueOnce('work')
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false);
    vi.mocked(text).mockResolvedValueOnce('my-cli').mockResolvedValueOnce('https://npm.mycompany.dev');

    const result = await runWizard({ languagePacks: { node: pack } });

    expect(result.registryUrl).toBe('https://npm.mycompany.dev');
    expect(checkNameAvailability).toHaveBeenCalledWith('my-cli', 'https://npm.mycompany.dev');
  });

  it('continues with "unverified" and a warning when the registry check fails', async () => {
    const checkNameAvailability = vi
      .fn<(name: string, registryUrl: string) => Promise<NameCheckResult>>()
      .mockResolvedValueOnce('unverified');
    const pack = fakePack(checkNameAvailability);

    vi.mocked(select)
      .mockResolvedValueOnce('node')
      .mockResolvedValueOnce('private')
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false);
    vi.mocked(text).mockResolvedValueOnce('my-cli');

    const result = await runWizard({ languagePacks: { node: pack } });

    expect(result.nameAvailability).toBe('unverified');
    expect(log.warn).toHaveBeenCalled();
  });

  it('skips the availability check entirely when publish intent is No', async () => {
    const checkNameAvailability = vi.fn<(name: string, registryUrl: string) => Promise<NameCheckResult>>();
    const pack = fakePack(checkNameAvailability);

    vi.mocked(select)
      .mockResolvedValueOnce('node')
      .mockResolvedValueOnce('private')
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false);
    vi.mocked(text).mockResolvedValueOnce('my-cli');

    const result = await runWizard({ languagePacks: { node: pack } });

    expect(result.publishIntent).toBe(false);
    expect(result.nameAvailability).toBe('skipped');
    expect(checkNameAvailability).not.toHaveBeenCalled();
  });

  it('asks whether to set up lint tooling, defaulting to No', async () => {
    const pack = fakePack(async () => 'available');

    vi.mocked(select)
      .mockResolvedValueOnce('node')
      .mockResolvedValueOnce('private')
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false);
    vi.mocked(text).mockResolvedValueOnce('my-cli');

    const result = await runWizard({ languagePacks: { node: pack } });

    expect(result.lintEnabled).toBe(false);
  });

  it('records lintEnabled: true when the user opts in', async () => {
    const pack = fakePack(async () => 'available');

    vi.mocked(select)
      .mockResolvedValueOnce('node')
      .mockResolvedValueOnce('private')
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    vi.mocked(text).mockResolvedValueOnce('my-cli');

    const result = await runWizard({ languagePacks: { node: pack } });

    expect(result.lintEnabled).toBe(true);
  });

  it('asks whether to set up shell autocompletion, defaulting to No', async () => {
    const pack = fakePack(async () => 'available');

    vi.mocked(select)
      .mockResolvedValueOnce('node')
      .mockResolvedValueOnce('private')
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false);
    vi.mocked(text).mockResolvedValueOnce('my-cli');

    const result = await runWizard({ languagePacks: { node: pack } });

    expect(result.autocompleteEnabled).toBe(false);
  });

  it('records autocompleteEnabled: true when the user opts in', async () => {
    const pack = fakePack(async () => 'available');

    vi.mocked(select)
      .mockResolvedValueOnce('node')
      .mockResolvedValueOnce('private')
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    vi.mocked(text).mockResolvedValueOnce('my-cli');

    const result = await runWizard({ languagePacks: { node: pack } });

    expect(result.autocompleteEnabled).toBe(true);
  });

  it('skips the autocomplete question entirely when the pack does not support it, defaulting autocompleteEnabled to false', async () => {
    const pack = fakePack(async () => 'available', { supportsAutocompleteOptIn: false });

    vi.mocked(select)
      .mockResolvedValueOnce('node')
      .mockResolvedValueOnce('private')
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    // Note: only 4 select() mocks -- no 5th one queued, proving the question was never asked
    // (an un-consumed extra mock wouldn't catch a bug here; a MISSING one that gets consumed
    // anyway would make vi.mocked(select) return undefined and the wizard would crash instead --
    // that crash is the actual assertion this test relies on).
    vi.mocked(text).mockResolvedValueOnce('my-cli');

    const result = await runWizard({ languagePacks: { node: pack } });

    expect(result.autocompleteEnabled).toBe(false);
    expect(select).toHaveBeenCalledTimes(4);
  });
});
