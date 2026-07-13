# clispark M7: Example Commands in the Base Template — Design

**Goal:** Milestone 7 from `project-ideas/clispark.plan.md`. Give a new user of a freshly generated project one place to see oclif's required-argument, optional-argument, and subcommand patterns in action, without having to research oclif's own docs first. `hello.ts` stays as-is — the minimal, no-args starting point — this milestone adds a second, richer reference alongside it, not a replacement.

## Scope

Three new command files, one small topic (`task`), all purely illustrative (no real persistence — logging simulated actions only):

```
src/commands/
  task.ts            → `<tool> task <title> [priority]`   (one command: required arg + optional arg together)
  task/
    complete.ts       → `<tool> task complete <id>`         (subcommand + required arg)
    list.ts           → `<tool> task list [filter]`         (subcommand + optional arg)
```

`task.ts` doubling as both "required arg" and "optional arg" example (rather than a fourth file) keeps the set to three files total, in line with the plan's explicit "stay compact, no proliferation of example files" requirement. The `task/` folder itself demonstrates the subcommand mechanism as a side effect of its existence — a new user sees both "a command can have args" and "a command can have subcommands" from the same small example.

**Type variety (added per user request, 2026-07-13):** rather than every arg being a plain string, each file uses a different oclif `Args` type, so the three files together tour more of oclif's arg-type surface, not just the required/optional/subcommand axis:

- `task.ts`: plain required string (`title`) + optional **enum-constrained string** (`priority`, restricted to `low`/`medium`/`high` via `Args.string`'s `options`).
- `task/complete.ts`: required **integer** (`id`) instead of a string — shows numeric arg parsing/validation.
- `task/list.ts`: optional plain string (`filter`) + optional **boolean** (`done`) — also doubles as the one place showing a command with *two* optional args together.

**Explicitly out of scope:**
- Any real task storage/state — every command only logs what it *would* do.
- Flags (`--foo`) — the plan and the user's own notes name args and subcommands only; adding flag examples here would be scope creep beyond what M7 asks for. Type variety is achieved via oclif's built-in `Args` types, not flags.
- Changes to `hello.ts` itself — it remains the separate, minimal starting point.

## Design

### Command bodies

```ts
// src/commands/task.ts
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

```ts
// src/commands/task/complete.ts
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

```ts
// src/commands/task/list.ts
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

All three inherit `BaseCommand` exactly like `hello.ts` — no changes to `base-command.ts`, `logger.ts`, or the auto-registration mechanism are needed; oclif's own topic/subcommand discovery (already relied on since M3) picks up `task/complete.ts` and `task/list.ts` from their folder location automatically.

### Documentation updates

- **`templates/base/README.md`** (generated project's own README): new section introducing `task` / `task complete` / `task list` as the args/subcommand reference example, alongside the existing `hello` mention — briefly note that the three files also tour different `Args` types (string, enum-constrained string, integer, boolean).
- **`templates/base/ARCHITECTURE.md`**: new `## Argument Types` section (added per user request, 2026-07-13), catalogueing every arg type `@oclif/core` ships (verified against the actual installed version, `^4.0.0`/`4.11.14`, by reading `@oclif/core`'s own `lib/args.js` source rather than assumed), each with a one-line example and the actual rejection message oclif produces on invalid input. Goes directly after the existing `## Commands` section. Exact content to add:

  ```markdown
  ## Argument Types

  Every entry in a command's `static args` is built from `@oclif/core`'s `Args` helpers. `task.ts` / `task/complete.ts` / `task/list.ts` (see below) use a few of these; the full set `@oclif/core` ships:

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
  ```

  `file`/`directory`/`url`/`custom` are documented for completeness (full catalogue, as requested) even though none of the three `task` commands use them — adding a 4th/5th command just to demonstrate every type would violate the "stay compact" constraint from the plan, so the doc's own inline examples cover the types the commands don't.
- **`clispark/README.md`** (generator's own README): update the status table/feature list to reflect M7 as done, per the project's standing instruction to keep this README current each milestone.

## Error Handling

None beyond what `BaseCommand`/oclif already provide. These are demo commands with no destructive side effects; a missing required arg produces oclif's existing clean "Missing required arg" error, already covered by the M3 error-handling work.

## Testing

Same pattern as `hello.test.ts`: one test file per command (`task.test.ts`, `task/complete.test.ts`, `task/list.test.ts`), using `@oclif/test`'s `runCommand()`.

**Open points to verify empirically during implementation (not assumed):**
- The exact `runCommand()` invocation syntax for a nested subcommand against the project's actual installed oclif version — e.g. whether `runCommand('task complete 1')` (space-separated) or `runCommand('task:complete 1')` (colon-separated) is what resolves correctly. Consistent with how this project has always treated oclif behavior (M3, M5, M6 all found real discrepancies between assumption and actual behavior) — confirm with a real test run rather than assuming either form.
- `Args.string`'s `options` validation: confirm the actual rejection message oclif produces for `priority` given a value outside `low`/`medium`/`high`, and that it stays a clean `Error: ...` (no raw stack) consistent with the rest of clispark's error-handling convention.
- `Args.integer` validation: confirm the actual rejection message for a non-numeric `id`, and that `args.id` arrives as a real `number` (not a string) inside `run()`.
- `Args.boolean` parsing: confirm which literal input strings oclif accepts as `true`/`false` for `done`, and what happens when it's omitted (`args.done === undefined`, not a default `false`) — that's what the `run()` body above assumes.

**Manual end-to-end verification (same shape as M1–M6):** real scaffold, then real invocations of `task` (with and without `priority`, including an invalid `priority` value), `task complete <id>` (including a non-numeric `id`), `task list` (with/without `filter` and `done`), confirming output and that invalid/missing args still produce oclif's clean error format.
