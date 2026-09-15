import type { LocalTrack, PlayableTrack } from '../types/music';
import type { LibrarySnapshot } from './types';

export type LibraryProjection = {
  revision: number;
  hydrated: boolean;
  favorites: PlayableTrack[];
  recentTracks: PlayableTrack[];
  playlists: Array<{ id: string; title: string; tracks: PlayableTrack[] }>;
  localTracks: LocalTrack[];
};

/**
 * Converts the fixed native DTO to the screen-facing shape without inventing
 * client ownership. Unsupported library categories deliberately remain empty.
 */
export function projectLibrarySnapshot(snapshot: LibrarySnapshot): LibraryProjection {
  const localById = new Map(snapshot.localRecords.map(record => [record.recordId, record]));
  const projectTrack = (track: LibrarySnapshot['favorites'][number]): PlayableTrack => {
    if (track.source !== 'local') return { id: track.trackId, source: track.source, title: track.title, artist: track.artist };
    const record = localById.get(track.trackId);
    return {
      id: track.trackId,
      source: 'local',
      title: record?.title || track.title,
      artist: record?.artist || track.artist,
      ...(record?.album ? { album: record.album } : {}),
      ...(record?.durationMs ? { durationMs: record.durationMs } : {}),
      accessStatus: record?.availability || 'needs-repair',
      lyricState: record?.lyricState || 'none',
      hasArtwork: record?.hasArtwork || false,
      capabilities: record?.capabilities || [],
      seekable: Boolean(record?.durationMs && record.durationMs > 0),
    };
  };
  return {
    revision: snapshot.revision,
    hydrated: true,
    favorites: snapshot.favorites.map(projectTrack),
    recentTracks: [],
    playlists: snapshot.personalPlaylists.map(playlist => ({
      id: playlist.playlistId,
      title: playlist.title,
      tracks: playlist.tracks.map(projectTrack),
    })),
    localTracks: snapshot.localRecords.map(record => ({
      id: record.recordId,
      source: 'local' as const,
      title: record.title,
      artist: record.artist,
      ...(record.album ? { album: record.album } : {}),
      ...(record.durationMs ? { durationMs: record.durationMs } : {}),
      accessStatus: record.availability,
      lyricState: record.lyricState,
      hasArtwork: record.hasArtwork,
      capabilities: record.capabilities,
      seekable: Boolean(record.durationMs && record.durationMs > 0),
    })),
  };
}

/** A later native snapshot must never be replaced by an older bridge reply. */
export function acceptsLibraryRevision(currentRevision: number, nextRevision: number) {
  return nextRevision >= currentRevision;
}
