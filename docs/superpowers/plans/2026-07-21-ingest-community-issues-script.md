# Community Issue Ingestion Script Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `project-ideas/ingest-community-issues.mjs`, a manually-run local script that finds GitHub issues on `martinwichner/clispark` opened by someone other than the maintainer, appends them to a new "Community-Vorschläge" section in `project-ideas/clispark.plan.md`, and marks them `triaged` on GitHub so they aren't picked up again.

**Architecture:** A pure core (issue filtering, entry formatting, plan-text insertion) with zero I/O, fully unit-testable via Node's built-in test runner — plus a thin shell that shells out to the `gh` CLI (mirroring `scripts/audit-issues.ts`'s `execFileSync` pattern from the `clispark` repo) and reads/writes the plan file. No new dependencies; plain ESM `.mjs`, no build step.

**Tech Stack:** Node.js built-ins only — `node:child_process` (`execFileSync`), `node:fs`, `node:path`, `node:url`, `node:test` + `node:assert/strict` for tests. Requires the `gh` CLI to be installed and authenticated (already a standing requirement for this whole workflow).

## Global Constraints

- This script and its test file live in `project-ideas/`, **not** inside the `clispark` git repository — `project-ideas/` is confirmed not to be a git repository (`git status` there returns "fatal: not a git repository"). **No `git add`/`git commit` steps in this plan** — every "save" step is a plain file write.
- Repo to query: `martinwichner/clispark` (hardcoded — this script is a personal tool for this one repo, not a generic reusable tool).
- Maintainer whitelist: exactly the string `martinwichner` (`author.login` from `gh issue list --json`).
- Idempotency marker: the GitHub label `triaged` (already created on the repo). An issue with this label is never picked up again.
- New labels applied to a newly-ingested issue: `source:community` and `triaged` (both already exist on the repo — created directly via `gh label create` as part of the design's §1/§2 rollout, no need to create them here).
- Target file: `project-ideas/clispark.plan.md`, resolved relative to the script's own location (`path.dirname(fileURLToPath(import.meta.url))`), not the process's current working directory — so the script works regardless of where it's invoked from.
- New section header to insert/append to: `### Community-Vorschläge (noch nicht bewertet)`, placed immediately before the `## Offene Fragen / Entscheidungen` top-level section (verified today: `M13` section starts at line 262, `## Offene Fragen / Entscheidungen` immediately follows at line 278 — the new section belongs between them, i.e. as the last subsection of the M13-and-related backlog material).
- Entry line format: `- [ ] #<number> **<title>** von @<author>, erkannt am <YYYY-MM-DD> — <url>`.
- Testing escape hatch: environment variable `INGEST_TEST_INCLUDE_SELF=1` disables the maintainer-whitelist check only (the `triaged` check still applies). This is permanent, not removed after this plan's own verification — the maintainer has no second GitHub account and will need it again for future changes to this script.
- The script only ever adds labels; it never edits an issue's title, body, or state (open/closed).

---

## File Structure

```
project-ideas/
  ingest-community-issues.mjs        # CREATE — the script (pure core + gh/file shell + main())
  ingest-community-issues.test.mjs   # CREATE — node:test unit tests for the pure core
```

---

### Task 1: Pure core — filtering, formatting, and plan-text insertion

**Files:**
- Create: `project-ideas/ingest-community-issues.mjs` (pure functions only in this task; `main()`/`gh`/file I/O land in Task 2)
- Test: `project-ideas/ingest-community-issues.test.mjs`

**Interfaces:**
- Produces: `MAINTAINER` (string constant, `'martinwichner'`), `SECTION_HEADER` (string constant, `'### Community-Vorschläge (noch nicht bewertet)'`), `filterNewCommunityIssues(issues, options)`, `formatEntry(issue, dateStr)`, `appendToPlan(planText, newEntries)`.

- [ ] **Step 1: Write the failing tests**

Create `project-ideas/ingest-community-issues.test.mjs`:

```js
// project-ideas/ingest-community-issues.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterNewCommunityIssues, formatEntry, appendToPlan, SECTION_HEADER } from './ingest-community-issues.mjs';

test('filterNewCommunityIssues excludes maintainer-authored issues by default', () => {
  const issues = [
    { number: 1, title: 'Mine', author: { login: 'martinwichner' }, labels: [] },
    { number: 2, title: 'Theirs', author: { login: 'someone-else' }, labels: [] },
  ];
  const result = filterNewCommunityIssues(issues);
  assert.deepEqual(result.map((i) => i.number), [2]);
});

test('filterNewCommunityIssues excludes already-triaged issues', () => {
  const issues = [
    { number: 3, title: 'Already seen', author: { login: 'someone-else' }, labels: [{ name: 'triaged' }] },
    { number: 4, title: 'New', author: { login: 'someone-else' }, labels: [{ name: 'bug' }] },
  ];
  const result = filterNewCommunityIssues(issues);
  assert.deepEqual(result.map((i) => i.number), [4]);
});

test('filterNewCommunityIssues with includeSelf still excludes triaged, but keeps maintainer-authored', () => {
  const issues = [
    { number: 5, title: 'Mine, triaged', author: { login: 'martinwichner' }, labels: [{ name: 'triaged' }] },
    { number: 6, title: 'Mine, not triaged', author: { login: 'martinwichner' }, labels: [] },
  ];
  const result = filterNewCommunityIssues(issues, { includeSelf: true });
  assert.deepEqual(result.map((i) => i.number), [6]);
});

test('filterNewCommunityIssues handles missing author/labels gracefully', () => {
  const issues = [{ number: 7, title: 'Weird payload', author: null, labels: undefined }];
  const result = filterNewCommunityIssues(issues);
  assert.deepEqual(result.map((i) => i.number), [7]);
});

test('formatEntry produces the expected checklist line', () => {
  const issue = { number: 42, title: 'Add dark mode', author: { login: 'octocat' }, url: 'https://github.com/martinwichner/clispark/issues/42' };
  const line = formatEntry(issue, '2026-07-21');
  assert.equal(
    line,
    '- [ ] #42 **Add dark mode** von @octocat, erkannt am 2026-07-21 — https://github.com/martinwichner/clispark/issues/42',
  );
});

test('formatEntry falls back to "unknown" when author is missing', () => {
  const issue = { number: 43, title: 'No author', author: null, url: 'https://example.com/43' };
  const line = formatEntry(issue, '2026-07-21');
  assert.match(line, /von @unknown,/);
});

test('appendToPlan inserts a new section before "## Offene Fragen" when the section does not exist yet', () => {
  const planText = [
    '### M13 (später): Feature-Backlog',
    '',
    '- [ ] Some backlog item.',
    '',
    '## Offene Fragen / Entscheidungen',
    '- Some open question.',
    '',
  ].join('\n');
  const result = appendToPlan(planText, ['- [ ] #1 **New idea** von @octocat, erkannt am 2026-07-21 — https://x/1']);
  assert.ok(result.includes(SECTION_HEADER));
  const headerIndex = result.indexOf(SECTION_HEADER);
  const offeneFragenIndex = result.indexOf('## Offene Fragen / Entscheidungen');
  assert.ok(headerIndex < offeneFragenIndex, 'new section must appear before "## Offene Fragen"');
  assert.ok(result.includes('- [ ] #1 **New idea**'));
});

test('appendToPlan appends to an existing section instead of duplicating the header', () => {
  const planText = [
    '### M13 (später): Feature-Backlog',
    '',
    '### Community-Vorschläge (noch nicht bewertet)',
    '',
    '- [ ] #1 **Existing entry** von @octocat, erkannt am 2026-07-20 — https://x/1',
    '',
    '## Offene Fragen / Entscheidungen',
    '',
  ].join('\n');
  const result = appendToPlan(planText, ['- [ ] #2 **New entry** von @someone, erkannt am 2026-07-21 — https://x/2']);
  const headerCount = result.split(SECTION_HEADER).length - 1;
  assert.equal(headerCount, 1, 'section header must not be duplicated');
  assert.ok(result.includes('- [ ] #1 **Existing entry**'));
  assert.ok(result.includes('- [ ] #2 **New entry**'));
});

test('appendToPlan returns the text unchanged when there are no new entries', () => {
  const planText = '### M13 (später): Feature-Backlog\n\n## Offene Fragen / Entscheidungen\n';
  const result = appendToPlan(planText, []);
  assert.equal(result, planText);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test project-ideas/ingest-community-issues.test.mjs`
Expected: FAIL — `Cannot find module './ingest-community-issues.mjs'` (or all tests erroring for the same reason).

- [ ] **Step 3: Implement the pure core**

Create `project-ideas/ingest-community-issues.mjs`:

```js
// project-ideas/ingest-community-issues.mjs
export const MAINTAINER = 'martinwichner';
export const SECTION_HEADER = '### Community-Vorschläge (noch nicht bewertet)';
const NEXT_SECTION_MARKER = '## Offene Fragen / Entscheidungen';

export function filterNewCommunityIssues(issues, { includeSelf = false } = {}) {
  return issues.filter((issue) => {
    const isMaintainer = issue.author?.login === MAINTAINER;
    if (isMaintainer && !includeSelf) return false;
    const labelNames = (issue.labels ?? []).map((label) => label.name);
    if (labelNames.includes('triaged')) return false;
    return true;
  });
}

export function formatEntry(issue, dateStr) {
  const author = issue.author?.login ?? 'unknown';
  return `- [ ] #${issue.number} **${issue.title}** von @${author}, erkannt am ${dateStr} — ${issue.url}`;
}

export function appendToPlan(planText, newEntries) {
  if (newEntries.length === 0) return planText;
  const entryBlock = newEntries.join('\n');

  const headerIndex = planText.indexOf(SECTION_HEADER);
  if (headerIndex !== -1) {
    const afterHeader = headerIndex + SECTION_HEADER.length;
    const insertAt = planText.slice(afterHeader, afterHeader + 2) === '\n\n' ? afterHeader + 2 : afterHeader + 1;
    return `${planText.slice(0, insertAt)}${entryBlock}\n${planText.slice(insertAt)}`;
  }

  const nextSectionIndex = planText.indexOf(NEXT_SECTION_MARKER);
  if (nextSectionIndex === -1) {
    return `${planText.trimEnd()}\n\n${SECTION_HEADER}\n\n${entryBlock}\n`;
  }
  const insertion = `${SECTION_HEADER}\n\n${entryBlock}\n\n`;
  return planText.slice(0, nextSectionIndex) + insertion + planText.slice(nextSectionIndex);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test project-ideas/ingest-community-issues.test.mjs`
Expected: PASS (9 tests).

- [ ] **Step 5: Save**

No git commit — `project-ideas/` is not a git repository. The files are already saved on disk from Step 1/3; nothing further to do here.

---

### Task 2: `gh`/file I/O shell and `main()`

**Files:**
- Modify: `project-ideas/ingest-community-issues.mjs` (add the shell layer below the pure core from Task 1)

**Interfaces:**
- Consumes: `MAINTAINER`, `SECTION_HEADER`, `filterNewCommunityIssues`, `formatEntry`, `appendToPlan` (Task 1, same file).
- Produces: a runnable CLI entry point (`node project-ideas/ingest-community-issues.mjs`). No new exports needed beyond Task 1's.

- [ ] **Step 1: Append the shell layer**

Add to the end of `project-ideas/ingest-community-issues.mjs` (after the Task 1 code, before nothing — this is the new end of the file):

```js
// --- Shell (gh CLI + file I/O) ---
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = 'martinwichner/clispark';
const PLAN_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'clispark.plan.md');

function runGh(args) {
  return execFileSync('gh', args, { encoding: 'utf8' });
}

function main() {
  const includeSelf = process.env.INGEST_TEST_INCLUDE_SELF === '1';

  const listOutput = runGh([
    'issue',
    'list',
    '--repo',
    REPO,
    '--state',
    'open',
    '--json',
    'number,title,url,author,labels',
  ]);
  const issues = JSON.parse(listOutput);
  const newIssues = filterNewCommunityIssues(issues, { includeSelf });

  if (newIssues.length === 0) {
    console.log('No new community issues found.');
    return;
  }

  const dateStr = new Date().toISOString().slice(0, 10);
  const entries = newIssues.map((issue) => formatEntry(issue, dateStr));

  const planText = readFileSync(PLAN_FILE, 'utf8');
  writeFileSync(PLAN_FILE, appendToPlan(planText, entries));

  for (const issue of newIssues) {
    runGh([
      'issue',
      'edit',
      String(issue.number),
      '--repo',
      REPO,
      '--add-label',
      'source:community',
      '--add-label',
      'triaged',
    ]);
  }

  console.log(`Found ${newIssues.length} new community issue(s), appended to plan.md, labeled on GitHub.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
```

- [ ] **Step 2: Re-run the Task 1 unit tests to confirm the shell addition didn't break the pure core's exports**

Run: `node --test project-ideas/ingest-community-issues.test.mjs`
Expected: PASS (9 tests) — the shell code isn't imported by the test file, so this mainly confirms the file still parses and the earlier exports are untouched.

- [ ] **Step 3: Save**

No git commit (see Global Constraints).

---

### Task 3: Real end-to-end verification against the live repo

**Files:** none (verification only).

- [ ] **Step 1: Verify the "nothing to do" path against real current repo state**

Back up the plan file first so the "unchanged" claim below is checkable rather than eyeballed:

```bash
cp project-ideas/clispark.plan.md project-ideas/clispark.plan.md.bak
```

Run: `node project-ideas/ingest-community-issues.mjs`
Expected output: `No new community issues found.` — every currently open issue (#12, #65–#71) is maintainer-authored, so with `includeSelf` defaulted to `false` all of them are correctly excluded.

Verify no change: `diff project-ideas/clispark.plan.md project-ideas/clispark.plan.md.bak` — expect empty output (no differences). Then remove the backup: `rm project-ideas/clispark.plan.md.bak`.

- [ ] **Step 2: Create one disposable real test issue**

```bash
gh issue create --repo martinwichner/clispark \
  --title "TEST: ingest-community-issues.mjs verification (safe to ignore)" \
  --body "Disposable issue created solely to verify project-ideas/ingest-community-issues.mjs. Will be closed immediately after verification." \
  --label "type:chore"
```

Note the returned issue number (referred to as `<N>` below).

- [ ] **Step 3: Run the script with the testing escape hatch enabled**

Run: `INGEST_TEST_INCLUDE_SELF=1 node project-ideas/ingest-community-issues.mjs`
Expected output: `Found 1 new community issue(s), appended to plan.md, labeled on GitHub.`

Verify:
- `project-ideas/clispark.plan.md` now contains a new `### Community-Vorschläge (noch nicht bewertet)` section (or a new line in it, if it already existed) with a line matching `- [ ] #<N> **TEST: ingest-community-issues.mjs verification (safe to ignore)** von @martinwichner, erkannt am <today> — https://github.com/martinwichner/clispark/issues/<N>`.
- `gh issue view <N> --json labels --repo martinwichner/clispark` shows both `source:community` and `triaged` in the labels list, alongside the `type:chore` label from Step 2.

- [ ] **Step 4: Run the script again to confirm idempotency**

Run: `INGEST_TEST_INCLUDE_SELF=1 node project-ideas/ingest-community-issues.mjs`
Expected output: `No new community issues found.` — issue `<N>` now carries `triaged`, so it's correctly excluded even with `includeSelf` still set.

Verify `project-ideas/clispark.plan.md` has exactly one entry for `#<N>` (not two).

- [ ] **Step 5: Clean up**

```bash
gh issue close <N> --repo martinwichner/clispark --comment "Verification complete, closing disposable test issue."
```

Manually remove the `#<N>` **TEST: ...** line that was appended to `project-ideas/clispark.plan.md` in Step 3 (open the file, delete that one line) — it was only ever a test fixture, not a real community suggestion, so it must not remain in the maintainer's actual backlog review list.

- [ ] **Step 6: Update `project-ideas/clispark.plan.md`'s changelog and the project's memory file**

Add a changelog entry documenting this session's three deliverables (label taxonomy, one-time issue mirroring of the 7 M13 items as #65–#71, and this ingestion script), per this project's established "keep plans updated" convention. Update `project_clispark.md` memory similarly. No git commit for `plan.md` (not a repo); the `ingest-community-issues.mjs`/`.test.mjs` files also stay uncommitted for the same reason.
