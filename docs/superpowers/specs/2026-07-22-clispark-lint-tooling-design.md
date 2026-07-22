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

**Node:** ESLint with `@typescript-eslint/recommended` as the rule baseline, plus Prettier integration (`eslint-config-prettier`, to disable ESLint's formatting-related rules and defer formatting to Prettier — avoids the two tools fighting over the same lines). New `eslint.config.js` (flat config) + `.prettierrc` in the scaffolded project; `eslint`, `typescript-eslint`, `prettier`, `eslint-config-prettier` added as devDependencies; `lint`/`format` scripts added to `package.json`.

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
  scaffoldFiles(ctx: ScaffoldContext): Promise<void>;   // writes eslint.config.js/.prettierrc, or edits .csproj properties
  corePaths: string[];                                   // paths this feature adds to the manifest's core-file tracking, IF enabled
  packageJsonFields?: { devDependencies: Record<string, string>; scripts: Record<string, string> }; // Node only
}
```

`wizard.ts`/`scaffold.ts` call `languagePack.lintSupport?.scaffoldFiles(...)` only when the user opted in; the manifest records whether lint tooling is enabled (new `lintEnabled: boolean` field, alongside the existing `language` field).

### Update-system impact (the real complexity here)

Lint config is **core-managed** — tracked in `.clispark/manifest.json` and reconciled by `clispark update`, not left as a pure user file. This was a deliberate choice during refinement (over the simpler "user file, update never touches it" alternative), for consistency: clispark's core-managed files are meant to stay current with clispark's own recommendations, and lint baselines are exactly the kind of thing that should evolve over time (new recommended rules, etc.).

This introduces a genuinely new case for `manifest.ts`/`update.ts`: **today's core-file list is unconditional** (see M11 Tier 3 — every project of a given language has the same fixed core-file set). Lint tooling makes the core-file list *conditional on a scaffold-time choice recorded in the manifest*. Concretely:

- `update.ts`'s core-file reconciliation must check `manifest.lintEnabled` before treating `eslint.config.js` (Node) or the analyzer `.csproj` properties (.NET) as core.
- For Node, `package.json`'s selective-field-merge (already special-cased per the M6 update design) needs the lint-related `devDependencies`/`scripts` entries added to its core-field list, also conditionally.
- For .NET, the `.csproj` is edited via the existing regex-based property injection (the same mechanism `RegistryChecker.applyRegistryUrl()` uses, per M12b) — the lint properties get their own regex-anchored block, following that established pattern rather than introducing an XML library.
- A project that scaffolded with lint tooling *disabled* and later wants it: **out of scope** for this feature. `clispark update` only ever reconciles what was chosen at scaffold time; there's no retroactive "enable lint tooling on an existing project" command. (Flag as a possible future follow-up, not blocking.)

## Testing

- Unit tests per `LintSupport` implementation (Node, .NET) verifying the right files/properties get written.
- Manifest/update tests covering: lint enabled → core files tracked and reconciled; lint disabled → files absent, not tracked, `update` doesn't complain about their absence.
- Real scaffold + real `eslint`/`dotnet build` run in at least one test, verifying the generated config is actually valid (not just "a file exists") — consistent with this project's standing preference for real end-to-end verification over mocks alone.

## Open questions for implementation time

- Exact current versions/APIs of `@typescript-eslint`, `eslint-config-prettier` — re-verify, don't assume today's knowledge (same caveat the original issue carried).
- Exact regex anchor point for injecting the analyzer `<PropertyGroup>` into `.csproj` without colliding with the existing `RegistryChecker` edits to the same file.

## Status

Design complete, 2026-07-22. Ready for implementation plan.
