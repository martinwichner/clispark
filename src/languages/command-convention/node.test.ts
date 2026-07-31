import { RuleTester } from '@typescript-eslint/rule-tester';
import { afterAll, describe, it } from 'vitest';
import path from 'node:path';
import requireBaseCommand from '../../../templates/node/eslint-rules/require-base-command.js';

// @typescript-eslint/rule-tester auto-detects a Mocha/Jest-style global test
// framework; vitest doesn't inject globals by default (see vitest.config.ts),
// so wire its imported functions in explicitly rather than flipping on
// `test.globals` repo-wide just for this one file.
RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester({
  languageOptions: {
    parserOptions: {
      project: path.join(import.meta.dirname, 'fixtures', 'tsconfig.json'),
      tsconfigRootDir: path.join(import.meta.dirname, 'fixtures'),
    },
  },
});

ruleTester.run('require-base-command', requireBaseCommand, {
  valid: [
    {
      code: `
        import { BaseCommand } from '../../base-command';
        export default class Hello extends BaseCommand {
          async run() {}
        }
      `,
      // RuleTester internally does `path.join(tsconfigRootDir, filename)` whenever
      // `parserOptions.project` is set (see its #normalizeTests), so `filename` here
      // must be relative to `fixtures/` (tsconfigRootDir above) -- an already-absolute
      // path would get joined a second time and no longer resolve.
      filename: path.join('src', 'commands', 'hello.ts'),
    },
    {
      code: `
        import { BaseCommand } from '../../../base-command';
        abstract class TaskCommandBase extends BaseCommand {}
        export default class TaskList extends TaskCommandBase {
          async run() {}
        }
      `,
      filename: path.join('src', 'commands', 'task', 'list.ts'),
    },
  ],
  invalid: [
    {
      code: `
        import { Command } from '@oclif/core';
        export default class Hello extends Command {
          async run() {}
        }
      `,
      filename: path.join('src', 'commands', 'hello.ts'),
      errors: [{ messageId: 'mustExtendBaseCommand' }],
    },
    {
      code: `
        export default class Hello {
          async run() {}
        }
      `,
      filename: path.join('src', 'commands', 'hello.ts'),
      errors: [{ messageId: 'mustExtendBaseCommand' }],
    },
  ],
});
