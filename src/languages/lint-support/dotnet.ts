// src/languages/lint-support/dotnet.ts
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function stripLintTooling(targetDir: string): Promise<void> {
  const csprojPath = path.join(targetDir, 'src', 'Cli.csproj');
  const content = await readFile(csprojPath, 'utf8');
  // \r?\n rather than a bare \n: the real template file (and any project scaffolded on
  // Windows) uses CRLF line endings -- a bare \n here would silently fail to match and
  // leave the analyzer PropertyGroup in place for every declined Windows project.
  const updated = content.replace(
    /\r?\n\s*<PropertyGroup>\s*\r?\n\s*<EnableNETAnalyzers>[\s\S]*?<\/PropertyGroup>\r?\n/,
    '\n',
  );
  await writeFile(csprojPath, updated);
}
