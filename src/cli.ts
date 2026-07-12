// src/cli.ts
import path from 'node:path';
import { Command } from 'commander';
import { runWizard } from './wizard';
import { scaffoldProject } from './scaffold';
import { withLogging } from './logger';
import { formatUpdateSummary, updateProject } from './update/update';
import { fetchReleaseNotes, formatReleaseNotes } from './update/releasenotes';
import { getGeneratorVersion } from './update/manifest';

const program = new Command();

program
  .name('clispark')
  .description('Interactive scaffolding tool for new CLI projects')
  .version(getGeneratorVersion());

program.action(
  withLogging('scaffold', async (logger) => {
    const answers = await runWizard();
    const targetDir = path.join(process.cwd(), answers.projectName);

    logger.info({ projectName: answers.projectName, targetDir }, 'scaffold started');
    await scaffoldProject({ projectName: answers.projectName, targetDir, registryUrl: answers.registryUrl });
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
      logger.info({ targetDir }, 'update started');
      const result = await updateProject(targetDir);
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

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
