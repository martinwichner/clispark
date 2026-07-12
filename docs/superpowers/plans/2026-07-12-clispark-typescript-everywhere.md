# clispark: TypeScript Everywhere Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate every remaining `.js`/`.mjs` source file in the repository (`bin/run.js`, `scripts/audit-issues.mjs` + test, `eslint.config.js`), give each converted file full typing, and switch every relative import (generator and template alike) from `.js` extensions to extensionless specifiers.

**Architecture:** Four independent conversions (import specifiers in existing `.ts` files; `scripts/audit-issues.ts`; `eslint.config.ts`; `bin/run.ts` + the Node version floor it requires) plus a CI update tying the Node-version and entry-point changes together with real verification. No runtime behavior changes anywhere except the generated project's `engines` floor and its entry point's execution mechanism (native Node TypeScript execution instead of a plain `.js` shim — the shim's own logic is unchanged).

**Tech Stack:** TypeScript, Node's native TypeScript type-stripping (stable since Node 24.12.0 / 25.2.0), `jiti` (new devDependency, required for ESLint to load a `.ts` config file under Node.js).

## Global Constraints

- Both `tsconfig.json` files (generator and template) already use `"moduleResolution": "Bundler"` — extensionless relative imports work today with **no tsconfig change**. Do not add `allowImportingTsExtensions` or switch resolution modes.
- Generated projects: `"engines": { "node": ">=24" }` (was `>=18`). The generator's own `package.json` `"engines"` stays `>=18` — `npx clispark` always runs the tsup-bundled `dist/cli.js`, never native TS.
- `bin/run.ts`'s content does not change beyond the file extension — it has zero type annotations today and needs none.
- No new dependency except `jiti` (required specifically for `eslint.config.ts` under Node.js — confirmed via the ESLint project's own docs, not avoidable).
- After all tasks: `git ls-files | grep -E '\.(js|mjs|cjs)$'` returns nothing.

Full design reasoning: `docs/superpowers/specs/2026-07-12-clispark-typescript-everywhere-design.md`.

---

### Task 1: Generator import specifiers — drop `.js`

**Files:**
- Modify: `src/cli.ts`, `src/logger.test.ts`, `src/registry.test.ts`, `src/scaffold.test.ts`, `src/scaffold.ts`, `src/types.ts`, `src/wizard.test.ts`, `src/wizard.ts`, `src/update/manifest.test.ts`, `src/update/reconcile.test.ts`, `src/update/releasenotes.test.ts`, `src/update/releasenotes.ts`, `src/update/update.test.ts`, `src/update/update.ts`, `src/update/update-package-json.test.ts`, `src/update/update-package-json.ts`

No behavior change — every relative import in these 16 files currently ends `.js'`; each becomes extensionless. This is a single mechanical transformation applied uniformly, verified by re-grepping afterward rather than hand-diffing 16 files.

- [ ] **Step 1: Apply the transformation**

```bash
sed -i -E "s/from '(\.\.?\/[^']*)\.js'/from '\1'/g" \
  src/cli.ts src/logger.test.ts src/registry.test.ts src/scaffold.test.ts src/scaffold.ts src/types.ts \
  src/wizard.test.ts src/wizard.ts \
  src/update/manifest.test.ts src/update/reconcile.test.ts src/update/releasenotes.test.ts src/update/releasenotes.ts \
  src/update/update.test.ts src/update/update.ts src/update/update-package-json.test.ts src/update/update-package-json.ts
```

- [ ] **Step 2: Verify no relative `.js` imports remain in `src/`**

Run: `grep -rn "from '\..*\.js'" src/`
Expected: no output (empty match = success).

- [ ] **Step 3: Verify nothing else changed**

Run: `git diff --stat`
Expected: only the 16 files above, each with only import-line changes (no other content touched). Spot-check two or three files with `git diff <file>` to confirm only `.js'` → `'` changes appear.

- [ ] **Step 4: Full verification**

Run: `npm run build && npm test && npm run lint && npm run typecheck`
Expected: all green — this is the real proof the sed transformation didn't corrupt anything (Bundler resolution requires no other change for this to work).

- [ ] **Step 5: Commit**

```bash
git add src/
git commit -m "refactor: drop .js extensions from generator's relative imports"
```

---

### Task 2: Template import specifiers — drop `.js`

**Files:**
- Modify: `templates/base/src/commands/hello.ts`, `templates/base/src/base-command.ts`, `templates/base/ARCHITECTURE.md`

Only three spots in the template reference a relative `.js` import.

- [ ] **Step 1: Fix `templates/base/src/commands/hello.ts`**

```typescript
// templates/base/src/commands/hello.ts
import { BaseCommand } from '../base-command';
```

(only the import line changes; the rest of the file is untouched)

- [ ] **Step 2: Fix `templates/base/src/base-command.ts`**

```typescript
// templates/base/src/base-command.ts
import { Command, type Interfaces } from '@oclif/core';
import type { Logger } from 'pino';
import { createLogger } from './logger';
```

(only the `createLogger` import line changes)

- [ ] **Step 3: Fix the code sample in `templates/base/ARCHITECTURE.md`**

Find:
```
import { BaseCommand } from '../base-command.js';
```
Replace with:
```
import { BaseCommand } from '../base-command';
```

- [ ] **Step 4: Verify**

Run: `grep -rn "from '\..*\.js'" templates/base/src/ templates/base/ARCHITECTURE.md`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add templates/base/src/commands/hello.ts templates/base/src/base-command.ts templates/base/ARCHITECTURE.md
git commit -m "refactor: drop .js extensions from template's relative imports"
```

(Full scaffold-level verification of the template happens in Task 7's manual end-to-end pass — a real scaffold + `npm run build` + `npm test` proves the template's own Bundler-resolution build/test pipeline tolerates this exactly like the generator's does.)

---

### Task 3: `scripts/audit-issues.ts` (+ test), fully typed

**Files:**
- Create: `scripts/audit-issues.ts` (replaces `scripts/audit-issues.mjs`)
- Create: `scripts/audit-issues.test.ts` (replaces `scripts/audit-issues.test.mjs`)
- Delete: `scripts/audit-issues.mjs`, `scripts/audit-issues.test.mjs`
- Modify: `tsconfig.json`, `.github/workflows/ci.yml`

**Interfaces:**
- Produces: `interface AdvisoryVia { title?: string; url?: string }`, `interface AuditFinding { severity: string; range?: string; fixAvailable?: boolean; via?: (string | AdvisoryVia)[] }`, `interface AuditReport { metadata?: { vulnerabilities?: { critical?: number; high?: number; moderate?: number; low?: number } }; vulnerabilities?: Record<string, AuditFinding> }`, `interface CategorizedFinding { name: string; severity: string; range?: string; fixAvailable: boolean; advisoryTitle?: string; advisoryUrl?: string }`, `interface CategorizedFindings { blocking: { count: number; findings: CategorizedFinding[] }; informational: { count: number; findings: CategorizedFinding[] } }`, `function categorizeFindings(auditReport: AuditReport): CategorizedFindings`, `interface SyncIssueOptions { label: string; title: string; findings: CategorizedFinding[]; runUrl: string; bodyIfClean: string }`, `interface SyncIssueDeps { runGh: (args: string[]) => Promise<string> }`, `function syncIssueForClass(options: SyncIssueOptions, deps: SyncIssueDeps): Promise<void>`.

- [ ] **Step 1: Create `scripts/audit-issues.ts`**

```typescript
// scripts/audit-issues.ts
import { execFileSync, execSync } from 'node:child_process';

export interface AdvisoryVia {
  title?: string;
  url?: string;
}

export interface AuditFinding {
  severity: string;
  range?: string;
  fixAvailable?: boolean;
  via?: (string | AdvisoryVia)[];
}

export interface AuditReport {
  metadata?: {
    vulnerabilities?: {
      critical?: number;
      high?: number;
      moderate?: number;
      low?: number;
    };
  };
  vulnerabilities?: Record<string, AuditFinding>;
}

function extractAdvisory(finding: AuditFinding): AdvisoryVia | undefined {
  return (finding.via ?? []).find((v): v is AdvisoryVia => typeof v === 'object');
}

export interface CategorizedFinding {
  name: string;
  severity: string;
  range?: string;
  fixAvailable: boolean;
  advisoryTitle?: string;
  advisoryUrl?: string;
}

export interface CategorizedFindings {
  blocking: { count: number; findings: CategorizedFinding[] };
  informational: { count: number; findings: CategorizedFinding[] };
}

export function categorizeFindings(auditReport: AuditReport): CategorizedFindings {
  const counts = auditReport.metadata?.vulnerabilities ?? {};
  const blockingCount = (counts.critical ?? 0) + (counts.high ?? 0);
  const informationalCount = (counts.moderate ?? 0) + (counts.low ?? 0);

  const blocking: CategorizedFinding[] = [];
  const informational: CategorizedFinding[] = [];

  for (const [name, finding] of Object.entries(auditReport.vulnerabilities ?? {})) {
    const advisory = extractAdvisory(finding);
    const entry: CategorizedFinding = {
      name,
      severity: finding.severity,
      range: finding.range,
      fixAvailable: Boolean(finding.fixAvailable),
      advisoryTitle: advisory?.title,
      advisoryUrl: advisory?.url,
    };
    if (finding.severity === 'critical' || finding.severity === 'high') {
      blocking.push(entry);
    } else if (finding.severity === 'moderate' || finding.severity === 'low') {
      informational.push(entry);
    }
  }

  return {
    blocking: { count: blockingCount, findings: blocking },
    informational: { count: informationalCount, findings: informational },
  };
}

const STATE_MARKER_PREFIX = '<!-- audit-issues:state:';
const STATE_MARKER_SUFFIX = ' -->';

function buildStateMarker(state: Record<string, string>): string {
  return `${STATE_MARKER_PREFIX}${JSON.stringify(state)}${STATE_MARKER_SUFFIX}`;
}

function extractState(body: string | undefined): Record<string, string> {
  if (!body) return {};
  const start = body.indexOf(STATE_MARKER_PREFIX);
  if (start === -1) return {};
  const end = body.indexOf(STATE_MARKER_SUFFIX, start);
  if (end === -1) return {};
  try {
    return JSON.parse(body.slice(start + STATE_MARKER_PREFIX.length, end)) as Record<string, string>;
  } catch {
    return {};
  }
}

function toState(findings: CategorizedFinding[]): Record<string, string> {
  return Object.fromEntries(findings.map((f) => [f.name, f.severity]));
}

interface StateDiff {
  added: string[];
  updated: string[];
  resolved: string[];
}

function diffState(previous: Record<string, string>, current: Record<string, string>): StateDiff {
  const added: string[] = [];
  const updated: string[] = [];
  for (const name of Object.keys(current)) {
    if (!(name in previous)) added.push(name);
    else if (previous[name] !== current[name]) updated.push(name);
  }
  const resolved = Object.keys(previous).filter((name) => !(name in current));
  return { added, updated, resolved };
}

function formatFinding(finding: CategorizedFinding): string {
  const lines = [`- **${finding.name}** (${finding.severity})`];
  if (finding.range) lines.push(`  - Affected range: \`${finding.range}\``);
  lines.push(`  - Fix available: ${finding.fixAvailable ? 'yes' : 'no'}`);
  if (finding.advisoryTitle && finding.advisoryUrl) {
    lines.push(`  - ${finding.advisoryTitle}: ${finding.advisoryUrl}`);
  } else if (finding.advisoryTitle) {
    lines.push(`  - ${finding.advisoryTitle}`);
  } else if (finding.advisoryUrl) {
    lines.push(`  - ${finding.advisoryUrl}`);
  }
  return lines.join('\n');
}

function buildBody(findings: CategorizedFinding[], runUrl: string): string {
  const list = findings.length > 0 ? findings.map(formatFinding).join('\n') : '(none)';
  return `${list}\n\nLast checked: ${runUrl}\n\n${buildStateMarker(toState(findings))}`;
}

export interface SyncIssueOptions {
  label: string;
  title: string;
  findings: CategorizedFinding[];
  runUrl: string;
  bodyIfClean: string;
}

export interface SyncIssueDeps {
  runGh: (args: string[]) => Promise<string>;
}

export async function syncIssueForClass(options: SyncIssueOptions, deps: SyncIssueDeps): Promise<void> {
  const { label, title, findings, runUrl, bodyIfClean } = options;
  const { runGh } = deps;
  const isClean = findings.length === 0;

  const listOutput = await runGh(['issue', 'list', '--label', label, '--state', 'open', '--json', 'number']);
  const openIssues = JSON.parse(listOutput) as { number: number }[];
  const existingNumber = openIssues[0]?.number;

  if (isClean) {
    if (existingNumber !== undefined) {
      await runGh(['issue', 'close', String(existingNumber), '--comment', bodyIfClean]);
    }
    return;
  }

  const body = buildBody(findings, runUrl);

  if (existingNumber === undefined) {
    await runGh(['issue', 'create', '--title', title, '--body', body, '--label', label]);
    return;
  }

  const viewOutput = await runGh(['issue', 'view', String(existingNumber), '--json', 'body']);
  const previousState = extractState((JSON.parse(viewOutput) as { body: string }).body);
  const currentState = toState(findings);
  const { added, updated, resolved } = diffState(previousState, currentState);

  if (added.length === 0 && updated.length === 0 && resolved.length === 0) {
    return;
  }

  await runGh(['issue', 'edit', String(existingNumber), '--body', body]);

  const changeLines: string[] = [];
  if (added.length > 0) changeLines.push(`New: ${added.join(', ')}`);
  if (updated.length > 0) changeLines.push(`Severity changed: ${updated.join(', ')}`);
  if (resolved.length > 0) changeLines.push(`Resolved: ${resolved.join(', ')}`);
  await runGh(['issue', 'comment', String(existingNumber), '--body', changeLines.join('\n')]);
}

interface ExecError extends Error {
  stdout?: string;
}

function runNpmAudit(): AuditReport {
  try {
    const output = execSync('npm audit --json', { encoding: 'utf8' });
    return JSON.parse(output) as AuditReport;
  } catch (error) {
    const stdout = (error as ExecError).stdout;
    if (stdout) return JSON.parse(stdout) as AuditReport;
    throw error;
  }
}

async function realRunGh(args: string[]): Promise<string> {
  return execFileSync('gh', args, { encoding: 'utf8' });
}

async function main(): Promise<void> {
  const report = runNpmAudit();
  const { blocking, informational } = categorizeFindings(report);
  const runUrl = process.env.GITHUB_RUN_URL ?? '(unknown run)';

  await syncIssueForClass(
    {
      label: 'security-audit-blocking',
      title: 'npm audit: blocking (high/critical) findings',
      findings: blocking.findings,
      runUrl,
      bodyIfClean: `Clean as of ${runUrl}`,
    },
    { runGh: realRunGh },
  );

  await syncIssueForClass(
    {
      label: 'security-audit-info',
      title: 'npm audit: informational (moderate/low) findings',
      findings: informational.findings,
      runUrl,
      bodyIfClean: `Clean as of ${runUrl}`,
    },
    { runGh: realRunGh },
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
```

- [ ] **Step 2: Create `scripts/audit-issues.test.ts`**

Copy the full content of `scripts/audit-issues.test.mjs` into `scripts/audit-issues.test.ts` unchanged, then apply exactly these edits:

Change the import line:
```typescript
import { categorizeFindings, syncIssueForClass, type AuditReport, type CategorizedFinding } from './audit-issues';
```

Type `loadFixture`:
```typescript
async function loadFixture(name: string): Promise<AuditReport> {
  return JSON.parse(await readFile(path.join(FIXTURES_DIR, name), 'utf8')) as AuditReport;
}
```

Type `makeRunGh`:
```typescript
function makeRunGh(responses: { list?: string; view?: string }) {
  const calls: string[][] = [];
  const runGh = vi.fn(async (args: string[]) => {
    calls.push(args);
    if (args[0] === 'issue' && args[1] === 'list') return responses.list ?? '[]';
    if (args[0] === 'issue' && args[1] === 'view') return responses.view ?? '{"body":""}';
    return '';
  });
  return { runGh, calls };
}
```

Type the two shared fixtures inside `describe('syncIssueForClass', ...)`:
```typescript
  const finding: CategorizedFinding = {
    name: 'example-critical-pkg',
    severity: 'critical',
    range: '<1.0.0',
    fixAvailable: true,
    advisoryTitle: 'Prototype Pollution in example-critical-pkg',
    advisoryUrl: 'https://github.com/advisories/GHSA-xxxx-xxxx-xxxx',
  };
  const otherFinding: CategorizedFinding = {
    name: 'example-other-pkg',
    severity: 'high',
    range: '<3.0.0',
    fixAvailable: false,
    advisoryTitle: undefined,
    advisoryUrl: undefined,
  };
```

All 9 `it(...)` test bodies and their assertions stay byte-for-byte identical — only the four spots above change.

- [ ] **Step 3: Delete the old files**

```bash
git rm scripts/audit-issues.mjs scripts/audit-issues.test.mjs
```

- [ ] **Step 4: Add `scripts` to the generator's tsconfig include**

In `tsconfig.json`, change:
```json
  "include": ["src"]
```
to:
```json
  "include": ["src", "scripts"]
```

- [ ] **Step 5: Update the CI audit job to invoke the `.ts` script**

In `.github/workflows/ci.yml`, under the `audit` job's "Sync security audit issues" step, change:
```yaml
        run: node scripts/audit-issues.mjs
```
to:
```yaml
        run: node scripts/audit-issues.ts
```

- [ ] **Step 6: Run tests**

Run: `npx vitest run scripts/audit-issues.test.ts`
Expected: all 9 tests pass (same coverage as before, now type-checked).

- [ ] **Step 7: Full verification**

Run: `npm test && npm run typecheck`
Expected: green — `typecheck` now also covers `scripts/` for the first time (`npm run lint`'s scope is extended in Task 4, alongside the `eslint.config.ts` conversion, since both touch the same `files` glob and lint script).

- [ ] **Step 8: Commit**

```bash
git add scripts/audit-issues.ts scripts/audit-issues.test.ts tsconfig.json .github/workflows/ci.yml
git commit -m "refactor: convert scripts/audit-issues.mjs to fully-typed TypeScript"
```

---

### Task 4: `eslint.config.ts`

**Files:**
- Create: `eslint.config.ts` (replaces `eslint.config.js`)
- Delete: `eslint.config.js`
- Modify: `package.json`

- [ ] **Step 1: Add the `jiti` devDependency**

Run: `npm install --save-dev jiti`
Expected: `package.json`'s `devDependencies` gains a `"jiti": "^2.x.x"` entry (npm resolves the current version satisfying `^2.2.0`, the documented minimum for ESLint's TS-config loading).

- [ ] **Step 2: Create `eslint.config.ts`**

```typescript
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'templates/**'],
  },
  {
    files: ['src/**/*.ts', 'scripts/**/*.ts'],
    extends: [eslint.configs.recommended, ...tseslint.configs.recommended],
  },
);
```

(identical content to the current `eslint.config.js`, except the `files` glob now also covers `scripts/**/*.ts`, added alongside the extension change since both are needed for `scripts/audit-issues.ts` to actually get linted with rules applied, not just discovered)

- [ ] **Step 3: Delete the old config**

```bash
git rm eslint.config.js
```

- [ ] **Step 4: Broaden the lint script's scan scope**

In `package.json`, change:
```json
    "lint": "eslint src",
```
to:
```json
    "lint": "eslint src scripts",
```

- [ ] **Step 5: Verify ESLint actually loads the new config**

Run: `npm run lint`
Expected: clean (no output). This is sufficient proof `eslint.config.ts` loaded correctly — ESLint fails loudly (does not silently skip) if it can't parse/load its config file, so a clean run is real evidence, not just an absence-of-crash coincidence.

- [ ] **Step 6: Full verification**

Run: `npm test && npm run typecheck && npm run build`
Expected: green — confirms `jiti` (a new devDependency) didn't interfere with anything else, and the build/test pipeline is untouched by this config-only change.

- [ ] **Step 7: Commit**

```bash
git add eslint.config.ts package.json package-lock.json
git commit -m "refactor: convert eslint.config.js to TypeScript (requires jiti under Node.js)"
```

---

### Task 5: `bin/run.ts` and the generated-project Node floor

**Files:**
- Create: `templates/base/bin/run.ts` (replaces `templates/base/bin/run.js`)
- Delete: `templates/base/bin/run.js`
- Modify: `templates/base/package.json`, `src/update/manifest.ts`, `src/scaffold.test.ts`, `README.md`

- [ ] **Step 1: Rename the entry-point file**

```bash
git mv templates/base/bin/run.js templates/base/bin/run.ts
```

Content stays byte-for-byte identical (already zero type annotations):
```typescript
#!/usr/bin/env node

import { execute } from '@oclif/core';

await execute({ dir: import.meta.url });
```

- [ ] **Step 2: Update `templates/base/package.json`**

Change:
```json
  "bin": {
    "{{projectName}}": "./bin/run.js"
  },
```
to:
```json
  "bin": {
    "{{projectName}}": "./bin/run.ts"
  },
```

Change:
```json
  "engines": {
    "node": ">=18"
  },
```
to:
```json
  "engines": {
    "node": ">=24"
  },
```

Change:
```json
    "postbuild": "shx chmod +x bin/run.js",
```
to:
```json
    "postbuild": "shx chmod +x bin/run.ts",
```

Change the `@types/node` devDependency to match the new floor:
```json
    "@types/node": "^24.0.0",
```
(was `"^22.10.5"`)

- [ ] **Step 3: Update `CORE_FILE_PATHS` in `src/update/manifest.ts`**

Change:
```typescript
  'bin/run.js',
```
to:
```typescript
  'bin/run.ts',
```

(this is the only `CORE_FILE_PATHS` entry that changes; `templateSourcePath()` needs no update — it only special-cases the `.gitignore` ↔ `gitignore` rename, and `bin/run.ts` has the same name in the template source and the scaffolded output)

- [ ] **Step 4: Update `src/scaffold.test.ts`**

Change:
```typescript
    expect(pkg.bin).toEqual({ 'my-cli': './bin/run.js' });
```
to:
```typescript
    expect(pkg.bin).toEqual({ 'my-cli': './bin/run.ts' });
```

Change:
```typescript
    const runJs = await readFile(path.join(targetDir, 'bin', 'run.js'), 'utf8');
    expect(runJs).toContain('execute');
```
to:
```typescript
    const runTs = await readFile(path.join(targetDir, 'bin', 'run.ts'), 'utf8');
    expect(runTs).toContain('execute');
```

- [ ] **Step 5: Update `README.md`'s quickstart**

Change:
```
node bin/run.js hello
```
to:
```
node bin/run.ts hello
```

- [ ] **Step 6: Run the affected tests**

Run: `npx vitest run src/scaffold.test.ts src/update/manifest.test.ts src/update/update.test.ts`
Expected: all pass — `manifest.test.ts` and `update.test.ts` reference `CORE_FILE_PATHS` programmatically (never hardcode `bin/run.js`/`bin/run.ts` as a literal string), so they pick up the renamed path automatically once the constant changes.

- [ ] **Step 7: Full verification**

Run: `npm test && npm run typecheck`
Expected: green. (A real scaffold + real `node bin/run.ts hello` execution is Task 7's manual verification — that's what actually proves Node's native TypeScript execution works end-to-end, which no unit test here can prove on its own.)

- [ ] **Step 8: Commit**

```bash
git add templates/base/bin/run.ts templates/base/package.json src/update/manifest.ts src/scaffold.test.ts README.md
git commit -m "feat: convert bin/run.js to TypeScript, raise generated-project Node floor to >=24"
```

---

### Task 6: CI — Node 24 everywhere, fixed heredoc import, real `bin/run.ts` smoke check

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Bump all three jobs to Node 24**

In `.github/workflows/ci.yml`, there are three occurrences of:
```yaml
      - uses: actions/setup-node@v6
        with:
          node-version: 22
```
(one each in `test`, `audit`, `scaffold-smoke`). Change `node-version: 22` to `node-version: 24` in all three.

- [ ] **Step 2: Fix the `.js` import inside `scaffold-smoke`'s inline heredoc script**

Change:
```yaml
          import { scaffoldProject } from './src/scaffold.js';
```
to:
```yaml
          import { scaffoldProject } from './src/scaffold';
```

- [ ] **Step 3: Add a real `bin/run.ts` execution step to `scaffold-smoke`**

After the existing "Run the generated project's own test suite" step, add:

```yaml
      - name: Run the generated project's entry point directly (verifies native TS execution)
        run: |
          cd "$(node -e "console.log(require('os').tmpdir())")/clispark-ci-smoke/smoke-test-cli"
          output="$(node bin/run.ts hello)"
          echo "$output"
          if [[ "$output" != *"Hello from your new CLI!"* ]]; then
            echo "bin/run.ts did not produce the expected greeting" >&2
            exit 1
          fi
```

This is new coverage: today nothing in CI ever shells out to `bin/run.js`/`bin/run.ts` directly (the test suite only exercises commands through `@oclif/test`'s `runCommand()` helper), so this is the first automated check that Node's native TypeScript execution of the entry point actually works, on every future change.

- [ ] **Step 4: Verify the full `ci.yml` file is syntactically valid**

Run: `cat .github/workflows/ci.yml` and read it end-to-end — confirm indentation is consistent YAML (the heredoc and the new step are both multi-line `run:` blocks at the same job-step nesting level as their neighbors). There is no local GitHub Actions runner in this environment; Task 7's real CI run against the pushed branch is the actual verification.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: run on Node 24, fix scaffold-smoke's import, add a real bin/run.ts execution check"
```

---

### Task 7: Manual end-to-end verification + whole-branch review

No new code — this validates real, un-mocked behavior (native Node TypeScript execution, the new Node floor, ESLint's `.ts` config loading, real CI) that unit tests can't fully reach on their own.

- [ ] **Step 1: Full local build + test suite**

Run: `npm run build && npm test && npm run lint && npm run typecheck`
Expected: all green.

- [ ] **Step 2: Confirm zero JS source files remain**

Run: `git ls-files | grep -E '\.(js|mjs|cjs)$'`
Expected: no output.

- [ ] **Step 3: Real scaffold + real direct execution of `bin/run.ts`**

```bash
cd /tmp   # or any scratch directory
node /path/to/clispark/dist/cli.js   # wizard: name "ts-everywhere-e2e", profile "private"
cd ts-everywhere-e2e
node bin/run.ts hello
```
Expected: prints `Hello from your new CLI!` — this is the real proof Node's native TypeScript execution works for this project's actual entry-point content, on the local machine's real Node version (confirm with `node --version` beforehand; must be ≥22.18 to succeed at all, ideally ≥24 to match the new floor).

- [ ] **Step 4: Confirm the generated project's own pipeline still works end-to-end**

In the same `ts-everywhere-e2e` directory:
```bash
npm run build && npm test && npm run lint 2>/dev/null; npm run typecheck
```
Expected: `npm run build`/`npm test`/`npm run typecheck` green (the generated project has no `lint` script — that's fine, it was never part of the template's own scripts).

- [ ] **Step 5: Push and confirm real CI**

Push the branch, open (or update) the PR, and confirm all three CI checks (`test`, `audit`, `scaffold-smoke`) pass — `scaffold-smoke` in particular now runs entirely on Node 24 and includes the new direct `bin/run.ts` execution step from Task 6, which is the first automated (non-manual) proof this whole conversion holds up.

- [ ] **Step 6: Final whole-branch review**

Run the project's established review pass (as done at the end of prior milestones) over the full diff before merging: confirm the import-specifier sed transformation (Task 1) didn't miss or over-match anything, confirm `scripts/audit-issues.ts`'s types are accurate (no `any` leaking in), confirm `eslint.config.ts` + `jiti` didn't pull in anything unexpected, and confirm every `bin/run.js` reference across the generator (`CORE_FILE_PATHS`, tests, README) was updated consistently.

- [ ] **Step 7: Update the project plan**

Mark this work complete in `project-ideas/clispark.plan.md`'s M7 backlog (the mjs→TS entry) and add a changelog line summarizing what shipped, following the existing per-change changelog convention.
