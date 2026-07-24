// src/update/update.ts
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import spawn from 'cross-spawn';
import { applyPlaceholders } from '../scaffold';
import { getGeneratorVersion, hashContent, requireManifest, writeManifest, type Manifest } from './manifest';
import { reconcileEntry, stringEquals, type FieldOutcome } from './reconcile';
import { UserError } from '../errors';
import { compareVersions } from './releasenotes';
import type { UpdateAdapter } from './adapter';

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

export async function updateProject(
  targetDir: string,
  adapter: UpdateAdapter,
  templateDir: string,
  language: string,
  deps: UpdateDeps = defaultUpdateDeps,
): Promise<UpdateResult> {
  const status = (await deps.captureCommand('git', ['status', '--porcelain'], targetDir)).trim();
  if (status.length > 0) {
    throw new UserError('Working tree is not clean. Commit or stash your changes before running update.');
  }

  const oldManifest = await requireManifest(targetDir);
  const toVersion = getGeneratorVersion();
  const fromVersion = oldManifest.generatorVersion;

  if (compareVersions(fromVersion, toVersion) >= 0) {
    return { status: 'up-to-date', fromVersion, toVersion, files: [], dependencies: [], scripts: [], fields: [] };
  }

  const currentManifestFile = await adapter.readManifestFile(targetDir);
  const projectName = adapter.readProjectName(currentManifestFile);

  const newTemplateRaw = applyPlaceholders(
    await readFile(path.join(templateDir, adapter.manifestFileName), 'utf8'),
    projectName,
  );
  const newTemplateManifestFile = adapter.parseManifestFile(newTemplateRaw);

  const files: FileOutcomeEntry[] = [];
  const newCoreFiles: Record<string, string> = {};
  const fileWrites: { targetPath: string; content: string }[] = [];

  // Reads + hashes run in parallel; results are then applied in adapter.coreFilePaths
  // order below so files/fileWrites stay deterministic regardless of I/O timing.
  const perFileResults = await Promise.all(
    adapter.coreFilePaths(oldManifest).map(async (relativePath) => {
      const newContent = applyPlaceholders(
        await readFile(path.join(templateDir, adapter.templateSourcePath(relativePath)), 'utf8'),
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
      return { relativePath, newContent, result };
    }),
  );

  for (const { relativePath, newContent, result } of perFileResults) {
    files.push({ path: relativePath, outcome: result.outcome });
    newCoreFiles[relativePath] = result.value;

    if (result.outcome === 'added' || result.outcome === 'replaced') {
      fileWrites.push({ targetPath: path.join(targetDir, relativePath), content: newContent });
    }
  }

  for (const relativePath of Object.keys(oldManifest.coreFiles)) {
    if (adapter.coreFilePaths(oldManifest).includes(relativePath)) continue;
    try {
      await readFile(path.join(targetDir, relativePath), 'utf8');
      files.push({ path: relativePath, outcome: 'no-longer-core' });
    } catch {
      // already gone locally, nothing to report
    }
  }

  const fileMerge = adapter.mergeManifestFile(currentManifestFile, oldManifest, newTemplateManifestFile);

  const hasFileChanges = files.some(
    (f) => f.outcome === 'added' || f.outcome === 'replaced' || f.outcome === 'no-longer-core',
  );
  const hasChanges = hasFileChanges || fileMerge.changed;

  if (!hasChanges) {
    return {
      status: 'no-changes',
      fromVersion,
      toVersion,
      files,
      dependencies: fileMerge.dependencies,
      scripts: fileMerge.scripts,
      fields: fileMerge.fields,
    };
  }

  for (const write of fileWrites) {
    await mkdir(path.dirname(write.targetPath), { recursive: true });
    await writeFile(write.targetPath, write.content);
  }

  if (fileMerge.changed) {
    await adapter.writeManifestFile(targetDir, fileMerge.updatedFile);
  }

  const newManifest: Manifest = {
    generatorVersion: toVersion,
    language,
    lintEnabled: oldManifest.lintEnabled,
    coreFiles: newCoreFiles,
    coreDependencies: fileMerge.coreDependencies,
    coreScripts: fileMerge.coreScripts,
    coreFields: fileMerge.coreFields,
  };
  await writeManifest(targetDir, newManifest);

  await deps.runCommand('git', ['add', '-A'], targetDir);
  await deps.runCommand('git', ['commit', '-m', `chore: update clispark core to v${toVersion}`], targetDir);

  return {
    status: 'updated',
    fromVersion,
    toVersion,
    files,
    dependencies: fileMerge.dependencies,
    scripts: fileMerge.scripts,
    fields: fileMerge.fields,
  };
}

export function formatUpdateSummary(result: UpdateResult): string {
  if (result.status === 'up-to-date') {
    return `Already up to date (v${result.toVersion}).`;
  }

  const added = result.files.filter((f) => f.outcome === 'added');
  const replaced = result.files.filter((f) => f.outcome === 'replaced');
  const skipped = result.files.filter((f) => f.outcome === 'skipped');
  const noLongerCore = result.files.filter((f) => f.outcome === 'no-longer-core');

  const lines: string[] = [];
  if (result.status === 'no-changes') {
    lines.push(
      noLongerCore.length
        ? `No changes applied: nothing to update since v${result.fromVersion}.`
        : `No changes applied: every core file/field has been modified locally since v${result.fromVersion}.`,
    );
  } else {
    lines.push(`Updated core from v${result.fromVersion} to v${result.toVersion}.`);
  }

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
    lines.push(`  Manifest: ${fieldOutcomes.map((o) => `${o.key} (${o.outcome})`).join(', ')}`);
  }

  if (result.status === 'updated') {
    lines.push('Run "clispark releasenotes" to see what changed.');
  }

  return lines.join('\n');
}
