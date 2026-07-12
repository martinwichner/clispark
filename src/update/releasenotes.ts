// src/update/releasenotes.ts
import { getGeneratorVersion, requireManifest } from './manifest';

export interface GitHubRelease {
  tag_name: string;
  name: string;
  body: string;
}

function stripV(version: string): string {
  return version.startsWith('v') ? version.slice(1) : version;
}

export function compareVersions(a: string, b: string): number {
  const partsA = stripV(a).split('.').map(Number);
  const partsB = stripV(b).split('.').map(Number);
  const length = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < length; i++) {
    const diff = (partsA[i] ?? 0) - (partsB[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export interface ReleaseNotesResult {
  status: 'up-to-date' | 'releases-found';
  fromVersion: string;
  toVersion: string;
  releases: GitHubRelease[];
}

const RELEASES_URL = 'https://api.github.com/repos/martinwichner/clispark/releases';

export async function fetchReleaseNotes(
  targetDir: string,
  fetchFn: typeof fetch = fetch,
): Promise<ReleaseNotesResult> {
  const manifest = await requireManifest(targetDir);
  const fromVersion = manifest.generatorVersion;
  const toVersion = getGeneratorVersion();

  if (compareVersions(fromVersion, toVersion) >= 0) {
    return { status: 'up-to-date', fromVersion, toVersion, releases: [] };
  }

  const response = await fetchFn(RELEASES_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch release notes: GitHub API responded with ${response.status}`);
  }
  const allReleases = (await response.json()) as GitHubRelease[];

  const releases = allReleases
    .filter((r) => compareVersions(r.tag_name, fromVersion) > 0 && compareVersions(r.tag_name, toVersion) <= 0)
    .sort((a, b) => compareVersions(b.tag_name, a.tag_name));

  return { status: 'releases-found', fromVersion, toVersion, releases };
}

export function formatReleaseNotes(result: ReleaseNotesResult): string {
  if (result.status === 'up-to-date') {
    return `You're on the latest clispark version (v${result.toVersion}), nothing to show.`;
  }
  if (result.releases.length === 0) {
    return `No published releases found between v${result.fromVersion} and v${result.toVersion}.`;
  }
  return result.releases.map((r) => `## ${r.tag_name}\n\n${r.body}`).join('\n\n');
}
