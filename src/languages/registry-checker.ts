export type NameCheckResult = 'available' | 'taken' | 'unverified' | 'skipped';

/**
 * Isolates how a language's package registry (npm, NuGet, ...) is queried
 * for name availability, and what "don't publish this" means for that
 * ecosystem's manifest file — from the generic wizard flow.
 */
export interface RegistryChecker {
  checkNameAvailability(name: string, registryUrl: string): Promise<NameCheckResult>;
  applyPrivateIntent(targetDir: string): Promise<void>;
  applyRegistryUrl(targetDir: string, registryUrl: string): Promise<void>;
}
