export type ReconcileOutcome = 'added' | 'replaced' | 'skipped';

export interface ReconcileResult<T> {
  outcome: ReconcileOutcome;
  value: T;
}

export function reconcileEntry<T>(
  currentLiveValue: T | undefined,
  oldManifestValue: T | undefined,
  newTemplateValue: T,
  isEqual: (a: T, b: T) => boolean,
): ReconcileResult<T> {
  if (currentLiveValue === undefined) {
    return { outcome: 'added', value: newTemplateValue };
  }
  if (oldManifestValue !== undefined && isEqual(currentLiveValue, oldManifestValue)) {
    return { outcome: 'replaced', value: newTemplateValue };
  }
  return { outcome: 'skipped', value: oldManifestValue ?? currentLiveValue };
}

export function stringEquals(a: string, b: string): boolean {
  return a === b;
}

export function deepEquals(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
