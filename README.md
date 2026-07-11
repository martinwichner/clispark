# clispark

Interactive scaffolding tool for new CLI projects. Run `npx clispark` to generate a new, ready-to-run TypeScript CLI project with consistent logging, error handling, and command structure — no manual setup required.

## Status

✅ **Published on npm as [`clispark`](https://www.npmjs.com/package/clispark).**

| Milestone | Description | Status |
| --- | --- | --- |
| M1 | Generator scaffold (wizard, package-name availability check) | ✅ Done |
| M2 | Project-scaffold engine (file generation, git init, install & build) | ✅ Done |
| M2.5 | Generator's own logging & error handling (dogfooding) | ✅ Done |
| M3 | Core runtime features in generated boilerplate (auto command registration, logging, error handling, testing, example command) | ✅ Done |
| M4 | Private registry support (`.npmrc` generation, wired into scaffold's own `npm install`) | ✅ Done |
| M5 | Documentation (`ARCHITECTURE.md`) & release automation (CI, Conventional-Commits versioning, npm publish pipeline) | ✅ Done |
| M6 | Update mechanism for already-generated projects | 🔜 Next |

## Usage

```bash
npx clispark
```

The wizard asks a few questions (project name, work/private profile, registry URL if applicable), checks the chosen package name's availability, then scaffolds a new directory with a ready-to-run project — `git init`, `npm install`, and `npm run build` all happen automatically. If a custom registry URL was given, an `.npmrc` pointing at it is generated too, so the install (and every future one) uses it automatically.

## What you get

Every generated project includes:

- **oclif-based CLI structure** with convention-based command discovery — drop a file in `src/commands/`, no manual registration needed
- **Structured logging** (`pino`, one log file per invocation in an OS-appropriate log directory) that automatically covers every command
- **Consistent error handling** with no opt-out — clean `Error: <message>` output on failure, full stack trace captured in the log file
- **A working test setup** (`vitest` + `@oclif/test`) with an example test to copy from
- **A first example command** (`hello`) as a starting point for your own commands
- **A clean build pipeline** (`tsup`) producing a directly runnable binary

## Tech stack

**Generator itself (`clispark`):** TypeScript, [commander](https://github.com/tj/commander.js) (CLI structure), [@clack/prompts](https://github.com/bombshell-dev/clack) (interactive wizard), `cross-spawn` (cross-platform shelling out to git/npm), `pino` + `env-paths` (own logging), `tsup` + `vitest`.

**Generated boilerplate:** TypeScript, [oclif](https://oclif.io/) (command framework), `pino` + `env-paths` (logging), `tsup` (build), `vitest` + `@oclif/test` (testing).

## Releases

Releases are automated via [release-please](https://github.com/googleapis/release-please): every commit to `master` follows [Conventional Commits](https://www.conventionalcommits.org/) (`feat:` → minor, `fix:` → patch, `BREAKING CHANGE` → major), and release-please maintains a running "Release PR" with the version bump and changelog. Merging that PR creates a GitHub Release, which triggers the `publish.yml` workflow: it re-runs the full CI suite (tests, typecheck, build, security audit, a scaffold smoke test) against the release commit, then publishes to npm using [Trusted Publishing](https://docs.npmjs.com/trusted-publishers) (OIDC) — no long-lived npm token is stored anywhere.

release-please itself authenticates with a `RELEASE_PLEASE_TOKEN` (a fine-grained PAT), not the default `GITHUB_TOKEN` — GitHub suppresses workflow-triggering events caused by the default token, which would otherwise silently prevent `publish.yml` from ever firing after a release.

CI (`ci.yml`) runs on every push/PR: unit tests, typecheck, build, `npm audit --audit-level=high` (blocking on high/critical findings, which are also tracked as GitHub issues), and an end-to-end scaffold smoke test that generates a real project and runs its own test suite — the same kind of check previously done manually for each milestone.

## Development notes

This project is being built with the help of [Claude](https://claude.com/claude-code). Implementation plans are written before coding starts and committed alongside the code under [`docs/superpowers/plans/`](docs/superpowers/plans/), so the reasoning and step-by-step approach behind each milestone stays visible in version control.

Planning and execution follow the [Superpowers](https://github.com/obra/superpowers) skill set for Claude Code (brainstorming → writing-plans → subagent-driven-development) — credit to [obra](https://github.com/obra) for that workflow.

## License

[MIT](LICENSE)
