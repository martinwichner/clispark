// src/languages/index.ts
import type { LanguagePack } from './pack';
import { nodeOclifPack } from './packs/node-oclif';

export const LANGUAGE_PACKS: Record<string, LanguagePack> = {
  [nodeOclifPack.id]: nodeOclifPack,
};

export function getPackById(id: string): LanguagePack | undefined {
  return LANGUAGE_PACKS[id];
}
