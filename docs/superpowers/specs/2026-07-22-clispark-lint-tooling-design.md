# Opt-in General Lint Tooling per Language — Design

## Context

Raw idea from the 2026-07-18 backlog curation session, tracked as issue #70 ("Opt-in lint/convention tooling per language"), successor to an earlier, never-implemented M11-audit idea ("enforce BaseCommand inheritance").

During refinement (2026-07-22) the original idea was split in two, since the two halves turned out to need materially different, differently-sized mechanisms:

- **This spec (#70):** general opt-in lint tooling per language — an ESLint/Roslyn-analyzer baseline with no clispark-specific rules.
- **#80** (separate spec, to follow): the specific custom convention rule ("commands must extend `BaseCommand`" / .NET equivalent) — builds on this feature but needs its own, heavier per-language mechanism (a local ESLint rule, a local Roslyn analyzer project).

## Scope

**In scope:** Node and .NET templates, via the existing `LanguagePack` architecture (`src/languages/pack.ts`, packs in `src/languages/packs/`).

**Out of scope:**
- PowerShell — no `LanguagePack` exists yet (deferred future milestone); this feature slots into that pack once it's built, no forward-looking abstraction is added now (YAGNI, same principle applied throughout the `LanguagePack` rollout).
- The custom convention rule — see #80.
- Any change to `clispark`'s own lint setup (clispark itself has no lint tooling today; out of scope for this backlog item, which is about the *generated* project).

## Design decisions

**Node:** ESLint using the same real, working pattern clispark already uses on itself (`eslint.config.ts`, flat config) — `@eslint/js`'s `eslint.configs.recommended` + the unified `typescript-eslint` package's `tseslint.configs.recommended`, composed via `tseslint.config(...)`. (Corrected during spec review: `@typescript-eslint/recommended` isn't a real package name — the plan should copy clispark's own `eslint.config.ts` pattern verbatim rather than inventing new naming.) Plus Prettier integration (`eslint-config-prettier`, to disable ESLint's formatting-related rules and defer formatting to Prettier — avoids the two tools fighting over the same lines). New `eslint.config.js` (flat config) + `.prettierrc` in the scaffolded project; `eslint`, `@eslint/js`, `typescript-eslint`, `prettier`, `eslint-config-prettier` added as devDependencies; `lint`/`format` scripts added to `package.json`.

**.NET:** No new NuGet dependency — enables the .NET SDK's own built-in Roslyn analyzers via `.csproj` properties:

```xml
<PropertyGroup>
  <EnableNETAnalyzers>true</EnableNETAnalyzers>
  <AnalysisLevel>latest</AnalysisLevel>
  <AnalysisMode>Recommended</AnalysisMode>
  <EnforceCodeStyleInBuild>true</EnforceCodeStyleInBuild>
</PropertyGroup>
```

No StyleCop or other third-party analyzer package — deliberately the lighter of the two options considered, to keep this feature a pure "flip a switch on what's already there" for .NET rather than introducing a new dependency to maintain.

**Caveat found during spec review (2026-07-22), not yet empirically verified:** SDK-style .NET projects targeting `net5.0`+ are believed to already default `EnableNETAnalyzers` to `true` — if so, that specific line is a no-op restating the existing default, and the properties that actually change behavior are `AnalysisMode=Recommended` (default is the narrower `AnalysisMode=Default`) and `EnforceCodeStyleInBuild=true` (default `false` — code-style rules normally only surface in the IDE, not `dotnet build`). This must be confirmed with a real build (scaffold a plain .NET project, intentionally violate a style rule, run `dotnet build` with and without these properties, compare warnings) before or during implementation — see Open Questions.

**Wizard:** one new yes/no question ("Set up lint tooling?"), default **No** — this is opt-in, not opt-out; existing scaffolds/expectations of a minimal project are unaffected unless the user actively asks for it.

## Architecture

### `LanguagePack` extension

New optional field, following the existing pattern of `UpdateAdapter` / `RegistryChecker` / `CommandGenerator`:

```ts
interface LanguagePack {
  // ...existing fields
  lintSupport?: LintSupport;
}

interface LintSupport {
  scaffoldFiles(options: ScaffoldOptions & { lintEnabled: boolean }): Promise<void>;   // writes eslint.config.js/.prettierrc, or edits .csproj properties (post-copy, same pattern as registry.applyPrivateIntent/applyRegistryUrl)
}
```

(Corrected during spec review: the real scaffold-time options type is `ScaffoldOptions` — `src/scaffold.ts` — not `ScaffoldContext`, which doesn't exist in the codebase.) `scaffold.ts` calls `pack.lintSupport?.scaffoldFiles(...)` right after `copyTemplate()`, only when the user opted in — same post-copy-edit shape as the existing `registry.applyPrivateIntent()`/`applyRegistryUrl()` calls. `ScaffoldOptions` gains a new `lintEnabled?: boolean` field; the manifest records the choice permanently (new `lintEnabled: boolean` field on `Manifest`, alongside the existing `language` field), since — unlike scaffold options — the manifest is the only thing `clispark update` has access to later.

### Update-system impact — three separate static-list mechanisms, not one (found during spec review)

Lint config is **core-managed** — tracked in `.clispark/manifest.json` and reconciled by `clispark update`, not left as a pure user file. This was a deliberate choice during refinement (over the simpler "user file, update never touches it" alternative), for consistency: clispark's core-managed files are meant to stay current with clispark's own recommendations, and lint baselines are exactly the kind of thing that should evolve over time (new recommended rules, etc.).

The first draft of this spec described this as a single "check `manifest.lintEnabled` in `update.ts`" change. Cross-checking against the actual code (`src/update/manifest.ts`, `src/update/update.ts`, `src/update/adapters/node-oclif.ts`) found that "what counts as core" today is spread across **three independent static mechanisms**, none of which have any per-project awareness, and all three need a conditional variant:

1. **`UpdateAdapter.coreFilePaths`** (`src/update/adapter.ts`) is a plain `readonly string[]` property, read directly (no parameters) in three places: `manifest.ts`'s `hashCoreFiles`, and twice in `update.ts` (building the new hash set, and detecting `'no-longer-core'` files). There is no hook anywhere that could consult `manifest.lintEnabled` before deciding whether `eslint.config.js`/the analyzer-properties file belong in this list. **Naive fix rejected:** simply making file reads tolerant of a missing `eslint.config.js` is not enough and is actively dangerous — `reconcile.ts`'s `reconcileEntry()` treats *any* missing local file as `currentLiveValue === undefined`, which unconditionally returns `outcome: 'added'`. If `coreFilePaths` unconditionally listed `eslint.config.js`, the very first `clispark update` on every existing lint-declined project would silently start adding it. **Resolution:** `coreFilePaths` becomes a function of the manifest — `coreFilePaths(manifest: Manifest): readonly string[]` — so it can omit `eslint.config.js` entirely for projects where `manifest.lintEnabled` is false, at every call site, not just at hash time. Mechanical, zero-behavior-change update for both existing adapters (they just ignore the parameter and keep returning their current static array). Exact call-site signature changes are implementation-plan-level detail, not spec-level.

2. **`CORE_SCRIPT_NAMES`** (`src/update/adapters/node-oclif.ts`) is a second, separate static array (`['build', 'postbuild', 'pretest', 'test', 'typecheck']`) gating which `package.json` scripts count as core. Not mentioned in the spec's first draft at all. The proposed `lint`/`format` scripts need the same manifest-aware conditional treatment, or they'll never be tracked/reconciled despite being "core" per this feature's own premise.

3. **Dependency-version reconciliation during `clispark update` doesn't consult the manifest's `coreDependencies` at all** — `mergePackageJson()`'s `dependencyNames` set is derived fresh, every run, from whatever's in `dependencies`/`devDependencies` of the **template's own `package.json`** (`templates/node/package.json`, read from disk on every update). This is how version bumps to existing core deps normally propagate. But `eslint`/`prettier`/etc. can never literally live in the one shared template file — every scaffold copies the same `templates/node/`, so anything in that file is unconditionally part of every project, defeating opt-in. This means, unmodified, `clispark update` would **never see or version-bump lint-related devDependencies for any project**, silently breaking the "stays current with clispark's own recommendations" goal this whole core-managed choice was made for. Not mentioned in the spec's first draft. **Resolution direction (exact shape left to the plan):** `LintSupport` needs to contribute its own conditional dependency set into `mergePackageJson`'s reconciliation loop when `manifest.lintEnabled` is true — e.g. a manifest-aware hook the adapter merges in, distinct from the unconditional template-file-derived set.

4. For .NET, the `.csproj` is edited via the existing regex-based property injection pattern — **correction:** the real precedent is `nugetRegistryChecker.applyPrivateIntent()` (`src/languages/registry-checkers/nuget.ts`, injects `<IsPackable>false</IsPackable>` into the first `<PropertyGroup>` via regex), not `applyRegistryUrl()` (which actually writes a separate `NuGet.config` file and never touches the `.csproj`). The lint properties should use their own distinct `<PropertyGroup>` block (not inject into the same one `applyPrivateIntent` targets) to avoid the two edits colliding on the same regex anchor — exact anchor point is an open question below.

5. A project that scaffolded with lint tooling *disabled* and later wants it: **out of scope** for this feature. `clispark update` only ever reconciles what was chosen at scaffold time; there's no retroactive "enable lint tooling on an existing project" command. (Flag as a possible future follow-up, not blocking.)

## Testing

- Unit tests per `LintSupport` implementation (Node, .NET) verifying the right files/properties get written.
- Manifest/update tests covering: lint enabled → core files, scripts, *and dependency versions* all tracked and reconciled (a version bump to `eslint` in a future clispark release must actually propagate via `clispark update` to a project that opted in — this is the exact mechanism gap found in review point 3 above, so it needs its own explicit regression test, not just an "is the file present" check); lint disabled → files/scripts/deps absent, not tracked, `update` doesn't complain about their absence, and critically, `update` never *adds* them to a project that declined at scaffold time (the specific danger identified in review point 1).
- Real scaffold + real `eslint`/`dotnet build` run in at least one test, verifying the generated config is actually valid (not just "a file exists") — consistent with this project's standing preference for real end-to-end verification over mocks alone.
- A real, empirical check of `EnableNETAnalyzers`'s default value (see Open Questions) before writing any test that asserts on its effect.

## Open questions for implementation time

- Exact current versions/APIs of `typescript-eslint`, `@eslint/js`, `eslint-config-prettier`, `prettier` — re-verify, don't assume today's knowledge (same caveat the original issue carried; clispark's own `eslint.config.ts`/`package.json` are a live, real reference point, not just the npm registry).
- **Verify empirically, not by assertion:** does `EnableNETAnalyzers` already default to `true` for `net10.0` SDK-style projects? If so, drop it from the "what changes" framing (it can stay in the emitted `.csproj` block for explicitness, but the design doc/PR description shouldn't claim it's the thing doing the work) and confirm `AnalysisMode=Recommended` + `EnforceCodeStyleInBuild=true` are the properties that actually change `dotnet build` output. Concretely: scaffold a plain `.NET` project, introduce one deliberate style violation, run `dotnet build` with and without the proposed `<PropertyGroup>`, diff the warnings.
- Exact regex anchor point for injecting the analyzer `<PropertyGroup>` into `.csproj` without colliding with `applyPrivateIntent`'s existing edit to the first `<PropertyGroup>` block (see review point 4 above).
- Exact shape of the `coreFilePaths`/`CORE_SCRIPT_NAMES`/dependency-reconciliation conditionality (function signatures, where the manifest-aware branching lives) — direction is decided (see Architecture above), precise code is implementation-plan-level work.

## Status

Design complete, 2026-07-22; revised same day after a critical self-review found three unaddressed architecture gaps in the update-system integration (see "Update-system impact" above) — all three resolved at the design-direction level, exact mechanics deferred to the implementation plan. Ready for implementation plan.
