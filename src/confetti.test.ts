// src/confetti.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { getConfetti, printConfetti } from './confetti';

describe('getConfetti', () => {
  it('returns the first variant when the random draw is at the low end', () => {
    expect(getConfetti(() => 0)).toContain('🎈');
  });

  it('returns the last variant when the random draw is at the high end', () => {
    expect(getConfetti(() => 0.99)).toContain('🎉✨🎊✨🎉');
  });

  it('always returns a non-empty string', () => {
    for (const draw of [0, 0.2, 0.4, 0.6, 0.8, 0.99]) {
      expect(getConfetti(() => draw).length).toBeGreaterThan(0);
    }
  });
});

describe('printConfetti', () => {
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

  afterEach(() => {
    logSpy.mockClear();
  });

  it('logs a confetti variant to the console', () => {
    printConfetti(() => 0);

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0]).toContain('🎈');
  });
});
