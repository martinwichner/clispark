# clispark M4: Registry Support — Design

**Goal:** Milestone 4 from `project-ideas/clispark.plan.md`. Wire the `registryUrl` collected by the wizard (since M1) into the generated project, so scaffolding a "work" project with a custom/private registry actually works end-to-end.

## Scope

Two concrete gaps, both already flagged in the plan:

1. The generated project has no way to tell npm to use a non-default registry — every future `npm install`/`npm ci` in that project silently falls back to `registry.npmjs.org`.
2. `scaffoldProject()`'s own automatic `npm install` (M2) always installs from the default registry, regardless of what the wizard collected. For a "work" profile pointing at a private/locked-down registry, this install can fail outright.

**Explicitly out of scope (descoped during brainstorming, 2026-07-11):** further profile-dependent defaults beyond `registryUrl` (e.g. different author/license per profile) — no concrete need identified, not part of this milestone. Scoped-registry support (`@org:registry=...`) — descoped in favor of a simple unscoped override, consistent with the existing wizard flow which already treats `registryUrl` as a single flat value with no scope concept.

## Design

`ScaffoldOptions` (`src/scaffold.ts`) gains an optional `registryUrl?: string` field. `cli.ts` passes `answers.registryUrl` through to `scaffoldProject()` (currently only `projectName`/`targetDir` are passed).

Inside `copyTemplate()`, after the existing placeholder-replacement steps: if `registryUrl` is set and differs from `DEFAULT_REGISTRY_URL` (`src/registry.ts`), write a `.npmrc` file into `targetDir` containing `registry=<url>`. This uses the same plain `fs/promises` file-write approach already used for the template files — no new dependency.

Because npm resolves project-level `.npmrc` config from the current working directory, and `scaffoldProject()` already runs `npm install`/`npm run build` with `cwd: targetDir` (via the existing `runCommand` dependency), no change to the `npm install` invocation itself is needed — writing `.npmrc` before that call is sufficient to fix gap #2 as a side effect of fixing gap #1. This also means any future `npm install`/`npm ci` run manually in the generated project (outside of clispark entirely) picks up the same registry automatically.

A "private" profile project, or a "work" profile project where the user left the registry prompt at its default, never gets a `.npmrc` — matching current default npm behavior with zero extra files.

## Error Handling

No new error handling needed. Writing `.npmrc` is a plain `fs/promises` write inside `copyTemplate()`; any failure propagates the same way existing template-file writes already do.

## Testing

Extend the existing `src/scaffold.test.ts` suite (real `fs/promises` against real temp directories, no mocks — same pattern as the current `copyTemplate` tests):

- `registryUrl` set to a non-default value → `.npmrc` is written to `targetDir` with `registry=<url>`.
- `registryUrl` omitted, or equal to `DEFAULT_REGISTRY_URL` → no `.npmrc` file is created.

Manual end-to-end verification (same shape as M1-M3): scaffold a real project with a non-default `registryUrl` pointed at a throwaway local value, confirm the `.npmrc` content, and confirm `npm install` actually reads it (e.g. by pointing at an unreachable registry URL and observing that the install now fails against *that* URL specifically, proving it's no longer silently using the npmjs.org default).
