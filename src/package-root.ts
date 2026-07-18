import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Finds clispark's own package root by walking up from this module's
 * location. A fixed relative path can't work here: this module's depth
 * below the package root differs between running from source (tests) and
 * running as part of the bundled `dist/cli.js` (tsup flattens everything
 * into one file, so `import.meta.url` no longer reflects the original
 * per-module nesting) — but the walk-up strategy is depth-independent
 * either way, since it doesn't matter where exactly the walk starts.
 */
export function findPackageRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  while (true) {
    const pkgPath = path.join(dir, 'package.json');
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { name?: string };
      if (pkg.name === 'clispark') return dir;
    }
    const parentDir = path.dirname(dir);
    if (parentDir === dir) {
      throw new Error("Could not locate clispark's own package.json.");
    }
    dir = parentDir;
  }
}
