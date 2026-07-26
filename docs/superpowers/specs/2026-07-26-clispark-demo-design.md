# `clispark demo` — Guided Console Walkthrough (#120) — Design

## Context

Raw idea from the maintainer's own backlog notes, formalized as issue #120: a guided, polished console walkthrough of the typical clispark workflow — what you get when you scaffold, what the top-level commands do, and what each wizard question is for. Not a static screenshot/GIF; an actual interactive command.

Explicit requirement surfaced during brainstorming: **as new commands and wizard flags get added in future backlog items (#67, #90, #92, ...), the demo must stay current with minimal, structural risk of silent drift** — not a hand-maintained script that quietly falls out of sync with reality.

## Purpose

Both an onboarding showcase (short, polished core walkthrough) and an interactive reference (deeper, on-demand explanation of every command and wizard flag) — a menu lets the user pick which they want rather than forcing one linear experience.

## Scope

**In scope:** a new, always-present `clispark demo` subcommand (no wizard opt-in, unconditional like `whoami`/`hook`), covering:
- clispark's own top-level commands (the default scaffold action, plus `update`/`add`/`releasenotes`/`whoami`/`hook`/`demo` itself)
- every wizard question/flag
- a live, real (not scripted) Node/oclif scaffold walkthrough, including the generated example commands (`hello`, `task`/`task list`/`task complete`)

**Out of scope:**
- Full walkthroughs of the .NET and PowerShell templates — the core walkthrough scaffolds Node only, and closes with a short note that the same mechanism applies to .NET/PowerShell with stated differences (attribute-based discovery instead of inheritance, native shell completion instead of `@oclif/plugin-autocomplete`, etc.).
- Any change to the actual scaffold/wizard behavior itself — this is a read-only, illustrative command.

## Prerequisite finding: `cli.ts` cannot be safely imported today

`src/cli.ts` currently builds the entire `commander` `Command` tree *and* unconditionally calls `program.parseAsync(process.argv)` at the bottom of the module — a real side effect that fires the moment the file is imported, not only when it's run as the actual entrypoint. No `cli.test.ts` exists today, so this has never mattered — nothing has needed to import `cli.ts` before.

The commands-reference mode needs to introspect the real `Command` tree (names + descriptions, live, not hand-copied) to satisfy the "stays current automatically" requirement. Importing `cli.ts` as-is to get at `program.commands` would also trigger a real `argv` parse as an unwanted side effect.

**Resolution:** extract the Command-tree construction into a new, side-effect-free `src/program.ts` exporting `createProgram(): Command` (builds and returns a fresh `Command` instance on every call — no shared state between calls, safe to invoke repeatedly from tests/the demo). `src/cli.ts` becomes a thin entrypoint:

```ts
import { createProgram } from './program';

createProgram()
  .parseAsync(process.argv)
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
```

This is a small, justified refactor (not unrelated cleanup) — it's the actual blocking prerequisite for live command introspection, and it happens to make `cli.ts`/`program.ts` unit-testable for the first time as a side benefit.

## Data sources: commands vs. wizard flags

**Commands — fully live, zero hand-maintenance.** Every subcommand registered in `program.ts` already carries a real `.description()` (confirmed by reading the current file — `update`, `add`, `releasenotes`, `whoami`, `hook` all have one). The commands-reference mode iterates `createProgram().commands`, reading each entry's `.name()` and `.description()` directly — a future command (e.g. from #67's background-check flag, or a `clispark doctor` from #91) shows up automatically the moment it's registered in `program.ts`, no separate list to maintain.

**Correction found during critical re-review: command-level flags were missing.** The original ask was to explain "the individual commands *and* how the individual flags work" — the design as first drafted only covered command names/descriptions, not each command's own options (`whoami`'s `--joke`/`--fact`, and the root program's global `--no-confetti`/`--no-hook`). Each `Command` instance in `commander` exposes `.options` (an array of `Option` objects, each with `.flags` and `.description`) — the commands-reference mode must iterate this per command too, not just `.name()`/`.description()`. Global options (`--no-confetti`, `--no-hook`) live on the root `program` object itself rather than a subcommand; shown either alongside the root/scaffold explanation or as their own short "global flags" subsection — pick one at implementation time, not a design-level fork.

Two things need explicit handling, not live introspection:
- **The default/root scaffold action** isn't a `commander` subcommand (it's `program.action(...)` itself) — it doesn't appear in `.commands`. The commands-reference mode explains it with one short, hand-written blurb, clearly labeled as the entrypoint rather than a subcommand, and is also where the root's global options (`--no-confetti`, `--no-hook`) get surfaced.
- **Commander's own auto-added `help` command** appears in `.commands` too and must be filtered out (or deliberately kept and explained as "prints command help" — decide at implementation time, not a design-level fork).

**Wizard flags — a colocated catalog, not full introspection.** `wizard.ts` is a sequential, conditionally-branching function (the registry-URL question only fires for a `work` profile; the autocomplete question only if `pack.supportsAutocompleteOptIn`; the command-convention question — once #80 ships — only if `lintEnabled`). It has no declarative list of "questions" to iterate, and restructuring its working, tested control flow into one purely to enable introspection is a disproportionate, risky refactor for this feature's sake.

**Resolution:** a new exported constant directly inside `wizard.ts`, next to the real questions it describes:

```ts
export interface WizardQuestionCatalogEntry {
  id: string;
  prompt: string;
  why: string;
}

export const WIZARD_QUESTION_CATALOG: WizardQuestionCatalogEntry[] = [
  { id: 'language', prompt: 'Which language?', why: '...' },
  { id: 'projectName', prompt: 'Project name', why: '...' },
  { id: 'profile', prompt: 'Is this a work or private project?', why: '...' },
  { id: 'registryUrl', prompt: '<registry URL prompt, only asked for work profile>', why: '...' },
  { id: 'publishIntent', prompt: 'Do you plan to publish this?', why: '...' },
  { id: 'lintEnabled', prompt: 'Set up lint tooling?', why: '...' },
  { id: 'autocompleteEnabled', prompt: 'Set up shell autocompletion?', why: '...(only asked for packs that support it)' },
];
```

This is a deliberate trade-off, not a fully automatic guarantee: it's a second, colocated (not separate-file) list that a human must remember to extend alongside a new wizard question — matching this codebase's existing convention of centralized-but-manually-maintained arrays (`CORE_FILE_PATHS`, `LINT_DEPENDENCY_NAMES`, `CORE_SCRIPT_NAMES`). The wizard-flags-reference mode doesn't need a `visibleWhen`/conditional-visibility mechanism — it's a reference, not a live simulated run, so it lists every entry unconditionally and states each one's precondition in its own `why` prose (e.g. "...only asked if you chose a work project").

**Regression test to catch drift (not just a hardcoded count):** a new test in `wizard.test.ts` runs `runWizard()` with mocked responses that force every optional branch on (`profile: 'work'`, `lintEnabled: true`, a pack with `supportsAutocompleteOptIn: true`) and **`publishIntent: false`** specifically to avoid the project-name retry loop (a retry of an existing question, not a new one — including it would make the call count path-dependent and non-deterministic). It counts how many `select`/`text` prompt calls were actually consumed during that real run and asserts the count equals `WIZARD_QUESTION_CATALOG.length`. This exercises real code, not an independently-hardcoded expectation — a mismatch means someone added or removed a real question without updating the catalog.

**Cross-plan sequencing risk found during critical re-review:** `WIZARD_QUESTION_CATALOG` doesn't exist yet, and #80's implementation plan (already written, `docs/superpowers/plans/2026-07-26-clispark-command-convention-rule.md`) predates this design — it adds a new `commandConventionEnabled` wizard question but has no step referencing a catalog that didn't exist when it was written. Whichever of #80/#120 is implemented **second** must add its new question to the other's artifact: if #120 ships first, #80's implementation must remember to extend `WIZARD_QUESTION_CATALOG` with the `commandConventionEnabled` entry (not currently in #80's plan — a manual follow-up, not automatic); if #80 ships first, #120's own plan already accounts for it (the catalog is built fresh against whatever `wizard.ts` looks like at #120's implementation time, so it would naturally include it). Flagging explicitly rather than leaving as a silent gap between two independently-written artifacts.

## The core walkthrough: real scaffold, narrated

Runs clispark's actual `scaffoldProject()` against `nodeOclifPack`, targeting a real `mkdtemp` temp directory (never the user's cwd), with `deps.runCommand` replaced by a no-op — skips `git init`/`npm install`/`npm run build` so the walkthrough stays fast and offline-safe, while still producing the exact current template's real files. The narration explicitly says these steps are skipped for the demo's sake (a real scaffold also runs them). After scaffolding, it reads back real files (`package.json`, `src/base-command.ts`, `src/commands/hello.ts`, `src/commands/task.ts` and its subcommands) and shows short annotated excerpts via `@clack/prompts`' `note()`, explaining `BaseCommand`, the logging/error-handling wiring, and the example commands (`hello`, `task`/`task list`/`task complete`). Closes with a short, hand-written note on .NET/PowerShell differences (not a full walkthrough of either).

**Error handling and cleanup:**
- The scaffold-and-narrate phase runs inside `try { ... } finally { rm(tempDir, { recursive: true, force: true }) }` — the temp directory is removed whether the phase completes, throws, or is cancelled mid-way.
- A `process.once('SIGINT', cleanupAndExit)` handler is registered immediately before the scaffold step and removed right after, as a defensive measure against an OS-level interrupt during the (fast but non-atomic) file copy.
- If the real scaffold step throws for any reason, the walkthrough catches it and falls back to a purely textual description instead of surfacing a raw stack trace — the demo should never look more broken than a plain doc page.
- Menu cancellation (Ctrl+C at a prompt) uses the same `isCancel()`/`cancel()` convention already established in `wizard.ts` — no new interrupt mechanism.
- Wired through `withLogging('demo', ...)`, consistent with every other subcommand, so a demo run is logged like any other invocation but is clearly labeled as such.

## Menu and modes

`clispark demo` opens a `@clack/prompts` `select()` menu with three options:
1. **Complete walkthrough** — the full narrated Node scaffold above.
2. **Just the commands** — the commands-reference mode.
3. **Just the wizard flags** — the wizard-flags-reference mode.

Selecting any mode runs it to completion and returns to the process exit (no forced loop back to the menu — rerun `clispark demo` for another pass, consistent with every other one-shot clispark command).

## File structure

```
src/program.ts                          # CREATE — createProgram(): Command, extracted from cli.ts
src/program.test.ts                     # CREATE
src/cli.ts                              # MODIFY — thin entrypoint calling createProgram().parseAsync(...)
src/wizard.ts                           # MODIFY — WIZARD_QUESTION_CATALOG export
src/wizard.test.ts                      # MODIFY — new catalog/prompt-count regression test
src/demo/index.ts                       # CREATE — runDemo(): menu + dispatch
src/demo/commands-reference.ts          # CREATE
src/demo/commands-reference.test.ts     # CREATE
src/demo/wizard-flags-reference.ts      # CREATE
src/demo/wizard-flags-reference.test.ts # CREATE
src/demo/full-walkthrough.ts            # CREATE
src/demo/full-walkthrough.test.ts       # CREATE
```

## Testing

- `program.test.ts`: `createProgram()` returns a `Command` whose `.commands` include exactly the expected registered subcommands (including the new `demo` command itself), each with a non-empty description; also asserts calling `createProgram()` twice yields two independent instances with no shared/leaked state (verifies the "fresh instance per call" contract this design relies on).
- `wizard.test.ts`: the real-run prompt-count-vs-catalog-length regression test described above.
- `commands-reference.test.ts` / `wizard-flags-reference.test.ts`: rendering checks — output mentions every real command/flag by name **and each command's own options** (e.g. `whoami`'s `--joke`/`--fact`), the root's global options (`--no-confetti`/`--no-hook`) are surfaced somewhere, `help` is filtered (or deliberately explained — implementation-time decision), the root scaffold action is explained separately.
- `full-walkthrough.test.ts`: temp directory is removed after both a successful run and a simulated failure (mocked `scaffoldProject` throwing); the textual-fallback path is exercised directly; narration mentions `hello` and `task`/`task list`/`task complete`; output includes the .NET/PowerShell closing note.
- Real, manual end-to-end verification (same discipline as #70/#80's plans): run `clispark demo` for real, click through all three menu options, confirm no leftover temp directory afterward.

## Open questions for implementation time

- Exact handling of commander's auto-added `help` entry in `program.commands` (filter vs. explain) — pick one, not a design fork.
- Exact `Option`/`Command` description-accessor API shape for the commander version pinned in `package.json` — verify at implementation time rather than assume.
- Whether the full-walkthrough's file-excerpt content should be kept in sync with README's "What you get" section (#121) by any shared mechanism, or just by convention/reviewer attention — no hard coupling decided here; revisit once #121 is actually rewritten.

## Status

Design complete, 2026-07-26 (brainstormed interactively). Two critical-review passes: the first (before write-up) found the `cli.ts` side-effect blocker and the weakness of a naive "hardcoded count" regression test; a second, deeper pass (after write-up, checking every technical claim rather than accepting the draft) found a real scope gap (per-command flags were missing entirely, despite being explicitly requested) and a cross-plan sequencing risk against #80's already-written implementation plan — both corrected inline above. Verified during this second pass: no existing code imports `cli.ts` directly (only `package.json`'s `bin`/`postbuild` reference the built `dist/cli.js`), and `tsup.config.ts`'s entry point (`src/cli.ts`) needs no change since `program.ts` bundles in transitively. Ready for implementation plan.
