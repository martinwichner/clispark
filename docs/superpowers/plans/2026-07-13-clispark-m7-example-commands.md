# clispark M7: Example Commands in the Base Template Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Milestone 7 from `project-ideas/clispark.plan.md` — add a second, richer command example (`task` / `task complete` / `task list`) to the generated boilerplate's `src/commands/`, alongside the existing minimal `hello.ts`, so a new user sees oclif's required-arg, optional-arg, enum-constrained-arg, integer-arg, boolean-arg, and subcommand patterns in one small, copyable place — plus documentation covering the full `Args` type catalogue.

**Architecture:** Three new command files under `templates/base/src/commands/` (`task.ts`, `task/complete.ts`, `task/list.ts`), each extending `BaseCommand` exactly like `hello.ts`. oclif's existing folder-based command discovery (relied on since M3) and `tsup.config.ts`'s existing `src/commands/**/*.ts` entry glob (already recursive, no change needed) pick these up automatically. No changes to `base-command.ts`, `logger.ts`, or any scaffolding code — this milestone only adds template content and docs.

**Tech Stack:** Same as the rest of the generated boilerplate — `@oclif/core`'s `Args` helpers (`Args.string`, `Args.integer`, `Args.boolean`), `@oclif/test`'s `runCommand()` for tests. No new dependencies.

## Global Constraints

- Full design context: `docs/superpowers/specs/2026-07-13-clispark-m7-example-commands-design.md`.
- Exactly three new command files (`task.ts`, `task/complete.ts`, `task/list.ts`) — do not add a fourth to cover a type not otherwise used; the plan's spec says "stay compact, no proliferation of example files." `file`/`directory`/`url`/`custom` types are documented (Task 4) but not used in any command.
- `hello.ts` and `hello.test.ts` are not touched — they remain the separate, minimal starting point.
- No flags (`--foo`) anywhere in this milestone — only positional `Args`. Type variety comes from `Args.string`/`Args.integer`/`Args.boolean` and the `options` constraint, not from adding a flags example.
- No real task storage/state — every command only logs what it would do (`this.log(...)`).
- `package.json`'s `oclif.topicSeparator` is already `" "` (confirmed by reading the file) — `@oclif/test`'s `runCommand()` takes space-separated invocation strings exactly like real shell usage (e.g. `runCommand('task complete 1')`), confirmed by reading `@oclif/core`'s own `lib/help/util.js` (`normalizeArgv`/`collateSpacedCmdIDFromArgs`) and `@oclif/test`'s `lib/index.js` (`runCommand` just space-splits and forwards to oclif's own `run()`) rather than assumed.
- `Args.integer`'s rejection message for non-numeric input is exactly `` Expected an integer but received: <input> `` (from `@oclif/core` 4.11.14's `lib/args.js`, read directly, not assumed).
- `Args.boolean` parses any input to `true` except (case-insensitively) `0`, `false`, `n`, `no`, which parse to `false` — confirmed from the same source file (`isNotFalsy` in `lib/util/util.js`).
- An `options: [...]` constraint on any arg type rejects with exactly `` Expected <input> to be one of: <options.join(', ')> `` (confirmed from `@oclif/core`'s `lib/parser/parse.js` / `lib/parser/errors.js`, `ArgInvalidOptionError`).

---

### Task 1: `task` command — required string + optional enum-constrained string

**Files:**
- Create: `templates/base/src/commands/task.ts`
- Create: `templates/base/src/commands/task.test.ts`

**Interfaces:**
- Consumes: `BaseCommand` from `../base-command` (existing, unchanged)
- Produces: nothing consumed by later tasks — `task/complete.ts` and `task/list.ts` (Tasks 2–3) are independent sibling commands, not dependents of `task.ts`'s code.

- [ ] **Step 1: Write the failing test**

Create `templates/base/src/commands/task.test.ts`:

```ts
// templates/base/src/commands/task.test.ts
import { describe, it, expect } from 'vitest';
import { runCommand } from '@oclif/test';

describe('task', () => {
  it('creates a task with just a title', async () => {
    const { stdout } = await runCommand('task "Buy milk"');
    expect(stdout).toContain('Created task: "Buy milk"');
    expect(stdout).not.toContain('priority');
  });

  it('creates a task with a priority', async () => {
    const { stdout } = await runCommand('task "Buy milk" high');
    expect(stdout).toContain('Created task: "Buy milk" (priority: high)');
  });

  it('rejects a priority outside the allowed values', async () => {
    const { error } = await runCommand('task "Buy milk" urgent');
    expect(error?.message).toContain('Expected urgent to be one of: low, medium, high');
  });

  it('requires a title', async () => {
    const { error } = await runCommand('task');
    expect(error?.message).toContain('Missing 1 required arg');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- task.test.ts`
Expected: FAIL — `templates/base/src/commands/task.ts` does not exist yet, so the build (via `pretest`) has no `task` command to run.

- [ ] **Step 3: Write the command**

Create `templates/base/src/commands/task.ts`:

```ts
// templates/base/src/commands/task.ts
import { Args } from '@oclif/core';
import { BaseCommand } from '../base-command';

export default class Task extends BaseCommand {
  static description = 'Create a task (demonstrates a required string arg and an optional enum-constrained arg)';
  static args = {
    title: Args.string({ required: true, description: 'Task title' }),
    priority: Args.string({
      required: false,
      options: ['low', 'medium', 'high'],
      description: 'Optional priority',
    }),
  };
  static flags = {};

  async run(): Promise<void> {
    const { args } = await this.parse(Task);
    this.log(`Created task: "${args.title}"${args.priority ? ` (priority: ${args.priority})` : ''}`);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- task.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add templates/base/src/commands/task.ts templates/base/src/commands/task.test.ts
git commit -m "feat: add task example command (required + enum-constrained args)"
```

---

### Task 2: `task complete` subcommand — required integer

**Files:**
- Create: `templates/base/src/commands/task/complete.ts`
- Create: `templates/base/src/commands/task/complete.test.ts`

**Interfaces:**
- Consumes: `BaseCommand` from `../../base-command` (note the extra `../` — this file is one folder deeper than `task.ts`)
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing test**

Create `templates/base/src/commands/task/complete.test.ts`:

```ts
// templates/base/src/commands/task/complete.test.ts
import { describe, it, expect } from 'vitest';
import { runCommand } from '@oclif/test';

describe('task complete', () => {
  it('completes a task by numeric id', async () => {
    const { stdout } = await runCommand('task complete 42');
    expect(stdout).toContain('Completed task 42');
  });

  it('rejects a non-numeric id', async () => {
    const { error } = await runCommand('task complete abc');
    expect(error?.message).toContain('Expected an integer but received: abc');
  });

  it('requires an id', async () => {
    const { error } = await runCommand('task complete');
    expect(error?.message).toContain('Missing 1 required arg');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- complete.test.ts`
Expected: FAIL — `templates/base/src/commands/task/complete.ts` does not exist yet.

- [ ] **Step 3: Write the command**

Create `templates/base/src/commands/task/complete.ts`:

```ts
// templates/base/src/commands/task/complete.ts
import { Args } from '@oclif/core';
import { BaseCommand } from '../../base-command';

export default class TaskComplete extends BaseCommand {
  static description = 'Complete a task (demonstrates a subcommand with a required integer argument)';
  static args = {
    id: Args.integer({ required: true, description: 'Task ID to complete' }),
  };
  static flags = {};

  async run(): Promise<void> {
    const { args } = await this.parse(TaskComplete);
    this.log(`Completed task ${args.id}`);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- complete.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add templates/base/src/commands/task/complete.ts templates/base/src/commands/task/complete.test.ts
git commit -m "feat: add task complete subcommand (required integer arg)"
```

---

### Task 3: `task list` subcommand — two optional args of different types

**Files:**
- Create: `templates/base/src/commands/task/list.ts`
- Create: `templates/base/src/commands/task/list.test.ts`

**Interfaces:**
- Consumes: `BaseCommand` from `../../base-command`
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing test**

Create `templates/base/src/commands/task/list.test.ts`:

```ts
// templates/base/src/commands/task/list.test.ts
import { describe, it, expect } from 'vitest';
import { runCommand } from '@oclif/test';

describe('task list', () => {
  it('lists all tasks with no args', async () => {
    const { stdout } = await runCommand('task list');
    expect(stdout).toContain('Listing all tasks');
  });

  it('lists tasks matching a filter', async () => {
    const { stdout } = await runCommand('task list groceries');
    expect(stdout).toContain('Listing tasks matching "groceries"');
  });

  it('combines a filter with the done flag', async () => {
    const { stdout } = await runCommand('task list groceries true');
    expect(stdout).toContain('Listing tasks matching "groceries" (completed only: true)');
  });

  it('parses "no" as false for the done arg', async () => {
    const { stdout } = await runCommand('task list groceries no');
    expect(stdout).toContain('(completed only: false)');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- list.test.ts`
Expected: FAIL — `templates/base/src/commands/task/list.ts` does not exist yet.

- [ ] **Step 3: Write the command**

Create `templates/base/src/commands/task/list.ts`:

```ts
// templates/base/src/commands/task/list.ts
import { Args } from '@oclif/core';
import { BaseCommand } from '../../base-command';

export default class TaskList extends BaseCommand {
  static description = 'List tasks (demonstrates a subcommand with two optional arguments of different types)';
  static args = {
    filter: Args.string({ required: false, description: 'Optional filter term' }),
    done: Args.boolean({ required: false, description: 'Only show completed tasks (true/false)' }),
  };
  static flags = {};

  async run(): Promise<void> {
    const { args } = await this.parse(TaskList);
    const base = args.filter ? `Listing tasks matching "${args.filter}"` : 'Listing all tasks';
    this.log(args.done !== undefined ? `${base} (completed only: ${args.done})` : base);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- list.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add templates/base/src/commands/task/list.ts templates/base/src/commands/task/list.test.ts
git commit -m "feat: add task list subcommand (two optional args, string + boolean)"
```

---

### Task 4: Documentation — `ARCHITECTURE.md`, generated project's `README.md`, generator's own `README.md`

**Files:**
- Modify: `templates/base/ARCHITECTURE.md`
- Modify: `templates/base/README.md`
- Modify: `README.md` (clispark's own, repo root)

**Interfaces:**
- None (docs only, no code consumed or produced).

- [ ] **Step 1: Add the `## Argument Types` section to `templates/base/ARCHITECTURE.md`**

In `templates/base/ARCHITECTURE.md`, insert a new section directly after the existing `## Commands` section (i.e. right before the `## Command Discovery` heading). Current end of `## Commands` / start of `## Command Discovery` looks like this:

````markdown
`BaseCommand` overrides oclif's `init()`/`catch()`/`finally()` lifecycle methods to log every command's start, failure, and completion automatically — no manual logging calls needed inside `run()`.

## Command Discovery
````

Change it to:

````markdown
`BaseCommand` overrides oclif's `init()`/`catch()`/`finally()` lifecycle methods to log every command's start, failure, and completion automatically — no manual logging calls needed inside `run()`.

## Argument Types

Every entry in a command's `static args` is built from `@oclif/core`'s `Args` helpers. `task.ts` / `task/complete.ts` / `task/list.ts` use a few of these; the full set `@oclif/core` ships:

- **`Args.string()`** — plain text, no parsing/validation. The default choice.
  ```ts
  title: Args.string({ description: 'Task title' })
  ```
- **`Args.integer({ min?, max? })`** — parses digits into a real `number`, rejects non-numeric input, optional bounds.
  ```ts
  id: Args.integer({ min: 1, description: 'Task ID' })
  // `task complete abc` → "Expected an integer but received: abc"
  ```
- **`Args.boolean()`** — parses into a real `boolean`. Any input is `true` except (case-insensitive) `0`, `false`, `n`, `no`, which parse to `false`.
  ```ts
  done: Args.boolean({ description: 'Only completed tasks' })
  // `task list true` → done === true; `task list no` → done === false
  ```
- **`Args.file({ exists? })`** / **`Args.directory({ exists? })`** — plain string path by default; with `exists: true`, verifies the path actually exists on disk (as a file/directory respectively) and throws otherwise.
  ```ts
  config: Args.file({ exists: true, description: 'Path to a config file' })
  // missing file → "No file found at <path>"
  ```
- **`Args.url()`** — parses into a real `URL` object, throws if the input isn't a valid URL.
  ```ts
  endpoint: Args.url({ description: 'API endpoint' })
  ```
- **`Args.custom<T, Opts>({ parse })`** — build your own type when none of the above fit.
  ```ts
  const semver = Args.custom<string>({
    parse: async (input) => {
      if (!/^\d+\.\d+\.\d+$/.test(input)) throw new Error(`Not a valid semver: ${input}`);
      return input;
    },
  });
  ```
- **`options: [...]`** — a cross-cutting constraint any arg type can add (not a type itself): restricts input to a fixed list of values.
  ```ts
  priority: Args.string({ options: ['low', 'medium', 'high'] })
  // `task <title> urgent` → "Expected urgent to be one of: low, medium, high"
  ```

See `task.ts` (string + enum-constrained string), `task/complete.ts` (integer), and `task/list.ts` (string + boolean) for these in a real, runnable command.

## Command Discovery
````

- [ ] **Step 2: Add a new section to `templates/base/README.md`**

Current file:

````markdown
# {{projectName}}

Generated with [clispark](https://github.com/martinwichner/clispark).

## Requirements

Node.js **>=24** — this project's entry point (`bin/run.ts`) runs directly via Node's native TypeScript execution, with no build step. On an older Node version it fails with an `ERR_UNKNOWN_FILE_EXTENSION` error rather than a clear version message, so if you hit that, check `node --version` first.
````

Change to:

````markdown
# {{projectName}}

Generated with [clispark](https://github.com/martinwichner/clispark).

## Requirements

Node.js **>=24** — this project's entry point (`bin/run.ts`) runs directly via Node's native TypeScript execution, with no build step. On an older Node version it fails with an `ERR_UNKNOWN_FILE_EXTENSION` error rather than a clear version message, so if you hit that, check `node --version` first.

## Example commands

Two example commands ship in `src/commands/` as copy-paste starting points:

- **`hello`** (`src/commands/hello.ts`) — the minimal case: no args, no subcommands.
  ```bash
  node bin/run.ts hello
  ```
- **`task`** / **`task complete`** / **`task list`** (`src/commands/task.ts`, `src/commands/task/`) — a reference for oclif's argument and subcommand patterns: required args, optional args, an enum-constrained arg, an integer arg, a boolean arg, and how a folder under `src/commands/` becomes a subcommand.
  ```bash
  node bin/run.ts task "Buy milk" high
  node bin/run.ts task complete 1
  node bin/run.ts task list groceries
  ```
  See `ARCHITECTURE.md`'s "Argument Types" section for the full set of argument types oclif supports, including a couple this example doesn't use.
````

- [ ] **Step 3: Update clispark's own `README.md` "What you get" section**

Current bullet (in the `## What you get` section):

```markdown
- **A first example command** (`hello`) as a starting point for your own commands
```

Change to:

```markdown
- **Example commands** — a minimal `hello` starting point plus a `task`/`task complete`/`task list` reference covering required args, optional args, enum-constrained args, integer and boolean args, and subcommands
```

- [ ] **Step 4: Commit**

```bash
git add templates/base/ARCHITECTURE.md templates/base/README.md README.md
git commit -m "docs: document task example commands and full oclif Args type catalogue"
```

---

### Task 5: Manual end-to-end verification + whole-branch review

No new code — this proves the generated project's real build/test pipeline picks up the new nested command files and that oclif's actual parsing/validation behavior matches what Tasks 1–3 assumed and tested.

- [ ] **Step 1: Full local test suite for the generator itself**

Run: `npm test && npm run typecheck`
Expected: all green (this runs the generator's own suite; the `task*.test.ts` files live under `templates/`, which the generator's own `vitest.config.ts` excludes — they only run inside a real scaffolded project, verified next).

- [ ] **Step 2: Real scaffold**

```bash
cat > m7-verify.mjs << 'EOF'
import { scaffoldProject } from './src/scaffold.js';
import path from 'node:path';
import os from 'node:os';

const targetDir = path.join(os.tmpdir(), 'clispark-m7-verify', 'm7-test-cli');
await scaffoldProject({ projectName: 'm7-test-cli', targetDir });
console.log('scaffold complete:', targetDir);
EOF
npx tsx m7-verify.mjs
rm m7-verify.mjs
```

Expected: prints `scaffold complete: <path>`, real `npm install`/`npm run build` succeed (scaffoldProject runs them automatically).

- [ ] **Step 3: Run the generated project's own test suite**

```bash
cd "$(node -e "console.log(require('os').tmpdir())")/clispark-m7-verify/m7-test-cli"
npm test
```

Expected: all tests pass, including the 11 new ones from Tasks 1–3 (4 + 3 + 4), confirming `runCommand('task complete 1')`'s space-separated syntax genuinely resolves the nested subcommand under the project's real, installed `@oclif/core`/`@oclif/test` versions — not just against the tarball read during planning.

- [ ] **Step 4: Real CLI invocations of all three commands, success and error paths**

Still inside `m7-test-cli`:

```bash
node bin/run.ts task "Buy milk"
node bin/run.ts task "Buy milk" high
node bin/run.ts task "Buy milk" urgent
node bin/run.ts task complete 42
node bin/run.ts task complete abc
node bin/run.ts task list
node bin/run.ts task list groceries
node bin/run.ts task list groceries true
node bin/run.ts hello
```

Expected: the four success lines print `Created task: "Buy milk"`, `Created task: "Buy milk" (priority: high)`, `Completed task 42`, `Listing all tasks`, `Listing tasks matching "groceries"`, `Listing tasks matching "groceries" (completed only: true)` respectively; the two invalid-input lines print a clean `Error: Expected urgent to be one of: low, medium, high` and `Error: Expected an integer but received: abc` — no raw stack trace in either case (confirming `BaseCommand`'s existing `catch()` handling, unchanged by this milestone, still applies to these new commands); `hello` is unaffected.

- [ ] **Step 5: Clean up verification artifacts**

```bash
cd -
rm -rf "$(node -e "console.log(require('os').tmpdir())")/clispark-m7-verify"
```

- [ ] **Step 6: Final whole-branch review**

Run the project's established review pass over the full diff before merging: confirm all three new commands consistently extend `BaseCommand` (not oclif's own `Command`), confirm every `run()` calls `await this.parse(...)` (avoids the `UnparsedCommand` warning noted in M3), confirm the `../../base-command` relative import path is correct for both `task/` files (one level deeper than `task.ts`), and confirm the `ARCHITECTURE.md`/both `README.md` edits render correctly as Markdown (nested code fences inside the `## Argument Types` list items in particular — verify no fence-closing mismatch).

- [ ] **Step 7: Update the project plan**

Mark M7 complete (`- [x]`) in `project-ideas/clispark.plan.md`, add a changelog line summarizing what shipped (three new commands, doc updates, any bugs found during this verification pass), following the existing per-milestone changelog convention.

- [ ] **Step 8: Commit the plan update**

```bash
git add project-ideas/clispark.plan.md
git commit -m "docs: mark M7 complete in clispark plan"
```
