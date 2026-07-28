// src/prompt-utils.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@clack/prompts', () => ({
  select: vi.fn(),
  text: vi.fn(),
  isCancel: vi.fn(() => false),
}));

import { select as clackSelect, text, isCancel } from '@clack/prompts';
import { select, canUseRawMode } from './prompt-utils';

const originalIsTTY = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
const originalSetRawMode = process.stdin.setRawMode;

function setStdinRawModeCapable(capable: boolean): void {
  Object.defineProperty(process.stdin, 'isTTY', { value: capable, configurable: true });
  process.stdin.setRawMode = capable ? vi.fn().mockReturnThis() : (undefined as unknown as typeof process.stdin.setRawMode);
}

describe('canUseRawMode', () => {
  it('is true when isTTY is true and setRawMode is a function', () => {
    expect(canUseRawMode({ isTTY: true, setRawMode: () => {} } as unknown as NodeJS.ReadStream)).toBe(true);
  });

  it('is false when isTTY is undefined', () => {
    expect(canUseRawMode({ isTTY: undefined, setRawMode: () => {} } as unknown as NodeJS.ReadStream)).toBe(false);
  });

  it('is false when isTTY is true but setRawMode is not a function', () => {
    expect(canUseRawMode({ isTTY: true } as unknown as NodeJS.ReadStream)).toBe(false);
  });
});

describe('select', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (originalIsTTY) Object.defineProperty(process.stdin, 'isTTY', originalIsTTY);
    process.stdin.setRawMode = originalSetRawMode;
  });

  it('delegates to @clack/prompts select() when the terminal supports raw mode', async () => {
    setStdinRawModeCapable(true);
    vi.mocked(clackSelect).mockResolvedValueOnce('typescript');

    const opts = {
      message: 'Which language?',
      options: [
        { value: 'typescript', label: 'TypeScript' },
        { value: 'javascript', label: 'JavaScript' },
      ],
    };
    const result = await select(opts);

    expect(result).toBe('typescript');
    expect(clackSelect).toHaveBeenCalledWith(opts);
    expect(text).not.toHaveBeenCalled();
  });

  it('falls back to a numbered text prompt when the terminal does not support raw mode', async () => {
    setStdinRawModeCapable(false);
    vi.mocked(text).mockResolvedValueOnce('2');

    const result = await select({
      message: 'Which language?',
      options: [
        { value: 'typescript', label: 'TypeScript' },
        { value: 'javascript', label: 'JavaScript' },
        { value: 'python', label: 'Python' },
      ],
    });

    expect(result).toBe('javascript');
    expect(clackSelect).not.toHaveBeenCalled();
    expect(text).toHaveBeenCalledOnce();
    const textOpts = vi.mocked(text).mock.calls[0][0];
    expect(textOpts.message).toContain('1) TypeScript');
    expect(textOpts.message).toContain('2) JavaScript');
    expect(textOpts.message).toContain('3) Python');
  });

  it('returns the cancel symbol as-is when the fallback prompt is cancelled', async () => {
    setStdinRawModeCapable(false);
    const CANCEL = Symbol('cancel');
    vi.mocked(text).mockResolvedValueOnce(CANCEL as unknown as string);
    vi.mocked(isCancel).mockReturnValueOnce(true);

    const result = await select({
      message: 'Which language?',
      options: [{ value: 'typescript', label: 'TypeScript' }],
    });

    expect(result).toBe(CANCEL);
  });

  it('rejects non-numeric or out-of-range input in the fallback prompt', async () => {
    setStdinRawModeCapable(false);
    vi.mocked(text).mockResolvedValueOnce('1');

    await select({
      message: 'Which language?',
      options: [
        { value: 'typescript', label: 'TypeScript' },
        { value: 'javascript', label: 'JavaScript' },
      ],
    });

    const validate = vi.mocked(text).mock.calls[0][0].validate as (value: string) => string | undefined;
    expect(validate('abc')).toBe('Enter a number from 1 to 2');
    expect(validate('0')).toBe('Enter a number from 1 to 2');
    expect(validate('3')).toBe('Enter a number from 1 to 2');
    expect(validate('1')).toBeUndefined();
    expect(validate('2')).toBeUndefined();
  });

  it('skips disabled options when numbering the fallback list', async () => {
    setStdinRawModeCapable(false);
    vi.mocked(text).mockResolvedValueOnce('2');

    const result = await select({
      message: 'Pick one',
      options: [
        { value: 'a', label: 'A', disabled: true },
        { value: 'b', label: 'B' },
        { value: 'c', label: 'C' },
      ],
    });

    expect(result).toBe('c');
    const textOpts = vi.mocked(text).mock.calls[0][0];
    expect(textOpts.message).toContain('1) B');
    expect(textOpts.message).toContain('2) C');
    expect(textOpts.message).not.toContain('A');
  });
});
