// scripts/triage-issue.ts
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const AREA_OPTIONS = ['node', 'dotnet', 'generator'] as const;
const AREA_FIELD_HEADING = '### Area';

export function determineAreaLabel(body: string | undefined | null): string {
  if (!body) return 'needs-triage';

  const headingIndex = body.indexOf(AREA_FIELD_HEADING);
  if (headingIndex === -1) return 'needs-triage';

  const afterHeading = body.slice(headingIndex + AREA_FIELD_HEADING.length);
  const value = afterHeading
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!value) return 'needs-triage';

  const normalized = value.toLowerCase();
  if ((AREA_OPTIONS as readonly string[]).includes(normalized)) {
    return `area:${normalized}`;
  }
  return 'needs-triage';
}

export interface TriageDeps {
  runGh: (args: string[]) => Promise<string>;
}

export async function triageIssue(
  issueNumber: string,
  body: string | undefined | null,
  deps: TriageDeps,
): Promise<string> {
  const label = determineAreaLabel(body);
  await deps.runGh(['issue', 'edit', issueNumber, '--add-label', label]);
  return label;
}

async function realRunGh(args: string[]): Promise<string> {
  return execFileSync('gh', args, { encoding: 'utf8' });
}

async function main(): Promise<void> {
  const issueNumber = process.env.ISSUE_NUMBER;
  if (!issueNumber) {
    throw new Error('ISSUE_NUMBER environment variable is required');
  }
  const label = await triageIssue(issueNumber, process.env.ISSUE_BODY, { runGh: realRunGh });
  console.log(`Applied label: ${label}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
