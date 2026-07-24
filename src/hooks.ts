// src/hooks.ts
import { existsSync } from 'node:fs';
import path from 'node:path';
import envPaths from 'env-paths';
import type { PostScaffoldHookContext } from './index';

export function getPostScaffoldHookPath(
  configDir: string = envPaths('clispark', { suffix: '' }).config,
): string {
  return path.join(configDir, 'hooks', 'post-scaffold.mjs');
}

export interface HooksDeps {
  fileExists: (p: string) => boolean;
  importHookModule: (fileUrl: string) => Promise<{ default?: unknown }>;
  warn: (message: string) => void;
}

const defaultDeps: HooksDeps = {
  fileExists: existsSync,
  importHookModule: (fileUrl) => import(fileUrl),
  warn: (message) => console.warn(message),
};

function warnHookFailed(deps: HooksDeps, detail: string): void {
  deps.warn(
    `⚠ Post-scaffold hook failed: ${detail}\n  Your project was still created successfully — this only affects the optional hook.`,
  );
}

export async function runPostScaffoldHook(
  context: PostScaffoldHookContext,
  hookPath: string = getPostScaffoldHookPath(),
  deps: HooksDeps = defaultDeps,
): Promise<void> {
  if (!deps.fileExists(hookPath)) {
    return;
  }

  try {
    // Construct file URL consistently across platforms by normalizing separators
    const normalizedPath = hookPath.split(path.sep).join('/');
    const fileUrl = normalizedPath.startsWith('/')
      ? 'file://' + normalizedPath
      : 'file:///' + normalizedPath;
    const mod = await deps.importHookModule(fileUrl);
    if (typeof mod.default !== 'function') {
      throw new Error('post-scaffold.mjs must have a default export that is a function');
    }
    await (mod.default as (ctx: PostScaffoldHookContext) => unknown)(context);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    warnHookFailed(deps, detail);
  }
}
