# Public Backlog Visibility via GitHub Issues — Design

**Date:** 2026-07-21
**Status:** Approved, not yet implemented

## Context

clispark has been technically public on npm/GitHub since 2026-07-11, but the actual backlog (M13 "Feature-Backlog" and similar sections) has only ever lived in `project-ideas/clispark.plan.md` — a local planning file outside the git repo, invisible to anyone but the maintainer. The repo's own "Offene Fragen" section had deliberately deferred issue templates/CONTRIBUTING.md as YAGNI "until someone actually knocks with a real issue/PR." The maintainer decided to revisit that now: since it's a public repo, other people should be able to see what's planned, and if someone does open an issue, there should be a lightweight way to fold it into planning without extra ceremony.

This spec covers three things:
1. A label taxonomy so backlog issues (and future issues generally) are consistently categorized.
2. Mirroring the current open M13 backlog items into GitHub issues (one-time action).
3. A local (not repo-tracked) script that periodically pulls in issues opened by people other than the maintainer, so they can be reviewed and folded into the backlog.

A fourth item — a `ROADMAP.md` — was discussed and is a recommended follow-up, explicitly out of scope for this spec's implementation (see "Out of Scope").

## 1. Label Taxonomy

New labels, additive to the existing GitHub defaults (`bug`, `documentation`, `duplicate`, `enhancement`, `good first issue`, `help wanted`, `invalid`, `question`, `wontfix`) and the existing audit-specific labels (`security-audit-blocking`, `security-audit-info`, both left untouched — they're referenced by exact string in `scripts/audit-issues.ts`).

| Label | Meaning |
|---|---|
| `type:feature` | New capability |
| `type:chore` | Maintenance, cleanup, non-feature fix |
| `type:docs` | Documentation-only work |
| `type:security` | Security-relevant backlog item not produced by the `npm audit` pipeline |
| `area:node` | Affects the Node/oclif template or its `LanguagePack` |
| `area:dotnet` | Affects the .NET/System.CommandLine template or its `LanguagePack` |
| `area:generator` | Affects the generator itself (wizard, scaffold, cli.ts, cross-language concerns) |
| `area:ci` | Affects GitHub Actions workflows |
| `status:backlog` | Raw idea, no design/spec yet |
| `status:needs-design` | Actively being scoped (brainstorming/spec in progress) |
| `status:planned` | Spec and implementation plan exist, work not started |
| `status:in-progress` | Implementation underway |
| `source:maintainer` | Opened by the maintainer |
| `source:community` | Opened by anyone else |
| `triaged` | Processing marker only (see §3) — has been pulled into `plan.md`'s community-suggestions section; not a category |

An issue that's "done" is simply closed — no `status:done` label.

Multiple labels are expected per issue (one from each applicable axis).

## 2. One-Time Backlog Mirroring

The 7 currently open M13 backlog items get mirrored as GitHub issues, in English, each labeled `source:maintainer`, `status:backlog`, one `type:*`, and one or more `area:*`:

| Item | Type | Area |
|---|---|---|
| SBOM generation | `type:feature` | `area:generator` |
| Wizard live preview | `type:feature` | `area:generator` |
| Background update check | `type:feature` | `area:generator` |
| Mermaid architecture diagram | `type:feature` | `area:generator` |
| Hook/plugin system | `type:feature` | `area:generator` |
| Opt-in lint tooling per language | `type:feature` | `area:generator`, `area:node`, `area:dotnet` |
| `audit-issues.ts` stale "Last checked" | `type:chore` | `area:ci` |

Each issue body notes it originated from a curation/brainstorming pass and — per this project's standing convention — needs its own design/spec before implementation begins.

This is a one-time, manually-executed action (label creation via `gh label create`, issue creation via `gh issue create`). No code, no CI, no test suite involvement. It does not get an implementation plan; it is executed directly once this spec is approved.

**Ongoing convention (not automation):** going forward, whenever a new item is worked out on `plan.md`'s backlog (the existing "keep plans updated" habit), the corresponding GitHub issue is created at the same time, labeled per §1. This is a process habit, not software.

## 3. Community Issue Ingestion (local script)

**Location:** `project-ideas/ingest-community-issues.mjs` — deliberately **outside** the `clispark` git repo. It references `project-ideas/clispark.plan.md`, a path specific to this maintainer's local planning setup that has no meaning for other clispark users or contributors; bundling it in the public repo (as `audit-issues.ts` is) would be misleading and untestable in that context. It is a personal workflow tool, run manually, never from CI.

**Trigger:** manual only — `node project-ideas/ingest-community-issues.mjs`, run by the maintainer whenever they choose to check for new community issues. No scheduling, no CI wiring.

**Dependencies:** the `gh` CLI (already required elsewhere in this workflow) via `child_process`; no other dependencies. Plain Node (`.mjs`, ESM, no build step) since it's not part of a package with its own toolchain.

**Logic:**
1. `gh issue list --repo martinwichner/clispark --state open --json number,title,url,author,labels`
2. Filter to issues where `author.login !== 'martinwichner'` (maintainer whitelist — the sole exclusion) **and** the issue's labels do not already include `triaged`.
3. For each matching issue, append one line to a new `plan.md` subsection titled `### Community-Vorschläge (noch nicht bewertet)` (placed directly after the M13 section), in the form:
   `- [ ] #<number> **<title>** von @<author>, erkannt am <YYYY-MM-DD> — <url>`
4. For each matching issue, apply `source:community` and `triaged` via `gh issue edit <number> --add-label source:community --add-label triaged`.
5. Print a one-line summary: how many new issues were found and appended, or "No new community issues found."

**Idempotency:** the `triaged` label is the sole state marker — no separate state file. Re-running the script is always safe; only issues without `triaged` are ever picked up. If `plan.md`'s community section is manually edited or an entry removed, the corresponding issue keeps its `triaged` label and will not resurface automatically — this is a deliberate, simple tradeoff (re-adding it back means manually removing the `triaged` label on GitHub).

**Review workflow (not automated):** the maintainer periodically reviews the "Community-Vorschläge" list with the assistant; ones worth pursuing get worked out into a proper backlog item (following the existing per-item design/spec convention) and get their own labeled GitHub issue per §1/§2's ongoing convention. Rejected/duplicate ones are simply removed from the list — their source issue can be closed or left as-is at the maintainer's discretion (outside this script's scope).

**Out of scope for the script:** it never comments on, closes, or otherwise modifies the community issue's title/body/state — only labels. It never modifies issues authored by the maintainer. It does not deduplicate against existing `plan.md` backlog items semantically (e.g. a community suggestion that happens to already exist as a maintainer item) — that judgment call happens in the periodic review, not the script.

**Internal structure:** mirroring `audit-issues.ts`'s dependency-injection convention, the script separates a pure core (filter issues by author/label, format the `plan.md` lines to append) from the side-effecting shell (the real `gh issue list`/`gh issue edit` calls and the file write). This keeps the filtering/formatting logic checkable without needing a live non-maintainer GitHub account (see Testing below).

**Testing escape hatch:** since the maintainer has no second GitHub account to genuinely author a "community" issue with, and the author check (`author.login !== 'martinwichner'`) is the crux of the filter, the script supports an env var `INGEST_TEST_INCLUDE_SELF=1` that disables the author check only (the `triaged`-label check still applies normally). This is a permanent, documented testing knob — not removed after initial verification — so the maintainer can re-verify the real `gh` round-trip end-to-end after any future change to this script, using one of their own disposable test issues, without ever needing a second account.

## 4. ROADMAP.md (recommended follow-up, out of scope here)

A short, curated `ROADMAP.md` at the repo root would give casual visitors a narrative entry point without requiring them to filter issues by label: a "Recently shipped" section (drawn from `CHANGELOG.md`), a "Now / Up next" section (linking to the `status:planned`/`status:in-progress` label searches), and a "Backlog ideas" section (linking to `status:backlog`). Manually maintained, no automation. Deliberately **not** part of this spec's implementation — a small, separate follow-up once §1–§3 have landed and the label taxonomy has proven itself in practice.

## Out of Scope

- Any bidirectional or automated sync between `plan.md` and GitHub issues beyond what's described above (rejected during design — see design conversation; the maintainer explicitly wants the lightweight "we discuss it, then I create the issue" habit, not a sync engine).
- Issue templates / `CONTRIBUTING.md` (still separately YAGNI'd — not reopened by this spec).
- A public "community suggestions tracker" meta-issue on GitHub (considered and rejected in favor of keeping the collected list in `plan.md` only).
- Renaming or restructuring the existing `security-audit-blocking`/`security-audit-info` labels.
- `ROADMAP.md` (see §4).

## Testing / Verification

- §1/§2 (labels + issue mirroring): verified by inspection after running the `gh label create`/`gh issue create` commands — `gh label list` and `gh issue list` show the expected state. No automated test suite applies (not code).
- §3 (ingestion script): being outside the repo, it does not participate in clispark's own `vitest`/CI. Verification happens in two layers: (1) the pure filter/format core is exercised directly with a fabricated `gh issue list`-shaped JSON fixture containing a mix of maintainer-authored, already-`triaged`, and genuine "new community" (fake non-maintainer author) entries, confirming only the last group is selected and formatted correctly — a one-off manual check run once during implementation, not a permanent suite; (2) the real `gh` calls (list/edit) and the real file append are exercised end-to-end against one real disposable issue the maintainer opens themselves, using `INGEST_TEST_INCLUDE_SELF=1` (see §3) so the real author-owned issue is treated as eligible — confirming the `plan.md` section is appended correctly and the labels land on GitHub. Running it a second time (still with the env var set) must then confirm nothing duplicates, since the `triaged` label is now present. The disposable test issue is closed/cleaned up afterward.
