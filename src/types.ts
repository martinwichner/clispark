// src/types.ts
import type { NameCheckResult } from './registry';

export type Profile = 'work' | 'private';

export interface WizardAnswers {
  projectName: string;
  profile: Profile;
  registryUrl: string;
  publishIntent: boolean;
  nameAvailability: NameCheckResult;
}
