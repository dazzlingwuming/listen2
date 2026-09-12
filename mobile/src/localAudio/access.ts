import { releaseLongTermAccess } from '@react-native-documents/picker';
import type { LocalTrack } from '../types/music';

/**
 * Releasing access is cleanup only. Callers must remove the track first and
 * never surface a cleanup failure as a failed deletion.
 */
export async function releaseLocalAudioAccess(
  track: LocalTrack,
): Promise<void> {
  try {
    await releaseLongTermAccess([track.contentUri]);
  } catch {
    // Android providers may already have revoked an URI. The local library
    // deletion remains complete either way, and URI values are never logged.
  }
}
