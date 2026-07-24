// src/languages/packs/powershell.test.ts
import { describe, it, expect } from 'vitest';
import { powershellPack } from './powershell';

describe('powershellPack.validateProjectName', () => {
  it.each(['MyTool', 'Task', 'HelloWorld123'])('accepts PascalCase name "%s"', (name) => {
    expect(powershellPack.validateProjectName(name)).toBeUndefined();
  });

  it.each(['myTool', 'my-tool', '123Tool', ''])('rejects invalid name "%s"', (name) => {
    expect(powershellPack.validateProjectName(name)).toBeDefined();
  });
});

describe('powershellPack scaffold setup', () => {
  it('installs the three required modules via scaffoldCommands', () => {
    expect(powershellPack.scaffoldCommands).toHaveLength(1);
    expect(powershellPack.scaffoldCommands[0].command).toBe('pwsh');
    expect(powershellPack.scaffoldCommands[0].args.join(' ')).toContain('PSFramework,Pester,Microsoft.PowerShell.PSResourceGet');
  });
});
