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
