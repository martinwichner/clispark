# M12b: .NET Template Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `.NET` `LanguagePack` to clispark so `clispark` can scaffold a real, working .NET global CLI tool (System.CommandLine + Serilog + xUnit), using the `LanguagePack` architecture M12a already built.

**Architecture:** A new `templates/dotnet/` template (a `net10.0` console app packaged as a `dotnet tool`, with reflection-based command auto-discovery, a Serilog-based logger mirroring the Node template's pino logger, and xUnit tests) plus a new `dotnetPack: LanguagePack` (`src/languages/packs/dotnet.ts`) that bundles it with a new `UpdateAdapter` (regex-based `.csproj` editing — no XML/DOM library) and a new NuGet `RegistryChecker`. Along the way, fixes a real gap found during the M12a review: `scaffold.ts`'s custom-registry-URL logic is still npm-hardcoded.

**Tech Stack:** .NET SDK `10.0.x`, System.CommandLine `2.0.10`, Serilog `4.4.0` (+ `Serilog.Sinks.File` `7.0.0`, `Serilog.Sinks.Console` `6.1.1`), `Xdg.Directories` `0.1.2`, xUnit (`Microsoft.NET.Test.Sdk` `17.14.1`, `xunit` `2.9.3`, `xunit.runner.visualstudio` `3.1.4`, `coverlet.collector` `6.0.4`).

## Global Constraints

- Every piece of C# code in this plan has been written and empirically verified (`dotnet build`/`dotnet test`/`dotnet pack`/`dotnet tool install -g`/real CLI invocations) in a throwaway prototype before this plan was written — copy it as given, don't "improve" the API usage without re-verifying, since `System.CommandLine` 2.0's API is easy to get subtly wrong (see the `EnableDefaultExceptionHandler` note below).
- **Critical `System.CommandLine` 2.0 gotcha:** `ParseResult.Invoke()` (no-arg / default config) has a **built-in exception handler that silently swallows exceptions** thrown from a command's `SetAction` callback — it prints its own "Unhandled exception" message with a full stack trace to stderr and returns, but a `try`/`catch` wrapped around `.Invoke()` will **never** see the exception. You must pass `new InvocationConfiguration { EnableDefaultExceptionHandler = false }` to `Invoke(config)` for your own exception handling to run at all. This applies equally in tests that call `.Invoke()` directly on a command's `Build()` output.
- **Solution file format:** `dotnet new sln` on the .NET 10 SDK generates the newer `.slnx` (XML) format, not the classic `.sln` format. Use `Cli.slnx` everywhere (`dotnet build Cli.slnx`, `dotnet test Cli.slnx`) — both work identically to the old `.sln` at the CLI.
- No dependency-injection container — a single ambient `Serilog.Log.Logger` (static) is enough for a template this size; don't add `Microsoft.Extensions.DependencyInjection` back in.
- No XML/DOM library for the NuGet `UpdateAdapter` — targeted regex replacement only (see Task 6). clispark fully controls the `.csproj` format it generates, so a DOM round-trip buys nothing and risks reformatting diffs.
- Target framework for the generated .NET project: `net10.0`.
- Project name validation for .NET: PascalCase (`^[A-Z][A-Za-z0-9]*$`) — enforced in `dotnetPack.validateProjectName`, not in generic `wizard.ts`.
- `wizard.ts` and `cli.ts` need **zero** changes in this plan — both were already fully generalized over `LanguagePack` in M12a and pick up any pack registered in `LANGUAGE_PACKS` automatically. If a task in this plan finds itself wanting to touch either file, stop and re-read `src/languages/pack.ts` first — that's a sign something is being over-engineered.
- Every new TypeScript file follows the project's existing DI convention: impure dependencies (network calls, filesystem, `Math.random`, etc.) are injectable function parameters with real defaults, not hardcoded — see `src/languages/registry-checkers/npm.ts` for the pattern to match.
- Every task ends in a state where `npx tsc --noEmit`, `npx eslint src scripts`, and `npx vitest run` all pass in the clispark repo root.

---

## File Structure

```
src/
  languages/
    registry-checker.ts              # MODIFY — add applyRegistryUrl to RegistryChecker
    registry-checkers/
      npm.ts                         # MODIFY — implement applyRegistryUrl (moved from scaffold.ts)
      npm.test.ts                    # MODIFY — add applyRegistryUrl tests
      nuget.ts                       # CREATE — NuGet RegistryChecker
      nuget.test.ts                  # CREATE
    packs/
      dotnet.ts                      # CREATE — dotnetPack: LanguagePack
      dotnet.test.ts                 # CREATE
    index.ts                         # MODIFY — register dotnetPack
  scaffold.ts                        # MODIFY — call pack.registry.applyRegistryUrl generically
  scaffold.test.ts                   # unchanged — existing .npmrc tests still pass through the new path
  update/
    adapters/
      dotnet.ts                      # CREATE — NuGet UpdateAdapter (regex-based .csproj editing)
      dotnet.test.ts                 # CREATE

templates/
  dotnet/
    Cli.slnx
    gitignore                        # renamed to .gitignore by scaffold.ts, same as templates/node/
    README.md
    ARCHITECTURE.md
    src/
      Cli.csproj
      Program.cs
      ICliCommand.cs
      CommandPathAttribute.cs
      CommandDiscovery.cs
      CliUserException.cs
      Commands/
        HelloCommand.cs
        TaskCommand.cs
        TaskListCommand.cs
        TaskCompleteCommand.cs
      Logging/
        CliLoggerFactory.cs
        SensitivePropertyEnricher.cs
    tests/
      Cli.Tests.csproj
      HelloCommandTests.cs
      TaskCompleteCommandTests.cs

.github/workflows/ci.yml             # MODIFY — new scaffold-smoke-dotnet job
```

---

### Task 1: Fix the `.npmrc`/`LanguageRegistry` gap (foundational, do first)

Extends `RegistryChecker` with `applyRegistryUrl()` and moves `scaffold.ts`'s npm-hardcoded `.npmrc`-writing into the npm checker. This has **zero behavior change for Node** — it's a pure relocation, verified by the existing `scaffold.test.ts` assertions still passing unmodified. Required before Task 2 (the NuGet checker needs the same interface method to exist).

**Files:**
- Modify: `src/languages/registry-checker.ts`
- Modify: `src/languages/registry-checkers/npm.ts`
- Modify: `src/languages/registry-checkers/npm.test.ts`
- Modify: `src/scaffold.ts:57-74`
- Test: `src/scaffold.test.ts` (existing tests, no changes needed — verifies zero behavior change)

**Interfaces:**
- Produces: `RegistryChecker.applyRegistryUrl(targetDir: string, registryUrl: string): Promise<void>` — every `LanguagePack.registry` (npm and, from Task 2, nuget) implements this.

- [ ] **Step 1: Add `applyRegistryUrl` to the `RegistryChecker` interface**

Edit `src/languages/registry-checker.ts`:

```ts
export type NameCheckResult = 'available' | 'taken' | 'unverified' | 'skipped';

/**
 * Isolates how a language's package registry (npm, NuGet, ...) is queried
 * for name availability, and what "don't publish this" means for that
 * ecosystem's manifest file — from the generic wizard flow.
 */
export interface RegistryChecker {
  checkNameAvailability(name: string, registryUrl: string): Promise<NameCheckResult>;
  applyPrivateIntent(targetDir: string): Promise<void>;
  applyRegistryUrl(targetDir: string, registryUrl: string): Promise<void>;
}
```

- [ ] **Step 2: Write the failing test for `npmRegistryChecker.applyRegistryUrl`**

Add to `src/languages/registry-checkers/npm.test.ts`, after the existing `describe('npmRegistryChecker.applyPrivateIntent', ...)` block:

```ts
describe('npmRegistryChecker.applyRegistryUrl', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(path.join(tmpdir(), 'clispark-npm-registry-checker-test-'));
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it('writes a .npmrc with the given registry URL', async () => {
    await npmRegistryChecker.applyRegistryUrl(tmpRoot, 'https://registry.example.com');

    const npmrc = await readFile(path.join(tmpRoot, '.npmrc'), 'utf8');
    expect(npmrc).toBe('registry=https://registry.example.com\n');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/languages/registry-checkers/npm.test.ts`
Expected: FAIL — `npmRegistryChecker.applyRegistryUrl is not a function`

- [ ] **Step 4: Implement `applyRegistryUrl` in the npm checker**

Edit `src/languages/registry-checkers/npm.ts` — add the function and wire it into the exported object:

```ts
// src/languages/registry-checkers/npm.ts
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { NameCheckResult, RegistryChecker } from '../registry-checker';

export const NPM_DEFAULT_REGISTRY_URL = 'https://registry.npmjs.org';

const FETCH_TIMEOUT_MS = 5000;

async function checkNameAvailability(name: string, registryUrl: string): Promise<NameCheckResult> {
  const url = `${registryUrl.replace(/\/$/, '')}/${encodeURIComponent(name)}`;

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (response.status === 404) return 'available';
    if (response.status === 200) return 'taken';
    return 'unverified';
  } catch {
    return 'unverified';
  }
}

async function applyPrivateIntent(targetDir: string): Promise<void> {
  const packageJsonPath = path.join(targetDir, 'package.json');
  const pkg = JSON.parse(await readFile(packageJsonPath, 'utf8')) as Record<string, unknown>;
  pkg.private = true;
  await writeFile(packageJsonPath, JSON.stringify(pkg, null, 2) + '\n');
}

async function applyRegistryUrl(targetDir: string, registryUrl: string): Promise<void> {
  await writeFile(path.join(targetDir, '.npmrc'), `registry=${registryUrl}\n`);
}

export const npmRegistryChecker: RegistryChecker = {
  checkNameAvailability,
  applyPrivateIntent,
  applyRegistryUrl,
};
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/languages/registry-checkers/npm.test.ts`
Expected: PASS (6 tests in the file)

- [ ] **Step 6: Generalize `scaffold.ts` to call the pack's `applyRegistryUrl`**

Edit `src/scaffold.ts` — replace lines 71-72:

```ts
  if (registryUrl && registryUrl !== pack.registry.defaultUrl) {
    await writeFile(path.join(targetDir, '.npmrc'), `registry=${registryUrl}\n`);
  }
```

with:

```ts
  if (registryUrl && registryUrl !== pack.registry.defaultUrl) {
    await pack.registry.applyRegistryUrl(targetDir, registryUrl);
  }
```

Note: `writeFile` may now be an unused import in `scaffold.ts` if nothing else in the file uses it — check with `npx eslint src/scaffold.ts` and remove the import if it flags unused.

- [ ] **Step 7: Run the full existing scaffold test suite to verify zero behavior change**

Run: `npx vitest run src/scaffold.test.ts`
Expected: PASS — all existing tests (including `'writes a .npmrc with the custom registry when registryUrl differs from the default'` and `'does not write a .npmrc when registryUrl is omitted or equal to the default'`) pass unmodified, proving the relocation didn't change Node's behavior.

- [ ] **Step 8: Full verification and commit**

Run: `npx tsc --noEmit && npx eslint src scripts && npx vitest run`
Expected: all pass, 0 errors.

```bash
git add src/languages/registry-checker.ts src/languages/registry-checkers/npm.ts src/languages/registry-checkers/npm.test.ts src/scaffold.ts
git commit -m "refactor: move .npmrc-writing into RegistryChecker.applyRegistryUrl"
```

---

### Task 2: NuGet `RegistryChecker`

New `src/languages/registry-checkers/nuget.ts` implementing name-availability check, `applyPrivateIntent` (`<IsPackable>false</IsPackable>`), and `applyRegistryUrl` (writes `NuGet.config`).

**Files:**
- Create: `src/languages/registry-checkers/nuget.ts`
- Test: `src/languages/registry-checkers/nuget.test.ts`

**Interfaces:**
- Consumes: `RegistryChecker` (from Task 1, `src/languages/registry-checker.ts`), `NameCheckResult`.
- Produces: `nugetRegistryChecker: RegistryChecker`, `NUGET_DEFAULT_REGISTRY_URL: string`.

- [ ] **Step 1: Write the failing tests**

Create `src/languages/registry-checkers/nuget.test.ts`:

```ts
// src/languages/registry-checkers/nuget.test.ts
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { nugetRegistryChecker, NUGET_DEFAULT_REGISTRY_URL } from './nuget';

describe('nugetRegistryChecker.checkNameAvailability', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns "available" when the registry responds 404', async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 404 } as Response);
    const result = await nugetRegistryChecker.checkNameAvailability('SomeFreeTool', NUGET_DEFAULT_REGISTRY_URL);
    expect(result).toBe('available');
  });

  it('lowercases the package ID in the request URL', async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 404 } as Response);
    await nugetRegistryChecker.checkNameAvailability('MyTool', NUGET_DEFAULT_REGISTRY_URL);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.nuget.org/v3-flatcontainer/mytool/index.json',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('returns "taken" when the registry responds 200', async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 200 } as Response);
    const result = await nugetRegistryChecker.checkNameAvailability('Newtonsoft.Json', NUGET_DEFAULT_REGISTRY_URL);
    expect(result).toBe('taken');
  });

  it('returns "unverified" on an unexpected status code', async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 500 } as Response);
    const result = await nugetRegistryChecker.checkNameAvailability('SomeTool', NUGET_DEFAULT_REGISTRY_URL);
    expect(result).toBe('unverified');
  });

  it('returns "unverified" when the network request throws', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network down'));
    const result = await nugetRegistryChecker.checkNameAvailability('SomeTool', NUGET_DEFAULT_REGISTRY_URL);
    expect(result).toBe('unverified');
  });

  it('returns "unverified" when the request times out', async () => {
    global.fetch = vi.fn().mockRejectedValue(new DOMException('The operation was aborted.', 'TimeoutError'));
    const result = await nugetRegistryChecker.checkNameAvailability('SomeTool', NUGET_DEFAULT_REGISTRY_URL);
    expect(result).toBe('unverified');
  });
});

describe('nugetRegistryChecker.applyPrivateIntent', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(path.join(tmpdir(), 'clispark-nuget-registry-checker-test-'));
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it('adds <IsPackable>false</IsPackable> to the first PropertyGroup of src/Cli.csproj', async () => {
    await writeFile(
      path.join(tmpRoot, 'src'),
      '',
      { flag: 'wx' },
    ).catch(() => undefined); // no-op if a leftover file exists from a prior failed run
    const srcDir = path.join(tmpRoot, 'src');
    await import('node:fs/promises').then((fs) => fs.mkdir(srcDir, { recursive: true }));
    await writeFile(
      path.join(srcDir, 'Cli.csproj'),
      '<Project Sdk="Microsoft.NET.Sdk">\n\n  <PropertyGroup>\n    <TargetFramework>net10.0</TargetFramework>\n  </PropertyGroup>\n\n</Project>\n',
    );

    await nugetRegistryChecker.applyPrivateIntent(tmpRoot);

    const csproj = await readFile(path.join(srcDir, 'Cli.csproj'), 'utf8');
    expect(csproj).toContain('<IsPackable>false</IsPackable>');
    expect(csproj).toContain('<TargetFramework>net10.0</TargetFramework>');
  });
});

describe('nugetRegistryChecker.applyRegistryUrl', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(path.join(tmpdir(), 'clispark-nuget-registry-checker-test-'));
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it('writes a NuGet.config with <clear/> and the custom source', async () => {
    await nugetRegistryChecker.applyRegistryUrl(tmpRoot, 'https://nuget.mycompany.dev/v3/index.json');

    const config = await readFile(path.join(tmpRoot, 'NuGet.config'), 'utf8');
    expect(config).toContain('<clear />');
    expect(config).toContain('<add key="custom" value="https://nuget.mycompany.dev/v3/index.json" />');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/languages/registry-checkers/nuget.test.ts`
Expected: FAIL — `Cannot find module './nuget'`

- [ ] **Step 3: Implement the NuGet registry checker**

Create `src/languages/registry-checkers/nuget.ts`:

```ts
// src/languages/registry-checkers/nuget.ts
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { NameCheckResult, RegistryChecker } from '../registry-checker';

export const NUGET_DEFAULT_REGISTRY_URL = 'https://api.nuget.org/v3/index.json';

const NUGET_FLATCONTAINER_BASE = 'https://api.nuget.org/v3-flatcontainer';
const FETCH_TIMEOUT_MS = 5000;

async function checkNameAvailability(name: string): Promise<NameCheckResult> {
  const url = `${NUGET_FLATCONTAINER_BASE}/${encodeURIComponent(name.toLowerCase())}/index.json`;

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (response.status === 404) return 'available';
    if (response.status === 200) return 'taken';
    return 'unverified';
  } catch {
    return 'unverified';
  }
}

async function applyPrivateIntent(targetDir: string): Promise<void> {
  const csprojPath = path.join(targetDir, 'src', 'Cli.csproj');
  const content = await readFile(csprojPath, 'utf8');
  const updated = content.replace(
    /(<PropertyGroup>\s*\n)/,
    '$1    <IsPackable>false</IsPackable>\n',
  );
  await writeFile(csprojPath, updated);
}

async function applyRegistryUrl(targetDir: string, registryUrl: string): Promise<void> {
  const config = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<configuration>',
    '  <packageSources>',
    '    <clear />',
    `    <add key="custom" value="${registryUrl}" />`,
    '  </packageSources>',
    '</configuration>',
    '',
  ].join('\n');
  await mkdir(targetDir, { recursive: true });
  await writeFile(path.join(targetDir, 'NuGet.config'), config);
}

export const nugetRegistryChecker: RegistryChecker = {
  checkNameAvailability,
  applyPrivateIntent,
  applyRegistryUrl,
};
```

Note: `checkNameAvailability`'s second parameter (`registryUrl`) from the `RegistryChecker` interface is intentionally unused here — NuGet's flatcontainer name-check endpoint is always `api.nuget.org`, independent of which feed the project will actually publish to (mirrors how the interface is still satisfied structurally; TypeScript won't complain about an unused parameter name in an object literal method unless you name it, so omit the parameter entirely as shown).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/languages/registry-checkers/nuget.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Full verification and commit**

Run: `npx tsc --noEmit && npx eslint src scripts && npx vitest run`
Expected: all pass.

```bash
git add src/languages/registry-checkers/nuget.ts src/languages/registry-checkers/nuget.test.ts
git commit -m "feat: add NuGet RegistryChecker"
```

---

### Task 3: .NET template — solution scaffolding, CLI infrastructure, logging

Creates the `templates/dotnet/` directory with the solution/project files, command auto-discovery, error handling, and Serilog logging — everything `Program.cs` needs, with zero example commands yet (so it builds and runs `--help` on an empty command tree — a legitimate, independently verifiable milestone).

**Files:**
- Create: `templates/dotnet/Cli.slnx`
- Create: `templates/dotnet/src/Cli.csproj`
- Create: `templates/dotnet/src/Program.cs`
- Create: `templates/dotnet/src/ICliCommand.cs`
- Create: `templates/dotnet/src/CommandPathAttribute.cs`
- Create: `templates/dotnet/src/CommandDiscovery.cs`
- Create: `templates/dotnet/src/CliUserException.cs`
- Create: `templates/dotnet/src/Logging/CliLoggerFactory.cs`
- Create: `templates/dotnet/src/Logging/SensitivePropertyEnricher.cs`
- Create: `templates/dotnet/gitignore`

**Interfaces:**
- Produces: `Cli.ICliCommand` (interface, `Command Build()`), `Cli.CommandPathAttribute` (`[CommandPath("task list")]`), `Cli.CommandDiscovery.RegisterAll(RootCommand, Assembly)`, `Cli.CliUserException`, `Cli.Logging.CliLoggerFactory.Create(string commandName, string appName) -> (Logger Logger, string LogFilePath)`.

- [ ] **Step 1: Create the template directory and solution file**

```bash
mkdir -p templates/dotnet/src/Commands templates/dotnet/src/Logging templates/dotnet/tests
```

Create `templates/dotnet/Cli.slnx`:

```xml
<Solution>
  <Folder Name="/src/">
    <Project Path="src/Cli.csproj" />
  </Folder>
  <Folder Name="/tests/">
    <Project Path="tests/Cli.Tests.csproj" />
  </Folder>
</Solution>
```

- [ ] **Step 2: Create the main project file**

Create `templates/dotnet/src/Cli.csproj`:

```xml
<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net10.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
    <RootNamespace>Cli</RootNamespace>
    <AssemblyName>{{projectName}}</AssemblyName>
    <Version>0.0.0</Version>
    <PackAsTool>true</PackAsTool>
    <ToolCommandName>{{projectName}}</ToolCommandName>
    <PackageId>{{projectName}}</PackageId>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="System.CommandLine" Version="2.0.10" />
    <PackageReference Include="Serilog" Version="4.4.0" />
    <PackageReference Include="Serilog.Sinks.File" Version="7.0.0" />
    <PackageReference Include="Serilog.Sinks.Console" Version="6.1.1" />
    <PackageReference Include="Xdg.Directories" Version="0.1.2" />
  </ItemGroup>

</Project>
```

Note: `ToolCommandName`/`PackageId` use the raw `{{projectName}}` (PascalCase, e.g. `MyTool`) — unlike Node's lowercased bin name, .NET tool command names conventionally match the PascalCase project name directly; clispark's wizard validates .NET project names as PascalCase (Task 7), so no separate lowercasing step is needed here.

- [ ] **Step 3: Create the command infrastructure files**

Create `templates/dotnet/src/ICliCommand.cs`:

```csharp
using System.CommandLine;

namespace Cli;

public interface ICliCommand
{
    Command Build();
}
```

Create `templates/dotnet/src/CommandPathAttribute.cs`:

```csharp
namespace Cli;

/// <summary>
/// Declares the full, space-separated invocation path for an <see cref="ICliCommand"/>
/// (e.g. "task list" for a "list" subcommand nested under "task"). The class name alone
/// cannot express nesting, so this is required on every discovered command.
/// </summary>
[AttributeUsage(AttributeTargets.Class)]
public sealed class CommandPathAttribute(string path) : Attribute
{
    public string Path { get; } = path;
}
```

Create `templates/dotnet/src/CommandDiscovery.cs`:

```csharp
using System.CommandLine;
using System.Reflection;

namespace Cli;

public static class CommandDiscovery
{
    /// <summary>
    /// Scans the given assembly for every ICliCommand, reads its CommandPathAttribute,
    /// and attaches it to the tree rooted at <paramref name="root"/> — creating bare
    /// container commands for any missing intermediate path segments.
    /// </summary>
    public static void RegisterAll(RootCommand root, Assembly assembly)
    {
        var commandTypes = assembly
            .GetTypes()
            .Where(t => t is { IsClass: true, IsAbstract: false } && typeof(ICliCommand).IsAssignableFrom(t));

        foreach (var type in commandTypes)
        {
            var attribute = type.GetCustomAttribute<CommandPathAttribute>()
                ?? throw new InvalidOperationException($"{type.FullName} implements ICliCommand but has no [CommandPath].");

            var instance = (ICliCommand)Activator.CreateInstance(type)!;
            var command = instance.Build();

            var segments = attribute.Path.Split(' ', StringSplitOptions.RemoveEmptyEntries);
            var parent = FindOrCreateParent(root, segments[..^1]);
            parent.Subcommands.Add(command);
        }
    }

    private static Command FindOrCreateParent(RootCommand root, string[] parentSegments)
    {
        Command current = root;
        foreach (var segment in parentSegments)
        {
            var existing = current.Subcommands.FirstOrDefault(c => c.Name == segment);
            if (existing is null)
            {
                existing = new Command(segment);
                current.Subcommands.Add(existing);
            }
            current = existing;
        }
        return current;
    }
}
```

Create `templates/dotnet/src/CliUserException.cs`:

```csharp
namespace Cli;

/// <summary>An expected, user-fixable failure — distinct from an unexpected crash. Mirrors clispark's own UserError.</summary>
public sealed class CliUserException(string message) : Exception(message);
```

- [ ] **Step 4: Create the logging files**

Create `templates/dotnet/src/Logging/SensitivePropertyEnricher.cs`:

```csharp
using Serilog.Core;
using Serilog.Events;

namespace Cli.Logging;

/// <summary>Masks known sensitive property names before they reach any sink. Mirrors the Node template's SENSITIVE_LOG_KEYS/pino redact.</summary>
public sealed class SensitivePropertyEnricher(IReadOnlyCollection<string> sensitiveKeys) : ILogEventEnricher
{
    public void Enrich(LogEvent logEvent, ILogEventPropertyFactory propertyFactory)
    {
        foreach (var actualKey in logEvent.Properties.Keys.ToList())
        {
            if (sensitiveKeys.Any(k => string.Equals(k, actualKey, StringComparison.OrdinalIgnoreCase)))
            {
                logEvent.AddOrUpdateProperty(propertyFactory.CreateProperty(actualKey, "***REDACTED***"));
            }
        }
    }
}
```

**Redaction is matched case-insensitively on purpose:** Serilog derives a log event's property names directly from `{PlaceholderName}` tokens in the message template, which are conventionally PascalCase (`{RegistryUrl}`) — not the lowercase/camelCase key spelling this list uses (`registryUrl`). A case-sensitive match here silently fails to redact anything; this was caught empirically while prototyping this exact file (a first case-sensitive version logged a raw secret URL to the log file untouched).

Create `templates/dotnet/src/Logging/CliLoggerFactory.cs`:

```csharp
using Serilog;
using Serilog.Core;
using Xdg.Directories;

namespace Cli.Logging;

public static class CliLoggerFactory
{
    private static readonly string[] SensitiveKeys = ["password", "secret", "token", "apiKey", "registryUrl"];
    private const int RetentionDays = 14;
    private const string SweepMarkerFile = ".last-sweep";
    private static readonly TimeSpan SweepThrottle = TimeSpan.FromHours(24);

    public static (Logger Logger, string LogFilePath) Create(string commandName, string appName)
    {
        var logDir = Path.Combine(BaseDirectory.StateHome, appName, "Log");
        Directory.CreateDirectory(logDir);
        SweepOldLogs(logDir);

        var timestamp = DateTime.UtcNow.ToString("yyyy-MM-ddTHH-mm-ss-fffZ");
        var suffix = Guid.NewGuid().ToString("N")[..6];
        var logFilePath = Path.Combine(logDir, $"{commandName}-{timestamp}-{suffix}.log");

        var config = new LoggerConfiguration()
            .Enrich.With(new SensitivePropertyEnricher(SensitiveKeys))
            .WriteTo.File(logFilePath);

        if (Environment.GetEnvironmentVariable("DEBUG") is not null)
        {
            config = config.WriteTo.Console();
        }

        var logger = config.CreateLogger();

        if (!OperatingSystem.IsWindows())
        {
            File.SetUnixFileMode(logFilePath, UnixFileMode.UserRead | UnixFileMode.UserWrite);
        }

        return (logger, logFilePath);
    }

    private static void SweepOldLogs(string logDir)
    {
        try
        {
            var markerPath = Path.Combine(logDir, SweepMarkerFile);
            if (File.Exists(markerPath) && DateTime.UtcNow - File.GetLastWriteTimeUtc(markerPath) < SweepThrottle)
            {
                return;
            }

            var cutoff = DateTime.UtcNow.AddDays(-RetentionDays);
            foreach (var file in Directory.GetFiles(logDir))
            {
                if (Path.GetFileName(file) == SweepMarkerFile) continue;
                if (File.GetLastWriteTimeUtc(file) < cutoff)
                {
                    File.Delete(file);
                }
            }

            File.WriteAllText(markerPath, string.Empty);
        }
        catch
        {
            // best-effort; a sweep failure must never affect the surrounding command
        }
    }
}
```

`BaseDirectory.StateHome` (from `Xdg.Directories`) is the .NET equivalent of the Node template's `env-paths` — it resolves to `$XDG_STATE_HOME` (or `~/.local/state`) on Linux and the platform-appropriate default elsewhere (verified empirically: resolves to `%LOCALAPPDATA%` on Windows).

- [ ] **Step 5: Create `Program.cs`**

Create `templates/dotnet/src/Program.cs`:

```csharp
using System.CommandLine;
using System.Reflection;
using Cli;
using Cli.Logging;
using Serilog;

var commandName = args.Length > 0 ? args[0] : "cli";
var (logger, logFilePath) = CliLoggerFactory.Create(commandName, "{{projectName}}");
Log.Logger = logger;

var root = new RootCommand("Interactive scaffolded CLI project");
CommandDiscovery.RegisterAll(root, Assembly.GetExecutingAssembly());

var config = new InvocationConfiguration { EnableDefaultExceptionHandler = false };

try
{
    var exitCode = root.Parse(args).Invoke(config);
    if (Environment.GetEnvironmentVariable("DEBUG") is not null)
    {
        Console.WriteLine($"Details: {logFilePath}");
    }
    return exitCode;
}
catch (CliUserException ex)
{
    Log.Error(ex, "Command failed");
    Console.Error.WriteLine($"\nError: {ex.Message}");
    Console.Error.WriteLine($"Details: {logFilePath}");
    return 1;
}
finally
{
    Log.CloseAndFlush();
}
```

- [ ] **Step 6: Create `.gitignore` (as `gitignore`, renamed by `scaffold.ts` at scaffold time)**

Create `templates/dotnet/gitignore`:

```
bin/
obj/
*.user
.vs/
```

- [ ] **Step 7: Build to verify the infrastructure compiles and runs with zero commands**

```bash
cd templates/dotnet
# Temporarily substitute {{projectName}} to build directly (a real scaffold does this automatically):
sed -i 's/{{projectName}}/TestCli/g' src/Cli.csproj src/Program.cs
dotnet build Cli.slnx
```

Expected: `Der Buildvorgang wurde erfolgreich ausgeführt.` / `Build succeeded.`, 0 errors. (`tests/` doesn't exist yet — `dotnet build Cli.slnx` will fail to find `tests/Cli.Tests.csproj`; for this step only, build the single project instead: `dotnet build src/Cli.csproj`.)

Run: `dotnet run --project src -- --help`
Expected: help output listing no subcommands (empty command tree), no errors — proves discovery runs cleanly with zero `ICliCommand` implementations.

- [ ] **Step 8: Revert the temporary substitution**

```bash
git checkout -- templates/dotnet/src/Cli.csproj templates/dotnet/src/Program.cs
git status --short templates/dotnet
```

Expected: clean — confirms the `sed` substitution above didn't accidentally get committed. (Alternative if `git checkout` restores nothing because these are new untracked files: manually re-open both files and confirm they still read `{{projectName}}`, not `TestCli`.)

- [ ] **Step 9: Commit**

```bash
git add templates/dotnet
git commit -m "feat: add .NET template infrastructure (command discovery, error handling, logging)"
```

---

### Task 4: .NET template — example commands and their tests

Adds the four example commands covering the same argument-type catalog as the Node template's `hello.ts`/`task.ts`/`task/list.ts`/`task/complete.ts`, plus xUnit tests for the `CliUserException` path.

**Files:**
- Create: `templates/dotnet/src/Commands/HelloCommand.cs`
- Create: `templates/dotnet/src/Commands/TaskCommand.cs`
- Create: `templates/dotnet/src/Commands/TaskListCommand.cs`
- Create: `templates/dotnet/src/Commands/TaskCompleteCommand.cs`
- Create: `templates/dotnet/tests/Cli.Tests.csproj`
- Create: `templates/dotnet/tests/HelloCommandTests.cs`
- Create: `templates/dotnet/tests/TaskCompleteCommandTests.cs`

**Interfaces:**
- Consumes: `ICliCommand`, `CommandPathAttribute`, `CliUserException` (Task 3).

- [ ] **Step 1: Create the example commands**

Create `templates/dotnet/src/Commands/HelloCommand.cs` (required string argument):

```csharp
using System.CommandLine;
using Serilog;

namespace Cli.Commands;

/// <summary>Required string argument.</summary>
[CommandPath("hello")]
public sealed class HelloCommand : ICliCommand
{
    public Command Build()
    {
        var nameArgument = new Argument<string>("name")
        {
            Description = "Who to greet",
        };

        var command = new Command("hello", "Says hello to someone");
        command.Arguments.Add(nameArgument);
        command.SetAction(parseResult =>
        {
            var name = parseResult.GetValue(nameArgument);
            Log.Information("Greeting {Name}", name);
            Console.WriteLine($"Hello, {name}!");
        });

        return command;
    }
}
```

Create `templates/dotnet/src/Commands/TaskCommand.cs` (optional argument constrained to allowed values):

```csharp
using System.CommandLine;

namespace Cli.Commands;

/// <summary>Optional argument constrained to a fixed set of allowed values.</summary>
[CommandPath("task")]
public sealed class TaskCommand : ICliCommand
{
    public Command Build()
    {
        var statusArgument = new Argument<string?>("status")
        {
            Description = "Filter by status",
            Arity = ArgumentArity.ZeroOrOne,
        };
        statusArgument.AcceptOnlyFromAmong("open", "done");

        var command = new Command("task", "Shows tasks, optionally filtered by status");
        command.Arguments.Add(statusArgument);
        command.SetAction(parseResult =>
        {
            var status = parseResult.GetValue(statusArgument);
            Console.WriteLine(status is null ? "Showing all tasks" : $"Showing {status} tasks");
        });

        return command;
    }
}
```

Create `templates/dotnet/src/Commands/TaskListCommand.cs` (nested subcommand, two optional arguments: string + boolean):

```csharp
using System.CommandLine;

namespace Cli.Commands;

/// <summary>Nested subcommand ("task list") with two optional arguments: string + boolean.</summary>
[CommandPath("task list")]
public sealed class TaskListCommand : ICliCommand
{
    public Command Build()
    {
        var labelArgument = new Argument<string?>("label")
        {
            Description = "Filter by label",
            Arity = ArgumentArity.ZeroOrOne,
        };
        var allArgument = new Argument<bool?>("all")
        {
            Description = "Include completed tasks",
            Arity = ArgumentArity.ZeroOrOne,
        };

        var command = new Command("list", "Lists tasks");
        command.Arguments.Add(labelArgument);
        command.Arguments.Add(allArgument);
        command.SetAction(parseResult =>
        {
            var label = parseResult.GetValue(labelArgument);
            var all = parseResult.GetValue(allArgument) ?? false;
            Console.WriteLine($"Listing tasks (label={label ?? "any"}, all={all})");
        });

        return command;
    }
}
```

Create `templates/dotnet/src/Commands/TaskCompleteCommand.cs` (required integer argument; demonstrates `CliUserException`):

```csharp
using System.CommandLine;

namespace Cli.Commands;

/// <summary>Nested subcommand ("task complete") with a required integer argument. Demonstrates CliUserException.</summary>
[CommandPath("task complete")]
public sealed class TaskCompleteCommand : ICliCommand
{
    public Command Build()
    {
        var idArgument = new Argument<int>("id")
        {
            Description = "Task ID to complete",
        };

        var command = new Command("complete", "Marks a task as complete");
        command.Arguments.Add(idArgument);
        command.SetAction(parseResult =>
        {
            var id = parseResult.GetValue(idArgument);
            if (id <= 0)
            {
                throw new CliUserException($"Task {id} does not exist.");
            }
            Console.WriteLine($"Completed task {id}");
        });

        return command;
    }
}
```

Note on nesting: unlike the Node template (where a subcommand's folder location under `src/commands/` *is* its invocation path), this .NET template expresses nesting purely through `[CommandPath("task list")]`, not through the `Commands/` folder structure — `CommandDiscovery` is reflection-based, not filesystem-based, so there is no requirement to mirror command paths in folders. This is documented in `ARCHITECTURE.md` (Task 5) so it doesn't read as an inconsistency.

- [ ] **Step 2: Create the test project**

Create `templates/dotnet/tests/Cli.Tests.csproj`:

```xml
<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
    <IsPackable>false</IsPackable>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="coverlet.collector" Version="6.0.4" />
    <PackageReference Include="Microsoft.NET.Test.Sdk" Version="17.14.1" />
    <PackageReference Include="xunit" Version="2.9.3" />
    <PackageReference Include="xunit.runner.visualstudio" Version="3.1.4" />
  </ItemGroup>

  <ItemGroup>
    <Using Include="Xunit" />
  </ItemGroup>

  <ItemGroup>
    <ProjectReference Include="..\src\Cli.csproj" />
  </ItemGroup>

</Project>
```

- [ ] **Step 3: Write the failing tests**

Create `templates/dotnet/tests/TaskCompleteCommandTests.cs`:

```csharp
using System.CommandLine;
using Cli;
using Cli.Commands;

namespace Cli.Tests;

public class TaskCompleteCommandTests
{
    // Mirrors Program.cs: the default InvocationConfiguration silently swallows
    // exceptions thrown from a command's action, so tests exercising that
    // behavior must disable it the same way production wiring does.
    private static readonly InvocationConfiguration NonSwallowingConfig = new() { EnableDefaultExceptionHandler = false };

    [Fact]
    public void ThrowsCliUserExceptionForNonPositiveId()
    {
        var command = new TaskCompleteCommand().Build();
        var parseResult = command.Parse(["-1"]);

        var ex = Assert.Throws<CliUserException>(() => parseResult.Invoke(NonSwallowingConfig));
        Assert.Equal("Task -1 does not exist.", ex.Message);
    }

    [Fact]
    public void SucceedsForPositiveId()
    {
        var command = new TaskCompleteCommand().Build();
        var parseResult = command.Parse(["5"]);

        var exitCode = parseResult.Invoke(NonSwallowingConfig);

        Assert.Equal(0, exitCode);
    }
}
```

Create `templates/dotnet/tests/HelloCommandTests.cs`:

```csharp
using Cli.Commands;

namespace Cli.Tests;

public class HelloCommandTests
{
    [Fact]
    public void SucceedsWithARequiredNameArgument()
    {
        var command = new HelloCommand().Build();
        var parseResult = command.Parse(["World"]);

        var exitCode = parseResult.Invoke();

        Assert.Equal(0, exitCode);
    }

    [Fact]
    public void FailsWhenNameArgumentIsMissing()
    {
        var command = new HelloCommand().Build();
        var parseResult = command.Parse([]);

        var exitCode = parseResult.Invoke();

        Assert.NotEqual(0, exitCode);
    }
}
```

- [ ] **Step 4: Run tests to verify `TaskCompleteCommandTests` fails first (TDD check), then build the rest**

```bash
cd templates/dotnet
sed -i 's/{{projectName}}/TestCli/g' src/Cli.csproj src/Program.cs
dotnet test Cli.slnx
```

Expected: PASS — all 4 tests green (`ThrowsCliUserExceptionForNonPositiveId`, `SucceedsForPositiveId`, `SucceedsWithARequiredNameArgument`, `FailsWhenNameArgumentIsMissing`). If `ThrowsCliUserExceptionForNonPositiveId` fails with "No exception was thrown" instead, `NonSwallowingConfig` was not passed to `Invoke()` — re-check Step 3.

- [ ] **Step 5: Manually verify each example command's real CLI behavior**

```bash
dotnet run --project src -- hello World
dotnet run --project src -- task open
dotnet run --project src -- task bogus
dotnet run --project src -- task list urgent true
dotnet run --project src -- task complete 5
dotnet run --project src -- task complete -1
```

Expected, in order:
1. `Hello, World!`
2. `Showing open tasks`
3. Non-zero exit, message listing `open`/`done` as the only accepted values (System.CommandLine's own validation error, not `CliUserException`)
4. `Listing tasks (label=urgent, all=True)`
5. `Completed task 5`
6. Non-zero exit, clean `Error: Task -1 does not exist.` (no stack trace) followed by a `Details: <path>` line

- [ ] **Step 6: Revert the temporary substitution**

```bash
git checkout -- templates/dotnet/src/Cli.csproj templates/dotnet/src/Program.cs
```

- [ ] **Step 7: Commit**

```bash
git add templates/dotnet/src/Commands templates/dotnet/tests
git commit -m "feat: add .NET template example commands and tests"
```

---

### Task 5: .NET template — docs, packaging verification

Adds `README.md`/`ARCHITECTURE.md` (mirroring `templates/node/`'s structure and tone) and verifies the whole template packs and installs as a real global tool.

**Files:**
- Create: `templates/dotnet/README.md`
- Create: `templates/dotnet/ARCHITECTURE.md`

- [ ] **Step 1: Create `ARCHITECTURE.md`**

Create `templates/dotnet/ARCHITECTURE.md`:

```markdown
# {{projectName}} Architecture

This document explains the conventions this project was generated with, so the automatic behavior (command discovery, logging, error handling) doesn't feel like unexplained magic.

## Commands

Every command lives in `src/Commands/` and implements `ICliCommand` (`src/ICliCommand.cs`):

```csharp
using System.CommandLine;

namespace Cli.Commands;

[CommandPath("my-command")]
public sealed class MyCommand : ICliCommand
{
    public Command Build()
    {
        var command = new Command("my-command", "What this command does");
        command.SetAction(parseResult => Console.WriteLine("done"));
        return command;
    }
}
```

`[CommandPath("...")]` declares the full, space-separated invocation path — for a nested subcommand this is `"task list"`, not just `"list"`. This is what expresses nesting, **not** the folder a file lives in under `src/Commands/` (unlike the Node template, where a subcommand's folder location *is* its path) — `CommandDiscovery` finds commands via reflection over the whole assembly, not by scanning the filesystem, so there's no requirement to mirror command paths in folders.

## Argument Types

Every entry in a command's argument list is a `System.CommandLine.Argument<T>`. `TaskCommand`/`TaskListCommand`/`TaskCompleteCommand` use a few of these:

- **`Argument<string>`** — plain text, required by default.
  ```csharp
  var nameArgument = new Argument<string>("name");
  ```
- **`Argument<int>`** — parses digits into a real `int`, rejects non-numeric input.
  ```csharp
  var idArgument = new Argument<int>("id");
  // `task complete abc` → "Cannot parse argument 'abc' for command 'complete' as expected type 'System.Int32'."
  ```
- **`Argument<bool?>`** with `Arity = ArgumentArity.ZeroOrOne` — optional boolean.
  ```csharp
  var allArgument = new Argument<bool?>("all") { Arity = ArgumentArity.ZeroOrOne };
  ```
- **`.AcceptOnlyFromAmong(...)`** — restricts a string argument to a fixed list of values.
  ```csharp
  statusArgument.AcceptOnlyFromAmong("open", "done");
  // `task bogus` → "Das Argument 'bogus' wurde nicht erkannt. Folgendes ist erforderlich: 'open' / 'done'"
  ```
- **`Arity = ArgumentArity.ZeroOrOne`** on any `Argument<T?>` — makes an otherwise-required argument optional; omit it for a required argument.

See `TaskCommand.cs` (string + allowed-values), `TaskCompleteCommand.cs` (integer), and `TaskListCommand.cs` (string + boolean, nested subcommand) for these in a real, runnable command.

## Command Discovery

`Program.cs` calls `CommandDiscovery.RegisterAll(root, Assembly.GetExecutingAssembly())` at startup, which reflects over the assembly for every `ICliCommand` implementation, reads its `[CommandPath]`, and attaches it to the command tree — creating bare container commands automatically for any missing intermediate path segments (e.g. a bare `task` node is created automatically if only `"task list"` were declared and no class declared `"task"` itself). Dropping a new file in `src/Commands/` and rebuilding is enough; nothing needs to be manually registered.

## Error Handling

There's no base-class inheritance model here (unlike the Node template's `BaseCommand`) — `System.CommandLine` doesn't have an equivalent lifecycle to hook into. Instead, `Program.cs` wraps the whole invocation in a single `try`/`catch`: a thrown `CliUserException` (`src/CliUserException.cs`) produces a clean `Error: <message>` with no stack trace and exit code 1; anything else is not caught here and surfaces with a full stack trace (still logged in full either way — see Logging below).

**Important `System.CommandLine` detail:** `ParseResult.Invoke()` has a default exception handler that silently swallows exceptions from a command's action and prints its own message — `Program.cs` disables it explicitly (`new InvocationConfiguration { EnableDefaultExceptionHandler = false }`) so `CliUserException` actually reaches the `catch` block. If you write a test that calls `.Invoke()` directly on a command's `Build()` output to assert on a thrown exception, you need the same `InvocationConfiguration` — see `TaskCompleteCommandTests.cs`.

## Logging

`src/Logging/CliLoggerFactory.cs` writes structured logs via Serilog, one file per command invocation, to an OS-appropriate log directory (via `Xdg.Directories`, respecting `$XDG_STATE_HOME` on Linux) — never to the project's own working directory. `Program.cs` assigns the created logger to Serilog's static `Log.Logger`, so any command can log via `Serilog.Log.Information(...)` etc. without an injected instance. On failure, the full exception (including stack trace) is always logged to the file, while the terminal only ever shows a clean `Error: <message>`; the terminal also prints `Details: <path to the log file>` so the full error is one file away.

A few things run automatically around every log call:

- **Retention:** before opening a new log file, a sweep deletes files older than 14 days — throttled to run at most once per 24 hours via a `.last-sweep` marker file in the log directory, so a busy CLI doesn't re-scan the log directory on every single invocation.
- **Redaction:** `SensitivePropertyEnricher` masks known secret-shaped property names (`password`, `secret`, `token`, `apiKey`, `registryUrl`) case-insensitively before they reach any sink — edit `SensitiveKeys` in `CliLoggerFactory.cs` directly if your commands log other sensitive fields.
- **`DEBUG=1`:** streams every log line to stdout live in addition to the file, and prints `Details: <path>` on success too, not just on failure — useful while developing a new command.
- **File permissions:** the log file itself is created with `UnixFileMode.UserRead | UnixFileMode.UserWrite` (owner read/write only) on non-Windows platforms; this is a documented no-op on Windows, which has no POSIX permission bits — same principle as the Node template's `mode: 0o600`.

## Testing

Tests use `xunit` and live in `tests/Cli.Tests.csproj` (a separate project referencing `src/Cli.csproj`, not colocated with the commands they test — the conventional .NET layout, unlike vitest's colocated `*.test.ts` files). A test exercises a command directly via `new SomeCommand().Build()` then `.Parse(args).Invoke(...)` — no process spawning needed. Remember the `EnableDefaultExceptionHandler = false` detail from "Error Handling" above when asserting on thrown exceptions.
```

- [ ] **Step 2: Create `README.md`**

Create `templates/dotnet/README.md`:

```markdown
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

## Logging & debugging

Every command run writes a structured log file (one per invocation, in an OS-appropriate log directory — see `ARCHITECTURE.md`'s "Logging" section). By default the terminal only shows a clean `Error: <message>` on failure, or nothing on success.

- **`DEBUG=1`** — streams the raw log lines to stdout live as the command runs, and prints `Details: <path>` to the log file on both success and failure (normally that line only appears on failure).
- Fields that look like secrets (`password`, `token`, `apiKey`, etc. — see `SensitiveKeys` in `src/Logging/CliLoggerFactory.cs`) are redacted from log output automatically; edit that list directly in your own copy if you log other sensitive fields.
```

- [ ] **Step 3: Full packaging verification**

```bash
cd templates/dotnet
sed -i 's/{{projectName}}/TestCli/g' src/Cli.csproj src/Program.cs README.md ARCHITECTURE.md
dotnet pack src -c Release -o ./nupkg
dotnet tool uninstall -g TestCli 2>/dev/null || true
dotnet tool install -g TestCli --add-source ./nupkg --version 0.0.0
TestCli hello "Global Tool"
TestCli task complete -1
echo "exit: $?"
dotnet tool uninstall -g TestCli
rm -rf src/nupkg
```

Expected: pack succeeds; global install succeeds; `TestCli hello "Global Tool"` prints `Hello, Global Tool!`; `TestCli task complete -1` prints a clean `Error: Task -1 does not exist.` and exits 1.

- [ ] **Step 4: Revert the temporary substitution**

```bash
git checkout -- templates/dotnet/src/Cli.csproj templates/dotnet/src/Program.cs templates/dotnet/README.md templates/dotnet/ARCHITECTURE.md
git status --short templates/dotnet
```

Expected: clean (only Steps 1-2's new `README.md`/`ARCHITECTURE.md` content, still containing `{{projectName}}`, staged/untracked as appropriate — not `TestCli`).

- [ ] **Step 5: Commit**

```bash
git add templates/dotnet/README.md templates/dotnet/ARCHITECTURE.md
git commit -m "docs: add README/ARCHITECTURE for the .NET template"
```

---

### Task 6: NuGet `UpdateAdapter`

New `src/update/adapters/dotnet.ts` implementing `UpdateAdapter` (from M11 Tier 3 / `src/update/adapter.ts`, unchanged) via targeted regex extraction/mutation of `src/Cli.csproj`'s raw text — no XML/DOM library.

**Files:**
- Create: `src/update/adapters/dotnet.ts`
- Test: `src/update/adapters/dotnet.test.ts`

**Interfaces:**
- Consumes: `UpdateAdapter`, `CoreFieldsExtraction`, `ManifestFileMergeResult` (`src/update/adapter.ts`); `Manifest` (`src/update/manifest.ts`); `reconcileEntry`, `stringEquals` (`src/update/reconcile.ts`).
- Produces: `dotnetAdapter: UpdateAdapter`, `DotnetManifestFile` (exported type — the adapter's internal representation, `{ raw: string, version: string, targetFramework: string, packageId: string, toolCommandName: string, packageReferences: Record<string, string> }`).

- [ ] **Step 1: Write the failing tests**

Create `src/update/adapters/dotnet.test.ts`:

```ts
// src/update/adapters/dotnet.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { dotnetAdapter, type DotnetManifestFile } from './dotnet';
import type { Manifest } from '../manifest';

const SAMPLE_CSPROJ = `<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net10.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
    <RootNamespace>Cli</RootNamespace>
    <AssemblyName>MyTool</AssemblyName>
    <Version>0.1.0</Version>
    <PackAsTool>true</PackAsTool>
    <ToolCommandName>MyTool</ToolCommandName>
    <PackageId>MyTool</PackageId>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="System.CommandLine" Version="2.0.10" />
    <PackageReference Include="Serilog" Version="4.4.0" />
  </ItemGroup>

</Project>
`;

function baseManifest(overrides: Partial<Manifest> = {}): Manifest {
  return {
    generatorVersion: '1.0.0',
    language: 'dotnet',
    coreFiles: {},
    coreDependencies: {},
    coreScripts: {},
    coreFields: { TargetFramework: 'net10.0' },
    ...overrides,
  };
}

describe('dotnetAdapter.parseManifestFile', () => {
  it('extracts version, targetFramework, packageId, toolCommandName, and packageReferences', () => {
    const parsed = dotnetAdapter.parseManifestFile(SAMPLE_CSPROJ) as DotnetManifestFile;
    expect(parsed.version).toBe('0.1.0');
    expect(parsed.targetFramework).toBe('net10.0');
    expect(parsed.packageId).toBe('MyTool');
    expect(parsed.toolCommandName).toBe('MyTool');
    expect(parsed.packageReferences).toEqual({ 'System.CommandLine': '2.0.10', Serilog: '4.4.0' });
  });
});

describe('dotnetAdapter.readProjectName', () => {
  it('reads the PackageId as the project name', () => {
    const parsed = dotnetAdapter.parseManifestFile(SAMPLE_CSPROJ);
    expect(dotnetAdapter.readProjectName(parsed)).toBe('MyTool');
  });
});

describe('dotnetAdapter.extractCoreFields', () => {
  it('puts every PackageReference into coreDependencies', () => {
    const parsed = dotnetAdapter.parseManifestFile(SAMPLE_CSPROJ);
    const result = dotnetAdapter.extractCoreFields(parsed);
    expect(result.coreDependencies).toEqual({ 'System.CommandLine': '2.0.10', Serilog: '4.4.0' });
  });

  it('has no coreScripts (.NET has no script-map equivalent)', () => {
    const parsed = dotnetAdapter.parseManifestFile(SAMPLE_CSPROJ);
    const result = dotnetAdapter.extractCoreFields(parsed);
    expect(result.coreScripts).toEqual({});
  });

  it('puts only TargetFramework into coreFields, not PackageId/ToolCommandName', () => {
    const parsed = dotnetAdapter.parseManifestFile(SAMPLE_CSPROJ);
    const result = dotnetAdapter.extractCoreFields(parsed);
    expect(result.coreFields).toEqual({ TargetFramework: 'net10.0' });
  });
});

describe('dotnetAdapter.mergeManifestFile', () => {
  it('replaces a dependency version that matches the old manifest (untouched by the user)', () => {
    const current = dotnetAdapter.parseManifestFile(SAMPLE_CSPROJ);
    const newTemplate = dotnetAdapter.parseManifestFile(
      SAMPLE_CSPROJ.replace('Version="2.0.10"', 'Version="2.1.0"'),
    );
    const oldManifest = baseManifest({
      coreDependencies: { 'System.CommandLine': '2.0.10', Serilog: '4.4.0' },
    });

    const result = dotnetAdapter.mergeManifestFile(current, oldManifest, newTemplate);

    expect(result.changed).toBe(true);
    expect(result.dependencies).toContainEqual({ key: 'System.CommandLine', outcome: 'replaced' });
    expect((result.updatedFile as DotnetManifestFile).raw).toContain('<PackageReference Include="System.CommandLine" Version="2.1.0" />');
  });

  it('skips a dependency version the user changed locally', () => {
    const current = dotnetAdapter.parseManifestFile(SAMPLE_CSPROJ.replace('Version="2.0.10"', 'Version="9.9.9"'));
    const newTemplate = dotnetAdapter.parseManifestFile(
      SAMPLE_CSPROJ.replace('Version="2.0.10"', 'Version="2.1.0"'),
    );
    const oldManifest = baseManifest({
      coreDependencies: { 'System.CommandLine': '2.0.10', Serilog: '4.4.0' },
    });

    const result = dotnetAdapter.mergeManifestFile(current, oldManifest, newTemplate);

    expect(result.dependencies).toContainEqual({ key: 'System.CommandLine', outcome: 'skipped' });
    expect((result.updatedFile as DotnetManifestFile).raw).toContain('Version="9.9.9"');
  });

  it('adds a brand-new dependency the current file does not have yet', () => {
    const current = dotnetAdapter.parseManifestFile(SAMPLE_CSPROJ);
    const newTemplate = dotnetAdapter.parseManifestFile(
      SAMPLE_CSPROJ.replace(
        '</ItemGroup>',
        '    <PackageReference Include="Xdg.Directories" Version="0.1.2" />\n  </ItemGroup>',
      ),
    );
    const oldManifest = baseManifest({
      coreDependencies: { 'System.CommandLine': '2.0.10', Serilog: '4.4.0' },
    });

    const result = dotnetAdapter.mergeManifestFile(current, oldManifest, newTemplate);

    expect(result.dependencies).toContainEqual({ key: 'Xdg.Directories', outcome: 'added' });
    expect((result.updatedFile as DotnetManifestFile).raw).toContain('Xdg.Directories');
  });

  it('replaces TargetFramework when unchanged from the old manifest', () => {
    const current = dotnetAdapter.parseManifestFile(SAMPLE_CSPROJ);
    const newTemplate = dotnetAdapter.parseManifestFile(SAMPLE_CSPROJ.replace('net10.0', 'net11.0'));
    const oldManifest = baseManifest({ coreFields: { TargetFramework: 'net10.0' } });

    const result = dotnetAdapter.mergeManifestFile(current, oldManifest, newTemplate);

    expect(result.fields).toContainEqual({ key: 'TargetFramework', outcome: 'replaced' });
    expect((result.updatedFile as DotnetManifestFile).raw).toContain('<TargetFramework>net11.0</TargetFramework>');
  });

  it('leaves everything else in the file byte-identical', () => {
    const current = dotnetAdapter.parseManifestFile(SAMPLE_CSPROJ);
    const newTemplate = dotnetAdapter.parseManifestFile(
      SAMPLE_CSPROJ.replace('Version="2.0.10"', 'Version="2.1.0"'),
    );
    const oldManifest = baseManifest({
      coreDependencies: { 'System.CommandLine': '2.0.10', Serilog: '4.4.0' },
    });

    const result = dotnetAdapter.mergeManifestFile(current, oldManifest, newTemplate);
    const updatedRaw = (result.updatedFile as DotnetManifestFile).raw;

    expect(updatedRaw).toContain('<AssemblyName>MyTool</AssemblyName>');
    expect(updatedRaw).toContain('<RootNamespace>Cli</RootNamespace>');
    expect(updatedRaw).toContain('<PackAsTool>true</PackAsTool>');
  });
});

describe('dotnetAdapter.readManifestFile / writeManifestFile', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(path.join(tmpdir(), 'clispark-dotnet-adapter-test-'));
    await mkdir(path.join(tmpRoot, 'src'), { recursive: true });
    await writeFile(path.join(tmpRoot, 'src', 'Cli.csproj'), SAMPLE_CSPROJ);
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it('reads src/Cli.csproj and parses it', async () => {
    const manifestFile = (await dotnetAdapter.readManifestFile(tmpRoot)) as DotnetManifestFile;
    expect(manifestFile.version).toBe('0.1.0');
  });

  it('writes the raw content back to src/Cli.csproj', async () => {
    const manifestFile = (await dotnetAdapter.readManifestFile(tmpRoot)) as DotnetManifestFile;
    const modified: DotnetManifestFile = { ...manifestFile, raw: manifestFile.raw.replace('0.1.0', '0.2.0') };

    await dotnetAdapter.writeManifestFile(tmpRoot, modified);

    const written = await readFile(path.join(tmpRoot, 'src', 'Cli.csproj'), 'utf8');
    expect(written).toContain('<Version>0.2.0</Version>');
  });
});

describe('dotnetAdapter.coreFilePaths / templateSourcePath', () => {
  it('lists the .NET infrastructure files as core files', () => {
    expect(dotnetAdapter.coreFilePaths).toContain('src/Program.cs');
    expect(dotnetAdapter.coreFilePaths).toContain('src/CommandDiscovery.cs');
    expect(dotnetAdapter.coreFilePaths).toContain('Cli.slnx');
    expect(dotnetAdapter.coreFilePaths).not.toContain('src/Commands/HelloCommand.cs');
  });

  it('maps .gitignore to the un-dotted "gitignore" template file', () => {
    expect(dotnetAdapter.templateSourcePath('.gitignore')).toBe('gitignore');
  });

  it('leaves every other path unchanged', () => {
    expect(dotnetAdapter.templateSourcePath('src/Program.cs')).toBe('src/Program.cs');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/update/adapters/dotnet.test.ts`
Expected: FAIL — `Cannot find module './dotnet'`

- [ ] **Step 3: Implement the NuGet UpdateAdapter**

Create `src/update/adapters/dotnet.ts`:

```ts
// src/update/adapters/dotnet.ts
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Manifest } from '../manifest';
import type { CoreFieldsExtraction, ManifestFileMergeResult, UpdateAdapter } from '../adapter';
import { reconcileEntry, stringEquals, type FieldOutcome } from '../reconcile';

export const CORE_FILE_PATHS = [
  'Cli.slnx',
  'src/Program.cs',
  'src/ICliCommand.cs',
  'src/CommandPathAttribute.cs',
  'src/CommandDiscovery.cs',
  'src/CliUserException.cs',
  'src/Logging/CliLoggerFactory.cs',
  'src/Logging/SensitivePropertyEnricher.cs',
  'tests/Cli.Tests.csproj',
  'ARCHITECTURE.md',
  '.gitignore',
] as const;

export interface DotnetManifestFile {
  raw: string;
  version: string;
  targetFramework: string;
  packageId: string;
  toolCommandName: string;
  packageReferences: Record<string, string>;
}

function extractTag(content: string, tag: string): string {
  const match = content.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
  if (!match) throw new Error(`.csproj is missing a <${tag}> tag`);
  return match[1];
}

function extractPackageReferences(content: string): Record<string, string> {
  const refs: Record<string, string> = {};
  const re = /<PackageReference\s+Include="([^"]+)"\s+Version="([^"]+)"\s*\/>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    refs[m[1]] = m[2];
  }
  return refs;
}

function setTag(content: string, tag: string, value: string): string {
  return content.replace(new RegExp(`(<${tag}>)[^<]*(</${tag}>)`), `$1${value}$2`);
}

function setPackageReferenceVersion(content: string, name: string, version: string): string {
  const re = new RegExp(`(<PackageReference\\s+Include="${name}"\\s+Version=")[^"]+(")`);
  return content.replace(re, `$1${version}$2`);
}

function addPackageReference(content: string, name: string, version: string): string {
  // Reuses the indentation of the last existing <PackageReference> line
  // immediately preceding </ItemGroup>, so the new line matches siblings exactly.
  const re = /^([ \t]*)<PackageReference[^\n]*\/>\n(?=[ \t]*<\/ItemGroup>)/m;
  return content.replace(re, (match, indent: string) => `${match}${indent}<PackageReference Include="${name}" Version="${version}" />\n`);
}

function parseManifestFile(rawContent: string): DotnetManifestFile {
  return {
    raw: rawContent,
    version: extractTag(rawContent, 'Version'),
    targetFramework: extractTag(rawContent, 'TargetFramework'),
    packageId: extractTag(rawContent, 'PackageId'),
    toolCommandName: extractTag(rawContent, 'ToolCommandName'),
    packageReferences: extractPackageReferences(rawContent),
  };
}

function extractCoreFields(manifestFile: DotnetManifestFile): CoreFieldsExtraction {
  return {
    coreDependencies: manifestFile.packageReferences,
    coreScripts: {},
    coreFields: { TargetFramework: manifestFile.targetFramework },
  };
}

function mergeManifestFile(
  current: DotnetManifestFile,
  oldManifest: Manifest,
  newTemplate: DotnetManifestFile,
): ManifestFileMergeResult {
  let raw = current.raw;
  let changed = false;

  const dependencies: FieldOutcome[] = [];
  const coreDependencies: Record<string, string> = {};

  for (const name of Object.keys(newTemplate.packageReferences)) {
    const newValue = newTemplate.packageReferences[name];
    const currentValue = current.packageReferences[name];
    const oldValue = oldManifest.coreDependencies[name];

    const result = reconcileEntry(currentValue, oldValue, newValue, stringEquals);
    dependencies.push({ key: name, outcome: result.outcome });
    coreDependencies[name] = result.value;

    if (result.outcome === 'added') {
      changed = true;
      raw = addPackageReference(raw, name, result.value);
    } else if (result.outcome !== 'skipped' && result.value !== currentValue) {
      changed = true;
      raw = setPackageReferenceVersion(raw, name, result.value);
    }
  }

  const oldCoreFields = oldManifest.coreFields as { TargetFramework?: string };
  const fields: FieldOutcome[] = [];
  let targetFrameworkValue = oldCoreFields.TargetFramework ?? current.targetFramework;

  const targetFrameworkResult = reconcileEntry(
    current.targetFramework,
    oldCoreFields.TargetFramework,
    newTemplate.targetFramework,
    stringEquals,
  );
  fields.push({ key: 'TargetFramework', outcome: targetFrameworkResult.outcome });
  targetFrameworkValue = targetFrameworkResult.value;
  if (targetFrameworkResult.outcome !== 'skipped' && targetFrameworkResult.value !== current.targetFramework) {
    changed = true;
    raw = setTag(raw, 'TargetFramework', targetFrameworkResult.value);
  }

  return {
    updatedFile: { ...current, raw },
    changed,
    dependencies,
    scripts: [],
    fields,
    coreDependencies,
    coreScripts: {},
    coreFields: { TargetFramework: targetFrameworkValue },
  };
}

export const dotnetAdapter: UpdateAdapter = {
  coreFilePaths: CORE_FILE_PATHS,

  templateSourcePath(relativePath) {
    return relativePath === '.gitignore' ? 'gitignore' : relativePath;
  },

  manifestFileName: 'src/Cli.csproj',

  async readManifestFile(dir) {
    const content = await readFile(path.join(dir, 'src', 'Cli.csproj'), 'utf8');
    return parseManifestFile(content);
  },

  async writeManifestFile(dir, content) {
    await writeFile(path.join(dir, 'src', 'Cli.csproj'), (content as DotnetManifestFile).raw);
  },

  parseManifestFile,

  readProjectName(manifestFile) {
    return (manifestFile as DotnetManifestFile).packageId;
  },

  extractCoreFields(manifestFile) {
    return extractCoreFields(manifestFile as DotnetManifestFile);
  },

  mergeManifestFile(current, oldManifest, newTemplate) {
    return mergeManifestFile(current as DotnetManifestFile, oldManifest, newTemplate as DotnetManifestFile);
  },
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/update/adapters/dotnet.test.ts`
Expected: PASS (14 tests)

- [ ] **Step 5: Full verification and commit**

Run: `npx tsc --noEmit && npx eslint src scripts && npx vitest run`
Expected: all pass.

```bash
git add src/update/adapters/dotnet.ts src/update/adapters/dotnet.test.ts
git commit -m "feat: add NuGet UpdateAdapter (regex-based .csproj editing)"
```

---

### Task 7: `dotnetPack: LanguagePack` and registration

Assembles everything from Tasks 1-6 into a `LanguagePack` and registers it — after this task, `clispark`'s wizard shows ".NET" as a selectable language with zero changes to `wizard.ts`/`scaffold.ts`/`cli.ts` themselves.

**Files:**
- Create: `src/languages/packs/dotnet.ts`
- Create: `src/languages/packs/dotnet.test.ts`
- Modify: `src/languages/index.ts`

**Interfaces:**
- Consumes: `LanguagePack` (`src/languages/pack.ts`), `dotnetAdapter` (Task 6), `nugetRegistryChecker`/`NUGET_DEFAULT_REGISTRY_URL` (Task 2).
- Produces: `dotnetPack: LanguagePack` (`id: 'dotnet'`).

- [ ] **Step 1: Write the failing tests**

Create `src/languages/packs/dotnet.test.ts`:

```ts
// src/languages/packs/dotnet.test.ts
import { describe, it, expect } from 'vitest';
import { dotnetPack } from './dotnet';

describe('dotnetPack.validateProjectName', () => {
  it('accepts a PascalCase name', () => {
    expect(dotnetPack.validateProjectName('MyTool')).toBeUndefined();
  });

  it('accepts a single-word PascalCase name', () => {
    expect(dotnetPack.validateProjectName('Tool')).toBeUndefined();
  });

  it('rejects a lowercase name', () => {
    expect(dotnetPack.validateProjectName('mytool')).toBeDefined();
  });

  it('rejects a name with a hyphen', () => {
    expect(dotnetPack.validateProjectName('my-tool')).toBeDefined();
  });

  it('rejects an empty name', () => {
    expect(dotnetPack.validateProjectName('')).toBeDefined();
  });

  it('rejects a name starting with a digit', () => {
    expect(dotnetPack.validateProjectName('1Tool')).toBeDefined();
  });
});

describe('dotnetPack.scaffoldCommands', () => {
  it('runs dotnet restore then dotnet build', () => {
    expect(dotnetPack.scaffoldCommands).toEqual([
      { command: 'dotnet', args: ['restore'] },
      { command: 'dotnet', args: ['build'] },
    ]);
  });
});

describe('dotnetPack basic shape', () => {
  it('has id "dotnet" and a display name', () => {
    expect(dotnetPack.id).toBe('dotnet');
    expect(dotnetPack.displayName).toContain('.NET');
  });

  it('points templateDir at templates/dotnet', () => {
    expect(dotnetPack.templateDir).toContain('templates');
    expect(dotnetPack.templateDir).toContain('dotnet');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/languages/packs/dotnet.test.ts`
Expected: FAIL — `Cannot find module './dotnet'`

- [ ] **Step 3: Implement the pack**

Create `src/languages/packs/dotnet.ts`:

```ts
// src/languages/packs/dotnet.ts
import path from 'node:path';
import { findPackageRoot } from '../../package-root';
import type { LanguagePack } from '../pack';
import { dotnetAdapter } from '../../update/adapters/dotnet';
import { nugetRegistryChecker, NUGET_DEFAULT_REGISTRY_URL } from '../registry-checkers/nuget';

function validateProjectName(value: string): string | undefined {
  if (!value || value.trim().length === 0) return 'Project name is required.';
  if (!/^[A-Z][A-Za-z0-9]*$/.test(value)) {
    return 'Use PascalCase, starting with an uppercase letter (e.g. MyTool).';
  }
  return undefined;
}

export const dotnetPack: LanguagePack = {
  id: 'dotnet',
  displayName: '.NET / C# (System.CommandLine)',
  templateDir: path.join(findPackageRoot(), 'templates', 'dotnet'),
  scaffoldCommands: [
    { command: 'dotnet', args: ['restore'] },
    { command: 'dotnet', args: ['build'] },
  ],
  validateProjectName,
  updateAdapter: dotnetAdapter,
  registry: {
    defaultUrl: NUGET_DEFAULT_REGISTRY_URL,
    promptLabel: 'Custom NuGet feed URL (leave empty for nuget.org)',
    checkNameAvailability: nugetRegistryChecker.checkNameAvailability,
    applyPrivateIntent: nugetRegistryChecker.applyPrivateIntent,
    applyRegistryUrl: nugetRegistryChecker.applyRegistryUrl,
  },
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/languages/packs/dotnet.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 5: Register the pack**

Edit `src/languages/index.ts`:

```ts
// src/languages/index.ts
import type { LanguagePack } from './pack';
import { nodeOclifPack } from './packs/node-oclif';
import { dotnetPack } from './packs/dotnet';

export const LANGUAGE_PACKS: Record<string, LanguagePack> = {
  [nodeOclifPack.id]: nodeOclifPack,
  [dotnetPack.id]: dotnetPack,
};

export function getPackById(id: string): LanguagePack | undefined {
  return LANGUAGE_PACKS[id];
}
```

- [ ] **Step 6: Full verification and commit**

Run: `npx tsc --noEmit && npx eslint src scripts && npx vitest run`
Expected: all pass.

```bash
git add src/languages/packs/dotnet.ts src/languages/packs/dotnet.test.ts src/languages/index.ts
git commit -m "feat: register the .NET LanguagePack"
```

---

### Task 8: CI — `.NET` scaffold smoke test

Adds a new `scaffold-smoke-dotnet` job to `.github/workflows/ci.yml`, mirroring the existing Node `scaffold-smoke` job's structure.

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Add the new job**

Edit `.github/workflows/ci.yml` — add after the existing `scaffold-smoke` job (i.e. append as a new top-level job under `jobs:`):

```yaml
  scaffold-smoke-dotnet:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: ./.github/actions/setup
      - uses: actions/setup-dotnet@v6
        with:
          dotnet-version: '10.0.x'
      - name: Configure git identity for scaffolded project commit
        run: |
          git config --global user.email "ci@example.com"
          git config --global user.name "CI"
      - name: Scaffold a real .NET project and verify it builds and tests itself
        run: |
          cat > ci-smoke-verify-dotnet.mjs << 'EOF'
          import { scaffoldProject } from './src/scaffold';
          import { dotnetPack } from './src/languages/packs/dotnet';
          import path from 'node:path';
          import os from 'node:os';

          const targetDir = path.join(os.tmpdir(), 'clispark-ci-smoke-dotnet', 'SmokeTestCli');
          await scaffoldProject({ projectName: 'SmokeTestCli', targetDir }, dotnetPack);
          console.log('scaffold complete:', targetDir);
          EOF
          npx tsx ci-smoke-verify-dotnet.mjs
          rm ci-smoke-verify-dotnet.mjs
      - name: Run the generated project's own test suite
        run: |
          cd "$(node -e "console.log(require('os').tmpdir())")/clispark-ci-smoke-dotnet/SmokeTestCli"
          dotnet test Cli.slnx
      - name: Run the generated project's entry point directly
        run: |
          cd "$(node -e "console.log(require('os').tmpdir())")/clispark-ci-smoke-dotnet/SmokeTestCli"
          output="$(dotnet run --project src -- hello World)"
          echo "$output"
          if [[ "$output" != *"Hello, World!"* ]]; then
            echo "Program.cs did not produce the expected greeting" >&2
            exit 1
          fi
```

- [ ] **Step 2: Verify the YAML is well-formed**

Run: `npx eslint .github/workflows/ci.yml 2>&1 || true` (eslint doesn't lint YAML — this step is just to confirm the repo's lint config doesn't choke on the file existing; the real check is Step 3)

Run: `node -e "require('node:fs').readFileSync('.github/workflows/ci.yml', 'utf8')"` — trivial existence/readability check; real YAML validation happens when GitHub Actions parses it on push (Step 3 below is the actual verification).

- [ ] **Step 3: Commit and push on a branch, verify the new job runs and passes on real GitHub Actions**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add .NET scaffold smoke test"
git push -u origin <branch-name>
```

Then, per this project's established workflow: open a PR, wait for `gh pr checks <N>` to show `scaffold-smoke-dotnet` (alongside `test`/`audit`/`scaffold-smoke`) as `pass`. If it fails, the most likely causes (in order of likelihood, based on this plan's own empirical verification): the `.NET` SDK version resolution differs on the runner vs. locally (re-check `dotnet --list-sdks` in the job log), or a NuGet package restore fails due to a transient network issue (retry).

---

### Task 9: Full manual end-to-end verification

Mirrors the verification depth of M7/M12a's final task: a real scaffold (via `scaffoldProject()` directly, since the interactive wizard can't be automated), a real build/test/pack/global-install/run cycle, and a real `clispark update` cycle against an artificially-downgraded manifest.

**Files:** none (verification only)

- [ ] **Step 1: Build clispark itself**

```bash
npx tsc --noEmit && npx eslint src scripts && npx vitest run && npx tsup
```
Expected: all pass, `dist/cli.js` produced.

- [ ] **Step 2: Scaffold a real .NET project via `scaffoldProject()` directly**

```bash
cat > /tmp/e2e-verify-dotnet.mjs << 'EOF'
import { scaffoldProject } from './src/scaffold.ts';
import { dotnetPack } from './src/languages/packs/dotnet.ts';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const base = path.join(os.tmpdir(), 'clispark-m12b-e2e');
fs.rmSync(base, { recursive: true, force: true });
const targetDir = path.join(base, 'E2eTestCli');
await scaffoldProject({ projectName: 'E2eTestCli', targetDir }, dotnetPack);
console.log('scaffolded at', targetDir);
EOF
npx tsx /tmp/e2e-verify-dotnet.mjs
```

(Adjust the script's own path if `/tmp` isn't writable in the shell being used — write it into the clispark repo root instead, run with `npx tsx`, then delete it, exactly as the existing `ci-smoke-verify.mjs` pattern in `.github/workflows/ci.yml` already does.)

Expected: scaffold completes, prints the target directory, `dotnet restore`/`dotnet build` run as part of `scaffoldCommands` with no errors.

- [ ] **Step 3: Verify the scaffolded project for real**

```bash
cd "$(node -e "console.log(require('os').tmpdir())")/clispark-m12b-e2e/E2eTestCli"
dotnet test Cli.slnx
dotnet run --project src -- hello World
dotnet run --project src -- task list groceries true
dotnet run --project src -- task complete -1
echo "exit: $?"
cat .clispark/manifest.json
```

Expected: tests pass; `hello`/`task list` produce expected output; `task complete -1` produces a clean `Error: Task -1 does not exist.` with exit code 1; the manifest shows `"language": "dotnet"` and a populated `coreFiles`/`coreDependencies`/`coreFields`.

- [ ] **Step 4: Verify global tool packaging for real**

```bash
dotnet pack src -c Release -o ./nupkg
dotnet tool uninstall -g E2eTestCli 2>/dev/null || true
dotnet tool install -g E2eTestCli --add-source ./nupkg --version 0.0.0
E2eTestCli hello "Real Install"
dotnet tool uninstall -g E2eTestCli
```

Expected: pack, install, and run all succeed; prints `Hello, Real Install!`.

- [ ] **Step 5: Verify `clispark update` for real, against a downgraded manifest**

```bash
node -e "
const fs = require('node:fs');
const p = '.clispark/manifest.json';
const m = JSON.parse(fs.readFileSync(p, 'utf8'));
m.generatorVersion = '1.0.0';
fs.writeFileSync(p, JSON.stringify(m, null, 2));
"
git add -A && git commit -m "test: downgrade manifest for update E2E test" -q
node <path-to-clispark-repo>/dist/cli.js update
```

Expected: reports `Updated core from v1.0.0 to v<current>.`, lists updated files/dependencies/fields including `TargetFramework`, and the working tree now has an auto-commit `chore: update clispark core to v<current>`.

- [ ] **Step 6: Verify the update actually changed real file content**

```bash
cat src/Cli.csproj
git log --oneline -3
```

Expected: `<TargetFramework>` and `<PackageReference>` versions in `src/Cli.csproj` match the current template's values; git log shows the auto-commit from Step 5 on top of the earlier scaffold commit.

- [ ] **Step 7: Clean up**

```bash
dotnet tool uninstall -g E2eTestCli 2>/dev/null || true
rm -rf "$(node -e "console.log(require('os').tmpdir())")/clispark-m12b-e2e"
```

- [ ] **Step 8: Update `project-ideas/clispark.plan.md` and the project's memory file**

Mark M12b complete in `project-ideas/clispark.plan.md` with a summary (tasks, PR number, release version once shipped) and a changelog entry, per this project's established convention (every milestone gets this treatment — see the M12a entry for the exact level of detail expected). Update `project_clispark.md` memory similarly.

- [ ] **Step 9: Final commit if Steps 1-6 required any fixes**

If any step above required a code fix (not just verification), commit it now with a clear message describing the real bug found and fixed — per this project's established pattern (every prior milestone's E2E verification step has found and fixed at least one real bug; if this one finds zero, that's a first, worth noting explicitly rather than silently).

---

## Self-Review Notes

- **Spec coverage:** Every section of `docs/superpowers/specs/2026-07-18-clispark-m12-language-packs-design.md` (as amended 2026-07-19) is covered: `LanguagePack`/`RegistryChecker` extension (Task 1-2, 7), .NET template content (Task 3-5), NuGet `UpdateAdapter` (Task 6), CI (Task 8), full E2E (Task 9). The PowerShell sanity-check section is documentation-only, no task needed.
- **Deviations from the spec, found during prototyping and applied here:** (1) dropped `Microsoft.Extensions.DependencyInjection` — a single ambient `Serilog.Log.Logger` covers the one thing that would have needed injecting; (2) `Cli.sln` → `Cli.slnx` — the .NET 10 SDK's default `dotnet new sln` output format changed; (3) `Program.cs`'s log `commandName` derives from `args[0]` rather than being a single fixed string, for closer parity with the Node template's per-command log file naming.
- **Type consistency:** `DotnetManifestFile` (Task 6) is used identically in Task 6's own tests and is the type `dotnetAdapter`'s `UpdateAdapter` methods cast to/from — no drift. `ICliCommand`/`CommandPathAttribute`/`CliUserException` (Task 3) are referenced with identical names/signatures in Tasks 4 and 5's C# code and docs.
