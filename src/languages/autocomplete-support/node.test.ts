import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { stripAutocompleteSupport, withoutAutocompletePlugin } from './node';

describe('withoutAutocompletePlugin', () => {
  it('removes the plugin entry from a plugins array, leaving other entries intact', () => {
    const result = withoutAutocompletePlugin({ bin: 'my-cli', plugins: ['@oclif/plugin-help', '@oclif/plugin-autocomplete'] });
    expect(result).toEqual({ bin: 'my-cli', plugins: ['@oclif/plugin-help'] });
  });

  it('returns the input unchanged when plugins is absent', () => {
    const input = { bin: 'my-cli' };
    expect(withoutAutocompletePlugin(input)).toBe(input);
  });

  it('returns the input unchanged when oclif itself is undefined', () => {
    expect(withoutAutocompletePlugin(undefined)).toBeUndefined();
  });

  it('does not mutate the original object', () => {
    const input = { bin: 'my-cli', plugins: ['@oclif/plugin-help', '@oclif/plugin-autocomplete'] };
    withoutAutocompletePlugin(input);
    expect(input.plugins).toEqual(['@oclif/plugin-help', '@oclif/plugin-autocomplete']);
  });
});

describe('stripAutocompleteSupport', () => {
  let targetDir: string;

  beforeEach(async () => {
    targetDir = await mkdtemp(path.join(tmpdir(), 'clispark-strip-autocomplete-test-'));
    await writeFile(
      path.join(targetDir, 'package.json'),
      JSON.stringify({
        dependencies: {
          '@oclif/core': '^4.0.0',
          '@oclif/plugin-autocomplete': '^3.2.53',
          '@oclif/plugin-help': '^6.0.0',
        },
        oclif: {
          bin: 'my-cli',
          plugins: ['@oclif/plugin-help', '@oclif/plugin-autocomplete'],
        },
      }),
    );
  });

  afterEach(async () => {
    await rm(targetDir, { recursive: true, force: true });
  });

  it('removes the autocomplete dependency and plugins entry, keeps everything else', async () => {
    await stripAutocompleteSupport(targetDir);
    const pkg = JSON.parse(await readFile(path.join(targetDir, 'package.json'), 'utf8'));
    expect(pkg.dependencies).toEqual({ '@oclif/core': '^4.0.0', '@oclif/plugin-help': '^6.0.0' });
    expect(pkg.oclif.plugins).toEqual(['@oclif/plugin-help']);
    expect(pkg.oclif.bin).toBe('my-cli');
  });
});
