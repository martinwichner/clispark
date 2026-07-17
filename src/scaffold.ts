import spawn from 'cross-spawn';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { cp, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { DEFAULT_REGISTRY_URL } from './registry';
import { buildManifest, getGeneratorVersion, writeManifest } from './update/manifest';
import { UserError } from './errors';

export interface ScaffoldOptions {
  projectName: string;
  targetDir: string;
  registryUrl?: string;
  publishIntent?: boolean;
}

export const TEMPLATE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'base');

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

async function markPackageJsonPrivate(targetDir: string): Promise<void> {
  const packageJsonPath = path.join(targetDir, 'package.json');
  const pkg = JSON.parse(await readFile(packageJsonPath, 'utf8')) as Record<string, unknown>;
  pkg.private = true;
  await writeFile(packageJsonPath, JSON.stringify(pkg, null, 2) + '\n');
}

export async function copyTemplate(options: ScaffoldOptions): Promise<void> {
  const { projectName, targetDir, registryUrl, publishIntent } = options;

  await assertTargetDirIsUsable(targetDir);
  await cp(TEMPLATE_DIR, targetDir, { recursive: true });

  await rename(path.join(targetDir, 'gitignore'), path.join(targetDir, '.gitignore'));

  await replacePlaceholdersInTree(targetDir, projectName);

  if (publishIntent === false) {
    await markPackageJsonPrivate(targetDir);
  }

  if (registryUrl && registryUrl !== DEFAULT_REGISTRY_URL) {
    await writeFile(path.join(targetDir, '.npmrc'), `registry=${registryUrl}\n`);
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
  deps: ScaffoldDeps = defaultScaffoldDeps,
): Promise<void> {
  await copyTemplate(options);

  const { targetDir } = options;
  const manifest = await buildManifest(targetDir, getGeneratorVersion());
  await writeManifest(targetDir, manifest);

  await deps.runCommand('git', ['init'], targetDir);
  await deps.runCommand('git', ['add', '-A'], targetDir);
  await deps.runCommand('git', ['commit', '-m', 'chore: initial scaffold from clispark'], targetDir);
  await deps.runCommand('npm', ['install'], targetDir);
  await deps.runCommand('npm', ['run', 'build'], targetDir);
}
