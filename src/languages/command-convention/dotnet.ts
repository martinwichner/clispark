// src/languages/command-convention/dotnet.ts
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function stripCommandConvention(targetDir: string): Promise<void> {
  await rm(path.join(targetDir, 'Cli.Analyzers'), { recursive: true, force: true });

  const csprojPath = path.join(targetDir, 'src', 'Cli.csproj');
  const content = await readFile(csprojPath, 'utf8');
  // \r?\n for the same reason lint-support/dotnet.ts's PropertyGroup strip uses it: real
  // scaffolded .csproj files use CRLF, a bare \n would silently fail to match on Windows.
  const updated = content.replace(
    /\r?\n\s*<ItemGroup>\s*\r?\n\s*<ProjectReference Include="\.\.\\Cli\.Analyzers\\Cli\.Analyzers\.csproj"[^\n]*\r?\n\s*<\/ItemGroup>\r?\n/,
    '\n',
  );
  await writeFile(csprojPath, updated);
}
