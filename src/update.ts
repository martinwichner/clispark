// src/update.ts
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import spawn from 'cross-spawn';
import { applyPlaceholders, TEMPLATE_DIR } from './scaffold.js';
import {
  CORE_FILE_PATHS,
  getGeneratorVersion,
  hashContent,
  requireManifest,
  templateSourcePath,
  writeManifest,
  type Manifest,
} from './manifest.js';
import { reconcileEntry, stringEquals } from './reconcile.js';
import { mergePackageJson, type FieldOutcome, type PackageJsonShape } from './update-package-json.js';

export interface UpdateDeps {
  runCommand: (command: string, args: string[], cwd: string) => Promise<void>;
  captureCommand: (command: string, args: string[], cwd: string) => Promise<string>;
}

async function defaultRunCommand(command: string, args: string[], cwd: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command "${command} ${args.join(' ')}" exited with code ${code}`));
    });
  });
}

async function defaultCaptureCommand(command: string, args: string[], cwd: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, { cwd });
    let stdout = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`Command "${command} ${args.join(' ')}" exited with code ${code}`));
    });
  });
}

const defaultUpdateDeps: UpdateDeps = { runCommand: defaultRunCommand, captureCommand: defaultCaptureCommand };

export interface FileOutcomeEntry {
  path: string;
  outcome: 'added' | 'replaced' | 'skipped' | 'no-longer-core';
}

export interface UpdateResult {
  status: 'up-to-date' | 'no-changes' | 'updated';
  fromVersion: string;
  toVersion: string;
  files: FileOutcomeEntry[];
  dependencies: FieldOutcome[];
  scripts: FieldOutcome[];
  fields: FieldOutcome[];
}

export async function updateProject(targetDir: string, deps: UpdateDeps = defaultUpdateDeps): Promise<UpdateResult> {
  const status = (await deps.captureCommand('git', ['status', '--porcelain'], targetDir)).trim();
  if (status.length > 0) {
    throw new Error('Working tree is not clean. Commit or stash your changes before running update.');
  }

  const oldManifest = await requireManifest(targetDir);
  const toVersion = getGeneratorVersion();
  const fromVersion = oldManifest.generatorVersion;

  if (fromVersion === toVersion) {
    return { status: 'up-to-date', fromVersion, toVersion, files: [], dependencies: [], scripts: [], fields: [] };
  }

  const currentPkg = JSON.parse(await readFile(path.join(targetDir, 'package.json'), 'utf8')) as PackageJsonShape;
  const projectName = currentPkg.name;

  const newTemplatePkg = JSON.parse(
    applyPlaceholders(await readFile(path.join(TEMPLATE_DIR, 'package.json'), 'utf8'), projectName),
  ) as PackageJsonShape;

  const files: FileOutcomeEntry[] = [];
  const newCoreFiles: Record<string, string> = {};
  const fileWrites: { targetPath: string; content: string }[] = [];

  for (const relativePath of CORE_FILE_PATHS) {
    const newContent = applyPlaceholders(
      await readFile(path.join(TEMPLATE_DIR, templateSourcePath(relativePath)), 'utf8'),
      projectName,
    );
    const newHash = hashContent(newContent);

    let currentHash: string | undefined;
    try {
      currentHash = hashContent(await readFile(path.join(targetDir, relativePath), 'utf8'));
    } catch {
      currentHash = undefined;
    }

    const result = reconcileEntry(currentHash, oldManifest.coreFiles[relativePath], newHash, stringEquals);
    files.push({ path: relativePath, outcome: result.outcome });
    newCoreFiles[relativePath] = result.value;

    if (result.outcome === 'added' || result.outcome === 'replaced') {
      fileWrites.push({ targetPath: path.join(targetDir, relativePath), content: newContent });
    }
  }

  for (const relativePath of Object.keys(oldManifest.coreFiles)) {
    if ((CORE_FILE_PATHS as readonly string[]).includes(relativePath)) continue;
    try {
      await readFile(path.join(targetDir, relativePath), 'utf8');
      files.push({ path: relativePath, outcome: 'no-longer-core' });
    } catch {
      // already gone locally, nothing to report
    }
  }

  const pkgMerge = mergePackageJson(currentPkg, oldManifest, newTemplatePkg);

  const hasFileChanges = files.some((f) => f.outcome === 'added' || f.outcome === 'replaced');
  const hasChanges = hasFileChanges || pkgMerge.changed;

  if (!hasChanges) {
    return {
      status: 'no-changes',
      fromVersion,
      toVersion,
      files,
      dependencies: pkgMerge.dependencies,
      scripts: pkgMerge.scripts,
      fields: pkgMerge.fields,
    };
  }

  for (const write of fileWrites) {
    await mkdir(path.dirname(write.targetPath), { recursive: true });
    await writeFile(write.targetPath, write.content);
  }

  if (pkgMerge.changed) {
    await writeFile(path.join(targetDir, 'package.json'), JSON.stringify(pkgMerge.updatedPkg, null, 2) + '\n');
  }

  const newManifest: Manifest = {
    generatorVersion: toVersion,
    coreFiles: newCoreFiles,
    coreDependencies: pkgMerge.coreDependencies,
    coreScripts: pkgMerge.coreScripts,
    coreFields: pkgMerge.coreFields,
  };
  await writeManifest(targetDir, newManifest);

  await deps.runCommand('git', ['add', '-A'], targetDir);
  await deps.runCommand('git', ['commit', '-m', `chore: update clispark core to v${toVersion}`], targetDir);

  return {
    status: 'updated',
    fromVersion,
    toVersion,
    files,
    dependencies: pkgMerge.dependencies,
    scripts: pkgMerge.scripts,
    fields: pkgMerge.fields,
  };
}

export function formatUpdateSummary(result: UpdateResult): string {
  if (result.status === 'up-to-date') {
    return `Already up to date (v${result.toVersion}).`;
  }

  const lines: string[] = [];
  if (result.status === 'no-changes') {
    lines.push(`No changes applied: every core file/field has been modified locally since v${result.fromVersion}.`);
  } else {
    lines.push(`Updated core from v${result.fromVersion} to v${result.toVersion}.`);
  }

  const added = result.files.filter((f) => f.outcome === 'added');
  const replaced = result.files.filter((f) => f.outcome === 'replaced');
  const skipped = result.files.filter((f) => f.outcome === 'skipped');
  const noLongerCore = result.files.filter((f) => f.outcome === 'no-longer-core');

  if (added.length) lines.push(`  New: ${added.map((f) => f.path).join(', ')}`);
  if (replaced.length) lines.push(`  Updated: ${replaced.map((f) => f.path).join(', ')}`);
  if (skipped.length) lines.push(`  Skipped (locally modified): ${skipped.map((f) => f.path).join(', ')}`);
  if (noLongerCore.length) {
    lines.push(
      `  No longer part of the core, safe to remove manually: ${noLongerCore.map((f) => f.path).join(', ')}`,
    );
  }

  const fieldOutcomes = [...result.dependencies, ...result.scripts, ...result.fields].filter(
    (o) => o.outcome !== 'skipped',
  );
  if (fieldOutcomes.length) {
    lines.push(`  package.json: ${fieldOutcomes.map((o) => `${o.key} (${o.outcome})`).join(', ')}`);
  }

  if (result.status === 'updated') {
    lines.push('Run "clispark releasenotes" to see what changed.');
  }

  return lines.join('\n');
}
