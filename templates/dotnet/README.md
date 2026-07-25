# {{projectName}}

Generated with [clispark](https://github.com/martinwichner/clispark).

## Requirements

.NET SDK **10.0** or later.

## Building and running

```bash
dotnet build Cli.slnx
dotnet run --project src -- hello World
```

Or install it as a global tool on your own machine:

```bash
dotnet pack src -c Release -o ./nupkg
dotnet tool install -g {{projectName}} --add-source ./nupkg
{{projectName}} hello World
```

## Example commands

Four example commands ship in `src/Commands/` as copy-paste starting points:

- **`hello`** (`src/Commands/HelloCommand.cs`) — the minimal case: one required string argument.
  ```bash
  dotnet run --project src -- hello World
  ```
- **`task`** / **`task list`** / **`task complete`** (`src/Commands/TaskCommand.cs`, `TaskListCommand.cs`, `TaskCompleteCommand.cs`) — a reference for `System.CommandLine`'s argument and subcommand patterns: an optional allowed-values argument, a nested subcommand with a string + boolean pair, and a required integer argument that demonstrates the `CliUserException` error path.
  ```bash
  dotnet run --project src -- task open
  dotnet run --project src -- task list groceries true
  dotnet run --project src -- task complete 1
  ```
  See `ARCHITECTURE.md`'s "Argument Types" section for details.

## Shell Completion

Tab-completion works out of the box via `System.CommandLine`'s built-in `[suggest]` support — see
`ARCHITECTURE.md`'s "Shell Completion" section for the one-time `dotnet-suggest` setup.

## Logging & debugging

Every command run writes a structured log file (one per invocation, in an OS-appropriate log directory — see `ARCHITECTURE.md`'s "Logging" section). By default the terminal only shows a clean `Error: <message>` on failure, or nothing on success.

- **`DEBUG=1`** — streams the raw log lines to stdout live as the command runs, and prints `Details: <path>` to the log file on both success and failure (normally that line only appears on failure).
- Fields that look like secrets (`password`, `token`, `apiKey`, etc. — see `SensitiveKeys` in `src/Logging/CliLoggerFactory.cs`) are redacted from log output automatically; edit that list directly in your own copy if you log other sensitive fields.
