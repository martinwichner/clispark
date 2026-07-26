# `clispark demo` — Guided Console Walkthrough (#120) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new, always-present `clispark demo` subcommand with a menu offering a complete narrated walkthrough (real Node scaffold, no-op install/build), a live commands reference, and a wizard-flags reference — all driven from real, introspectable data so future commands/flags show up automatically instead of needing a second, hand-maintained script.

**Architecture:** Extract `cli.ts`'s Command-tree construction into a side-effect-free `createProgram(): Command` (prerequisite — `cli.ts` today parses `process.argv` as a side effect of being imported, which would break live introspection). The commands-reference mode reads `program.commands` directly (fully live, zero maintenance). The wizard-flags-reference mode reads a new `WIZARD_QUESTION_CATALOG` constant colocated in `wizard.ts` (a deliberate, documented trade-off — not fully automatic, guarded by a regression test that runs the real wizard and checks the prompt count matches). The full walkthrough runs the real `scaffoldProject()` against `nodeOclifPack` in a temp directory with shell-out steps stubbed to a no-op, narrating real files read back off disk.

**Design spec:** `docs/superpowers/specs/2026-07-26-clispark-demo-design.md` — read it first for full rationale, including two critical-review passes that found the `cli.ts` side-effect blocker, a missing per-command-flags requirement, and a cross-plan sequencing risk against #80.

**Verified while writing this plan (not just assumed):**
- `commander@13.1.0` (the version installed in this repo) does **not** auto-add a `help` entry to `program.commands` — confirmed by constructing a real `Command` with several subcommands and inspecting `.commands` directly. The design spec's "filter out `help`" open question is **resolved: no filtering needed.**
- `Command.description()` is a no-arg getter method (not a property); `Command.options` is an array of `Option` objects with plain string `.flags`/`.description` properties (not methods) — confirmed the same way.
- `@clack/prompts@0.9.1` (installed) exports `note`, `log`, `spinner` — none of which this codebase uses yet (only `intro`/`outro`/`select`/`text`/`log`/`isCancel`/`cancel` are used today) — confirmed via `Object.keys()` on the installed package.
- `wizard.ts`'s real question order (confirmed by reading the file): language (select) → projectName (text) → profile (select) → registryUrl (text, only if `profile === 'work'`) → publishIntent (select) → lintEnabled (select) → autocompleteEnabled (select, only if `pack.supportsAutocompleteOptIn`). With `publishIntent: false`, `checkNameAvailability` is never called (no retry loop).

**New finding, resolved in this plan (not covered by the spec):** wiring `.command('demo')` inside `createProgram()` needs a reference to the `program` instance being built, for the commands-reference mode — but `demo/index.ts` (which needs `Command` for that mode) must not import `createProgram` from `program.ts`, or `program.ts` importing `runDemo` from `demo/index.ts` would create a circular import. **Resolution:** `program.ts` passes its own in-progress `program` variable into the demo action via closure (`.action(() => withLogging('demo', (logger) => runDemo(logger, program))())`) — by the time the action actually runs (during `.parseAsync()`, always after `createProgram()` has fully returned), `program.commands` is completely populated, including `demo` itself. `demo/index.ts` and `commands-reference.ts` only ever accept a `Command` parameter; neither imports `program.ts`.

## Global Constraints

- Every task ends with `npx tsc --noEmit`, `npx eslint src scripts`, and `npx vitest run` all passing in the clispark repo root.
- `clispark demo` is unconditional — no wizard opt-in, always present (like `whoami`/`hook`).
- The core walkthrough scaffolds **Node only**; .NET/PowerShell get a short closing note, not a full walkthrough (out of scope per spec).
- Any temp directory the walkthrough creates must be removed on success, on a thrown error, and (best-effort) on SIGINT — never left behind.
- `WIZARD_QUESTION_CATALOG` lives inside `wizard.ts` itself, next to the real questions it describes — not a separate file.
- **Sequencing note carried over from the design spec:** if clispark issue #80 (command-convention rule, its own plan already written at `docs/superpowers/plans/2026-07-26-clispark-command-convention-rule.md`) is implemented *after* this plan, its implementer must add its new `commandConventionEnabled` wizard question to `WIZARD_QUESTION_CATALOG` too — Task 2 below leaves an explicit code comment marking this.

---

## File Structure

```
src/program.ts                          # CREATE — createProgram(): Command, extracted from cli.ts
src/program.test.ts                     # CREATE
src/cli.ts                              # MODIFY — becomes a thin entrypoint
src/wizard.ts                           # MODIFY — WIZARD_QUESTION_CATALOG export
src/wizard.test.ts                      # MODIFY — new catalog/prompt-count regression test
src/demo/commands-reference.ts          # CREATE
src/demo/commands-reference.test.ts     # CREATE
src/demo/wizard-flags-reference.ts      # CREATE
src/demo/wizard-flags-reference.test.ts # CREATE
src/demo/full-walkthrough.ts            # CREATE
src/demo/full-walkthrough.test.ts       # CREATE
src/demo/index.ts                       # CREATE — runDemo(): menu + dispatch
src/demo/index.test.ts                  # CREATE
README.md                               # MODIFY — mention `clispark demo`
```

---

### Task 1: Extract `createProgram()` from `cli.ts`

**Files:**
- Create: `src/program.ts`, `src/program.test.ts`
- Modify: `src/cli.ts`

**Interfaces:**
- Produces: `createProgram(): Command` — builds and returns a fresh, fully-wired `commander` `Command` instance (all current subcommands: `update`, `releasenotes`, `add`, `whoami`, `hook`) with no side effects (no `parseAsync` call). Every call returns an independent instance.

This task is a pure refactor — `cli.ts`'s runtime behavior must be byte-for-byte identical after it (same subcommands, same options, same actions), just restructured so the tree can be built without immediately parsing `process.argv`. Verified beforehand: nothing else in the repo imports `cli.ts` directly (only `package.json`'s `bin`/`postbuild` reference the built `dist/cli.js`), and `tsup.config.ts`'s entry (`src/cli.ts`) needs no change since it will import `program.ts` transitively.

- [ ] **Step 1: Write the failing test**

`src/program.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createProgram } from './program';

describe('createProgram', () => {
  it('registers all expected subcommands with non-empty descriptions', () => {
    const program = createProgram();
    const names = program.commands.map((cmd) => cmd.name());
    expect(names).toEqual(['update', 'releasenotes', 'add', 'whoami', 'hook']);
    for (const cmd of program.commands) {
      expect(cmd.description().length).toBeGreaterThan(0);
    }
  });

  it('returns a fresh, independent Command instance on every call', () => {
    const first = createProgram();
    const second = createProgram();
    expect(first).not.toBe(second);

    first.command('temp-marker');
    expect(second.commands.map((cmd) => cmd.name())).not.toContain('temp-marker');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/program.test.ts`
Expected: FAIL — `./program` doesn't exist yet.

- [ ] **Step 3: Implement**

`src/program.ts` — the entire current body of `cli.ts` except the trailing `parseAsync` call, wrapped in an exported function:

```ts
// src/program.ts
import path from 'node:path';
import { existsSync } from 'node:fs';
import { Command } from 'commander';
import { runWizard } from './wizard';
import { scaffoldProject } from './scaffold';
import { withLogging } from './logger';
import { formatUpdateSummary, updateProject } from './update/update';
import { fetchReleaseNotes, formatReleaseNotes } from './update/releasenotes';
import { getGeneratorVersion, requireManifest } from './update/manifest';
import { LANGUAGE_PACKS } from './languages';
import type { LanguagePack } from './languages/pack';
import { UserError } from './errors';
import { runAddWizard } from './add-wizard';
import { getWhoamiOutput, type WhoamiMode } from './whoami';
import { printConfetti } from './confetti';
import { getPostScaffoldHookPath, runPostScaffoldHook } from './hooks';

function resolvePack(language: string): LanguagePack {
  const pack = LANGUAGE_PACKS[language];
  if (!pack) {
    throw new UserError(`Unknown language "${language}" — is your clispark installation out of date?`);
  }
  return pack;
}

function resolveWhoamiMode(options: { joke?: boolean; fact?: boolean }): WhoamiMode {
  if (options.joke && options.fact) {
    throw new UserError('Use either --joke or --fact, not both.');
  }
  if (options.joke) return 'joke';
  if (options.fact) return 'fact';
  return 'random';
}

export function createProgram(): Command {
  const program = new Command();

  program
    .name('clispark')
    .description('Interactive scaffolding tool for new CLI projects')
    .option('--no-confetti', 'Skip the confetti after a successful run')
    .option('--no-hook', 'Skip the post-scaffold hook, even if one is configured')
    .configureHelp({ showGlobalOptions: true })
    .version(getGeneratorVersion());

  program.action((options: { confetti?: boolean; hook?: boolean }) =>
    withLogging('scaffold', async (logger) => {
      const answers = await runWizard();
      const targetDir = path.join(process.cwd(), answers.projectName);
      const pack = resolvePack(answers.language);

      logger.info({ projectName: answers.projectName, targetDir, language: pack.id }, 'scaffold started');
      await scaffoldProject(
        {
          projectName: answers.projectName,
          targetDir,
          registryUrl: answers.registryUrl,
          publishIntent: answers.publishIntent,
          lintEnabled: answers.lintEnabled,
          autocompleteEnabled: answers.autocompleteEnabled,
        },
        pack,
      );
      logger.info({ projectName: answers.projectName }, 'scaffold completed');

      console.log(`\nDone! Your new CLI project is ready at ${targetDir}`);

      if (options.hook !== false) {
        await runPostScaffoldHook({
          projectName: answers.projectName,
          targetDir,
          language: pack.id,
          registryUrl: answers.registryUrl,
          publishIntent: answers.publishIntent,
        });
      }

      if (options.confetti !== false) printConfetti();
    })(),
  );

  program
    .command('update')
    .description('Update generator-managed core files and dependencies to the latest clispark version')
    .action((_options: unknown, command: Command) =>
      withLogging('update', async (logger) => {
        const targetDir = process.cwd();
        const manifest = await requireManifest(targetDir);
        const language = manifest.language ?? 'node';
        const pack = resolvePack(language);
        logger.info({ targetDir, language }, 'update started');
        const result = await updateProject(targetDir, pack.updateAdapter, pack.templateDir, language);
        logger.info({ status: result.status }, 'update completed');
        console.log(formatUpdateSummary(result));
        const { confetti } = command.optsWithGlobals<{ confetti?: boolean }>();
        if (confetti !== false && result.status === 'updated') printConfetti();
      })(),
    );

  program
    .command('releasenotes')
    .description("Show what changed between this project's generator version and the latest clispark version")
    .action(
      withLogging('releasenotes', async (logger) => {
        const targetDir = process.cwd();
        logger.info({ targetDir }, 'releasenotes started');
        const result = await fetchReleaseNotes(targetDir);
        logger.info({ status: result.status }, 'releasenotes completed');
        console.log(formatReleaseNotes(result));
      }),
    );

  program
    .command('add')
    .description('Add a new command to an already-scaffolded project')
    .action(
      withLogging('add', async (logger) => {
        const targetDir = process.cwd();
        const manifest = await requireManifest(targetDir);
        const language = manifest.language ?? 'node';
        const pack = resolvePack(language);
        logger.info({ targetDir, language }, 'add started');
        await runAddWizard(targetDir, { commandGenerator: pack.commandGenerator });
        logger.info({}, 'add completed');
      }),
    );

  program
    .command('whoami')
    .description('A little something extra')
    .option('--joke', 'Always show a joke')
    .option('--fact', 'Always show a fun fact about this machine')
    .action((options: { joke?: boolean; fact?: boolean }) =>
      withLogging('whoami', async (logger) => {
        const mode = resolveWhoamiMode(options);
        logger.info({ mode }, 'whoami started');
        console.log(await getWhoamiOutput(fetch, undefined, undefined, mode));
        logger.info({}, 'whoami completed');
      })(),
    );

  program
    .command('hook')
    .description('Show the post-scaffold hook file location and whether one is configured')
    .action(() =>
      withLogging('hook', async (logger) => {
        const hookPath = getPostScaffoldHookPath();
        const exists = existsSync(hookPath);
        logger.info({ hookPath, exists }, 'hook status checked');

        console.log('\nPost-scaffold hook\n');
        console.log(`Location: ${hookPath}`);
        if (exists) {
          console.log('Status:   found — will run after the next scaffold');
        } else {
          console.log('Status:   not found — no hook will run after the next scaffold');
          console.log(
            '\nTo add one, create that file as an ES module exporting a default function:\n\n' +
              '  export default async function postScaffold({ projectName, targetDir, language, registryUrl, publishIntent }) {\n' +
              '    // your code here\n' +
              '  }\n\n' +
              'It runs once, right after a new project finishes scaffolding.',
          );
        }
      })(),
    );

  return program;
}
```

`src/cli.ts` — becomes a thin entrypoint:

```ts
// src/cli.ts
import { createProgram } from './program';

createProgram()
  .parseAsync(process.argv)
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/program.test.ts && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Real verification — the built CLI still behaves identically**

```bash
npm run build
node dist/cli.js --help
```

Expected: same subcommand list (`update`, `releasenotes`, `add`, `whoami`, `hook`) and global options (`--no-confetti`, `--no-hook`) as before this task. Also run `node dist/cli.js whoami` once to confirm a real subcommand still executes correctly end to end.

- [ ] **Step 6: Commit**

```bash
git add src/program.ts src/program.test.ts src/cli.ts
git commit -m "refactor: extract createProgram() from cli.ts for side-effect-free introspection"
```

---

### Task 2: `WIZARD_QUESTION_CATALOG` + drift-detection regression test

**Files:**
- Modify: `src/wizard.ts`, `src/wizard.test.ts`

**Interfaces:**
- Produces: `WizardQuestionCatalogEntry { id: string; prompt: string; why: string }`; `WIZARD_QUESTION_CATALOG: WizardQuestionCatalogEntry[]` (exported from `wizard.ts`).

- [ ] **Step 1: Write the failing test**

Add to `src/wizard.test.ts` (this file already mocks `@clack/prompts`'s `select`/`text` — see its existing `fakePack`/`fakeUpdateAdapter` helpers and reuse them):

```ts
import { WIZARD_QUESTION_CATALOG } from './wizard';

describe('WIZARD_QUESTION_CATALOG regression guard', () => {
  it('matches the number of real prompts a maximal-branch wizard run actually makes', async () => {
    const checkNameAvailability = vi.fn<(name: string, registryUrl: string) => Promise<NameCheckResult>>();
    const pack = fakePack(checkNameAvailability, { supportsAutocompleteOptIn: true });

    vi.mocked(select)
      .mockResolvedValueOnce('node') // language
      .mockResolvedValueOnce('work') // profile
      .mockResolvedValueOnce(false) // publishIntent -- false deliberately avoids the name-retry loop, which isn't a distinct catalog question
      .mockResolvedValueOnce(true) // lintEnabled
      .mockResolvedValueOnce(true); // autocompleteEnabled
    vi.mocked(text)
      .mockResolvedValueOnce('my-cli') // projectName
      .mockResolvedValueOnce('https://registry.example.com'); // registryUrl, only asked because profile is 'work'

    await runWizard({ languagePacks: { node: pack } });

    const totalPromptCalls = vi.mocked(select).mock.calls.length + vi.mocked(text).mock.calls.length;
    expect(totalPromptCalls).toBe(WIZARD_QUESTION_CATALOG.length);
    expect(checkNameAvailability).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/wizard.test.ts`
Expected: FAIL — `WIZARD_QUESTION_CATALOG` doesn't exist yet (import error).

- [ ] **Step 3: Implement**

Add to `src/wizard.ts` (near the bottom, after `runWizard`):

```ts
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
//
// When clispark issue #80 (command-convention enforcement) ships, it adds a new
// `commandConventionEnabled` wizard question (only asked when `lintEnabled` is true) --
// add its entry here too if this feature (#120) shipped first.
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
    id: 'autocompleteEnabled',
    prompt: 'Set up shell autocompletion?',
    why: 'Only asked for languages that need it (Node) — .NET and PowerShell already have working tab-completion built in with nothing to configure. Wires up @oclif/plugin-autocomplete when accepted.',
  },
];
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/wizard.test.ts && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/wizard.ts src/wizard.test.ts
git commit -m "feat: add WIZARD_QUESTION_CATALOG with a drift-detection regression test"
```

---

### Task 3: Commands reference

**Files:**
- Create: `src/demo/commands-reference.ts`, `src/demo/commands-reference.test.ts`

**Interfaces:**
- Consumes: a `commander` `Command` instance (from `createProgram()`, Task 1) — via parameter, no import of `program.ts`.
- Produces: `CommandFlagInfo { flags: string; description: string }`; `CommandInfo { name: string; description: string; flags: CommandFlagInfo[] }`; `collectCommandInfo(program: Command): CommandInfo[]`; `runCommandsReference(program: Command): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

`src/demo/commands-reference.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { Command } from 'commander';

describe('collectCommandInfo', () => {
  it('reads name, description, and options off each registered subcommand', async () => {
    const { collectCommandInfo } = await import('./commands-reference');
    const program = new Command();
    program.command('whoami').description('A little something extra').option('--joke', 'Always show a joke');
    program.command('hook').description('Show the post-scaffold hook file location and whether one is configured');

    expect(collectCommandInfo(program)).toEqual([
      {
        name: 'whoami',
        description: 'A little something extra',
        flags: [{ flags: '--joke', description: 'Always show a joke' }],
      },
      {
        name: 'hook',
        description: 'Show the post-scaffold hook file location and whether one is configured',
        flags: [],
      },
    ]);
  });
});

vi.mock('@clack/prompts', () => ({ note: vi.fn() }));

describe('runCommandsReference', () => {
  it('shows the root default action and every registered subcommand', async () => {
    const { note } = await import('@clack/prompts');
    const { runCommandsReference } = await import('./commands-reference');
    const program = new Command();
    program.command('whoami').description('A little something extra');

    await runCommandsReference(program);

    const titles = vi.mocked(note).mock.calls.map(([, title]) => title);
    expect(titles).toContain('clispark (default action)');
    expect(titles).toContain('clispark whoami');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/demo/commands-reference.test.ts`
Expected: FAIL — `./commands-reference` doesn't exist yet.

- [ ] **Step 3: Implement**

`src/demo/commands-reference.ts`:

```ts
// src/demo/commands-reference.ts
import type { Command } from 'commander';
import { note } from '@clack/prompts';

export interface CommandFlagInfo {
  flags: string;
  description: string;
}

export interface CommandInfo {
  name: string;
  description: string;
  flags: CommandFlagInfo[];
}

const ROOT_ACTION_DESCRIPTION =
  'The default action — no subcommand needed. Runs the interactive wizard, then scaffolds a new project ' +
  'in a directory named after your answers.';

const ROOT_GLOBAL_FLAGS: CommandFlagInfo[] = [
  { flags: '--no-confetti', description: 'Skip the confetti after a successful run' },
  { flags: '--no-hook', description: 'Skip the post-scaffold hook, even if one is configured' },
];

export function collectCommandInfo(program: Command): CommandInfo[] {
  return program.commands.map((cmd) => ({
    name: cmd.name(),
    description: cmd.description(),
    flags: cmd.options.map((opt) => ({ flags: opt.flags, description: opt.description })),
  }));
}

function formatFlags(flags: CommandFlagInfo[]): string {
  return flags.map((f) => `  ${f.flags}  ${f.description}`).join('\n');
}

export async function runCommandsReference(program: Command): Promise<void> {
  const rootContent = [ROOT_ACTION_DESCRIPTION, formatFlags(ROOT_GLOBAL_FLAGS)].filter(Boolean).join('\n\n');
  note(rootContent, 'clispark (default action)');

  for (const info of collectCommandInfo(program)) {
    const content = [info.description, formatFlags(info.flags)].filter(Boolean).join('\n\n');
    note(content, `clispark ${info.name}`);
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/demo/commands-reference.test.ts && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/demo/commands-reference.ts src/demo/commands-reference.test.ts
git commit -m "feat: add live-introspected commands reference for clispark demo"
```

---

### Task 4: Wizard flags reference

**Files:**
- Create: `src/demo/wizard-flags-reference.ts`, `src/demo/wizard-flags-reference.test.ts`

**Interfaces:**
- Consumes: `WIZARD_QUESTION_CATALOG` from `../wizard` (Task 2).
- Produces: `runWizardFlagsReference(): Promise<void>`.

- [ ] **Step 1: Write the failing test**

`src/demo/wizard-flags-reference.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('@clack/prompts', () => ({ note: vi.fn() }));

describe('runWizardFlagsReference', () => {
  it('shows one note per catalog entry, titled by its id, containing its why text', async () => {
    const { note } = await import('@clack/prompts');
    const { WIZARD_QUESTION_CATALOG } = await import('../wizard');
    const { runWizardFlagsReference } = await import('./wizard-flags-reference');

    await runWizardFlagsReference();

    expect(vi.mocked(note)).toHaveBeenCalledTimes(WIZARD_QUESTION_CATALOG.length);
    for (const entry of WIZARD_QUESTION_CATALOG) {
      expect(vi.mocked(note)).toHaveBeenCalledWith(expect.stringContaining(entry.why), entry.id);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/demo/wizard-flags-reference.test.ts`
Expected: FAIL — `./wizard-flags-reference` doesn't exist yet.

- [ ] **Step 3: Implement**

`src/demo/wizard-flags-reference.ts`:

```ts
// src/demo/wizard-flags-reference.ts
import { note } from '@clack/prompts';
import { WIZARD_QUESTION_CATALOG } from '../wizard';

export async function runWizardFlagsReference(): Promise<void> {
  for (const entry of WIZARD_QUESTION_CATALOG) {
    note(`${entry.prompt}\n\n${entry.why}`, entry.id);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/demo/wizard-flags-reference.test.ts && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/demo/wizard-flags-reference.ts src/demo/wizard-flags-reference.test.ts
git commit -m "feat: add wizard flags reference for clispark demo"
```

---

### Task 5: Full walkthrough (real scaffold, narrated, cleanup)

**Files:**
- Create: `src/demo/full-walkthrough.ts`, `src/demo/full-walkthrough.test.ts`

**Interfaces:**
- Consumes: `scaffoldProject` (`../scaffold`), `nodeOclifPack` (`../languages/packs/node-oclif`).
- Produces: `runFullWalkthrough(): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

`src/demo/full-walkthrough.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';

vi.mock('@clack/prompts', () => ({ note: vi.fn(), log: { warn: vi.fn() } }));

function listDemoTempDirs(): string[] {
  return readdirSync(tmpdir()).filter((name) => name.startsWith('clispark-demo-'));
}

describe('runFullWalkthrough', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('scaffolds for real, narrates the key files, and removes the temp directory afterward', async () => {
    const { note } = await import('@clack/prompts');
    const { runFullWalkthrough } = await import('./full-walkthrough');
    const before = listDemoTempDirs();

    await runFullWalkthrough();

    expect(listDemoTempDirs()).toEqual(before);

    const titles = vi.mocked(note).mock.calls.map(([, title]) => title ?? '');
    expect(titles.some((t) => t.includes('base-command.ts'))).toBe(true);
    expect(titles.some((t) => t.includes('hello.ts'))).toBe(true);
    expect(titles.some((t) => t.includes('task.ts'))).toBe(true);
    expect(titles.some((t) => t.includes('task/list.ts'))).toBe(true);
    expect(titles.some((t) => t.includes('task/complete.ts'))).toBe(true);
    expect(titles.some((t) => t.includes('.NET') || t.includes('PowerShell'))).toBe(true);
  }, 30_000);

  it('falls back to a static description and still cleans up when the real scaffold throws', async () => {
    const scaffoldModule = await import('../scaffold');
    const { log } = await import('@clack/prompts');
    vi.spyOn(scaffoldModule, 'scaffoldProject').mockRejectedValueOnce(new Error('disk full'));
    const { runFullWalkthrough } = await import('./full-walkthrough');
    const before = listDemoTempDirs();

    await expect(runFullWalkthrough()).resolves.toBeUndefined();

    expect(vi.mocked(log.warn)).toHaveBeenCalledOnce();
    expect(listDemoTempDirs()).toEqual(before);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/demo/full-walkthrough.test.ts`
Expected: FAIL — `./full-walkthrough` doesn't exist yet.

- [ ] **Step 3: Implement**

`src/demo/full-walkthrough.ts`:

```ts
// src/demo/full-walkthrough.ts
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { note, log } from '@clack/prompts';
import { scaffoldProject } from '../scaffold';
import { nodeOclifPack } from '../languages/packs/node-oclif';

async function readExcerpt(dir: string, relativePath: string, maxLines = 12): Promise<string> {
  const content = await readFile(path.join(dir, relativePath), 'utf8');
  const lines = content.split('\n');
  const truncated = lines.length > maxLines;
  return lines.slice(0, maxLines).join('\n') + (truncated ? '\n  …' : '');
}

export async function runFullWalkthrough(): Promise<void> {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'clispark-demo-'));

  const sigintHandler = (): void => {
    void rm(tempDir, { recursive: true, force: true }).finally(() => process.exit(130));
  };
  process.once('SIGINT', sigintHandler);

  try {
    note(
      'Scaffolding a real, throwaway Node/oclif project in a temp directory ' +
        '(npm install, npm run build, and git init are skipped here for speed — a real ' +
        '`clispark` run also performs those).',
      'Step 1: scaffold',
    );

    try {
      await scaffoldProject(
        {
          projectName: 'demo-cli',
          targetDir: tempDir,
          lintEnabled: false,
          autocompleteEnabled: false,
        },
        nodeOclifPack,
        { runCommand: async () => {} },
      );
    } catch {
      log.warn('Could not run a live scaffold in this environment — showing a static description instead.');
      note(
        'A real `clispark` run would now have a working project at this point: base-command.ts wires up ' +
          'shared logging/error-handling that every command extends, and src/commands/ holds your first command.',
        'What would happen',
      );
      return;
    }

    const baseCommand = await readExcerpt(tempDir, 'src/base-command.ts');
    note(baseCommand, 'src/base-command.ts — shared logging & error handling, every command extends this');

    const hello = await readExcerpt(tempDir, 'src/commands/hello.ts');
    note(hello, 'src/commands/hello.ts — the minimal starting point');

    const task = await readExcerpt(tempDir, 'src/commands/task.ts');
    note(task, 'src/commands/task.ts — a required arg plus an optional enum-constrained arg');

    const taskList = await readExcerpt(tempDir, 'src/commands/task/list.ts');
    note(taskList, 'src/commands/task/list.ts — an optional arg plus a boolean flag');

    const taskComplete = await readExcerpt(tempDir, 'src/commands/task/complete.ts');
    note(taskComplete, 'src/commands/task/complete.ts — a subcommand with a required integer arg');

    note(
      'Same idea for .NET (attribute-based [CommandPath] discovery instead of a commands/ folder ' +
        'convention, native dotnet-suggest shell completion) and PowerShell (native tab-completion, ' +
        'nothing to configure) — run `clispark` yourself and pick a different language to see the full thing.',
      '.NET / PowerShell',
    );
  } finally {
    process.removeListener('SIGINT', sigintHandler);
    await rm(tempDir, { recursive: true, force: true });
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/demo/full-walkthrough.test.ts && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/demo/full-walkthrough.ts src/demo/full-walkthrough.test.ts
git commit -m "feat: add real, narrated Node scaffold walkthrough for clispark demo"
```

---

### Task 6: Menu, wiring into `program.ts`, docs, and final review

**Files:**
- Create: `src/demo/index.ts`, `src/demo/index.test.ts`
- Modify: `src/program.ts`, `src/program.test.ts`, `README.md`

**Interfaces:**
- Consumes: `runFullWalkthrough` (Task 5), `runCommandsReference` (Task 3), `runWizardFlagsReference` (Task 4).
- Produces: `runDemo(logger: Logger, program: Command): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

`src/demo/index.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';
import type { Logger } from 'pino';

vi.mock('@clack/prompts', () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  select: vi.fn(),
  isCancel: vi.fn(() => false),
  cancel: vi.fn(),
}));
vi.mock('./full-walkthrough', () => ({ runFullWalkthrough: vi.fn() }));
vi.mock('./commands-reference', () => ({ runCommandsReference: vi.fn() }));
vi.mock('./wizard-flags-reference', () => ({ runWizardFlagsReference: vi.fn() }));

const fakeLogger = {} as Logger;

describe('runDemo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('dispatches to the full walkthrough when chosen', async () => {
    const { select } = await import('@clack/prompts');
    const { runFullWalkthrough } = await import('./full-walkthrough');
    const { runCommandsReference } = await import('./commands-reference');
    const { runWizardFlagsReference } = await import('./wizard-flags-reference');
    const { runDemo } = await import('./index');
    vi.mocked(select).mockResolvedValueOnce('full');

    await runDemo(fakeLogger, new Command());

    expect(runFullWalkthrough).toHaveBeenCalledOnce();
    expect(runCommandsReference).not.toHaveBeenCalled();
    expect(runWizardFlagsReference).not.toHaveBeenCalled();
  });

  it('dispatches to the commands reference, passing the program, when chosen', async () => {
    const { select } = await import('@clack/prompts');
    const { runCommandsReference } = await import('./commands-reference');
    const { runDemo } = await import('./index');
    const program = new Command();
    vi.mocked(select).mockResolvedValueOnce('commands');

    await runDemo(fakeLogger, program);

    expect(runCommandsReference).toHaveBeenCalledWith(program);
  });

  it('dispatches to the wizard flags reference when chosen', async () => {
    const { select } = await import('@clack/prompts');
    const { runWizardFlagsReference } = await import('./wizard-flags-reference');
    const { runDemo } = await import('./index');
    vi.mocked(select).mockResolvedValueOnce('flags');

    await runDemo(fakeLogger, new Command());

    expect(runWizardFlagsReference).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/demo/index.test.ts`
Expected: FAIL — `./index` doesn't exist yet.

- [ ] **Step 3: Implement `src/demo/index.ts`**

```ts
// src/demo/index.ts
import type { Command } from 'commander';
import type { Logger } from 'pino';
import { intro, outro, select, isCancel, cancel } from '@clack/prompts';
import { runFullWalkthrough } from './full-walkthrough';
import { runCommandsReference } from './commands-reference';
import { runWizardFlagsReference } from './wizard-flags-reference';

function exitIfCancelled(value: unknown): void {
  if (isCancel(value)) {
    cancel('Operation cancelled.');
    process.exit(1);
  }
}

export async function runDemo(_logger: Logger, program: Command): Promise<void> {
  intro('clispark demo');

  const mode = await select({
    message: 'What do you want to see?',
    options: [
      { value: 'full', label: 'Complete walkthrough' },
      { value: 'commands', label: 'Just the commands' },
      { value: 'flags', label: 'Just the wizard flags' },
    ],
  });
  exitIfCancelled(mode);

  if (mode === 'full') {
    await runFullWalkthrough();
  } else if (mode === 'commands') {
    await runCommandsReference(program);
  } else {
    await runWizardFlagsReference();
  }

  outro("That's clispark in a nutshell — run `npx clispark` for real whenever you're ready.");
}
```

- [ ] **Step 4: Wire `demo` into `program.ts`**

Add the import and a new `.command('demo')` registration (placed after the existing `hook` command, before `return program;`):

```ts
import { runDemo } from './demo';
```

```ts
  program
    .command('demo')
    .description('Interactive walkthrough of clispark: commands, wizard flags, and a live example scaffold')
    .action(() => withLogging('demo', (logger) => runDemo(logger, program))());

  return program;
```

Update `src/program.test.ts`'s expected subcommand list from Task 1 to include the new command:

```ts
expect(names).toEqual(['update', 'releasenotes', 'add', 'whoami', 'hook', 'demo']);
```

- [ ] **Step 5: Run all tests to verify they pass**

Run: `npx vitest run && npx tsc --noEmit && npx eslint src scripts`
Expected: PASS

- [ ] **Step 6: Update `README.md`**

Add a short paragraph right after the Quickstart code block (before `## What you get`):

```markdown
Want a guided tour first? Run `npx clispark demo` for an interactive walkthrough covering the typical
workflow, every top-level command, and every wizard question — no project gets created.
```

- [ ] **Step 7: Real end-to-end verification**

```bash
npm run build
node dist/cli.js demo
```

Click through all three menu options in turn (rerun the command for each). Confirm:
- The full walkthrough shows real file excerpts and ends with the .NET/PowerShell note, and no `clispark-demo-*` directory remains in the OS temp directory afterward.
- The commands reference lists `update`, `releasenotes`, `add`, `whoami` (with its `--joke`/`--fact` flags), `hook`, and `demo` itself, plus the root default action and its global flags.
- The wizard flags reference lists all seven current questions.
- `node dist/cli.js --help` still lists every subcommand including the new `demo`.

- [ ] **Step 8: Update tracking docs**

- `project-ideas/clispark.plan.md`: mark #120 done, move it to `clispark.plan.changelog.md`'s history (same convention as prior shipped items).
- Comment on GitHub issue #120 summarizing what shipped, and close it.

- [ ] **Step 9: Commit**

```bash
git add src/demo/index.ts src/demo/index.test.ts src/program.ts src/program.test.ts README.md
git commit -m "feat: add clispark demo menu, wire into the CLI, document in README"
```

---

## Self-Review Notes

**Spec coverage:** menu-driven three modes ✓ (Task 6); live commands introspection including per-command flags and root global flags ✓ (Task 3, corrected during the spec's own second critical-review pass); colocated wizard-flags catalog with a real regression test (not a hardcoded count) ✓ (Task 2); real Node scaffold with no-op install/build, narrated file excerpts, example commands explained, .NET/PowerShell closing note ✓ (Task 5); cleanup via try/finally plus a SIGINT handler, graceful fallback on scaffold failure ✓ (Task 5); `withLogging('demo', ...)` consistency ✓ (Task 6); README update ✓ (Task 6). Not covered, and explicitly out of scope per spec: full .NET/PowerShell walkthroughs, any change to real scaffold/wizard behavior.

**New finding resolved while writing this plan (beyond what the spec anticipated):** the circular-import risk between `program.ts` and `demo/index.ts` (both would need each other under a naive design) — resolved via closure-passed `program` reference rather than either module importing the other's builder/runner. Also empirically resolved the spec's open question about commander's `help` command (verified: not auto-added to `.commands` in the installed version, so no filtering logic needed at all).
