# clispark M5: Documentation & Release Automation — Design

**Goal:** Milestone 5 from `project-ideas/clispark.plan.md`. Add `ARCHITECTURE.md` generation to the scaffolded project, and build a fully automated release pipeline for clispark itself (the generator), driven by Conventional Commits and GitHub Releases, with security-audit gating and tracking.

## Scope

Three parts, expanded from the original plan during brainstorming (2026-07-11):

1. **`ARCHITECTURE.md` in the generated project** — explains the `BaseCommand` lifecycle, oclif's convention-based command discovery, the logging setup, and the testing conventions from Milestone 3, so the "magic" (auto-registration, auto-logging) is documented rather than opaque.
2. **README for the generator itself** — already done in an earlier session (status table, usage, features, tech stack). No further work needed; this item is marked complete as-is.
3. **Release automation for clispark itself** — a full CI + release pipeline, originally out of scope ("CI/CD-Pipeline-Template" was explicitly deferred in the plan's initial scope decisions) but now pulled in at the user's request: automatic semantic version bumping from Conventional Commits, a release-triggered npm publish, and security-audit gating with GitHub issue tracking.

**Explicitly out of scope:** CI/CD tooling *for generated projects* (still deferred, per the original plan) — this milestone only builds release automation for the clispark repository itself. Scoped-registry or other M4 items are unaffected.

## Part 1: `ARCHITECTURE.md`

Static file at `templates/base/ARCHITECTURE.md`, copied during scaffolding exactly like `README.md` (same `{{projectName}}` placeholder mechanism already in `copyTemplate()` — this file joins the existing placeholder-replacement list). Content is project-structure documentation, not dynamically generated — the conventions it describes (BaseCommand, command discovery, logging) are identical for every generated project regardless of wizard answers, so a static template is sufficient. Covers:
- Why commands extend `BaseCommand` instead of oclif's `Command` directly (automatic logging/error-handling via `init()`/`catch()`/`finally()`).
- How command auto-registration works (drop a file in `src/commands/`, no manual registration — oclif's native `oclif.commands` discovery).
- Where logs are written (`env-paths`-based OS log directory, one file per invocation) and what they contain.
- The `pretest`→build→test chain and why it exists (`@oclif/test`'s `runCommand()` needs a prior build).

## Part 2: Release Automation for clispark

### Prerequisite: vitest v4 upgrade

`npm audit` (all dependencies, not just production — explicit choice made during brainstorming) currently reports 1 critical + 1 high finding, both in the `vitest`→`vite`→`esbuild` devDependency chain (confirmed empirically: `npm audit --omit=dev` is clean, 0 findings — the issue is entirely in dev tooling, not runtime code). Since the CI pipeline's audit gate is chosen to cover all dependencies, `vitest` must be upgraded from `^2.1.8` to `^4.1.10` in clispark's own `package.json` (not the `templates/base` copy — that's the generated project's separate dependency tree and out of scope here) before the pipeline can pass. This is prerequisite work within this milestone, not a separate one: bump the dependency, re-verify the existing 25 tests and any config options (`vitest.config.ts`'s `exclude`/`disableConsoleIntercept` usage) still work under v4, fix anything that breaks.

### Workflow 1: `ci.yml` — verification on every push/PR to `master`

Jobs:
- **Unit tests + typecheck + build:** `npm ci`, `npx tsc --noEmit`, `npx vitest run`, `npx tsup`.
- **Security audit:** `npm audit --audit-level=high` (all dependencies). Failing this fails the job — a hard gate, not just a report.
- **Scaffold smoke test:** a new, automated version of the manual end-to-end verification already used in Milestones 1-4 — scaffold a real project into a runner temp directory via `copyTemplate`/`scaffoldProject` (or the equivalent CLI invocation), then run `npm install && npm test` inside it, confirming the generated boilerplate itself still builds and passes its own tests. This is the highest-value regression check for a scaffolding tool specifically — the M3 tsup/vitest bugs were exactly the kind of thing this would catch automatically instead of relying on someone remembering to verify manually.

### Workflow 2: `release-please.yml` — automatic version bumping

Triggered on push to `master`. Uses `googleapis/release-please-action`, configured for a single npm package at the repo root. It parses Conventional Commit prefixes (`feat:` → minor, `fix:` → patch, `BREAKING CHANGE` → major) from commits since the last release — a convention this repo's entire commit history already follows — and maintains a standing "Release PR" that bumps `package.json`'s version and accumulates a changelog. Merging that PR is the only manual step in a normal release: release-please then creates the matching git tag and GitHub Release automatically.

### Workflow 3: `publish.yml` — npm publish on release

Triggered on the `release: published` event. Re-runs the same checks as `ci.yml` against the release commit (a safety net, not a redundant formality — guards against the small window between the last green `master` CI run and the release being published), then runs `npm publish` authenticated via the `NPM_TOKEN` repository secret. The very first publish (registering the `clispark` package name on the npm registry) still needs the user to confirm/trigger it — after that, every subsequent release follows the same automatic path.

### Security-audit issue tracking

A script, `scripts/audit-issues.mjs`, runs `npm audit --json`, buckets findings into two severity classes (blocking: high/critical; informational: moderate/low), and for each class either:
- opens a new GitHub issue (via `gh issue create`, labeled `security-audit-blocking` or `security-audit-info`) if none is currently open with that label, or
- updates/comments on the existing open issue with that label instead of creating a duplicate, or
- closes the existing open issue if the current audit run is clean for that class.

This runs only on pushes to `master` (not on every PR, to avoid issue-spam from in-progress branches) — invoked as a step in `ci.yml` gated to `github.event_name == 'push'`. The blocking behavior of the audit gate itself (failing the job on high/critical) is unaffected by this and applies on every run, PRs included.

## Manual Prerequisites (user-only steps)

- Create an npm access token (npmjs.com → Access Tokens → "Automation" type) and store it as the `NPM_TOKEN` GitHub repository secret.
- Confirm/trigger the very first `npm publish` once the pipeline is built and verified, since registering the public package name is a one-time irreversible action.

## Testing

- `ARCHITECTURE.md` template addition: extend `src/scaffold.test.ts`'s existing "copies all template files" test with an assertion that the file exists post-scaffold and its placeholder is replaced (same pattern as the `README.md`/`logger.ts` assertions already there).
- vitest v4 upgrade: existing 25 tests must all still pass; no new tests needed for the upgrade itself, only regression confirmation.
- GitHub Actions workflows cannot be unit-tested in the traditional sense — verification is empirical: push a branch and observe `ci.yml` actually run and pass (including the new scaffold-smoke-test job), then a controlled dry run of the release-please → publish chain (e.g. a real merge of the release-please PR against a pre-release version, or coordinating with the user on timing) before the first real publish.
- `scripts/audit-issues.mjs`: given `npm audit`'s output is naturally environment-dependent (real vulnerability databases change over time), this script should have unit tests against fixture JSON (a saved sample `npm audit --json` output) verifying the bucketing/labeling logic, with `gh` calls mocked/injected the same way `runCommand` is injectable in `src/scaffold.ts` — real `gh` invocation is exercised only in the actual CI run, not in the unit suite.
