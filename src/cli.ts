// src/cli.ts
import { createRequire } from 'node:module';
import { Command } from 'commander';
import { runWizard } from './wizard.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };

const program = new Command();

program
  .name('clispark')
  .description('Interactive scaffolding tool for new CLI projects')
  .version(pkg.version);

program.action(async () => {
  const answers = await runWizard();
  console.log('\nCollected wizard answers:');
  console.log(JSON.stringify(answers, null, 2));
});

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
