import { describe, it, expect } from 'vitest';
import { pythonPack } from './python';

describe('pythonPack.validateProjectName', () => {
  it.each(['my-tool', 'task', 'hello-world-123'])('accepts kebab-case name "%s"', (name) => {
    expect(pythonPack.validateProjectName(name)).toBeUndefined();
  });

  it.each(['MyTool', 'my_tool', '-my-tool', 'my--tool', ''])('rejects invalid name "%s"', (name) => {
    expect(pythonPack.validateProjectName(name)).toBeDefined();
  });
});

describe('pythonPack scaffold setup', () => {
  it('runs uv sync via scaffoldCommands', () => {
    expect(pythonPack.scaffoldCommands).toHaveLength(1);
    expect(pythonPack.scaffoldCommands[0].command).toBe('uv');
    expect(pythonPack.scaffoldCommands[0].args).toEqual(['sync']);
  });
});

describe('pythonPack v1 scope', () => {
  it('has all lean-v1 opt-in features permanently disabled', async () => {
    expect(pythonPack.supportsAutocompleteOptIn).toBe(false);
    await expect(pythonPack.stripLintTooling('/tmp/whatever')).resolves.toBeUndefined();
    await expect(pythonPack.stripAutocompleteSupport('/tmp/whatever')).resolves.toBeUndefined();
    await expect(pythonPack.stripCommandConvention('/tmp/whatever')).resolves.toBeUndefined();
  });
});

describe('pythonPack identity', () => {
  it('is identified as the python pack', () => {
    expect(pythonPack.id).toBe('python');
    expect(pythonPack.templateDir.replace(/\\/g, '/')).toMatch(/templates\/python$/);
  });
});
