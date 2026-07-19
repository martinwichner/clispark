// src/languages/packs/dotnet.test.ts
import { describe, it, expect } from 'vitest';
import { dotnetPack } from './dotnet';

describe('dotnetPack.validateProjectName', () => {
  it('accepts a PascalCase name', () => {
    expect(dotnetPack.validateProjectName('MyTool')).toBeUndefined();
  });

  it('accepts a single-word PascalCase name', () => {
    expect(dotnetPack.validateProjectName('Tool')).toBeUndefined();
  });

  it('rejects a lowercase name', () => {
    expect(dotnetPack.validateProjectName('mytool')).toBeDefined();
  });

  it('rejects a name with a hyphen', () => {
    expect(dotnetPack.validateProjectName('my-tool')).toBeDefined();
  });

  it('rejects an empty name', () => {
    expect(dotnetPack.validateProjectName('')).toBeDefined();
  });

  it('rejects a name starting with a digit', () => {
    expect(dotnetPack.validateProjectName('1Tool')).toBeDefined();
  });
});

describe('dotnetPack.scaffoldCommands', () => {
  it('runs dotnet restore then dotnet build', () => {
    expect(dotnetPack.scaffoldCommands).toEqual([
      { command: 'dotnet', args: ['restore'] },
      { command: 'dotnet', args: ['build'] },
    ]);
  });
});

describe('dotnetPack basic shape', () => {
  it('has id "dotnet" and a display name', () => {
    expect(dotnetPack.id).toBe('dotnet');
    expect(dotnetPack.displayName).toContain('.NET');
  });

  it('points templateDir at templates/dotnet', () => {
    expect(dotnetPack.templateDir).toContain('templates');
    expect(dotnetPack.templateDir).toContain('dotnet');
  });
});
