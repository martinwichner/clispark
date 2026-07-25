# Shell Autocompletion for Generated CLIs (#89) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give generated CLIs real shell tab-completion. Node gets a genuine opt-in scaffold mechanism (`@oclif/plugin-autocomplete`, core-managed exactly like #70's lint tooling). .NET and PowerShell get documentation only — both already have working completion built into their own toolchain, verified empirically in the design spec and re-verified for real in this plan.

**Architecture:** Reuses #70's "subtractive, manifest-aware core-managed content" mechanism verbatim — `CoreFilePathsFlags`/`Manifest` gain a second independent boolean (`autocompleteEnabled`, alongside `lintEnabled`), `LanguagePack` gains a second opt-in extension point (`stripAutocompleteSupport`, alongside `stripLintTooling`). Unlike lint tooling, this feature is Node-only: .NET and PowerShell packs get permanent no-op stubs and never ask a wizard question, because their completion already works with zero scaffold content (System.CommandLine's built-in `[suggest]` directive; PowerShell's native module reflection). A new `LanguagePack.supportsAutocompleteOptIn: boolean` flag lets `wizard.ts` skip the question entirely for those two packs without any `pack.id === 'node'`-style hardcoded branch.

**Tech Stack:** `@oclif/plugin-autocomplete@^3.2.53` (Node, real current version verified via `npm view` during this plan's own writing). No new dependency for .NET (`dotnet-suggest`, already part of the `System.CommandLine` ecosystem) or PowerShell (native shell feature).

## Global Constraints

- Every task ends in a state where `npx tsc --noEmit`, `npx eslint src scripts`, and `npx vitest run` all pass in the clispark repo root.
- `Manifest` gains one new required field: `autocompleteEnabled: boolean`. Required (not optional), same reasoning and same `?? false` self-healing pattern already established for `lintEnabled` (an existing manifest predating this feature has `autocompleteEnabled: undefined` at runtime; every read site must use it in a boolean/ternary context, never `=== true`/`=== false`, and `src/update/update.ts`'s `newManifest` construction must write `oldManifest.autocompleteEnabled ?? false` so the field heals into a real `false` on disk after the next `update`, exactly like #70's own final-review fix for `lintEnabled`).
- **This feature is Node-only.** .NET and PowerShell packs get `supportsAutocompleteOptIn: false` and a permanent (not temporary) no-op `stripAutocompleteSupport: async () => {}` — there is no Task 3/4-equivalent "fill in the real implementation later" step for those two packs, because their completion mechanism needs zero scaffold content by design (see the spec's three empirically-verified findings).
- **No `pack.id === 'node'`-style hardcoded per-language branch anywhere** — `wizard.ts`'s conditional question is driven by `pack.supportsAutocompleteOptIn`, a data property on the pack, not a language-ID check. `scaffold.ts` calls `pack.stripAutocompleteSupport(targetDir)` unconditionally when declined, exactly like it already does for `stripLintTooling` — harmless no-op for .NET/PowerShell.
- **README.md and ARCHITECTURE.md documentation is always-present, unconditional prose that explains both outcomes** — deliberately diverging from the spec's literal "README section only when enabled" wording. `README.md` is not in any adapter's `CORE_FILE_PATHS`, is never reconciled by `clispark update`, and #70 already established the safer, proven pattern for this exact situation: one section, written once at scaffold time, whose prose covers both the enabled and declined case (see `templates/node/ARCHITECTURE.md`'s existing "Lint Tooling" section — "If you answered 'yes' ... If you answered 'no' ..."). Introducing a second, regex-based "strip a section out of a Markdown file" mechanism is explicitly rejected: this codebase has already been bitten twice by CRLF-fragile regex text-surgery (the .NET lint-tooling strip regex in #70, and the pre-existing, still-unfixed `applyPrivateIntent` regex in `nuget.ts`) — do not add a third occurrence of that class of bug for a purely cosmetic doc-completeness gain.
- `@oclif/plugin-autocomplete` goes in `dependencies` (not `devDependencies`) — it's a runtime plugin loaded by the CLI itself, same section as the existing `@oclif/plugin-help`.
- No new tracked file is needed for Node's opt-in content (unlike #70's `eslint.config.js`/`.prettierrc`/`.prettierignore`) — the entire feature is one `dependencies` entry plus one `oclif.plugins` array entry, both inside `package.json`, which is already reconciled through `manifestFileName`/`mergeManifestFile`, not through `coreFilePaths`. **`coreFilePaths` itself does not change in this plan** — do not add anything to it for autocomplete.
- Every place that reads `manifest.autocompleteEnabled`/`oldManifest.autocompleteEnabled` must use it directly in a boolean/ternary context, never `=== true`/`=== false` — same rule as `lintEnabled`, for the same reason (a pre-#89 manifest has it `undefined`).

---

## File Structure

```
src/update/adapter.ts                          # MODIFY — CoreFilePathsFlags gains autocompleteEnabled
src/update/manifest.ts                          # MODIFY — Manifest.autocompleteEnabled, buildManifest gains a param
src/update/manifest.test.ts                     # MODIFY
src/update/update.ts                            # MODIFY — newManifest gains the healing line
src/update/update.test.ts                       # MODIFY — new regression tests, fixture updates
src/update/adapters/node-oclif.ts               # MODIFY — real dependency + oclif.plugins gating (Task 3 only)
src/update/adapters/node-oclif.test.ts          # MODIFY
src/update/adapters/dotnet.ts                   # untouched (structurally satisfies the widened CoreFilePathsFlags automatically)
src/update/adapters/dotnet.test.ts              # MODIFY — fixture type-satisfaction only
src/update/adapters/powershell.ts               # untouched
src/update/adapters/powershell.test.ts          # MODIFY — fixture type-satisfaction only
src/update/releasenotes.test.ts                 # MODIFY — fixture type-satisfaction only
src/scaffold.ts                                 # MODIFY — ScaffoldOptions.autocompleteEnabled, stripAutocompleteSupport call
src/scaffold.test.ts                            # MODIFY
src/wizard.ts                                   # MODIFY — new conditional question
src/wizard.test.ts                              # MODIFY — mock-chain updates, new pack-capability test
src/types.ts                                    # MODIFY — WizardAnswers.autocompleteEnabled
src/cli.ts                                      # MODIFY — thread autocompleteEnabled through to scaffoldProject
src/languages/pack.ts                           # MODIFY — LanguagePack.supportsAutocompleteOptIn, stripAutocompleteSupport (required fields)
src/languages/packs/node-oclif.ts               # MODIFY — supportsAutocompleteOptIn: true, wires stripAutocompleteSupport (no-op in Task 2, real in Task 3)
src/languages/packs/dotnet.ts                   # MODIFY — supportsAutocompleteOptIn: false, permanent no-op
src/languages/packs/powershell.ts               # MODIFY — supportsAutocompleteOptIn: false, permanent no-op
src/languages/autocomplete-support/node.ts      # CREATE (Task 3) — AUTOCOMPLETE_DEPENDENCY_NAME, withoutAutocompletePlugin, stripAutocompleteSupport
src/languages/autocomplete-support/node.test.ts # CREATE (Task 3)
templates/node/package.json                     # MODIFY (Task 3) — @oclif/plugin-autocomplete in dependencies + oclif.plugins, always present
templates/node/ARCHITECTURE.md                  # MODIFY (Task 3) — new "Shell Autocompletion" section
templates/node/README.md                        # MODIFY (Task 3) — new "Shell Autocompletion" section
.github/workflows/ci.yml                        # MODIFY (Task 3) — autocomplete-enabled smoke coverage in scaffold-smoke
templates/dotnet/ARCHITECTURE.md                # MODIFY (Task 4) — new "Shell Completion" section
templates/dotnet/README.md                      # MODIFY (Task 4) — new "Shell Completion" section
templates/powershell/ARCHITECTURE.md            # MODIFY (Task 5) — new "Shell Completion" section
templates/powershell/README.md                  # MODIFY (Task 5) — new "Shell Completion" section
```

---

### Task 1: Generic update-engine plumbing — `autocompleteEnabled` on `CoreFilePathsFlags`/`Manifest`

**Files:**
- Modify: `src/update/adapter.ts`, `src/update/manifest.ts`, `src/update/manifest.test.ts`, `src/update/update.ts`
- Modify (fixture type-satisfaction only, no behavior change): `src/update/adapters/node-oclif.test.ts`, `src/update/adapters/dotnet.test.ts`, `src/update/adapters/powershell.test.ts`, `src/update/releasenotes.test.ts`, `src/update/update.test.ts`

**Interfaces:**
- Produces: `CoreFilePathsFlags.autocompleteEnabled: boolean` (new required field, alongside the existing `lintEnabled`); `Manifest.autocompleteEnabled: boolean` (new required field); `buildManifest(targetDir, generatorVersion, language, adapter, lintEnabled, autocompleteEnabled)` (gains a 6th positional param).

This task is pure plumbing — after it, every adapter (`node-oclif`, `dotnet`, `powershell`) must behave **identically** to today; none of them read `flags.autocompleteEnabled`/`oldManifest.autocompleteEnabled` yet. This isolates the risky, generic-engine-touching change from Task 3's Node-specific feature work, mirroring #70 Task 1's isolation reasoning exactly.

- [ ] **Step 1: Write the failing tests**

Add to `src/update/manifest.test.ts`, inside the existing `describe('buildManifest lintEnabled', ...)` block's `tmpRoot` setup (reuse its `beforeEach`/`afterEach`, add a new `it` after the two existing ones):

```ts
describe('buildManifest autocompleteEnabled', () => {
  it('records autocompleteEnabled: true when passed', async () => {
    const manifest = await buildManifest(tmpRoot, '1.0.0', 'node', nodeOclifAdapter, false, true);
    expect(manifest.autocompleteEnabled).toBe(true);
  });

  it('records autocompleteEnabled: false when passed', async () => {
    const manifest = await buildManifest(tmpRoot, '1.0.0', 'node', nodeOclifAdapter, false, false);
    expect(manifest.autocompleteEnabled).toBe(false);
  });
});
```

Place this new `describe` block directly after the existing `describe('buildManifest lintEnabled', ...)` block (same file, same `tmpRoot` fixture pattern — the two describe blocks are independent, each with its own `beforeEach`/`afterEach`, so duplicate the `beforeEach`/`afterEach` from the `lintEnabled` block verbatim into this new block rather than trying to share it).

Fix every call site in the same file that constructs a literal flags object or calls `buildManifest`, adding `autocompleteEnabled: false` (or an extra `false` positional argument) — **six sites, found by grepping this file for `lintEnabled`**:

```ts
// line ~53 — hashCoreFiles direct call
const hashes = await hashCoreFiles(tmpRoot, nodeOclifAdapter, { lintEnabled: false, autocompleteEnabled: false });

// line ~58 — buildManifest in the 'hashCoreFiles / buildManifest' describe block
const manifest = await buildManifest(tmpRoot, '9.9.9', 'node', nodeOclifAdapter, false, false);

// lines ~100, ~105 — the two existing 'buildManifest lintEnabled' tests
const manifest = await buildManifest(tmpRoot, '1.0.0', 'node', nodeOclifAdapter, true, false);
// ...
const manifest = await buildManifest(tmpRoot, '1.0.0', 'node', nodeOclifAdapter, false, false);

// line ~112-113 — coreFilePaths assertions are UNCHANGED (coreFilePaths does not gate on
// autocompleteEnabled in this plan — leave these two lines exactly as they are, do not add
// an autocompleteEnabled key to them, since CoreFilePathsFlags requires it but coreFilePaths()
// itself never reads it; TypeScript will still require the key be present in the object literal)
expect(nodeOclifAdapter.coreFilePaths({ lintEnabled: false, autocompleteEnabled: false })).toEqual(CORE_FILE_PATHS);
expect(nodeOclifAdapter.coreFilePaths({ lintEnabled: true, autocompleteEnabled: false })).toEqual([
  ...CORE_FILE_PATHS,
  'eslint.config.js',
  '.prettierrc',
  '.prettierignore',
]);

// line ~136 — sampleManifest literal in the writeManifest/readManifest/requireManifest describe block
const sampleManifest = {
  generatorVersion: '1.0.0',
  language: 'node',
  lintEnabled: false,
  autocompleteEnabled: false,
  coreFiles: { 'tsconfig.json': 'abc' },
  coreDependencies: {},
  coreScripts: {},
  coreFields: { engines: {}, oclif: {} },
};
```

Fix the remaining five files, each via their shared `baseManifest()`/literal-fixture helper (adding `autocompleteEnabled: false` alongside the existing `lintEnabled: false` is enough — **do not** touch every individual test, just the one shared helper per file):

`src/update/adapters/node-oclif.test.ts` — the `baseManifest()` helper function:
```ts
function baseManifest(overrides: Partial<Manifest> = {}): Manifest {
  return {
    generatorVersion: '1.0.0',
    language: 'node',
    lintEnabled: false,
    autocompleteEnabled: false,
    coreFiles: {},
    coreDependencies: {},
    coreScripts: {},
    coreFields: { engines: {}, oclif: {} },
    ...overrides,
  };
}
```
Also fix its three direct `extractCoreFields(..., { lintEnabled: false })` calls (lines ~38, ~46, ~53) and the `coreFilePaths({ lintEnabled: ... })` calls in the `describe('coreFilePaths with lintEnabled', ...)` block (lines ~93-96) to `{ lintEnabled: false, autocompleteEnabled: false }` / `{ lintEnabled: true, autocompleteEnabled: false }` respectively — same rule as above, `coreFilePaths` doesn't read the new flag but `CoreFilePathsFlags` requires it in the object literal.

`src/update/adapters/dotnet.test.ts` — the `baseManifest()` helper function (same shape, `language: 'dotnet'`, `coreFields: { TargetFramework: 'net10.0' }` — just add `autocompleteEnabled: false,` alongside `lintEnabled: false,`). Also fix its direct `extractCoreFields(parsed, { lintEnabled: false })` calls (lines ~87, ~93, ~99) and `coreFilePaths({ lintEnabled: false })` calls (lines ~214-217) the same way.

`src/update/adapters/powershell.test.ts` — its two `extractCoreFields(manifestFile, { lintEnabled: false })` calls (lines ~111, ~122) → `{ lintEnabled: false, autocompleteEnabled: false }`.

`src/update/releasenotes.test.ts` — its literal `Manifest` fixture (line ~12, `lintEnabled: false,`) → add `autocompleteEnabled: false,` on the next line.

`src/update/update.test.ts` — three sites:
1. The literal manifest JSON written directly to disk inside the `'drives entirely off a fake adapter'` test (around line ~236, `lintEnabled: false,` inside a `JSON.stringify({...})` call) → add `autocompleteEnabled: false,`.
2. `scaffoldFixture`'s `options` type and the `scaffoldProject` call it makes:
   ```ts
   async function scaffoldFixture(
     tmpRoot: string,
     name: string,
     options: { lintEnabled?: boolean; autocompleteEnabled?: boolean } = {},
   ): Promise<string> {
     const targetDir = path.join(tmpRoot, name);
     await scaffoldProject(
       { projectName: name, targetDir, lintEnabled: options.lintEnabled, autocompleteEnabled: options.autocompleteEnabled },
       nodeOclifPack,
       { runCommand: vi.fn(async () => {}) },
     );
     return targetDir;
   }
   ```
   (This is the same function Task 3 will call with `{ autocompleteEnabled: true }` for its own regression tests — extending its signature now, in Task 1, avoids Task 3 needing to touch this shared helper again.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run`
Expected: FAIL — `Manifest`/`CoreFilePathsFlags` don't have `autocompleteEnabled` yet, so every fixed-in-Step-1 object literal fails to typecheck (`npx tsc --noEmit` also fails at this point), and the two new `buildManifest autocompleteEnabled` tests fail because `buildManifest` doesn't accept a 6th argument.

- [ ] **Step 3: Implement**

`src/update/adapter.ts`:

```ts
export interface CoreFilePathsFlags {
  lintEnabled: boolean;
  autocompleteEnabled: boolean;
}
```

(`UpdateAdapter`'s method signatures — `coreFilePaths(flags: CoreFilePathsFlags)`, `extractCoreFields(manifestFile: unknown, flags: CoreFilePathsFlags)` — are unchanged; they already reference the `CoreFilePathsFlags` type, which now carries the extra field automatically.)

`src/update/manifest.ts`:

```ts
export interface Manifest {
  generatorVersion: string;
  language: string;
  lintEnabled: boolean;
  autocompleteEnabled: boolean;
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
): Promise<Manifest> {
  const coreFiles = await hashCoreFiles(targetDir, adapter, { lintEnabled, autocompleteEnabled });
  const manifestFile = await adapter.readManifestFile(targetDir);
  const { coreDependencies, coreScripts, coreFields } = adapter.extractCoreFields(manifestFile, {
    lintEnabled,
    autocompleteEnabled,
  });
  return { generatorVersion, language, lintEnabled, autocompleteEnabled, coreFiles, coreDependencies, coreScripts, coreFields };
}
```

`src/scaffold.ts`'s single `buildManifest` call site — for Task 1, hardcode `false` for the new param (Task 2 threads the real value through `ScaffoldOptions`):

```ts
const manifest = await buildManifest(targetDir, getGeneratorVersion(), pack.id, pack.updateAdapter, lintEnabled, false);
```

`src/update/update.ts` — the `newManifest` construction (~line 165) gains one healing line, directly under the existing `lintEnabled` one:

```ts
const newManifest: Manifest = {
  generatorVersion: toVersion,
  language,
  lintEnabled: oldManifest.lintEnabled ?? false,
  autocompleteEnabled: oldManifest.autocompleteEnabled ?? false,   // ADD
  coreFiles: newCoreFiles,
  coreDependencies: fileMerge.coreDependencies,
  coreScripts: fileMerge.coreScripts,
  coreFields: fileMerge.coreFields,
};
```

No other change to `update.ts` is needed: both `adapter.coreFilePaths(oldManifest)` call sites (the file-hashing `.map()` and the "no-longer-core" filter) already pass the *entire* `oldManifest` object, which structurally satisfies the widened `CoreFilePathsFlags` automatically once `Manifest` gains the field above — TypeScript requires no edit here, and there is no runtime behavior change since `coreFilePaths` never reads `autocompleteEnabled` in this plan.

- [ ] **Step 4: Grep for any remaining literal-object-construction sites**

Run: `grep -rn "lintEnabled: false\|lintEnabled: true\|{ lintEnabled" src --include="*.ts"`. Confirm every result is one you already fixed in Step 1 (six sites in `manifest.test.ts`, one `baseManifest()` helper each in `node-oclif.test.ts`/`dotnet.test.ts`, two sites in `powershell.test.ts`, one in `releasenotes.test.ts`, two-to-three in `update.test.ts`). If a site this plan didn't anticipate turns up, fix it the same way before moving on — this is the exact check the project's own retrospectives (M12a, #70) have flagged as easy to under-scope on a first pass.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run` (full suite — this touches a widely-used interface).

- [ ] **Step 6: Typecheck and lint**

Run: `npx tsc --noEmit && npx eslint src scripts`

- [ ] **Step 7: Commit**

```bash
git add src/update/adapter.ts src/update/manifest.ts src/update/manifest.test.ts src/update/update.ts src/update/adapters/node-oclif.test.ts src/update/adapters/dotnet.test.ts src/update/adapters/powershell.test.ts src/update/releasenotes.test.ts src/update/update.test.ts src/scaffold.ts
git commit -m "refactor: add autocompleteEnabled to CoreFilePathsFlags and Manifest

Pure plumbing for the upcoming Node shell-autocompletion feature (#89)
-- no observable behavior change. Reuses the exact CoreFilePathsFlags/
Manifest mechanism #70 introduced for lintEnabled: a second,
independent boolean, self-healing to false for a pre-#89 manifest via
update.ts's ?? false pattern. No adapter reads the new flag yet."
```

---

### Task 2: Conditional wizard question, `ScaffoldOptions.autocompleteEnabled`, and the `LanguagePack.supportsAutocompleteOptIn`/`stripAutocompleteSupport` extension points

**Files:**
- Modify: `src/wizard.ts`, `src/wizard.test.ts`, `src/scaffold.ts`, `src/scaffold.test.ts`, `src/cli.ts`, `src/types.ts`, `src/languages/pack.ts`, `src/languages/packs/node-oclif.ts`, `src/languages/packs/dotnet.ts`, `src/languages/packs/powershell.ts`

**Interfaces:**
- Produces: `WizardAnswers.autocompleteEnabled: boolean`; `ScaffoldOptions.autocompleteEnabled?: boolean`; `LanguagePack.supportsAutocompleteOptIn: boolean` (required field — `true` for the Node pack, `false` for .NET/PowerShell); `LanguagePack.stripAutocompleteSupport: (targetDir: string) => Promise<void>` (required field — no-op stub for **all three** packs in this task, including Node; Task 3 replaces only the Node pack's stub with the real implementation, .NET/PowerShell keep the no-op permanently since `supportsAutocompleteOptIn: false` means it's never called with `autocompleteEnabled` anything but `false` anyway).

**Why the question is conditional, unlike #70's lint question:** #70 asked every language the same lint question, even PowerShell, where the answer is structurally meaningless (a permanent no-op). The design spec for #89 explicitly rejects repeating that pattern here ("`.NET, PowerShell: Kein Wizard, kein Opt-in, keine Wahl`") — asking a question whose answer can never do anything is worse UX for a *second* feature than it was tolerable for the first. `pack.supportsAutocompleteOptIn` is the mechanism: a plain data property on `LanguagePack`, read generically by `wizard.ts` exactly the way `pack.registry.promptLabel`/`pack.validateProjectName` already are — never a hardcoded `pack.id === 'node'` check.

- [ ] **Step 1: Write the failing tests**

Add to `src/wizard.test.ts`. First, extend `fakePack()` to accept the new capability flag (default `true`, since every *existing* test in this file represents a Node-like pack that should exercise the new question — this keeps every pre-existing test's `select()` chain needing exactly one more mock, matching #70's Task 2 precedent):

```ts
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
```

Append one more `.mockResolvedValueOnce(...)` to the `select()` chain in **every existing test in this file** (six tests: the two in the first-try/retry pair, the registry-URL test, the unverified-registry test, the skip-availability-check test, and both `lintEnabled` tests) — the new autocomplete question is the 5th `select()` call, right after `lintEnabled`. For example, the first test's chain:

```ts
// was:
vi.mocked(select)
  .mockResolvedValueOnce('node')
  .mockResolvedValueOnce('private')
  .mockResolvedValueOnce(true)
  .mockResolvedValueOnce(false);
// becomes:
vi.mocked(select)
  .mockResolvedValueOnce('node')
  .mockResolvedValueOnce('private')
  .mockResolvedValueOnce(true)
  .mockResolvedValueOnce(false)
  .mockResolvedValueOnce(false);
```

And its `expect(result).toEqual({...})` assertion gains `autocompleteEnabled: false,` at the end, alongside `lintEnabled: false,`. Apply the same one-more-mock append to the other five existing tests (the retry-loop test's `expect(select).toHaveBeenCalledTimes(4)` becomes `toHaveBeenCalledTimes(5)`, with an updated comment: `// language + profile + publish-intent + lint-enabled + autocomplete-enabled, none re-asked during the name retry loop`).

Add three new tests:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run`
Expected: FAIL — `autocompleteEnabled` doesn't exist on the wizard's answers yet; `fakePack()` doesn't typecheck without `supportsAutocompleteOptIn`/`stripAutocompleteSupport`; the six pre-existing tests fail their `select()` call-count/return-value expectations since the wizard doesn't consume a 5th mock yet.

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
}
```

`src/wizard.ts` — new conditional question, immediately after the existing `lintEnabled` block:

```ts
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
```

And the final return statement gains the new field:

```ts
return {
  language: pack.id,
  projectName,
  profile,
  registryUrl,
  publishIntent,
  nameAvailability,
  lintEnabled,
  autocompleteEnabled,
};
```

`src/languages/pack.ts`:

```ts
export interface LanguagePack {
  readonly id: string;
  readonly displayName: string;
  readonly templateDir: string;
  readonly scaffoldCommands: readonly ScaffoldCommand[];
  validateProjectName(value: string): string | undefined;
  readonly updateAdapter: UpdateAdapter;
  readonly registry: LanguageRegistry;
  readonly commandGenerator: CommandGenerator;
  readonly stripLintTooling: (targetDir: string) => Promise<void>;
  readonly supportsAutocompleteOptIn: boolean;
  readonly stripAutocompleteSupport: (targetDir: string) => Promise<void>;
}
```

`src/languages/packs/node-oclif.ts` — temporary no-op for this task only (Task 3 replaces it):

```ts
supportsAutocompleteOptIn: true,
stripAutocompleteSupport: async () => {},
```

`src/languages/packs/dotnet.ts` and `src/languages/packs/powershell.ts` — permanent no-op, never replaced by a later task:

```ts
supportsAutocompleteOptIn: false,
stripAutocompleteSupport: async () => {},
```

`src/scaffold.ts`:

```ts
export interface ScaffoldOptions {
  projectName: string;
  targetDir: string;
  registryUrl?: string;
  publishIntent?: boolean;
  lintEnabled?: boolean;
  autocompleteEnabled?: boolean;
}

// in scaffoldProject, after the existing lintEnabled block:
const autocompleteEnabled = options.autocompleteEnabled ?? false;
if (!autocompleteEnabled) {
  await pack.stripAutocompleteSupport(targetDir);
}
const manifest = await buildManifest(
  targetDir,
  getGeneratorVersion(),
  pack.id,
  pack.updateAdapter,
  lintEnabled,
  autocompleteEnabled,
);
```

(This replaces Task 1's hardcoded `false` 6th argument with the real threaded value, and calls the now-real-but-still-no-op-for-Node `stripAutocompleteSupport` — harmless until Task 3 gives Node's copy actual behavior; permanently harmless for .NET/PowerShell.)

`src/cli.ts` — thread `answers.autocompleteEnabled` into the `scaffoldProject()` call's options object, same place `lintEnabled` already is:

```ts
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
```

Add to `src/scaffold.test.ts`, directly after the existing `'defaults lintEnabled to false in the manifest when not specified'` test:

```ts
it('defaults autocompleteEnabled to false in the manifest when not specified', async () => {
  const targetDir = path.join(tmpRoot, 'autocomplete-default');
  const runCommand = vi.fn(async () => {});

  await scaffoldProject({ projectName: 'autocomplete-default', targetDir }, nodeOclifPack, { runCommand });

  const manifest = await readManifest(targetDir);
  expect(manifest?.autocompleteEnabled).toBe(false);
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run`

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit && npx eslint src scripts`

- [ ] **Step 6: Commit**

```bash
git add src/wizard.ts src/wizard.test.ts src/scaffold.ts src/scaffold.test.ts src/cli.ts src/types.ts src/languages/pack.ts src/languages/packs/node-oclif.ts src/languages/packs/dotnet.ts src/languages/packs/powershell.ts
git commit -m "feat: add conditional wizard question for opt-in shell autocompletion (#89)

New yes/no question, default No -- asked only when the selected
LanguagePack sets supportsAutocompleteOptIn: true (Node only; .NET and
PowerShell never ask, since their completion needs zero scaffold
content). Answer flows through ScaffoldOptions into the manifest as
autocompleteEnabled. LanguagePack gains a required
stripAutocompleteSupport field (no-op stubs for all three packs in this
commit) so scaffold.ts can call it unconditionally without a hardcoded
per-language branch -- Task 3 fills in Node's real implementation; .NET
and PowerShell keep the no-op permanently. No actual autocomplete
content is scaffolded yet."
```

---

### Task 3: Real Node implementation — `@oclif/plugin-autocomplete`, reconciliation gating, docs, CI coverage

**Files:**
- Create: `src/languages/autocomplete-support/node.ts`, `src/languages/autocomplete-support/node.test.ts`
- Modify: `templates/node/package.json`, `templates/node/ARCHITECTURE.md`, `templates/node/README.md`, `src/languages/packs/node-oclif.ts`, `src/update/adapters/node-oclif.ts`, `src/update/adapters/node-oclif.test.ts`, `src/update/update.test.ts`, `.github/workflows/ci.yml`

**Interfaces:**
- Produces: `stripAutocompleteSupport(targetDir: string): Promise<void>` (Node-specific, real implementation replacing Task 2's no-op); `AUTOCOMPLETE_DEPENDENCY_NAME` (exported constant — the single source of truth for "which dependency is the autocomplete plugin," reused by `stripAutocompleteSupport`, the dependency-reconciliation filter, and the `oclif.plugins` reconciliation filter, so there is never a second hardcoded copy of the string); `withoutAutocompletePlugin(oclif: unknown): unknown` (pure helper — strips the plugin's entry out of an `oclif` field's `plugins` array without mutating the input).

**Step 0 — verify the real package version before writing template content:** `npm view @oclif/plugin-autocomplete version` → **`3.2.53`** (verified during this plan's own writing; re-verify if this plan is executed more than a few days after 2026-07-25 in case a newer version has shipped).

- [ ] **Step 1: Add the dependency and plugin entry to the template, always present (subtractive design — see plan header)**

Modify `templates/node/package.json`'s `dependencies` and `oclif.plugins`:

```json
"oclif": {
  "bin": "{{projectName}}",
  "dirname": "{{projectName}}",
  "commands": "./dist/commands",
  "topicSeparator": " ",
  "plugins": [
    "@oclif/plugin-help",
    "@oclif/plugin-autocomplete"
  ]
},
```

```json
"dependencies": {
  "@oclif/core": "^4.0.0",
  "@oclif/plugin-autocomplete": "^3.2.53",
  "@oclif/plugin-help": "^6.0.0",
  "env-paths": "^3.0.0",
  "pino": "^9.6.0"
},
```

(Keep the `dependencies` object's keys alphabetically sorted, matching the existing convention already visible in this exact block — `@oclif/plugin-autocomplete` sorts between `@oclif/core` and `@oclif/plugin-help`.)

- [ ] **Step 2: Write the failing tests for `stripAutocompleteSupport` and `withoutAutocompletePlugin`**

Create `src/languages/autocomplete-support/node.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { stripAutocompleteSupport, withoutAutocompletePlugin } from './node';

describe('withoutAutocompletePlugin', () => {
  it('removes the plugin entry from a plugins array, leaving other entries intact', () => {
    const result = withoutAutocompletePlugin({ bin: 'my-cli', plugins: ['@oclif/plugin-help', '@oclif/plugin-autocomplete'] });
    expect(result).toEqual({ bin: 'my-cli', plugins: ['@oclif/plugin-help'] });
  });

  it('returns the input unchanged when plugins is absent', () => {
    const input = { bin: 'my-cli' };
    expect(withoutAutocompletePlugin(input)).toBe(input);
  });

  it('returns the input unchanged when oclif itself is undefined', () => {
    expect(withoutAutocompletePlugin(undefined)).toBeUndefined();
  });

  it('does not mutate the original object', () => {
    const input = { bin: 'my-cli', plugins: ['@oclif/plugin-help', '@oclif/plugin-autocomplete'] };
    withoutAutocompletePlugin(input);
    expect(input.plugins).toEqual(['@oclif/plugin-help', '@oclif/plugin-autocomplete']);
  });
});

describe('stripAutocompleteSupport', () => {
  let targetDir: string;

  beforeEach(async () => {
    targetDir = await mkdtemp(path.join(tmpdir(), 'clispark-strip-autocomplete-test-'));
    await writeFile(
      path.join(targetDir, 'package.json'),
      JSON.stringify({
        dependencies: {
          '@oclif/core': '^4.0.0',
          '@oclif/plugin-autocomplete': '^3.2.53',
          '@oclif/plugin-help': '^6.0.0',
        },
        oclif: {
          bin: 'my-cli',
          plugins: ['@oclif/plugin-help', '@oclif/plugin-autocomplete'],
        },
      }),
    );
  });

  afterEach(async () => {
    await rm(targetDir, { recursive: true, force: true });
  });

  it('removes the autocomplete dependency and plugins entry, keeps everything else', async () => {
    await stripAutocompleteSupport(targetDir);
    const pkg = JSON.parse(await readFile(path.join(targetDir, 'package.json'), 'utf8'));
    expect(pkg.dependencies).toEqual({ '@oclif/core': '^4.0.0', '@oclif/plugin-help': '^6.0.0' });
    expect(pkg.oclif.plugins).toEqual(['@oclif/plugin-help']);
    expect(pkg.oclif.bin).toBe('my-cli');
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/languages/autocomplete-support`
Expected: FAIL — module doesn't exist.

- [ ] **Step 4: Implement**

Create `src/languages/autocomplete-support/node.ts`:

```ts
// src/languages/autocomplete-support/node.ts
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const AUTOCOMPLETE_DEPENDENCY_NAME = '@oclif/plugin-autocomplete';

interface OclifFieldShape {
  plugins?: unknown;
  [key: string]: unknown;
}

export function withoutAutocompletePlugin(oclif: unknown): unknown {
  if (!oclif || typeof oclif !== 'object') return oclif;
  const shape = oclif as OclifFieldShape;
  if (!Array.isArray(shape.plugins)) return oclif;
  return { ...shape, plugins: shape.plugins.filter((name) => name !== AUTOCOMPLETE_DEPENDENCY_NAME) };
}

export async function stripAutocompleteSupport(targetDir: string): Promise<void> {
  const pkgPath = path.join(targetDir, 'package.json');
  const pkg = JSON.parse(await readFile(pkgPath, 'utf8'));

  delete pkg.dependencies?.[AUTOCOMPLETE_DEPENDENCY_NAME];
  pkg.oclif = withoutAutocompletePlugin(pkg.oclif);

  await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/languages/autocomplete-support`

- [ ] **Step 6: Wire the real implementation into the Node pack**

`src/languages/packs/node-oclif.ts`:

```ts
import { stripAutocompleteSupport } from '../autocomplete-support/node';
// ...
stripAutocompleteSupport, // replaces Task 2's `async () => {}`
```

- [ ] **Step 7: Gate dependency and `oclif.plugins` reconciliation on `autocompleteEnabled`**

Modify `src/update/adapters/node-oclif.ts`:

```ts
import { AUTOCOMPLETE_DEPENDENCY_NAME, withoutAutocompletePlugin } from '../../languages/autocomplete-support/node';
```

In `mergePackageJson`, extend the existing `dependencyNames` filter with a second, independent condition (AND-ed with the existing lint condition — do not replace it):

```ts
const dependencyNames = new Set(
  [...Object.keys(newTemplatePkg.dependencies ?? {}), ...Object.keys(newTemplatePkg.devDependencies ?? {})].filter(
    (name) =>
      (oldManifest.lintEnabled || !(LINT_DEPENDENCY_NAMES as readonly string[]).includes(name)) &&
      (oldManifest.autocompleteEnabled || name !== AUTOCOMPLETE_DEPENDENCY_NAME),
  ),
);
```

And extend the `oclif` field's reconciliation block (the `if (newTemplatePkg.oclif !== undefined) { ... }` block) so the template value it reconciles against has the plugin filtered out when declined — this is the exact same principle as the dependency filter above, applied to a nested array field instead of a flat key set:

```ts
if (newTemplatePkg.oclif !== undefined) {
  const effectiveTemplateOclif = oldManifest.autocompleteEnabled
    ? newTemplatePkg.oclif
    : (withoutAutocompletePlugin(newTemplatePkg.oclif) as PackageJsonShape['oclif']);
  const oclifResult = reconcileEntry(currentPkg.oclif, oldCoreFields.oclif, effectiveTemplateOclif, deepEquals);
  fields.push({ key: 'oclif', outcome: oclifResult.outcome });
  oclifValue = oclifResult.value;
  if (oclifResult.outcome !== 'skipped' && !deepEquals(oclifResult.value, currentPkg.oclif)) {
    changed = true;
    updatedFile.oclif = oclifResult.value;
  }
}
```

(This replaces the existing `if (newTemplatePkg.oclif !== undefined) { ... }` block's body — the `engines` block directly above it is untouched.)

**Do not modify `coreFilePaths` or `extractCoreFields`** — per the Global Constraints, autocomplete adds no new tracked file, and `coreDependencies`/`coreFields.oclif` extraction already reflects whatever `stripAutocompleteSupport` left on disk at scaffold time, exactly the same reasoning #70 used for why lint's `extractCoreFields` needed no gating.

- [ ] **Step 8: Add the regression tests**

Add to `src/update/adapters/node-oclif.test.ts`, after the existing `describe('coreFilePaths with lintEnabled', ...)` block:

```ts
describe('mergeManifestFile with autocompleteEnabled', () => {
  it('excludes the autocomplete dependency from reconciliation when declined, even if the template has it', () => {
    const current: PackageJsonShape = { name: 'my-cli', version: '0.0.0', dependencies: {} };
    const newTemplate: PackageJsonShape = {
      name: '{{projectName}}',
      version: '0.0.0',
      dependencies: { '@oclif/plugin-autocomplete': '^3.2.53' },
    };

    const result = nodeOclifAdapter.mergeManifestFile(current, baseManifest({ autocompleteEnabled: false }), newTemplate);

    expect(result.dependencies).toEqual([]);
    expect((result.updatedFile as PackageJsonShape).dependencies).toEqual({});
  });

  it('reconciles the autocomplete dependency normally when opted in', () => {
    const current: PackageJsonShape = { name: 'my-cli', version: '0.0.0', dependencies: {} };
    const newTemplate: PackageJsonShape = {
      name: '{{projectName}}',
      version: '0.0.0',
      dependencies: { '@oclif/plugin-autocomplete': '^3.2.53' },
    };

    const result = nodeOclifAdapter.mergeManifestFile(current, baseManifest({ autocompleteEnabled: true }), newTemplate);

    expect(result.dependencies).toEqual([{ key: '@oclif/plugin-autocomplete', outcome: 'added' }]);
    expect((result.updatedFile as PackageJsonShape).dependencies).toEqual({ '@oclif/plugin-autocomplete': '^3.2.53' });
  });

  it('reconciles oclif.plugins without the autocomplete entry when declined', () => {
    const current: PackageJsonShape = {
      name: 'my-cli',
      version: '0.0.0',
      oclif: { bin: 'my-cli', plugins: ['@oclif/plugin-help'] },
    };
    const newTemplate: PackageJsonShape = {
      name: '{{projectName}}',
      version: '0.0.0',
      oclif: { bin: '{{projectName}}', plugins: ['@oclif/plugin-help', '@oclif/plugin-autocomplete'] },
    };
    const manifest = baseManifest({
      autocompleteEnabled: false,
      coreFields: { engines: {}, oclif: { bin: 'my-cli', plugins: ['@oclif/plugin-help'] } },
    });

    const result = nodeOclifAdapter.mergeManifestFile(current, manifest, newTemplate);

    expect((result.updatedFile as PackageJsonShape).oclif).toEqual({ bin: '{{projectName}}', plugins: ['@oclif/plugin-help'] });
  });

  it('reconciles oclif.plugins with the autocomplete entry included when opted in', () => {
    const current: PackageJsonShape = {
      name: 'my-cli',
      version: '0.0.0',
      oclif: { bin: 'my-cli', plugins: ['@oclif/plugin-help', '@oclif/plugin-autocomplete'] },
    };
    const newTemplate: PackageJsonShape = {
      name: '{{projectName}}',
      version: '0.0.0',
      oclif: { bin: '{{projectName}}', plugins: ['@oclif/plugin-help', '@oclif/plugin-autocomplete'] },
    };
    const manifest = baseManifest({
      autocompleteEnabled: true,
      coreFields: { engines: {}, oclif: { bin: 'my-cli', plugins: ['@oclif/plugin-help', '@oclif/plugin-autocomplete'] } },
    });

    const result = nodeOclifAdapter.mergeManifestFile(current, manifest, newTemplate);

    expect((result.updatedFile as PackageJsonShape).oclif).toEqual({
      bin: '{{projectName}}',
      plugins: ['@oclif/plugin-help', '@oclif/plugin-autocomplete'],
    });
  });
});
```

Add to `src/update/update.test.ts`, after the existing lint-tooling regression tests (mirrors their exact `generatorVersion` rollback + fabricated-stale-value technique):

```ts
it('a project that opted into autocomplete gets its plugin dependency version-bumped by update', async () => {
  const targetDir = await scaffoldFixture(tmpRoot, 'autocomplete-project', { autocompleteEnabled: true });

  const manifestPath = path.join(targetDir, '.clispark', 'manifest.json');
  const oldManifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Manifest;
  const realCurrentVersion = oldManifest.coreDependencies['@oclif/plugin-autocomplete'];
  oldManifest.generatorVersion = '0.0.1';
  oldManifest.coreDependencies['@oclif/plugin-autocomplete'] = '^0.0.1-fake-old';

  const pkgPath = path.join(targetDir, 'package.json');
  const pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
  pkg.dependencies['@oclif/plugin-autocomplete'] = '^0.0.1-fake-old';
  await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  await writeFile(manifestPath, JSON.stringify(oldManifest, null, 2) + '\n');

  const result = await updateProject(targetDir, nodeOclifPack.updateAdapter, nodeOclifPack.templateDir, 'node', cleanGitDeps());

  const outcome = result.dependencies.find((d) => d.key === '@oclif/plugin-autocomplete');
  expect(outcome?.outcome).toBe('replaced');
  const pkgAfter = JSON.parse(await readFile(pkgPath, 'utf8'));
  expect(pkgAfter.dependencies['@oclif/plugin-autocomplete']).toBe(realCurrentVersion);
});

it('a project that declined autocomplete never gets the plugin dependency or oclif.plugins entry added by a later update', async () => {
  const targetDir = await scaffoldFixture(tmpRoot, 'no-autocomplete-project', { autocompleteEnabled: false });

  const manifestPath = path.join(targetDir, '.clispark', 'manifest.json');
  const oldManifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Manifest;
  oldManifest.generatorVersion = '0.0.1';
  await writeFile(manifestPath, JSON.stringify(oldManifest, null, 2) + '\n');

  const result = await updateProject(targetDir, nodeOclifPack.updateAdapter, nodeOclifPack.templateDir, 'node', cleanGitDeps());

  expect(result.dependencies.find((d) => d.key === '@oclif/plugin-autocomplete')).toBeUndefined();
  const pkgAfter = JSON.parse(await readFile(path.join(targetDir, 'package.json'), 'utf8'));
  expect(pkgAfter.dependencies).not.toHaveProperty('@oclif/plugin-autocomplete');
  expect(pkgAfter.oclif.plugins).not.toContain('@oclif/plugin-autocomplete');
});

it('heals a legacy manifest (pre-#89, no autocompleteEnabled field) to autocompleteEnabled: false on disk after update', async () => {
  const targetDir = await scaffoldFixture(tmpRoot, 'legacy-manifest-no-autocomplete-project');

  const manifestPath = path.join(targetDir, '.clispark', 'manifest.json');
  const oldManifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Manifest;
  oldManifest.generatorVersion = '0.0.1';
  delete (oldManifest as Partial<Manifest>).autocompleteEnabled;
  await writeFile(manifestPath, JSON.stringify(oldManifest, null, 2) + '\n');
  expect(JSON.parse(await readFile(manifestPath, 'utf8'))).not.toHaveProperty('autocompleteEnabled');

  const result = await updateProject(targetDir, nodeOclifPack.updateAdapter, nodeOclifPack.templateDir, 'node', cleanGitDeps());

  expect(result.status).toBe('updated');
  const manifestAfter = JSON.parse(await readFile(manifestPath, 'utf8'));
  expect(manifestAfter).toHaveProperty('autocompleteEnabled', false);
});
```

- [ ] **Step 9: Run the full suite, typecheck, lint**

Run: `npx tsc --noEmit && npx eslint src scripts && npx vitest run`
Expected: all green.

- [ ] **Step 10: Documentation**

Add a new "Shell Autocompletion" section to `templates/node/ARCHITECTURE.md`, placed directly after the existing "Lint Tooling" section (same tone/depth/always-present-prose pattern — see Global Constraints for why this is unconditional rather than stripped):

```markdown
## Shell Autocompletion

If you answered "yes" to "Set up shell autocompletion?" during scaffolding, this project includes
[`@oclif/plugin-autocomplete`](https://github.com/oclif/plugin-autocomplete) as a runtime
dependency, registered in `package.json`'s `oclif.plugins` array. Set it up once per shell:

```bash
<cli> autocomplete bash   # or zsh, powershell
```

This prints the exact command to append to your shell config (e.g. `~/.bashrc`) and source it.
After that, `<cli> <TAB><TAB>` completes command names, and `<cli> <command> --<TAB><TAB>`
completes flag names.

If you answered "no", none of this is present — no `@oclif/plugin-autocomplete` dependency, no
entry in `oclif.plugins`, and the `autocomplete` command itself doesn't exist.

Either way, this choice is permanent and core-managed: `npx clispark update` keeps the plugin
dependency version current for a project that opted in, and will never add it to a project that
declined. There's no retroactive "turn autocompletion on later" command — rerun `clispark` in a
new directory if you want it.
```

Add a short "Shell Autocompletion" section to `templates/node/README.md`, after the existing "Example commands" section:

```markdown
## Shell Autocompletion

If you set up autocompletion during scaffolding, run `node bin/run.ts autocomplete bash` (or
`zsh`/`powershell`) once to see the exact setup command for your shell. See
`ARCHITECTURE.md`'s "Shell Autocompletion" section for details.
```

- [ ] **Step 11: Real end-to-end verification (not mocked)**

Scaffold two real throwaway projects (one with `autocompleteEnabled: true`, one `false`) using the actual built CLI, then:
- For the `true` project: `npm install`, then run `node bin/run.ts autocomplete bash` — expect real setup instructions printed (not an error), and confirm `package.json`'s `dependencies` contains `@oclif/plugin-autocomplete` and `oclif.plugins` contains it too.
- For the `false` project: confirm `package.json` has neither the dependency nor the `oclif.plugins` entry, and that `node bin/run.ts autocomplete bash` fails with an oclif "command not found"-style error (the plugin, and therefore the `autocomplete` command itself, doesn't exist).
- Clean up both temp projects afterward.

- [ ] **Step 12: Add CI smoke coverage for the opt-in path**

Modify `.github/workflows/ci.yml`'s `scaffold-smoke` job (Node) — add two new steps directly after the existing "Scaffold a lint-enabled project and verify it builds clean" / "Run the opted-in scaffold's own lint and format tooling" pair, following their exact structure:

```yaml
      - name: Scaffold an autocomplete-enabled project and verify the plugin is wired up
        run: |
          cat > ci-smoke-verify-autocomplete.mjs << 'EOF'
          import { scaffoldProject } from './src/scaffold';
          import { nodeOclifPack } from './src/languages/packs/node-oclif';
          import path from 'node:path';
          import os from 'node:os';

          const targetDir = path.join(os.tmpdir(), 'clispark-ci-smoke-autocomplete', 'smoke-test-cli-autocomplete');
          await scaffoldProject({ projectName: 'smoke-test-cli-autocomplete', targetDir, autocompleteEnabled: true }, nodeOclifPack);
          console.log('scaffold complete:', targetDir);
          EOF
          npx tsx ci-smoke-verify-autocomplete.mjs
          rm ci-smoke-verify-autocomplete.mjs
      - name: Run the opted-in scaffold's autocomplete command for real
        run: |
          cd "$(node -e "console.log(require('os').tmpdir())")/clispark-ci-smoke-autocomplete/smoke-test-cli-autocomplete"
          output="$(node bin/run.ts autocomplete bash)"
          echo "$output"
          if [[ "$output" != *"Setup Instructions"* ]]; then
            echo "autocomplete bash did not produce the expected setup instructions" >&2
            exit 1
          fi
```

(This mirrors the real command output verified during this plan's own writing — `@oclif/plugin-autocomplete@3.2.53`'s `autocomplete bash` prints a "Setup Instructions for <NAME> CLI Autocomplete" banner; matching on that substring is stable across the exact wording of the rest of the output.)

- [ ] **Step 13: Commit**

```bash
git add templates/node/package.json templates/node/ARCHITECTURE.md templates/node/README.md src/languages/autocomplete-support/node.ts src/languages/autocomplete-support/node.test.ts src/languages/packs/node-oclif.ts src/update/adapters/node-oclif.ts src/update/adapters/node-oclif.test.ts src/update/update.test.ts .github/workflows/ci.yml
git commit -m "feat: Node opt-in shell autocompletion via @oclif/plugin-autocomplete (#89)

templates/node/package.json permanently includes @oclif/plugin-autocomplete
as a dependency and in oclif.plugins (subtractive design, see plan header
for why). scaffold.ts strips both via the pack's real
stripAutocompleteSupport() when the wizard's autocomplete question was
declined (the default, replacing Task 2's no-op). Dependency
reconciliation and oclif.plugins reconciliation are both now gated on
manifest.autocompleteEnabled, so a declined project never has the plugin
silently re-added by a later clispark update, and an accepted project's
plugin version does get bumped by update. CI's scaffold-smoke job now
also exercises the opted-in path for real, learning from #70's final
review having to add that coverage after the fact instead of up front."
```

---

### Task 4: .NET documentation (pure docs, no code)

**Files:**
- Modify: `templates/dotnet/ARCHITECTURE.md`, `templates/dotnet/README.md`

**Step 0 — real, empirical verification of the full user path** (per the spec's own "Offene Punkte" #3 — not just the isolated `dotnet run -- "[suggest]" ""` check the spec already did, but the complete real flow a user would follow):

This was executed for real during this plan's own writing, against a real scaffolded `.NET` project, using this machine's already-installed `dotnet-suggest` (v2.0.10):

1. `dotnet pack src -c Release -o ./nupkg` then `dotnet tool install -g <ProjectName> --add-source ./nupkg` — confirmed the tool installs and runs (`<ProjectName> hello World` → `Hello, World!`).
2. Found the installed executable's real path: `C:\Users\<user>\.dotnet\tools\<ProjectName>.exe` (on Windows; `~/.dotnet/tools/<ProjectName>` on Linux/macOS, no `.exe`).
3. `dotnet-suggest register --command-path "<path from step 2>"` → real output: `Registered <path>`.
4. `dotnet-suggest get -e "<path>" -- ""` → real output: a real list of top-level commands and help flags (`--help`, `--version`, `-?`, `-h`, `/?`, `/h`, `hello`, `task`) — confirming the registered tool's completions actually resolve.
5. `dotnet-suggest script bash` / `dotnet-suggest script powershell` → real, working shell-integration scripts that call `dotnet-suggest get` under the hood whenever a registered command is tab-completed (verified their literal content, not just that they printed something).

- [ ] **Step 1: Add the "Shell Completion" section to `templates/dotnet/ARCHITECTURE.md`**

Placed directly after the existing "Lint Tooling" section (same always-present, no-wizard-choice framing as the spec calls for — this section never varies, since .NET has no opt-in for this feature):

```markdown
## Shell Completion

`System.CommandLine` 2.0.10's `[suggest]` directive is already part of this project's parsing
pipeline — no code in `Program.cs` or any command needs to change. To activate it in your shell:

1. Install the registration tool once per machine: `dotnet tool install -g dotnet-suggest`
2. Install this project as a global tool (see the README's "Building and running" section), then
   register it once per installation:
   ```bash
   dotnet-suggest register --command-path "$(which {{projectName}})"
   ```
   (On Windows, use the `.exe` path `dotnet-suggest` prints after `dotnet tool install -g` instead
   of `which`.)
3. Add shell integration to your profile once per machine:
   ```bash
   dotnet-suggest script bash >> ~/.bashrc   # or: script powershell, script zsh
   ```

After that, `{{projectName}} <TAB><TAB>` completes command names automatically — the completion
logic lives entirely in `dotnet-suggest`/`System.CommandLine`, not in this project's own code.
```

- [ ] **Step 2: Add a short "Shell Completion" section to `templates/dotnet/README.md`**

After the existing "Example commands" section:

```markdown
## Shell Completion

Tab-completion works out of the box via `System.CommandLine`'s built-in `[suggest]` support — see
`ARCHITECTURE.md`'s "Shell Completion" section for the one-time `dotnet-suggest` setup.
```

- [ ] **Step 3: Commit**

```bash
git add templates/dotnet/ARCHITECTURE.md templates/dotnet/README.md
git commit -m "docs: document built-in shell completion for the .NET template (#89)

System.CommandLine's [suggest] directive needs zero code changes --
documented the real dotnet-suggest register + shell-integration setup
path, verified end to end against a real packed/installed tool during
this plan's own writing (pack -> global install -> register ->
dotnet-suggest get returning real completions)."
```

---

### Task 5: PowerShell documentation (pure docs, no code)

**Files:**
- Modify: `templates/powershell/ARCHITECTURE.md`, `templates/powershell/README.md`

**Real verification behind this task:** the design spec already verified cmdlet-name and `[ValidateSet]`-parameter completion work natively via `TabExpansion2` against a real test function. This plan additionally confirmed `$PROFILE`'s real value on this machine (`C:\Users\<user>\Documents\PowerShell\Microsoft.PowerShell_profile.ps1` on PowerShell 7.x/Core — a different path than Windows PowerShell 5.1's `...\WindowsPowerShell\...`), for the optional profile-persistence note below.

- [ ] **Step 1: Add a "Shell Completion" section to `templates/powershell/ARCHITECTURE.md`**

Placed directly after the existing "Logging" section (the file's last section today):

```markdown
## Shell Completion

Cmdlet-name completion (`Get-H<TAB>` → `Get-Hello`) and parameter-value completion for any
`[ValidateSet(...)]`-constrained parameter are native PowerShell shell features for every
imported module — nothing in this project enables them, and nothing could disable them. As soon
as `Import-Module ./Module.psd1` has run in a session, both kinds of completion work immediately
for every `Public/` cmdlet.
```

- [ ] **Step 2: Add a short "Shell Completion" section to `templates/powershell/README.md`**

After the existing "Usage" section:

```markdown
## Shell Completion

Tab-completion works automatically once the module is imported — no setup needed. If you don't
want to run `Import-Module ./Module.psd1` in every new session, add that line to your PowerShell
`$PROFILE` (run `$PROFILE` to see its path; `New-Item -Path $PROFILE -ItemType File -Force` first
if it doesn't exist yet).
```

- [ ] **Step 3: Commit**

```bash
git add templates/powershell/ARCHITECTURE.md templates/powershell/README.md
git commit -m "docs: document native shell completion for the PowerShell template (#89)

Cmdlet-name and [ValidateSet] parameter completion are native
PowerShell module features -- nothing to scaffold, nothing to enable.
Documented the real \$PROFILE path convention for the optional
persistent-import note."
```

---

### Task 6: Final whole-branch review

Standard project convention for multi-task plans (see #70/M12b) — a full review of the entire branch's diff against this plan, not just each task in isolation. Specifically check:

- No `pack.id === 'node'`-style hardcoded per-language branch exists anywhere in `wizard.ts` or `scaffold.ts` (Task 2's design deliberately avoided ever needing one — confirm it stayed that way; the `supportsAutocompleteOptIn` check is the only language-differentiating logic and it reads a pack property, not a language ID).
- Every place that reads `manifest.autocompleteEnabled`/`oldManifest.autocompleteEnabled` uses it in a boolean/ternary context, never a strict `=== true`/`=== false` comparison that would mishandle a pre-#89 manifest's `undefined` value (per Global Constraints) — grep every `.autocompleteEnabled` read site and confirm.
- `AUTOCOMPLETE_DEPENDENCY_NAME` is referenced from a single source of truth (`src/languages/autocomplete-support/node.ts`) everywhere it's used — confirm `stripAutocompleteSupport`, the dependency-name filter, and the `oclif.plugins` filter in `node-oclif.ts` all import it rather than any of them hardcoding the string a second time.
- `coreFilePaths` is confirmed unchanged by this entire branch (grep `coreFilePaths` in the diff — it should show zero behavioral changes, only type-signature-compatible passthroughs from Task 1).
- **Grep `.github/workflows/*.yml` for any other inline script calling `scaffoldProject(...)`** beyond the one this plan's Task 3 already updated (the `scaffold-smoke-dotnet` job, for instance) and confirm each call site still compiles/behaves correctly with the new optional `autocompleteEnabled` field — the field being optional should mean no other call site needs changes, but confirm it for real, per the M12a-class gap this exact check exists to catch.
- Confirm `templates/dotnet/**` and `templates/powershell/**` have zero non-documentation changes anywhere in the branch — this entire feature should be provably Node-only outside of `src/update/adapter.ts`/`src/update/manifest.ts`/`src/languages/pack.ts` (which every adapter/pack must structurally satisfy) and the two pure-docs tasks.
- Re-run the real end-to-end verifications from Task 3 Step 11 (Node autocomplete on/off) one more time against the final merged state of the branch, not just after their own task — and spot-check Task 4's real `dotnet-suggest register` walkthrough still works against the final merged `.NET` template (the analyzer/lint-tooling `<PropertyGroup>` from #70 lives in the same `Cli.csproj`; confirm the two features don't interact).

## Self-Review Notes (from writing this plan)

- **Spec coverage:** every section of the design spec has a task — Node's wizard-opt-in mechanism (Tasks 1-3), .NET's zero-code-change documentation (Task 4), PowerShell's zero-code-change documentation (Task 5), and the final whole-branch review (Task 6) mirroring #70's own closing task. The spec's four "Offene Punkte für den Implementierungsplan" are all resolved: point 1 (wait for #70) is done — this plan reuses `CoreFilePathsFlags`/`stripLintTooling`'s real, shipped shape; point 2 (exact `LanguagePack` hook placement) is resolved as a second specific field (`supportsAutocompleteOptIn`/`stripAutocompleteSupport`), matching #70's own choice not to generalize; point 3 (real end-to-end verification of .NET/PowerShell setup) was done for real during this plan's own writing (Task 4's Step 0); point 4 (PowerShell-as-a-client-shell-for-Node vs. PowerShell-the-language overlap) was confirmed as genuinely irrelevant — `@oclif/plugin-autocomplete`'s PowerShell client support only matters for someone using PowerShell as their *terminal* to run a *Node* CLI, an orthogonal concern from the PowerShell `LanguagePack`.
- **One deliberate deviation from the spec, called out explicitly in Global Constraints:** the spec's literal wording asks for a README section "only when enabled." This plan instead makes all doc sections unconditional, always-present prose — matching #70's own proven, safer precedent, and avoiding introducing a new Markdown-text-stripping mechanism into a codebase that has already been bitten twice by CRLF-fragile regex text surgery.
- **Placeholder scan:** no TBD/TODO, every step has real code or a real verified command output, no "similar to Task N" references.
- **Type consistency:** `autocompleteEnabled` is spelled identically across every task (`Manifest`, `CoreFilePathsFlags`, `WizardAnswers`, `ScaffoldOptions`); `AUTOCOMPLETE_DEPENDENCY_NAME`/`withoutAutocompletePlugin`/`stripAutocompleteSupport` are the exact names Task 3 defines and Task 3's own later steps consume — no renaming drift.
