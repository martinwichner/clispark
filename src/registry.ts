export const DEFAULT_REGISTRY_URL = 'https://registry.npmjs.org';

export type NameCheckResult = 'available' | 'taken' | 'unverified' | 'skipped';

export async function checkPackageNameAvailability(
  name: string,
  registryUrl: string = DEFAULT_REGISTRY_URL,
): Promise<NameCheckResult> {
  const url = `${registryUrl.replace(/\/$/, '')}/${encodeURIComponent(name)}`;

  try {
    const response = await fetch(url);
    if (response.status === 404) return 'available';
    if (response.status === 200) return 'taken';
    return 'unverified';
  } catch {
    return 'unverified';
  }
}
