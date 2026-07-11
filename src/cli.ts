// src/cli.ts
import { createRequire } from 'node:module';
import path from 'node:path';
import { Command } from 'commander';
import { runWizard } from './wizard.js';
import { scaffoldProject } from './scaffold.js';
import { withLogging } from './logger.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };

const program = new Command();

program
  .name('clispark')
  .description('Interactive scaffolding tool for new CLI projects')
  .version(pkg.version);

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

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
