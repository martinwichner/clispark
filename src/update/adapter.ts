// src/update/adapter.ts
import type { Manifest } from './manifest';
import type { FieldOutcome } from './reconcile';

export interface CoreFieldsExtraction {
  coreDependencies: Record<string, string>;
  coreScripts: Record<string, string>;
  coreFields: Record<string, unknown>;
}

export interface ManifestFileMergeResult extends CoreFieldsExtraction {
  updatedFile: unknown;
  changed: boolean;
  dependencies: FieldOutcome[];
  scripts: FieldOutcome[];
  fields: FieldOutcome[];
}

/**
 * Isolates everything template/language-specific from the generic update
 * engine (manifest.ts, update.ts): which files are generator-managed, and
 * how the package manifest is read, written, and three-way-merged. One
 * concrete implementation exists today (adapters/node-oclif.ts); a future
 * non-Node template would add a sibling adapter without touching the
 * generic engine.
 */
export interface UpdateAdapter {
  readonly coreFilePaths: readonly string[];
  templateSourcePath(relativePath: string): string;

  readonly manifestFileName: string;
  readManifestFile(dir: string): Promise<unknown>;
  writeManifestFile(dir: string, content: unknown): Promise<void>;
  parseManifestFile(rawContent: string): unknown;
  readProjectName(manifestFile: unknown): string;
  extractCoreFields(manifestFile: unknown): CoreFieldsExtraction;
  mergeManifestFile(current: unknown, oldManifest: Manifest, newTemplate: unknown): ManifestFileMergeResult;
}
