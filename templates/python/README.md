# {{projectName}}

A Python CLI tool scaffolded by [clispark](https://www.npmjs.com/package/clispark).

## Usage

```bash
uv run {{projectName}} hello --name World
```

## Shell Completion

Shell completion is built into Typer — no setup needed:

```bash
uv run {{projectName}} --install-completion
```

## Adding a new command

Run `clispark add` from this directory, or drop a new `.py` file into `cli/commands/` following
the existing `hello.py` pattern — every command found there is automatically discovered and
wrapped with structured logging and error handling on startup, no manual try/except needed.
Nest a command under a subcommand group by creating a subfolder (with an `__init__.py`) under
`cli/commands/` — the folder structure becomes the command path.

## Testing

```bash
uv run pytest
```

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md).
