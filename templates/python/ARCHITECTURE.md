# Architecture

## Command discovery

`cli/discover.py` walks `cli/commands/` recursively at startup. Each `.py` file there exports a
`app: typer.Typer()` object with a single `@app.callback(invoke_without_command=True)` — the
folder path becomes the command path (a file in `cli/commands/task/create.py` becomes
`{{projectName}} task create`). Subfolders need their own `__init__.py` to be recognized as a
command group.

## BaseCommand and logging

Every command implements `BaseCommand` (`cli/base_command.py`) — an abstract class whose `run()`
method carries the actual logic. `BaseCommand.__call__()` wraps every invocation with structured
`structlog` logging (`started` / `completed` / `failed`, each with timing), so no command needs
its own logging or try/except: exceptions are logged and then re-raised, so the CLI's normal error
output and exit code still reflect the real failure.

## Testing

Tests use `typer.testing.CliRunner`, which invokes the CLI in-process (no subprocess spawn) —
see `tests/test_hello.py` for the pattern to copy for new commands.

## Adding commands

`clispark add` generates a new `cli/commands/<path>.py` (plus any missing intermediate
`__init__.py` files) and a matching `tests/test_<name>.py`. You can also add commands by hand
following the same convention.
