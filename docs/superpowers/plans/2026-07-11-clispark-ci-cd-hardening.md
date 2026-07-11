# clispark CI/CD Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an ESLint quality gate to clispark's own source, then harden `master` with branch protection and wire up automatic merging of release-please's version-bump PRs — closing the loop from the user's question "do I always have to manually merge the release PR?"

**Architecture:** Four independent, sequentially-ordered changes to the `clispark` repo (`D:\programming\claude-projects\clispark`, GitHub `martinwichner/clispark`): (1) ESLint config + devDependencies for `src/`, (2) a new blocking step in `ci.yml`'s `test` job, (3) a new auto-merge step in `release-please.yml`, (4) branch protection on `master` applied via `gh api` and verified with a disposable test PR. Ordering matters: branch protection (Task 4) blocks direct pushes to `master`, so it must be applied **last**, after Tasks 1–3 have already been pushed directly (matching every prior milestone's direct-push-to-master pattern).

**Tech Stack:** ESLint 9 (flat config), typescript-eslint 8, GitHub Actions, GitHub CLI (`gh`, now authenticated in this environment), GitHub REST API (branch protection).

## Global Constraints

- ESLint applies only to `src/**/*.ts` in the `clispark` repo itself — never `templates/**` (that's the generated project's separate source tree, out of scope per the design spec).
- Rule set is `@eslint/js` `recommended` + `typescript-eslint` `recommended` (non-type-checked) — no `parserOptions.project`, no stricter type-aware rules.
- Branch protection on `master`: required status checks `test`, `audit`, `scaffold-smoke`; `required_approving_review_count: 0`; `enforce_admins: true`. No required-review count above 0 (solo-maintainer constraint, see spec).
- Full design rationale: `docs/superpowers/specs/2026-07-11-clispark-ci-cd-hardening-design.md`.

---

### Task 1: ESLint config for clispark's own source

**Files:**
- Create: `eslint.config.js`
- Modify: `package.json`

**Interfaces:**
- Produces: `npm run lint` (runs `eslint src`), used by Task 2's CI step.

- [ ] **Step 1: Install ESLint dependencies**

Run (from `D:\programming\claude-projects\clispark`):
```bash
npm install -D eslint @eslint/js typescript-eslint
```
Expected: exit code 0, `package.json`'s `devDependencies` and `package-lock.json` updated with `eslint`, `@eslint/js`, `typescript-eslint`.

- [ ] **Step 2: Create the flat ESLint config**

Create `eslint.config.js`:
```js
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'templates/**'],
  },
  eslint.configs.recommended,
  tseslint.configs.recommended,
);
```

- [ ] **Step 3: Add the `lint` script**

In `package.json`'s `"scripts"` block, add (alphabetically next to `"dev"`/`"postbuild"`, matching the existing key order):
```json
"lint": "eslint src",
```

- [ ] **Step 4: Run ESLint and fix any findings until clean**

Run:
```bash
npx eslint src
```
Expected: exit code 0, no output. If it reports real findings against the existing `src/` files (`cli.ts`, `logger.ts`, `registry.ts`, `scaffold.ts`, `types.ts`, `wizard.ts`, and their `.test.ts` files), fix each one in its source file — do not weaken the config to silence them. This step must be clean before Task 2 wires it into CI as a blocking gate.

- [ ] **Step 5: Run the existing test suite to confirm nothing broke**

Run:
```bash
npm test
```
Expected: all existing tests still pass (31/31 as of the last recorded count in the plan changelog — confirm the exact current count in the output, it may have grown).

- [ ] **Step 6: Commit and push**

```bash
git add eslint.config.js package.json package-lock.json
git commit -m "feat: add ESLint for clispark's own source"
git push
```

---

### Task 2: Wire ESLint into `ci.yml` as a blocking check

**Files:**
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `npm run lint` script from Task 1 (invoked directly as `npx eslint src` to match the existing step style in this file, which calls `npx tsc`/`npx vitest`/`npx tsup` directly rather than via npm scripts).

- [ ] **Step 1: Add the ESLint step to the `test` job**

In `.github/workflows/ci.yml`, the `test` job currently reads:
```yaml
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v6
        with:
          node-version: 22
      - run: npm ci
      - run: npx tsc --noEmit
      - run: npx vitest run
      - run: npx tsup
```
Change it to insert a new step directly after `npx tsc --noEmit` and before `npx vitest run`:
```yaml
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v6
        with:
          node-version: 22
      - run: npm ci
      - run: npx tsc --noEmit
      - run: npx eslint src
      - run: npx vitest run
      - run: npx tsup
```

- [ ] **Step 2: Commit and push**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add ESLint as a blocking step in the test job"
git push
```

- [ ] **Step 3: Verify the workflow actually runs and passes on GitHub**

Run:
```bash
gh run list --workflow=ci.yml --limit=1
```
Wait for the run triggered by the push above to complete (poll with `gh run watch <run-id>` using the ID from the previous command, or re-run `gh run list` after a short wait), then confirm success:
```bash
gh run view <run-id>
```
Expected: all three jobs (`test`, `audit`, `scaffold-smoke`) show `success` — the new `eslint src` step must show as a passed step within the `test` job's log (`gh run view <run-id> --log | grep -A2 "eslint src"` to confirm it actually executed, not just that the job passed for unrelated reasons).

---

### Task 3: Auto-merge for release-please PRs

**Files:**
- Modify: `.github/workflows/release-please.yml`

**Interfaces:**
- Consumes: `RELEASE_PLEASE_TOKEN` secret (already configured in this repo since the M5 release).

- [ ] **Step 1: Add the `id` and the auto-merge step**

`.github/workflows/release-please.yml` currently reads:
```yaml
name: release-please

on:
  push:
    branches: [master]

permissions:
  contents: write
  pull-requests: write

jobs:
  release-please:
    runs-on: ubuntu-latest
    steps:
      - uses: googleapis/release-please-action@v5
        with:
          release-type: node
          token: ${{ secrets.RELEASE_PLEASE_TOKEN }}
```
Change it to:
```yaml
name: release-please

on:
  push:
    branches: [master]

permissions:
  contents: write
  pull-requests: write

jobs:
  release-please:
    runs-on: ubuntu-latest
    steps:
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
Note: `prs_created` is the boolean output that's `'true'` only when this run actually created/updated a release PR (as opposed to a run that created the final GitHub release after a merge, which populates a different set of outputs — see the design spec's Part 4). `pr` is a JSON string of the PR object, hence `fromJSON(...).number`.

- [ ] **Step 2: Commit and push**

```bash
git add .github/workflows/release-please.yml
git commit -m "ci: auto-merge release-please PRs once required checks pass"
git push
```

- [ ] **Step 3: Note deferred verification**

This step cannot be verified synchronously — it only fires on a real release-please run, which only happens when a `feat:`/`fix:` commit lands on `master` (this task's own commit is `ci:`, which release-please's Conventional Commits parsing does not treat as release-triggering). Verification happens naturally the next time a `feat:` or `fix:` commit is pushed (e.g., a future M6/M7 change): confirm the resulting release PR shows "auto-merge enabled" (`gh pr view <pr-number>` — look for `"autoMergeRequest"` in `gh pr view <pr-number> --json autoMergeRequest`) and that it merges itself once `ci.yml` passes, with no manual click. Record the outcome in the plan changelog when it happens, per this project's established pattern of documenting real first-run verification (see M5's history).

---

### Task 4: Branch protection on `master` (apply last)

**Files:** None (repository setting via GitHub API, not a versioned file — matches the spec's Part 3 design decision).

**Interfaces:**
- Consumes: `test`, `audit`, `scaffold-smoke` job names from `ci.yml` (unchanged by Tasks 1–3; Task 2 added a step inside `test`, not a new job).

**This task must run after Tasks 1, 2, and 3 have already been pushed directly to `master`.** Once applied, direct pushes to `master` are blocked (including for the repo owner, via `enforce_admins`) — all subsequent changes, from any future milestone, must go through a PR.

- [ ] **Step 1: Apply branch protection**

Run (from anywhere, `gh` is authenticated):
```bash
cat <<'EOF' | gh api repos/martinwichner/clispark/branches/master/protection -X PUT --input -
{
  "required_status_checks": {
    "strict": true,
    "checks": [
      { "context": "test", "app_id": null },
      { "context": "audit", "app_id": null },
      { "context": "scaffold-smoke", "app_id": null }
    ]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": false,
    "require_code_owner_reviews": false,
    "required_approving_review_count": 0
  },
  "restrictions": null,
  "required_linear_history": false,
  "allow_force_pushes": false,
  "allow_deletions": false
}
EOF
```
Expected: JSON response echoing the applied protection settings, HTTP 200 (no error).

- [ ] **Step 2: Verify the settings actually took effect**

Run:
```bash
gh api repos/martinwichner/clispark/branches/master/protection
```
Expected: response shows `enforce_admins.enabled: true`, `required_pull_request_reviews.required_approving_review_count: 0`, and `required_status_checks.checks` containing all three of `test`, `audit`, `scaffold-smoke`.

- [ ] **Step 3: Prove it blocks a failing PR — create a disposable test branch**

```bash
git checkout -b test/branch-protection-check
```
Add a deliberate, trivial ESLint violation to prove the gate actually runs (an unused variable, which `eslint:recommended`'s `no-unused-vars` flags by default):
```bash
printf '\nconst _branchProtectionTestUnusedVar = 1;\n' >> src/types.ts
git add src/types.ts
git commit -m "test: deliberate lint violation to verify branch protection"
git push -u origin test/branch-protection-check
```

- [ ] **Step 4: Open the test PR and confirm it's blocked**

```bash
gh pr create --title "test: branch protection check (do not merge)" --body "Disposable PR verifying branch protection + ESLint gate. Will be closed without merging." --base master --head test/branch-protection-check
```
Wait for checks, then inspect:
```bash
gh pr checks test/branch-protection-check --watch
```
Expected: the `test` check fails (ESLint catches the unused variable). Then confirm the merge is actually blocked:
```bash
gh pr merge test/branch-protection-check --squash
```
Expected: `gh` refuses with an error naming the unmet required status check (not a silent success) — this is the actual proof branch protection is enforced, not just configured.

- [ ] **Step 5: Clean up the disposable test PR and branch**

```bash
gh pr close test/branch-protection-check --delete-branch
git checkout master
git branch -D test/branch-protection-check
git pull
```
Expected: `master` is unaffected (the test commit was never merged); local and remote `test/branch-protection-check` branches are gone.

- [ ] **Step 6: Record the verification outcome**

No code commit for this task (see Files: None above). Instead, add a dated entry to `project-ideas/clispark.plan.md`'s Changelog section documenting: ESLint added, branch protection applied and empirically verified (blocked a real failing PR), release-please auto-merge wired up (verification deferred to next real release per Task 3). Commit and push that changelog update **as a PR** (branch protection is now active):
```bash
git checkout -b docs/ci-cd-hardening-changelog
git add project-ideas/clispark.plan.md
git commit -m "docs: record CI/CD hardening completion in plan changelog"
git push -u origin docs/ci-cd-hardening-changelog
gh pr create --title "docs: record CI/CD hardening completion" --body "Changelog update for the ESLint gate, branch protection, and release auto-merge work." --base master --head docs/ci-cd-hardening-changelog
gh pr merge docs/ci-cd-hardening-changelog --squash --auto
```
Expected: PR auto-merges once `ci.yml` passes (this is also, incidentally, the first real proof that ordinary PR-based merging works end-to-end under the new branch protection).
