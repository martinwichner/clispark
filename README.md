# clispark

Interactive scaffolding tool for new CLI projects. Run `npx clispark` to generate a new, ready-to-run TypeScript CLI project with consistent logging, error handling, and command structure — no manual setup required.

[![npm version](https://img.shields.io/npm/v/clispark.svg)](https://www.npmjs.com/package/clispark)
[![CI](https://github.com/martinwichner/clispark/actions/workflows/ci.yml/badge.svg)](https://github.com/martinwichner/clispark/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/clispark.svg)](LICENSE)

## Quickstart

```bash
npx clispark
```

Answer up to six prompts — project name, work/private profile, an optional private registry URL (for "work"), whether you plan to publish to npm, and whether to set up lint tooling, and (for Node) whether to set up shell autocompletion — and clispark scaffolds a new directory, running `git init`, `npm install`, and `npm run build` for you. Thirty seconds later:

```bash
cd my-cli
node bin/run.ts hello
```

...prints a greeting from your first working command, with structured logging and clean error handling already wired up.

Want a guided tour first? Run `npx clispark demo` for an interactive walkthrough covering the typical
workflow, every top-level command, and every wizard question — no project gets created.

## What you get

Every generated project includes:

- **oclif-based CLI structure** with convention-based command discovery — drop a file in `src/commands/`, no manual registration needed
- **Structured logging** (`pino`, one log file per invocation in an OS-appropriate log directory) that automatically covers every command
- **Consistent error handling** with no opt-out — clean `Error: <message>` output on failure, full stack trace captured in the log file
- **A working test setup** (`vitest` + `@oclif/test`) with an example test to copy from
- **Example commands** — a minimal `hello` starting point plus a `task`/`task complete`/`task list` reference covering required args, optional args, enum-constrained args, an integer arg, a boolean flag, and subcommands
- **A clean build pipeline** (`tsup`) producing a directly runnable binary

## Usage

```bash
npx clispark
```

The wizard asks:

1. **Project name**
2. **Profile** — `work` or `private`. `work` unlocks an optional registry URL prompt.
3. **Registry URL** (work profile only) — leave empty for the public npm registry, or point at a private/company registry. If set, an `.npmrc` is generated so every future `npm install` in the project uses it automatically.
4. **Publish to npm?** (default: No) — if yes, the project name is checked for availability against the target npm registry, and a taken name prompts you to try another instead of blocking hard. If no, the check is skipped entirely and the generated `package.json` is marked `"private": true`, so an accidental `npm publish` refuses to run.
5. **Set up lint tooling?** (default: No) — if yes, the generated project gets a working ESLint + Prettier setup (Node) or the .NET SDK's built-in Roslyn analyzers enabled via `.csproj` properties (.NET), and `npx clispark update` keeps it current afterwards. If no, none of it is scaffolded, and `update` never adds it later.
6. **Set up shell autocompletion?** (default: No, Node only — .NET and PowerShell already have working tab-completion built in with nothing to configure, so they're never asked) — if yes, the generated project gets `@oclif/plugin-autocomplete` wired up, and `npx clispark update` keeps its version current afterwards. If no, it's never scaffolded, and `update` never adds it later.

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

## Post-scaffold hooks

Right after a new project finishes scaffolding, clispark checks for a single, globally-configured hook file and runs it automatically if present — useful for anything you always want to happen after a fresh project, without answering a wizard question every time (auto-creating a GitHub repo, copying in a company-standard CI config, registering the project in an internal catalog, and so on).

```bash
npx clispark hook
```

prints the exact file location for your OS and whether one is currently configured. The location is fixed and not configurable:

| OS | Location |
|---|---|
| Linux | `~/.config/clispark/hooks/post-scaffold.mjs` (or `$XDG_CONFIG_HOME/clispark/hooks/post-scaffold.mjs`) |
| macOS | `~/Library/Preferences/clispark/hooks/post-scaffold.mjs` |
| Windows | `%APPDATA%\clispark\Config\hooks\post-scaffold.mjs` |

If the file doesn't exist, nothing happens — most users will never have one. If it exists, it must be an ES module with a default-exported function (sync or async), which receives one argument:

```js
export default async function postScaffold({ projectName, targetDir, language, registryUrl, publishIntent }) {
  // your code here
}
```

If clispark has the `clispark` package installed as a dev dependency, the shape of that argument is available as a type: `import type { PostScaffoldHookContext } from 'clispark'`.

A failing hook (throws, rejects, or doesn't export a function) prints a clear warning but never affects the outcome of the scaffold itself — your new project is already fully created by the time the hook runs. Pass `--no-hook` to skip it for a single run even if one is configured.

**Example** — push the new project to a freshly created GitHub repo:

```js
// post-scaffold.mjs
import { execFileSync } from 'node:child_process';

export default function postScaffold({ projectName, targetDir }) {
  execFileSync('gh', ['repo', 'create', projectName, '--private', '--source', targetDir, '--push'], {
    cwd: targetDir,
    stdio: 'inherit',
  });
}
```

Hooks only run after a fresh `clispark` scaffold — never after `clispark update` or `clispark add`.

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
