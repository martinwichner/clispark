# clispark: TypeScript Everywhere — Design

**Goal:** Eliminate every remaining JavaScript source file in the repository (generator and generated-project template alike), giving each converted file full typing, and switch every relative import — in both the generator's own code and the template — from `.js` extensions to extensionless specifiers.

## Scope

Four files are currently plain JS/MJS, and all four are in scope:

1. `templates/base/bin/run.js` → `bin/run.ts` — the executable entry point of every generated project.
2. `scripts/audit-issues.mjs` → `audit-issues.ts`, plus `scripts/audit-issues.test.mjs` → `audit-issues.test.ts`.
3. `eslint.config.js` → `eslint.config.ts`.

Plus a repo-wide import-specifier change (both `src/` and `templates/base/src/`) from `'./foo.js'` to `'./foo'`.

After this work, `git ls-files | grep -E '\.(js|mjs|cjs)$'` returns nothing — the only JavaScript in the repository is generated build output under `dist/` (gitignored, not source).

**Explicitly out of scope:** any change to the generated project's *build/test* pipeline (still `tsup` + `vitest`, unaffected) — only the unbuilt `bin/run.ts` entry point relies on Node's native TypeScript execution; every other generated-project source file is still compiled normally.

## Design

### 1. Import specifiers: extensionless

Both `tsconfig.json` files (generator and template) already use `"moduleResolution": "Bundler"` (set during earlier milestones), which does not require an extension on relative imports — unlike `NodeNext`/`Node16` resolution, which mandates `.js`. No `tsconfig.json` change is needed for this; it's purely a source-text change.

Every relative import in `src/*.ts`, `src/update/*.ts` (generator) and `templates/base/src/**/*.ts` (template) drops its `.js` suffix, e.g. `import { scaffoldProject } from './scaffold.js'` → `from './scaffold'`. This also applies to the inline heredoc script inside `.github/workflows/ci.yml`'s `scaffold-smoke` job (`import { scaffoldProject } from './src/scaffold.js'` → `'./src/scaffold'`) and the one code sample inside `templates/base/ARCHITECTURE.md`.

`.ts`-suffixed imports (the alternative to extensionless) were considered and rejected: they require the `allowImportingTsExtensions` compiler flag, which additionally requires `noEmit: true` unless paired with `rewriteRelativeImportExtensions` — more moving parts for no benefit over the simpler extensionless convention already standard in Bundler-resolution projects.

### 2. `bin/run.ts` and the Node version floor

`templates/base/bin/run.js` (4 lines, zero type annotations, just `import { execute } from '@oclif/core'; await execute(...)`) becomes `bin/run.ts`, executed directly by Node via its native TypeScript type-stripping support — no build step, matching how it already worked as plain JS.

Type stripping is enabled by default (no CLI flag) starting Node 22.18.0 / 23.6.0, and became **stable** (no longer experimental) at 24.12.0 / 25.2.0 ([Node.js TypeScript docs](https://nodejs.org/api/typescript.html)). To give generated-project users a clean, easily-explained floor rather than an odd patch-level minimum, and since Node 24 is the current Active LTS (supported until April 2028; Node 22 is Maintenance LTS only, EOL April 2027):

- `templates/base/package.json`: `"engines": { "node": ">=24" }` (was `>=18`).
- `templates/base/package.json`: `"bin": { "{{projectName}}": "./bin/run.ts" }`, `"scripts.postbuild": "shx chmod +x bin/run.ts"`.
- `README.md`'s quickstart (`node bin/run.js hello` → `node bin/run.ts hello`).
- `src/update/manifest.ts`: `CORE_FILE_PATHS` entry `'bin/run.js'` → `'bin/run.ts'`. No new entry needed in `templateSourcePath()` (that function only handles the `.gitignore`↔`gitignore` rename; `bin/run.ts` has the same name in the template source and the scaffolded output).
- Every M6 test fixture referencing `bin/run.js` (`src/scaffold.test.ts`, and any `src/update/*.test.ts` fixtures that touch `CORE_FILE_PATHS`) updated to `bin/run.ts`.

The generator's own `package.json` (`"engines": { "node": ">=18" }`) is **not** changed: `npx clispark` always runs the tsup-bundled `dist/cli.js`, a plain `.js` file, and never needs native TypeScript execution.

### 3. `scripts/audit-issues.ts` (+ test)

Straightforward conversion — the script has no enums, namespaces, decorators, or parameter properties (nothing that would fail Node's "erasable syntax" requirement). Every function gets explicit parameter and return types (`categorizeFindings`, `syncIssueForClass`, `runNpmAudit`, etc. — currently untyped `.mjs`).

Supporting changes so the converted file is actually type-checked, linted, and runnable:

- `tsconfig.json`: `"include": ["src", "scripts"]` (was `["src"]`) — `scripts/` was never covered by `npm run typecheck` before.
- `eslint.config.ts`'s `files` pattern broadened to also match `scripts/**/*.ts` (see below); `package.json`'s `"lint"` script becomes `"eslint src scripts"` (was `"eslint src"`) — the CLI argument controls what ESLint scans, independently of the config's `files` glob, which controls which rule-block applies once a file is scanned.
- `.github/workflows/ci.yml`'s `audit` job: `run: node scripts/audit-issues.mjs` → `run: node scripts/audit-issues.ts`. CI already runs Node 22 (bumped to 24 per §5 below regardless), both comfortably past the type-stripping-by-default threshold.

### 4. `eslint.config.ts`

Renamed from `.js`. On Node.js (unlike Deno/Bun), ESLint requires the `jiti` package (≥2.2.0) to load a TypeScript config file at all ([ESLint discussion #17726](https://github.com/eslint/eslint/discussions/17726)) — added as a new devDependency. No content change beyond the extension: the config already builds on `tseslint.config()`, which is fully typed regardless of the file's own extension, so this conversion is about consistency (zero remaining `.js` in the repo), not new type safety. `files` pattern updated to cover `scripts/**/*.ts` alongside the existing `src/**/*.ts`.

### 5. CI: Node 24 across all jobs, plus a real `bin/run.ts` execution check

All three `ci.yml` jobs (`test`, `audit`, `scaffold-smoke`) move from `node-version: 22` to `node-version: 24`, so `scaffold-smoke` — which scaffolds a real project and runs its own test suite — actually validates against the same Node floor (`>=24`) the scaffolded project's `package.json` now declares, rather than silently running on an older Node that happens to still work.

`scaffold-smoke` gains a new step that directly executes the generated project's entry point (`node bin/run.ts hello`, asserting the expected greeting in stdout) after the existing `npm test` step. Today nothing in CI ever shells out to `bin/run.js`/`bin/run.ts` directly — the existing test suite only exercises commands through `@oclif/test`'s `runCommand()` helper. Converting the entry point to rely on Node's native TS execution introduces a new failure mode (a Node version too old, or a future syntax that isn't erasable) that only a direct invocation would catch; this closes that gap.

## Testing

No new testing *strategy* — existing patterns (real `fs/promises` against real temp dirs, real scaffolds, no mocking of file I/O) are unaffected. Concretely:

- `scripts/audit-issues.test.ts`: same test cases as today, just typed; still runs via `vitest run` (already picked up by the default include glob, no `vitest.config.ts` change needed).
- `src/scaffold.test.ts`, `src/update/manifest.test.ts`, `src/update/update.test.ts`: update `bin/run.js` → `bin/run.ts` wherever `CORE_FILE_PATHS` or scaffolded-file paths are asserted.
- Manual end-to-end verification (same shape as M6's Task 7): real scaffold via the built `dist/cli.js` on Node 24, confirm `bin/run.ts` runs directly (`node bin/run.ts hello`), confirm `npm run build && npm test && npm run lint && npm run typecheck` all pass in both the generator and a real scaffolded project, confirm `eslint.config.ts` actually loads (ESLint does not silently fall back to no config on a load failure — a broken config file errors out immediately, so a passing `npm run lint` run is sufficient proof it loaded correctly).
- CI itself is the other half of the verification: the new `scaffold-smoke` step (`node bin/run.ts hello`) is real, automated proof this keeps working on every future change, not just at conversion time.
