// src/cli.ts
import { createRequire } from 'node:module';
import path from 'node:path';
import { Command } from 'commander';
import { runWizard } from './wizard.js';
import { scaffoldProject } from './scaffold.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };

const program = new Command();

program
  .name('clispark')
  .description('Interactive scaffolding tool for new CLI projects')
  .version(pkg.version);

program.action(async () => {
  const answers = await runWizard();
  const targetDir = path.join(process.cwd(), answers.projectName);

  await scaffoldProject({ projectName: answers.projectName, targetDir });

  console.log(`\nDone! Your new CLI project is ready at ${targetDir}`);
});

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
