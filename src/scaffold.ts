// src/scaffold.ts
import { cp, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import spawn from 'cross-spawn';
import type { LanguagePack } from './languages/pack';
import { buildManifest, getGeneratorVersion, writeManifest } from './update/manifest';
import { UserError } from './errors';

export interface ScaffoldOptions {
  projectName: string;
  targetDir: string;
  registryUrl?: string;
  publishIntent?: boolean;
  lintEnabled?: boolean;
  autocompleteEnabled?: boolean;
  commandConventionEnabled?: boolean;
}

async function assertTargetDirIsUsable(targetDir: string): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(targetDir);
  } catch {
    return;
  }
  if (entries.length > 0) {
    throw new UserError(`Directory "${targetDir}" already exists and is not empty.`);
  }
}

export function applyPlaceholders(content: string, projectName: string): string {
  return content.replaceAll('{{projectName}}', projectName);
}

async function collectFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const fullPath = path.join(dir, entry.name);
      return entry.isDirectory() ? collectFiles(fullPath) : Promise.resolve([fullPath]);
    }),
  );
  return files.flat();
}

// Scans every copied file rather than a hardcoded list, so a new template file
// that needs {{projectName}} substituted can't silently be forgotten here.
async function replacePlaceholdersInTree(targetDir: string, projectName: string): Promise<void> {
  const files = await collectFiles(targetDir);
  await Promise.all(
    files.map(async (filePath) => {
      const content = await readFile(filePath, 'utf8');
      if (content.includes('{{projectName}}')) {
        await writeFile(filePath, applyPlaceholders(content, projectName));
      }
    }),
  );
}

export async function copyTemplate(options: ScaffoldOptions, pack: LanguagePack): Promise<void> {
  const { projectName, targetDir, registryUrl, publishIntent } = options;

  await assertTargetDirIsUsable(targetDir);
  await cp(pack.templateDir, targetDir, { recursive: true });

  await rename(path.join(targetDir, 'gitignore'), path.join(targetDir, '.gitignore'));

  await replacePlaceholdersInTree(targetDir, projectName);

  if (publishIntent === false) {
    await pack.registry.applyPrivateIntent(targetDir);
  }

  if (registryUrl && registryUrl !== pack.registry.defaultUrl) {
    await pack.registry.applyRegistryUrl(targetDir, registryUrl);
  }
}

export interface ScaffoldDeps {
  runCommand: (command: string, args: string[], cwd: string) => Promise<void>;
}

async function defaultRunCommand(command: string, args: string[], cwd: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Command "${command} ${args.join(' ')}" exited with code ${code}`));
      }
    });
  });
}

const defaultScaffoldDeps: ScaffoldDeps = { runCommand: defaultRunCommand };

export async function scaffoldProject(
  options: ScaffoldOptions,
  pack: LanguagePack,
  deps: ScaffoldDeps = defaultScaffoldDeps,
): Promise<void> {
  await copyTemplate(options, pack);

  const { targetDir } = options;
  const lintEnabled = options.lintEnabled ?? false;
  if (!lintEnabled) {
    await pack.stripLintTooling(targetDir);
  }
  const autocompleteEnabled = options.autocompleteEnabled ?? false;
  if (!autocompleteEnabled) {
    await pack.stripAutocompleteSupport(targetDir);
  }
  const commandConventionEnabled = options.commandConventionEnabled ?? false;
  if (!commandConventionEnabled) {
    await pack.stripCommandConvention(targetDir);
  }
  const manifest = await buildManifest(
    targetDir,
    getGeneratorVersion(),
    pack.id,
    pack.updateAdapter,
    lintEnabled,
    autocompleteEnabled,
    commandConventionEnabled,
  );
  await writeManifest(targetDir, manifest);

  await deps.runCommand('git', ['init'], targetDir);
  await deps.runCommand('git', ['add', '-A'], targetDir);
  await deps.runCommand('git', ['commit', '-m', 'chore: initial scaffold from clispark'], targetDir);

  for (const scaffoldCommand of pack.scaffoldCommands) {
    await deps.runCommand(scaffoldCommand.command, scaffoldCommand.args, targetDir);
  }
}
