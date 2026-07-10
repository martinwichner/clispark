import spawn from 'cross-spawn';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { cp, readdir, readFile, rename, writeFile } from 'node:fs/promises';

export interface ScaffoldOptions {
  projectName: string;
  targetDir: string;
}

const TEMPLATE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'base');

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

async function replacePlaceholder(filePath: string, projectName: string): Promise<void> {
  const content = (await readFile(filePath, 'utf8')).replaceAll('{{projectName}}', projectName);
  await writeFile(filePath, content);
}

export async function copyTemplate(options: ScaffoldOptions): Promise<void> {
  const { projectName, targetDir } = options;

  await assertTargetDirIsUsable(targetDir);
  await cp(TEMPLATE_DIR, targetDir, { recursive: true });

  await rename(path.join(targetDir, 'gitignore'), path.join(targetDir, '.gitignore'));

  await replacePlaceholder(path.join(targetDir, 'package.json'), projectName);
  await replacePlaceholder(path.join(targetDir, 'README.md'), projectName);
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
  await deps.runCommand('git', ['init'], targetDir);
  await deps.runCommand('git', ['add', '-A'], targetDir);
  await deps.runCommand('git', ['commit', '-m', 'chore: initial scaffold from clispark'], targetDir);
  await deps.runCommand('npm', ['install'], targetDir);
  await deps.runCommand('npm', ['run', 'build'], targetDir);
}
