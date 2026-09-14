import type { DeepSeekConsent } from './types';

export type DeepSeekConsentChoices = Omit<DeepSeekConsent, 'acceptedAtEpochMs'>;

/** Per-request receipt only. Callers keep this in component state and never persist it. */
export function createDeepSeekConsent(
  choices: DeepSeekConsentChoices,
  acceptedAtEpochMs = Date.now(),
): DeepSeekConsent {
  return Object.freeze({ ...choices, acceptedAtEpochMs });
}

export function hasCompleteDeepSeekConsent(
  value: unknown,
): value is DeepSeekConsent {
  if (!isRecord(value) || !hasExactKeys(value, CONSENT_KEYS)) return false;
  return (
    value.lyrics === true &&
    value.title === true &&
    value.artist === true &&
    value.possibleCost === true &&
    value.cancellation === true &&
    value.failureImpact === true &&
    typeof value.acceptedAtEpochMs === 'number' &&
    Number.isSafeInteger(value.acceptedAtEpochMs) &&
    value.acceptedAtEpochMs > 0
  );
}

const CONSENT_KEYS = new Set([
  'lyrics',
  'title',
  'artist',
  'possibleCost',
  'cancellation',
  'failureImpact',
  'acceptedAtEpochMs',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: Set<string>,
): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.size && actual.every(key => keys.has(key));
}
