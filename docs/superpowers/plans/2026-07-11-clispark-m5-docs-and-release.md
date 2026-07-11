# clispark M5: Documentation & Release Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Milestone 5 from `project-ideas/clispark.plan.md` — add `ARCHITECTURE.md` generation to scaffolded projects, and build a fully automated release pipeline for clispark itself: Conventional-Commits-driven version bumping, a release-triggered npm publish, and security-audit gating with GitHub issue tracking.

**Architecture:** `templates/base/ARCHITECTURE.md` is a static template file copied and placeholder-replaced by `copyTemplate()` exactly like `README.md`. Three GitHub Actions workflows automate the release process: `ci.yml` (reusable, runs tests/typecheck/build/audit/scaffold-smoke-test on every push/PR and via `workflow_call`), `release-please.yml` (maintains a running release PR via `googleapis/release-please-action`, driven by this repo's existing Conventional Commit convention), and `publish.yml` (triggered by `release: published`, calls `ci.yml` as a reusable workflow then runs `npm publish`). `scripts/audit-issues.mjs` reads `npm audit`'s JSON output and syncs two label-based GitHub issues (one for blocking high/critical findings, one for informational moderate/low findings) via an injectable `gh` CLI dependency, mirroring the `ScaffoldDeps.runCommand` injection pattern already used in `src/scaffold.ts`.

**Tech Stack:** TypeScript, vitest 4 (upgraded from 2 in this milestone), GitHub Actions, `googleapis/release-please-action@v5`, `actions/checkout@v7`, `actions/setup-node@v6`, GitHub CLI (`gh`, preinstalled on GitHub-hosted runners).

## Global Constraints

- Project language is English (code, comments, docs, commit messages, workflow YAML).
- Full design context: `docs/superpowers/specs/2026-07-11-clispark-m5-docs-and-release-design.md`.
- `templates/base`'s own `vitest` dependency is a **separate** dependency tree (what generated projects use) and must NOT be touched by the vitest upgrade in this plan — only clispark's own root `package.json` gets the vitest 2→4 bump.
- The blocking audit gate (`npm audit --audit-level=high`) covers **all** dependencies (not `--omit=dev`) — this was an explicit choice during brainstorming, which is *why* the vitest upgrade is a prerequisite (the current 2.x chain has 1 critical + 1 high finding; `--omit=dev` is already clean today but that is not the chosen design).
- Automatic GitHub issue creation/update/close for audit findings must run **only** on `push` events (`github.event_name == 'push'`), never on `pull_request` events — to avoid issue-spam from in-progress branches. The blocking audit gate itself runs on every event unconditionally.
- Exactly two issue "classes" exist: blocking (severity high/critical, label `security-audit-blocking`) and informational (severity moderate/low, label `security-audit-info`). Never more than one open issue per class — search for an existing open issue with the class's label before creating a new one; update/comment on it if found, close it if the current audit run is clean for that class.
- `gh` CLI calls inside `scripts/audit-issues.mjs` must be injectable (a `runGh` dependency), so unit tests never invoke a real `gh` process — this environment does not have `gh` installed locally, and CI's real `gh` (preinstalled on GitHub-hosted runners) is only exercised by the actual workflow run, not by the unit suite.
- No changes to `runCommand`/`ScaffoldDeps` in `src/scaffold.ts` beyond what's needed to add `ARCHITECTURE.md` to the existing placeholder-replacement list.

---

### Task 1: `ARCHITECTURE.md` Template

**Files:**
- Create: `templates/base/ARCHITECTURE.md`
- Modify: `src/scaffold.ts`
- Modify: `src/scaffold.test.ts`

**Interfaces:**
- None new — reuses the existing `replacePlaceholder(filePath, projectName)` helper already defined in `src/scaffold.ts`.

- [ ] **Step 1: Write `templates/base/ARCHITECTURE.md`**

```markdown
# {{projectName}} Architecture

This document explains the conventions this project was generated with, so the automatic behavior (command discovery, logging, error handling) doesn't feel like unexplained magic.

## Commands

Every command lives in `src/commands/` and extends `BaseCommand` (`src/base-command.ts`) instead of oclif's own `Command` class directly:

```ts
import { BaseCommand } from '../base-command.js';

export default class MyCommand extends BaseCommand {
  static description = 'What this command does';
  static args = {};
  static flags = {};

  async run(): Promise<void> {
    await this.parse(MyCommand);
    // ...
  }
}
```

`BaseCommand` overrides oclif's `init()`/`catch()`/`finally()` lifecycle methods to log every command's start, failure, and completion automatically — no manual logging calls needed inside `run()`.

## Command Discovery

oclif discovers commands at runtime from the `oclif.commands` path in `package.json` (`./dist/commands`) — there is no custom filesystem-scanning code. Dropping a new file in `src/commands/` and building the project is enough for oclif to pick it up; nothing needs to be manually registered.

## Logging

`src/logger.ts` writes structured JSON logs via `pino`, one file per command invocation, to an OS-appropriate log directory (via `env-paths`) — never to the project's own working directory. Every log line includes the command name. On failure, the full error (including stack trace) is logged, while the terminal only ever shows a clean `Error: <message>` — never a raw stack trace.

## Testing

Tests use `@oclif/test`'s `runCommand()` helper and live next to the command they test (e.g. `src/commands/hello.test.ts`). Running `npm test` first runs a build (via the `pretest` script) — `runCommand()` reads compiled output from `dist/commands`, so a stale or missing build produces empty, unhelpful output instead of a clear error. Every command's `run()` must call `await this.parse(<CommandClass>)`, even with no flags/args, to avoid an oclif `UnparsedCommand` warning.
```

- [ ] **Step 2: Write the failing test**

Add this assertion to the existing `'copies all template files into a new target directory, replacing {{projectName}}'` test in `src/scaffold.test.ts`, right after the existing `helloTestTs` assertion block:

```ts
    const architectureMd = await readFile(path.join(targetDir, 'ARCHITECTURE.md'), 'utf8');
    expect(architectureMd).toContain('# my-cli Architecture');
    expect(architectureMd).not.toContain('{{projectName}}');
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/scaffold.test.ts`
Expected: FAIL — `ARCHITECTURE.md` doesn't exist yet in the copied template output (the file itself doesn't exist in `templates/base/` at test-run time unless Step 1 was already done; if Step 1 was done first, the failure is specifically the un-replaced `{{projectName}}` placeholder, since `copyTemplate()` doesn't yet know about this file).

- [ ] **Step 4: Wire the placeholder replacement into `src/scaffold.ts`**

Change:

```ts
  await replacePlaceholder(path.join(targetDir, 'package.json'), projectName);
  await replacePlaceholder(path.join(targetDir, 'README.md'), projectName);
  await replacePlaceholder(path.join(targetDir, 'src', 'logger.ts'), projectName);
```

to:

```ts
  await replacePlaceholder(path.join(targetDir, 'package.json'), projectName);
  await replacePlaceholder(path.join(targetDir, 'README.md'), projectName);
  await replacePlaceholder(path.join(targetDir, 'src', 'logger.ts'), projectName);
  await replacePlaceholder(path.join(targetDir, 'ARCHITECTURE.md'), projectName);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/scaffold.test.ts`
Expected: PASS (9 tests: the 8 from Milestones 1-4 plus this new assertion inside the existing first test — not a new `it()` block, so the test count doesn't change, only the assertions within it grow)

- [ ] **Step 6: Commit**

```bash
git add templates/base/ARCHITECTURE.md src/scaffold.ts src/scaffold.test.ts
git commit -m "feat: generate ARCHITECTURE.md explaining scaffolded-project conventions"
```

---

### Task 2: Vitest v4 Upgrade

**Files:**
- Modify: `package.json`

**Interfaces:**
- None — this task only changes a dependency version and verifies existing behavior still holds.

- [ ] **Step 1: Bump the dependency**

In `package.json`, change:

```json
    "vitest": "^2.1.8"
```

to:

```json
    "vitest": "^4.1.10"
```

(This line is in `devDependencies` in clispark's own root `package.json` — do NOT touch `templates/base/package.json`, which has its own separate `"vitest": "^2.1.8"` entry for generated projects; that stays unchanged.)

- [ ] **Step 2: Install and run the full suite**

Run:
```bash
npm install
npx vitest run
```
Expected: `npm install` succeeds. Vitest 4's `configDefaults.exclude` and `disableConsoleIntercept` (both used in `vitest.config.ts`) are unchanged in v4's config type (verified empirically against the published `vitest@4.1.10` type declarations during planning) — the existing 25 tests are expected to PASS unchanged. If any test or config option fails specifically because of a v4 behavior change, investigate the actual error message and fix the specific incompatibility (do not guess — read the failure output) before proceeding.

- [ ] **Step 3: Run typecheck and build to confirm nothing else broke**

Run:
```bash
npx tsc --noEmit
npx tsup
```
Expected: both succeed with no errors.

- [ ] **Step 4: Verify the audit gate is now clean**

Run: `npm audit --audit-level=high`
Expected: exit code 0, no output about high/critical vulnerabilities (the previous 1 critical + 1 high were both in the `vitest`→`vite`→`esbuild` 2.x chain; the v4 upgrade removes that dependency chain entirely).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: upgrade vitest to v4 to clear high/critical audit findings"
```

---

### Task 3: `scripts/audit-issues.mjs`

**Files:**
- Create: `scripts/audit-issues.mjs`
- Create: `scripts/audit-issues.test.mjs`
- Create: `scripts/fixtures/audit-clean.json`
- Create: `scripts/fixtures/audit-with-findings.json`

**Interfaces:**
- Produces: `categorizeFindings(auditReport)` → `{ blocking: { count: number, packages: string[] }, informational: { count: number, packages: string[] } }`
- Produces: `async function syncIssueForClass(options, deps)` where `options = { label: string, title: string, isClean: boolean, bodyIfFindings: string, bodyIfClean: string }` and `deps = { runGh: (args: string[]) => Promise<string> }`
- Consumed by: Task 4's `ci.yml` (as a CLI script: `node scripts/audit-issues.mjs`, reading `npm audit`'s output itself and using the real `gh` CLI)

- [ ] **Step 1: Write the fixture files**

Create `scripts/fixtures/audit-clean.json`:

```json
{
  "auditReportVersion": 2,
  "vulnerabilities": {},
  "metadata": {
    "vulnerabilities": {
      "info": 0,
      "low": 0,
      "moderate": 0,
      "high": 0,
      "critical": 0,
      "total": 0
    }
  }
}
```

Create `scripts/fixtures/audit-with-findings.json`:

```json
{
  "auditReportVersion": 2,
  "vulnerabilities": {
    "example-critical-pkg": {
      "name": "example-critical-pkg",
      "severity": "critical",
      "isDirect": false,
      "range": "<1.0.0",
      "nodes": ["node_modules/example-critical-pkg"]
    },
    "example-moderate-pkg": {
      "name": "example-moderate-pkg",
      "severity": "moderate",
      "isDirect": false,
      "range": "<2.0.0",
      "nodes": ["node_modules/example-moderate-pkg"]
    }
  },
  "metadata": {
    "vulnerabilities": {
      "info": 0,
      "low": 0,
      "moderate": 1,
      "high": 0,
      "critical": 1,
      "total": 2
    }
  }
}
```

- [ ] **Step 2: Write the failing tests**

Create `scripts/audit-issues.test.mjs`:

```js
import { describe, it, expect, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { categorizeFindings, syncIssueForClass } from './audit-issues.mjs';

const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

async function loadFixture(name) {
  return JSON.parse(await readFile(path.join(FIXTURES_DIR, name), 'utf8'));
}

describe('categorizeFindings', () => {
  it('returns zero counts and empty package lists for a clean audit', async () => {
    const report = await loadFixture('audit-clean.json');

    const result = categorizeFindings(report);

    expect(result).toEqual({
      blocking: { count: 0, packages: [] },
      informational: { count: 0, packages: [] },
    });
  });

  it('buckets critical/high as blocking and moderate/low as informational', async () => {
    const report = await loadFixture('audit-with-findings.json');

    const result = categorizeFindings(report);

    expect(result.blocking.count).toBe(1);
    expect(result.blocking.packages).toEqual(['example-critical-pkg (critical)']);
    expect(result.informational.count).toBe(1);
    expect(result.informational.packages).toEqual(['example-moderate-pkg (moderate)']);
  });
});

describe('syncIssueForClass', () => {
  it('creates a new issue when findings exist and no open issue is found', async () => {
    const calls = [];
    const runGh = vi.fn(async (args) => {
      calls.push(args);
      if (args[0] === 'issue' && args[1] === 'list') return '[]';
      return '';
    });

    await syncIssueForClass(
      {
        label: 'security-audit-blocking',
        title: 'Blocking security audit findings',
        isClean: false,
        bodyIfFindings: 'Found: example-critical-pkg (critical)',
        bodyIfClean: 'All clear.',
      },
      { runGh },
    );

    expect(calls).toEqual([
      ['issue', 'list', '--label', 'security-audit-blocking', '--state', 'open', '--json', 'number'],
      [
        'issue',
        'create',
        '--title',
        'Blocking security audit findings',
        '--body',
        'Found: example-critical-pkg (critical)',
        '--label',
        'security-audit-blocking',
      ],
    ]);
  });

  it('comments on the existing open issue instead of creating a duplicate', async () => {
    const calls = [];
    const runGh = vi.fn(async (args) => {
      calls.push(args);
      if (args[0] === 'issue' && args[1] === 'list') return '[{"number": 42}]';
      return '';
    });

    await syncIssueForClass(
      {
        label: 'security-audit-blocking',
        title: 'Blocking security audit findings',
        isClean: false,
        bodyIfFindings: 'Found: example-critical-pkg (critical)',
        bodyIfClean: 'All clear.',
      },
      { runGh },
    );

    expect(calls).toEqual([
      ['issue', 'list', '--label', 'security-audit-blocking', '--state', 'open', '--json', 'number'],
      ['issue', 'comment', '42', '--body', 'Found: example-critical-pkg (critical)'],
    ]);
  });

  it('closes the existing open issue when the current run is clean', async () => {
    const calls = [];
    const runGh = vi.fn(async (args) => {
      calls.push(args);
      if (args[0] === 'issue' && args[1] === 'list') return '[{"number": 7}]';
      return '';
    });

    await syncIssueForClass(
      {
        label: 'security-audit-blocking',
        title: 'Blocking security audit findings',
        isClean: true,
        bodyIfFindings: 'Found: example-critical-pkg (critical)',
        bodyIfClean: 'All clear.',
      },
      { runGh },
    );

    expect(calls).toEqual([
      ['issue', 'list', '--label', 'security-audit-blocking', '--state', 'open', '--json', 'number'],
      ['issue', 'close', '7', '--comment', 'All clear.'],
    ]);
  });

  it('does nothing when the run is clean and there is no open issue', async () => {
    const calls = [];
    const runGh = vi.fn(async (args) => {
      calls.push(args);
      if (args[0] === 'issue' && args[1] === 'list') return '[]';
      return '';
    });

    await syncIssueForClass(
      {
        label: 'security-audit-blocking',
        title: 'Blocking security audit findings',
        isClean: true,
        bodyIfFindings: 'Found: example-critical-pkg (critical)',
        bodyIfClean: 'All clear.',
      },
      { runGh },
    );

    expect(calls).toEqual([
      ['issue', 'list', '--label', 'security-audit-blocking', '--state', 'open', '--json', 'number'],
    ]);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run scripts/audit-issues.test.mjs`
Expected: FAIL — `./audit-issues.mjs` does not exist yet.

- [ ] **Step 4: Write `scripts/audit-issues.mjs`**

```js
// scripts/audit-issues.mjs
import { execSync, execFileSync } from 'node:child_process';

export function categorizeFindings(auditReport) {
  const counts = auditReport.metadata?.vulnerabilities ?? {};
  const blockingCount = (counts.critical ?? 0) + (counts.high ?? 0);
  const informationalCount = (counts.moderate ?? 0) + (counts.low ?? 0);

  const blockingPackages = [];
  const informationalPackages = [];

  for (const [name, finding] of Object.entries(auditReport.vulnerabilities ?? {})) {
    if (finding.severity === 'critical' || finding.severity === 'high') {
      blockingPackages.push(`${name} (${finding.severity})`);
    } else if (finding.severity === 'moderate' || finding.severity === 'low') {
      informationalPackages.push(`${name} (${finding.severity})`);
    }
  }

  return {
    blocking: { count: blockingCount, packages: blockingPackages },
    informational: { count: informationalCount, packages: informationalPackages },
  };
}

export async function syncIssueForClass(options, deps) {
  const { label, title, isClean, bodyIfFindings, bodyIfClean } = options;
  const { runGh } = deps;

  const listOutput = await runGh(['issue', 'list', '--label', label, '--state', 'open', '--json', 'number']);
  const openIssues = JSON.parse(listOutput);
  const existingNumber = openIssues[0]?.number;

  if (isClean) {
    if (existingNumber !== undefined) {
      await runGh(['issue', 'close', String(existingNumber), '--comment', bodyIfClean]);
    }
    return;
  }

  if (existingNumber !== undefined) {
    await runGh(['issue', 'comment', String(existingNumber), '--body', bodyIfFindings]);
  } else {
    await runGh(['issue', 'create', '--title', title, '--body', bodyIfFindings, '--label', label]);
  }
}

function runNpmAudit() {
  try {
    const output = execSync('npm audit --json', { encoding: 'utf8' });
    return JSON.parse(output);
  } catch (error) {
    if (error.stdout) return JSON.parse(error.stdout);
    throw error;
  }
}

async function realRunGh(args) {
  return execFileSync('gh', args, { encoding: 'utf8' });
}

function buildBody(packages, runUrl) {
  const list = packages.length > 0 ? packages.map((p) => `- ${p}`).join('\n') : '(none)';
  return `${list}\n\nFrom: ${runUrl}`;
}

async function main() {
  const report = runNpmAudit();
  const { blocking, informational } = categorizeFindings(report);
  const runUrl = process.env.GITHUB_RUN_URL ?? '(unknown run)';

  await syncIssueForClass(
    {
      label: 'security-audit-blocking',
      title: 'npm audit: blocking (high/critical) findings',
      isClean: blocking.count === 0,
      bodyIfFindings: buildBody(blocking.packages, runUrl),
      bodyIfClean: `Clean as of ${runUrl}`,
    },
    { runGh: realRunGh },
  );

  await syncIssueForClass(
    {
      label: 'security-audit-info',
      title: 'npm audit: informational (moderate/low) findings',
      isClean: informational.count === 0,
      bodyIfFindings: buildBody(informational.packages, runUrl),
      bodyIfClean: `Clean as of ${runUrl}`,
    },
    { runGh: realRunGh },
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run scripts/audit-issues.test.mjs`
Expected: PASS (6 tests: 2 from `categorizeFindings`, 4 from `syncIssueForClass`)

- [ ] **Step 6: Run the full suite to confirm nothing else broke**

Run: `npx vitest run`
Expected: PASS (all tests across `src/` and `scripts/`, total count grows by 6 plus Task 1's addition)

- [ ] **Step 7: Commit**

```bash
git add scripts/audit-issues.mjs scripts/audit-issues.test.mjs scripts/fixtures/audit-clean.json scripts/fixtures/audit-with-findings.json
git commit -m "feat: add audit-issues script to track npm audit findings as GitHub issues"
```

---

### Task 4: `ci.yml` Workflow

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `scripts/audit-issues.mjs` (Task 3, run as `node scripts/audit-issues.mjs`)
- Produces: a reusable workflow (via `on.workflow_call`) that Task 6's `publish.yml` invokes with `uses: ./.github/workflows/ci.yml`

- [ ] **Step 1: Write `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [master]
  pull_request:
  workflow_call:

permissions:
  contents: read

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v6
        with:
          node-version: 18
      - run: npm ci
      - run: npx tsc --noEmit
      - run: npx vitest run
      - run: npx tsup

  audit:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      issues: write
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v6
        with:
          node-version: 18
      - run: npm ci
      - name: Security audit (blocking gate)
        run: npm audit --audit-level=high
      - name: Sync security audit issues
        if: (success() || failure()) && github.event_name == 'push'
        run: node scripts/audit-issues.mjs
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          GITHUB_RUN_URL: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}

  scaffold-smoke:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v6
        with:
          node-version: 18
      - run: npm ci
      - name: Scaffold a real project and verify it builds and tests itself
        run: |
          cat > ci-smoke-verify.mjs << 'EOF'
          import { scaffoldProject } from './src/scaffold.js';
          import path from 'node:path';
          import os from 'node:os';

          const targetDir = path.join(os.tmpdir(), 'clispark-ci-smoke', 'smoke-test-cli');
          await scaffoldProject({ projectName: 'smoke-test-cli', targetDir });
          console.log('scaffold complete:', targetDir);
          EOF
          npx tsx ci-smoke-verify.mjs
          rm ci-smoke-verify.mjs
      - name: Run the generated project's own test suite
        run: |
          cd "$(node -e "console.log(require('os').tmpdir())")/clispark-ci-smoke/smoke-test-cli"
          npm test
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "feat: add ci.yml workflow (test, audit gate, scaffold smoke test)"
```

(Verification of this workflow actually running on GitHub Actions happens in Task 7 — a workflow YAML file cannot be meaningfully unit-tested locally.)

---

### Task 5: `release-please.yml` Workflow

**Files:**
- Create: `.github/workflows/release-please.yml`

**Interfaces:**
- None — standalone workflow, triggers independently of `ci.yml`.

- [ ] **Step 1: Write `.github/workflows/release-please.yml`**

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
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/release-please.yml
git commit -m "feat: add release-please.yml for automatic Conventional-Commits version bumping"
```

(This workflow only fires on a push to `master`, so it cannot be exercised until after this branch merges — this is expected and matches the design's note that the very first publish still needs manual confirmation. No dedicated verification task for this workflow beyond Task 7's note.)

---

### Task 6: `publish.yml` Workflow

**Files:**
- Create: `.github/workflows/publish.yml`

**Interfaces:**
- Consumes: `.github/workflows/ci.yml` (Task 4) as a reusable workflow via `uses: ./.github/workflows/ci.yml`

- [ ] **Step 1: Write `.github/workflows/publish.yml`**

```yaml
name: Publish

on:
  release:
    types: [published]

jobs:
  verify:
    uses: ./.github/workflows/ci.yml
    secrets: inherit

  publish:
    needs: verify
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v6
        with:
          node-version: 18
          registry-url: 'https://registry.npmjs.org'
      - run: npm ci
      - run: npm publish
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/publish.yml
git commit -m "feat: add publish.yml to npm-publish on GitHub release"
```

(This workflow only fires on a published GitHub Release, and needs the `NPM_TOKEN` secret the user sets up manually per the design's "Manual Prerequisites" section — cannot be exercised until the real first release. No dedicated verification task for this workflow beyond Task 7's note.)

---

### Task 7: Empirical Verification of `ci.yml`

**Files:**
- Temporarily modify: `.github/workflows/ci.yml` (reverted at the end of this task)

**Interfaces:**
- None — verification only.

`gh` CLI is not installed in this environment — use the public GitHub REST API via `curl` instead (unauthenticated reads work for this public repository, confirmed during planning).

- [ ] **Step 1: Temporarily add this branch to the push trigger**

`ci.yml`'s `on.push.branches` currently only lists `master`, so pushing this feature branch alone would not trigger a run. Temporarily change:

```yaml
on:
  push:
    branches: [master]
```

to:

```yaml
on:
  push:
    branches: [master, worktree-m5-docs-and-release]
```

- [ ] **Step 2: Commit and push this branch**

```bash
git add .github/workflows/ci.yml
git commit -m "test: temporarily trigger ci.yml on this branch for verification"
git push -u origin worktree-m5-docs-and-release
```

- [ ] **Step 3: Poll for the workflow run and confirm it completes**

Run (repeat with a short pause between attempts until `status` is `completed`; GitHub Actions runs typically take a few minutes, budget up to ~10 minutes total):

```bash
curl -s "https://api.github.com/repos/martinwichner/clispark/actions/runs?branch=worktree-m5-docs-and-release&per_page=1" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d);const r=j.workflow_runs[0];console.log(r ? \`\${r.status} \${r.conclusion} \${r.html_url}\` : 'no run found yet');})"
```

Expected: eventually prints `completed success <url>`. If it prints `completed failure <run_id_from_url>`, take the numeric run ID from the printed URL (e.g. `.../actions/runs/123456789` → `123456789`) and run:

```bash
curl -s "https://api.github.com/repos/martinwichner/clispark/actions/runs/<RUN_ID>/jobs" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d);j.jobs.forEach(job=>{console.log('JOB:', job.name, job.conclusion);job.steps.forEach(s=>console.log('  STEP:', s.name, s.conclusion));});})"
```

This prints every job and step with its conclusion, so you can identify exactly which step failed. Diagnose the actual failure (in `ci.yml` or the underlying script/code it runs), fix it, commit, push again, and re-poll from Step 3.

- [ ] **Step 4: Revert the temporary trigger-branch addition**

Change `.github/workflows/ci.yml` back to:

```yaml
on:
  push:
    branches: [master]
```

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "test: revert temporary ci.yml branch trigger used for verification"
```

- [ ] **Step 6: Run the full local test suite one more time as a final sanity check**

Run: `npx vitest run`
Expected: PASS, same test count as after Task 3 plus Task 1's addition (no regressions from the workflow-only changes in this task).

---

### Task 8: Push to GitHub

**Files:**
- None (repository-level operation only)

**Interfaces:**
- None

- [ ] **Step 1: Verify remote and branch**

Run: `git remote -v && git branch --show-current`
Expected: `origin` points to `git@github.com:martinwichner/clispark.git`.

- [ ] **Step 2: Push**

Run: `git push`
Expected: pushes all M5 commits (after this branch has been merged into `master`, per the project's established workflow — merge happens outside this plan, in the main session, same as Milestones 1-4).

- [ ] **Step 3: Verify on GitHub**

Run: `git log --oneline -1` and compare against the GitHub repo's latest commit to confirm the push landed.

**Note for the controller (not a subagent step):** After this merge, the real `release-please.yml` will fire on the `master` push for the first time. Review the release PR it opens before merging it — merging it will create the first git tag + GitHub Release, which in turn fires `publish.yml`. The user must have `NPM_TOKEN` set as a repository secret *before* that release PR is merged, since `publish.yml` will otherwise fail at the `npm publish` step (a failed publish is safe/non-destructive, but confirm the secret exists first per the design's "Manual Prerequisites" section).
