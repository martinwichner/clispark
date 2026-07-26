// src/demo/full-walkthrough.ts
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { note, log } from '@clack/prompts';
import { scaffoldProject } from '../scaffold';
import { nodeOclifPack } from '../languages/packs/node-oclif';

async function readExcerpt(dir: string, relativePath: string, maxLines = 12): Promise<string> {
  const content = await readFile(path.join(dir, relativePath), 'utf8');
  const lines = content.split('\n');
  const truncated = lines.length > maxLines;
  return lines.slice(0, maxLines).join('\n') + (truncated ? '\n  …' : '');
}

export async function runFullWalkthrough(): Promise<void> {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'clispark-demo-'));

  const sigintHandler = (): void => {
    void rm(tempDir, { recursive: true, force: true }).finally(() => process.exit(130));
  };
  process.once('SIGINT', sigintHandler);

  try {
    note(
      'Scaffolding a real, throwaway Node/oclif project in a temp directory ' +
        '(npm install, npm run build, and git init are skipped here for speed — a real ' +
        '`clispark` run also performs those).',
      'Step 1: scaffold',
    );

    try {
      await scaffoldProject(
        {
          projectName: 'demo-cli',
          targetDir: tempDir,
          lintEnabled: false,
          autocompleteEnabled: false,
        },
        nodeOclifPack,
        { runCommand: async () => {} },
      );
    } catch {
      log.warn('Could not run a live scaffold in this environment — showing a static description instead.');
      note(
        'A real `clispark` run would now have a working project at this point: base-command.ts wires up ' +
          'shared logging/error-handling that every command extends, and src/commands/ holds your first command.',
        'What would happen',
      );
      return;
    }

    const baseCommand = await readExcerpt(tempDir, 'src/base-command.ts');
    note(baseCommand, 'src/base-command.ts — shared logging & error handling, every command extends this');

    const hello = await readExcerpt(tempDir, 'src/commands/hello.ts');
    note(hello, 'src/commands/hello.ts — the minimal starting point');

    const task = await readExcerpt(tempDir, 'src/commands/task.ts');
    note(task, 'src/commands/task.ts — a required arg plus an optional enum-constrained arg');

    const taskList = await readExcerpt(tempDir, 'src/commands/task/list.ts');
    note(taskList, 'src/commands/task/list.ts — an optional arg plus a boolean flag');

    const taskComplete = await readExcerpt(tempDir, 'src/commands/task/complete.ts');
    note(taskComplete, 'src/commands/task/complete.ts — a subcommand with a required integer arg');

    note(
      'Same idea for .NET (attribute-based [CommandPath] discovery instead of a commands/ folder ' +
        'convention, native dotnet-suggest shell completion) and PowerShell (native tab-completion, ' +
        'nothing to configure) — run `clispark` yourself and pick a different language to see the full thing.',
      '.NET / PowerShell',
    );
  } finally {
    process.removeListener('SIGINT', sigintHandler);
    await rm(tempDir, { recursive: true, force: true });
  }
}
