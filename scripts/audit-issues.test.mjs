import { describe, it, expect, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { categorizeFindings, syncIssueForClass } from './audit-issues.mjs';

const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

async function loadFixture(name) {
  return JSON.parse(await readFile(path.join(FIXTURES_DIR, name), 'utf8'));
}

describe('categorizeFindings', () => {
  it('returns zero counts and empty package lists for a clean audit', async () => {
    const report = await loadFixture('audit-clean.json');

    const result = categorizeFindings(report);

    expect(result).toEqual({
      blocking: { count: 0, packages: [] },
      informational: { count: 0, packages: [] },
    });
  });

  it('buckets critical/high as blocking and moderate/low as informational', async () => {
    const report = await loadFixture('audit-with-findings.json');

    const result = categorizeFindings(report);

    expect(result.blocking.count).toBe(1);
    expect(result.blocking.packages).toEqual(['example-critical-pkg (critical)']);
    expect(result.informational.count).toBe(1);
    expect(result.informational.packages).toEqual(['example-moderate-pkg (moderate)']);
  });
});

describe('syncIssueForClass', () => {
  it('creates a new issue when findings exist and no open issue is found', async () => {
    const calls = [];
    const runGh = vi.fn(async (args) => {
      calls.push(args);
      if (args[0] === 'issue' && args[1] === 'list') return '[]';
      return '';
    });

    await syncIssueForClass(
      {
        label: 'security-audit-blocking',
        title: 'Blocking security audit findings',
        isClean: false,
        bodyIfFindings: 'Found: example-critical-pkg (critical)',
        bodyIfClean: 'All clear.',
      },
      { runGh },
    );

    expect(calls).toEqual([
      ['issue', 'list', '--label', 'security-audit-blocking', '--state', 'open', '--json', 'number'],
      [
        'issue',
        'create',
        '--title',
        'Blocking security audit findings',
        '--body',
        'Found: example-critical-pkg (critical)',
        '--label',
        'security-audit-blocking',
      ],
    ]);
  });

  it('comments on the existing open issue instead of creating a duplicate', async () => {
    const calls = [];
    const runGh = vi.fn(async (args) => {
      calls.push(args);
      if (args[0] === 'issue' && args[1] === 'list') return '[{"number": 42}]';
      return '';
    });

    await syncIssueForClass(
      {
        label: 'security-audit-blocking',
        title: 'Blocking security audit findings',
        isClean: false,
        bodyIfFindings: 'Found: example-critical-pkg (critical)',
        bodyIfClean: 'All clear.',
      },
      { runGh },
    );

    expect(calls).toEqual([
      ['issue', 'list', '--label', 'security-audit-blocking', '--state', 'open', '--json', 'number'],
      ['issue', 'comment', '42', '--body', 'Found: example-critical-pkg (critical)'],
    ]);
  });

  it('closes the existing open issue when the current run is clean', async () => {
    const calls = [];
    const runGh = vi.fn(async (args) => {
      calls.push(args);
      if (args[0] === 'issue' && args[1] === 'list') return '[{"number": 7}]';
      return '';
    });

    await syncIssueForClass(
      {
        label: 'security-audit-blocking',
        title: 'Blocking security audit findings',
        isClean: true,
        bodyIfFindings: 'Found: example-critical-pkg (critical)',
        bodyIfClean: 'All clear.',
      },
      { runGh },
    );

    expect(calls).toEqual([
      ['issue', 'list', '--label', 'security-audit-blocking', '--state', 'open', '--json', 'number'],
      ['issue', 'close', '7', '--comment', 'All clear.'],
    ]);
  });

  it('does nothing when the run is clean and there is no open issue', async () => {
    const calls = [];
    const runGh = vi.fn(async (args) => {
      calls.push(args);
      if (args[0] === 'issue' && args[1] === 'list') return '[]';
      return '';
    });

    await syncIssueForClass(
      {
        label: 'security-audit-blocking',
        title: 'Blocking security audit findings',
        isClean: true,
        bodyIfFindings: 'Found: example-critical-pkg (critical)',
        bodyIfClean: 'All clear.',
      },
      { runGh },
    );

    expect(calls).toEqual([
      ['issue', 'list', '--label', 'security-audit-blocking', '--state', 'open', '--json', 'number'],
    ]);
  });
});
