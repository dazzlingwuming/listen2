// Stable screen-facing import path. Keep the domain model transport-free.
export type {
  BootstrapTrack,
  Lyric,
  PlaylistDetail,
  PlaylistSummary,
  SearchPage,
  SearchResult,
  SearchKind,
  SourceId,
  Track,
} from './provider';
export { isSourceId, SOURCE_IDS } from './provider';

import type { Track } from './provider';

/**
 * A user-selected audio document. Its content URI is deliberately kept out of
 * the provider contract: it is only playable by the native player after the
 * Android document picker has granted persistable access.
 */
export type LocalTrack = {
  id: string;
  source: 'local';
  title: string;
  artist: string;
  album?: string;
  durationMs?: number;
  artworkUrl?: string;
  contentUri: string;
  fileName: string;
  mimeType?: string;
  bookmark?: string;
  accessStatus?: 'available' | 'needs-repair' | 'revoked';
};

export type PlayableTrack = Track | LocalTrack;

export function isLocalTrack(value: unknown): value is LocalTrack {
  if (!value || typeof value !== 'object') return false;
  const track = value as Partial<LocalTrack>;
  return (
    track.source === 'local' &&
    typeof track.contentUri === 'string' &&
    track.contentUri.startsWith('content://') &&
    track.contentUri.length <= 4096 &&
    !track.contentUri.includes('\r') &&
    !track.contentUri.includes('\n')
  );
}
