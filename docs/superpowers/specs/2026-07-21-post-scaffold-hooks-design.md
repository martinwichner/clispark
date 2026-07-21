# Post-Scaffold Hooks — Design

**Date:** 2026-07-21
**Status:** Approved, not yet implemented
**Backlog item:** [#69 Hook/plugin system](https://github.com/martinwichner/clispark/issues/69)

## Context

The M13 backlog originally framed this item as a "hook/plugin system," explicitly flagging one open question: hooks only, or also community-loadable templates? This spec resolves that question and designs the hooks-only version.

**Motivating use cases** (all "new project" scoped, not ongoing maintenance):
- Auto-create a corresponding GitHub/GitLab repo and push the initial commit
- Copy a company-standard CI/CD workflow file into the new project
- Install additional company-internal npm packages beyond what the template ships
- Register the new project in an internal service catalog
- Post a notification (Slack/Teams/etc.) that a new project was created

These are the kind of organization-specific automation clispark itself has no business knowing about — the whole point of a hook is letting a user or company extend clispark without clispark's own codebase growing a bespoke integration for every possible external system.

## Decision: hooks only, no community-loadable templates

Community-loadable templates (third parties publishing alternative `clispark` templates, selectable at scaffold time) were considered and explicitly rejected for now:
- Running arbitrary third-party code during scaffold is a real supply-chain risk — the same class of concern this project's own `audit-issues.ts` automation exists to watch for.
- It would need a registry/discovery/trust mechanism clispark has nothing like today.
- It conflicts with this project's own stated principle (Rahmenbedingungen, "Bewusste Grenze"): *"Kein KI-gestütztes Codegen zur Laufzeit... würde dem Konsistenz-/Durchschaubarkeits-Prinzip widersprechen"* — unpredictable third-party content undermines the same "consistent, predictable, auto-logging/auto-registered" promise that is clispark's core value proposition (Kernversprechen), even though community templates aren't AI-codegen specifically.
- clispark is a solo project not yet actively promoted (per Rahmenbedingungen) — building a template marketplace ahead of any real external demand is YAGNI.

If real external demand for this ever materializes, it would be its own separate design effort, not bolted onto the hooks mechanism below.

## Design

### Trigger scope: post-scaffold only

Hooks fire exactly once, after a brand-new project finishes scaffolding — not after `clispark update` or `clispark add`. The motivating use cases are all "a new project was just created" scoped; there's no clear use case for "notify Slack on every `clispark update`," and adding update/add triggers would roughly double the scope (three call sites, three sets of context data) for unclear benefit. Can be revisited later if a real need for update/add hooks surfaces.

### Location: a single global, auto-detected file

The hook is **not** part of the generated project and **not** asked about in the wizard. It is a single file at a fixed, OS-appropriate location on the machine running `clispark`, resolved via the `env-paths` package clispark already depends on (currently only used for log files in `src/logger.ts`, called there as `envPaths('clispark', { suffix: '' })`):

```
<envPaths('clispark', { suffix: '' }).config>/hooks/post-scaffold.mjs
```

Concrete resolved paths (verified against `env-paths`' own documented behavior, `suffix: ''` so no `-nodejs` suffix):

| OS | Path |
|---|---|
| Linux | `~/.config/clispark/hooks/post-scaffold.mjs` (or `$XDG_CONFIG_HOME/clispark/hooks/post-scaffold.mjs`) |
| macOS | `~/Library/Preferences/clispark/hooks/post-scaffold.mjs` |
| Windows | `%APPDATA%\clispark\Config\hooks\post-scaffold.mjs` |

If the file doesn't exist, nothing happens — no warning, no log line, completely silent. This is the default case for the overwhelming majority of users, who have never heard of this feature; it must not produce any noise for them.

If it exists, clispark loads and runs it as described below. There is exactly one hook slot (not a directory of multiple hooks) — anyone needing to run several things chains them inside their own file. This is a deliberate YAGNI choice; a multi-hook directory can be added later without breaking this design if real demand shows up.

**Rationale for "global, auto-detected" over "opt-in per run/wizard question":** the motivating use cases (company standardizes on clispark, wants every new project to get a repo/CI-file/catalog entry) are a "set up once, applies to every future run" shape, not a "decide fresh each time" shape. A wizard question or per-run flag would force the exact audience most likely to want this (an org standardizing tooling) to answer the same question on every single scaffold.

### Discoverability: `clispark hook` command

A new top-level CLI command prints the resolved path (correctly OS-specific, since `env-paths` resolves at runtime based on wherever `clispark hook` is actually run) and whether a hook currently exists there. If none exists, it also prints the minimal contract inline, so a user never has to leave the terminal to get started:

```
$ clispark hook

Post-scaffold hook

Location: /home/user/.config/clispark/hooks/post-scaffold.mjs
Status:   not found — no hook will run after the next scaffold

To add one, create that file as an ES module exporting a default function:

  export default async function postScaffold({ projectName, targetDir, language, registryUrl, publishIntent }) {
    // your code here
  }

It runs once, right after a new project finishes scaffolding.
```

When a hook does exist, the status line instead reads `Status:   found — will run after the next scaffold` (exact wording finalized during implementation), and the contract block is omitted (no need to re-explain it to someone who already has one).

### Execution: in-process dynamic import, called after `scaffoldProject()` succeeds

Wired into `src/cli.ts`'s default (root) action handler, at the same call site as the existing `printConfetti()` call — **after** `scaffoldProject(...)` has already completed (template copied, `npm install`/`npm run build` or `dotnet restore`/`dotnet build` run, `git init`/`add`/`commit` done). Not inside `scaffold.ts` itself — `scaffold.ts` stays focused on the actual scaffolding mechanics, exactly as `printConfetti()` already lives outside it.

If the hook file exists, clispark:
1. Dynamically `import()`s it (via `pathToFileURL(hookPath).href`, the same portable technique already used to fix two unrelated Windows entry-point-guard bugs earlier today in this project — worth reusing here for the same reason: raw `file://` string concatenation breaks on Windows).
2. Verifies the module's `default` export is a function; if not, treats it as a hook error (see below).
3. Calls it with exactly one argument, a context object: `{ projectName, targetDir, language, registryUrl, publishIntent }` (every field the wizard/scaffold flow already has in hand at that point — `registryUrl`/`publishIntent` may be `undefined` depending on what the user answered).
4. Awaits the result (the function may be sync or async — either is valid, the return value itself is ignored either way).

No subprocess, no serialization — the whole point of in-process `import()` is that the context object is just passed directly.

### Error handling: warn clearly, never block the scaffold's success

A failing or malformed hook (throws, rejects, missing/non-function default export, file doesn't parse as valid ESM) is caught and reported as a **clear, prominent console warning** — not just a quiet log line — but the scaffold itself is already complete and successful by the time the hook runs, so nothing about the generated project is affected. This mirrors the project's existing best-effort conventions (e.g. `safely()` in `src/logger.ts` for non-critical log-write failures, and the wizard's own "network error → warn, keep going" behavior for the npm name-availability check).

Exact warning format finalized during implementation, but must clearly state: (a) the hook failed, (b) the actual error, (c) that the project was still created successfully — a user must never come away thinking their new project is broken because of an unrelated hook problem.

### Opt-out: `--no-hook`

A new flag on the root `program` (default scaffold action only — unlike `--no-confetti`, this never needs to apply to `update`/`add`, so it does not need the `optsWithGlobals()` global-option treatment that flag required). When passed, `clispark` skips checking for or running the hook entirely for that one invocation, even if a hook file exists. Consistent with this project's established convention of never forcing an automatic behavior without an escape hatch (see the whoami/confetti UX lesson already on file).

### Type definitions for hook authors

clispark currently has no library entry point at all — `package.json` declares only `"bin"`, no `"main"`/`"module"`/`"types"`/`"exports"`. This adds a minimal one purely so hook authors can get the context object's shape without guessing:

- New `src/index.ts`, exporting only:
  ```ts
  export interface PostScaffoldHookContext {
    projectName: string;
    targetDir: string;
    language: string;
    registryUrl?: string;
    publishIntent?: boolean;
  }

  export type PostScaffoldHook = (context: PostScaffoldHookContext) => void | Promise<void>;
  ```
- No runtime logic — this file exists purely to be compiled for its type declarations. `dist/index.js` is expected to be effectively empty at runtime.
- `tsup.config.ts` gains a second build entry for `src/index.ts` with `.d.ts` generation enabled for that entry (the existing `cli.ts` entry does not need declaration output and should not gain one just as a side effect of enabling `dts` globally — scope it to the new entry).
- `package.json` gains a `"types": "./dist/index.d.ts"` field (and/or an `"exports"` map with a `"types"` condition — exact shape decided during implementation, whichever resolves correctly under this project's existing `tsconfig.json` module-resolution settings).
- `"files"` in `package.json` already includes `"dist"`, so the new `dist/index.d.ts`/`dist/index.js` ship automatically — no change needed there.

A hook author who wants type checking without a build step can reference the type via JSDoc in their plain `.mjs` hook file:
```js
/** @param {import('clispark').PostScaffoldHookContext} context */
export default async function postScaffold(context) { ... }
```
(requires `clispark` installed as a dependency somewhere resolvable from the hook file — out of scope to prescribe exactly how; this is a convenience for whoever wants it, not a requirement.)

### Documentation

The generator's own `README.md` gains a new section (working title "Post-scaffold hooks"), covering: what it's for, the three OS-specific paths (the table above), the exact contract (ES module, default-exported function, sync or async, the context object shape, return value ignored), the `--no-hook` flag, the `clispark hook` command, and one complete worked example (e.g. the "push to a freshly created GitHub repo via the `gh` CLI" use case, since that's both realistic and easy to follow).

## File Structure (for the implementation plan)

```
src/
  index.ts                  # CREATE — PostScaffoldHookContext, PostScaffoldHook types only, no runtime logic
  hooks.ts                  # CREATE — getPostScaffoldHookPath(), runPostScaffoldHook(context)
  hooks.test.ts             # CREATE
  cli.ts                    # MODIFY — new `hook` command; --no-hook flag + runPostScaffoldHook call in the default action
tsup.config.ts               # MODIFY — second entry for src/index.ts with scoped .d.ts output
package.json                 # MODIFY — "types" field (and/or "exports")
README.md                    # MODIFY — new "Post-scaffold hooks" section
```

## Out of Scope

- Community-loadable templates (see Decision above).
- Hooks triggered by `clispark update` or `clispark add`.
- Multiple hooks / a hooks directory (single `post-scaffold.mjs` slot only).
- Any mechanism for clispark to create/validate/scaffold the hook file itself (e.g. `clispark hook init`) — users write it by hand; the `clispark hook` command only reports the path and prints the contract, it does not offer to create the file.
- Validating the hook file's contents ahead of time (e.g. `clispark hook` does not lint or dry-run the existing file) — a real scaffold run is the first time it's actually exercised.

## Testing / Verification

- `src/hooks.ts`'s core logic (path resolution, load-and-call, error handling) gets standard TDD unit tests in `src/hooks.test.ts`, following this project's established DI conventions (see `src/wizard.ts`'s `WizardDeps` pattern) so the filesystem/dynamic-import boundary is injectable and testable without real files on disk.
- Real E2E verification before merge (matching this project's established discipline): a real throwaway `post-scaffold.mjs` written to the real resolved path on the machine doing the implementation, a real `clispark` scaffold run confirming the hook actually fires with the correct context values, a deliberately broken hook (throws) confirming the scaffold still reports success with a clear warning, and `--no-hook` confirming it's skipped even when the file exists.
- `clispark hook`'s output verified for real in both states (file present / absent).
- The new `dist/index.d.ts` verified for real: build the package, then from a separate throwaway project with `clispark` installed as a dev dependency, confirm `import type { PostScaffoldHookContext } from 'clispark'` actually resolves under TypeScript.
