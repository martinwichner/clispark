# {{projectName}} Architecture

This document explains the conventions this project was generated with, so the automatic behavior (command discovery, logging, error handling) doesn't feel like unexplained magic.

## Commands

Every command lives in `src/Commands/` and implements `ICliCommand` (`src/ICliCommand.cs`):

```csharp
using System.CommandLine;

namespace Cli.Commands;

[CommandPath("my-command")]
public sealed class MyCommand : ICliCommand
{
    public Command Build()
    {
        var command = new Command("my-command", "What this command does");
        command.SetAction(parseResult => Console.WriteLine("done"));
        return command;
    }
}
```

`[CommandPath("...")]` declares the full, space-separated invocation path — for a nested subcommand this is `"task list"`, not just `"list"`. This is what expresses nesting, **not** the folder a file lives in under `src/Commands/` (unlike the Node template, where a subcommand's folder location *is* its path) — `CommandDiscovery` finds commands via reflection over the whole assembly, not by scanning the filesystem, so there's no requirement to mirror command paths in folders.

## Argument Types

Every entry in a command's argument list is a `System.CommandLine.Argument<T>`. `TaskCommand`/`TaskListCommand`/`TaskCompleteCommand` use a few of these:

- **`Argument<string>`** — plain text, required by default.
  ```csharp
  var nameArgument = new Argument<string>("name");
  ```
- **`Argument<int>`** — parses digits into a real `int`, rejects non-numeric input.
  ```csharp
  var idArgument = new Argument<int>("id");
  // `task complete abc` → "Cannot parse argument 'abc' for command 'complete' as expected type 'System.Int32'."
  ```
- **`Argument<bool?>`** with `Arity = ArgumentArity.ZeroOrOne` — optional boolean.
  ```csharp
  var allArgument = new Argument<bool?>("all") { Arity = ArgumentArity.ZeroOrOne };
  ```
- **`.AcceptOnlyFromAmong(...)`** — restricts a string argument to a fixed list of values.
  ```csharp
  statusArgument.AcceptOnlyFromAmong("open", "done");
  // `task bogus` → "Das Argument 'bogus' wurde nicht erkannt. Folgendes ist erforderlich: 'open' / 'done'"
  ```
- **`Arity = ArgumentArity.ZeroOrOne`** on any `Argument<T?>` — makes an otherwise-required argument optional; omit it for a required argument.

See `TaskCommand.cs` (string + allowed-values), `TaskCompleteCommand.cs` (integer), and `TaskListCommand.cs` (string + boolean, nested subcommand) for these in a real, runnable command.

## Command Discovery

`Program.cs` calls `CommandDiscovery.RegisterAll(root, Assembly.GetExecutingAssembly())` at startup, which reflects over the assembly for every `ICliCommand` implementation, reads its `[CommandPath]`, and attaches it to the command tree — creating bare container commands automatically for any missing intermediate path segments (e.g. a bare `task` node is created automatically if only `"task list"` were declared and no class declared `"task"` itself). Dropping a new file in `src/Commands/` and rebuilding is enough; nothing needs to be manually registered.

## Error Handling

There's no base-class inheritance model here (unlike the Node template's `BaseCommand`) — `System.CommandLine` doesn't have an equivalent lifecycle to hook into. Instead, `Program.cs` wraps the whole invocation in a single `try`/`catch`: a thrown `CliUserException` (`src/CliUserException.cs`) produces a clean `Error: <message>` with no stack trace and exit code 1; anything else is not caught here and surfaces with a full stack trace (still logged in full either way — see Logging below).

**Important `System.CommandLine` detail:** `ParseResult.Invoke()` has a default exception handler that silently swallows exceptions from a command's action and prints its own message — `Program.cs` disables it explicitly (`new InvocationConfiguration { EnableDefaultExceptionHandler = false }`) so `CliUserException` actually reaches the `catch` block. If you write a test that calls `.Invoke()` directly on a command's `Build()` output to assert on a thrown exception, you need the same `InvocationConfiguration` — see `TaskCompleteCommandTests.cs`.

## Logging

`src/Logging/CliLoggerFactory.cs` writes structured logs via Serilog, one file per command invocation, to an OS-appropriate log directory (via `Xdg.Directories`, respecting `$XDG_STATE_HOME` on Linux) — never to the project's own working directory. `Program.cs` assigns the created logger to Serilog's static `Log.Logger`, so any command can log via `Serilog.Log.Information(...)` etc. without an injected instance. On failure, the full exception (including stack trace) is always logged to the file, while the terminal only ever shows a clean `Error: <message>`; the terminal also prints `Details: <path to the log file>` so the full error is one file away.

A few things run automatically around every log call:

- **Retention:** before opening a new log file, a sweep deletes files older than 14 days — throttled to run at most once per 24 hours via a `.last-sweep` marker file in the log directory, so a busy CLI doesn't re-scan the log directory on every single invocation.
- **Redaction:** `SensitivePropertyEnricher` masks known secret-shaped property names (`password`, `secret`, `token`, `apiKey`, `registryUrl`) case-insensitively before they reach any sink — edit `SensitiveKeys` in `CliLoggerFactory.cs` directly if your commands log other sensitive fields.
- **`DEBUG=1`:** streams every log line to stdout live in addition to the file, and prints `Details: <path>` on success too, not just on failure — useful while developing a new command.
- **File permissions:** the log file itself is created with `UnixFileMode.UserRead | UnixFileMode.UserWrite` (owner read/write only) on non-Windows platforms; this is a documented no-op on Windows, which has no POSIX permission bits — same principle as the Node template's `mode: 0o600`.

## Testing

Tests use `xunit` and live in `tests/Cli.Tests.csproj` (a separate project referencing `src/Cli.csproj`, not colocated with the commands they test — the conventional .NET layout, unlike vitest's colocated `*.test.ts` files). A test exercises a command directly via `new SomeCommand().Build()` then `.Parse(args).Invoke(...)` — no process spawning needed. Remember the `EnableDefaultExceptionHandler = false` detail from "Error Handling" above when asserting on thrown exceptions.

## Lint Tooling

If you answered "yes" to "Set up lint tooling?" during scaffolding, `src/Cli.csproj` includes a `<PropertyGroup>` enabling the .NET SDK's built-in Roslyn analyzers — no new NuGet dependency:

```xml
<PropertyGroup>
  <EnableNETAnalyzers>true</EnableNETAnalyzers>
  <AnalysisLevel>latest</AnalysisLevel>
  <AnalysisMode>Recommended</AnalysisMode>
  <EnforceCodeStyleInBuild>true</EnforceCodeStyleInBuild>
</PropertyGroup>
```

There's no separate lint command — analyzer warnings surface as part of a normal `dotnet build`. `AnalysisMode=Recommended` (over the SDK default `Default`) and `EnforceCodeStyleInBuild=true` (over the SDK default `false`, which otherwise confines code-style rules to the IDE) are what actually change build output; `EnableNETAnalyzers`/`AnalysisLevel` are already the `net10.0` SDK's own defaults and are listed here for explicitness.

If you answered "no", this `<PropertyGroup>` isn't present, and `dotnet build` runs with only the SDK's own defaults.

Either way, this choice is permanent and core-managed: `npx clispark update` keeps this block current for a project that opted in, and will never add it to a project that declined. There's no retroactive "turn lint tooling on later" command — rerun `clispark` in a new directory if you want it.

## Shell Completion

`System.CommandLine` 2.0.10's `[suggest]` directive is already part of this project's parsing
pipeline — no code in `Program.cs` or any command needs to change. To activate it in your shell:

1. Install the registration tool once per machine: `dotnet tool install -g dotnet-suggest`
2. Install this project as a global tool (see the README's "Building and running" section), then
   register it once per installation:
   ```bash
   dotnet-suggest register --command-path "$(which {{projectName}})"
   ```
   (On Windows, use the `.exe` path `dotnet-suggest` prints after `dotnet tool install -g` instead
   of `which`.)
3. Add shell integration to your profile once per machine:
   ```bash
   dotnet-suggest script bash >> ~/.bashrc   # or: script powershell, script zsh
   ```

After that, `{{projectName}} <TAB><TAB>` completes command names automatically — the completion
logic lives entirely in `dotnet-suggest`/`System.CommandLine`, not in this project's own code.
