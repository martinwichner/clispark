// src/cli.ts
import path from 'node:path';
import { Command } from 'commander';
import { runWizard } from './wizard';
import { scaffoldProject } from './scaffold';
import { withLogging } from './logger';
import { formatUpdateSummary, updateProject } from './update/update';
import { fetchReleaseNotes, formatReleaseNotes } from './update/releasenotes';
import { getGeneratorVersion, requireManifest } from './update/manifest';
import { LANGUAGE_PACKS } from './languages';
import type { LanguagePack } from './languages/pack';
import { UserError } from './errors';
import { runAddWizard } from './add-wizard';
import { getWhoamiOutput, type WhoamiMode } from './whoami';
import { printConfetti } from './confetti';
import { getPostScaffoldHookPath, runPostScaffoldHook } from './hooks';
import { existsSync } from 'node:fs';

const program = new Command();

program
  .name('clispark')
  .description('Interactive scaffolding tool for new CLI projects')
  .option('--no-confetti', 'Skip the confetti after a successful run')
  .option('--no-hook', 'Skip the post-scaffold hook, even if one is configured')
  .configureHelp({ showGlobalOptions: true })
  .version(getGeneratorVersion());

function resolvePack(language: string): LanguagePack {
  const pack = LANGUAGE_PACKS[language];
  if (!pack) {
    throw new UserError(`Unknown language "${language}" — is your clispark installation out of date?`);
  }
  return pack;
}

program.action((options: { confetti?: boolean; hook?: boolean }) =>
  withLogging('scaffold', async (logger) => {
    const answers = await runWizard();
    const targetDir = path.join(process.cwd(), answers.projectName);
    const pack = resolvePack(answers.language);

    logger.info({ projectName: answers.projectName, targetDir, language: pack.id }, 'scaffold started');
    await scaffoldProject(
      {
        projectName: answers.projectName,
        targetDir,
        registryUrl: answers.registryUrl,
        publishIntent: answers.publishIntent,
      },
      pack,
    );
    logger.info({ projectName: answers.projectName }, 'scaffold completed');

    console.log(`\nDone! Your new CLI project is ready at ${targetDir}`);

    if (options.hook !== false) {
      await runPostScaffoldHook({
        projectName: answers.projectName,
        targetDir,
        language: pack.id,
        registryUrl: answers.registryUrl,
        publishIntent: answers.publishIntent,
      });
    }

    if (options.confetti !== false) printConfetti();
  })(),
);

program
  .command('update')
  .description('Update generator-managed core files and dependencies to the latest clispark version')
  .action((_options: unknown, command: Command) =>
    withLogging('update', async (logger) => {
      const targetDir = process.cwd();
      const manifest = await requireManifest(targetDir);
      const language = manifest.language ?? 'node';
      const pack = resolvePack(language);
      logger.info({ targetDir, language }, 'update started');
      const result = await updateProject(targetDir, pack.updateAdapter, pack.templateDir, language);
      logger.info({ status: result.status }, 'update completed');
      console.log(formatUpdateSummary(result));
      const { confetti } = command.optsWithGlobals<{ confetti?: boolean }>();
      if (confetti !== false && result.status === 'updated') printConfetti();
    })(),
  );

program
  .command('releasenotes')
  .description("Show what changed between this project's generator version and the latest clispark version")
  .action(
    withLogging('releasenotes', async (logger) => {
      const targetDir = process.cwd();
      logger.info({ targetDir }, 'releasenotes started');
      const result = await fetchReleaseNotes(targetDir);
      logger.info({ status: result.status }, 'releasenotes completed');
      console.log(formatReleaseNotes(result));
    }),
  );

program
  .command('add')
  .description('Add a new command to an already-scaffolded project')
  .action(
    withLogging('add', async (logger) => {
      const targetDir = process.cwd();
      const manifest = await requireManifest(targetDir);
      const language = manifest.language ?? 'node';
      const pack = resolvePack(language);
      logger.info({ targetDir, language }, 'add started');
      await runAddWizard(targetDir, { commandGenerator: pack.commandGenerator });
      logger.info({}, 'add completed');
    }),
  );

function resolveWhoamiMode(options: { joke?: boolean; fact?: boolean }): WhoamiMode {
  if (options.joke && options.fact) {
    throw new UserError('Use either --joke or --fact, not both.');
  }
  if (options.joke) return 'joke';
  if (options.fact) return 'fact';
  return 'random';
}

program
  .command('whoami')
  .description('A little something extra')
  .option('--joke', 'Always show a joke')
  .option('--fact', 'Always show a fun fact about this machine')
  .action((options: { joke?: boolean; fact?: boolean }) =>
    withLogging('whoami', async (logger) => {
      const mode = resolveWhoamiMode(options);
      logger.info({ mode }, 'whoami started');
      console.log(await getWhoamiOutput(fetch, undefined, undefined, mode));
      logger.info({}, 'whoami completed');
    })(),
  );

program
  .command('hook')
  .description('Show the post-scaffold hook file location and whether one is configured')
  .action(() =>
    withLogging('hook', async (logger) => {
      const hookPath = getPostScaffoldHookPath();
      const exists = existsSync(hookPath);
      logger.info({ hookPath, exists }, 'hook status checked');

      console.log('\nPost-scaffold hook\n');
      console.log(`Location: ${hookPath}`);
      if (exists) {
        console.log('Status:   found — will run after the next scaffold');
      } else {
        console.log('Status:   not found — no hook will run after the next scaffold');
        console.log(
          '\nTo add one, create that file as an ES module exporting a default function:\n\n' +
            '  export default async function postScaffold({ projectName, targetDir, language, registryUrl, publishIntent }) {\n' +
            '    // your code here\n' +
            '  }\n\n' +
            'It runs once, right after a new project finishes scaffolding.',
        );
      }
    })(),
  );

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
