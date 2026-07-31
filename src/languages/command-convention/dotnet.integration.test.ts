import { describe, it, expect } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dotnetPack } from '../packs/dotnet';
import { scaffoldProject } from '../../scaffold';

const execFileAsync = promisify(execFile);

describe('CommandPathAnalyzer (real dotnet build)', () => {
  it(
    'fails the build when a command implements ICliCommand without [CommandPath], then succeeds once fixed',
    async () => {
      const targetDir = await mkdtemp(path.join(tmpdir(), 'clispark-analyzer-integration-'));
      try {
        await scaffoldProject(
          { projectName: 'AnalyzerCheck', targetDir, lintEnabled: true, commandConventionEnabled: true },
          dotnetPack,
          { runCommand: async () => {} }, // skip git/restore/build during scaffold itself
        );

        const commandsDir = path.join(targetDir, 'src', 'Commands');
        const brokenCommandPath = path.join(commandsDir, 'BrokenCommand.cs');
        await writeFile(
          brokenCommandPath,
          [
            'namespace Cli.Commands;',
            '',
            'public class BrokenCommand : ICliCommand',
            '{',
            '    public System.CommandLine.Command Build() => new("broken");',
            '}',
            '',
          ].join('\n'),
        );

        await execFileAsync('dotnet', ['restore'], { cwd: targetDir });

        // Failing case: BrokenCommand implements ICliCommand but has no [CommandPath].
        // execFile's rejection `.message` is just "Command failed: dotnet build" -- the
        // actual compiler diagnostic text lands on `.stdout`, so assert on that instead.
        let buildError: { stdout?: string } | undefined;
        try {
          await execFileAsync('dotnet', ['build'], { cwd: targetDir });
        } catch (error) {
          buildError = error as { stdout?: string };
        }
        expect(buildError, 'expected `dotnet build` to fail for the missing [CommandPath]').toBeDefined();
        expect(buildError?.stdout).toContain('CLISPARK001');

        // Fix it, and the same build must now succeed.
        await writeFile(
          brokenCommandPath,
          [
            'namespace Cli.Commands;',
            '',
            '[CommandPath("broken")]',
            'public class BrokenCommand : ICliCommand',
            '{',
            '    public System.CommandLine.Command Build() => new("broken");',
            '}',
            '',
          ].join('\n'),
        );
        await execFileAsync('dotnet', ['build'], { cwd: targetDir });
      } finally {
        await rm(targetDir, { recursive: true, force: true });
      }
    },
    300_000, // real dotnet restore+build (twice) is slow; generous timeout
  );
});
