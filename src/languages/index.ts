// src/languages/index.ts
import type { LanguagePack } from './pack';
import { nodeOclifPack } from './packs/node-oclif';
import { dotnetPack } from './packs/dotnet';
import { powershellPack } from './packs/powershell';
import { pythonPack } from './packs/python';

export const LANGUAGE_PACKS: Record<string, LanguagePack> = {
  [nodeOclifPack.id]: nodeOclifPack,
  [dotnetPack.id]: dotnetPack,
  [powershellPack.id]: powershellPack,
  [pythonPack.id]: pythonPack,
};

export function getPackById(id: string): LanguagePack | undefined {
  return LANGUAGE_PACKS[id];
}
