# Python Template (`pythonPack`, #136) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `pythonPack: LanguagePack` — a fourth clispark template that scaffolds a Python CLI tool (Typer + `uv` + `structlog`), with the same lean v1 scope the PowerShell template shipped with (scaffold, `clispark update`, PyPI name check, `clispark add`; no lint-tooling opt-in, no command-convention rule).

**Architecture:** `pythonPack` implements the existing `LanguagePack` interface exactly like `powershellPack` — zero changes to `wizard.ts`/`scaffold.ts`/`update.ts`/`add.ts`/`manifest.ts`. Four new source-side pieces (`src/languages/packs/python.ts`, `src/update/adapters/python.ts`, `src/languages/registry-checkers/pypi.ts`, `src/languages/command-generators/python.ts`) plus one new template tree (`templates/python/`). Command auto-discovery mirrors Node/oclif's convention (folder path = command path), implemented via a real, session-verified `discover.py` filesystem walk + `BaseCommand` wrapper providing automatic `structlog` logging.

**Tech Stack:** Typer (CLI framework), `uv` (packaging/dependency management, `hatchling` build backend), `structlog` (logging), `pytest` (testing), `smol-toml` (TOML parsing on the TypeScript side).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-07-clispark-python-template-design.md` — read it first, this plan assumes its decisions.
- Fixed importable package directory name: **`cli/`** (not project-name-derived) — required so `UpdateAdapter.coreFilePaths()` (a static, project-name-unaware list) can reference it. See spec's "Echter Architektur-Fund" section for why.
- Project name validation: kebab-case, reuse `nodeOclifPack`'s exact regex (`^[a-z0-9]+(-[a-z0-9]+)*$`) — no Python-specific naming rule needed once the package dir is fixed.
- v1 scope is lean: `stripLintTooling`, `stripAutocompleteSupport`, `stripCommandConvention` are all permanent no-ops (`async () => {}`), `supportsAutocompleteOptIn: false`. Do not build lint-tooling or command-convention support in this plan — separate future issues.
- Every command parameter (`ParameterSpec`) maps to a **bare Python function parameter**, not an explicit `typer.Argument()`/`typer.Option()` wrapper: no-default params become positional CLI arguments, defaulted params become `--flag` options — this is Typer's own type-hint-driven inference, verified working in this session's prototype.
- Manifest file is `pyproject.toml`, read via `smol-toml`'s `parse()` (robust parsing) but **written via targeted regex field replacement on the raw string**, not full re-serialization — preserves user comments/formatting, same principle the existing `.csproj`/`.psd1` adapters use for exactly this reason.
- Real verification was run for the core mechanism in this session (folder-based Typer sub-app discovery, `BaseCommand` + `structlog` auto-logging, PyPI's 200/404 API behavior, and a full `uv sync` + `uv run pytest` + installed console-script round trip). Reuse that verified code — don't redesign it.
- `requires-python = ">=3.10"` — real-verified against both dependencies' PyPI `requires_python` metadata (Typer 0.27.1 and structlog 26.1.0 both require `>=3.10`), not a guess.
- Keep Typer's default exception-traceback rendering (don't set `pretty_exceptions_enable=False`) — the spec's open point #1, resolved: our own `failed` structlog line already appears before Typer's traceback, consistent with the "throw, don't swallow" principle the other three templates already follow.

---

## Task 1: Template runtime core — discovery, BaseCommand, example command

**Files:**
- Create: `templates/python/cli/__init__.py`
- Create: `templates/python/cli/base_command.py`
- Create: `templates/python/cli/discover.py`
- Create: `templates/python/cli/cli.py`
- Create: `templates/python/cli/commands/__init__.py`
- Create: `templates/python/cli/commands/hello.py`
- Create: `templates/python/tests/test_hello.py`
- Create: `templates/python/pyproject.toml`

**Interfaces:**
- Produces: a working Typer CLI tree rooted at `cli.cli:app`, importable and runnable via `uv run <project-name> hello --name X`.

This task has no TypeScript to unit-test — it's Python content, copied verbatim by `scaffold.ts`. Verification is a **real run**, not a mocked test.

- [ ] **Step 1: Create the package skeleton**

`templates/python/cli/__init__.py` — empty file.

`templates/python/cli/commands/__init__.py` — empty file.

- [ ] **Step 2: Write `base_command.py`**

```python
from __future__ import annotations

import time
from abc import ABC, abstractmethod

import structlog

logger = structlog.get_logger()


class BaseCommand(ABC):
    """Every command subclasses this. run() carries the logic; __call__ wraps
    it with automatic start/completed/failed structured logging."""

    command_name: str

    @abstractmethod
    def run(self, **kwargs) -> None: ...

    def __call__(self, **kwargs) -> None:
        log = logger.bind(command=self.command_name)
        start = time.monotonic()
        log.info("started", **kwargs)
        try:
            self.run(**kwargs)
        except Exception as exc:
            duration_ms = round((time.monotonic() - start) * 1000, 1)
            log.error("failed", error=str(exc), duration_ms=duration_ms)
            raise
        duration_ms = round((time.monotonic() - start) * 1000, 1)
        log.info("completed", duration_ms=duration_ms)
```

- [ ] **Step 3: Write `discover.py`**

```python
from __future__ import annotations

import importlib
from pathlib import Path

import typer


def build_command_tree(commands_dir: Path, package_name: str) -> typer.Typer:
    root = typer.Typer()
    _mount_dir(root, commands_dir, package_name)
    return root


def _mount_dir(parent_app: typer.Typer, dir_path: Path, package_name: str) -> None:
    for entry in sorted(dir_path.iterdir()):
        if entry.is_dir() and (entry / "__init__.py").exists():
            group_app = typer.Typer()
            _mount_dir(group_app, entry, f"{package_name}.{entry.name}")
            parent_app.add_typer(group_app, name=entry.name)
        elif entry.suffix == ".py" and entry.stem != "__init__":
            module = importlib.import_module(f"{package_name}.{entry.stem}")
            leaf_app = getattr(module, "app")
            parent_app.add_typer(leaf_app, name=entry.stem)
```

- [ ] **Step 4: Write `cli.py`**

```python
from pathlib import Path

import structlog

from cli.discover import build_command_tree

structlog.configure(
    processors=[
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.KeyValueRenderer(key_order=["event", "command"]),
    ]
)

app = build_command_tree(Path(__file__).parent / "commands", "cli.commands")
```

- [ ] **Step 5: Write the example `hello` command**

`templates/python/cli/commands/hello.py`:

```python
import typer

from cli.base_command import BaseCommand

app = typer.Typer()


class HelloCommand(BaseCommand):
    command_name = "hello"

    def run(self, name: str = "world") -> None:
        typer.echo(f"Hello, {name}!")


@app.callback(invoke_without_command=True)
def hello(name: str = typer.Option("world", "--name")) -> None:
    HelloCommand()(name=name)
```

- [ ] **Step 6: Write the example test**

`templates/python/tests/test_hello.py`:

```python
from typer.testing import CliRunner

from cli.cli import app

runner = CliRunner()


def test_hello_runs_successfully():
    result = runner.invoke(app, ["hello", "--name", "Martin"])
    assert result.exit_code == 0
    assert "Hello, Martin!" in result.stdout
```

- [ ] **Step 7: Write `pyproject.toml`**

`{{projectName}}` is substituted by `scaffold.ts` at scaffold time (see `applyPlaceholders` in `src/scaffold.ts`) — every occurrence becomes the real, kebab-case project name.

```toml
[project]
name = "{{projectName}}"
version = "0.1.0"
description = ""
requires-python = ">=3.10"
dependencies = [
    "typer>=0.12",
    "structlog>=24.1",
]

[project.scripts]
{{projectName}} = "cli.cli:app"

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["cli"]

[dependency-groups]
dev = [
    "pytest>=8.0",
]
```

- [ ] **Step 8: Real verification — run it for real**

This is the test cycle for this task (no vitest involved, this is Python content). Run from a scratch directory (adjust paths to your machine; `uv` must be on PATH, or installed via `pip install uv` into a throwaway venv):

```bash
mkdir /tmp/python-template-check && cd /tmp/python-template-check
cp -r <clispark-repo>/templates/python/* .
mv gitignore .gitignore 2>/dev/null || true
sed -i 's/{{projectName}}/demo-tool/g' pyproject.toml
uv sync
uv run pytest -q
uv run demo-tool hello --name Martin
```

Expected:
- `uv sync` resolves and installs cleanly (Typer, structlog, pytest — no errors).
- `pytest -q` reports `1 passed`.
- `uv run demo-tool hello --name Martin` prints a `started`/`completed` structlog line pair around `Hello, Martin!`.

This exact sequence was run successfully in the design session against this exact file layout — if it fails here, something was mistyped when copying the code above, not a design problem.

- [ ] **Step 9: Commit**

```bash
git add templates/python
git commit -m "feat: add Python template runtime core (discovery, BaseCommand, hello example)"
```

---

## Task 2: Template docs and gitignore

**Files:**
- Create: `templates/python/gitignore`
- Create: `templates/python/README.md`
- Create: `templates/python/ARCHITECTURE.md`

**Interfaces:**
- Consumes: nothing from Task 1's code, but describes it.

- [ ] **Step 1: Write `gitignore`**

(Copied to `.gitignore` by `scaffold.ts`'s `copyTemplate` — see the `rename` call in `src/scaffold.ts`.)

```
.venv/
__pycache__/
*.pyc
.pytest_cache/
dist/
*.egg-info/
```

- [ ] **Step 2: Write `README.md`**

```markdown
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
```

- [ ] **Step 3: Write `ARCHITECTURE.md`**

```markdown
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
```

- [ ] **Step 4: Commit**

```bash
git add templates/python
git commit -m "docs: add Python template README and ARCHITECTURE.md"
```

---

## Task 3: PyPI `RegistryChecker`

**Files:**
- Create: `src/languages/registry-checkers/pypi.ts`
- Test: `src/languages/registry-checkers/pypi.test.ts`

**Interfaces:**
- Produces: `pypiRegistryChecker: RegistryChecker` and `PYPI_DEFAULT_URL: string`, consumed by Task 6 (`pythonPack`).
- Consumes: `RegistryChecker`/`NameCheckResult` from `src/languages/registry-checker.ts` (existing).

- [ ] **Step 1: Write the failing tests**

```ts
// src/languages/registry-checkers/pypi.test.ts
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pypiRegistryChecker, PYPI_DEFAULT_URL } from './pypi';

describe('pypiRegistryChecker.checkNameAvailability', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns "available" when PyPI responds 404', async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 404 } as Response);
    const result = await pypiRegistryChecker.checkNameAvailability('some-free-name', PYPI_DEFAULT_URL);
    expect(result).toBe('available');
    expect(global.fetch).toHaveBeenCalledWith(
      `${PYPI_DEFAULT_URL}/some-free-name/json`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('returns "taken" when PyPI responds 200', async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 200 } as Response);
    const result = await pypiRegistryChecker.checkNameAvailability('requests', PYPI_DEFAULT_URL);
    expect(result).toBe('taken');
  });

  it('returns "unverified" on an unexpected status code', async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 500 } as Response);
    const result = await pypiRegistryChecker.checkNameAvailability('some-name', PYPI_DEFAULT_URL);
    expect(result).toBe('unverified');
  });

  it('returns "unverified" when the network request throws', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network down'));
    const result = await pypiRegistryChecker.checkNameAvailability('some-name', PYPI_DEFAULT_URL);
    expect(result).toBe('unverified');
  });
});

describe('pypiRegistryChecker.applyPrivateIntent', () => {
  it('is a documented no-op: resolves without touching the filesystem', async () => {
    await expect(pypiRegistryChecker.applyPrivateIntent('/tmp/whatever')).resolves.toBeUndefined();
  });
});

describe('pypiRegistryChecker.applyRegistryUrl', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(path.join(tmpdir(), 'clispark-pypi-registry-checker-test-'));
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it('writes a uv.toml with a custom index pointing at the given URL', async () => {
    await pypiRegistryChecker.applyRegistryUrl(tmpRoot, 'https://pypi.example.internal/simple');

    const content = await readFile(path.join(tmpRoot, 'uv.toml'), 'utf8');
    expect(content).toContain('https://pypi.example.internal/simple');
    expect(content).toContain('[[index]]');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- pypi.test.ts`
Expected: FAIL — `Cannot find module './pypi'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/languages/registry-checkers/pypi.ts
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { NameCheckResult, RegistryChecker } from '../registry-checker';

export const PYPI_DEFAULT_URL = 'https://pypi.org/pypi';

const FETCH_TIMEOUT_MS = 5000;

async function checkNameAvailability(name: string, registryUrl: string): Promise<NameCheckResult> {
  const url = `${registryUrl.replace(/\/$/, '')}/${encodeURIComponent(name)}/json`;

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (response.status === 404) return 'available';
    if (response.status === 200) return 'taken';
    return 'unverified';
  } catch {
    return 'unverified';
  }
}

async function applyPrivateIntent(): Promise<void> {
  // Genuine no-op, same reasoning as the PowerShell Gallery checker: PyPI has no manifest
  // field that prevents accidental publishing (unlike npm's "private" or NuGet's
  // <IsPackable>false</IsPackable>) -- "don't publish this" is enforced by simply never
  // running `uv publish`, not by a pyproject.toml flag.
}

async function applyRegistryUrl(targetDir: string, registryUrl: string): Promise<void> {
  const content = [
    '# Custom package index for this project.',
    '# See https://docs.astral.sh/uv/configuration/indexes/ for details.',
    '',
    '[[index]]',
    'name = "custom"',
    `url = "${registryUrl}"`,
    'default = true',
    '',
  ].join('\n');
  await writeFile(path.join(targetDir, 'uv.toml'), content);
}

export const pypiRegistryChecker: RegistryChecker = {
  checkNameAvailability,
  applyPrivateIntent,
  applyRegistryUrl,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- pypi.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/languages/registry-checkers/pypi.ts src/languages/registry-checkers/pypi.test.ts
git commit -m "feat: add PyPI registry checker"
```

---

## Task 4: `smol-toml` dependency + Python `UpdateAdapter`

**Files:**
- Modify: `package.json` (add `smol-toml` dependency)
- Create: `src/update/adapters/python.ts`
- Test: `src/update/adapters/python.test.ts`

**Interfaces:**
- Consumes: `UpdateAdapter`, `CoreFieldsExtraction`, `ManifestFileMergeResult` from `src/update/adapter.ts`; `Manifest` from `src/update/manifest.ts`; `reconcileEntry`, `stringEquals`, `FieldOutcome` from `src/update/reconcile.ts` (all existing).
- Produces: `pythonAdapter: UpdateAdapter`, `PyprojectFile` type, `parsePyprojectFile()`, `CORE_FILE_PATHS` — consumed by Task 6.

- [ ] **Step 1: Add the dependency**

```bash
npm install smol-toml
```

Verify `package.json`'s `dependencies` now includes `"smol-toml": "^1.7.1"` (or whatever `npm install` resolved).

- [ ] **Step 2: Write the failing tests**

```ts
// src/update/adapters/python.test.ts
import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Manifest } from '../manifest';
import { pythonAdapter, parsePyprojectFile, CORE_FILE_PATHS } from './python';

const SAMPLE_PYPROJECT = `[project]
name = "demo-tool"
version = "0.1.0"
description = ""
requires-python = ">=3.10"
dependencies = [
    "typer>=0.12",
    "structlog>=24.1",
]

[project.scripts]
demo-tool = "cli.cli:app"

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["cli"]
`;

describe('parsePyprojectFile', () => {
  it('extracts name, version, and dependencies from a real pyproject.toml', () => {
    const parsed = parsePyprojectFile(SAMPLE_PYPROJECT);
    expect(parsed.name).toBe('demo-tool');
    expect(parsed.version).toBe('0.1.0');
    expect(parsed.dependencies).toEqual(['typer>=0.12', 'structlog>=24.1']);
    expect(parsed.raw).toBe(SAMPLE_PYPROJECT);
  });

  it('throws when [project].name is missing', () => {
    expect(() => parsePyprojectFile('[project]\nversion = "0.1.0"\n')).toThrow(/name/);
  });
});

describe('pythonAdapter.coreFilePaths', () => {
  it('returns a fixed list regardless of flags', () => {
    const paths = pythonAdapter.coreFilePaths({ lintEnabled: true, autocompleteEnabled: true, commandConventionEnabled: true });
    expect(paths).toEqual(CORE_FILE_PATHS);
    expect(paths).toContain('cli/base_command.py');
    expect(paths).toContain('cli/discover.py');
    expect(paths).toContain('cli/cli.py');
  });
});

describe('pythonAdapter manifest file round trip', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(path.join(tmpdir(), 'clispark-python-adapter-test-'));
    await writeFile(path.join(tmpRoot, 'pyproject.toml'), SAMPLE_PYPROJECT);
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it('reads the real file from disk', async () => {
    const manifestFile = await pythonAdapter.readManifestFile(tmpRoot);
    expect(pythonAdapter.readProjectName(manifestFile)).toBe('demo-tool');
  });

  it('writes the raw content back unchanged when nothing changed', async () => {
    const manifestFile = await pythonAdapter.readManifestFile(tmpRoot);
    await pythonAdapter.writeManifestFile(tmpRoot, manifestFile);
    const written = await readFile(path.join(tmpRoot, 'pyproject.toml'), 'utf8');
    expect(written).toBe(SAMPLE_PYPROJECT);
  });
});

describe('pythonAdapter.mergeManifestFile', () => {
  const baseOldManifest: Manifest = {
    generatorVersion: '1.0.0',
    language: 'python',
    lintEnabled: false,
    autocompleteEnabled: false,
    commandConventionEnabled: false,
    coreFiles: {},
    coreDependencies: { typer: '>=0.12', structlog: '>=24.1' },
    coreScripts: {},
    coreFields: { version: '0.1.0' },
  };

  it('adds a new core dependency the user has not touched', () => {
    const current = parsePyprojectFile(SAMPLE_PYPROJECT);
    const newTemplate = parsePyprojectFile(
      SAMPLE_PYPROJECT.replace('"structlog>=24.1",', '"structlog>=24.1",\n    "rich>=13.0",'),
    );

    const result = pythonAdapter.mergeManifestFile(current, baseOldManifest, newTemplate);

    expect(result.changed).toBe(true);
    expect((result.updatedFile as ReturnType<typeof parsePyprojectFile>).dependencies).toContain('rich>=13.0');
    expect(result.dependencies).toContainEqual({ key: 'rich', outcome: 'added' });
  });

  it('preserves a dependency the user added on their own, even if the template does not know about it', () => {
    const current = parsePyprojectFile(SAMPLE_PYPROJECT.replace('"structlog>=24.1",', '"structlog>=24.1",\n    "requests>=2.0",'));
    const newTemplate = parsePyprojectFile(SAMPLE_PYPROJECT);

    const result = pythonAdapter.mergeManifestFile(current, baseOldManifest, newTemplate);

    expect((result.updatedFile as ReturnType<typeof parsePyprojectFile>).dependencies).toContain('requests>=2.0');
  });

  it('replaces a core dependency version bump the user never touched', () => {
    const current = parsePyprojectFile(SAMPLE_PYPROJECT);
    const newTemplate = parsePyprojectFile(SAMPLE_PYPROJECT.replace('typer>=0.12', 'typer>=0.13'));

    const result = pythonAdapter.mergeManifestFile(current, baseOldManifest, newTemplate);

    expect(result.changed).toBe(true);
    expect((result.updatedFile as ReturnType<typeof parsePyprojectFile>).dependencies).toContain('typer>=0.13');
    expect(result.dependencies).toContainEqual({ key: 'typer', outcome: 'replaced' });
  });

  it('does not touch a core dependency the user has manually edited', () => {
    const current = parsePyprojectFile(SAMPLE_PYPROJECT.replace('typer>=0.12', 'typer==0.11.9'));
    const newTemplate = parsePyprojectFile(SAMPLE_PYPROJECT.replace('typer>=0.12', 'typer>=0.13'));

    const result = pythonAdapter.mergeManifestFile(current, baseOldManifest, newTemplate);

    expect((result.updatedFile as ReturnType<typeof parsePyprojectFile>).dependencies).toContain('typer==0.11.9');
    expect(result.dependencies).toContainEqual({ key: 'typer', outcome: 'skipped' });
  });

  it('bumps [project].version when the user never touched it', () => {
    const current = parsePyprojectFile(SAMPLE_PYPROJECT);
    const newTemplate = parsePyprojectFile(SAMPLE_PYPROJECT.replace('version = "0.1.0"', 'version = "0.2.0"'));
    const oldManifest = { ...baseOldManifest, coreFields: { version: '0.1.0' } };

    const result = pythonAdapter.mergeManifestFile(current, oldManifest, newTemplate);

    expect(result.changed).toBe(true);
    expect((result.updatedFile as ReturnType<typeof parsePyprojectFile>).version).toBe('0.2.0');
    expect((result.updatedFile as ReturnType<typeof parsePyprojectFile>).raw).toContain('version = "0.2.0"');
  });

  it('does not revert a version the user has manually bumped past the template', () => {
    // Regression test for a real bug caught during plan review: reconcileEntry's 'skipped'
    // branch returns the OLD manifest snapshot value, not the user's current live value --
    // writing that back unconditionally would silently revert a manual version bump. The old
    // manifest still says '0.1.0' (never updated after the user's own edit); the user has
    // since manually bumped their live pyproject.toml to '3.0.0'; the template only offers
    // '0.2.0', which is older than what the user already has.
    const current = parsePyprojectFile(SAMPLE_PYPROJECT.replace('version = "0.1.0"', 'version = "3.0.0"'));
    const newTemplate = parsePyprojectFile(SAMPLE_PYPROJECT.replace('version = "0.1.0"', 'version = "0.2.0"'));
    const oldManifest = { ...baseOldManifest, coreFields: { version: '0.1.0' } };

    const result = pythonAdapter.mergeManifestFile(current, oldManifest, newTemplate);

    expect((result.updatedFile as ReturnType<typeof parsePyprojectFile>).version).toBe('3.0.0');
    expect((result.updatedFile as ReturnType<typeof parsePyprojectFile>).raw).toContain('version = "3.0.0"');
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- python.test.ts`
Expected: FAIL — `Cannot find module './python'`.

- [ ] **Step 4: Write the implementation**

```ts
// src/update/adapters/python.ts
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'smol-toml';
import type { Manifest } from '../manifest';
import type { CoreFieldsExtraction, ManifestFileMergeResult, UpdateAdapter } from '../adapter';
import { reconcileEntry, stringEquals, type FieldOutcome } from '../reconcile';

// pyproject.toml is deliberately NOT in this list -- it has its own dedicated
// read/write/merge path via manifestFileName/readManifestFile/writeManifestFile/mergeManifestFile
// below, exactly like package.json/Cli.csproj/Module.psd1 are excluded from their own adapters'
// CORE_FILE_PATHS. `cli/` is a fixed package directory name (not derived from the project name)
// -- see the spec's "Echter Architektur-Fund" section for why a src/<project>/ layout would break
// this static list.
export const CORE_FILE_PATHS = ['cli/base_command.py', 'cli/discover.py', 'cli/cli.py', 'ARCHITECTURE.md', '.gitignore'] as const;

export interface PyprojectFile {
  raw: string;
  name: string;
  version: string;
  dependencies: string[];
}

interface ParsedPyproject {
  project?: { name?: string; version?: string; dependencies?: string[] };
}

export function parsePyprojectFile(rawContent: string): PyprojectFile {
  const parsed = parse(rawContent) as ParsedPyproject;
  if (!parsed.project?.name) throw new Error('pyproject.toml is missing [project].name');
  if (!parsed.project?.version) throw new Error('pyproject.toml is missing [project].version');
  return {
    raw: rawContent,
    name: parsed.project.name,
    version: parsed.project.version,
    dependencies: parsed.project.dependencies ?? [],
  };
}

// PEP 508 dependency strings embed the version spec in the same string (e.g. "typer>=0.12"),
// unlike npm/NuGet's separate name/version fields -- split so reconciliation can key by name,
// the same way the Node/.NET adapters do, without falsely treating a version bump as
// "unrelated new entry" (a full-string comparison would).
function parseDependency(dep: string): { name: string; spec: string } {
  const match = dep.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)\s*(.*)$/);
  if (!match) throw new Error(`Could not parse dependency string: "${dep}"`);
  return { name: match[1], spec: match[2].trim() };
}

function dependencyMap(deps: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const dep of deps) {
    const { name, spec } = parseDependency(dep);
    map.set(name, spec);
  }
  return map;
}

function setVersion(content: string, version: string): string {
  return content.replace(/^version = "[^"]*"/m, `version = "${version}"`);
}

function setDependencies(content: string, dependencies: string[]): string {
  const formatted = dependencies.map((d) => `    "${d}",`).join('\n');
  return content.replace(/^dependencies = \[[\s\S]*?\n\]/m, `dependencies = [\n${formatted}\n]`);
}

function extractCoreFields(pyproject: PyprojectFile): CoreFieldsExtraction {
  const coreDependencies: Record<string, string> = {};
  for (const dep of pyproject.dependencies) {
    const { name, spec } = parseDependency(dep);
    coreDependencies[name] = spec;
  }
  return { coreDependencies, coreScripts: {}, coreFields: { version: pyproject.version } };
}

function mergeManifestFile(current: PyprojectFile, oldManifest: Manifest, newTemplate: PyprojectFile): ManifestFileMergeResult {
  let raw = current.raw;
  let changed = false;

  const currentMap = dependencyMap(current.dependencies);
  const newMap = dependencyMap(newTemplate.dependencies);
  const mergedMap = new Map(currentMap);

  const dependencies: FieldOutcome[] = [];
  const coreDependencies: Record<string, string> = {};

  for (const [name, newSpec] of newMap) {
    const currentSpec = currentMap.get(name);
    const oldSpec = oldManifest.coreDependencies[name];
    const result = reconcileEntry(currentSpec, oldSpec, newSpec, stringEquals);
    dependencies.push({ key: name, outcome: result.outcome });
    coreDependencies[name] = result.value;
    // Guard mirrors node-oclif.ts's mergePackageJson: on 'skipped', reconcileEntry's returned
    // value is the OLD manifest snapshot, not the user's actual live edit -- writing it here
    // would silently clobber a manually-pinned dependency version. Only apply the result to
    // the file when the outcome isn't 'skipped'; coreDependencies (the *next* manifest
    // snapshot) still records result.value either way, same as Node's adapter.
    if (result.outcome !== 'skipped') {
      mergedMap.set(name, result.value);
    }
  }

  const mergedDeps = [...mergedMap.entries()].map(([name, spec]) => (spec ? `${name}${spec}` : name));
  if (mergedDeps.join('\n') !== current.dependencies.join('\n')) {
    changed = true;
    raw = setDependencies(raw, mergedDeps);
  }

  const oldCoreFields = oldManifest.coreFields as { version?: string };
  const versionResult = reconcileEntry(current.version, oldCoreFields.version, newTemplate.version, stringEquals);
  // Same 'skipped' guard as above: on 'skipped', versionResult.value is the OLD manifest
  // snapshot, not the user's real current version -- write it back only when the outcome
  // isn't 'skipped', otherwise the file (and updatedFile.version, which must match raw)
  // keeps the user's actual live version.
  let writtenVersion = current.version;
  if (versionResult.outcome !== 'skipped' && versionResult.value !== current.version) {
    changed = true;
    raw = setVersion(raw, versionResult.value);
    writtenVersion = versionResult.value;
  }

  return {
    updatedFile: { ...current, raw, dependencies: mergedDeps, version: writtenVersion },
    changed,
    dependencies,
    scripts: [],
    fields: [],
    coreDependencies,
    coreScripts: {},
    coreFields: { version: versionResult.value },
  };
}

export const pythonAdapter: UpdateAdapter = {
  coreFilePaths() {
    return CORE_FILE_PATHS;
  },

  templateSourcePath(relativePath) {
    return relativePath === '.gitignore' ? 'gitignore' : relativePath;
  },

  manifestFileName: 'pyproject.toml',

  async readManifestFile(dir) {
    const raw = await readFile(path.join(dir, 'pyproject.toml'), 'utf8');
    return parsePyprojectFile(raw);
  },

  async writeManifestFile(dir, content) {
    await writeFile(path.join(dir, 'pyproject.toml'), (content as PyprojectFile).raw);
  },

  parseManifestFile: parsePyprojectFile,

  readProjectName(manifestFile) {
    return (manifestFile as PyprojectFile).name;
  },

  extractCoreFields(manifestFile) {
    return extractCoreFields(manifestFile as PyprojectFile);
  },

  mergeManifestFile(current, oldManifest, newTemplate) {
    return mergeManifestFile(current as PyprojectFile, oldManifest, newTemplate as PyprojectFile);
  },
};
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- python.test.ts`
Expected: PASS (all tests).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/update/adapters/python.ts src/update/adapters/python.test.ts
git commit -m "feat: add Python UpdateAdapter (pyproject.toml read/write/merge)"
```

---

## Task 5: Python `CommandGenerator`

**Files:**
- Create: `src/languages/command-generators/python.ts`
- Test: `src/languages/command-generators/python.test.ts`

**Interfaces:**
- Consumes: `CommandGenerator`, `CommandSpec`, `ExistingCommandNode`, `GeneratedFiles`, `ParameterSpec`, `buildCommandTree` from `src/languages/command-generator.ts` (existing).
- Produces: `pythonCommandGenerator: CommandGenerator` — consumed by Task 6.

- [ ] **Step 1: Write the failing tests**

```ts
// src/languages/command-generators/python.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { CommandSpec } from '../command-generator';
import { pythonCommandGenerator } from './python';

describe('pythonCommandGenerator.generateCommand', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(path.join(tmpdir(), 'clispark-python-generator-test-'));
    await mkdir(path.join(tmpRoot, 'cli', 'commands'), { recursive: true });
    await writeFile(path.join(tmpRoot, 'cli', 'commands', '__init__.py'), '');
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it('generates a top-level command file and test file', async () => {
    const spec: CommandSpec = {
      pathSegments: ['greet'],
      parameters: [{ name: 'name', type: 'string', required: true }],
    };

    const result = await pythonCommandGenerator.generateCommand(tmpRoot, spec);

    expect(result.commandFile).toBe(path.join('cli', 'commands', 'greet.py'));
    expect(result.testFile).toBe(path.join('tests', 'test_greet.py'));

    const content = await readFile(path.join(tmpRoot, result.commandFile), 'utf8');
    expect(content).toContain('class GreetCommand(BaseCommand):');
    expect(content).toContain('def greet(name: str)');
  });

  it('creates intermediate __init__.py files for nested commands', async () => {
    const spec: CommandSpec = {
      pathSegments: ['task', 'create'],
      parameters: [{ name: 'title', type: 'string', required: true }],
    };

    const result = await pythonCommandGenerator.generateCommand(tmpRoot, spec);

    expect(result.commandFile).toBe(path.join('cli', 'commands', 'task', 'create.py'));
    const initExists = await readFile(path.join(tmpRoot, 'cli', 'commands', 'task', '__init__.py'), 'utf8');
    expect(initExists).toBe('');
  });

  it('orders required parameters before optional ones (Python syntax requires it)', async () => {
    const spec: CommandSpec = {
      pathSegments: ['build'],
      parameters: [
        { name: 'verbose', type: 'boolean', required: false },
        { name: 'target', type: 'string', required: true },
      ],
    };

    const result = await pythonCommandGenerator.generateCommand(tmpRoot, spec);
    const content = await readFile(path.join(tmpRoot, result.commandFile), 'utf8');
    const defLine = content.split('\n').find((l) => l.trim().startsWith('def build('))!;
    expect(defLine.indexOf('target')).toBeLessThan(defLine.indexOf('verbose'));
  });
});

describe('pythonCommandGenerator.listExistingCommands', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(path.join(tmpdir(), 'clispark-python-generator-test-'));
    await mkdir(path.join(tmpRoot, 'cli', 'commands', 'task'), { recursive: true });
    await writeFile(path.join(tmpRoot, 'cli', 'commands', 'hello.py'), '');
    await writeFile(path.join(tmpRoot, 'cli', 'commands', '__init__.py'), '');
    await writeFile(path.join(tmpRoot, 'cli', 'commands', 'task', 'create.py'), '');
    await writeFile(path.join(tmpRoot, 'cli', 'commands', 'task', '__init__.py'), '');
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it('lists top-level and nested commands, excluding __init__.py', async () => {
    const tree = await pythonCommandGenerator.listExistingCommands(tmpRoot);
    const paths = tree.flatMap(function collect(node): string[] {
      return [node.path, ...node.children.flatMap(collect)];
    });
    expect(paths).toContain('hello');
    expect(paths).toContain('task create');
    expect(paths).not.toContain('task __init__');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- languages/command-generators/python.test.ts`
Expected: FAIL — `Cannot find module './python'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/languages/command-generators/python.ts
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  CommandGenerator,
  CommandSpec,
  ExistingCommandNode,
  GeneratedFiles,
  ParameterSpec,
} from '../command-generator';
import { buildCommandTree } from '../command-generator';

async function collectCommandFiles(dir: string, baseDir: string = dir): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectCommandFiles(fullPath, baseDir)));
    } else if (entry.name.endsWith('.py') && entry.name !== '__init__.py') {
      files.push(path.relative(baseDir, fullPath));
    }
  }
  return files;
}

function toCommandPath(relativeFilePath: string): string {
  return relativeFilePath.replace(/\.py$/, '').split(path.sep).join(' ');
}

async function listExistingCommands(targetDir: string): Promise<ExistingCommandNode[]> {
  const commandsDir = path.join(targetDir, 'cli', 'commands');
  const files = await collectCommandFiles(commandsDir);
  return buildCommandTree(files.map(toCommandPath));
}

function toClassName(pathSegments: string[]): string {
  return pathSegments.map((seg) => seg[0].toUpperCase() + seg.slice(1)).join('') + 'Command';
}

function pythonType(param: ParameterSpec): string {
  if (param.type === 'integer') return 'int';
  if (param.type === 'boolean') return 'bool';
  return 'str';
}

function defaultLiteral(param: ParameterSpec): string {
  if (param.type === 'boolean') return 'False';
  if (param.type === 'integer') return '0';
  if (param.type === 'enum') return `"${(param.allowedValues ?? [''])[0]}"`;
  return "''";
}

// Bare parameters, no explicit typer.Argument()/typer.Option() wrapper: Typer infers a
// positional argument for a no-default parameter and a --flag option for a defaulted one.
// Python's own syntax already forbids a no-default parameter after a defaulted one, which
// happens to be exactly the ordering CLI frameworks like oclif/System.CommandLine enforce at
// runtime -- see the spec's "required-nach-optional" section.
function parameterDeclaration(param: ParameterSpec): string {
  const pyType = pythonType(param);
  return param.required ? `${param.name}: ${pyType}` : `${param.name}: ${pyType} = ${defaultLiteral(param)}`;
}

function generateCommandFileContent(spec: CommandSpec): string {
  const className = toClassName(spec.pathSegments);
  const commandName = spec.pathSegments[spec.pathSegments.length - 1];
  const orderedParams = [...spec.parameters.filter((p) => p.required), ...spec.parameters.filter((p) => !p.required)];
  const paramList = orderedParams.map(parameterDeclaration).join(', ');
  const kwargList = orderedParams.map((p) => `${p.name}=${p.name}`).join(', ');
  const runParamList = orderedParams.map((p) => `${p.name}: ${pythonType(p)}`).join(', ');

  return `import typer

from cli.base_command import BaseCommand

app = typer.Typer()


class ${className}(BaseCommand):
    command_name = "${spec.pathSegments.join(' ')}"

    def run(self, ${runParamList}) -> None:
        typer.echo(f"${spec.pathSegments.join(' ')} ran")


@app.callback(invoke_without_command=True)
def ${commandName}(${paramList}) -> None:
    ${className}()(${kwargList})
`;
}

function sampleArgValue(param: ParameterSpec): string {
  if (param.type === 'enum') return param.allowedValues?.[0] ?? '';
  if (param.type === 'integer') return '1';
  if (param.type === 'boolean') return 'True';
  return 'value';
}

function generateTestFileContent(spec: CommandSpec): string {
  const commandInvocation = spec.pathSegments.join(' ');
  const cliArgs = spec.parameters
    .filter((p) => p.required)
    .map((p) => `"${sampleArgValue(p)}"`)
    .join(', ');
  const invocationArgs = [...spec.pathSegments.map((s) => `"${s}"`), cliArgs].filter(Boolean).join(', ');

  return `from typer.testing import CliRunner

from cli.cli import app

runner = CliRunner()


def test_${spec.pathSegments.join('_')}_runs_successfully():
    result = runner.invoke(app, [${invocationArgs}])
    assert result.exit_code == 0
`;
}

async function generateCommand(targetDir: string, spec: CommandSpec): Promise<GeneratedFiles> {
  const relDir = path.join('cli', 'commands', ...spec.pathSegments.slice(0, -1));
  const fileName = spec.pathSegments[spec.pathSegments.length - 1];
  const commandRelPath = path.join(relDir, `${fileName}.py`);
  const testRelPath = path.join('tests', `test_${spec.pathSegments.join('_')}.py`);

  await mkdir(path.join(targetDir, relDir), { recursive: true });
  // Every intermediate command-group folder needs its own __init__.py so discover.py's
  // filesystem walk recognizes it as a mountable Typer sub-app group.
  for (let i = 1; i <= spec.pathSegments.length - 1; i++) {
    const groupDir = path.join(targetDir, 'cli', 'commands', ...spec.pathSegments.slice(0, i));
    await writeFile(path.join(groupDir, '__init__.py'), '');
  }
  await mkdir(path.join(targetDir, 'tests'), { recursive: true });
  await writeFile(path.join(targetDir, commandRelPath), generateCommandFileContent(spec));
  await writeFile(path.join(targetDir, testRelPath), generateTestFileContent(spec));

  return { commandFile: commandRelPath, testFile: testRelPath };
}

export const pythonCommandGenerator: CommandGenerator = {
  listExistingCommands,
  generateCommand,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- languages/command-generators/python.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add src/languages/command-generators/python.ts src/languages/command-generators/python.test.ts
git commit -m "feat: add Python command generator (clispark add support)"
```

---

## Task 6: `pythonPack` assembly

**Files:**
- Create: `src/languages/packs/python.ts`
- Test: `src/languages/packs/python.test.ts`

**Interfaces:**
- Consumes: `LanguagePack` from `../pack` (existing); `pythonAdapter` from Task 4; `pypiRegistryChecker`, `PYPI_DEFAULT_URL` from Task 3; `pythonCommandGenerator` from Task 5; `findPackageRoot` from `../../package-root` (existing).
- Produces: `pythonPack: LanguagePack` — consumed by Task 7.

- [ ] **Step 1: Write the failing tests**

```ts
// src/languages/packs/python.test.ts
import { describe, it, expect } from 'vitest';
import { pythonPack } from './python';

describe('pythonPack.validateProjectName', () => {
  it.each(['my-tool', 'task', 'hello-world-123'])('accepts kebab-case name "%s"', (name) => {
    expect(pythonPack.validateProjectName(name)).toBeUndefined();
  });

  it.each(['MyTool', 'my_tool', '-my-tool', 'my--tool', ''])('rejects invalid name "%s"', (name) => {
    expect(pythonPack.validateProjectName(name)).toBeDefined();
  });
});

describe('pythonPack scaffold setup', () => {
  it('runs uv sync via scaffoldCommands', () => {
    expect(pythonPack.scaffoldCommands).toHaveLength(1);
    expect(pythonPack.scaffoldCommands[0].command).toBe('uv');
    expect(pythonPack.scaffoldCommands[0].args).toEqual(['sync']);
  });
});

describe('pythonPack v1 scope', () => {
  it('has all lean-v1 opt-in features permanently disabled', async () => {
    expect(pythonPack.supportsAutocompleteOptIn).toBe(false);
    await expect(pythonPack.stripLintTooling('/tmp/whatever')).resolves.toBeUndefined();
    await expect(pythonPack.stripAutocompleteSupport('/tmp/whatever')).resolves.toBeUndefined();
    await expect(pythonPack.stripCommandConvention('/tmp/whatever')).resolves.toBeUndefined();
  });
});

describe('pythonPack identity', () => {
  it('is identified as the python pack', () => {
    expect(pythonPack.id).toBe('python');
    expect(pythonPack.templateDir.replace(/\\/g, '/')).toMatch(/templates\/python$/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- languages/packs/python.test.ts`
Expected: FAIL — `Cannot find module './python'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/languages/packs/python.ts
import path from 'node:path';
import { findPackageRoot } from '../../package-root';
import type { LanguagePack } from '../pack';
import { pythonAdapter } from '../../update/adapters/python';
import { pypiRegistryChecker, PYPI_DEFAULT_URL } from '../registry-checkers/pypi';
import { pythonCommandGenerator } from '../command-generators/python';

function validateProjectName(value: string | undefined): string | undefined {
  if (!value || value.trim().length === 0) return 'Project name is required.';
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(value)) {
    return 'Use lowercase letters and numbers, with single hyphens between words (no leading, trailing, or repeated hyphens).';
  }
  return undefined;
}

export const pythonPack: LanguagePack = {
  id: 'python',
  displayName: 'Python (Typer)',
  templateDir: path.join(findPackageRoot(), 'templates', 'python'),
  scaffoldCommands: [{ command: 'uv', args: ['sync'] }],
  validateProjectName,
  updateAdapter: pythonAdapter,
  registry: {
    defaultUrl: PYPI_DEFAULT_URL,
    promptLabel: 'Custom PyPI-compatible index URL (leave empty for pypi.org)',
    checkNameAvailability: pypiRegistryChecker.checkNameAvailability,
    applyPrivateIntent: pypiRegistryChecker.applyPrivateIntent,
    applyRegistryUrl: pypiRegistryChecker.applyRegistryUrl,
  },
  commandGenerator: pythonCommandGenerator,
  // v1 is deliberately lean, matching the PowerShell template's precedent -- lint tooling
  // (ruff) and a command-convention rule are separate, later issues (see the spec's "Bewusst
  // nicht Teil dieser Arbeit"). Shell completion needs no opt-in at all: Typer ships
  // --install-completion out of the box, verified in the design session.
  stripLintTooling: async () => {},
  supportsAutocompleteOptIn: false,
  stripAutocompleteSupport: async () => {},
  stripCommandConvention: async () => {},
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- languages/packs/python.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add src/languages/packs/python.ts src/languages/packs/python.test.ts
git commit -m "feat: assemble pythonPack from its adapter/registry/generator"
```

---

## Task 7: Register `pythonPack` and update the wizard question catalog

**Files:**
- Modify: `src/languages/index.ts`
- Modify: `src/languages/index.test.ts`
- Modify: `src/wizard.ts` (only the `why` copy in `WIZARD_QUESTION_CATALOG`, no control-flow changes)

**Interfaces:**
- Consumes: `pythonPack` from Task 6.
- Produces: `LANGUAGE_PACKS.python` — from here on, `pythonPack` is live in the real wizard (`wizard.ts` already iterates `Object.values(LANGUAGE_PACKS)` generically, verified by reading it in the design session — no wizard.ts control-flow changes needed).

- [ ] **Step 1: Write the failing test**

Add to `src/languages/index.test.ts`:

```ts
import { pythonPack } from './packs/python';

describe('LANGUAGE_PACKS', () => {
  // ...existing 'includes the node-oclif pack' test stays...

  it('includes the python pack, keyed by its id', () => {
    expect(LANGUAGE_PACKS.python).toBe(pythonPack);
  });
});

describe('getPackById', () => {
  // ...existing tests stay...

  it('returns the python pack for id "python"', () => {
    expect(getPackById('python')).toBe(pythonPack);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- languages/index.test.ts`
Expected: FAIL — `LANGUAGE_PACKS.python` is `undefined`.

- [ ] **Step 3: Register the pack**

```ts
// src/languages/index.ts
import type { LanguagePack } from './pack';
import { nodeOclifPack } from './packs/node-oclif';
import { dotnetPack } from './packs/dotnet';
import { powershellPack } from './packs/powershell';
import { pythonPack } from './packs/python';

export const LANGUAGE_PACKS: Record<string, LanguagePack> = {
  [nodeOclifPack.id]: nodeOclifPack,
  [dotnetPack.id]: dotnetPack,
  [powershellPack.id]: powershellPack,
  [pythonPack.id]: pythonPack,
};

export function getPackById(id: string): LanguagePack | undefined {
  return LANGUAGE_PACKS[id];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- languages/index.test.ts`
Expected: PASS.

- [ ] **Step 5: Update the wizard question catalog copy**

In `src/wizard.ts`, update the `language` and `autocompleteEnabled` entries in `WIZARD_QUESTION_CATALOG` (this file has a regression test, `src/wizard.test.ts`, that checks the catalog length against real prompt count from a mocked single-pack — verified in the design session that it does not break from adding a 4th real pack, since it never iterates the real `LANGUAGE_PACKS`):

```ts
  {
    id: 'language',
    prompt: 'Which language?',
    why: 'Picks which LanguagePack scaffolds the project — Node/oclif, .NET/System.CommandLine, PowerShell, or Python. Everything downstream (registry, lint tooling, autocompletion) adapts to this choice.',
  },
```

```ts
  {
    id: 'autocompleteEnabled',
    prompt: 'Set up shell autocompletion?',
    why: 'Only asked for languages that need a scaffolding choice (Node) — PowerShell and Python completion are built-in with zero setup, and .NET completion is already wired in but needs a one-time dotnet-suggest setup rather than a scaffolding toggle. Wires up @oclif/plugin-autocomplete when accepted.',
  },
```

- [ ] **Step 6: Run the wizard test suite to confirm nothing broke**

Run: `npm test -- wizard.test.ts`
Expected: PASS (unchanged — this file mocks a single fake pack, not the real registry).

- [ ] **Step 7: Commit**

```bash
git add src/languages/index.ts src/languages/index.test.ts src/wizard.ts
git commit -m "feat: register pythonPack in LANGUAGE_PACKS"
```

---

## Task 8: Full branch verification (typecheck, lint, full suite, real manual scaffold)

**Files:** none created — verification only.

- [ ] **Step 1: Full typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 2: Full lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 3: Full vitest suite**

Run: `npm test`
Expected: all tests pass, including every test added in Tasks 3–7.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: succeeds, `dist/cli.js` produced.

- [ ] **Step 5: Real manual scaffold-and-verify — the actual `clispark` CLI, not a unit test**

This mirrors the manual verification done for the .NET and PowerShell templates before shipping (see `clispark.plan.changelog.md`). Requires `uv` on PATH (`pip install uv` if not).

```bash
mkdir /tmp/clispark-python-manual-check && cd /tmp/clispark-python-manual-check
node <clispark-repo>/dist/cli.js
```

Answer the wizard: language = Python, name = `manual-check-tool`, profile = private, publish? = No, lint tooling? = No, (no command-convention question, since lint = No), (no autocompletion question, `supportsAutocompleteOptIn` is false).

Expected: scaffolding succeeds, `git init` + initial commit happen, `uv sync` runs as the final scaffold command without error.

```bash
cd manual-check-tool
uv run pytest -q
uv run manual-check-tool hello --name Martin
```

Expected: `1 passed`; `hello` prints the structlog `started`/`completed` lines around `Hello, Martin!`.

- [ ] **Step 6: Real manual `clispark add` check**

From inside `manual-check-tool`:

```bash
node <clispark-repo>/dist/cli.js add
```

Answer: command path `task create`, one required string parameter `title`.

Expected: `cli/commands/task/__init__.py`, `cli/commands/task/create.py`, and `tests/test_task_create.py` are created.

```bash
uv run manual-check-tool task create "Buy milk"
uv run pytest -q
```

Expected: the new nested command runs and logs correctly (folder-as-path discovery working against a real `clispark add` output, not just the hand-written Task 1 example); pytest still passes.

- [ ] **Step 7: Real manual `clispark update` check**

Hand-edit `manual-check-tool/pyproject.toml`: bump `"typer>=0.12"` to `"typer>=0.11"` (simulate a stale core dependency the user never touched).

```bash
node <clispark-repo>/dist/cli.js update
```

Expected: the update reports `typer: replaced` (or equivalent core-dependency-changed output) and restores `"typer>=0.12"` in `pyproject.toml` — while any comments/formatting elsewhere in the file are untouched (confirms the targeted-regex write strategy from Task 4 actually preserves the rest of the file against a real, non-mocked file).

- [ ] **Step 8: Clean up manual check directories**

```bash
rm -rf /tmp/clispark-python-manual-check
```

(No commit for this task — verification only. If any step fails, fix the underlying code in the relevant earlier task and re-run this task from Step 1.)

---

## Task 9: Documentation — root README and ARCHITECTURE mentions

**Files:**
- Modify: `README.md`

**Interfaces:** none — documentation only.

- [ ] **Step 1: Update the "What you get" intro line**

In `README.md`, find:

```markdown
clispark scaffolds three language templates — Node/oclif, .NET, and PowerShell — chosen during the wizard. Every generated project, regardless of language, includes:
```

Replace with:

```markdown
clispark scaffolds four language templates — Node/oclif, .NET, PowerShell, and Python — chosen during the wizard. Every generated project, regardless of language, includes:
```

- [ ] **Step 2: Update the bullet list under "What you get"**

Find the four bullets starting with "Convention-based command discovery" / "Structured logging" / "A working test setup" / "A directly runnable result", and add the Python equivalent to each parenthetical, e.g.:

```markdown
- **Convention-based command discovery** — drop a file in the right place and it's picked up automatically, no manual registration (`src/commands/` filesystem scan for Node, `[CommandPath]` + reflection for .NET, `Public/` filesystem scan for PowerShell, `cli/commands/` filesystem scan for Python)
- **Structured logging** covering every command automatically, one log file per invocation in an OS-appropriate log directory (`pino` for Node, Serilog for .NET, PSFramework for PowerShell, `structlog` for Python)
```

(Update "A working test setup" to add `pytest for Python`, and "A directly runnable result" to add: `, or for Python, uv run <project-name> <command>` — keep sentence structure natural, don't just append mechanically.)

- [ ] **Step 3: Update the opt-in features list**

Find:

```markdown
- **Lint tooling** — ESLint + Prettier (Node) or the .NET SDK's built-in Roslyn analyzers (.NET). Not offered for PowerShell.
- **Shell autocompletion** — `@oclif/plugin-autocomplete` (Node only; .NET and PowerShell aren't asked, see their own `ARCHITECTURE.md` for how completion works there instead).
```

Replace with:

```markdown
- **Lint tooling** — ESLint + Prettier (Node) or the .NET SDK's built-in Roslyn analyzers (.NET). Not offered for PowerShell or Python (yet — see the project backlog).
- **Shell autocompletion** — `@oclif/plugin-autocomplete` (Node only; .NET, PowerShell, and Python aren't asked, see their own `ARCHITECTURE.md` for how completion works there instead).
```

- [ ] **Step 4: Update the numbered wizard walkthrough (step 6)**

Find the `autocompleteEnabled` step in the "Usage" section and add Python to the "aren't asked" list:

```markdown
6. **Set up shell autocompletion?** (default: No, Node only — .NET, PowerShell, and Python are never asked, because none of them needs anything scaffolded: PowerShell's tab-completion is a built-in language feature with zero setup, Python's Typer framework ships `--install-completion` out of the box, and .NET's completion is already wired into every generated project via `System.CommandLine`'s `[suggest]` directive, requiring only a one-time `dotnet-suggest` setup per machine rather than a scaffolding choice — see each template's `ARCHITECTURE.md` "Shell Completion" section for the exact steps) — if yes, the generated Node project gets `@oclif/plugin-autocomplete` wired up, and `npx clispark update` keeps its version current afterwards. If no, it's never scaffolded, and `update` never adds it later.
```

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: document the Python template in the root README"
```

---

## Task 10: Ship it

**Files:** none created — process only.

- [ ] **Step 1: Push and open the PR**

```bash
git push -u origin <feature-branch-name>
gh pr create --title "feat: Python template (Typer + uv + structlog)" --body "Fixes #136

Fourth LanguagePack: Python CLI tool scaffolding via Typer, uv, structlog. Lean v1 scope matching the PowerShell template's precedent — no lint-tooling opt-in, no command-convention rule (separate future issues). Design: docs/superpowers/specs/2026-08-07-clispark-python-template-design.md"
```

- [ ] **Step 2: Wait for CI to go green, then merge**

Rebase-and-merge per this project's established merge strategy (see `clispark.plan.md`'s "Rahmenbedingungen" — release-please's squash-commit parsing bug means feature PRs must use rebase-merge, not squash).

- [ ] **Step 3: Check for a release-please release PR, and let it auto-merge / verify npm publish**

Same post-merge checklist as every prior shipped feature (#80, #89, etc.) — confirm the new version is live on npm (`npm view clispark version`).

- [ ] **Step 4: Delete the merged feature branch (local + remote)**

- [ ] **Step 5: Close #136 with a summary comment**

Mention @Tefchen, link the shipped version, and note that lint tooling / command-convention support are tracked separately if they want to follow along.

- [ ] **Step 6: Update `clispark.plan.md` and `clispark.plan.changelog.md`**

Remove #136 from the open backlog (it was already the lowest-priority, unbevaluated entry), add a "shipped" note to the changelog following the same format as the #80/#89 entries, and renumber the remaining backlog.

- [ ] **Step 7: Update the graphify knowledge graph**

```bash
graphify update .
```
