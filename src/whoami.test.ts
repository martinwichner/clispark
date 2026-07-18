// src/whoami.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { detectJokeLanguage, getWhoamiOutput, LOGO, FALLBACK_QUOTES } from './whoami';

describe('detectJokeLanguage', () => {
  it('maps a supported locale to its primary language subtag', () => {
    expect(detectJokeLanguage('de-DE')).toBe('de');
    expect(detectJokeLanguage('en-US')).toBe('en');
    expect(detectJokeLanguage('pt-BR')).toBe('pt');
  });

  it('is case-insensitive on the locale string', () => {
    expect(detectJokeLanguage('DE-DE')).toBe('de');
  });

  it('falls back to "en" for a locale JokeAPI does not support', () => {
    expect(detectJokeLanguage('ja-JP')).toBe('en');
    expect(detectJokeLanguage('zh-CN')).toBe('en');
  });

  it('falls back to "en" for a locale with no region subtag', () => {
    expect(detectJokeLanguage('sv')).toBe('en');
  });
});

describe('getWhoamiOutput', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('includes the logo and a single-type joke from the API when the request succeeds', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ error: false, type: 'single', joke: 'Why did the CLI cross the road?' }),
    } as unknown as Response);

    const output = await getWhoamiOutput(fetchFn);

    expect(output).toContain(LOGO);
    expect(output).toContain('Why did the CLI cross the road?');
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const calledUrl = fetchFn.mock.calls[0][0] as string;
    expect(calledUrl).toContain('safe-mode');
  });

  it('joins setup and delivery for a twopart joke', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ error: false, type: 'twopart', setup: 'Setup line', delivery: 'Delivery line' }),
    } as unknown as Response);

    const output = await getWhoamiOutput(fetchFn);

    expect(output).toContain('Setup line');
    expect(output).toContain('Delivery line');
  });

  it('falls back to a bundled quote when the API responds with an error payload', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ error: true }),
    } as unknown as Response);

    const output = await getWhoamiOutput(fetchFn);

    expect(output).toContain(LOGO);
    expect(FALLBACK_QUOTES.some((quote) => output.includes(quote))).toBe(true);
  });

  it('falls back to a bundled quote when the API responds with a non-ok status', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false } as unknown as Response);

    const output = await getWhoamiOutput(fetchFn);

    expect(FALLBACK_QUOTES.some((quote) => output.includes(quote))).toBe(true);
  });

  it('falls back to a bundled quote when the network request throws (offline)', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('network down'));

    const output = await getWhoamiOutput(fetchFn);

    expect(output).toContain(LOGO);
    expect(FALLBACK_QUOTES.some((quote) => output.includes(quote))).toBe(true);
  });

  it('falls back to a bundled quote when the request times out', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new DOMException('The operation was aborted.', 'TimeoutError'));

    const output = await getWhoamiOutput(fetchFn);

    expect(FALLBACK_QUOTES.some((quote) => output.includes(quote))).toBe(true);
  });
});
