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
  /** Opaque native record ID; no content URI, path, grant or filename crosses JS. */
  hasArtwork?: boolean;
  lyricState?: 'none' | 'attached';
  capabilities?: Array<'playlist' | 'queue' | 'lyrics'>;
  seekable?: boolean;
  accessStatus?: 'available' | 'needs-repair' | 'revoked' | 'unreadable' | 'unsupported' | 'duplicate';
};

export type PlayableTrack = Track | LocalTrack;

export function isLocalTrack(value: unknown): value is LocalTrack {
  if (!value || typeof value !== 'object') return false;
  const track = value as Partial<LocalTrack>;
  return (
    track.source === 'local' &&
    typeof track.id === 'string' &&
    /^[A-Za-z0-9-]{16,64}$/.test(track.id) &&
    typeof track.title === 'string' && track.title.length > 0 && track.title.length <= 256 &&
    typeof track.artist === 'string' && track.artist.length > 0 && track.artist.length <= 256 &&
    ['available', 'needs-repair', 'revoked', 'unreadable', 'unsupported', 'duplicate', undefined].includes(track.accessStatus)
  );
}
