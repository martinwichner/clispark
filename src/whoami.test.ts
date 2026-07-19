// src/whoami.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { detectJokeLanguage, getWhoamiOutput, getRandomFunFact, LOGO, FALLBACK_QUOTES, type OsFacts } from './whoami';

const forceJoke = () => 0.99;
const forceFact = () => 0;

const stubOsFacts: OsFacts = {
  uptime: () => 90061, // 1d 1h 1m
  hostname: () => 'test-host',
  cpus: () => [{ model: '  Test CPU  ' } as unknown as ReturnType<OsFacts['cpus']>[number]],
  totalmem: () => 8 * 1024 ** 3,
  platform: () => 'linux',
  release: () => '6.0.0',
  arch: () => 'x64',
};

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

    const output = await getWhoamiOutput(fetchFn, undefined, forceJoke);

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

    const output = await getWhoamiOutput(fetchFn, undefined, forceJoke);

    expect(output).toContain('Setup line');
    expect(output).toContain('Delivery line');
  });

  it('falls back to a bundled quote when the API responds with an error payload', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ error: true }),
    } as unknown as Response);

    const output = await getWhoamiOutput(fetchFn, undefined, forceJoke);

    expect(output).toContain(LOGO);
    expect(FALLBACK_QUOTES.some((quote) => output.includes(quote))).toBe(true);
  });

  it('falls back to a bundled quote when the API responds with a non-ok status', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false } as unknown as Response);

    const output = await getWhoamiOutput(fetchFn, undefined, forceJoke);

    expect(FALLBACK_QUOTES.some((quote) => output.includes(quote))).toBe(true);
  });

  it('falls back to a bundled quote when the network request throws (offline)', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('network down'));

    const output = await getWhoamiOutput(fetchFn, undefined, forceJoke);

    expect(output).toContain(LOGO);
    expect(FALLBACK_QUOTES.some((quote) => output.includes(quote))).toBe(true);
  });

  it('falls back to a bundled quote when the request times out', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new DOMException('The operation was aborted.', 'TimeoutError'));

    const output = await getWhoamiOutput(fetchFn, undefined, forceJoke);

    expect(FALLBACK_QUOTES.some((quote) => output.includes(quote))).toBe(true);
  });

  it('shows a fun fact instead of a joke when the random draw favors facts', async () => {
    const fetchFn = vi.fn();

    const output = await getWhoamiOutput(fetchFn, stubOsFacts, forceFact);

    expect(output).toContain(LOGO);
    expect(output).toContain('This machine has been up for 1d 1h 1m.');
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('getRandomFunFact', () => {
  it('reports uptime formatted as days/hours/minutes', () => {
    expect(getRandomFunFact(stubOsFacts, () => 0)).toBe('This machine has been up for 1d 1h 1m.');
  });

  it('reports the hostname', () => {
    expect(getRandomFunFact(stubOsFacts, () => 0.21)).toBe('Hostname: test-host');
  });

  it('reports CPU model and core count, trimming whitespace', () => {
    expect(getRandomFunFact(stubOsFacts, () => 0.41)).toBe('CPU: Test CPU (1 logical cores)');
  });

  it('reports total RAM in GB', () => {
    expect(getRandomFunFact(stubOsFacts, () => 0.61)).toBe('RAM: 8.0 GB total');
  });

  it('reports OS platform, release and architecture', () => {
    expect(getRandomFunFact(stubOsFacts, () => 0.81)).toBe('OS: linux 6.0.0 (x64)');
  });

  it('falls back to "unknown" when no CPU info is available', () => {
    const noCpuFacts: OsFacts = { ...stubOsFacts, cpus: () => [] };
    expect(getRandomFunFact(noCpuFacts, () => 0.41)).toBe('CPU: unknown (0 logical cores)');
  });
});
