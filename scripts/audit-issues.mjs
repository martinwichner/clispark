// scripts/audit-issues.mjs
import { execSync, execFileSync } from 'node:child_process';

export function categorizeFindings(auditReport) {
  const counts = auditReport.metadata?.vulnerabilities ?? {};
  const blockingCount = (counts.critical ?? 0) + (counts.high ?? 0);
  const informationalCount = (counts.moderate ?? 0) + (counts.low ?? 0);

  const blockingPackages = [];
  const informationalPackages = [];

  for (const [name, finding] of Object.entries(auditReport.vulnerabilities ?? {})) {
    if (finding.severity === 'critical' || finding.severity === 'high') {
      blockingPackages.push(`${name} (${finding.severity})`);
    } else if (finding.severity === 'moderate' || finding.severity === 'low') {
      informationalPackages.push(`${name} (${finding.severity})`);
    }
  }

  return {
    blocking: { count: blockingCount, packages: blockingPackages },
    informational: { count: informationalCount, packages: informationalPackages },
  };
}

export async function syncIssueForClass(options, deps) {
  const { label, title, isClean, bodyIfFindings, bodyIfClean } = options;
  const { runGh } = deps;

  const listOutput = await runGh(['issue', 'list', '--label', label, '--state', 'open', '--json', 'number']);
  const openIssues = JSON.parse(listOutput);
  const existingNumber = openIssues[0]?.number;

  if (isClean) {
    if (existingNumber !== undefined) {
      await runGh(['issue', 'close', String(existingNumber), '--comment', bodyIfClean]);
    }
    return;
  }

  if (existingNumber !== undefined) {
    await runGh(['issue', 'comment', String(existingNumber), '--body', bodyIfFindings]);
  } else {
    await runGh(['issue', 'create', '--title', title, '--body', bodyIfFindings, '--label', label]);
  }
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

function buildBody(packages, runUrl) {
  const list = packages.length > 0 ? packages.map((p) => `- ${p}`).join('\n') : '(none)';
  return `${list}\n\nFrom: ${runUrl}`;
}

async function main() {
  const report = runNpmAudit();
  const { blocking, informational } = categorizeFindings(report);
  const runUrl = process.env.GITHUB_RUN_URL ?? '(unknown run)';

  await syncIssueForClass(
    {
      label: 'security-audit-blocking',
      title: 'npm audit: blocking (high/critical) findings',
      isClean: blocking.count === 0,
      bodyIfFindings: buildBody(blocking.packages, runUrl),
      bodyIfClean: `Clean as of ${runUrl}`,
    },
    { runGh: realRunGh },
  );

  await syncIssueForClass(
    {
      label: 'security-audit-info',
      title: 'npm audit: informational (moderate/low) findings',
      isClean: informational.count === 0,
      bodyIfFindings: buildBody(informational.packages, runUrl),
      bodyIfClean: `Clean as of ${runUrl}`,
    },
    { runGh: realRunGh },
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
