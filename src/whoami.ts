// src/whoami.ts

const JOKE_API_URL = 'https://v2.jokeapi.dev/joke/Programming,Miscellaneous';
const FETCH_TIMEOUT_MS = 3000;

/** Languages JokeAPI (https://jokeapi.dev/) currently supports, per its /languages endpoint. */
const SUPPORTED_JOKE_LANGUAGES = ['cs', 'de', 'en', 'es', 'fr', 'pt'];

export const LOGO = String.raw`
      ⚡ clispark
`;

export const FALLBACK_QUOTES = [
  "Green unit tests don't mean it works. Real end-to-end verification does.",
  'A default value can silently reintroduce coupling you just removed.',
  "The bug you can't find locally is waiting for you in CI.",
  "YAGNI until you actually need it — then it's just an adapter away.",
  'Every folder move has a bundling-depth bug waiting to happen.',
  'The cheapest fix is the one you verify before you ship it.',
  'TDD: write the failing test first, or explain later why it passed by accident.',
  "If it's not tested against a real filesystem, it's a theory, not a fact.",
];

interface JokeApiSingle {
  error: false;
  type: 'single';
  joke: string;
}

interface JokeApiTwoPart {
  error: false;
  type: 'twopart';
  setup: string;
  delivery: string;
}

interface JokeApiError {
  error: true;
}

type JokeApiResponse = JokeApiSingle | JokeApiTwoPart | JokeApiError;

/** Maps a BCP-47 locale (e.g. "de-DE") to a JokeAPI language code, defaulting to "en" when unsupported. */
export function detectJokeLanguage(
  locale: string = Intl.DateTimeFormat().resolvedOptions().locale,
): string {
  const primary = locale.split('-')[0].toLowerCase();
  return SUPPORTED_JOKE_LANGUAGES.includes(primary) ? primary : 'en';
}

function pickFallbackQuote(): string {
  return FALLBACK_QUOTES[Math.floor(Math.random() * FALLBACK_QUOTES.length)];
}

async function fetchJoke(language: string, fetchFn: typeof fetch): Promise<string | undefined> {
  try {
    const url = `${JOKE_API_URL}?lang=${language}&safe-mode`;
    const response = await fetchFn(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!response.ok) return undefined;

    const data = (await response.json()) as JokeApiResponse;
    if (data.error) return undefined;
    return data.type === 'single' ? data.joke : `${data.setup}\n${data.delivery}`;
  } catch {
    return undefined;
  }
}

export async function getWhoamiOutput(fetchFn: typeof fetch = fetch): Promise<string> {
  const language = detectJokeLanguage();
  const quote = (await fetchJoke(language, fetchFn)) ?? pickFallbackQuote();
  return `${LOGO}\n${quote}\n`;
}
