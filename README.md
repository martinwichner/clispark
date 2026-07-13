# clispark

Interactive scaffolding tool for new CLI projects. Run `npx clispark` to generate a new, ready-to-run TypeScript CLI project with consistent logging, error handling, and command structure — no manual setup required.

[![npm version](https://img.shields.io/npm/v/clispark.svg)](https://www.npmjs.com/package/clispark)
[![CI](https://github.com/martinwichner/clispark/actions/workflows/ci.yml/badge.svg)](https://github.com/martinwichner/clispark/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/clispark.svg)](LICENSE)

## Quickstart

```bash
npx clispark
```

Answer three prompts — project name, work/private profile, and (for "work") an optional private registry URL — and clispark scaffolds a new directory, running `git init`, `npm install`, and `npm run build` for you. Thirty seconds later:

```bash
cd my-cli
node bin/run.ts hello
```

...prints a greeting from your first working command, with structured logging and clean error handling already wired up.

## What you get

Every generated project includes:

- **oclif-based CLI structure** with convention-based command discovery — drop a file in `src/commands/`, no manual registration needed
- **Structured logging** (`pino`, one log file per invocation in an OS-appropriate log directory) that automatically covers every command
- **Consistent error handling** with no opt-out — clean `Error: <message>` output on failure, full stack trace captured in the log file
- **A working test setup** (`vitest` + `@oclif/test`) with an example test to copy from
- **Example commands** — a minimal `hello` starting point plus a `task`/`task complete`/`task list` reference covering required args, optional args, enum-constrained args, integer and boolean args, and subcommands
- **A clean build pipeline** (`tsup`) producing a directly runnable binary

## Usage

```bash
npx clispark
```

The wizard asks:

1. **Project name** — checked for availability against the target npm registry as you type; a taken name prompts you to try another instead of blocking hard.
2. **Profile** — `work` or `private`. `work` unlocks an optional registry URL prompt.
3. **Registry URL** (work profile only) — leave empty for the public npm registry, or point at a private/company registry. If set, an `.npmrc` is generated so every future `npm install` in the project uses it automatically.

Scaffolding then happens automatically: files are copied, `git init` plus an initial commit run, and `npm install && npm run build` leave you with a directly runnable project.

## Updating a project

Generated projects track which files and `package.json` fields are generator-managed ("core") versus yours, in a `.clispark/manifest.json` written at scaffold time. From inside a generated project:

```bash
npx clispark update
```

pulls in the latest core improvements (base command, logger, build/test config, `ARCHITECTURE.md`, and the relevant `package.json` dependencies/scripts) from whichever clispark version `npx` resolves. It never touches anything under `src/commands/`, your `README.md`, or an `.npmrc` you added — those are yours. If you've hand-edited a core file yourself, `update` leaves it alone and reports it as skipped rather than overwriting your changes. It refuses to run against an unclean git working tree, and commits its own changes as a single, easily revertible commit.

```bash
npx clispark releasenotes
```

shows what changed between the clispark version your project last updated to and the latest one available, pulled straight from the project's GitHub releases.

## Tech stack

**Generator itself (`clispark`):** TypeScript, [commander](https://github.com/tj/commander.js) (CLI structure), [@clack/prompts](https://github.com/bombshell-dev/clack) (interactive wizard), `cross-spawn` (cross-platform shelling out to git/npm), `pino` + `env-paths` (own logging), `tsup` + `vitest`.

**Generated boilerplate:** TypeScript, [oclif](https://oclif.io/) (command framework), `pino` + `env-paths` (logging), `tsup` (build), `vitest` + `@oclif/test` (testing).

## Releases & CI

Releases are automated via [release-please](https://github.com/googleapis/release-please): commits to `master` follow [Conventional Commits](https://www.conventionalcommits.org/), and merging the running release PR publishes to npm via [Trusted Publishing](https://docs.npmjs.com/trusted-publishers) (OIDC) — no long-lived npm token involved. `ci.yml` runs on every push/PR: unit tests, typecheck, build, a blocking `npm audit`, and an end-to-end scaffold smoke test.

## Development status

clispark is under active development — see [`CHANGELOG.md`](CHANGELOG.md) for the full release history and the [implementation plans](docs/superpowers/plans/) for the reasoning behind each milestone.

## Development notes

This project is being built with the help of [Claude](https://claude.com/claude-code). Implementation plans are written before coding starts and committed alongside the code under [`docs/superpowers/plans/`](docs/superpowers/plans/), so the reasoning and step-by-step approach behind each milestone stays visible in version control.

Planning and execution follow the [Superpowers](https://github.com/obra/superpowers) skill set for Claude Code (brainstorming → writing-plans → subagent-driven-development) — credit to [obra](https://github.com/obra) for that workflow.

## License

[MIT](LICENSE)
