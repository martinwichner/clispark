# clispark M6: Update Mechanism — Design

**Goal:** Milestone 6 from `project-ideas/clispark.plan.md`. Let an already-generated project pull in core improvements from newer clispark versions without clobbering the user's own code, and let the user see what changed between generator versions.

## Scope

Three commands/behaviors, all new:

1. `npx clispark update`, run inside a generated project — updates generator-owned ("core") files and dependencies to match the currently installed (= latest, since it runs via `npx`) clispark version, leaving user-owned ("custom") files and any core file the user has hand-edited untouched.
2. `clispark releasenotes`, run inside a generated project — lists what changed between the project's currently-applied generator version and the latest available one.
3. A version manifest (`.clispark/manifest.json`) in every newly generated project, which both commands depend on. Projects generated before M6 have no manifest and cannot use either command (no retroactive migration — see Error Handling).

**Explicitly out of scope (descoped during brainstorming, 2026-07-12):**
- Retroactively adding a manifest to projects generated before M6.
- A patch/codemod system (Rails/Next.js-style per-version migration scripts) — the whole-file/whole-field replace-if-unmodified approach below is simpler and sufficient for a personal-use tool; can be revisited if core changes ever need finer-grained transformations than "replace the file."
- Any kind of automatic deletion of files or dependencies the new template no longer includes — never destructive, only additive plus advisory notes.

## Design

### File classification

**Core (generator-managed):** `bin/run.js`, `src/index.ts`, `src/base-command.ts`, `src/logger.ts`, `tsup.config.ts`, `vitest.config.ts`, `tsconfig.json`, `ARCHITECTURE.md`, `.gitignore`.

**Custom (user-managed, never touched by `update`):** everything under `src/commands/` (including `hello.ts` — it's a copy-paste starting point, not a maintained core file), `README.md`, `.npmrc`.

**Mixed:** `package.json` — see below.

### `.clispark/manifest.json`

Written/updated by both `scaffoldProject()` (M2) and `update`. Shape:

```json
{
  "generatorVersion": "1.4.0",
  "coreFiles": {
    "src/base-command.ts": "<sha256>",
    "...": "<sha256>"
  },
  "coreDependencies": {
    "@oclif/core": "^4.0.0",
    "...": "..."
  },
  "coreScripts": {
    "build": "tsup",
    "...": "..."
  },
  "coreFields": {
    "engines": { "node": ">=18" },
    "oclif": { "...": "..." }
  }
}
```

`coreFiles` hashes are computed over the file content *after* placeholder substitution (i.e. what actually landed on disk), so a project's own name doesn't cause false "modified" positives. `coreDependencies`/`coreScripts`/`coreFields` record exactly what the generator last wrote into `package.json`, so `update` can tell a generator-driven value from a user edit without re-deriving it.

`scaffoldProject()` (M2) is extended to write this manifest as its final step, using the generator's own current version and the template it just copied.

### `npx clispark update` flow

1. **Git-clean check.** `git status --porcelain` inside `targetDir` (current working directory) must be empty. Non-empty → abort with a clear message ("commit or stash your changes first"). This is the safety net that makes the whole operation trivially revertible (`git checkout .` / `git revert`).
2. **Manifest check.** No `.clispark/manifest.json` → abort ("this project has no clispark manifest — generated before update support was added, or not a clispark project").
3. **Version check.** `manifest.generatorVersion === <running clispark's own version>` → print "already up to date", exit 0, no changes.
4. **Core files.** For every core file in the *new* template:
   - Not present locally → copy in (new file since this project was last scaffolded/updated).
   - Present, local hash matches `manifest.coreFiles[path]` (unmodified since last update) → overwrite with the new template's version.
   - Present, local hash differs (user edited it) → skip; record as "skipped (locally modified)".
   - A core file that existed in `manifest.coreFiles` but no longer exists in the new template → never deleted; record as "no longer part of the core, safe to remove manually" if it's still present on disk.
5. **`package.json` selective merge.** For `dependencies`+`devDependencies` (flattened into one lookup), `scripts`, `engines`, and `oclif`: for each key/field the *new* template defines, compare the project's current value to `manifest.coreDependencies`/`coreScripts`/`coreFields` (the last value the generator itself set). Equal → safe to update to the new template's value. Different → user changed it manually → skip that key, record as skipped. Any key the user added themselves (not present in the old manifest) is never touched — it was never generator-owned. `name`, `version`, `description`, `bin`, `files` are never touched.
6. **Manifest rewrite.** New `generatorVersion`, new `coreFiles` hashes, new `coreDependencies`/`coreScripts`/`coreFields` snapshots — reflecting exactly what was just written (including entries that were skipped, which keep their *previous* recorded value, not the new template's, since the file/field wasn't actually changed).
7. **Commit.** If anything actually changed on disk: `git add -A && git commit -m "chore: update clispark core to v<version>"`. If everything was skipped (no-op run), no commit.
8. **Summary output:** counts and paths for updated / newly added / skipped (with reason) / no-longer-core files and dependency keys, plus a pointer to `clispark releasenotes` for details on *why* things changed.

### `clispark releasenotes`

1. Same manifest presence check as `update` (must be run inside a generated project).
2. Reads its own running version (`require('../package.json').version` — no extra registry lookup needed, since `npx` already resolved the latest version to run).
3. If `manifest.generatorVersion` equals the running version → "you're on the latest version, nothing to show."
4. Otherwise, calls the public GitHub Releases API (`GET https://api.github.com/repos/martinwichner/clispark/releases`, unauthenticated — public repo, no token needed), filters to releases with tag version `> manifest.generatorVersion` and `<= running version`, and prints each release's tag + body (the Conventional-Commits changelog release-please already generates) newest-first.
5. Network/API failure → clear error message, exit 1 (no cached/offline fallback — this command has no side effects to protect, unlike `update`).

### README restructure (bundled into M6 since it documents this milestone's new commands)

Full rewrite of `README.md`, reordered top-to-bottom as:

1. Title + one-line tagline
2. Badges — npm version, CI build status (`ci.yml`), license (this also closes the separate M7 backlog item for README badges)
3. Quickstart — a single concrete `npx clispark` → result walkthrough, short enough to read in 30 seconds
4. What you get (existing section, kept, lightly trimmed)
5. Usage — the wizard flow, expanded from today's short version
6. **Updating a project** (new) — `npx clispark update` and `clispark releasenotes`, what "core" vs. "your code" means, what a skipped file/dependency means and why
7. Tech stack (existing, kept)
8. Releases & CI (existing, trimmed — keep the *what*, drop some of the *why/history* detail that belongs in the plan/changelog, not user-facing docs)
9. Development status — replaces today's per-milestone table with a single compact line (current version + "M6 done" style status), pointing to `CHANGELOG.md` (already maintained by release-please) for full history
10. Built with Claude / Superpowers skills (existing section, content unchanged — kept per explicit instruction)
11. License (existing, kept)

## Error Handling

- Unclean git status → abort before touching any file, no partial state possible.
- Missing manifest → abort, no changes, no crash/stack trace (same clean-error convention as the rest of clispark's CLI output).
- Already up to date → clean exit 0, not treated as an error.
- Individual file/dependency conflicts → never abort the whole run; skip-and-report, consistent with "never destructive" as the overriding principle for this milestone.
- `releasenotes` network failure → clean error message, exit 1.

## Testing

Same pattern as `scaffoldProject()` (M2) and the registry work (M4): injectable `runCommand` dependency for git calls, real `fs/promises` against real temp directories for file operations (no mocks), unit tests plus a manual end-to-end pass.

**Unit tests:**
- Hash comparison logic: unmodified / user-modified / newly-added / no-longer-core file, for each of the four outcomes in the core-file loop.
- `package.json` selective merge: unmodified vs. user-modified dependency/script/field, a user-added custom key untouched, `name`/`version`/`bin`/`files` never touched.
- Git-clean gate: aborts on dirty status, proceeds on clean status.
- Manifest read/write round-trip, including the "skipped entries keep their old recorded value" rule from step 6.
- No-op run (already up to date, or everything skipped) produces no commit.
- `releasenotes`: version-range filtering logic against a fixture set of releases.

**Manual end-to-end verification (same shape as M1–M5):** scaffold a real project, simulate a "newer" generator version by pointing at a second template snapshot with a deliberate core-file change, a deliberate user edit to one core file, and a deliberate new dependency — run `update` for real and confirm the on-disk result matches the skip/replace/add rules; run `releasenotes` for real against the actual clispark GitHub releases.
