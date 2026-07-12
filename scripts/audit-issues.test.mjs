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
  it('returns zero counts and empty finding lists for a clean audit', async () => {
    const report = await loadFixture('audit-clean.json');

    const result = categorizeFindings(report);

    expect(result).toEqual({
      blocking: { count: 0, findings: [] },
      informational: { count: 0, findings: [] },
    });
  });

  it('buckets critical/high as blocking and moderate/low as informational, with advisory detail', async () => {
    const report = await loadFixture('audit-with-findings.json');

    const result = categorizeFindings(report);

    expect(result.blocking.count).toBe(1);
    expect(result.blocking.findings).toEqual([
      {
        name: 'example-critical-pkg',
        severity: 'critical',
        range: '<1.0.0',
        fixAvailable: true,
        advisoryTitle: 'Prototype Pollution in example-critical-pkg',
        advisoryUrl: 'https://github.com/advisories/GHSA-xxxx-xxxx-xxxx',
      },
    ]);

    expect(result.informational.count).toBe(1);
    expect(result.informational.findings).toEqual([
      {
        name: 'example-moderate-pkg',
        severity: 'moderate',
        range: '<2.0.0',
        fixAvailable: false,
        advisoryTitle: undefined,
        advisoryUrl: undefined,
      },
    ]);
  });
});

describe('syncIssueForClass', () => {
  const finding = {
    name: 'example-critical-pkg',
    severity: 'critical',
    range: '<1.0.0',
    fixAvailable: true,
    advisoryTitle: 'Prototype Pollution in example-critical-pkg',
    advisoryUrl: 'https://github.com/advisories/GHSA-xxxx-xxxx-xxxx',
  };
  const otherFinding = {
    name: 'example-other-pkg',
    severity: 'high',
    range: '<3.0.0',
    fixAvailable: false,
    advisoryTitle: undefined,
    advisoryUrl: undefined,
  };

  function makeRunGh(responses) {
    const calls = [];
    const runGh = vi.fn(async (args) => {
      calls.push(args);
      if (args[0] === 'issue' && args[1] === 'list') return responses.list ?? '[]';
      if (args[0] === 'issue' && args[1] === 'view') return responses.view ?? '{"body":""}';
      return '';
    });
    return { runGh, calls };
  }

  it('creates a new issue with a state marker when findings exist and no open issue is found', async () => {
    const { runGh, calls } = makeRunGh({ list: '[]' });

    await syncIssueForClass(
      {
        label: 'security-audit-blocking',
        title: 'Blocking security audit findings',
        findings: [finding],
        runUrl: 'https://example.com/run/1',
        bodyIfClean: 'All clear.',
      },
      { runGh },
    );

    expect(calls[0]).toEqual([
      'issue',
      'list',
      '--label',
      'security-audit-blocking',
      '--state',
      'open',
      '--json',
      'number',
    ]);
    expect(calls[1][0]).toBe('issue');
    expect(calls[1][1]).toBe('create');
    const body = calls[1][calls[1].indexOf('--body') + 1];
    expect(body).toContain('example-critical-pkg');
    expect(body).toContain('Prototype Pollution in example-critical-pkg');
    expect(body).toContain('https://github.com/advisories/GHSA-xxxx-xxxx-xxxx');
    expect(body).toContain('Fix available: yes');
    expect(body).toContain('<!-- audit-issues:state:{"example-critical-pkg":"critical"} -->');
    expect(calls).toHaveLength(2);
  });

  it('does nothing beyond checking state when findings are unchanged since the last run', async () => {
    const previousBody =
      'example-critical-pkg (critical)\n\n<!-- audit-issues:state:{"example-critical-pkg":"critical"} -->';
    const { runGh, calls } = makeRunGh({
      list: '[{"number": 42}]',
      view: JSON.stringify({ body: previousBody }),
    });

    await syncIssueForClass(
      {
        label: 'security-audit-blocking',
        title: 'Blocking security audit findings',
        findings: [finding],
        runUrl: 'https://example.com/run/2',
        bodyIfClean: 'All clear.',
      },
      { runGh },
    );

    expect(calls).toEqual([
      ['issue', 'list', '--label', 'security-audit-blocking', '--state', 'open', '--json', 'number'],
      ['issue', 'view', '42', '--json', 'body'],
    ]);
  });

  it('treats every current finding as new when the existing issue predates the state marker', async () => {
    const previousBody = 'example-critical-pkg (critical)\n\nFrom: https://example.com/run/old';
    const { runGh, calls } = makeRunGh({
      list: '[{"number": 42}]',
      view: JSON.stringify({ body: previousBody }),
    });

    await syncIssueForClass(
      {
        label: 'security-audit-blocking',
        title: 'Blocking security audit findings',
        findings: [finding],
        runUrl: 'https://example.com/run/2b',
        bodyIfClean: 'All clear.',
      },
      { runGh },
    );

    expect(calls[2][0]).toBe('issue');
    expect(calls[2][1]).toBe('edit');
    expect(calls[2][2]).toBe('42');
    expect(calls[2][calls[2].indexOf('--body') + 1]).toContain('example-critical-pkg');
    expect(calls[3]).toEqual(['issue', 'comment', '42', '--body', 'New: example-critical-pkg']);
  });

  it('reports a severity change as "Severity changed", not "New"', async () => {
    const previousBody =
      'example-critical-pkg (high)\n\n<!-- audit-issues:state:{"example-critical-pkg":"high"} -->';
    const { runGh, calls } = makeRunGh({
      list: '[{"number": 42}]',
      view: JSON.stringify({ body: previousBody }),
    });

    await syncIssueForClass(
      {
        label: 'security-audit-blocking',
        title: 'Blocking security audit findings',
        findings: [finding],
        runUrl: 'https://example.com/run/2c',
        bodyIfClean: 'All clear.',
      },
      { runGh },
    );

    expect(calls[3]).toEqual(['issue', 'comment', '42', '--body', 'Severity changed: example-critical-pkg']);
  });

  it('edits the issue body and comments only the new finding when a finding is added', async () => {
    const previousBody =
      'example-critical-pkg (critical)\n\n<!-- audit-issues:state:{"example-critical-pkg":"critical"} -->';
    const { runGh, calls } = makeRunGh({
      list: '[{"number": 42}]',
      view: JSON.stringify({ body: previousBody }),
    });

    await syncIssueForClass(
      {
        label: 'security-audit-blocking',
        title: 'Blocking security audit findings',
        findings: [finding, otherFinding],
        runUrl: 'https://example.com/run/3',
        bodyIfClean: 'All clear.',
      },
      { runGh },
    );

    expect(calls[2][0]).toBe('issue');
    expect(calls[2][1]).toBe('edit');
    expect(calls[2][2]).toBe('42');
    const editedBody = calls[2][calls[2].indexOf('--body') + 1];
    expect(editedBody).toContain('example-other-pkg');
    expect(editedBody).toContain(
      '<!-- audit-issues:state:{"example-critical-pkg":"critical","example-other-pkg":"high"} -->',
    );

    expect(calls[3]).toEqual(['issue', 'comment', '42', '--body', 'New: example-other-pkg']);
    expect(calls).toHaveLength(4);
  });

  it('edits the issue body and comments only the resolved finding when a finding disappears', async () => {
    const previousBody =
      'two findings\n\n<!-- audit-issues:state:{"example-critical-pkg":"critical","example-other-pkg":"high"} -->';
    const { runGh, calls } = makeRunGh({
      list: '[{"number": 42}]',
      view: JSON.stringify({ body: previousBody }),
    });

    await syncIssueForClass(
      {
        label: 'security-audit-blocking',
        title: 'Blocking security audit findings',
        findings: [finding],
        runUrl: 'https://example.com/run/4',
        bodyIfClean: 'All clear.',
      },
      { runGh },
    );

    expect(calls[3]).toEqual(['issue', 'comment', '42', '--body', 'Resolved: example-other-pkg']);
  });

  it('closes the existing open issue when the current run is clean', async () => {
    const { runGh, calls } = makeRunGh({ list: '[{"number": 7}]' });

    await syncIssueForClass(
      {
        label: 'security-audit-blocking',
        title: 'Blocking security audit findings',
        findings: [],
        runUrl: 'https://example.com/run/5',
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
    const { runGh, calls } = makeRunGh({ list: '[]' });

    await syncIssueForClass(
      {
        label: 'security-audit-blocking',
        title: 'Blocking security audit findings',
        findings: [],
        runUrl: 'https://example.com/run/6',
        bodyIfClean: 'All clear.',
      },
      { runGh },
    );

    expect(calls).toEqual([
      ['issue', 'list', '--label', 'security-audit-blocking', '--state', 'open', '--json', 'number'],
    ]);
  });
});
