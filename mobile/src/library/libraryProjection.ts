import type { PlayableTrack } from '../types/music';
import type { LibrarySnapshot } from './types';

export type LibraryProjection = {
  revision: number;
  hydrated: boolean;
  favorites: PlayableTrack[];
  recentTracks: PlayableTrack[];
  playlists: Array<{ id: string; title: string; tracks: PlayableTrack[] }>;
  localTracks: [];
};

/**
 * Converts the fixed native DTO to the screen-facing shape without inventing
 * client ownership. Unsupported library categories deliberately remain empty.
 */
export function projectLibrarySnapshot(snapshot: LibrarySnapshot): LibraryProjection {
  return {
    revision: snapshot.revision,
    hydrated: true,
    favorites: snapshot.favorites.map(track => ({ id: track.trackId, source: track.source, title: track.title, artist: track.artist })),
    recentTracks: [],
    playlists: snapshot.personalPlaylists.map(playlist => ({
      id: playlist.playlistId,
      title: playlist.title,
      tracks: playlist.tracks.map(track => ({ id: track.trackId, source: track.source, title: track.title, artist: track.artist })),
    })),
    localTracks: [],
  };
}

/** A later native snapshot must never be replaced by an older bridge reply. */
export function acceptsLibraryRevision(currentRevision: number, nextRevision: number) {
  return nextRevision >= currentRevision;
}
