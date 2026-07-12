import spawn from 'cross-spawn';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { cp, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { DEFAULT_REGISTRY_URL } from './registry.js';
import { buildManifest, getGeneratorVersion, writeManifest } from './update/manifest.js';

export interface ScaffoldOptions {
  projectName: string;
  targetDir: string;
  registryUrl?: string;
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
    throw new Error(`Directory "${targetDir}" already exists and is not empty.`);
  }
}

export function applyPlaceholders(content: string, projectName: string): string {
  return content.replaceAll('{{projectName}}', projectName);
}

async function replacePlaceholder(filePath: string, projectName: string): Promise<void> {
  const content = applyPlaceholders(await readFile(filePath, 'utf8'), projectName);
  await writeFile(filePath, content);
}

export async function copyTemplate(options: ScaffoldOptions): Promise<void> {
  const { projectName, targetDir, registryUrl } = options;

  await assertTargetDirIsUsable(targetDir);
  await cp(TEMPLATE_DIR, targetDir, { recursive: true });

  await rename(path.join(targetDir, 'gitignore'), path.join(targetDir, '.gitignore'));

  await replacePlaceholder(path.join(targetDir, 'package.json'), projectName);
  await replacePlaceholder(path.join(targetDir, 'README.md'), projectName);
  await replacePlaceholder(path.join(targetDir, 'src', 'logger.ts'), projectName);
  await replacePlaceholder(path.join(targetDir, 'ARCHITECTURE.md'), projectName);

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
