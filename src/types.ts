// src/types.ts
import type { NameCheckResult } from './registry.js';

export type Profile = 'work' | 'private';

export interface WizardAnswers {
  projectName: string;
  profile: Profile;
  registryUrl: string;
  nameAvailability: NameCheckResult;
}

const _branchProtectionTestUnusedVar = 1;
