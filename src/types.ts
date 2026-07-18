// src/types.ts
import type { NameCheckResult } from './languages/registry-checker';

export type Profile = 'work' | 'private';

export interface WizardAnswers {
  language: string;
  projectName: string;
  profile: Profile;
  registryUrl: string;
  publishIntent: boolean;
  nameAvailability: NameCheckResult;
}
