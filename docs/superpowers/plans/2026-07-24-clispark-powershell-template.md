# PowerShell Template Implementation Plan (#82)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `powershellPack: LanguagePack` — a full third clispark language template (PowerShell 7.4+, module-with-cmdlets) with auto-logging/error-handling (no opt-out), `clispark add`, and `clispark update` support, matching the existing Node/.NET templates' capabilities.

**Architecture:** Four new isolated modules (`RegistryChecker`, `UpdateAdapter`, `CommandGenerator`, `LanguagePack`) implementing the existing generic interfaces exactly like `dotnetPack` does — zero changes to `wizard.ts`/`scaffold.ts`/`update.ts`/`manifest.ts`. One small, backward-compatible interface extension (`CommandGenerator.promptCommandIdentity?`) lets PowerShell's Verb+Noun naming replace the generic single-name prompt in `add-wizard.ts` without changing Node/.NET behavior. The riskiest piece — a dynamic function-proxy-wrapper for auto-logging/error-handling, since PowerShell has no `BaseCommand`-style inheritance — was already prototyped and verified for real during the design spec (see Task 5).

**Tech Stack:** PowerShell 7.4+ module (`.psd1`/`.psm1`), PSFramework (logging), Pester (testing), `Microsoft.PowerShell.PSResourceGet` (registry), `cross-spawn` (already a clispark dependency, reused to shell out to `pwsh` for manifest reads).

## Global Constraints

- Design spec: `docs/superpowers/specs/2026-07-24-clispark-powershell-template-design.md` — read it for full rationale; this plan implements it as written, including the corrections/resolutions logged there. **One further correction found while writing this plan, not yet reflected in the merged spec text:** the spec's "coreFilePaths (Prinzip)" paragraph lists `Module.psd1` as core-managed — that's wrong, matching the .NET adapter precedent the manifest is deliberately excluded from `coreFilePaths` (see Task 3's `CORE_FILE_PATHS` comment for why). This plan's code is the authoritative version; the spec text is superseded on this one point.
- **Windows PowerShell 5.1 is out of scope.** Target is PowerShell **7.4+** only (real research, see spec: covers both currently-supported .NET LTS trains — 7.4/.NET 8 and 7.6/.NET 10 — while avoiding the non-LTS 7.5/.NET 9 release, per the requester's explicit ask).
- **Manifest/root-module filenames are fixed, not project-name-dependent:** always `Module.psd1`/`Module.psm1`, regardless of the scaffolded project's name — same principle as the .NET template's fixed `Cli.csproj`/`Program.cs`. This avoids the known `UpdateAdapter.coreFilePaths`-has-no-project-context gap (already flagged separately in the #70 lint-tooling review) without needing to fix that generic gap here.
- **`.psd1` reads go through a real `pwsh` shell-out** (`Import-PowerShellDataFile` + `ConvertTo-Json`); **writes are targeted regex replacements** directly in Node (same principle as the existing `.csproj` adapter — safe because we control the manifest's exact generated format).
- Boolean command parameters use PowerShell's `[switch]` type (structurally always-optional, matching the `clispark add` "booleans must be optional" invariant with no extra code needed — see spec).
- `RequiredModules` in the manifest (and the scaffold's auto-install step) always includes `PSFramework`, `Pester`, `Microsoft.PowerShell.PSResourceGet` — none of these ship built into PowerShell 7.4+/7.6 by default (real research, see spec).
- Every task ends in a state where `npx tsc --noEmit`, `npx eslint src scripts`, and `npx vitest run` all pass in the clispark repo root.
- Every new TypeScript file follows this project's existing DI convention where the pattern applies (see `src/wizard.ts`'s `WizardDeps`/`defaultDeps` shape) — not every new file needs DI (e.g. pure data-transformation modules like the command generator don't take runtime dependencies today, matching `command-generators/dotnet.ts`).
- **Known verification gap, carried from the spec:** this plan's PowerShell-executing steps (Tasks 2, 3, 5, 6, 7) require a real `pwsh` (PowerShell 7.4+) installation. The environment this plan was written in only had Windows PowerShell 5.1 (Desktop) available — the riskiest mechanism (function-proxy-wrapper) was prototyped and verified there, but **not yet against real PowerShell 7+/Core.** Task 5 Step 1 requires installing `pwsh` and re-running the exact prototype sequence for real before proceeding — do not skip this step or assume the 5.1 prototype transfers untested.

---

## File Structure

```
src/
  languages/
    registry-checkers/
      powershell-gallery.ts      # CREATE
      powershell-gallery.test.ts  # CREATE
    command-generators/
      powershell.ts               # CREATE
      powershell.test.ts          # CREATE
    command-generator.ts          # MODIFY — add optional `promptCommandIdentity`
    packs/
      powershell.ts                # CREATE
      powershell.test.ts           # CREATE (validateProjectName tests)
    index.ts                       # MODIFY — register powershellPack
  update/
    adapters/
      powershell.ts                # CREATE
      powershell.test.ts           # CREATE
  add-wizard.ts                    # MODIFY — call promptCommandIdentity when present
  add-wizard.test.ts                # MODIFY — new test for the promptCommandIdentity path
templates/
  powershell/
    Module.psd1                    # CREATE
    Module.psm1                    # CREATE
    Public/
      Get-Hello.ps1                 # CREATE
    Private/                        # CREATE (empty, .gitkeep)
    Logging/
      Initialize-Logging.ps1        # CREATE
    tests/
      Get-Hello.Tests.ps1            # CREATE
    ARCHITECTURE.md                 # CREATE
    README.md                       # CREATE
    gitignore                       # CREATE
```

---

### Task 1: `CommandGenerator.promptCommandIdentity` — generalize `add-wizard.ts` for Verb+Noun naming

**Files:**
- Modify: `src/languages/command-generator.ts`
- Modify: `src/add-wizard.ts`
- Modify: `src/add-wizard.test.ts`

**Interfaces:**
- Produces: `CommandGenerator.promptCommandIdentity?(pathSegments: string[], existingPaths: Set<string>): Promise<string[]>` (optional — Node/.NET packs don't implement it, behavior for them is unchanged).

This task is a prerequisite for Task 4 (PowerShell's `CommandGenerator`) and has zero PowerShell-specific content — it's a pure, backward-compatible interface extension, testable entirely with the existing fake generator pattern.

- [ ] **Step 1: Add the optional method to the interface**

Edit `src/languages/command-generator.ts` — add to the `CommandGenerator` interface:

```ts
export interface CommandGenerator {
  listExistingCommands(targetDir: string): Promise<ExistingCommandNode[]>;
  generateCommand(targetDir: string, spec: CommandSpec): Promise<GeneratedFiles>;
  /**
   * Optional hook: when present, add-wizard.ts calls this instead of its
   * built-in generic single-name prompt to collect the new command's full
   * path segments. Used by languages whose naming convention doesn't fit a
   * single free-form word (e.g. PowerShell's Verb+Noun cmdlet naming).
   */
  promptCommandIdentity?(pathSegments: string[], existingPaths: Set<string>): Promise<string[]>;
}
```

- [ ] **Step 2: Write the failing test for the new wizard branch**

Edit `src/add-wizard.test.ts` — add a new test after the existing "creates a top-level command with no parameters" test:

```ts
  it('uses promptCommandIdentity instead of the generic name prompt when the generator provides it', async () => {
    const { generator, generateCommandCalls } = fakeGenerator([]);
    const promptCommandIdentity = vi.fn(async () => ['Get-Something']);
    const generatorWithIdentity: CommandGenerator = { ...generator, promptCommandIdentity };

    vi.mocked(select).mockResolvedValueOnce('__new_top_level__'); // where to add
    vi.mocked(confirm).mockResolvedValueOnce(false); // "add a parameter?" -> no
    vi.mocked(confirm).mockResolvedValueOnce(true); // "proceed?" -> yes

    await runAddWizard('/tmp/project', { commandGenerator: generatorWithIdentity });

    expect(promptCommandIdentity).toHaveBeenCalledWith([], new Set());
    expect(text).not.toHaveBeenCalledWith(expect.objectContaining({ message: 'Command name' }));
    expect(generateCommandCalls[0].spec).toEqual({ pathSegments: ['Get-Something'], parameters: [] });
  });
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/add-wizard.test.ts`
Expected: FAIL — `promptCommandIdentity` is never called, `runAddWizard` still always prompts for `text({ message: 'Command name' })`.

- [ ] **Step 4: Implement the branch in `add-wizard.ts`**

Edit `src/add-wizard.ts` — replace the `runAddWizard` function's name-collection block. Current code:

```ts
  const existing = await deps.commandGenerator.listExistingCommands(targetDir);
  const pathSegments = await selectPath(existing);
  const existingPaths = new Set(flattenPaths(existing));

  const nameValue = await text({
    message: 'Command name',
    validate: (value) => {
      if (!/^[a-z][a-zA-Z0-9]*$/.test(value)) return 'Use a single word starting with a lowercase letter.';
      const fullPath = [...pathSegments, value].join(' ');
      if (existingPaths.has(fullPath)) return `"${fullPath}" already exists.`;
      return undefined;
    },
  });
  exitIfCancelled(nameValue);
  const fullPathSegments = [...pathSegments, nameValue as string];
```

Replace with:

```ts
  const existing = await deps.commandGenerator.listExistingCommands(targetDir);
  const pathSegments = await selectPath(existing);
  const existingPaths = new Set(flattenPaths(existing));

  let fullPathSegments: string[];
  if (deps.commandGenerator.promptCommandIdentity) {
    fullPathSegments = await deps.commandGenerator.promptCommandIdentity(pathSegments, existingPaths);
  } else {
    const nameValue = await text({
      message: 'Command name',
      validate: (value) => {
        if (!/^[a-z][a-zA-Z0-9]*$/.test(value)) return 'Use a single word starting with a lowercase letter.';
        const fullPath = [...pathSegments, value].join(' ');
        if (existingPaths.has(fullPath)) return `"${fullPath}" already exists.`;
        return undefined;
      },
    });
    exitIfCancelled(nameValue);
    fullPathSegments = [...pathSegments, nameValue as string];
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/add-wizard.test.ts`
Expected: PASS (all tests, including the new one and every pre-existing one unchanged).

- [ ] **Step 6: Full verification and commit**

Run: `npx tsc --noEmit && npx eslint src scripts && npx vitest run`
Expected: all pass.

```bash
git add src/languages/command-generator.ts src/add-wizard.ts src/add-wizard.test.ts
git commit -m "feat: add optional CommandGenerator.promptCommandIdentity hook"
```

---

### Task 2: PowerShell Gallery `RegistryChecker`

**Files:**
- Create: `src/languages/registry-checkers/powershell-gallery.ts`
- Test: `src/languages/registry-checkers/powershell-gallery.test.ts`

**Interfaces:**
- Produces: `powershellGalleryRegistryChecker: RegistryChecker`, `POWERSHELL_GALLERY_DEFAULT_URL: string`.

Real API behavior already confirmed during the design spec (2026-07-24, live `curl` against `powershellgallery.com`): `FindPackagesById()?id='<Name>'` always returns HTTP 200 with an Atom/OData feed — availability is determined by whether the feed contains any `<entry>` element (0 entries = available, N entries = taken), unlike NuGet's 404-vs-200 pattern.

- [ ] **Step 1: Write the failing tests**

Create `src/languages/registry-checkers/powershell-gallery.test.ts`:

```ts
// src/languages/registry-checkers/powershell-gallery.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { powershellGalleryRegistryChecker, POWERSHELL_GALLERY_DEFAULT_URL } from './powershell-gallery';

describe('powershellGalleryRegistryChecker.checkNameAvailability', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns "taken" when the feed contains at least one <entry>', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<feed><entry>x</entry></feed>', { status: 200 })),
    );
    const result = await powershellGalleryRegistryChecker.checkNameAvailability('Pester', POWERSHELL_GALLERY_DEFAULT_URL);
    expect(result).toBe('taken');
    vi.unstubAllGlobals();
  });

  it('returns "available" when the feed has zero <entry> elements', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<feed></feed>', { status: 200 })),
    );
    const result = await powershellGalleryRegistryChecker.checkNameAvailability('DefinitelyFreeName', POWERSHELL_GALLERY_DEFAULT_URL);
    expect(result).toBe('available');
    vi.unstubAllGlobals();
  });

  it('returns "unverified" on a non-200 response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 500 })),
    );
    const result = await powershellGalleryRegistryChecker.checkNameAvailability('Anything', POWERSHELL_GALLERY_DEFAULT_URL);
    expect(result).toBe('unverified');
    vi.unstubAllGlobals();
  });

  it('returns "unverified" when fetch throws (network error)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );
    const result = await powershellGalleryRegistryChecker.checkNameAvailability('Anything', POWERSHELL_GALLERY_DEFAULT_URL);
    expect(result).toBe('unverified');
    vi.unstubAllGlobals();
  });
});

describe('powershellGalleryRegistryChecker.applyPrivateIntent', () => {
  it('is a documented no-op: resolves without touching the filesystem', async () => {
    await expect(powershellGalleryRegistryChecker.applyPrivateIntent('/tmp/whatever')).resolves.toBeUndefined();
  });
});

describe('powershellGalleryRegistryChecker.applyRegistryUrl', () => {
  it('writes a PSResourceGet repository-registration hint file', async () => {
    const { mkdtemp, readFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const path = await import('node:path');
    const dir = await mkdtemp(path.join(tmpdir(), 'ps-registry-'));

    await powershellGalleryRegistryChecker.applyRegistryUrl(dir, 'https://pkgs.example.internal/psresource/v1');

    const content = await readFile(path.join(dir, '.psresource-repository'), 'utf8');
    expect(content).toContain('https://pkgs.example.internal/psresource/v1');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/languages/registry-checkers/powershell-gallery.test.ts`
Expected: FAIL — `Cannot find module './powershell-gallery'`.

- [ ] **Step 3: Implement `src/languages/registry-checkers/powershell-gallery.ts`**

```ts
// src/languages/registry-checkers/powershell-gallery.ts
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { NameCheckResult, RegistryChecker } from '../registry-checker';

export const POWERSHELL_GALLERY_DEFAULT_URL = 'https://www.powershellgallery.com/api/v2';

const FETCH_TIMEOUT_MS = 5000;

async function checkNameAvailability(name: string, registryUrl: string): Promise<NameCheckResult> {
  const url = `${registryUrl}/FindPackagesById()?id='${encodeURIComponent(name)}'`;

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (response.status !== 200) return 'unverified';
    const body = await response.text();
    return body.includes('<entry>') ? 'taken' : 'available';
  } catch {
    return 'unverified';
  }
}

async function applyPrivateIntent(): Promise<void> {
  // Genuine no-op: unlike npm's "private" field or NuGet's <IsPackable>false</IsPackable>,
  // a PowerShell module manifest has no field that prevents accidental publishing — "don't
  // publish this" is enforced by simply never running Publish-PSResource, not by a manifest
  // flag. Nothing to write.
}

async function applyRegistryUrl(targetDir: string, registryUrl: string): Promise<void> {
  const content = [
    '# This file documents the private PSResourceGet repository configured for this project.',
    '# Register it once per machine before publishing or installing dependencies from it:',
    `#   Register-PSResourceRepository -Name "custom" -Uri "${registryUrl}" -Trusted`,
    '',
    registryUrl,
    '',
  ].join('\n');
  await mkdir(targetDir, { recursive: true });
  await writeFile(path.join(targetDir, '.psresource-repository'), content);
}

export const powershellGalleryRegistryChecker: RegistryChecker = {
  checkNameAvailability,
  applyPrivateIntent,
  applyRegistryUrl,
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/languages/registry-checkers/powershell-gallery.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Full verification and commit**

Run: `npx tsc --noEmit && npx eslint src scripts && npx vitest run`
Expected: all pass.

```bash
git add src/languages/registry-checkers/powershell-gallery.ts src/languages/registry-checkers/powershell-gallery.test.ts
git commit -m "feat: add PowerShell Gallery registry checker"
```

---

### Task 3: PowerShell `UpdateAdapter` (`.psd1` manifest read/write)

**Files:**
- Create: `src/update/adapters/powershell.ts`
- Test: `src/update/adapters/powershell.test.ts`

**Interfaces:**
- Consumes: `reconcileEntry`, `stringEquals` (`src/update/reconcile.ts`, existing).
- Produces: `powershellAdapter: UpdateAdapter`, `PowershellManifestFile` type.

**Real `pwsh` requirement:** the read path shells out to a real `pwsh` binary via `cross-spawn`. This task's tests that exercise `readManifestFile` need `pwsh` installed on the machine running the test suite — if it isn't, install PowerShell 7.4+ before starting this task (see Global Constraints).

- [ ] **Step 1: Write the failing tests**

Create `src/update/adapters/powershell.test.ts`:

```ts
// src/update/adapters/powershell.test.ts
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { powershellAdapter, parseManifestFile, type PowershellManifestFile } from './powershell';
import type { Manifest } from '../manifest';

const SAMPLE_MANIFEST = `@{
    RootModule        = 'Module.psm1'
    ModuleVersion     = '0.1.0'
    GUID              = '11111111-1111-1111-1111-111111111111'
    Author            = 'Unknown'
    FunctionsToExport = @('Get-Hello')
    RequiredModules   = @('PSFramework', 'Pester', 'Microsoft.PowerShell.PSResourceGet')
}
`;

describe('powershellAdapter.readManifestFile / parseManifestFile', () => {
  it('reads real ModuleVersion and RequiredModules from a real .psd1 via pwsh', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'ps-manifest-'));
    await writeFile(path.join(dir, 'Module.psd1'), SAMPLE_MANIFEST);

    const manifestFile = (await powershellAdapter.readManifestFile(dir)) as PowershellManifestFile;

    expect(manifestFile.version).toBe('0.1.0');
    expect(manifestFile.requiredModules).toEqual(['PSFramework', 'Pester', 'Microsoft.PowerShell.PSResourceGet']);
  });
});

describe('powershellAdapter.extractCoreFields', () => {
  it('exposes RequiredModules as coreDependencies (version-less — module names only)', () => {
    const manifestFile: PowershellManifestFile = {
      raw: SAMPLE_MANIFEST,
      version: '0.1.0',
      requiredModules: ['PSFramework', 'Pester'],
    };
    const extraction = powershellAdapter.extractCoreFields(manifestFile);
    expect(extraction.coreDependencies).toEqual({ PSFramework: '*', Pester: '*' });
    expect(extraction.coreScripts).toEqual({});
  });
});

describe('powershellAdapter.mergeManifestFile', () => {
  it('adds a new RequiredModules entry that the current file is missing', () => {
    const current: PowershellManifestFile = {
      raw: SAMPLE_MANIFEST.replace(
        "RequiredModules   = @('PSFramework', 'Pester', 'Microsoft.PowerShell.PSResourceGet')",
        "RequiredModules   = @('PSFramework', 'Pester')",
      ),
      version: '0.1.0',
      requiredModules: ['PSFramework', 'Pester'],
    };
    const newTemplate: PowershellManifestFile = {
      raw: SAMPLE_MANIFEST,
      version: '0.2.0',
      requiredModules: ['PSFramework', 'Pester', 'Microsoft.PowerShell.PSResourceGet'],
    };
    const oldManifest = {
      generatorVersion: '0.1.0',
      language: 'powershell',
      coreDependencies: { PSFramework: '*', Pester: '*' },
      coreScripts: {},
      coreFields: {},
      coreFileHashes: {},
    } as unknown as Manifest;

    const result = powershellAdapter.mergeManifestFile(current, oldManifest, newTemplate);

    expect(result.changed).toBe(true);
    expect((result.updatedFile as PowershellManifestFile).raw).toContain(
      "RequiredModules   = @('PSFramework', 'Pester', 'Microsoft.PowerShell.PSResourceGet')",
    );
  });

  it('reports no change when current, old, and new template are already all in sync', () => {
    // current already has all three modules, matching both oldManifest.coreDependencies and
    // newTemplate exactly — confirms mergeManifestFile doesn't spuriously report `changed: true`
    // (and doesn't rewrite `raw`) when there is genuinely nothing to reconcile. Removal handling
    // itself reuses reconcileEntry's existing added/replaced/skipped logic, already covered by
    // the Node/.NET adapters' own tests — not re-tested here to avoid duplicating that coverage.
    const current: PowershellManifestFile = {
      raw: SAMPLE_MANIFEST,
      version: '0.1.0',
      requiredModules: ['PSFramework', 'Pester', 'Microsoft.PowerShell.PSResourceGet'],
    };
    const newTemplate: PowershellManifestFile = { ...current };
    const oldManifest = {
      generatorVersion: '0.1.0',
      language: 'powershell',
      coreDependencies: { PSFramework: '*', Pester: '*', 'Microsoft.PowerShell.PSResourceGet': '*' },
      coreScripts: {},
      coreFields: {},
      coreFileHashes: {},
    } as unknown as Manifest;

    const result = powershellAdapter.mergeManifestFile(current, oldManifest, newTemplate);

    expect(result.changed).toBe(false);
  });
});

describe('powershellAdapter.readProjectName', () => {
  it('returns a fixed sentinel — the manifest has no per-project name field to read', () => {
    // Unlike Node (package.json "name") / .NET (<PackageId>), the manifest's own fixed-filename
    // convention (see plan Global Constraints) means the manifest itself carries no per-project
    // name field — readProjectName returns a fixed sentinel; the real project name always comes
    // from the scaffold's own targetDir/projectName, never round-tripped through the manifest.
    const manifestFile: PowershellManifestFile = { raw: SAMPLE_MANIFEST, version: '0.1.0', requiredModules: [] };
    expect(powershellAdapter.readProjectName(manifestFile)).toBe('__scaffolded-from-targetDir__');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/update/adapters/powershell.test.ts`
Expected: FAIL — `Cannot find module './powershell'`.

- [ ] **Step 3: Implement `src/update/adapters/powershell.ts`**

```ts
// src/update/adapters/powershell.ts
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import spawn from 'cross-spawn';
import type { Manifest } from '../manifest';
import type { CoreFieldsExtraction, ManifestFileMergeResult, UpdateAdapter } from '../adapter';
import { reconcileEntry, type FieldOutcome } from '../reconcile';

// The manifest (Module.psd1) is deliberately NOT in this list — it has its own dedicated
// read/write/merge path via manifestFileName/readManifestFile/writeManifestFile/mergeManifestFile
// below, exactly like Cli.csproj is excluded from the .NET adapter's CORE_FILE_PATHS (see
// src/update/adapters/dotnet.ts). Including it here too would make the generic coreFilePaths
// hash-compare-and-copy loop in update.ts fight over the same file with the manifest-merge logic.
export const CORE_FILE_PATHS = [
  'Module.psm1',
  'Logging/Initialize-Logging.ps1',
  'ARCHITECTURE.md',
  '.gitignore',
] as const;

export interface PowershellManifestFile {
  raw: string;
  version: string;
  requiredModules: string[];
}

function arrayEquals(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Reads a real .psd1 via a `pwsh` subprocess — parsing PowerShell's data-language syntax
 *  ourselves in Node would mean re-implementing a real parser for a real language; shelling
 *  out to the one interpreter that already parses it correctly is the safer choice (see spec). */
function readManifestViaPwsh(manifestPath: string): Promise<{ ModuleVersion: string; RequiredModules: string[] }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'pwsh',
      [
        '-NoProfile',
        '-Command',
        `(Import-PowerShellDataFile -Path '${manifestPath}') | ConvertTo-Json -Depth 5 -Compress`,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => (stdout += chunk));
    child.stderr?.on('data', (chunk) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`pwsh exited with code ${code} reading ${manifestPath}: ${stderr}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (err) {
        reject(new Error(`Could not parse pwsh JSON output for ${manifestPath}: ${String(err)}\nOutput: ${stdout}`));
      }
    });
  });
}

export function parseManifestFile(rawContent: string): PowershellManifestFile {
  const versionMatch = rawContent.match(/ModuleVersion\s*=\s*'([^']*)'/);
  if (!versionMatch) throw new Error('Module.psd1 is missing a ModuleVersion field');
  const requiredModulesMatch = rawContent.match(/RequiredModules\s*=\s*@\(([^)]*)\)/);
  const requiredModules = requiredModulesMatch
    ? requiredModulesMatch[1]
        .split(',')
        .map((s) => s.trim().replace(/^'|'$/g, ''))
        .filter(Boolean)
    : [];
  return { raw: rawContent, version: versionMatch[1], requiredModules };
}

function setModuleVersion(content: string, version: string): string {
  return content.replace(/(ModuleVersion\s*=\s*')[^']*(')/, `$1${version}$2`);
}

function setRequiredModules(content: string, modules: string[]): string {
  const formatted = modules.map((m) => `'${m}'`).join(', ');
  return content.replace(/(RequiredModules\s*=\s*@\()[^)]*(\))/, `$1${formatted}$2`);
}

function extractCoreFields(manifestFile: PowershellManifestFile): CoreFieldsExtraction {
  const coreDependencies: Record<string, string> = {};
  for (const name of manifestFile.requiredModules) coreDependencies[name] = '*';
  return { coreDependencies, coreScripts: {}, coreFields: { RequiredModulesCount: manifestFile.requiredModules.length } };
}

function mergeManifestFile(
  current: PowershellManifestFile,
  oldManifest: Manifest,
  newTemplate: PowershellManifestFile,
): ManifestFileMergeResult {
  let raw = current.raw;
  let changed = false;

  const dependencies: FieldOutcome[] = [];
  const coreDependencies: Record<string, string> = {};
  const mergedModules: string[] = [];

  // Deliberate scope simplification vs. Node/.NET: RequiredModules here is a flat list of bare
  // module names, not name-to-version pairs (matching this template's Module.psd1, which doesn't
  // pin RequiredModules versions). reconcileEntry is reused for its added/replaced/skipped
  // presence logic, not for version-bump handling — there is no version to bump. If per-module
  // version pinning is ever added to the manifest, this loop needs revisiting.
  for (const name of newTemplate.requiredModules) {
    const currentHasIt = current.requiredModules.includes(name);
    const oldHadIt = Object.prototype.hasOwnProperty.call(oldManifest.coreDependencies, name);
    const result = reconcileEntry<string | undefined>(
      currentHasIt ? name : undefined,
      oldHadIt ? name : undefined,
      name,
      (a, b) => a === b,
    );
    dependencies.push({ key: name, outcome: result.outcome });
    if (result.value) {
      coreDependencies[name] = '*';
      mergedModules.push(result.value);
    }
  }
  // Preserve any modules the current file has that the new template doesn't mention
  // (a user's own added dependency) — never silently dropped by an update.
  for (const name of current.requiredModules) {
    if (!mergedModules.includes(name)) mergedModules.push(name);
  }

  if (!arrayEquals(mergedModules, current.requiredModules)) {
    changed = true;
    raw = setRequiredModules(raw, mergedModules);
  }

  const versionResult = reconcileEntry(current.version, oldManifest.generatorVersion, newTemplate.version, (a, b) => a === b);
  if (versionResult.value !== current.version) {
    changed = true;
    raw = setModuleVersion(raw, versionResult.value);
  }

  return {
    updatedFile: { ...current, raw, requiredModules: mergedModules },
    changed,
    dependencies,
    scripts: [],
    fields: [],
    coreDependencies,
    coreScripts: {},
    coreFields: { RequiredModulesCount: mergedModules.length },
  };
}

export const powershellAdapter: UpdateAdapter = {
  coreFilePaths: CORE_FILE_PATHS,

  templateSourcePath(relativePath) {
    return relativePath === '.gitignore' ? 'gitignore' : relativePath;
  },

  manifestFileName: 'Module.psd1',

  async readManifestFile(dir) {
    const manifestPath = path.join(dir, 'Module.psd1');
    const raw = await readFile(manifestPath, 'utf8');
    const parsedViaPwsh = await readManifestViaPwsh(manifestPath);
    return {
      raw,
      version: parsedViaPwsh.ModuleVersion,
      requiredModules: parsedViaPwsh.RequiredModules ?? [],
    } satisfies PowershellManifestFile;
  },

  async writeManifestFile(dir, content) {
    await writeFile(path.join(dir, 'Module.psd1'), (content as PowershellManifestFile).raw);
  },

  parseManifestFile,

  readProjectName() {
    // See Global Constraints: the manifest filename is always "Module.psd1" regardless of
    // project name, so there is no per-project name field to read back out of it — the real
    // project name always comes from scaffold's own targetDir, never round-tripped through
    // this file. This sentinel exists only to satisfy the interface; update.ts never displays
    // it for this language (verify in Task 6's manual check).
    return '__scaffolded-from-targetDir__';
  },

  extractCoreFields(manifestFile) {
    return extractCoreFields(manifestFile as PowershellManifestFile);
  },

  mergeManifestFile(current, oldManifest, newTemplate) {
    return mergeManifestFile(current as PowershellManifestFile, oldManifest, newTemplate as PowershellManifestFile);
  },
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/update/adapters/powershell.test.ts`
Expected: PASS (5 tests) — **requires `pwsh` installed** for the `readManifestFile` test. If it fails with `spawn pwsh ENOENT`, install PowerShell 7.4+ first (see Global Constraints) — do not skip or mock around this, the whole point of this test is proving the real shell-out works.

- [ ] **Step 5: Full verification and commit**

Run: `npx tsc --noEmit && npx eslint src scripts && npx vitest run`
Expected: all pass.

```bash
git add src/update/adapters/powershell.ts src/update/adapters/powershell.test.ts
git commit -m "feat: add PowerShell module manifest UpdateAdapter"
```

---

### Task 4: PowerShell `CommandGenerator` (Verb+Noun)

**Files:**
- Create: `src/languages/command-generators/powershell.ts`
- Test: `src/languages/command-generators/powershell.test.ts`

**Interfaces:**
- Consumes: `buildCommandTree` (`src/languages/command-generator.ts`, existing), `CommandGenerator.promptCommandIdentity?` (Task 1).
- Produces: `powershellCommandGenerator: CommandGenerator`, `APPROVED_VERBS: readonly string[]`.

**Real verb list, not guessed:** PowerShell's approved-verb list is fixed and documented (`Get-Verb`). This task hardcodes a representative, real subset covering the common categories (not the full multi-dozen list — YAGNI, the dropdown works identically whether it lists 12 or 90 verbs, and the full canonical list is themselves subject to occasional additions Microsoft makes, so treat this as "common verbs," not "the complete list," and don't claim completeness in code comments).

- [ ] **Step 1: Write the failing tests**

Create `src/languages/command-generators/powershell.test.ts`:

```ts
// src/languages/command-generators/powershell.test.ts
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { powershellCommandGenerator } from './powershell';
import type { CommandSpec } from '../command-generator';

describe('powershellCommandGenerator.listExistingCommands', () => {
  it('lists cmdlet names from Public/*.ps1 filenames', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'ps-list-'));
    await mkdir(path.join(dir, 'Public'), { recursive: true });
    await writeFile(path.join(dir, 'Public', 'Get-Hello.ps1'), 'function Get-Hello {}');
    await writeFile(path.join(dir, 'Public', 'Set-Config.ps1'), 'function Set-Config {}');

    const result = await powershellCommandGenerator.listExistingCommands(dir);

    expect(result.map((n) => n.path).sort()).toEqual(['Get-Hello', 'Set-Config']);
  });
});

describe('powershellCommandGenerator.generateCommand', () => {
  it('creates a Public/<Verb-Noun>.ps1 file with a typed param() block and a Pester test', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'ps-gen-'));
    await mkdir(path.join(dir, 'Public'), { recursive: true });
    await mkdir(path.join(dir, 'tests'), { recursive: true });

    const spec: CommandSpec = {
      pathSegments: ['Get-TaskList'],
      parameters: [
        { name: 'name', type: 'string', required: true },
        { name: 'count', type: 'integer', required: false },
        { name: 'verbose', type: 'boolean', required: false },
        { name: 'format', type: 'enum', required: false, allowedValues: ['json', 'table'] },
      ],
    };

    const result = await powershellCommandGenerator.generateCommand(dir, spec);

    expect(result.commandFile).toBe('Public/Get-TaskList.ps1');
    expect(result.testFile).toBe('tests/Get-TaskList.Tests.ps1');

    const content = await readFile(path.join(dir, 'Public', 'Get-TaskList.ps1'), 'utf8');
    expect(content).toContain('function Get-TaskList');
    expect(content).toContain('[Parameter(Mandatory)]');
    expect(content).toContain('[string]$name');
    expect(content).toContain('[int]$count');
    expect(content).toContain('[switch]$verbose');
    expect(content).toContain("[ValidateSet('json', 'table')]");
    expect(content).toContain('[string]$format');

    const testContent = await readFile(path.join(dir, 'tests', 'Get-TaskList.Tests.ps1'), 'utf8');
    expect(testContent).toContain('Describe');
    // The one Mandatory, non-boolean parameter (name) must get a sample value in the
    // generated invocation — otherwise the smoke test would hang/fail on parameter binding
    // instead of testing anything (real bug caught during plan self-review).
    expect(testContent).toContain("Get-TaskList -name 'value'");
  });

  it('boolean parameters are always [switch], never marked Mandatory (structurally optional)', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'ps-gen-bool-'));
    await mkdir(path.join(dir, 'Public'), { recursive: true });
    await mkdir(path.join(dir, 'tests'), { recursive: true });

    const spec: CommandSpec = {
      pathSegments: ['Set-Flag'],
      parameters: [{ name: 'enabled', type: 'boolean', required: false }],
    };

    await powershellCommandGenerator.generateCommand(dir, spec);
    const content = await readFile(path.join(dir, 'Public', 'Set-Flag.ps1'), 'utf8');

    expect(content).toContain('[switch]$enabled');
    expect(content).not.toContain('[Parameter(Mandatory)]\n    [switch]$enabled');
  });
});

describe('powershellCommandGenerator.promptCommandIdentity', () => {
  it('is present on the generator (add-wizard.ts uses it instead of the generic prompt)', () => {
    expect(typeof powershellCommandGenerator.promptCommandIdentity).toBe('function');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/languages/command-generators/powershell.test.ts`
Expected: FAIL — `Cannot find module './powershell'`.

- [ ] **Step 3: Implement `src/languages/command-generators/powershell.ts`**

```ts
// src/languages/command-generators/powershell.ts
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { select, text, isCancel, cancel } from '@clack/prompts';
import type { CommandGenerator, CommandSpec, ExistingCommandNode, GeneratedFiles, ParameterSpec } from '../command-generator';
import { buildCommandTree } from '../command-generator';

/** A representative subset of PowerShell's approved verbs (see `Get-Verb`) — common categories,
 *  not an exhaustive/canonical copy (Microsoft occasionally adds more; the dropdown works the
 *  same either way). */
export const APPROVED_VERBS = [
  'Get',
  'Set',
  'New',
  'Remove',
  'Add',
  'Clear',
  'Invoke',
  'Start',
  'Stop',
  'Test',
  'Update',
  'Export',
  'Import',
] as const;

function exitIfCancelled(value: unknown): void {
  if (isCancel(value)) {
    cancel('Operation cancelled.');
    process.exit(1);
  }
}

async function listExistingCommands(targetDir: string): Promise<ExistingCommandNode[]> {
  const publicDir = path.join(targetDir, 'Public');
  const files = await readdir(publicDir);
  const paths = files.filter((f) => f.endsWith('.ps1')).map((f) => f.replace(/\.ps1$/, ''));
  return buildCommandTree(paths);
}

function powershellParamType(param: ParameterSpec): string {
  if (param.type === 'integer') return '[int]';
  if (param.type === 'boolean') return '[switch]';
  return '[string]';
}

function parameterDeclaration(param: ParameterSpec): string {
  const lines: string[] = [];
  if (param.type === 'enum') {
    lines.push(`    [ValidateSet(${(param.allowedValues ?? []).map((v) => `'${v}'`).join(', ')})]`);
  }
  // Booleans use [switch], which is structurally always-optional — never marked Mandatory,
  // matching the clispark-add-established invariant that boolean parameters must be optional.
  if (param.required && param.type !== 'boolean') {
    lines.push('    [Parameter(Mandatory)]');
  }
  lines.push(`    ${powershellParamType(param)}$${param.name}`);
  return lines.join('\n');
}

function generateCommandFileContent(spec: CommandSpec): string {
  const funcName = spec.pathSegments[spec.pathSegments.length - 1];
  const paramLines = spec.parameters.map(parameterDeclaration).join(',\n\n');
  const paramBlock = spec.parameters.length > 0 ? `\n${paramLines}\n` : '';
  // Echoes back received parameters rather than a bare "TODO" comment — same convention as
  // the Node generator (`this.log(...)` with the arg values), giving the scaffolded stub real,
  // runnable content the user replaces, and something for the generated Pester test to assert on.
  const echoLines =
    spec.parameters.length > 0
      ? spec.parameters.map((p) => `        Write-Output "${p.name}=$${p.name}"`).join('\n')
      : `        Write-Output '${funcName} ran'`;

  return `function ${funcName} {
    [CmdletBinding()]
    param(${paramBlock})
    process {
${echoLines}
    }
}
`;
}

/** Same purpose as the Node generator's `sampleArgValue()` — a required (Mandatory) parameter
 *  left unfilled would make the generated smoke test hang/fail on parameter binding, not just
 *  produce a wrong result. Only Mandatory parameters need a sample value here; optional ones
 *  (including all [switch] booleans, which are never Mandatory) can be safely omitted. */
function sampleParamValue(param: ParameterSpec): string {
  if (param.type === 'enum') return param.allowedValues?.[0] ?? '';
  if (param.type === 'integer') return '1';
  return 'value';
}

function generateTestFileContent(spec: CommandSpec): string {
  const funcName = spec.pathSegments[spec.pathSegments.length - 1];
  const mandatoryArgs = spec.parameters
    .filter((p) => p.required && p.type !== 'boolean')
    .map((p) => `-${p.name} '${sampleParamValue(p)}'`)
    .join(' ');
  const invocation = mandatoryArgs ? `${funcName} ${mandatoryArgs}` : funcName;

  return `Describe '${funcName}' {
    It 'runs without error' {
        { ${invocation} } | Should -Not -Throw
    }
}
`;
}

async function generateCommand(targetDir: string, spec: CommandSpec): Promise<GeneratedFiles> {
  const funcName = spec.pathSegments[spec.pathSegments.length - 1];
  const commandRelPath = path.join('Public', `${funcName}.ps1`);
  const testRelPath = path.join('tests', `${funcName}.Tests.ps1`);

  await mkdir(path.join(targetDir, 'Public'), { recursive: true });
  await mkdir(path.join(targetDir, 'tests'), { recursive: true });
  await writeFile(path.join(targetDir, commandRelPath), generateCommandFileContent(spec));
  await writeFile(path.join(targetDir, testRelPath), generateTestFileContent(spec));

  return { commandFile: commandRelPath.replace(/\\/g, '/'), testFile: testRelPath.replace(/\\/g, '/') };
}

async function promptCommandIdentity(_pathSegments: string[], existingPaths: Set<string>): Promise<string[]> {
  const verbValue = await select({
    message: 'Verb (from PowerShell’s approved-verb list)',
    options: APPROVED_VERBS.map((v) => ({ value: v, label: v })),
  });
  exitIfCancelled(verbValue);

  const nounValue = await text({
    message: 'Noun',
    validate: (value) => {
      if (!/^[A-Z][A-Za-z0-9]*$/.test(value)) return 'Use PascalCase, starting with an uppercase letter (e.g. TaskList).';
      const fullName = `${verbValue as string}-${value}`;
      if (existingPaths.has(fullName)) return `"${fullName}" already exists.`;
      return undefined;
    },
  });
  exitIfCancelled(nounValue);

  return [`${verbValue as string}-${nounValue as string}`];
}

export const powershellCommandGenerator: CommandGenerator = {
  listExistingCommands,
  generateCommand,
  promptCommandIdentity,
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/languages/command-generators/powershell.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Full verification and commit**

Run: `npx tsc --noEmit && npx eslint src scripts && npx vitest run`
Expected: all pass.

```bash
git add src/languages/command-generators/powershell.ts src/languages/command-generators/powershell.test.ts
git commit -m "feat: add PowerShell Verb+Noun command generator"
```

---

### Task 5: Template content — module manifest, proxy-wrapper module root, example cmdlet, logging, Pester test

**Files:**
- Create: `templates/powershell/Module.psd1`
- Create: `templates/powershell/Module.psm1`
- Create: `templates/powershell/Public/Get-Hello.ps1`
- Create: `templates/powershell/Private/.gitkeep`
- Create: `templates/powershell/Logging/Initialize-Logging.ps1`
- Create: `templates/powershell/tests/Get-Hello.Tests.ps1`
- Create: `templates/powershell/ARCHITECTURE.md`
- Create: `templates/powershell/README.md`
- Create: `templates/powershell/gitignore`

**No unit tests in this task** — this is static template content, verified via real scaffold + real module import in Task 7, matching how `templates/node`/`templates/dotnet` content isn't unit-tested directly either.

- [ ] **Step 1: Install `pwsh` 7.4+ if not already available, and re-verify the proxy-wrapper prototype for real**

Before writing `Module.psm1`, confirm the exact prototype sequence from the design spec still behaves identically under real PowerShell 7.4+/Core (not just Windows PowerShell 5.1 Desktop, which is all that was available when the spec was written). Run this in a real `pwsh` session:

```powershell
function Get-Hello {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory, Position = 0)] [string]$Name,
        [Parameter()] [int]$Times = 1,
        [Parameter(ValueFromPipeline)] [string]$PipeValue
    )
    process {
        for ($i = 0; $i -lt $Times; $i++) { Write-Output "Hello, $Name! (pipe=$PipeValue)" }
    }
}

$renamedName = '__orig_Get-Hello'
Rename-Item Function:\Get-Hello $renamedName
$renamedCmd = Get-Command $renamedName -CommandType Function
$metadata = [System.Management.Automation.CommandMetadata]::new($renamedCmd)
$paramBlock = [System.Management.Automation.ProxyCommand]::GetParamBlock($metadata)
$beginBlock = [System.Management.Automation.ProxyCommand]::GetBegin($metadata)
$processBlock = [System.Management.Automation.ProxyCommand]::GetProcess($metadata)
$endBlock = [System.Management.Automation.ProxyCommand]::GetEnd($metadata)
$cmdletBinding = [System.Management.Automation.ProxyCommand]::GetCmdletBindingAttribute($metadata)
# ... (full wrapper assembly — see Step 2's Module.psm1 content, this is the same technique)
```

Expected: identical behavior to the spec's documented findings (pipeline binding preserved, error logging works, no "unapproved verb" warning once `Export-ModuleMember` is scoped). **If anything differs on real PS7+, stop and update this plan/spec before continuing** — do not silently adapt Step 2's code to paper over a difference.

- [ ] **Step 2: Create `Module.psd1`**

```powershell
@{
    RootModule        = 'Module.psm1'
    ModuleVersion     = '0.1.0'
    GUID              = '00000000-0000-0000-0000-000000000000'
    Author            = 'Unknown'
    Description       = 'Scaffolded by clispark.'
    PowerShellVersion = '7.4'
    FunctionsToExport = @('Get-Hello')
    RequiredModules   = @('PSFramework', 'Pester', 'Microsoft.PowerShell.PSResourceGet')
    PrivateData       = @{
        PSData = @{
            Tags = @()
        }
    }
}
```

- [ ] **Step 3: Create `Module.psm1`** (the function-proxy-wrapper mechanism, transcribed from the verified prototype)

```powershell
# Module.psm1 — loads every cmdlet in Public/ and wraps it with automatic logging and
# error handling. Cmdlet authors never write their own try/catch or logging calls.

. (Join-Path $PSScriptRoot 'Logging' 'Initialize-Logging.ps1')

$publicFiles = Get-ChildItem -Path (Join-Path $PSScriptRoot 'Public') -Filter '*.ps1'
$publicFuncNames = $publicFiles.BaseName

foreach ($file in $publicFiles) {
    . $file.FullName
    $funcName = $file.BaseName

    # Rename the real implementation FIRST, then build the proxy metadata against the RENAMED
    # command — the generated begin-block re-resolves the wrapped command by name at call time,
    # so building metadata from the original name before renaming would make the wrapper recurse
    # into itself once installed under that same name (verified for real during the design spec).
    $renamedName = "__orig_$funcName"
    Rename-Item "Function:\$funcName" $renamedName
    $renamedCmd = Get-Command $renamedName -CommandType Function
    $metadata = [System.Management.Automation.CommandMetadata]::new($renamedCmd)

    $paramBlock = [System.Management.Automation.ProxyCommand]::GetParamBlock($metadata)
    $beginBlock = [System.Management.Automation.ProxyCommand]::GetBegin($metadata)
    $processBlock = [System.Management.Automation.ProxyCommand]::GetProcess($metadata)
    $endBlock = [System.Management.Automation.ProxyCommand]::GetEnd($metadata)
    $cmdletBinding = [System.Management.Automation.ProxyCommand]::GetCmdletBindingAttribute($metadata)

    $wrapperDef = @"
function $funcName {
$cmdletBinding
param(
$paramBlock
)
begin {
    Write-PSFMessage -Level Verbose -Message "started: $funcName"
    `$__sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
$beginBlock
    } catch {
        Write-PSFMessage -Level Error -Message "failed: $funcName" -ErrorRecord `$_
        throw
    }
}
process {
    try {
$processBlock
    } catch {
        Write-PSFMessage -Level Error -Message "failed: $funcName" -ErrorRecord `$_
        throw
    }
}
end {
    try {
$endBlock
        Write-PSFMessage -Level Verbose -Message "completed: $funcName (`$(`$__sw.ElapsedMilliseconds)ms)"
    } catch {
        Write-PSFMessage -Level Error -Message "failed: $funcName" -ErrorRecord `$_
        throw
    }
}
}
"@

    Invoke-Expression $wrapperDef
}

# Export only the real Public/ function names — never `-Function *`, which would also export
# the renamed __orig_* internals and trigger PowerShell's "unapproved verb" warning on import
# (verified for real during the design spec).
Export-ModuleMember -Function $publicFuncNames
```

- [ ] **Step 4: Create `Logging/Initialize-Logging.ps1`**

```powershell
# Logging/Initialize-Logging.ps1 — PSFramework setup, loaded by Module.psm1 before any cmdlet
# is wrapped. Mirrors the Node/.NET templates' logging principles: redaction, retention, DEBUG
# streaming, a visible log path on both success and failure.

Import-Module PSFramework -ErrorAction Stop

$logDirectory = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'clispark-generated' 'Logs'
if (-not (Test-Path $logDirectory)) {
    New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
}

Set-PSFLoggingProvider -Name 'logfile' -InstanceName 'default' -FilePath (Join-Path $logDirectory 'log-%date%.jsonl') -Enabled $true

if ($env:DEBUG) {
    Set-PSFLoggingProvider -Name 'console' -InstanceName 'default' -Enabled $true
}

# Retention: remove log files older than 14 days, best-effort (matches the Node/.NET templates'
# LOG_RETENTION_DAYS convention — same default, same "never block the command on a sweep failure").
try {
    $cutoff = (Get-Date).AddDays(-14)
    Get-ChildItem -Path $logDirectory -Filter 'log-*.jsonl' -ErrorAction SilentlyContinue |
        Where-Object { $_.LastWriteTime -lt $cutoff } |
        Remove-Item -ErrorAction SilentlyContinue
} catch {
    # Best-effort — a failed sweep must never block the command itself.
}
```

- [ ] **Step 5: Create `Public/Get-Hello.ps1`**

```powershell
function Get-Hello {
    [CmdletBinding()]
    param(
        [Parameter(Position = 0)]
        [string]$Name = 'World'
    )
    process {
        Write-Output "Hello, $Name!"
    }
}
```

- [ ] **Step 6: Create `tests/Get-Hello.Tests.ps1`**

```powershell
Describe 'Get-Hello' {
    It 'greets the given name' {
        Get-Hello -Name 'Pester' | Should -Be 'Hello, Pester!'
    }

    It 'defaults to World when no name is given' {
        Get-Hello | Should -Be 'Hello, World!'
    }
}
```

- [ ] **Step 7: Create `Private/.gitkeep`** (empty file — documents the convention, keeps the empty folder in git)

- [ ] **Step 8: Create `gitignore`**

```
Logs/
*.log
```

- [ ] **Step 9: Create `README.md`**

```markdown
# {{projectName}}

A PowerShell module scaffolded by [clispark](https://www.npmjs.com/package/clispark).

## Usage

```powershell
Import-Module ./Module.psd1
Get-Hello -Name 'World'
```

## Adding a new cmdlet

Run `clispark add` from this directory, or drop a new `.ps1` file into `Public/` following the
existing `Get-Hello.ps1` pattern — every function found there is automatically wrapped with
logging and error handling on module import, no manual try/catch needed.

## Testing

```powershell
Invoke-Pester ./tests
```

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md).
```

(The scaffold's existing template-copy mechanism already replaces `{{projectName}}`-style placeholders — verify the exact placeholder syntax against `templates/node/README.md`/`templates/dotnet/README.md` before finalizing this file, and match it exactly.)

- [ ] **Step 10: Create `ARCHITECTURE.md`**

```markdown
# Architecture

This project is a PowerShell module (`.psd1`/`.psm1`), not a single script — cmdlets get proper
tab-completion, pipeline support, and discoverability via `Get-Command`.

## Auto-registration

Every `.ps1` file in `Public/` becomes an exported cmdlet automatically — no manual registration
step. The filename must match the function name inside it (e.g. `Get-Hello.ps1` defines
`function Get-Hello`).

## Auto-logging and error handling

`Module.psm1` wraps every `Public/` function with a **function-proxy-wrapper** at import time:
logging (`started`/`completed`/`failed`) and error handling are added automatically, using
PowerShell's own `System.Management.Automation.ProxyCommand` API — the same mechanism PowerShell's
own module-remoting proxies use, so pipeline input and all parameter attributes are preserved
exactly. Cmdlet authors never write their own try/catch or logging calls.

## Testing

[Pester](https://pester.dev/) — one `.Tests.ps1` file per cmdlet in `tests/`.

## Logging

[PSFramework](https://psframework.org/) — see `Logging/Initialize-Logging.ps1`.
```

- [ ] **Step 11: Commit**

```bash
git add templates/powershell
git commit -m "feat: add PowerShell module template content"
```

---

### Task 6: `powershellPack: LanguagePack` — wire everything together

**Files:**
- Create: `src/languages/packs/powershell.ts`
- Test: `src/languages/packs/powershell.test.ts`
- Modify: `src/languages/index.ts`

**Interfaces:**
- Consumes: `powershellAdapter` (Task 3), `powershellGalleryRegistryChecker`/`POWERSHELL_GALLERY_DEFAULT_URL` (Task 2), `powershellCommandGenerator` (Task 4).
- Produces: `powershellPack: LanguagePack`.

- [ ] **Step 1: Write the failing test**

Create `src/languages/packs/powershell.test.ts`:

```ts
// src/languages/packs/powershell.test.ts
import { describe, it, expect } from 'vitest';
import { powershellPack } from './powershell';

describe('powershellPack.validateProjectName', () => {
  it.each(['MyTool', 'Task', 'HelloWorld123'])('accepts PascalCase name "%s"', (name) => {
    expect(powershellPack.validateProjectName(name)).toBeUndefined();
  });

  it.each(['myTool', 'my-tool', '123Tool', ''])('rejects invalid name "%s"', (name) => {
    expect(powershellPack.validateProjectName(name)).toBeDefined();
  });
});

describe('powershellPack scaffold setup', () => {
  it('installs the three required modules via scaffoldCommands', () => {
    expect(powershellPack.scaffoldCommands).toHaveLength(1);
    expect(powershellPack.scaffoldCommands[0].command).toBe('pwsh');
    expect(powershellPack.scaffoldCommands[0].args.join(' ')).toContain('PSFramework,Pester,Microsoft.PowerShell.PSResourceGet');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/languages/packs/powershell.test.ts`
Expected: FAIL — `Cannot find module './powershell'`.

- [ ] **Step 3: Implement `src/languages/packs/powershell.ts`**

```ts
// src/languages/packs/powershell.ts
import path from 'node:path';
import { findPackageRoot } from '../../package-root';
import type { LanguagePack } from '../pack';
import { powershellAdapter } from '../../update/adapters/powershell';
import { powershellGalleryRegistryChecker, POWERSHELL_GALLERY_DEFAULT_URL } from '../registry-checkers/powershell-gallery';
import { powershellCommandGenerator } from '../command-generators/powershell';

function validateProjectName(value: string): string | undefined {
  if (!value || value.trim().length === 0) return 'Project name is required.';
  if (!/^[A-Z][A-Za-z0-9]*$/.test(value)) {
    return 'Use PascalCase, starting with an uppercase letter (e.g. MyTool).';
  }
  return undefined;
}

export const powershellPack: LanguagePack = {
  id: 'powershell',
  displayName: 'PowerShell (7.4+)',
  templateDir: path.join(findPackageRoot(), 'templates', 'powershell'),
  scaffoldCommands: [
    {
      command: 'pwsh',
      args: ['-NoProfile', '-Command', 'Install-Module -Name PSFramework,Pester,Microsoft.PowerShell.PSResourceGet -Scope CurrentUser -Force -AllowClobber'],
    },
  ],
  validateProjectName,
  updateAdapter: powershellAdapter,
  registry: {
    defaultUrl: POWERSHELL_GALLERY_DEFAULT_URL,
    promptLabel: 'Custom PowerShell repository URL (leave empty for the PowerShell Gallery)',
    checkNameAvailability: powershellGalleryRegistryChecker.checkNameAvailability,
    applyPrivateIntent: powershellGalleryRegistryChecker.applyPrivateIntent,
    applyRegistryUrl: powershellGalleryRegistryChecker.applyRegistryUrl,
  },
  commandGenerator: powershellCommandGenerator,
};
```

- [ ] **Step 4: Register the pack**

Edit `src/languages/index.ts`:

```ts
// src/languages/index.ts
import type { LanguagePack } from './pack';
import { nodeOclifPack } from './packs/node-oclif';
import { dotnetPack } from './packs/dotnet';
import { powershellPack } from './packs/powershell';

export const LANGUAGE_PACKS: Record<string, LanguagePack> = {
  [nodeOclifPack.id]: nodeOclifPack,
  [dotnetPack.id]: dotnetPack,
  [powershellPack.id]: powershellPack,
};

export function getPackById(id: string): LanguagePack | undefined {
  return LANGUAGE_PACKS[id];
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/languages/packs/powershell.test.ts src/languages/index.test.ts`
Expected: PASS.

- [ ] **Step 6: Full verification and commit**

Run: `npx tsc --noEmit && npx eslint src scripts && npx vitest run`
Expected: all pass — including `src/languages/index.test.ts`'s existing assertions about `nodeOclifPack`/`dotnetPack`, unaffected by the addition.

```bash
git add src/languages/packs/powershell.ts src/languages/packs/powershell.test.ts src/languages/index.ts
git commit -m "feat: register the PowerShell LanguagePack"
```

---

### Task 7: Full manual end-to-end verification

Mirrors the verification depth of prior milestones' final task (M12b, post-scaffold-hooks). **Requires real `pwsh` 7.4+ installed** — do not substitute mocks or skip steps that need it; if any step here can't be run for real in the environment executing this plan, stop and report exactly which step is blocked rather than marking it done from inspection alone.

**Files:** none (verification only).

- [ ] **Step 1: Build and verify clispark itself**

```bash
npx tsc --noEmit && npx eslint src scripts && npx vitest run && npx tsup
```
Expected: all pass.

- [ ] **Step 2: Real scaffold — PowerShell selectable in the wizard**

```bash
node dist/cli.js
```
Answer: language = PowerShell (7.4+), any project name (e.g. `HookVerifyTool`), profile = Private, publish intent = No. Expected: scaffold completes, `PSFramework`/`Pester`/`Microsoft.PowerShell.PSResourceGet` install without error (real `pwsh` shell-out from `scaffoldCommands`).

- [ ] **Step 3: Real module import and cmdlet run**

From the scaffolded directory, in a real `pwsh` session:

```powershell
Import-Module ./Module.psd1 -Force
Get-Hello -Name 'World'
```
Expected: `Hello, World!` printed, plus visible PSFramework log lines for `started`/`completed` (confirms the proxy-wrapper mechanism from Task 5 works end-to-end against the real scaffolded module, not just the standalone prototype).

- [ ] **Step 4: Real Pester run**

```powershell
Invoke-Pester ./tests
```
Expected: 2/2 tests pass (`Get-Hello.Tests.ps1`).

- [ ] **Step 5: Real `clispark add` — Verb+Noun wizard path**

```bash
node <path-to-clispark-repo>/dist/cli.js add
```
(from the scaffolded directory) Expected: prompts show a Verb dropdown and a separate Noun text field (not the generic single-name prompt) — confirms `promptCommandIdentity` (Task 1/4) is wired correctly. Create e.g. `New-Widget` with one required string parameter and one boolean parameter. Verify the generated `Public/New-Widget.ps1` has `[Parameter(Mandatory)]` on the string param and a bare `[switch]` on the boolean param (no `Mandatory`).

- [ ] **Step 6: Real `clispark update` — no-op and real-change paths**

Run `node <path-to-clispark-repo>/dist/cli.js update` against the unmodified scaffold — expected: reports up to date, no changes. Then manually edit the scaffolded `Module.psd1`'s `ModuleVersion` to an old value and re-run `update` — expected: `ModuleVersion` is corrected back, `RequiredModules` untouched (already matches), real `pwsh`-shell-out read succeeds against the real generated manifest.

- [ ] **Step 7: Broken-hook-equivalent negative check — a cmdlet that throws**

Add a throwing cmdlet manually (`Public/Invoke-Boom.ps1`, `throw 'deliberate failure'`), re-import the module, call it. Expected: PSFramework logs a `failed: Invoke-Boom` error entry, the real exception (`deliberate failure`) still propagates to the caller (matches the design spec's verified behavior, now against a real scaffolded module rather than the standalone prototype).

- [ ] **Step 8: Clean up**

Remove every throwaway scaffolded project directory created during this task.

- [ ] **Step 9: Update `project-ideas/clispark.plan.md`, the project's memory file, and issue #82**

Mark this feature complete with a summary (PR number, release version once shipped, any real bugs found during Steps 2–7 beyond what's already documented in this plan's Global Constraints), per this project's established convention. Update issue #82's body (not just a comment) with a `## Status` update reflecting the finished implementation, keeping the existing Design/Community-input sections. Move its label from `status:planned`/whatever it's on at execution time to reflect completion (issue gets closed once shipped, per this project's "closed = done" convention).

- [ ] **Step 10: Final commit if Steps 2–8 required any fixes**

If any verification step required a code fix, commit it now with a clear message describing the real bug found and fixed.
