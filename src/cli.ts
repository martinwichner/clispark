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
import { getWhoamiOutput } from './whoami';

const program = new Command();

program
  .name('clispark')
  .description('Interactive scaffolding tool for new CLI projects')
  .version(getGeneratorVersion());

function resolvePack(language: string): LanguagePack {
  const pack = LANGUAGE_PACKS[language];
  if (!pack) {
    throw new UserError(`Unknown language "${language}" — is your clispark installation out of date?`);
  }
  return pack;
}

program.action(
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
  }),
);

program
  .command('update')
  .description('Update generator-managed core files and dependencies to the latest clispark version')
  .action(
    withLogging('update', async (logger) => {
      const targetDir = process.cwd();
      const manifest = await requireManifest(targetDir);
      const language = manifest.language ?? 'node';
      const pack = resolvePack(language);
      logger.info({ targetDir, language }, 'update started');
      const result = await updateProject(targetDir, pack.updateAdapter, pack.templateDir, language);
      logger.info({ status: result.status }, 'update completed');
      console.log(formatUpdateSummary(result));
    }),
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
  .command('whoami')
  .description('A little something extra')
  .action(
    withLogging('whoami', async (logger) => {
      logger.info({}, 'whoami started');
      console.log(await getWhoamiOutput());
      logger.info({}, 'whoami completed');
    }),
  );

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
