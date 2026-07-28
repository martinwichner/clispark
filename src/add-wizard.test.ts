// src/add-wizard.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CommandGenerator, ExistingCommandNode } from './languages/command-generator';

vi.mock('@clack/prompts', () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  text: vi.fn(),
  confirm: vi.fn(),
  log: { warn: vi.fn(), info: vi.fn() },
  isCancel: vi.fn(() => false),
  cancel: vi.fn(),
}));
vi.mock('./prompt-utils', () => ({ select: vi.fn() }));

vi.spyOn(process, 'exit').mockImplementation((code) => {
  throw new Error(`process.exit: ${code}`);
});

import { text, confirm } from '@clack/prompts';
import { select } from './prompt-utils';
import { runAddWizard } from './add-wizard';

function fakeGenerator(existing: ExistingCommandNode[]): {
  generator: CommandGenerator;
  generateCommandCalls: Array<{ targetDir: string; spec: unknown }>;
} {
  const generateCommandCalls: Array<{ targetDir: string; spec: unknown }> = [];
  const generator: CommandGenerator = {
    listExistingCommands: async () => existing,
    generateCommand: async (targetDir, spec) => {
      generateCommandCalls.push({ targetDir, spec });
      return { commandFile: 'src/commands/new.ts', testFile: 'src/commands/new.test.ts' };
    },
  };
  return { generator, generateCommandCalls };
}

describe('runAddWizard', () => {
  beforeEach(() => {
    vi.mocked(confirm).mockReset();
    vi.mocked(select).mockReset();
    vi.mocked(text).mockReset();
  });

  it('creates a top-level command with no parameters', async () => {
    const { generator, generateCommandCalls } = fakeGenerator([]);

    vi.mocked(select).mockResolvedValueOnce('__new_top_level__'); // where to add
    vi.mocked(text).mockResolvedValueOnce('deploy'); // command name
    vi.mocked(confirm).mockResolvedValueOnce(false); // "add a parameter?" -> no
    vi.mocked(confirm).mockResolvedValueOnce(true); // "proceed?" -> yes

    await runAddWizard('/tmp/project', { commandGenerator: generator });

    expect(generateCommandCalls).toHaveLength(1);
    expect(generateCommandCalls[0].spec).toEqual({ pathSegments: ['deploy'], parameters: [] });
  });

  it('uses promptCommandIdentity instead of the generic name prompt when the generator provides it', async () => {
    const { generator, generateCommandCalls } = fakeGenerator([]);
    const promptCommandIdentity = vi.fn(async () => ['Get-Something']);
    const generatorWithIdentity: CommandGenerator = { ...generator, promptCommandIdentity };

    vi.mocked(select).mockResolvedValueOnce('__new_top_level__'); // where to add
    vi.mocked(confirm).mockResolvedValueOnce(false); // "add a parameter?" -> no
    vi.mocked(confirm).mockResolvedValueOnce(true); // "proceed?" -> yes

    await runAddWizard('/tmp/project', { commandGenerator: generatorWithIdentity });

    expect(promptCommandIdentity).toHaveBeenCalledWith([], new Set());
    expect(text).not.toHaveBeenCalledWith(expect.objectContaining({ message: 'Command name' }));
    expect(generateCommandCalls[0].spec).toEqual({ pathSegments: ['Get-Something'], parameters: [] });
  });

  it('creates a nested command under an existing one with a required string parameter', async () => {
    const existing: ExistingCommandNode[] = [
      { path: 'task', displayLabel: 'task', children: [] },
    ];
    const { generator, generateCommandCalls } = fakeGenerator(existing);

    vi.mocked(select).mockResolvedValueOnce('task'); // where to add: pick "task"
    vi.mocked(text).mockResolvedValueOnce('export'); // command name
    vi.mocked(confirm).mockResolvedValueOnce(true); // add a parameter? -> yes
    vi.mocked(text).mockResolvedValueOnce('format'); // parameter name
    vi.mocked(select).mockResolvedValueOnce('string'); // parameter type
    vi.mocked(select).mockResolvedValueOnce(true); // required
    vi.mocked(confirm).mockResolvedValueOnce(false); // add another? -> no
    vi.mocked(confirm).mockResolvedValueOnce(true); // proceed? -> yes

    await runAddWizard('/tmp/project', { commandGenerator: generator });

    expect(generateCommandCalls[0].spec).toEqual({
      pathSegments: ['task', 'export'],
      parameters: [{ name: 'format', type: 'string', required: true, allowedValues: undefined }],
    });
  });

  it('does not ask required/optional for a boolean parameter', async () => {
    const { generator, generateCommandCalls } = fakeGenerator([]);

    vi.mocked(select).mockResolvedValueOnce('__new_top_level__');
    vi.mocked(text).mockResolvedValueOnce('confirm');
    vi.mocked(confirm).mockResolvedValueOnce(true); // add a parameter?
    vi.mocked(text).mockResolvedValueOnce('force');
    vi.mocked(select).mockResolvedValueOnce('boolean'); // type — no required/optional select follows
    vi.mocked(confirm).mockResolvedValueOnce(false); // add another?
    vi.mocked(confirm).mockResolvedValueOnce(true); // proceed?

    await runAddWizard('/tmp/project', { commandGenerator: generator });

    expect(generateCommandCalls[0].spec).toEqual({
      pathSegments: ['confirm'],
      parameters: [{ name: 'force', type: 'boolean', required: false, allowedValues: undefined }],
    });
  });

  it('collects allowed values for an enum parameter', async () => {
    const { generator, generateCommandCalls } = fakeGenerator([]);

    vi.mocked(select).mockResolvedValueOnce('__new_top_level__');
    vi.mocked(text).mockResolvedValueOnce('setmode');
    vi.mocked(confirm).mockResolvedValueOnce(true);
    vi.mocked(text).mockResolvedValueOnce('mode');
    vi.mocked(select).mockResolvedValueOnce('enum');
    vi.mocked(select).mockResolvedValueOnce(true); // required
    vi.mocked(text).mockResolvedValueOnce('fast, slow, auto'); // allowed values
    vi.mocked(confirm).mockResolvedValueOnce(false);
    vi.mocked(confirm).mockResolvedValueOnce(true);

    await runAddWizard('/tmp/project', { commandGenerator: generator });

    expect(generateCommandCalls[0].spec).toEqual({
      pathSegments: ['setmode'],
      parameters: [{ name: 'mode', type: 'enum', required: true, allowedValues: ['fast', 'slow', 'auto'] }],
    });
  });

  it('only offers "Optional" for the required/optional prompt once an earlier parameter was optional', async () => {
    const { generator, generateCommandCalls } = fakeGenerator([]);

    vi.mocked(select).mockResolvedValueOnce('__new_top_level__'); // where to add
    vi.mocked(text).mockResolvedValueOnce('deploy'); // command name
    vi.mocked(confirm).mockResolvedValueOnce(true); // add a parameter? -> yes
    vi.mocked(text).mockResolvedValueOnce('first'); // parameter name
    vi.mocked(select).mockResolvedValueOnce('string'); // parameter type
    vi.mocked(select).mockResolvedValueOnce(false); // required/optional -> Optional
    vi.mocked(confirm).mockResolvedValueOnce(true); // add another? -> yes
    vi.mocked(text).mockResolvedValueOnce('second'); // parameter name
    vi.mocked(select).mockResolvedValueOnce('string'); // parameter type
    vi.mocked(select).mockResolvedValueOnce(false); // required/optional -> Optional (only choice offered)
    vi.mocked(confirm).mockResolvedValueOnce(false); // add another? -> no
    vi.mocked(confirm).mockResolvedValueOnce(true); // proceed? -> yes

    await runAddWizard('/tmp/project', { commandGenerator: generator });

    const requiredOptionalCalls = vi
      .mocked(select)
      .mock.calls.filter((call) => call[0]?.message === 'Required or optional?');
    expect(requiredOptionalCalls).toHaveLength(2);

    // First parameter: nothing optional yet, so both choices are offered.
    expect(requiredOptionalCalls[0][0].options).toEqual([
      { value: true, label: 'Required' },
      { value: false, label: 'Optional' },
    ]);

    // Second parameter: an optional parameter already exists, so "Required" must never be offered.
    expect(requiredOptionalCalls[1][0].options).toEqual([{ value: false, label: 'Optional' }]);

    expect(generateCommandCalls[0].spec).toEqual({
      pathSegments: ['deploy'],
      parameters: [
        { name: 'first', type: 'string', required: false, allowedValues: undefined },
        { name: 'second', type: 'string', required: false, allowedValues: undefined },
      ],
    });
  });

  it('does not call generateCommand when the user declines the final confirmation', async () => {
    const { generator, generateCommandCalls } = fakeGenerator([]);

    vi.mocked(select).mockResolvedValueOnce('__new_top_level__');
    vi.mocked(text).mockResolvedValueOnce('deploy');
    vi.mocked(confirm).mockResolvedValueOnce(false); // add a parameter? -> no
    vi.mocked(confirm).mockResolvedValueOnce(false); // proceed? -> no

    await expect(runAddWizard('/tmp/project', { commandGenerator: generator })).rejects.toThrow('process.exit: 1');

    expect(generateCommandCalls).toHaveLength(0);
  });

  // Added beyond the brief: the "Allowed values" prompt's validate callback must reject
  // individual values containing unsafe characters (quotes, backticks, etc.), since those
  // values get spliced directly into generated TypeScript/C# source by the command generators.
  it('rejects enum allowed values containing unsafe characters, and accepts a clean list', async () => {
    const { generator } = fakeGenerator([]);

    vi.mocked(select).mockResolvedValueOnce('__new_top_level__');
    vi.mocked(text).mockResolvedValueOnce('setmode');
    vi.mocked(confirm).mockResolvedValueOnce(true);
    vi.mocked(text).mockResolvedValueOnce('mode');
    vi.mocked(select).mockResolvedValueOnce('enum');
    vi.mocked(select).mockResolvedValueOnce(true); // required
    vi.mocked(text).mockResolvedValueOnce('fast, slow'); // allowed values (only needed to let the flow finish)
    vi.mocked(confirm).mockResolvedValueOnce(false);
    vi.mocked(confirm).mockResolvedValueOnce(true);

    await runAddWizard('/tmp/project', { commandGenerator: generator });

    // Find the call to text() that was for the "Allowed values" prompt and grab its validate fn.
    const allowedValuesCall = vi
      .mocked(text)
      .mock.calls.find((call) => call[0]?.message === 'Allowed values (comma-separated)');
    expect(allowedValuesCall).toBeDefined();
    // clispark always passes a plain validate function (never a Standard Schema object), so this
    // narrows the union clack's Validate<T> type now allows since v1.
    const validate = allowedValuesCall![0].validate as (value: string | undefined) => string | undefined;

    // Unsafe: contains a single quote.
    expect(validate("fast, sl'ow")).toEqual(expect.stringContaining('sl\'ow'));
    // Unsafe: contains a backtick.
    expect(validate('fast, `slow`')).toBeTruthy();
    // Clean list: passes.
    expect(validate('fast, slow, auto')).toBeUndefined();
    expect(validate('in-progress, done, blocked_off')).toBeUndefined();
    // Still enforces "at least two values".
    expect(validate('fast')).toBeTruthy();
  });
});
