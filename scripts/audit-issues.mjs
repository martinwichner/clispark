// scripts/audit-issues.mjs
import { execSync, execFileSync } from 'node:child_process';

function extractAdvisory(finding) {
  return (finding.via ?? []).find((v) => typeof v === 'object');
}

export function categorizeFindings(auditReport) {
  const counts = auditReport.metadata?.vulnerabilities ?? {};
  const blockingCount = (counts.critical ?? 0) + (counts.high ?? 0);
  const informationalCount = (counts.moderate ?? 0) + (counts.low ?? 0);

  const blocking = [];
  const informational = [];

  for (const [name, finding] of Object.entries(auditReport.vulnerabilities ?? {})) {
    const advisory = extractAdvisory(finding);
    const entry = {
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

function buildStateMarker(state) {
  return `${STATE_MARKER_PREFIX}${JSON.stringify(state)}${STATE_MARKER_SUFFIX}`;
}

function extractState(body) {
  const start = body?.indexOf(STATE_MARKER_PREFIX) ?? -1;
  if (start === -1) return {};
  const end = body.indexOf(STATE_MARKER_SUFFIX, start);
  if (end === -1) return {};
  try {
    return JSON.parse(body.slice(start + STATE_MARKER_PREFIX.length, end));
  } catch {
    return {};
  }
}

function toState(findings) {
  return Object.fromEntries(findings.map((f) => [f.name, f.severity]));
}

function diffState(previous, current) {
  const added = [];
  const updated = [];
  for (const name of Object.keys(current)) {
    if (!(name in previous)) added.push(name);
    else if (previous[name] !== current[name]) updated.push(name);
  }
  const resolved = Object.keys(previous).filter((name) => !(name in current));
  return { added, updated, resolved };
}

function formatFinding(finding) {
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

function buildBody(findings, runUrl) {
  const list = findings.length > 0 ? findings.map(formatFinding).join('\n') : '(none)';
  return `${list}\n\nLast checked: ${runUrl}\n\n${buildStateMarker(toState(findings))}`;
}

export async function syncIssueForClass(options, deps) {
  const { label, title, findings, runUrl, bodyIfClean } = options;
  const { runGh } = deps;
  const isClean = findings.length === 0;

  const listOutput = await runGh(['issue', 'list', '--label', label, '--state', 'open', '--json', 'number']);
  const openIssues = JSON.parse(listOutput);
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
  const previousState = extractState(JSON.parse(viewOutput).body);
  const currentState = toState(findings);
  const { added, updated, resolved } = diffState(previousState, currentState);

  if (added.length === 0 && updated.length === 0 && resolved.length === 0) {
    return;
  }

  await runGh(['issue', 'edit', String(existingNumber), '--body', body]);

  const changeLines = [];
  if (added.length > 0) changeLines.push(`New: ${added.join(', ')}`);
  if (updated.length > 0) changeLines.push(`Severity changed: ${updated.join(', ')}`);
  if (resolved.length > 0) changeLines.push(`Resolved: ${resolved.join(', ')}`);
  await runGh(['issue', 'comment', String(existingNumber), '--body', changeLines.join('\n')]);
}

function runNpmAudit() {
  try {
    const output = execSync('npm audit --json', { encoding: 'utf8' });
    return JSON.parse(output);
  } catch (error) {
    if (error.stdout) return JSON.parse(error.stdout);
    throw error;
  }
}

async function realRunGh(args) {
  return execFileSync('gh', args, { encoding: 'utf8' });
}

async function main() {
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
