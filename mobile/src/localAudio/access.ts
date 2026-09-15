import type { LocalTrack } from '../types/music';

/**
 * Releasing access is cleanup only. Callers must remove the track first and
 * never surface a cleanup failure as a failed deletion.
 */
export async function releaseLocalAudioAccess(
  _track: LocalTrack,
): Promise<void> {
  // The opaque record carries no URI or grant. A future native-only removal
  // capability releases its private grant atomically with the record.
}
