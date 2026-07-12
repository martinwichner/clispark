// scripts/audit-issues.ts
import { execFileSync, execSync } from 'node:child_process';

export interface AdvisoryVia {
  title?: string;
  url?: string;
}

export interface AuditFinding {
  severity: string;
  range?: string;
  fixAvailable?: boolean;
  via?: (string | AdvisoryVia)[];
}

export interface AuditReport {
  metadata?: {
    vulnerabilities?: {
      critical?: number;
      high?: number;
      moderate?: number;
      low?: number;
    };
  };
  vulnerabilities?: Record<string, AuditFinding>;
}

function extractAdvisory(finding: AuditFinding): AdvisoryVia | undefined {
  return (finding.via ?? []).find((v): v is AdvisoryVia => typeof v === 'object');
}

export interface CategorizedFinding {
  name: string;
  severity: string;
  range?: string;
  fixAvailable: boolean;
  advisoryTitle?: string;
  advisoryUrl?: string;
}

export interface CategorizedFindings {
  blocking: { count: number; findings: CategorizedFinding[] };
  informational: { count: number; findings: CategorizedFinding[] };
}

export function categorizeFindings(auditReport: AuditReport): CategorizedFindings {
  const counts = auditReport.metadata?.vulnerabilities ?? {};
  const blockingCount = (counts.critical ?? 0) + (counts.high ?? 0);
  const informationalCount = (counts.moderate ?? 0) + (counts.low ?? 0);

  const blocking: CategorizedFinding[] = [];
  const informational: CategorizedFinding[] = [];

  for (const [name, finding] of Object.entries(auditReport.vulnerabilities ?? {})) {
    const advisory = extractAdvisory(finding);
    const entry: CategorizedFinding = {
      name,
      severity: finding.severity,
      range: finding.range,
      fixAvailable: Boolean(finding.fixAvailable),
      advisoryTitle: advisory?.title,
      advisoryUrl: advisory?.url,
    };
    if (finding.severity === 'critical' || finding.severity === 'high') {
      blocking.push(entry);
    } else if (finding.severity === 'moderate' || finding.severity === 'low') {
      informational.push(entry);
    }
  }

  return {
    blocking: { count: blockingCount, findings: blocking },
    informational: { count: informationalCount, findings: informational },
  };
}

const STATE_MARKER_PREFIX = '<!-- audit-issues:state:';
const STATE_MARKER_SUFFIX = ' -->';

function buildStateMarker(state: Record<string, string>): string {
  return `${STATE_MARKER_PREFIX}${JSON.stringify(state)}${STATE_MARKER_SUFFIX}`;
}

function extractState(body: string | undefined): Record<string, string> {
  if (!body) return {};
  const start = body.indexOf(STATE_MARKER_PREFIX);
  if (start === -1) return {};
  const end = body.indexOf(STATE_MARKER_SUFFIX, start);
  if (end === -1) return {};
  try {
    return JSON.parse(body.slice(start + STATE_MARKER_PREFIX.length, end)) as Record<string, string>;
  } catch {
    return {};
  }
}

function toState(findings: CategorizedFinding[]): Record<string, string> {
  return Object.fromEntries(findings.map((f) => [f.name, f.severity]));
}

interface StateDiff {
  added: string[];
  updated: string[];
  resolved: string[];
}

function diffState(previous: Record<string, string>, current: Record<string, string>): StateDiff {
  const added: string[] = [];
  const updated: string[] = [];
  for (const name of Object.keys(current)) {
    if (!(name in previous)) added.push(name);
    else if (previous[name] !== current[name]) updated.push(name);
  }
  const resolved = Object.keys(previous).filter((name) => !(name in current));
  return { added, updated, resolved };
}

function formatFinding(finding: CategorizedFinding): string {
  const lines = [`- **${finding.name}** (${finding.severity})`];
  if (finding.range) lines.push(`  - Affected range: \`${finding.range}\``);
  lines.push(`  - Fix available: ${finding.fixAvailable ? 'yes' : 'no'}`);
  if (finding.advisoryTitle && finding.advisoryUrl) {
    lines.push(`  - ${finding.advisoryTitle}: ${finding.advisoryUrl}`);
  } else if (finding.advisoryTitle) {
    lines.push(`  - ${finding.advisoryTitle}`);
  } else if (finding.advisoryUrl) {
    lines.push(`  - ${finding.advisoryUrl}`);
  }
  return lines.join('\n');
}

function buildBody(findings: CategorizedFinding[], runUrl: string): string {
  const list = findings.length > 0 ? findings.map(formatFinding).join('\n') : '(none)';
  return `${list}\n\nLast checked: ${runUrl}\n\n${buildStateMarker(toState(findings))}`;
}

export interface SyncIssueOptions {
  label: string;
  title: string;
  findings: CategorizedFinding[];
  runUrl: string;
  bodyIfClean: string;
}

export interface SyncIssueDeps {
  runGh: (args: string[]) => Promise<string>;
}

export async function syncIssueForClass(options: SyncIssueOptions, deps: SyncIssueDeps): Promise<void> {
  const { label, title, findings, runUrl, bodyIfClean } = options;
  const { runGh } = deps;
  const isClean = findings.length === 0;

  const listOutput = await runGh(['issue', 'list', '--label', label, '--state', 'open', '--json', 'number']);
  const openIssues = JSON.parse(listOutput) as { number: number }[];
  const existingNumber = openIssues[0]?.number;

  if (isClean) {
    if (existingNumber !== undefined) {
      await runGh(['issue', 'close', String(existingNumber), '--comment', bodyIfClean]);
    }
    return;
  }

  const body = buildBody(findings, runUrl);

  if (existingNumber === undefined) {
    await runGh(['issue', 'create', '--title', title, '--body', body, '--label', label]);
    return;
  }

  const viewOutput = await runGh(['issue', 'view', String(existingNumber), '--json', 'body']);
  const previousState = extractState((JSON.parse(viewOutput) as { body: string }).body);
  const currentState = toState(findings);
  const { added, updated, resolved } = diffState(previousState, currentState);

  if (added.length === 0 && updated.length === 0 && resolved.length === 0) {
    return;
  }

  await runGh(['issue', 'edit', String(existingNumber), '--body', body]);

  const changeLines: string[] = [];
  if (added.length > 0) changeLines.push(`New: ${added.join(', ')}`);
  if (updated.length > 0) changeLines.push(`Severity changed: ${updated.join(', ')}`);
  if (resolved.length > 0) changeLines.push(`Resolved: ${resolved.join(', ')}`);
  await runGh(['issue', 'comment', String(existingNumber), '--body', changeLines.join('\n')]);
}

interface ExecError extends Error {
  stdout?: string;
}

function runNpmAudit(): AuditReport {
  try {
    const output = execSync('npm audit --json', { encoding: 'utf8' });
    return JSON.parse(output) as AuditReport;
  } catch (error) {
    const stdout = (error as ExecError).stdout;
    if (stdout) return JSON.parse(stdout) as AuditReport;
    throw error;
  }
}

async function realRunGh(args: string[]): Promise<string> {
  return execFileSync('gh', args, { encoding: 'utf8' });
}

async function main(): Promise<void> {
  const report = runNpmAudit();
  const { blocking, informational } = categorizeFindings(report);
  const runUrl = process.env.GITHUB_RUN_URL ?? '(unknown run)';

  await syncIssueForClass(
    {
      label: 'security-audit-blocking',
      title: 'npm audit: blocking (high/critical) findings',
      findings: blocking.findings,
      runUrl,
      bodyIfClean: `Clean as of ${runUrl}`,
    },
    { runGh: realRunGh },
  );

  await syncIssueForClass(
    {
      label: 'security-audit-info',
      title: 'npm audit: informational (moderate/low) findings',
      findings: informational.findings,
      runUrl,
      bodyIfClean: `Clean as of ${runUrl}`,
    },
    { runGh: realRunGh },
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
