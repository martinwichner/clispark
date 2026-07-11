# clispark: CI/CD Hardening — ESLint Gate, Branch Protection, Release Auto-Merge — Design

**Goal:** Not a plan milestone — a process/infrastructure hardening of clispark's own repository, triggered by the user's question after the first real release (2026-07-11): "does that mean I always have to manually merge the release PR? can we automate that, and add a code-review/best-practices gate?" Two concerns, addressed together: (1) automatic merging of release-please's version-bump PRs once CI passes, (2) a static-analysis gate (ESLint) plus branch protection formalizing the manual semantic review that has already been standard practice since M1 (the "final Whole-Branch-Review" pattern).

## Scope

**In scope:**
1. ESLint for clispark's own `src/` (the generator's source code only)
2. A new blocking step in `ci.yml`'s existing `test` job running ESLint
3. Branch protection on `master`: required status checks, no direct pushes, no required-approval count
4. GitHub-native auto-merge (`gh pr merge --auto --squash`) wired into `release-please.yml`

**Explicitly out of scope (descoped during brainstorming, 2026-07-11):**
- ESLint/linting for `templates/base` (i.e. for *generated* projects) — this is a separate, larger feature (new template file, possibly a new wizard question, its own rule-set decision) unrelated to hardening clispark's own release pipeline. Reconfirmed as out of scope per the original M0 decision ("kein eslint/prettier/CI-Workflows" for generated projects). Noted as a candidate idea for M7 (Backlog).
- Required PR-approval count in branch protection — would deadlock a solo maintainer (GitHub blocks self-approval on required reviews by default). Manual semantic review stays a documented convention, not a GitHub-enforced gate.
- Prettier / other formatting tooling — not requested, not needed to solve either of the two triggering concerns.

## Part 1: ESLint for clispark's own source

Flat config (`eslint.config.js`, ESLint 9+ convention), scoped to `src/**/*.ts` only — `templates/**` is a different project's source tree (already excluded from clispark's own `vitest.config.ts` for the same reason, see M3) and must be excluded here too, or the generated-project template code (which follows its own, not-yet-defined, conventions) would be linted against clispark's own rules by mistake.

Rule set: `@eslint/js`'s `recommended` + `typescript-eslint`'s `recommended` (non-type-checked). This is the standard, moderate baseline — catches real bugs (unused vars, unreachable code, etc.) without the extra setup cost and stricter type-aware rules of `strict-type-checked`/`stylistic-type-checked`, which were considered and rejected as more than this repo currently needs.

New devDependencies: `eslint`, `typescript-eslint`, `@eslint/js`. New script: `"lint": "eslint src"`.

Before wiring this into CI as a blocking gate, `npx eslint src` must run clean locally first — introducing a new blocking check that immediately fails on pre-existing findings would break `master`'s CI on the very next push for reasons unrelated to the change that triggered it.

## Part 2: `ci.yml` — ESLint as a blocking step

New step added to the existing `test` job, directly after `npx tsc --noEmit` and before `npx vitest run`:

```yaml
- run: npx eslint src
```

Considered and rejected: a separate `lint` job. A dedicated job would add a fourth required-status-check name to branch protection for no real benefit — ESLint runs in seconds and has no parallelization gain here, and it belongs logically with the other fast static checks (`tsc --noEmit`) already in `test`. The `audit` and `scaffold-smoke` jobs remain untouched.

## Part 3: Branch protection on `master`

Applied once via `gh api repos/martinwichner/clispark/branches/master/protection -X PUT` (an imperative one-time repository setting, not a file maintained in the repo — consistent with how other one-time repo settings from the M5 release, like "Allow GitHub Actions to create pull requests", were handled: documented in this spec and the plan changelog, not scripted, since branch protection changes rarely).

Configuration:
- Require a pull request before merging: on, with required approving review count **0** (this is the actual GitHub mechanism that forces changes through a PR instead of a direct push — a legitimate, commonly-used solo-maintainer configuration: PR required, no mandatory approval)
- Required status checks: `test`, `audit`, `scaffold-smoke` (the three existing `ci.yml` job names; `test` now includes the new ESLint step)
- Require branches to be up to date before merging: on
- Enforce for administrators (`enforce_admins`): on — without this, the repo owner's account is exempt from branch protection by GitHub default, which would silently defeat the "no direct push, even for me" intent above
- Allow force pushes / allow deletions: off

This is a deliberate workflow change beyond just fixing the release-PR question: feature work (M6, M7 backlog items) that previously merged via local `git merge` + `push` to `master` (as in M1–M5) will from now on also require a PR, even though no GitHub-enforced review gate exists — CI must still pass, and the manual Whole-Branch-Review convention continues to apply before merging.

## Part 4: `release-please.yml` — auto-merge

New final step in the job that runs `googleapis/release-please-action`, gated on a PR having actually been created/updated in this run. The action's `pr` output is a JSON string of the PullRequest object (not a bare number), so the PR number must be extracted via `fromJSON(...).number`; the `prs_created` output is the boolean gate (verified against the action's actual documented outputs, not assumed):

```yaml
- uses: googleapis/release-please-action@v5
  id: release
  with:
    release-type: node
    token: ${{ secrets.RELEASE_PLEASE_TOKEN }}

- name: Enable auto-merge for release PR
  if: ${{ steps.release.outputs.prs_created == 'true' }}
  run: gh pr merge --auto --squash "${{ fromJSON(steps.release.outputs.pr).number }}"
  env:
    GH_TOKEN: ${{ secrets.RELEASE_PLEASE_TOKEN }}
```

`gh pr merge --auto` uses GitHub's native auto-merge: it marks the PR to merge automatically the moment all required status checks (as configured in Part 3) report success — no custom polling workflow needed, since branch protection already knows which checks must pass. Uses the existing `RELEASE_PLEASE_TOKEN` PAT (already required for this workflow since the M5 release, for the unrelated reason that `GITHUB_TOKEN`-authored events don't trigger downstream workflows — the same token works here since auto-merge just needs standard PR-write permission).

If a required check fails, the PR simply stays in pending-auto-merge state — identical to today's behavior of a merge sitting unmerged until you act, no new failure mode introduced.

## Testing / Verification

- ESLint: run `npx eslint src` locally until clean, *before* adding the CI step (see Part 1).
- Branch protection: verify it actually blocks merges by opening a deliberately failing test PR (e.g. a trivial lint violation) against `master` and confirming the merge button is disabled until fixed — the same "prove it with a real run, not just the config" approach used throughout this project's CI verification (M5's live-CI bug discoveries).
- Auto-merge: verified end-to-end on the next real release-please PR this repo produces — confirm it merges itself once `ci.yml` is green, no manual click needed. This mirrors how M5's release-please/publish chain was itself only fully verified on a real release, since GitHub Actions permission/token behavior (as M5 discovered four times) often only surfaces on genuine first-run chains, not local reasoning about the YAML.

## Manual Prerequisites (user-only steps)

- None beyond what already exists (`RELEASE_PLEASE_TOKEN` secret is already configured from M5). Branch protection is applied via `gh api` by Claude during implementation, not manually by the user, since `gh` is now authenticated in this environment.
