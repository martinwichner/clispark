# Custom Command-Convention Enforcement Rule (#80) — Design

## Context

Successor to the M11-audit idea "enforce `BaseCommand` inheritance", split off from [[#70]] (`2026-07-22-clispark-lint-tooling-design.md`) on 2026-07-22 because the two turned out to need materially different, differently-sized mechanisms:

- **#70 (shipped, v1.22.0 line):** general opt-in lint tooling per language — ESLint/Roslyn-analyzer baseline with no clispark-specific rules.
- **#80 (this spec):** the specific custom convention rule this issue closes — a class that implements the command interface/base class incorrectly must be caught at build/lint time, not silently drop its logging/error-handling/discovery at runtime.

**The gap this closes:** clispark's auto-registration is the core promise ("drop a file in `commands/`, it just works"). But auto-registration also means nothing *notices* when a command class fails to opt into the shared machinery correctly:

- **Node:** a class default-exported from `src/commands/**` that extends oclif's `Command` directly (or some other base) instead of `BaseCommand` still gets discovered and works — but silently loses the shared logging/error-handling from `base-command.ts`.
- **.NET:** a class implementing `ICliCommand` without a `[CommandPathAttribute]` doesn't fail silently — `CommandDiscovery.RegisterAll` throws `InvalidOperationException` at runtime, on first invocation of the generated CLI. That's arguably worse than Node's silent case: it's a runtime crash instead of a build-time signal, discoverable only by actually running the tool.

Both are real, current gaps — not hypothetical. Node needs a **local ESLint rule**; .NET needs a **local Roslyn analyzer project**, since the failure mode there is categorically different (an attribute-presence check, not an inheritance check) and .NET's discovery is attribute-based, not inheritance-based (see M12b).

## Scope

**In scope:** Node and .NET templates, via the existing `LanguagePack` architecture.

**Out of scope:**
- PowerShell — no `LanguagePack` exists yet; slots in once that pack is built (same YAGNI stance #70 took).
- Any change to `clispark`'s own lint setup (clispark itself has no lint tooling; this is about the *generated* project).
- Retrofitting the rule onto a project that scaffolded without it — same as #70's stance, `clispark update` only reconciles what was chosen at scaffold time.

## Design decisions

### Wizard

One new yes/no question, **only asked when the #70 lint-tooling question was answered yes** — the rule has nothing to plug into otherwise (no `eslint.config.js` to add a rule to; and while the .NET analyzer project is technically independent of #70's `EnableNETAnalyzers` property-group flip, gating both conventions behind the same "do you want lint/convention tooling" opt-in keeps the wizard flow coherent rather than presenting two separate analyzer-ish yes/no questions back to back). This mirrors the conditional-wizard-question mechanism `LanguagePack.supportsAutocompleteOptIn` introduced for #89 — a second, independently-answerable follow-up question whose *visibility* depends on an earlier answer, not its value.

Default **No** (opt-in, consistent with #65/#70).

### Node: local custom ESLint rule

Not published as a separate npm package — a rule file scaffolded directly into the generated project (e.g. `eslint-rules/require-base-command.js`), referenced from `eslint.config.js` via a local flat-config plugin object (`{ plugins: { local: { rules: { 'require-base-command': ... } } }, rules: { 'local/require-base-command': 'error' } }`). **Correction, 2026-07-31 (see the implementation plan's Review Addendum):** this does need one new, gated devDependency — `@typescript-eslint/utils`, for `ESLintUtils.RuleCreator`. It's already present transitively (pulled in by `typescript-eslint`) but wasn't a direct dependency; verified the `typescript-eslint` meta-package itself does not re-export `ESLintUtils`.

**Must be type-aware, not text/AST-only**, and must walk the **full heritage chain**, not just the immediate `extends` clause — an intermediate abstract class between a command and `BaseCommand` is a realistic pattern (a project's own shared base for a family of commands), and a naive "does `extends` literally say `BaseCommand`" check would false-positive on it. Built with `@typescript-eslint/utils`'s `ESLintUtils.RuleCreator` + type information (`context.sourceCode.getTypeChecker()`), walking the class symbol's base types until it either hits `BaseCommand` (pass) or the root (`Command`/`Object`, fail).

**Target:** default-exported classes in `src/commands/**/*.ts` (oclif's own discovery convention — mirrors exactly what oclif itself scans, so the rule's blast radius matches the runtime's).

### .NET: local Roslyn analyzer project

New project in the generated solution: **`Cli.Analyzers/Cli.Analyzers.csproj`**, `netstandard2.0` (not `net10.0` — Roslyn analyzers run inside the *host compiler's* process, which targets `netstandard2.0` for broad compiler-version compatibility regardless of what TFM the analyzed project itself targets. This is a hard platform constraint, not a style choice).

`CommandPathAnalyzer : DiagnosticAnalyzer`, symbol-based (not text/regex-based — required to correctly handle both kinds of transitivity below):

1. **Interface check:** does the type implement `ICliCommand`? Use `INamedTypeSymbol.AllInterfaces.Contains(...)`, not a direct-implements check — a class can implement `ICliCommand` transitively via a base class, and `AllInterfaces` is the only API that reflects that correctly.
2. **Attribute check:** does the type (or a base type) carry `[CommandPathAttribute]`? **Empirically verified 2026-07-26** against `CommandPathAttribute.cs`: `[AttributeUsage(AttributeTargets.Class)]` with no explicit `Inherited = false`, so the CLR default `Inherited = true` applies — and `CommandDiscovery.cs`'s `type.GetCustomAttribute<CommandPathAttribute>()` call uses the extension method's default `inherit: true` parameter. **The runtime genuinely honors attribute inheritance**, so the analyzer must walk the base-type chain (`INamedTypeSymbol.BaseType` loop) checking `GetAttributes()` at each level, not just the immediate type — otherwise it would flag a subclass that correctly inherits `[CommandPath]` from a base command class as a false positive, contradicting what actually happens at runtime.

Diagnostic severity: **error** — matches the real runtime consequence (`InvalidOperationException` on discovery, i.e. a crash, not a soft warning).

**`.csproj` wiring** (in the main `Cli.csproj`):
```xml
<ItemGroup>
  <ProjectReference Include="..\Cli.Analyzers\Cli.Analyzers.csproj"
                    OutputItemType="Analyzer"
                    ReferenceOutputAssembly="false" />
</ItemGroup>
```
`OutputItemType="Analyzer"` makes the compiler load the project's output as an analyzer rather than a normal reference; `ReferenceOutputAssembly="false"` is mandatory to keep the analyzer DLL out of the packed CLI tool's own output (it's a build-time-only dependency, not a runtime one). The analyzer project's own `Microsoft.CodeAnalysis.CSharp`/`Microsoft.CodeAnalysis.Analyzers` package references need `PrivateAssets="all"` for the same reason — prevents those packages from leaking transitively into `Cli.csproj`'s dependency graph.

**Strip operation** (when the wizard question is answered no, or via any future `clispark update` disable path — though disable-after-scaffold is out of scope, see below): recursive deletion of the `Cli.Analyzers/` directory, plus a regex removal of the `<ProjectReference Include="..\Cli.Analyzers\..." ... />` element from `Cli.csproj`, CRLF-safe (the existing `.csproj` edit helpers in `dotnet.ts` all have to tolerate `\r\n` — Windows-authored `.csproj` files are common).

## Architecture

### `LanguagePack` extension

New optional field, following the `lintSupport` / `autocompleteSupport` precedent:

```ts
interface LanguagePack {
  // ...existing fields
  conventionSupport?: ConventionSupport;
}

interface ConventionSupport {
  scaffoldFiles(options: ScaffoldOptions & { commandConventionEnabled: boolean }): Promise<void>;
}
```

`scaffold.ts` calls `pack.conventionSupport?.scaffoldFiles(...)` after `copyTemplate()` and after the #70 `lintSupport` call (so, for Node, the ESLint rule can register itself into an `eslint.config.js` that #70's step already wrote). `ScaffoldOptions` gains `commandConventionEnabled?: boolean`; `Manifest` gains a permanent `commandConventionEnabled: boolean` field — same rationale as #70's `lintEnabled`: `clispark update` only has the manifest to consult later, not the original wizard answers.

### Update-system impact

`CoreFilePathsFlags` (`src/update/adapter.ts`) already carries `lintEnabled` and `autocompleteEnabled` as the established pattern for gating what counts as "core" per opted-in feature — add `commandConventionEnabled: boolean` alongside them. Concretely, mirroring the two prior features' exact mechanisms:

1. **`coreFilePaths(flags)`** (already a function of the flags, per #70/#89 — no signature change needed, just a new conditional branch): Node adds the rule file path (e.g. `eslint-rules/require-base-command.js`) when `commandConventionEnabled`; .NET adds `Cli.Analyzers/Cli.Analyzers.csproj` (and any other files in that project) when `commandConventionEnabled`.
2. **Node dependency reconciliation:** no new devDependency is introduced (the rule is hand-written, no package) — nothing to gate here, unlike #89's oclif-plugin dependency-name filter (`oldManifest.autocompleteEnabled || name !== AUTOCOMPLETE_DEPENDENCY_NAME` in `node-oclif.ts`). Simpler than both prior features on this axis.
3. **Node `eslint.config.js` reconciliation:** the rule's registration block (the `local` plugin object + the `rules` entry) needs the same conditional-content treatment `node-oclif.ts` already applies to `oclif.plugins` for `autocompleteEnabled` (`effectiveTemplateOclif = oldManifest.autocompleteEnabled ? templateOclif : oclifWithoutAutocomplete`) — a parallel `effectiveTemplateEslintConfig` computed the same way, gated on `commandConventionEnabled` instead.
4. **.NET `ProjectReference` reconciliation:** genuinely new — nothing in `dotnet.ts` today reconciles a `<ProjectReference>` element (`extractPackageReferences`/`setPackageReferenceVersion`/`addPackageReference` all target `<PackageReference>`, a different XML shape with no `Version` attribute to bump). New `extractProjectReference`/`setProjectReference` functions needed, parallel in spirit to `extractAnalyzerProperties`/`ANALYZER_PROPERTY_NAMES` from #70 (i.e. presence/absence keyed off the flag, not a version to merge — a `ProjectReference` doesn't carry a version the way a `PackageReference` does, so this is closer to "add or remove one element" than "reconcile a value").
5. **Retroactive enable/disable:** out of scope, same stance as #70 point 5 — `clispark update` reconciles what was chosen at scaffold time only.

### Why not one shared "convention" abstraction across languages

Considered and rejected: a single cross-language `ConventionRule` type describing "what to check" abstractly, implemented once per language. Rejected because the two checks are structurally different enough (inheritance-chain walk vs. interface-implementation + attribute-inheritance walk) that a shared abstraction would either leak language-specific concepts through it or add indirection with no real code reuse — same reasoning that kept `LanguagePack`'s other extension points (`lintSupport`, `autocompleteSupport`) as per-language implementations behind a thin shared interface, not a shared rule engine.

## Testing

- **Node:** unit tests for the ESLint rule itself (valid: direct `BaseCommand` extension, transitive via an intermediate abstract class; invalid: direct `Command` extension, no base class, extending an unrelated class) using `RuleTester`.
- **.NET:** unit tests for `CommandPathAnalyzer` using Roslyn's analyzer testing harness (`Microsoft.CodeAnalysis.CSharp.Analyzer.Testing`) covering: valid direct attribute, valid *inherited* attribute (base class carries `[CommandPath]`, subclass doesn't — must NOT flag, per the empirically verified inheritance behavior above), missing attribute on a direct `ICliCommand` implementer, missing attribute on a transitive implementer (via a base class implementing the interface).
- **Manifest/update tests:** convention-enabled → analyzer project / rule file tracked and reconciled by `clispark update`; convention-disabled → absent, untracked, and — the specific danger #70's spec flagged for its own feature — never silently *added* to a project that declined it at scaffold time.
- **Real scaffold + real `dotnet build` / `eslint` run** in at least one test verifying the analyzer/rule actually fires on a deliberately-broken fixture command, not just "the file exists" — consistent with this project's standing preference for real end-to-end verification over mocks alone.
- Regression test for the wizard-question gating: the `commandConventionEnabled` question must not appear when the `lintEnabled` question was answered no (same shape as the existing `supportsAutocompleteOptIn` gating tests from #89).

## Open questions for implementation time

- Exact `@typescript-eslint/utils` API surface for type-aware rules with the versions clispark's own toolchain pins — re-verify at implementation time, don't assume today's API.
- Exact regex anchor point for injecting/removing the `<ProjectReference>` element in `Cli.csproj` without colliding with #70's existing `<PropertyGroup>` edits (different element, different location, but same file — same category of concern #70's spec flagged for its own `<PropertyGroup>` edit).
- Whether the Node rule file should live at `eslint-rules/` or nested under `src/` — pick whichever keeps it out of the compiled `dist/` output by default without a new tsconfig exclusion (mirrors the M12b-era finding that `tsconfig.json` already excludes `bin`/`scripts`).
- Confirm current `Microsoft.CodeAnalysis.CSharp`/`Microsoft.CodeAnalysis.Analyzers` package versions at implementation time, not from prior knowledge.

## Status

Design complete, 2026-07-26 (continued from a session interrupted by a power outage; the attribute-inheritance behavior of `CommandPathAttribute`/`CommandDiscovery.cs` was empirically re-verified on resumption, confirming the analyzer must walk the base-type chain for the attribute check). Ready for implementation plan.
