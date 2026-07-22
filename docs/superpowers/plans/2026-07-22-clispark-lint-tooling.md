# Opt-in General Lint Tooling per Language — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new wizard yes/no question ("Set up lint tooling?", default No) that, when accepted, gives the generated project a real ESLint+Prettier setup (Node) or a broadened built-in Roslyn analyzer configuration (.NET) — tracked as core-managed files/fields so `clispark update` keeps them current, exactly like every other core-managed surface.

**Design spec:** `docs/superpowers/specs/2026-07-22-clispark-lint-tooling-design.md` — read it first for the full rationale and the three architecture gaps found during its review. This plan resolves those gaps concretely.

**Revision note:** this plan was self-reviewed once after its first draft. That review found: a messy/inconsistent draft of Task 1's second test, two real test-fixture call sites of `coreFilePaths` missed by the first draft's file list (`src/wizard.test.ts`, and a second fake adapter inside `src/update/update.test.ts` itself), a placeholder `pack.id === 'node'` hack in Task 3 that Task 4 would have had to remove, an unverified guess at `wizard.test.ts`'s mocking pattern, and two under-specified "simulate a dependency version bump" tests. All fixed in this version — see inline notes marked **(fixed in review)**.

**Architecture — additive-vs-subtractive decision:**

The spec identified that `eslint.config.js`/`.prettierrc` can't simply be written by a post-copy step that reads nothing from the template, because `update.ts`'s file-reconciliation loop (`src/update/update.ts`, lines ~95-100) unconditionally does `readFile(path.join(templateDir, adapter.templateSourcePath(relativePath)))` for every path in `adapter.coreFilePaths(...)` — if the file doesn't physically exist under `templates/node/`, that read throws during `clispark update`. Two ways to resolve this were considered:

- **Additive** (write lint files only when opted in, never present in the shared template): requires a *new* generic-engine hook so `update.ts` can get "new content" for a core path from somewhere other than `templateDir` — a real, if optional, addition to the `UpdateAdapter` interface.
- **Subtractive** (lint files/properties/scripts/deps are permanently part of `templates/node/` and `templates/dotnet/src/Cli.csproj`; scaffold strips them when the wizard says No — the common, default path): every existing read path in `manifest.ts`/`update.ts` keeps working completely unchanged, since the content genuinely exists on disk in the template. No new generic-engine method needed.

**Chosen: subtractive.** Simpler (zero new methods on the shared `UpdateAdapter` interface) at the cost of the default (declined) scaffold path doing a small amount of copy-then-strip work, and `templates/node/`'s raw source containing lint scaffolding that most generated projects won't keep. **This does not remove the need for manifest-aware conditional gating** — see Task 1: even with lint content physically present in the template, `clispark update` must still know per-project whether `eslint.config.js`, the `lint`/`format` scripts, and the lint devDependencies count as *this project's* core surface, or a declined project would have them silently re-added on its next `update` (`reconcile.ts`'s `reconcileEntry()` treats any locally-missing core path as `outcome: 'added'`).

## Global Constraints

- Every task ends in a state where `npx tsc --noEmit`, `npx eslint src scripts`, and `npx vitest run` all pass in the clispark repo root.
- Every new function follows this project's existing DI convention where relevant (see `src/wizard.ts`'s `WizardDeps`/`defaultDeps` pattern).
- `Manifest` gains one new required field: `lintEnabled: boolean`. Required (not optional) — every manifest built from this point forward has an explicit answer. An existing project predating this feature won't have `lintEnabled` in its `.clispark/manifest.json` on disk; `readManifest`'s `JSON.parse(content) as Manifest` (a plain type assertion, no runtime validation) will leave it `undefined` at runtime despite the TS type claiming `boolean`. **Concrete handling (fixed in review — the first draft only said "must be handled" without specifying how):** every place that branches on `manifest.lintEnabled` or `oldManifest.lintEnabled` in this plan uses it directly in a boolean/ternary context (`flags.lintEnabled ? x : y`, `if (!lintEnabled)`), which already treats `undefined` as falsy = "not enabled" = the correct interpretation for a pre-existing project that was never offered this feature — same outcome as M12a's explicit `manifest.language ?? 'node'` fallback, just via JS's native falsy coercion instead of an explicit `??`. Task 6's final review must grep every new `.lintEnabled` read site and confirm each one is a boolean/ternary context, never a strict `=== true`/`=== false` comparison (which would NOT coerce `undefined` to the desired default).
- PowerShell is out of scope (no `LanguagePack` exists) — nothing in this plan references it.
- The custom convention rule (#80) is a separate, later plan — nothing here implements it.
- Retroactively enabling lint tooling on an already-scaffolded project that declined it is explicitly out of scope (per spec).
- **The .NET analyzer-defaults question must be answered empirically before Task 4's `<PropertyGroup>` content is finalized** — Task 4 starts with a real, throwaway verification build (Task 4, Step 0). Do not assume `EnableNETAnalyzers`'s default from memory.
- **`LanguagePack.stripLintTooling` is added once, in Task 2, as a required field with temporary no-op implementations for both existing packs** — Tasks 3/4 each replace their pack's no-op with the real implementation. This avoids Task 3 needing any `pack.id === 'node'`-style hardcoded branch in `scaffold.ts` that Task 4 would then have to remove (the first draft of this plan did exactly that, caught in review).
- **Before considering Task 1 done, grep the whole `src/` tree for `coreFilePaths:` used as an object-literal property (not the two real adapters)** — this plan's own first draft missed two such fixtures (`src/wizard.test.ts`'s `fakeUpdateAdapter`, and a second fake adapter inside `src/update/update.test.ts`'s "drives entirely off a fake adapter" test) by only listing the two real adapter files. This is the same class of gap the project's M12a retrospective already flagged once ("grep for ALL literal-object-construction sites of that type before assuming the brief's predicted failure list is complete") — don't repeat it a third time.

---

## File Structure

```
src/update/adapter.ts              # MODIFY — coreFilePaths becomes a function, extractCoreFields gains a flags param
src/update/manifest.ts             # MODIFY — Manifest.lintEnabled, hashCoreFiles/buildManifest new param
src/update/manifest.test.ts        # MODIFY
src/update/update.ts               # MODIFY — two call sites pass oldManifest instead of reading the property
src/update/update.test.ts          # MODIFY — new tests, AND fix the existing fake-adapter fixture (line ~202)
src/update/adapters/node-oclif.ts  # MODIFY — coreFilePaths fn, CORE_SCRIPT_NAMES/dependencyNames gating
src/update/adapters/node-oclif.test.ts   # MODIFY
src/update/adapters/dotnet.ts      # MODIFY — coreFilePaths fn (static passthrough), coreFields gating
src/update/adapters/dotnet.test.ts # MODIFY
src/scaffold.ts                    # MODIFY — ScaffoldOptions.lintEnabled, stripLintTooling call
src/scaffold.test.ts               # MODIFY
src/wizard.ts                      # MODIFY — new yes/no question
src/wizard.test.ts                 # MODIFY — new question's mock responses, AND fix fakeUpdateAdapter/fakePack fixtures
src/cli.ts                         # MODIFY — thread lintEnabled through to scaffoldProject
src/languages/pack.ts              # MODIFY — LanguagePack.stripLintTooling (required field)
src/languages/packs/node-oclif.ts  # MODIFY — wires stripLintTooling (no-op in Task 2, real in Task 3)
src/languages/packs/dotnet.ts      # MODIFY — wires stripLintTooling (no-op in Task 2, real in Task 4)
src/languages/lint-support/node.ts       # CREATE (Task 3) — real stripLintTooling for Node
src/languages/lint-support/node.test.ts  # CREATE (Task 3)
src/languages/lint-support/dotnet.ts       # CREATE (Task 4) — real stripLintTooling for .NET
src/languages/lint-support/dotnet.test.ts  # CREATE (Task 4)
templates/node/eslint.config.js    # CREATE (Task 3)
templates/node/.prettierrc         # CREATE (Task 3)
templates/node/package.json        # MODIFY (Task 3) — lint/format scripts + lint devDependencies, always present
templates/dotnet/src/Cli.csproj    # MODIFY (Task 4) — new <PropertyGroup> with the four analyzer properties, always present
templates/node/ARCHITECTURE.md     # MODIFY (Task 5)
templates/dotnet/ARCHITECTURE.md   # MODIFY (Task 5)
README.md                          # MODIFY (Task 5)
```

---

### Task 1: Generic update-engine support for conditional core surfaces

**Files:**
- Modify: `src/update/adapter.ts`, `src/update/manifest.ts`, `src/update/manifest.test.ts`, `src/update/update.ts`, `src/update/update.test.ts`
- Modify (mechanical passthrough only, no behavior change yet): `src/update/adapters/node-oclif.ts`, `src/update/adapters/dotnet.ts`

**Interfaces:**
- Produces: `Manifest.lintEnabled: boolean`; `UpdateAdapter.coreFilePaths(flags: { lintEnabled: boolean }): readonly string[]` (replaces the plain property); `UpdateAdapter.extractCoreFields(manifestFile: unknown, flags: { lintEnabled: boolean }): CoreFieldsExtraction` (gains the same flags parameter).

This task is pure plumbing — after it, both existing adapters must behave **identically** to today (they ignore the new parameter and return their existing static values). No new file, script, or dependency exists yet. This isolates the risky, generic-engine-touching change from the Node/.NET-specific feature work in Tasks 3-4, so if something breaks, it's obvious which change caused it.

- [ ] **Step 1: Write the failing tests**

Add to `src/update/manifest.test.ts` (alongside the existing `hashCoreFiles`/`buildManifest` describe block):

```ts
describe('buildManifest lintEnabled', () => {
  it('records lintEnabled: true when passed', async () => {
    const manifest = await buildManifest(tmpRoot, '1.0.0', 'node', nodeOclifAdapter, true);
    expect(manifest.lintEnabled).toBe(true);
  });

  it('records lintEnabled: false when passed', async () => {
    const manifest = await buildManifest(tmpRoot, '1.0.0', 'node', nodeOclifAdapter, false);
    expect(manifest.lintEnabled).toBe(false);
  });
});

describe('coreFilePaths is now manifest-aware', () => {
  it('nodeOclifAdapter.coreFilePaths returns the same list regardless of lintEnabled (no conditional content until Task 3)', () => {
    expect(nodeOclifAdapter.coreFilePaths({ lintEnabled: false })).toEqual(CORE_FILE_PATHS);
    expect(nodeOclifAdapter.coreFilePaths({ lintEnabled: true })).toEqual(CORE_FILE_PATHS);
  });
});
```

**(Fixed in review: the first draft of this step also included a half-written `updateProject`-level "never adds a lint file" test with a note saying it "can't fully pass until Task 3" — confusing and premature. That real end-to-end regression test belongs in Task 3 Step 9, once `eslint.config.js` exists to test against; Task 1 only needs the two narrow tests above.)**

Fix the two existing fake-adapter fixtures so they still typecheck against the new function-shaped `coreFilePaths`/2-arg `extractCoreFields`:

`src/wizard.test.ts`, `fakeUpdateAdapter`:
```ts
const fakeUpdateAdapter: LanguagePack['updateAdapter'] = {
  coreFilePaths: () => [],
  templateSourcePath: (p) => p,
  manifestFileName: 'package.json',
  readManifestFile: async () => ({}),
  writeManifestFile: async () => {},
  parseManifestFile: () => ({}),
  readProjectName: () => '',
  extractCoreFields: () => ({ coreDependencies: {}, coreScripts: {}, coreFields: {} }),
  mergeManifestFile: () => ({ /* unchanged */ }),
};
```

`src/update/update.test.ts`, the "drives entirely off a fake adapter" test's `fakeAdapter` (around line 195-215):
```ts
const fakeAdapter: UpdateAdapter = {
  coreFilePaths: () => ['tsconfig.json'],
  // ...
  extractCoreFields: () => ({ coreDependencies: {}, coreScripts: {}, coreFields: {} }),
  // ...rest unchanged
};
```

**Six more real call sites, found on an exhaustive `grep -rn "extractCoreFields(\|hashCoreFiles(\|buildManifest("` pass while writing this plan (the exact scenario the Global Constraints section warns about — the first draft's file list, and even the first review pass above, still missed these):**

- `src/update/manifest.test.ts:53` — `hashCoreFiles(tmpRoot, nodeOclifAdapter)` → `hashCoreFiles(tmpRoot, nodeOclifAdapter, { lintEnabled: false })`
- `src/update/manifest.test.ts:59` — `buildManifest(tmpRoot, '9.9.9', 'node', nodeOclifAdapter)` → `buildManifest(tmpRoot, '9.9.9', 'node', nodeOclifAdapter, false)`
- `src/update/adapters/node-oclif.test.ts:32,40,48` — three calls to `nodeOclifAdapter.extractCoreFields({...})` / `extractCoreFields({})`, each needs a second argument: `nodeOclifAdapter.extractCoreFields({...}, { lintEnabled: false })`
- `src/update/adapters/dotnet.test.ts:65,71,77` — three calls to `dotnetAdapter.extractCoreFields(parsed)`, each needs a second argument: `dotnetAdapter.extractCoreFields(parsed, { lintEnabled: false })`

All eight of these (the two above plus these six) are **pre-existing tests unrelated to lint tooling** — they're testing that core-field/core-file extraction works correctly in general, and `{ lintEnabled: false }` is the right argument for all of them since Task 1 doesn't change any adapter's actual behavior yet (the flag is threaded through and ignored). Fix all eight in this task; do not defer any of them to Task 3/4.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run`
Expected: FAIL — `buildManifest` doesn't accept a 5th argument yet; `coreFilePaths`/`extractCoreFields` are still the old shapes, so the two fixed fixtures above don't typecheck (`npx tsc --noEmit` should also fail at this point) until Step 3 lands.

- [ ] **Step 3: Implement**

`src/update/adapter.ts`:

```ts
export interface CoreFilePathsFlags {
  lintEnabled: boolean;
}

export interface UpdateAdapter {
  coreFilePaths(flags: CoreFilePathsFlags): readonly string[];
  templateSourcePath(relativePath: string): string;

  readonly manifestFileName: string;
  readManifestFile(dir: string): Promise<unknown>;
  writeManifestFile(dir: string, content: unknown): Promise<void>;
  parseManifestFile(rawContent: string): unknown;
  readProjectName(manifestFile: unknown): string;
  extractCoreFields(manifestFile: unknown, flags: CoreFilePathsFlags): CoreFieldsExtraction;
  mergeManifestFile(current: unknown, oldManifest: Manifest, newTemplate: unknown): ManifestFileMergeResult;
}
```

`src/update/manifest.ts`:

```ts
export interface Manifest {
  generatorVersion: string;
  language: string;
  lintEnabled: boolean;
  coreFiles: Record<string, string>;
  coreDependencies: Record<string, string>;
  coreScripts: Record<string, string>;
  coreFields: Record<string, unknown>;
}

export async function hashCoreFiles(
  dir: string,
  adapter: UpdateAdapter,
  flags: CoreFilePathsFlags,
): Promise<Record<string, string>> {
  const entries = await Promise.all(
    adapter.coreFilePaths(flags).map(async (relativePath) => {
      const content = await readFile(path.join(dir, relativePath), 'utf8');
      return [relativePath, hashContent(content)] as const;
    }),
  );
  return Object.fromEntries(entries);
}

export async function buildManifest(
  targetDir: string,
  generatorVersion: string,
  language: string,
  adapter: UpdateAdapter,
  lintEnabled: boolean,
): Promise<Manifest> {
  const coreFiles = await hashCoreFiles(targetDir, adapter, { lintEnabled });
  const manifestFile = await adapter.readManifestFile(targetDir);
  const { coreDependencies, coreScripts, coreFields } = adapter.extractCoreFields(manifestFile, { lintEnabled });
  return { generatorVersion, language, lintEnabled, coreFiles, coreDependencies, coreScripts, coreFields };
}
```

`src/update/update.ts` — two call sites change from property access to function calls, both passing `oldManifest` directly (it structurally satisfies `CoreFilePathsFlags` since it has a `lintEnabled: boolean` field):

```ts
// was: adapter.coreFilePaths.map(...)
adapter.coreFilePaths(oldManifest).map(async (relativePath) => { /* unchanged body */ }),

// was: if (adapter.coreFilePaths.includes(relativePath)) continue;
if (adapter.coreFilePaths(oldManifest).includes(relativePath)) continue;
```

**Also fix `update.ts`'s own `newManifest` construction (lines ~162-169) — found on the same exhaustive grep pass, and load-bearing (without it, `update.ts` doesn't compile, since `Manifest.lintEnabled` is required):**

```ts
const newManifest: Manifest = {
  generatorVersion: toVersion,
  language,
  lintEnabled: oldManifest.lintEnabled,   // ADD — carries the scaffold-time choice forward unchanged; update never re-asks
  coreFiles: newCoreFiles,
  coreDependencies: fileMerge.coreDependencies,
  coreScripts: fileMerge.coreScripts,
  coreFields: fileMerge.coreFields,
};
```

**And four literal `Manifest`-shaped test fixtures, found the same way, each needs `lintEnabled: false` added (or `true`, if the specific test is about lint reconciliation — check each site's intent, don't blindly paste `false` everywhere):**
- `src/update/adapters/dotnet.test.ts:34`
- `src/update/adapters/node-oclif.test.ts:10`
- `src/update/manifest.test.ts:81`
- `src/update/update.test.ts:230`

`src/update/adapters/node-oclif.ts` and `src/update/adapters/dotnet.ts` — mechanical passthrough (Task 1 only, no behavior change):

```ts
// node-oclif.ts
coreFilePaths(_flags) {
  return CORE_FILE_PATHS;
},
extractCoreFields(manifestFile, _flags) {
  return extractCoreFields(manifestFile as PackageJsonShape);
},

// dotnet.ts
coreFilePaths(_flags) {
  return CORE_FILE_PATHS;
},
extractCoreFields(manifestFile, _flags) {
  return extractCoreFields(manifestFile as DotnetManifestFile);
},
```

`src/scaffold.ts`'s single `buildManifest` call site — for Task 1, hardcode `false` (Task 2 threads the real value through `ScaffoldOptions`):

```ts
const manifest = await buildManifest(targetDir, getGeneratorVersion(), pack.id, pack.updateAdapter, false);
```

- [ ] **Step 4: Grep for any remaining `coreFilePaths:`/`extractCoreFields:` object-literal sites**

Run: `grep -rn "coreFilePaths:" src --include="*.ts"` and `grep -rn "extractCoreFields:" src --include="*.ts"`. Confirm every result is either one of the two real adapters (now a function) or one of the two fixtures fixed in Step 1 — if a third site turns up that this plan didn't anticipate, fix it now, the same way, before moving on (this is the exact check the Global Constraints section calls out).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run` (full suite — this touches a widely-used interface).

- [ ] **Step 6: Typecheck and lint**

Run: `npx tsc --noEmit && npx eslint src scripts`

- [ ] **Step 7: Commit**

```bash
git add src/update/adapter.ts src/update/manifest.ts src/update/manifest.test.ts src/update/update.ts src/update/update.test.ts src/update/adapters/node-oclif.ts src/update/adapters/dotnet.ts src/scaffold.ts src/wizard.test.ts
git commit -m "refactor: make UpdateAdapter.coreFilePaths and extractCoreFields manifest-aware

Pure plumbing for the upcoming opt-in lint tooling feature (#70) -- no
observable behavior change. coreFilePaths becomes a function of
{lintEnabled}, extractCoreFields gains the same flag, both existing
adapters ignore it and keep returning their current static values. Also
fixes two fake-adapter test fixtures (wizard.test.ts, update.test.ts)
that constructed coreFilePaths as a plain array literal."
```

---

### Task 2: Wizard question, `ScaffoldOptions.lintEnabled`, and the `LanguagePack.stripLintTooling` extension point

**Files:**
- Modify: `src/wizard.ts`, `src/wizard.test.ts`, `src/scaffold.ts`, `src/scaffold.test.ts`, `src/cli.ts`, `src/languages/pack.ts`, `src/languages/packs/node-oclif.ts`, `src/languages/packs/dotnet.ts`

**Interfaces:**
- Produces: `WizardAnswers.lintEnabled: boolean`; `ScaffoldOptions.lintEnabled?: boolean`; `LanguagePack.stripLintTooling: (targetDir: string) => Promise<void>` (required field, no-op stub for both packs in this task).

**Why `stripLintTooling` lives here, not in Task 3:** it needs to exist as a real, required `LanguagePack` field before `scaffold.ts` can call it unconditionally (`await pack.stripLintTooling(targetDir)` when declined) without an `if (pack.id === 'node')`-style branch. Making it required (not optional) means a future third pack can't forget to wire it in.

- [ ] **Step 1: Write the failing tests**

Add to `src/wizard.test.ts` — extend the mock chain by one more `select()` response, matching this file's real, verified pattern (`vi.mocked(select).mockResolvedValueOnce(...).mockResolvedValueOnce(...)...`, one value per question in call order: language → profile → publishIntent → **lintEnabled (new, last)**). Update the existing tests' `select` mock chains to append the new answer, and add two new tests:

```ts
// existing tests' select() chains each need one more .mockResolvedValueOnce(...) appended at the end,
// e.g. the first test in the file currently ends:
//   vi.mocked(select).mockResolvedValueOnce('node').mockResolvedValueOnce('private').mockResolvedValueOnce(true);
// becomes:
//   vi.mocked(select).mockResolvedValueOnce('node').mockResolvedValueOnce('private').mockResolvedValueOnce(true).mockResolvedValueOnce(false);
// Do this for every existing test in the describe('runWizard', ...) block, not just the new ones below.

it('asks whether to set up lint tooling, defaulting to No', async () => {
  vi.mocked(text)
    .mockResolvedValueOnce('available')
    .mockResolvedValueOnce('available'); // adjust per this test's actual registry-check mock shape
  vi.mocked(select)
    .mockResolvedValueOnce('node')
    .mockResolvedValueOnce('private')
    .mockResolvedValueOnce(true)
    .mockResolvedValueOnce(false);
  vi.mocked(text).mockResolvedValueOnce('my-cli');

  const answers = await runWizard(fakePack(async () => 'available'));
  expect(answers.lintEnabled).toBe(false);
});

it('records lintEnabled: true when the user opts in', async () => {
  vi.mocked(select)
    .mockResolvedValueOnce('node')
    .mockResolvedValueOnce('private')
    .mockResolvedValueOnce(true)
    .mockResolvedValueOnce(true);
  vi.mocked(text).mockResolvedValueOnce('my-cli');

  const answers = await runWizard(fakePack(async () => 'available'));
  expect(answers.lintEnabled).toBe(true);
});
```

**(Fixed in review: the first draft of this step invented a non-existent `defaultTestDeps({ selectResponses: [...] })` helper. The real file mocks `@clack/prompts`' `select`/`text` directly via `vi.mocked(...).mockResolvedValueOnce(...)` chains and a local `fakePack()` builder — verified by reading the actual file before writing this step. Match the exact surrounding test's structure, since the precise mock sequence depends on which branches — e.g. "work" vs "private" profile — that specific test exercises.)**

Add `stripLintTooling: vi.fn()` to `wizard.test.ts`'s `fakePack()` helper (it constructs a full `LanguagePack`, which now requires this field to typecheck).

Add to `src/scaffold.test.ts`:

```ts
it('defaults lintEnabled to false in the manifest when not specified', async () => {
  // scaffold without passing options.lintEnabled
  const manifest = await readManifest(targetDir);
  expect(manifest?.lintEnabled).toBe(false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run`
Expected: FAIL — `lintEnabled` doesn't exist on the wizard's answers or the manifest yet; `fakePack()` doesn't typecheck without `stripLintTooling`.

- [ ] **Step 3: Implement**

`src/wizard.ts` — new question after the existing `publishIntentValue` block, same `select()` pattern already used for it:

```ts
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
```

Add `lintEnabled: boolean` to the `WizardAnswers` interface and the final returned object.

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
}
```

`src/languages/packs/node-oclif.ts` and `src/languages/packs/dotnet.ts` — temporary no-op for this task only:

```ts
stripLintTooling: async () => {},
```

`src/scaffold.ts`:

```ts
export interface ScaffoldOptions {
  projectName: string;
  targetDir: string;
  registryUrl?: string;
  publishIntent?: boolean;
  lintEnabled?: boolean;
}

// in scaffoldProject, after copyTemplate(options, pack):
const lintEnabled = options.lintEnabled ?? false;
if (!lintEnabled) {
  await pack.stripLintTooling(targetDir);
}
const manifest = await buildManifest(targetDir, getGeneratorVersion(), pack.id, pack.updateAdapter, lintEnabled);
```

(This replaces Task 1's hardcoded `false` 5th argument with the real threaded value, and calls the now-real-but-still-no-op `stripLintTooling` — harmless until Task 3/4 give it actual behavior.)

`src/cli.ts` — thread `answers.lintEnabled` from the wizard result into the `scaffoldProject()` call's options object (same place `publishIntent`/`registryUrl` are already threaded).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run`

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit && npx eslint src scripts`

- [ ] **Step 6: Commit**

```bash
git add src/wizard.ts src/wizard.test.ts src/scaffold.ts src/scaffold.test.ts src/cli.ts src/languages/pack.ts src/languages/packs/node-oclif.ts src/languages/packs/dotnet.ts
git commit -m "feat: add wizard question for opt-in lint tooling (#70)

New yes/no question, default No. Answer flows through ScaffoldOptions
into the manifest as lintEnabled. LanguagePack gains a required
stripLintTooling field (no-op stubs for both packs in this commit) so
scaffold.ts can call it unconditionally without a hardcoded per-language
branch -- Task 3/4 fill in the real Node/.NET implementations. No actual
lint tooling is scaffolded yet."
```

---

### Task 3: Node lint tooling (ESLint + Prettier)

**Files:**
- Create: `templates/node/eslint.config.js`, `templates/node/.prettierrc`, `src/languages/lint-support/node.ts`, `src/languages/lint-support/node.test.ts`
- Modify: `templates/node/package.json`, `src/update/adapters/node-oclif.ts`, `src/update/adapters/node-oclif.test.ts`, `src/update/update.test.ts`, `src/languages/packs/node-oclif.ts`

**Interfaces:**
- Produces: `stripLintTooling(targetDir: string): Promise<void>` (Node-specific, real implementation replacing Task 2's no-op); `LINT_SCRIPT_NAMES`, `LINT_DEPENDENCY_NAMES` (exported constants — the single source of truth for "what counts as lint" for Node, reused by both `stripLintTooling` and the reconciliation-gating logic in Step 8, so there is never a second list that could drift out of sync with the first).

**Step 0 — verify the real package names/versions before writing template content** (per spec's open question): run `npm view typescript-eslint version`, `npm view @eslint/js version`, `npm view eslint-config-prettier version`, `npm view prettier version` for real, current versions — don't reuse this plan's placeholder versions if they're stale by the time this task executes.

- [ ] **Step 1: Add the lint template files, always present (subtractive design — see plan header)**

Create `templates/node/eslint.config.js`, copying clispark's own real, working `eslint.config.ts` pattern verbatim (same principle as reusing an established in-repo pattern rather than inventing one):

```js
// eslint.config.js
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: ['dist/**'],
  },
  {
    files: ['src/**/*.ts', 'bin/**/*.ts'],
    extends: [eslint.configs.recommended, ...tseslint.configs.recommended, eslintConfigPrettier],
  },
);
```

Create `templates/node/.prettierrc`:

```json
{
  "singleQuote": true,
  "semi": true
}
```

- [ ] **Step 2: Add lint scripts + devDependencies to the template, always present**

Modify `templates/node/package.json`'s `scripts` and `devDependencies`:

```json
"scripts": {
  "build": "tsup",
  "postbuild": "shx chmod +x bin/run.ts",
  "format": "prettier --write .",
  "lint": "eslint src bin",
  "pretest": "npm run build",
  "test": "vitest run",
  "typecheck": "tsc --noEmit"
},
```

```json
"devDependencies": {
  "@eslint/js": "^<verified version>",
  "@oclif/test": "^4.0.0",
  "@types/node": "^24.0.0",
  "eslint": "^<verified version>",
  "eslint-config-prettier": "^<verified version>",
  "prettier": "^<verified version>",
  "shx": "^0.3.4",
  "tsup": "^8.3.5",
  "typescript": "^5.7.2",
  "typescript-eslint": "^<verified version>",
  "vitest": "^4.1.10"
}
```

- [ ] **Step 3: Write the failing tests for `stripLintTooling`**

Create `src/languages/lint-support/node.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { stripLintTooling } from './node';

describe('stripLintTooling', () => {
  let targetDir: string;

  beforeEach(async () => {
    targetDir = await mkdtemp(path.join(tmpdir(), 'clispark-strip-lint-test-'));
    await writeFile(path.join(targetDir, 'eslint.config.js'), 'export default [];\n');
    await writeFile(path.join(targetDir, '.prettierrc'), '{}\n');
    await writeFile(
      path.join(targetDir, 'package.json'),
      JSON.stringify({
        scripts: { build: 'tsup', lint: 'eslint src', format: 'prettier --write .' },
        devDependencies: {
          tsup: '^8.0.0',
          eslint: '^9.0.0',
          '@eslint/js': '^9.0.0',
          'typescript-eslint': '^8.0.0',
          prettier: '^3.0.0',
          'eslint-config-prettier': '^9.0.0',
        },
      }),
    );
  });

  afterEach(async () => {
    await rm(targetDir, { recursive: true, force: true });
  });

  it('deletes eslint.config.js and .prettierrc', async () => {
    await stripLintTooling(targetDir);
    await expect(readFile(path.join(targetDir, 'eslint.config.js'), 'utf8')).rejects.toThrow();
    await expect(readFile(path.join(targetDir, '.prettierrc'), 'utf8')).rejects.toThrow();
  });

  it('removes lint/format scripts and lint devDependencies from package.json, keeps the rest', async () => {
    await stripLintTooling(targetDir);
    const pkg = JSON.parse(await readFile(path.join(targetDir, 'package.json'), 'utf8'));
    expect(pkg.scripts).toEqual({ build: 'tsup' });
    expect(pkg.devDependencies).toEqual({ tsup: '^8.0.0' });
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npx vitest run src/languages/lint-support`
Expected: FAIL — module doesn't exist.

- [ ] **Step 5: Implement `stripLintTooling`**

Create `src/languages/lint-support/node.ts`:

```ts
// src/languages/lint-support/node.ts
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const LINT_SCRIPT_NAMES = ['lint', 'format'] as const;
export const LINT_DEPENDENCY_NAMES = [
  'eslint',
  '@eslint/js',
  'typescript-eslint',
  'prettier',
  'eslint-config-prettier',
] as const;

export async function stripLintTooling(targetDir: string): Promise<void> {
  await rm(path.join(targetDir, 'eslint.config.js'), { force: true });
  await rm(path.join(targetDir, '.prettierrc'), { force: true });

  const pkgPath = path.join(targetDir, 'package.json');
  const pkg = JSON.parse(await readFile(pkgPath, 'utf8'));

  for (const name of LINT_SCRIPT_NAMES) delete pkg.scripts?.[name];
  for (const name of LINT_DEPENDENCY_NAMES) delete pkg.devDependencies?.[name];

  await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/languages/lint-support`

- [ ] **Step 7: Wire the real implementation into the Node pack**

`src/languages/packs/node-oclif.ts`:

```ts
import { stripLintTooling } from '../lint-support/node';
// ...
stripLintTooling, // replaces Task 2's `async () => {}`
```

- [ ] **Step 8: Gate `CORE_SCRIPT_NAMES` and dependency reconciliation on `lintEnabled`, and make `coreFilePaths` genuinely conditional**

Modify `src/update/adapters/node-oclif.ts`:

```ts
import { LINT_SCRIPT_NAMES, LINT_DEPENDENCY_NAMES } from '../../languages/lint-support/node';

coreFilePaths(flags) {
  return flags.lintEnabled ? [...CORE_FILE_PATHS, 'eslint.config.js', '.prettierrc'] : CORE_FILE_PATHS;
},
```

```ts
function extractCoreFields(pkg: PackageJsonShape, flags: CoreFilePathsFlags): CoreFieldsExtraction {
  // coreDependencies stays exactly as-is: it's derived from whatever's actually present in pkg,
  // which stripLintTooling already made conditional at scaffold time -- no extra gating needed
  // here specifically (see spec review point 3 for why the *reconciliation* side, below, does).
  const coreDependencies = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };

  const scriptNames = flags.lintEnabled ? [...CORE_SCRIPT_NAMES, ...LINT_SCRIPT_NAMES] : CORE_SCRIPT_NAMES;
  const coreScripts: Record<string, string> = {};
  for (const name of scriptNames) {
    const value = pkg.scripts?.[name];
    if (value !== undefined) coreScripts[name] = value;
  }

  return { coreDependencies, coreScripts, coreFields: { engines: pkg.engines ?? {}, oclif: pkg.oclif ?? {} } };
}
```

```ts
function mergePackageJson(
  currentPkg: PackageJsonShape,
  oldManifest: Manifest,
  newTemplatePkg: PackageJsonShape,
): ManifestFileMergeResult {
  const updatedFile: PackageJsonShape = { ...currentPkg };
  let changed = false;

  const dependencies: FieldOutcome[] = [];
  const coreDependencies: Record<string, string> = {};
  const dependencyNames = new Set(
    [...Object.keys(newTemplatePkg.dependencies ?? {}), ...Object.keys(newTemplatePkg.devDependencies ?? {})].filter(
      (name) => oldManifest.lintEnabled || !(LINT_DEPENDENCY_NAMES as readonly string[]).includes(name),
    ),
  );
  // ...loop body over dependencyNames is unchanged from today...

  const scriptNames = oldManifest.lintEnabled ? [...CORE_SCRIPT_NAMES, ...LINT_SCRIPT_NAMES] : CORE_SCRIPT_NAMES;
  // ...replace the existing `for (const name of CORE_SCRIPT_NAMES)` loop with `for (const name of scriptNames)`,
  // body otherwise unchanged...
}
```

- [ ] **Step 9: Add the regression tests the spec explicitly called for**

Add to `src/update/adapters/node-oclif.test.ts`:

```ts
describe('coreFilePaths with lintEnabled', () => {
  it('includes eslint.config.js and .prettierrc only when lintEnabled is true', () => {
    expect(nodeOclifAdapter.coreFilePaths({ lintEnabled: false })).not.toContain('eslint.config.js');
    expect(nodeOclifAdapter.coreFilePaths({ lintEnabled: true })).toContain('eslint.config.js');
    expect(nodeOclifAdapter.coreFilePaths({ lintEnabled: true })).toContain('.prettierrc');
  });
});
```

Add to `src/update/update.test.ts`. **(Fixed in review: the first draft's version of these two tests was pseudocode with an unresolved "OR" between two vague techniques. This version mirrors the exact, already-proven technique the existing `'replaces unmodified core files...'` test at line 93 uses — roll back `generatorVersion` in the manifest to force `updateProject` to see the real, current template as "new" — extended with a deliberately fabricated *old* dependency version, so the *real* current template version acts as the "new" value being reconciled to.)**

```ts
it('a project that opted into lint tooling gets its eslint devDependency version-bumped by update', async () => {
  const targetDir = await scaffoldFixture(tmpRoot, 'lint-project', { lintEnabled: true });

  const manifestPath = path.join(targetDir, '.clispark', 'manifest.json');
  const oldManifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Manifest;
  const realCurrentEslintVersion = oldManifest.coreDependencies.eslint;
  oldManifest.generatorVersion = '0.0.1';
  oldManifest.coreDependencies.eslint = '^0.0.1-fake-old'; // fabricate a stale recorded version

  const pkgPath = path.join(targetDir, 'package.json');
  const pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
  pkg.devDependencies.eslint = '^0.0.1-fake-old'; // local file matches the fabricated old manifest -> "unmodified"
  await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  await writeFile(manifestPath, JSON.stringify(oldManifest, null, 2) + '\n');

  const result = await updateProject(targetDir, nodeOclifPack.updateAdapter, nodeOclifPack.templateDir, 'node', cleanGitDeps());

  const eslintOutcome = result.dependencies.find((d) => d.key === 'eslint');
  expect(eslintOutcome?.outcome).toBe('replaced');
  const pkgAfter = JSON.parse(await readFile(pkgPath, 'utf8'));
  expect(pkgAfter.devDependencies.eslint).toBe(realCurrentEslintVersion);
});

it('a project that declined lint tooling never gets eslint.config.js or eslint added by a later update', async () => {
  const targetDir = await scaffoldFixture(tmpRoot, 'no-lint-project', { lintEnabled: false });

  const manifestPath = path.join(targetDir, '.clispark', 'manifest.json');
  const oldManifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Manifest;
  oldManifest.generatorVersion = '0.0.1';
  await writeFile(manifestPath, JSON.stringify(oldManifest, null, 2) + '\n');

  const result = await updateProject(targetDir, nodeOclifPack.updateAdapter, nodeOclifPack.templateDir, 'node', cleanGitDeps());

  expect(result.files.find((f) => f.path === 'eslint.config.js')).toBeUndefined();
  await expect(readFile(path.join(targetDir, 'eslint.config.js'), 'utf8')).rejects.toThrow();
  expect(result.dependencies.find((d) => d.key === 'eslint')).toBeUndefined();
});
```

`scaffoldFixture`'s current exact signature (verified against the real file) is:

```ts
async function scaffoldFixture(tmpRoot: string, name: string): Promise<string> {
  const targetDir = path.join(tmpRoot, name);
  await scaffoldProject({ projectName: name, targetDir }, nodeOclifPack, { runCommand: vi.fn(async () => {}) });
  return targetDir;
}
```

Extend it with an optional third parameter, keeping every existing call site (which passes only two arguments) valid:

```ts
async function scaffoldFixture(tmpRoot: string, name: string, options: { lintEnabled?: boolean } = {}): Promise<string> {
  const targetDir = path.join(tmpRoot, name);
  await scaffoldProject(
    { projectName: name, targetDir, lintEnabled: options.lintEnabled },
    nodeOclifPack,
    { runCommand: vi.fn(async () => {}) },
  );
  return targetDir;
}
```

- [ ] **Step 10: Run the full suite, typecheck, lint**

Run: `npx tsc --noEmit && npx eslint src scripts && npx vitest run`
Expected: all green.

- [ ] **Step 11: Real end-to-end verification (not mocked)**

Scaffold two real throwaway projects (one with `lintEnabled: true`, one `false`) using the actual built CLI, then:
- For the `true` project: run the real `npm install && npm run lint` — expect success (baseline template code has no lint violations) and `npm run format -- --check` to report no changes needed.
- For the `false` project: confirm `eslint.config.js`/`.prettierrc` are absent and `npm run lint` fails with "missing script" (no such script defined).
- Clean up both temp projects afterward.

- [ ] **Step 12: Commit**

```bash
git add templates/node/eslint.config.js templates/node/.prettierrc templates/node/package.json src/languages/lint-support/node.ts src/languages/lint-support/node.test.ts src/languages/packs/node-oclif.ts src/update/adapters/node-oclif.ts src/update/adapters/node-oclif.test.ts src/update/update.test.ts
git commit -m "feat: Node opt-in lint tooling -- ESLint + Prettier (#70)

templates/node/ permanently includes eslint.config.js, .prettierrc, and
the lint/format scripts + devDependencies (subtractive design, see plan
header for why). scaffold.ts strips them via the pack's real
stripLintTooling() when the wizard's lint question was declined (the
default, replacing Task 2's no-op). coreFilePaths, CORE_SCRIPT_NAMES, and
package.json dependency reconciliation are all now gated on
manifest.lintEnabled, so a declined project never has lint tooling
silently re-added by a later clispark update, and an accepted project's
lint devDependency versions do get bumped by update -- both were real
gaps found during the spec's critical review."
```

---

### Task 4: .NET lint tooling (built-in Roslyn analyzers)

**Files:**
- Create: `src/languages/lint-support/dotnet.ts`, `src/languages/lint-support/dotnet.test.ts`
- Modify: `templates/dotnet/src/Cli.csproj`, `src/update/adapters/dotnet.ts`, `src/update/adapters/dotnet.test.ts`, `src/languages/packs/dotnet.ts`

**Step 0 — real, empirical verification, per the spec's explicit open question:**

Scaffold a plain `.NET` project from the *current* (pre-this-task) template. Deliberately introduce one clear style violation (e.g. an unused `using` directive, or a field that should be `readonly`). Run `dotnet build` as-is; note any analyzer warnings. Then temporarily add the proposed `<PropertyGroup>` block, run `dotnet build` again, diff the warnings. Record the actual finding in this task's commit message. **Do not proceed to Step 1 until this is done for real.**

- [ ] **Step 1: Add the analyzer properties to the template, always present (subtractive, same as Task 3)**

Modify `templates/dotnet/src/Cli.csproj`, new `<PropertyGroup>` block placed *after* the existing one (not merged into it, to avoid colliding with `applyPrivateIntent`'s regex which targets specifically "the first `<PropertyGroup>`" — spec review point 4):

```xml
<PropertyGroup>
  <EnableNETAnalyzers>true</EnableNETAnalyzers>
  <AnalysisLevel>latest</AnalysisLevel>
  <AnalysisMode>Recommended</AnalysisMode>
  <EnforceCodeStyleInBuild>true</EnforceCodeStyleInBuild>
</PropertyGroup>
```

(If Step 0 found `EnableNETAnalyzers` is already the default, keep the line anyway for explicitness, but say so plainly in the commit message rather than implying it's the property doing the work.)

- [ ] **Step 2: Write the failing tests for `stripLintTooling` (.NET)**

Create `src/languages/lint-support/dotnet.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { stripLintTooling } from './dotnet';

describe('stripLintTooling (dotnet)', () => {
  let targetDir: string;

  beforeEach(async () => {
    targetDir = await mkdtemp(path.join(tmpdir(), 'clispark-strip-lint-dotnet-test-'));
    await mkdir(path.join(targetDir, 'src'), { recursive: true });
    await writeFile(
      path.join(targetDir, 'src', 'Cli.csproj'),
      [
        '<Project Sdk="Microsoft.NET.Sdk">',
        '',
        '  <PropertyGroup>',
        '    <TargetFramework>net10.0</TargetFramework>',
        '  </PropertyGroup>',
        '',
        '  <PropertyGroup>',
        '    <EnableNETAnalyzers>true</EnableNETAnalyzers>',
        '    <AnalysisLevel>latest</AnalysisLevel>',
        '    <AnalysisMode>Recommended</AnalysisMode>',
        '    <EnforceCodeStyleInBuild>true</EnforceCodeStyleInBuild>',
        '  </PropertyGroup>',
        '',
        '</Project>',
        '',
      ].join('\n'),
    );
  });

  afterEach(async () => {
    await rm(targetDir, { recursive: true, force: true });
  });

  it('removes the analyzer PropertyGroup, leaves the rest of the file intact', async () => {
    await stripLintTooling(targetDir);
    const content = await readFile(path.join(targetDir, 'src', 'Cli.csproj'), 'utf8');
    expect(content).not.toContain('EnableNETAnalyzers');
    expect(content).toContain('<TargetFramework>net10.0</TargetFramework>');
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/languages/lint-support/dotnet.test.ts`

- [ ] **Step 4: Implement**

Create `src/languages/lint-support/dotnet.ts` — regex removes the *specific* `<PropertyGroup>` block containing `EnableNETAnalyzers` (anchored on that unique tag, not "the second PropertyGroup" positionally, so it's robust to future property reordering):

```ts
// src/languages/lint-support/dotnet.ts
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function stripLintTooling(targetDir: string): Promise<void> {
  const csprojPath = path.join(targetDir, 'src', 'Cli.csproj');
  const content = await readFile(csprojPath, 'utf8');
  const updated = content.replace(/\n\s*<PropertyGroup>\s*\n\s*<EnableNETAnalyzers>[\s\S]*?<\/PropertyGroup>\n/, '\n');
  await writeFile(csprojPath, updated);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/languages/lint-support`

- [ ] **Step 6: Wire the real implementation into the .NET pack**

`src/languages/packs/dotnet.ts`:

```ts
import { stripLintTooling } from '../lint-support/dotnet';
// ...
stripLintTooling, // replaces Task 2's `async () => {}`
```

- [ ] **Step 7: Gate .NET `coreFields` reconciliation on `lintEnabled`**

Modify `src/update/adapters/dotnet.ts` — the four analyzer properties need non-throwing optional-tag extraction (unlike `extractTag`, which throws on a missing tag — correct for structural tags like `TargetFramework` that always exist, wrong here since a declined project's `.csproj` genuinely lacks these):

```ts
function extractOptionalTag(content: string, tag: string): string | undefined {
  const match = content.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
  return match?.[1];
}
```

Extend `DotnetManifestFile`/`parseManifestFile` to also capture the four analyzer properties as optional fields via `extractOptionalTag`. Extend `extractCoreFields`/`mergeManifestFile` to include them in `coreFields` only when `flags.lintEnabled`/`oldManifest.lintEnabled` respectively — same conditional-gating shape as Task 3 Step 8, applied to `coreFields` instead of `coreDependencies`/`coreScripts` (no new `PackageReference` is added for .NET — confirmed during spec review, this is purely a `.csproj`-property feature).

`coreFilePaths` for .NET stays exactly as Task 1 left it (an unconditional passthrough) — .NET's lint feature adds zero new tracked *files*, only properties inside the already-core `.csproj`, so there is nothing for `coreFilePaths` to gate here.

- [ ] **Step 8: Add the regression tests**

Mirror Task 3 Step 9's two concrete `update.test.ts`-style tests, adapted for `.NET`'s `dotnet.test.ts` and a `.NET` scaffold fixture: fabricate an old `AnalysisMode` value in both the local `.csproj` and the manifest, confirm a real-template-driven `update` reconciles it back to the current value for an opted-in project, and confirm a declined project never gains the analyzer `PropertyGroup` after the same version-bump-forcing `update`.

- [ ] **Step 9: Run the full suite, typecheck, lint**

Run: `npx tsc --noEmit && npx eslint src scripts && npx vitest run`

- [ ] **Step 10: Real end-to-end verification**

Scaffold two real throwaway `.NET` projects (lint on/off), run `dotnet build` on each, confirm the analyzer-property project shows the expected (broader) warning set from Step 0's baseline comparison and the declined project doesn't. Clean up.

- [ ] **Step 11: Commit**

```bash
git add templates/dotnet/src/Cli.csproj src/languages/lint-support/dotnet.ts src/languages/lint-support/dotnet.test.ts src/update/adapters/dotnet.ts src/update/adapters/dotnet.test.ts src/languages/packs/dotnet.ts
git commit -m "feat: .NET opt-in lint tooling -- built-in Roslyn analyzers (#70)

Same subtractive pattern as the Node half (Task 3): the four analyzer
properties are permanently in templates/dotnet/src/Cli.csproj, stripped
by the pack's real stripLintTooling() when declined (replacing Task 2's
no-op). [Fill in Step 0's actual EnableNETAnalyzers default-value finding
here.]"
```

---

### Task 5: Documentation

**Files:**
- Modify: `templates/node/ARCHITECTURE.md`, `templates/dotnet/ARCHITECTURE.md`, `README.md`

- [ ] **Step 1: New "Lint tooling" section in both templates' `ARCHITECTURE.md`**

Explain what was scaffolded (or wasn't), how to run it (`npm run lint`/`npm run format` or `dotnet build`), and that it's core-managed (kept current by `clispark update`, same framing as the file's existing "how updates work" content) — mirror the tone/depth of the existing "Flags" section added in M7.

- [ ] **Step 2: `README.md`**

Add the new wizard question to whatever section documents the wizard flow.

- [ ] **Step 3: Commit**

```bash
git add templates/node/ARCHITECTURE.md templates/dotnet/ARCHITECTURE.md README.md
git commit -m "docs: document opt-in lint tooling in generated ARCHITECTURE.md and README (#70)"
```

---

### Task 6: Final whole-branch review

Standard project convention for multi-task plans (see M12b/`clispark add`) — a full review of the entire branch's diff against this plan, not just each task in isolation. Specifically check:

- No `pack.id === 'node'`-style hardcoded per-language branch exists anywhere in `scaffold.ts` (Task 2's design deliberately avoided ever needing one — confirm it stayed that way).
- No test anywhere asserts on `EnableNETAnalyzers`'s effect without Task 4 Step 0's real finding having been recorded in that task's commit message.
- Every place that reads `manifest.lintEnabled`/`oldManifest.lintEnabled` uses it in a boolean/ternary context, never a strict `=== true`/`=== false` comparison that would mishandle a pre-existing manifest's `undefined` value (per Global Constraints).
- `CORE_FILE_PATHS`/`CORE_SCRIPT_NAMES`/`LINT_SCRIPT_NAMES`/`LINT_DEPENDENCY_NAMES` haven't drifted into two competing lists anywhere.
- **Grep `.github/workflows/*.yml` for any inline script calling `scaffoldProject(...)`** (the `scaffold-smoke`/`scaffold-smoke-dotnet` jobs in `ci.yml` do this) and confirm each call site still compiles/behaves correctly with the new optional `lintEnabled` field — this exact class of gap (a non-`src/*.ts` call site missed by every task's file list) broke CI silently once already during M12a; the fact that `lintEnabled` is optional should mean these call sites need no changes at all, but confirm it for real rather than assuming.
- Re-run the real end-to-end verifications from Task 3 Step 11 and Task 4 Step 10 one more time against the final merged state of the branch, not just after their own task.
