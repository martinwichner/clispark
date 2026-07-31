# Custom Command-Convention Enforcement Rule (#80) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new wizard yes/no question ("Enforce command convention rule?", default No, only asked when lint tooling was accepted) that, when accepted, gives the generated project a real build/lint-time check that every discoverable command class correctly opts into the shared command machinery — a local type-aware ESLint rule enforcing `BaseCommand` inheritance (Node), or a local Roslyn analyzer project enforcing `[CommandPath]` presence (`ICliCommand` implementers, .NET) — tracked as core-managed files/fields so `clispark update` keeps them current, exactly like every other core-managed surface.

**Design spec:** `docs/superpowers/specs/2026-07-26-clispark-command-convention-rule-design.md` — read it first for the full rationale, the empirically-verified attribute-inheritance behavior, and why this is a separate feature from #70.

**Architecture decisions made while writing this plan (not fully settled at spec level — the spec explicitly deferred "exact mechanics" to this plan):**

1. **The wizard question is gated on `lintEnabled` alone, not a new pack capability flag.** Unlike `supportsAutocompleteOptIn` (#89, which varies by pack because PowerShell/`.NET` don't all support autocompletion the same way), *both* current packs (Node, .NET) support this feature identically — the only real precondition is "does the project have lint infrastructure to plug into", which is exactly `lintEnabled`. No new `LanguagePack.supportsCommandConventionOptIn` field is introduced.

2. **`eslint.config.js` never varies its own text content by `commandConventionEnabled`.** `eslint.config.js` is already a whole-file, hash-tracked core path (gated on `lintEnabled` alone, since #70) — if its *content* also depended on `commandConventionEnabled`, `clispark update`'s whole-file reconciliation (`src/update/update.ts`, which always reads the *raw, unconditional* template file and hashes it) would treat a declined project's on-disk file as stale relative to the raw template and silently rewrite it back to the "enabled" variant — the exact danger #70's own spec flagged and solved for *presence/absence*, but not solved here because this is a *content* variance within an always-present file, not presence/absence. **Resolution:** `eslint.config.js`'s text is the same in every scaffolded project regardless of `commandConventionEnabled` — it does an `existsSync` check for the rule file at config-load time and dynamically imports it only if present (see Task 3). The actual per-project behavior toggle is which files exist on disk (`eslint-rules/require-base-command.js` present or absent), not which text `eslint.config.js` contains. This avoids adding any new hook to the generic update engine.

3. **`Cli.Analyzers` is intentionally *not* added to `Cli.slnx`.** `Cli.slnx` is also a whole-file, hash-tracked core path with no manifest-aware gating today (`dotnetAdapter.coreFilePaths()` ignores its flags argument entirely). Adding a project entry to it conditionally would hit the exact same content-variance problem as point 2, with no clean runtime-conditional escape hatch (`.slnx` is inert data read by `dotnet`/an IDE, not executable). **Resolution:** skip it. MSBuild resolves `Cli.Analyzers` transitively through `Cli.csproj`'s own `<ProjectReference>` regardless of whether it's *also* listed as a top-level solution entry — `dotnet build`/`dotnet restore` (both run with no explicit project argument, solution-file auto-discovery) still build/restore it correctly. The only cost is it won't show as its own top-level node in an IDE's Solution Explorer — acceptable, since nothing in this project's generated output is meant to be hand-edited there anyway.

4. **The `<ProjectReference>` to `Cli.Analyzers` lives in `Cli.csproj`, reconciled as a new structured field** (`Cli.csproj` is the .NET adapter's `manifestFileName` — reconciled via `extractCoreFields`/`mergeManifestFile`, exactly like `TargetFramework` and the four `lintEnabled`-gated analyzer properties), **not** via `coreFilePaths` (which only tracks whole separate files, e.g. the `Cli.Analyzers/*.cs` sources themselves).

## Review Addendum (2026-07-31)

Critically re-reviewed before execution, five days after this plan was originally drafted. The overall architecture (points 1-4 above) held up under verification against the current codebase — in particular, the `eslint.config.js` content-variance resolution (point 2) and the `lintEnabled`-value wizard gate (point 1) are exactly right and match a comment already left in `src/wizard.ts` (`WIZARD_QUESTION_CATALOG`, just above the array) anticipating this feature. Two concrete, load-bearing errors were found and corrected in place throughout the plan text above/below:

1. **`import { ESLintUtils } from 'typescript-eslint'` does not work.** Verified directly against the installed `typescript-eslint@8.65.0` package's `index.d.ts`: it exports `configs`/`config`/`parser`/`plugin` only, never `ESLintUtils`/`RuleCreator`. `ESLintUtils` lives in `@typescript-eslint/utils`, which is currently only a *transitive* dependency (pulled in by `typescript-eslint`) — fine to resolve via Node's hoisting today, but not something shipped template code should `import` from directly without declaring it. **Fix applied throughout Task 3:** import from `@typescript-eslint/utils` instead; add it as an explicit, gated devDependency to `templates/node/package.json` (mirroring `AUTOCOMPLETE_DEPENDENCY_NAME`'s exact pattern — new `COMMAND_CONVENTION_DEPENDENCY_NAME` export, stripped on decline, excluded from `clispark update`'s reconciliation for a declined project, with a regression test mirroring the existing `mergeManifestFile with autocompleteEnabled` tests). Without this fix, Task 3's own RuleTester unit test would have failed immediately at Step 3/5 (`ESLintUtils` undefined) — not just the later end-to-end verification.

2. **`src/cli.ts` does not call `scaffoldProject`.** It's a thin two-line process entrypoint (`createProgram().parseAsync(process.argv)`); the actual wizard-answers-to-`scaffoldProject` wiring lives in `src/program.ts`'s `program.action(...)` callback, alongside the existing `lintEnabled`/`autocompleteEnabled` lines. All four references to `src/cli.ts` in Task 2 (File Structure list, Files, Step 3, commit) corrected to `src/program.ts`.

3. **`addProjectReference` removed from Task 4.** The original draft wrote it "for symmetry" with the `PackageReference` add-path, but the plan's own text already admitted it had no caller — no insertion path exists for `<ProjectReference>` the way there is for `<PackageReference>`. Flagged in the pre-flight conflict scan (it contradicts this project's own no-speculative-code convention and would read as dead code to any reviewer) and dropped per the human partner's call before Task 4 was dispatched.

Everything else — the .NET Roslyn analyzer (Task 4), the attribute-inheritance walk, the `Cli.slnx` exclusion, the manifest/update plumbing (Task 1), the wizard question shape (Task 2) — was checked against the current source (`src/languages/pack.ts`, `src/update/adapter.ts`, `src/update/manifest.ts`, `src/update/update.ts`, `src/update/adapters/{node-oclif,dotnet}.ts`, `templates/{node,dotnet}/**`) and holds. No other corrections were needed.

## Global Constraints

- Every task ends with `npx tsc --noEmit`, `npx eslint src scripts`, and `npx vitest run` all passing in the clispark repo root (Node-side tasks); `.NET`-side tasks additionally end with `dotnet build`/`dotnet test` passing against a real scaffolded fixture (see Task 4).
- `Manifest` gains one new required field: `commandConventionEnabled: boolean`. Every place that reads `manifest.commandConventionEnabled` or `oldManifest.commandConventionEnabled` must use it in a boolean/ternary context (`flags.commandConventionEnabled ? x : y`), never `=== true`/`=== false` — a pre-existing manifest on disk from before this feature won't have the field, and `undefined` must coerce to "not enabled", exactly like `lintEnabled`/`autocompleteEnabled` before it.
- Before considering any task finished that touches `Manifest`, `CoreFilePathsFlags`, `coreFilePaths(...)`, or `extractCoreFields(...)`, run:
  ```bash
  grep -rn "lintEnabled\s*:\s*false\|lintEnabled\s*:\s*true\|autocompleteEnabled\s*:\s*false\|autocompleteEnabled\s*:\s*true" src --include=*.ts
  ```
  and add `commandConventionEnabled: false` (or `true`, matching that specific test's intent — read each site) next to every hit. This project's own history (#70, #89 plans) shows this exact grep catches fixture sites a task's own file list misses.
- PowerShell is out of scope (no `LanguagePack` exists there yet).
- Retroactively enabling this feature on an already-scaffolded project that declined it is out of scope, same stance as #70/#89.
- Exact current versions of `@typescript-eslint/rule-tester` and any new `Microsoft.CodeAnalysis.*` NuGet packages must be verified at the point they're installed (Tasks 3 and 4) — do not assume versions from prior knowledge.

---

## File Structure

```
src/update/adapter.ts                          # MODIFY — CoreFilePathsFlags.commandConventionEnabled
src/update/manifest.ts                         # MODIFY — Manifest.commandConventionEnabled, buildManifest new param
src/update/manifest.test.ts                    # MODIFY
src/update/update.ts                           # MODIFY — newManifest.commandConventionEnabled carry-forward
src/update/update.test.ts                      # MODIFY — fixture fixups, new regression tests
src/update/adapters/node-oclif.ts              # MODIFY — coreFilePaths conditional on commandConventionEnabled
src/update/adapters/node-oclif.test.ts         # MODIFY
src/update/adapters/dotnet.ts                  # MODIFY — coreFilePaths conditional; extractProjectReference/setProjectReference; extractCoreFields/mergeManifestFile gating
src/update/adapters/dotnet.test.ts             # MODIFY
src/scaffold.ts                                # MODIFY — ScaffoldOptions.commandConventionEnabled, stripCommandConvention call, buildManifest call
src/scaffold.test.ts                           # MODIFY
src/wizard.ts                                  # MODIFY — new gated question
src/wizard.test.ts                             # MODIFY — fixture fixups, new test
src/types.ts                                   # MODIFY — WizardAnswers.commandConventionEnabled
src/program.ts                                 # MODIFY — thread commandConventionEnabled to scaffoldProject (NOT src/cli.ts — see Review Addendum)
src/languages/pack.ts                          # MODIFY — LanguagePack.stripCommandConvention (required field)
src/languages/packs/node-oclif.ts              # MODIFY — wire stripCommandConvention (no-op Task 2, real Task 3)
src/languages/packs/dotnet.ts                  # MODIFY — wire stripCommandConvention (no-op Task 2, real Task 4)
src/languages/command-convention/node.test.ts  # CREATE (Task 3) — RuleTester tests against the real template rule file
src/languages/command-convention/node.ts       # CREATE (Task 3) — stripCommandConvention(targetDir) for Node
src/languages/command-convention/dotnet.ts     # CREATE (Task 4) — stripCommandConvention(targetDir) for .NET
src/languages/command-convention/dotnet.test.ts    # CREATE (Task 4)
src/languages/command-convention/dotnet.integration.test.ts   # CREATE (Task 4) — real `dotnet build` against a scaffolded fixture
templates/node/eslint-rules/require-base-command.js   # CREATE (Task 3)
templates/node/eslint.config.js                # MODIFY (Task 3) — existsSync + dynamic import wiring
templates/node/package.json                    # MODIFY (Task 3, clispark's OWN root package.json also modified — see below) — no new generated-project devDependency needed
package.json                                   # MODIFY (Task 3) — clispark's own devDependencies gains @typescript-eslint/rule-tester
templates/dotnet/Cli.Analyzers/Cli.Analyzers.csproj    # CREATE (Task 4)
templates/dotnet/Cli.Analyzers/CommandPathAnalyzer.cs  # CREATE (Task 4)
templates/dotnet/src/Cli.csproj                # MODIFY (Task 4) — new <ItemGroup> with the ProjectReference
templates/node/ARCHITECTURE.md                 # MODIFY (Task 5)
templates/dotnet/ARCHITECTURE.md               # MODIFY (Task 5)
README.md                                      # MODIFY (Task 5)
```

---

### Task 1: Generic update-engine plumbing

**Files:**
- Modify: `src/update/adapter.ts`, `src/update/manifest.ts`, `src/update/manifest.test.ts`, `src/update/update.ts`, `src/update/update.test.ts`
- Modify (mechanical passthrough only, no behavior change yet): `src/update/adapters/node-oclif.ts`, `src/update/adapters/dotnet.ts`, and their test files

**Interfaces:**
- Produces: `Manifest.commandConventionEnabled: boolean`; `CoreFilePathsFlags.commandConventionEnabled: boolean`.

After this task, both adapters must behave identically to before it — they accept the new flag and ignore it. This isolates the generic-engine change from the two language-specific implementations (Tasks 3-4).

- [ ] **Step 1: Write the failing tests**

Add to `src/update/manifest.test.ts`:

```ts
describe('buildManifest commandConventionEnabled', () => {
  it('records commandConventionEnabled: true when passed', async () => {
    const manifest = await buildManifest(tmpRoot, '1.0.0', 'node', nodeOclifAdapter, true, false, true);
    expect(manifest.commandConventionEnabled).toBe(true);
  });

  it('records commandConventionEnabled: false when passed', async () => {
    const manifest = await buildManifest(tmpRoot, '1.0.0', 'node', nodeOclifAdapter, true, false, false);
    expect(manifest.commandConventionEnabled).toBe(false);
  });
});
```

Run the constraint grep now (Global Constraints) and fix every literal `lintEnabled`/`autocompleteEnabled` fixture it finds by adding `commandConventionEnabled: false` alongside (or `true` where the specific test is about this feature — none are yet, so `false` everywhere at this step).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run`
Expected: FAIL — `buildManifest` doesn't accept a 6th argument yet; every fixed-up literal `Manifest`/`extractCoreFields`/`coreFilePaths` call site fails to typecheck until Step 3 lands (`npx tsc --noEmit` should also fail).

- [ ] **Step 3: Implement**

`src/update/adapter.ts`:

```ts
export interface CoreFilePathsFlags {
  lintEnabled: boolean;
  autocompleteEnabled: boolean;
  commandConventionEnabled: boolean;
}
```

`src/update/manifest.ts`:

```ts
export interface Manifest {
  generatorVersion: string;
  language: string;
  lintEnabled: boolean;
  autocompleteEnabled: boolean;
  commandConventionEnabled: boolean;
  coreFiles: Record<string, string>;
  coreDependencies: Record<string, string>;
  coreScripts: Record<string, string>;
  coreFields: Record<string, unknown>;
}

export async function buildManifest(
  targetDir: string,
  generatorVersion: string,
  language: string,
  adapter: UpdateAdapter,
  lintEnabled: boolean,
  autocompleteEnabled: boolean,
  commandConventionEnabled: boolean,
): Promise<Manifest> {
  const flags = { lintEnabled, autocompleteEnabled, commandConventionEnabled };
  const coreFiles = await hashCoreFiles(targetDir, adapter, flags);
  const manifestFile = await adapter.readManifestFile(targetDir);
  const { coreDependencies, coreScripts, coreFields } = adapter.extractCoreFields(manifestFile, flags);
  return {
    generatorVersion,
    language,
    lintEnabled,
    autocompleteEnabled,
    commandConventionEnabled,
    coreFiles,
    coreDependencies,
    coreScripts,
    coreFields,
  };
}
```

(`hashCoreFiles`'s own signature is unchanged — it already takes a `CoreFilePathsFlags`-shaped object.)

`src/update/update.ts` — the `newManifest` construction gains one line:

```ts
const newManifest: Manifest = {
  generatorVersion: toVersion,
  language,
  lintEnabled: oldManifest.lintEnabled ?? false,
  autocompleteEnabled: oldManifest.autocompleteEnabled ?? false,
  commandConventionEnabled: oldManifest.commandConventionEnabled ?? false,
  coreFiles: newCoreFiles,
  coreDependencies: fileMerge.coreDependencies,
  coreScripts: fileMerge.coreScripts,
  coreFields: fileMerge.coreFields,
};
```

Every other read of `oldManifest` in `update.ts` (`adapter.coreFilePaths(oldManifest)` — twice) already passes the whole `oldManifest` object through, which structurally satisfies the widened `CoreFilePathsFlags` — no change needed at those two call sites.

`src/update/adapters/node-oclif.ts` and `src/update/adapters/dotnet.ts` — no behavior change, the flag simply flows through unused for now (both already destructure/ignore flags they don't use).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/update/adapter.ts src/update/manifest.ts src/update/manifest.test.ts src/update/update.ts src/update/update.test.ts src/update/adapters/node-oclif.ts src/update/adapters/node-oclif.test.ts src/update/adapters/dotnet.ts src/update/adapters/dotnet.test.ts
git commit -m "refactor: thread commandConventionEnabled through the update engine"
```

---

### Task 2: Wizard question + `LanguagePack.stripCommandConvention` scaffolding

**Files:**
- Modify: `src/wizard.ts`, `src/wizard.test.ts`, `src/types.ts`, `src/program.ts`, `src/scaffold.ts`, `src/scaffold.test.ts`, `src/languages/pack.ts`, `src/languages/packs/node-oclif.ts`, `src/languages/packs/dotnet.ts`

**Interfaces:**
- Consumes: `Manifest.commandConventionEnabled`, `CoreFilePathsFlags.commandConventionEnabled` (Task 1).
- Produces: `WizardAnswers.commandConventionEnabled: boolean`; `ScaffoldOptions.commandConventionEnabled?: boolean`; `LanguagePack.stripCommandConvention: (targetDir: string) => Promise<void>` (required field, no-op in both packs until Tasks 3-4 replace them).

- [ ] **Step 1: Write the failing tests**

`src/wizard.test.ts` — add a case verifying the question is skipped when lint is declined, and asked (and threaded) when accepted. Follow the existing mock-response pattern for `lintEnabled`/`autocompleteEnabled` in this file (the wizard tests mock `@clack/prompts`' `select`/`text` in call order):

```ts
it('skips the command-convention question when lint tooling was declined', async () => {
  mockSelectResponses(['node', 'private', false, false /* lintEnabled */]);
  mockTextResponses(['my-cli']);
  const answers = await runWizard({ languagePacks: { node: fakePack } });
  expect(answers.commandConventionEnabled).toBe(false);
});

it('asks and records the command-convention question when lint tooling was accepted', async () => {
  mockSelectResponses(['node', 'private', false, true /* lintEnabled */, true /* commandConventionEnabled */]);
  mockTextResponses(['my-cli']);
  const answers = await runWizard({ languagePacks: { node: fakePack } });
  expect(answers.commandConventionEnabled).toBe(true);
});
```

(Adjust the exact mock-helper names/call shapes to match whatever this file's existing `lintEnabled`/`autocompleteEnabled` tests already use — read those two tests first and mirror their exact mocking mechanism; the snippet above shows intent, not the literal helper API.)

Also run the Global Constraints grep and fix `fakeUpdateAdapter`/any other fixture in this file needing `commandConventionEnabled`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run`
Expected: FAIL — `runWizard` doesn't ask the new question yet, `WizardAnswers` doesn't have the field yet.

- [ ] **Step 3: Implement**

`src/types.ts`:

```ts
export interface WizardAnswers {
  language: string;
  projectName: string;
  profile: Profile;
  registryUrl: string;
  publishIntent: boolean;
  nameAvailability: NameCheckResult;
  lintEnabled: boolean;
  autocompleteEnabled: boolean;
  commandConventionEnabled: boolean;
}
```

`src/wizard.ts` — insert right after the existing `lintEnabled` question, before the `autocompleteEnabled` question (order doesn't matter functionally, but keeping the two lint-adjacent questions together reads better):

```ts
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
```

And add `commandConventionEnabled` to the final returned object.

`src/scaffold.ts`:

```ts
export interface ScaffoldOptions {
  projectName: string;
  targetDir: string;
  registryUrl?: string;
  publishIntent?: boolean;
  lintEnabled?: boolean;
  autocompleteEnabled?: boolean;
  commandConventionEnabled?: boolean;
}
```

In `scaffoldProject`, after the existing `autocompleteEnabled` block:

```ts
  const commandConventionEnabled = options.commandConventionEnabled ?? false;
  if (!commandConventionEnabled) {
    await pack.stripCommandConvention(targetDir);
  }
  const manifest = await buildManifest(
    targetDir,
    getGeneratorVersion(),
    pack.id,
    pack.updateAdapter,
    lintEnabled,
    autocompleteEnabled,
    commandConventionEnabled,
  );
```

`src/languages/pack.ts` — add the required field:

```ts
export interface LanguagePack {
  // ...existing fields
  readonly stripCommandConvention: (targetDir: string) => Promise<void>;
}
```

`src/languages/packs/node-oclif.ts` and `src/languages/packs/dotnet.ts` — temporary no-op (both replaced in Tasks 3/4):

```ts
stripCommandConvention: async () => {},
```

`src/program.ts` — thread the answer through (in the `program.action(...)` callback that already calls `scaffoldProject`, around the existing `lintEnabled`/`autocompleteEnabled` lines):

```ts
    await scaffoldProject(
      {
        projectName: answers.projectName,
        targetDir,
        registryUrl: answers.registryUrl,
        publishIntent: answers.publishIntent,
        lintEnabled: answers.lintEnabled,
        autocompleteEnabled: answers.autocompleteEnabled,
        commandConventionEnabled: answers.commandConventionEnabled,
      },
      pack,
    );
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/wizard.ts src/wizard.test.ts src/types.ts src/program.ts src/scaffold.ts src/scaffold.test.ts src/languages/pack.ts src/languages/packs/node-oclif.ts src/languages/packs/dotnet.ts
git commit -m "feat: add gated wizard question for command-convention enforcement"
```

---

### Task 3: Node — local ESLint rule

**Files:**
- Create: `templates/node/eslint-rules/require-base-command.js`, `src/languages/command-convention/node.ts`, `src/languages/command-convention/node.test.ts`
- Modify: `templates/node/eslint.config.js`, `templates/node/package.json` (new gated devDependency — see Review Addendum), `package.json` (clispark's own root), `src/update/adapters/node-oclif.ts`, `src/update/adapters/node-oclif.test.ts`, `src/languages/packs/node-oclif.ts`

**Interfaces:**
- Consumes: `LanguagePack.stripCommandConvention` slot (Task 2, currently no-op for the Node pack).
- Produces: `stripCommandConvention(targetDir: string): Promise<void>` (real Node implementation, replaces Task 2's no-op — now also removes a devDependency, not just the rule file).

- [ ] **Step 1: Install the rule-testing devDependency**

```bash
npm install --save-dev @typescript-eslint/rule-tester
```

Verify the installed version actually matches the `typescript-eslint@^8.63.0` line already in `package.json` (both must be on the same major — check `node_modules/@typescript-eslint/rule-tester/package.json` after install, don't assume).

- [ ] **Step 2: Write the failing test**

`src/languages/command-convention/node.test.ts`:

```ts
import { RuleTester } from '@typescript-eslint/rule-tester';
import path from 'node:path';
import requireBaseCommand from '../../../templates/node/eslint-rules/require-base-command.js';

const ruleTester = new RuleTester({
  languageOptions: {
    parserOptions: {
      project: path.join(import.meta.dirname, 'fixtures', 'tsconfig.json'),
      tsconfigRootDir: path.join(import.meta.dirname, 'fixtures'),
    },
  },
});

ruleTester.run('require-base-command', requireBaseCommand, {
  valid: [
    {
      code: `
        import { BaseCommand } from '../base-command';
        export default class Hello extends BaseCommand {
          async run() {}
        }
      `,
      filename: path.join(import.meta.dirname, 'fixtures', 'src', 'commands', 'hello.ts'),
    },
    {
      code: `
        import { BaseCommand } from '../base-command';
        abstract class TaskCommandBase extends BaseCommand {}
        export default class TaskList extends TaskCommandBase {
          async run() {}
        }
      `,
      filename: path.join(import.meta.dirname, 'fixtures', 'src', 'commands', 'task', 'list.ts'),
    },
  ],
  invalid: [
    {
      code: `
        import { Command } from '@oclif/core';
        export default class Hello extends Command {
          async run() {}
        }
      `,
      filename: path.join(import.meta.dirname, 'fixtures', 'src', 'commands', 'hello.ts'),
      errors: [{ messageId: 'mustExtendBaseCommand' }],
    },
    {
      code: `
        export default class Hello {
          async run() {}
        }
      `,
      filename: path.join(import.meta.dirname, 'fixtures', 'src', 'commands', 'hello.ts'),
      errors: [{ messageId: 'mustExtendBaseCommand' }],
    },
  ],
});
```

Create the minimal fixture project the type-aware rule needs to resolve types against: `src/languages/command-convention/fixtures/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true
  },
  "include": ["src/**/*.ts", "base-command.ts"]
}
```

`src/languages/command-convention/fixtures/base-command.ts` (a minimal stand-in mirroring the shape of `templates/node/src/base-command.ts`, so the rule's type-walk has a real class hierarchy to resolve — not the full oclif `Command` class, just enough structure for the base-type walk):

```ts
export abstract class Command {
  abstract run(): Promise<void>;
}

export abstract class BaseCommand extends Command {}
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/languages/command-convention/node.test.ts`
Expected: FAIL — `templates/node/eslint-rules/require-base-command.js` doesn't exist yet.

- [ ] **Step 4: Implement the rule**

`templates/node/eslint-rules/require-base-command.js`:

```js
// templates/node/eslint-rules/require-base-command.js
import { ESLintUtils } from '@typescript-eslint/utils';

const createRule = ESLintUtils.RuleCreator(() => 'https://github.com/martinwichner/clispark');

function extendsBaseCommand(classType) {
  let current = classType;
  while (current) {
    if (current.getSymbol()?.getName() === 'BaseCommand') return true;
    const baseTypes = current.getBaseTypes?.() ?? [];
    if (baseTypes.some((base) => extendsBaseCommand(base))) return true;
    current = undefined;
  }
  return false;
}

export default createRule({
  name: 'require-base-command',
  meta: {
    type: 'problem',
    docs: {
      description: 'Every discovered command class must (transitively) extend BaseCommand, or it silently loses shared logging/error-handling.',
    },
    messages: {
      mustExtendBaseCommand: 'Command classes in src/commands/** must extend BaseCommand (directly or via an intermediate base class), not {{actual}}.',
    },
    schema: [],
  },
  defaultOptions: [],
  create(context) {
    const services = ESLintUtils.getParserServices(context);
    const checker = services.program.getTypeChecker();

    return {
      'ExportDefaultDeclaration > ClassDeclaration'(node) {
        const classType = services.getTypeAtLocation(node);
        if (!extendsBaseCommandChain(classType, checker)) {
          const actual = node.superClass ? context.sourceCode.getText(node.superClass) : 'nothing';
          context.report({ node, messageId: 'mustExtendBaseCommand', data: { actual } });
        }
      },
    };
  },
});

function extendsBaseCommandChain(classType, checker) {
  const visited = new Set();
  function walk(type) {
    const symbol = type.getSymbol();
    if (symbol?.getName() === 'BaseCommand') return true;
    const key = symbol?.getName() ?? type.toString();
    if (visited.has(key)) return false;
    visited.add(key);
    const baseTypes = checker.getBaseTypes(type) ?? [];
    return baseTypes.some((base) => walk(base));
  }
  return walk(classType);
}
```

**(Note: the standalone `extendsBaseCommand` helper defined first is dead — remove it; `extendsBaseCommandChain` is the real, used implementation, written second because it needs `checker` which is only available inside `create()`. Clean up before Step 5.)**

Wire it into the always-present config:

`templates/node/eslint.config.js`:

```js
// eslint.config.js
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const ruleFilePath = path.join(dirname, 'eslint-rules', 'require-base-command.js');

const commandConventionConfig = existsSync(ruleFilePath)
  ? [
      {
        files: ['src/commands/**/*.ts'],
        plugins: {
          local: {
            rules: {
              'require-base-command': (await import('./eslint-rules/require-base-command.js')).default,
            },
          },
        },
        rules: {
          'local/require-base-command': 'error',
        },
      },
    ]
  : [];

export default tseslint.config(
  {
    ignores: ['dist/**'],
  },
  {
    files: ['src/**/*.ts', 'bin/**/*.ts'],
    extends: [
      eslint.configs.recommended,
      ...tseslint.configs.recommended,
      eslintConfigPrettier,
    ],
  },
  ...commandConventionConfig,
);
```

This file's text is now identical in every scaffolded project regardless of `commandConventionEnabled` — see Architecture decision 2 above. Nothing about this file needs to change based on the flag ever again; only `eslint-rules/require-base-command.js`'s presence/absence does.

`src/languages/command-convention/node.ts`:

```ts
// src/languages/command-convention/node.ts
import { rm } from 'node:fs/promises';
import path from 'node:path';

export const COMMAND_CONVENTION_DEPENDENCY_NAME = '@typescript-eslint/utils';

export async function stripCommandConvention(targetDir: string): Promise<void> {
  await rm(path.join(targetDir, 'eslint-rules', 'require-base-command.js'), { force: true });

  const pkgPath = path.join(targetDir, 'package.json');
  const pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
  delete pkg.devDependencies?.[COMMAND_CONVENTION_DEPENDENCY_NAME];
  await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
}
```

(`readFile`/`writeFile` need adding to this file's existing `node:fs/promises` import alongside `rm`.)

**`templates/node/package.json` needs a new devDependency, added in this task:**

```bash
npm install --save-dev @typescript-eslint/utils
```

run from inside `templates/node/` conceptually — in practice just hand-add `"@typescript-eslint/utils": "^8.65.0"` (match whatever version `typescript-eslint` in that same `package.json` currently pins — **verify at implementation time, don't assume 8.65.0 is still current**) to `templates/node/package.json`'s `devDependencies`.

This devDependency is genuinely new, correcting an assumption error in the original spec/plan draft: `import { ESLintUtils } from 'typescript-eslint'` does **not** work — the `typescript-eslint` meta-package (verified against its installed `index.d.ts`, v8.65.0) only exports `configs`/`config`/`parser`/`plugin`, not `ESLintUtils`/`RuleCreator`. `@typescript-eslint/utils` is where `ESLintUtils` actually lives; it's already present today only as a *transitive* dependency (pulled in by `typescript-eslint`), which is fragile to `import` from directly in shipped template code (works via hoisting today, not guaranteed, and would break under a strict/isolated resolver). Declare it explicitly, gated exactly like `@oclif/plugin-autocomplete` (`AUTOCOMPLETE_DEPENDENCY_NAME` in `autocomplete-support/node.ts`) is gated — see the reconciliation-filter change below.

Wire the pack:

`src/languages/packs/node-oclif.ts`:

```ts
import { stripCommandConvention } from '../command-convention/node';
// ...
  stripCommandConvention,
```

`src/update/adapters/node-oclif.ts` — add the rule file to `coreFilePaths`, gated:

```ts
coreFilePaths(flags) {
  const base = flags.lintEnabled
    ? [...CORE_FILE_PATHS, 'eslint.config.js', '.prettierrc', '.prettierignore']
    : CORE_FILE_PATHS;
  return flags.commandConventionEnabled ? [...base, 'eslint-rules/require-base-command.js'] : base;
},
```

**Also gate the new devDependency in `mergePackageJson`'s `dependencyNames` filter** (the same function that already excludes `LINT_DEPENDENCY_NAMES` and `AUTOCOMPLETE_DEPENDENCY_NAME` for a declined project — add a third clause, same shape):

```ts
import { COMMAND_CONVENTION_DEPENDENCY_NAME } from '../../languages/command-convention/node';

// ...
  const dependencyNames = new Set(
    [...Object.keys(newTemplatePkg.dependencies ?? {}), ...Object.keys(newTemplatePkg.devDependencies ?? {})].filter(
      (name) =>
        (oldManifest.lintEnabled || !(LINT_DEPENDENCY_NAMES as readonly string[]).includes(name)) &&
        (oldManifest.autocompleteEnabled || name !== AUTOCOMPLETE_DEPENDENCY_NAME) &&
        (oldManifest.commandConventionEnabled || name !== COMMAND_CONVENTION_DEPENDENCY_NAME),
    ),
  );
```

Without this, `clispark update` would silently re-add `@typescript-eslint/utils` to a project that explicitly declined the command-convention rule — exactly the danger #70's own spec flagged and the autocomplete dependency filter already guards against for its own dependency.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/languages/command-convention/node.test.ts`
Expected: PASS (both valid cases clean, both invalid cases report `mustExtendBaseCommand`)

- [ ] **Step 6: Write and run the update-reconciliation regression tests**

Add to `src/update/adapters/node-oclif.test.ts`:

```ts
describe('coreFilePaths commandConventionEnabled gating', () => {
  it('excludes the rule file when commandConventionEnabled is false', () => {
    const paths = nodeOclifAdapter.coreFilePaths({ lintEnabled: true, autocompleteEnabled: false, commandConventionEnabled: false });
    expect(paths).not.toContain('eslint-rules/require-base-command.js');
  });

  it('includes the rule file when commandConventionEnabled is true', () => {
    const paths = nodeOclifAdapter.coreFilePaths({ lintEnabled: true, autocompleteEnabled: false, commandConventionEnabled: true });
    expect(paths).toContain('eslint-rules/require-base-command.js');
  });
});

describe('mergeManifestFile with commandConventionEnabled', () => {
  it('excludes the @typescript-eslint/utils dependency from reconciliation when declined, even if present in the template', () => {
    const current = { name: 'my-cli', version: '1.0.0', devDependencies: {} };
    const newTemplate = {
      name: '{{projectName}}',
      version: '0.0.0',
      devDependencies: { '@typescript-eslint/utils': '^8.65.0' },
    };
    const result = mergeManifestFile(current, baseManifest({ lintEnabled: true, commandConventionEnabled: false }), newTemplate);
    expect(result.dependencies).not.toContainEqual(expect.objectContaining({ key: '@typescript-eslint/utils' }));
  });

  it('reconciles the @typescript-eslint/utils dependency normally when opted in', () => {
    const current = { name: 'my-cli', version: '1.0.0', devDependencies: {} };
    const newTemplate = {
      name: '{{projectName}}',
      version: '0.0.0',
      devDependencies: { '@typescript-eslint/utils': '^8.65.0' },
    };
    const result = mergeManifestFile(current, baseManifest({ lintEnabled: true, commandConventionEnabled: true }), newTemplate);
    expect(result.dependencies).toContainEqual({ key: '@typescript-eslint/utils', outcome: 'added' });
  });
});
```

(Mirror this file's existing `mergeManifestFile with autocompleteEnabled` describe block exactly — same shape, same helper functions, just the new dependency name and flag.)

Add to `src/update/update.test.ts` (mirroring the existing "never adds a declined core file back" regression test written for #70's `eslint.config.js`/#89's autocomplete dependency — find that test and copy its exact setup shape, substituting the rule-file path):

```ts
it('never re-adds the command-convention rule file to a project that declined it', async () => {
  // scaffold with lintEnabled: true, commandConventionEnabled: false
  // run updateProject
  // assert: 'eslint-rules/require-base-command.js' is absent from result.files entirely
  //   (not 'added', not present at all — it must never appear, matching the coreFilePaths gating above)
});
```

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 7: Real end-to-end verification**

Scaffold a throwaway project with lint + command-convention enabled, break one command file, confirm ESLint actually catches it:

```bash
node dist/cli.js   # answer: node, some-name, private, no publish, yes lint, yes command-convention
cd some-name
# edit src/commands/hello.ts: change `extends BaseCommand` to `extends Command` (import Command from '@oclif/core' instead)
npx eslint src
```

Expected: ESLint reports `local/require-base-command` on the edited file. Revert the edit, confirm `npx eslint src` is clean again. Delete the throwaway project afterward.

- [ ] **Step 8: Commit**

```bash
git add templates/node/eslint-rules/require-base-command.js templates/node/eslint.config.js templates/node/package.json src/languages/command-convention/node.ts src/languages/command-convention/node.test.ts src/languages/command-convention/fixtures src/languages/packs/node-oclif.ts src/update/adapters/node-oclif.ts src/update/adapters/node-oclif.test.ts src/update/update.test.ts package.json package-lock.json
git commit -m "feat: Node command-convention ESLint rule enforcing BaseCommand inheritance"
```

---

### Task 4: .NET — local Roslyn analyzer project

**Files:**
- Create: `templates/dotnet/Cli.Analyzers/Cli.Analyzers.csproj`, `templates/dotnet/Cli.Analyzers/CommandPathAnalyzer.cs`, `src/languages/command-convention/dotnet.ts`, `src/languages/command-convention/dotnet.test.ts`, `src/languages/command-convention/dotnet.integration.test.ts`
- Modify: `templates/dotnet/src/Cli.csproj`, `src/update/adapters/dotnet.ts`, `src/update/adapters/dotnet.test.ts`, `src/languages/packs/dotnet.ts`

**Interfaces:**
- Consumes: `LanguagePack.stripCommandConvention` slot (Task 2, currently no-op for the .NET pack).
- Produces: `stripCommandConvention(targetDir: string): Promise<void>` (real .NET implementation).

- [ ] **Step 1: Write the analyzer project (no test yet — this step establishes the fixture the tests in Step 2+ build against)**

`templates/dotnet/Cli.Analyzers/Cli.Analyzers.csproj`:

```xml
<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <TargetFramework>netstandard2.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
    <IsPackable>false</IsPackable>
    <EnforceExtendedAnalyzerRules>true</EnforceExtendedAnalyzerRules>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="Microsoft.CodeAnalysis.Analyzers" Version="3.11.0" PrivateAssets="all" />
    <PackageReference Include="Microsoft.CodeAnalysis.CSharp" Version="4.12.0" PrivateAssets="all" />
  </ItemGroup>

</Project>
```

**Verify both package versions actually exist and resolve before proceeding** — run `dotnet restore` in a throwaway copy of this file and adjust versions if either fails; do not assume these numbers are still current.

`templates/dotnet/Cli.Analyzers/CommandPathAnalyzer.cs`:

```csharp
using System.Collections.Immutable;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Microsoft.CodeAnalysis.Diagnostics;

namespace Cli.Analyzers;

[DiagnosticAnalyzer(LanguageNames.CSharp)]
public sealed class CommandPathAnalyzer : DiagnosticAnalyzer
{
    public const string DiagnosticId = "CLISPARK001";

    private static readonly DiagnosticDescriptor Rule = new(
        DiagnosticId,
        title: "ICliCommand implementers must carry [CommandPath]",
        messageFormat: "'{0}' implements ICliCommand but has no [CommandPath] attribute (checked including inherited base types) -- command discovery will crash at runtime",
        category: "Usage",
        DiagnosticSeverity.Error,
        isEnabledByDefault: true);

    public override ImmutableArray<DiagnosticDescriptor> SupportedDiagnostics => ImmutableArray.Create(Rule);

    public override void Initialize(AnalysisContext context)
    {
        context.ConfigureGeneratedCodeAnalysis(GeneratedCodeAnalysisFlags.None);
        context.EnableConcurrentExecution();
        context.RegisterSyntaxNodeAction(AnalyzeClassDeclaration, SyntaxKind.ClassDeclaration);
    }

    private static void AnalyzeClassDeclaration(SyntaxNodeAnalysisContext context)
    {
        var classDeclaration = (ClassDeclarationSyntax)context.Node;
        if (context.SemanticModel.GetDeclaredSymbol(classDeclaration) is not INamedTypeSymbol classSymbol) return;
        if (classSymbol.IsAbstract) return;

        var implementsICliCommand = classSymbol.AllInterfaces.Any(i => i.Name == "ICliCommand");
        if (!implementsICliCommand) return;

        if (HasCommandPathAttribute(classSymbol)) return;

        context.ReportDiagnostic(Diagnostic.Create(Rule, classDeclaration.Identifier.GetLocation(), classSymbol.Name));
    }

    // Walks the base-type chain, not just the declared type -- CommandPathAttribute has no
    // [AttributeUsage(Inherited = false)] override, so the CLR default (Inherited = true)
    // applies, and CommandDiscovery.cs's GetCustomAttribute<CommandPathAttribute>() call uses
    // the default inherit:true parameter too. A subclass that inherits [CommandPath] from a
    // base command class works fine at runtime; flagging it here would be a false positive.
    private static bool HasCommandPathAttribute(INamedTypeSymbol? type)
    {
        for (var current = type; current is not null; current = current.BaseType)
        {
            if (current.GetAttributes().Any(a => a.AttributeClass?.Name == "CommandPathAttribute")) return true;
        }
        return false;
    }
}
```

`templates/dotnet/src/Cli.csproj` — new `<ItemGroup>` appended after the existing `PackageReference` one:

```xml
  <ItemGroup>
    <ProjectReference Include="..\Cli.Analyzers\Cli.Analyzers.csproj" OutputItemType="Analyzer" ReferenceOutputAssembly="false" />
  </ItemGroup>
```

- [ ] **Step 2: Write the failing unit tests (pure string/regex-level, no `dotnet` invocation)**

`src/languages/command-convention/dotnet.test.ts` (mirrors `src/languages/lint-support/node.test.ts`'s temp-dir style):

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { stripCommandConvention } from './dotnet';

describe('stripCommandConvention (dotnet)', () => {
  let targetDir: string;

  beforeEach(async () => {
    targetDir = await mkdtemp(path.join(tmpdir(), 'clispark-strip-convention-test-'));
    await mkdir(path.join(targetDir, 'Cli.Analyzers'), { recursive: true });
    await writeFile(path.join(targetDir, 'Cli.Analyzers', 'Cli.Analyzers.csproj'), '<Project Sdk="Microsoft.NET.Sdk"></Project>\n');
    await writeFile(path.join(targetDir, 'Cli.Analyzers', 'CommandPathAnalyzer.cs'), 'namespace Cli.Analyzers;\n');
    await mkdir(path.join(targetDir, 'src'), { recursive: true });
    await writeFile(
      path.join(targetDir, 'src', 'Cli.csproj'),
      [
        '<Project Sdk="Microsoft.NET.Sdk">',
        '',
        '  <ItemGroup>',
        '    <PackageReference Include="System.CommandLine" Version="2.0.10" />',
        '  </ItemGroup>',
        '',
        '  <ItemGroup>',
        '    <ProjectReference Include="..\\Cli.Analyzers\\Cli.Analyzers.csproj" OutputItemType="Analyzer" ReferenceOutputAssembly="false" />',
        '  </ItemGroup>',
        '',
        '</Project>',
        '',
      ].join('\r\n'),
    );
  });

  afterEach(async () => {
    await rm(targetDir, { recursive: true, force: true });
  });

  it('removes the Cli.Analyzers directory entirely', async () => {
    await stripCommandConvention(targetDir);
    await expect(readFile(path.join(targetDir, 'Cli.Analyzers', 'Cli.Analyzers.csproj'), 'utf8')).rejects.toThrow();
  });

  it('removes the ProjectReference ItemGroup from Cli.csproj, keeps the rest', async () => {
    await stripCommandConvention(targetDir);
    const content = await readFile(path.join(targetDir, 'src', 'Cli.csproj'), 'utf8');
    expect(content).not.toContain('Cli.Analyzers');
    expect(content).toContain('System.CommandLine');
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/languages/command-convention/dotnet.test.ts`
Expected: FAIL — `./dotnet` module doesn't exist yet.

- [ ] **Step 4: Implement**

`src/languages/command-convention/dotnet.ts`:

```ts
// src/languages/command-convention/dotnet.ts
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function stripCommandConvention(targetDir: string): Promise<void> {
  await rm(path.join(targetDir, 'Cli.Analyzers'), { recursive: true, force: true });

  const csprojPath = path.join(targetDir, 'src', 'Cli.csproj');
  const content = await readFile(csprojPath, 'utf8');
  // \r?\n for the same reason lint-support/dotnet.ts's PropertyGroup strip uses it: real
  // scaffolded .csproj files use CRLF, a bare \n would silently fail to match on Windows.
  const updated = content.replace(
    /\r?\n\s*<ItemGroup>\s*\r?\n\s*<ProjectReference Include="\.\.\\Cli\.Analyzers\\Cli\.Analyzers\.csproj"[^\n]*\r?\n\s*<\/ItemGroup>\r?\n/,
    '\n',
  );
  await writeFile(csprojPath, updated);
}
```

Wire the pack:

`src/languages/packs/dotnet.ts`:

```ts
import { stripCommandConvention } from '../command-convention/dotnet';
// ...
  stripCommandConvention,
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/languages/command-convention/dotnet.test.ts`
Expected: PASS

- [ ] **Step 6: `coreFilePaths` and manifest-file reconciliation (the .NET adapter's own tests)**

`src/update/adapters/dotnet.ts` — `coreFilePaths` becomes conditional (it currently ignores its argument entirely):

```ts
export const ANALYZER_FILE_PATHS = ['Cli.Analyzers/Cli.Analyzers.csproj', 'Cli.Analyzers/CommandPathAnalyzer.cs'] as const;

// ...
coreFilePaths(flags) {
  return flags.commandConventionEnabled ? [...CORE_FILE_PATHS, ...ANALYZER_FILE_PATHS] : CORE_FILE_PATHS;
},
```

Add the `<ProjectReference>` extraction/reconciliation, parallel in spirit to `ANALYZER_PROPERTY_NAMES`/`extractAnalyzerProperties` but for a whole element rather than a value inside a tag pair:

```ts
const PROJECT_REFERENCE_LINE =
  /<ProjectReference Include="\.\.\\Cli\.Analyzers\\Cli\.Analyzers\.csproj"[^\n]*\/>/;

function extractProjectReference(content: string): string | undefined {
  return content.match(PROJECT_REFERENCE_LINE)?.[0];
}

function setProjectReference(content: string, value: string): string {
  return content.replace(PROJECT_REFERENCE_LINE, value);
}
```

Extend `DotnetManifestFile` and `parseManifestFile`:

```ts
export interface DotnetManifestFile {
  raw: string;
  version: string;
  targetFramework: string;
  packageId: string;
  toolCommandName: string;
  packageReferences: Record<string, string>;
  analyzerProperties: Partial<Record<AnalyzerPropertyName, string>>;
  projectReference: string | undefined;
}

function parseManifestFile(rawContent: string): DotnetManifestFile {
  return {
    raw: rawContent,
    version: extractTag(rawContent, 'Version'),
    targetFramework: extractTag(rawContent, 'TargetFramework'),
    packageId: extractTag(rawContent, 'PackageId'),
    toolCommandName: extractTag(rawContent, 'ToolCommandName'),
    packageReferences: extractPackageReferences(rawContent),
    analyzerProperties: extractAnalyzerProperties(rawContent),
    projectReference: extractProjectReference(rawContent),
  };
}
```

In `extractCoreFields`, gate on `flags.commandConventionEnabled` (mirrors the existing `flags.lintEnabled` block for analyzer properties exactly):

```ts
function extractCoreFields(manifestFile: DotnetManifestFile, flags: CoreFilePathsFlags): CoreFieldsExtraction {
  const coreFields: Record<string, unknown> = { TargetFramework: manifestFile.targetFramework };
  if (flags.lintEnabled) {
    for (const name of ANALYZER_PROPERTY_NAMES) {
      const value = manifestFile.analyzerProperties[name];
      if (value !== undefined) coreFields[name] = value;
    }
  }
  if (flags.commandConventionEnabled && manifestFile.projectReference !== undefined) {
    coreFields.projectReference = manifestFile.projectReference;
  }
  return {
    coreDependencies: manifestFile.packageReferences,
    coreScripts: {},
    coreFields,
  };
}
```

In `mergeManifestFile`, add the reconciliation block right after the existing analyzer-properties `if (oldManifest.lintEnabled)` block — same "missing tag on an opted-in project is a no-op, not an insertion" caveat as that block, since a hand-edited project could have removed the line while manifest still says opted-in:

```ts
  if (oldManifest.commandConventionEnabled) {
    const newValue = newTemplate.projectReference;
    if (newValue !== undefined) {
      const currentValue = current.projectReference;
      if (currentValue === undefined) {
        fields.push({ key: 'projectReference', outcome: 'skipped' });
      } else {
        const oldValue = (oldCoreFields as { projectReference?: string }).projectReference;
        const result = reconcileEntry(currentValue, oldValue, newValue, stringEquals);
        fields.push({ key: 'projectReference', outcome: result.outcome });
        coreFields.projectReference = result.value;
        if (result.outcome !== 'skipped' && result.value !== currentValue) {
          changed = true;
          raw = setProjectReference(raw, result.value);
        }
      }
    }
  }
```

(No `addProjectReference` function — **corrected 2026-07-31, see Review Addendum:** the original draft defined one "for symmetry" with the `PackageReference` add-path, but it had no caller anywhere in this plan; YAGNI, and this project's own conventions reject speculative unused code. If a real insertion path is ever needed, write it then. Same reasoning as the analyzer properties above having no insertion path either.)

- [ ] **Step 7: Write and run the adapter regression tests**

Add to `src/update/adapters/dotnet.test.ts`, mirroring the existing analyzer-properties tests' shape:

```ts
describe('coreFilePaths commandConventionEnabled gating', () => {
  it('excludes the analyzer project files when commandConventionEnabled is false', () => {
    const paths = dotnetAdapter.coreFilePaths({ lintEnabled: false, autocompleteEnabled: false, commandConventionEnabled: false });
    expect(paths).not.toContain('Cli.Analyzers/Cli.Analyzers.csproj');
  });

  it('includes the analyzer project files when commandConventionEnabled is true', () => {
    const paths = dotnetAdapter.coreFilePaths({ lintEnabled: false, autocompleteEnabled: false, commandConventionEnabled: true });
    expect(paths).toContain('Cli.Analyzers/Cli.Analyzers.csproj');
    expect(paths).toContain('Cli.Analyzers/CommandPathAnalyzer.cs');
  });
});

describe('ProjectReference reconciliation', () => {
  it('never reconciles projectReference for a project that declined the feature', () => {
    const manifestFile = parseManifestFile(CSPROJ_WITHOUT_PROJECT_REFERENCE_FIXTURE);
    const result = dotnetAdapter.mergeManifestFile(manifestFile, { ...baseManifest, commandConventionEnabled: false }, manifestFile);
    expect(result.fields.find((f) => f.key === 'projectReference')).toBeUndefined();
  });
});
```

Run the Global Constraints grep and fix every `Manifest`/`extractCoreFields`/`coreFilePaths` fixture in this file and `src/update/update.test.ts`.

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 8: Real end-to-end verification (the .NET analyzer, actually compiled)**

Unlike Node's ESLint rule (directly `import()`-able and unit-testable from vitest), the Roslyn analyzer only proves itself correct when actually compiled by `dotnet build` — there is no C# test project in clispark's own repo to host a proper `Microsoft.CodeAnalysis.CSharp.Analyzer.Testing` suite, and adding one is out of scope for this plan (a possible future follow-up, not blocking). Verify manually, the same way #70's `EnableNETAnalyzers` default was verified:

```bash
node dist/cli.js   # answer: dotnet, SomeName, private, no publish, yes lint, yes command-convention
cd SomeName
# add a new file src/Commands/BrokenCommand.cs:
#   namespace Cli.Commands;
#   public class BrokenCommand : ICliCommand
#   {
#       public System.CommandLine.Command Build() => new("broken");
#   }
# (implements ICliCommand, no [CommandPath] -- the exact case CLISPARK001 exists for)
dotnet build
```

Expected: build fails with `error CLISPARK001: 'BrokenCommand' implements ICliCommand but has no [CommandPath] attribute...`. Add `[CommandPath("broken")]` to the class, rebuild, confirm it now succeeds. Delete the throwaway project afterward.

Additionally, write one real (not mocked) integration test that automates the same check via `dotnet build`, so this doesn't regress silently in the future:

`src/languages/command-convention/dotnet.integration.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dotnetPack } from '../packs/dotnet';
import { scaffoldProject } from '../../scaffold';

const execFileAsync = promisify(execFile);

describe('CommandPathAnalyzer (real dotnet build)', () => {
  it('fails the build when a command implements ICliCommand without [CommandPath]', async () => {
    const targetDir = await mkdtemp(path.join(tmpdir(), 'clispark-analyzer-integration-'));
    try {
      await scaffoldProject(
        { projectName: 'AnalyzerCheck', targetDir, lintEnabled: true, commandConventionEnabled: true },
        dotnetPack,
        { runCommand: async () => {} }, // skip git/restore/build during scaffold itself
      );

      const brokenCommandPath = path.join(targetDir, 'src', 'Commands', 'BrokenCommand.cs');
      await writeFile(
        brokenCommandPath,
        [
          'namespace Cli.Commands;',
          '',
          'public class BrokenCommand : ICliCommand',
          '{',
          '    public System.CommandLine.Command Build() => new("broken");',
          '}',
          '',
        ].join('\n'),
      );

      await execFileAsync('dotnet', ['restore'], { cwd: targetDir });
      await expect(execFileAsync('dotnet', ['build'], { cwd: targetDir })).rejects.toThrow(/CLISPARK001/);
    } finally {
      await rm(targetDir, { recursive: true, force: true });
    }
  }, 120_000); // real dotnet restore+build is slow; generous timeout
});
```

Run: `npx vitest run src/languages/command-convention/dotnet.integration.test.ts`
Expected: PASS (allow extra time for real `dotnet restore`/`build`)

- [ ] **Step 9: Commit**

```bash
git add templates/dotnet/Cli.Analyzers templates/dotnet/src/Cli.csproj src/languages/command-convention/dotnet.ts src/languages/command-convention/dotnet.test.ts src/languages/command-convention/dotnet.integration.test.ts src/languages/packs/dotnet.ts src/update/adapters/dotnet.ts src/update/adapters/dotnet.test.ts src/update/update.test.ts
git commit -m "feat: .NET command-convention Roslyn analyzer enforcing [CommandPath]"
```

---

### Task 5: Docs and whole-branch review

**Files:**
- Modify: `templates/node/ARCHITECTURE.md`, `templates/dotnet/ARCHITECTURE.md`, `README.md`

**Interfaces:** none (documentation only).

- [ ] **Step 1: Update `templates/node/ARCHITECTURE.md`**

Add a new subsection under the existing `## Lint Tooling` heading (after its existing content, before `## Shell Autocompletion`):

```markdown
### Command-convention rule

If you accepted the command-convention question during scaffolding, `eslint-rules/require-base-command.js`
enforces that every command class in `src/commands/**` extends `BaseCommand` (directly, or via an intermediate
base class) — a command that doesn't loses the shared logging/error-handling from `base-command.ts` silently,
since oclif's discovery doesn't care what a command class extends. Run `npm run lint` to check.
```

- [ ] **Step 2: Update `templates/dotnet/ARCHITECTURE.md`**

Add a new subsection under `## Lint Tooling`:

```markdown
### Command-convention rule

If you accepted the command-convention question during scaffolding, the `Cli.Analyzers` project (referenced from
`Cli.csproj` as a build-time-only analyzer) enforces that every `ICliCommand` implementer carries a `[CommandPath]`
attribute — a class missing it currently crashes at runtime the first time `CommandDiscovery.RegisterAll` scans
the assembly; this analyzer turns that into a build error instead. Attribute inheritance is honored (a subclass
that inherits `[CommandPath]` from a base command class is not flagged), matching `CommandDiscovery.cs`'s own
runtime lookup behavior.
```

- [ ] **Step 3: Update `README.md`**

In the `## Usage` section, extend item 5 (the lint-tooling question) with a note about the follow-up question, matching the existing style of item 6 (autocompletion):

```markdown
5. **Set up lint tooling?** (default: No) — if yes, the generated project gets a working ESLint + Prettier setup (Node) or the .NET SDK's built-in Roslyn analyzers enabled via `.csproj` properties (.NET), and `npx clispark update` keeps it current afterwards. If no, none of it is scaffolded, and `update` never adds it later. If yes, you're also asked:
   - **Enforce command convention rule?** (default: No) — if yes, the generated project additionally gets a local ESLint rule (Node) or Roslyn analyzer project (.NET) that catches a command class which doesn't correctly opt into the shared command machinery (missing `BaseCommand` inheritance / missing `[CommandPath]`) at build/lint time instead of silently at runtime.
```

- [ ] **Step 4: Full whole-branch review**

Run, in order, and confirm every one is clean:

```bash
npx tsc --noEmit
npx eslint src scripts
npx vitest run
```

Then do a final manual scaffold-and-verify pass for both languages (repeat Task 3 Step 7 and Task 4 Step 8 once more, end to end, on the final branch state — not just at the point each task was implemented) to catch any regression introduced by later tasks.

- [ ] **Step 5: Update tracking docs**

- `project-ideas/clispark.plan.md`: mark #80 done, following this repo's existing convention for closed backlog items (move to `clispark.plan.changelog.md`'s history, same as #70/#89 were handled).
- Comment on GitHub issue #80 summarizing what shipped, and close it.
- Bump `status:needs-design` → remove (issue closing supersedes the label) per this project's existing issue-closing convention.

- [ ] **Step 6: Commit**

```bash
git add templates/node/ARCHITECTURE.md templates/dotnet/ARCHITECTURE.md README.md
git commit -m "docs: document the command-convention rule for both templates"
```

---

## Self-Review Notes

**Spec coverage:** Node ESLint rule (Task 3) ✓; .NET Roslyn analyzer + csproj wiring (Task 4) ✓; gated wizard question (Task 2) ✓; manifest/update-system conditionality for both languages (Tasks 1, 3, 4) ✓; attribute-inheritance-aware analyzer check, empirically justified (Task 4 Step 1, `HasCommandPathAttribute`) ✓; testing strategy — RuleTester (Task 3), Roslyn build-level integration test (Task 4), manifest/update regression tests (Tasks 3-4), real manual verification (Tasks 3-4) ✓; docs (Task 5) ✓. Not covered, and explicitly out of scope per spec: PowerShell, retroactive enable/disable.

**New scope found while writing this plan, beyond what the spec anticipated:** the `eslint.config.js` content-variance problem (Architecture decision 2) and the decision to exclude `Cli.Analyzers` from `Cli.slnx` (Architecture decision 3) — both resolved above without adding any new hook to the generic update engine.
