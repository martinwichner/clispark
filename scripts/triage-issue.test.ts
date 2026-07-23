import { describe, it, expect } from 'vitest';
import { determineAreaLabel, hasAreaLabel, triageIssue } from './triage-issue';

describe('determineAreaLabel', () => {
  it('recognizes "node" from the rendered Area field', () => {
    const body = '### Area\n\nnode\n';
    expect(determineAreaLabel(body)).toBe('area:node');
  });

  it('recognizes "dotnet" when other fields precede it', () => {
    const body = '### Problem / Motivation\n\nSomething broke.\n\n### Area\n\ndotnet\n';
    expect(determineAreaLabel(body)).toBe('area:dotnet');
  });

  it('recognizes "generator"', () => {
    const body = '### Area\n\ngenerator\n';
    expect(determineAreaLabel(body)).toBe('area:generator');
  });

  it('falls back to needs-triage for "not sure"', () => {
    const body = '### Area\n\nnot sure\n';
    expect(determineAreaLabel(body)).toBe('needs-triage');
  });

  it('falls back to needs-triage when the Area field is missing entirely (non-form issue)', () => {
    const body = 'Just a plain issue with no form structure, e.g. created via `gh issue create`.';
    expect(determineAreaLabel(body)).toBe('needs-triage');
  });

  it('falls back to needs-triage for an empty or undefined body', () => {
    expect(determineAreaLabel(undefined)).toBe('needs-triage');
    expect(determineAreaLabel(null)).toBe('needs-triage');
    expect(determineAreaLabel('')).toBe('needs-triage');
  });

  it('is case-insensitive on the selected value', () => {
    const body = '### Area\n\nNode\n';
    expect(determineAreaLabel(body)).toBe('area:node');
  });
});

describe('hasAreaLabel', () => {
  it('detects an existing area:* label', () => {
    expect(hasAreaLabel(['type:feature', 'area:generator'])).toBe(true);
  });

  it('returns false when no area:* label is present', () => {
    expect(hasAreaLabel(['type:feature', 'status:backlog'])).toBe(false);
  });

  it('returns false for an empty label list', () => {
    expect(hasAreaLabel([])).toBe(false);
  });
});

describe('triageIssue', () => {
  it('applies the determined label via gh issue edit', async () => {
    const calls: string[][] = [];
    const runGh = async (args: string[]) => {
      calls.push(args);
      return '';
    };

    const label = await triageIssue('42', '### Area\n\ngenerator\n', [], { runGh });

    expect(label).toBe('area:generator');
    expect(calls).toEqual([['issue', 'edit', '42', '--add-label', 'area:generator']]);
  });

  it('applies needs-triage when the area cannot be determined', async () => {
    const calls: string[][] = [];
    const runGh = async (args: string[]) => {
      calls.push(args);
      return '';
    };

    const label = await triageIssue('7', 'no form structure here', [], { runGh });

    expect(label).toBe('needs-triage');
    expect(calls).toEqual([['issue', 'edit', '7', '--add-label', 'needs-triage']]);
  });

  it('skips entirely when the issue already carries an area:* label (e.g. maintainer-created via gh issue create)', async () => {
    const calls: string[][] = [];
    const runGh = async (args: string[]) => {
      calls.push(args);
      return '';
    };

    const label = await triageIssue('89', 'no form structure here', ['type:feature', 'area:node'], { runGh });

    expect(label).toBeNull();
    expect(calls).toEqual([]);
  });
});
