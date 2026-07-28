// src/prompt-utils.ts
//
// Wraps @clack/prompts' select() with a fallback for terminals where raw mode can't be
// enabled (e.g. Git Bash/MinTTY on Windows, where process.stdin.isTTY is undefined — see
// GitHub issue #128). @clack/core only puts stdin into raw mode when isTTY is truthy, and
// arrow-key navigation requires raw mode; without it, select() renders but can't be driven.
// The fallback numbers the options and reads the choice through text(), which already works
// in line-buffered/cooked mode.
import { select as clackSelect, text, isCancel } from '@clack/prompts';
import type { SelectOptions } from '@clack/prompts';

export type { SelectOptions };

export function canUseRawMode(stdin: NodeJS.ReadStream = process.stdin): boolean {
  return Boolean(stdin.isTTY) && typeof stdin.setRawMode === 'function';
}

export async function select<Value>(opts: SelectOptions<Value>): Promise<Value | symbol> {
  if (canUseRawMode()) {
    return clackSelect(opts);
  }
  return selectFallback(opts);
}

async function selectFallback<Value>(opts: SelectOptions<Value>): Promise<Value | symbol> {
  const enabled = opts.options.filter((option) => !option.disabled);
  const listing = enabled
    .map((option, index) => `${index + 1}) ${option.label ?? String(option.value)}${option.hint ? ` (${option.hint})` : ''}`)
    .join('\n');
  const defaultIndex = enabled.findIndex((option) => option.value === opts.initialValue);

  const answer = await text({
    message: `${opts.message} (arrow-key selection isn't available in this terminal)\n${listing}`,
    initialValue: defaultIndex >= 0 ? String(defaultIndex + 1) : undefined,
    validate: (value) => {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1 || n > enabled.length) {
        return `Enter a number from 1 to ${enabled.length}`;
      }
      return undefined;
    },
  });

  if (isCancel(answer)) return answer;

  return enabled[Number(answer) - 1].value;
}
