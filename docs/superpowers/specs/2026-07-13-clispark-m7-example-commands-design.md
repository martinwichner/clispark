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

**Explicitly out of scope:**
- Any real task storage/state — every command only logs what it *would* do.
- Flags (`--foo`) — the plan and the user's own notes name args and subcommands only; adding flag examples here would be scope creep beyond what M7 asks for.
- Changes to `hello.ts` itself — it remains the separate, minimal starting point.

## Design

### Command bodies

```ts
// src/commands/task.ts
import { Args } from '@oclif/core';
import { BaseCommand } from '../base-command';

export default class Task extends BaseCommand {
  static description = 'Create a task (demonstrates a required and an optional argument)';
  static args = {
    title: Args.string({ required: true, description: 'Task title' }),
    priority: Args.string({ required: false, description: 'Optional priority (e.g. low/medium/high)' }),
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
  static description = 'Complete a task (demonstrates a subcommand with a required argument)';
  static args = {
    id: Args.string({ required: true, description: 'Task ID to complete' }),
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
  static description = 'List tasks (demonstrates a subcommand with an optional argument)';
  static args = {
    filter: Args.string({ required: false, description: 'Optional filter term' }),
  };
  static flags = {};

  async run(): Promise<void> {
    const { args } = await this.parse(TaskList);
    this.log(args.filter ? `Listing tasks matching "${args.filter}"` : 'Listing all tasks');
  }
}
```

All three inherit `BaseCommand` exactly like `hello.ts` — no changes to `base-command.ts`, `logger.ts`, or the auto-registration mechanism are needed; oclif's own topic/subcommand discovery (already relied on since M3) picks up `task/complete.ts` and `task/list.ts` from their folder location automatically.

### Documentation updates

- **`templates/base/README.md`** (generated project's own README): new section introducing `task` / `task complete` / `task list` as the args/subcommand reference example, alongside the existing `hello` mention.
- **`templates/base/ARCHITECTURE.md`**: the `## Commands` code snippet currently shows `static args = {}`; extend it (or add a second snippet) to show a populated `Args.string(...)` example so the doc reflects what a real command with arguments looks like, pointing at `task.ts` as the live reference.
- **`clispark/README.md`** (generator's own README): update the status table/feature list to reflect M7 as done, per the project's standing instruction to keep this README current each milestone.

## Error Handling

None beyond what `BaseCommand`/oclif already provide. These are demo commands with no destructive side effects; a missing required arg produces oclif's existing clean "Missing required arg" error, already covered by the M3 error-handling work.

## Testing

Same pattern as `hello.test.ts`: one test file per command (`task.test.ts`, `task/complete.test.ts`, `task/list.test.ts`), using `@oclif/test`'s `runCommand()`.

**Open point to verify empirically during implementation (not assumed):** the exact `runCommand()` invocation syntax for a nested subcommand against the project's actual installed oclif version — e.g. whether `runCommand('task complete 1')` (space-separated) or `runCommand('task:complete 1')` (colon-separated) is what resolves correctly. Consistent with how this project has always treated oclif behavior (M3, M5, M6 all found real discrepancies between assumption and actual behavior) — confirm with a real test run rather than assuming either form.

**Manual end-to-end verification (same shape as M1–M6):** real scaffold, then real invocations of `task`, `task complete <id>`, `task list`, and `task list` with a filter argument, confirming output and that missing-required-arg still produces oclif's clean error format.
