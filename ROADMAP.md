# Roadmap

A quick look at where clispark is headed. This is maintained by hand, not automatically synced — it may lag behind the issue tracker slightly.

## Recently shipped

- **v1.16.0** — [`clispark add`](https://github.com/martinwichner/clispark/releases/tag/v1.16.0): interactively add a new command (top-level or nested, with typed parameters) to an already-scaffolded Node or .NET project
- **v1.15.0** — [.NET / C# template](https://github.com/martinwichner/clispark/releases/tag/v1.15.0) (System.CommandLine)
- **v1.14.0** — [confetti](https://github.com/martinwichner/clispark/releases/tag/v1.14.0) after a successful scaffold or update
- **v1.11.0–v1.13.0** — `clispark whoami` easter egg (a joke or a fun fact about your machine)

See [CHANGELOG.md](./CHANGELOG.md) for the full history.

## Now / up next

Nothing is in active implementation right now. Once something moves from an idea to an active build, it'll show up here and get a [`status:planned`/`status:in-progress` issue](https://github.com/martinwichner/clispark/issues?q=is%3Aissue+is%3Aopen+label%3A%22status%3Aplanned%22%2C%22status%3Ain-progress%22).

## Backlog ideas

Raw ideas, not yet designed — see the [`status:backlog` label](https://github.com/martinwichner/clispark/issues?q=is%3Aissue+is%3Aopen+label%3A%22status%3Abacklog%22) for the live list:

- [SBOM generation](https://github.com/martinwichner/clispark/issues/65)
- [Wizard live preview](https://github.com/martinwichner/clispark/issues/66)
- [Background update check](https://github.com/martinwichner/clispark/issues/67)
- [Mermaid architecture diagram](https://github.com/martinwichner/clispark/issues/68)
- [Hook/plugin system](https://github.com/martinwichner/clispark/issues/69)
- [Opt-in lint/convention tooling per language](https://github.com/martinwichner/clispark/issues/70)
- [`audit-issues.ts`: stale "Last checked" timestamp](https://github.com/martinwichner/clispark/issues/71)

Every item here needs its own design pass before implementation starts — that's intentional, not a sign it's stalled.

## Got an idea?

Feel free to [open an issue](https://github.com/martinwichner/clispark/issues/new). It'll be picked up and triaged periodically rather than immediately — this is a one-person project maintained in spare time.
