import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { LocalTrack, PlayableTrack } from '../types/music';

const MAX_RECENT_TRACKS = 200;
const MAX_LOCAL_TRACKS = 5000;

export type LibraryState = {
  favorites: PlayableTrack[];
  recentTracks: PlayableTrack[];
  playlists: LibraryPlaylist[];
  localTracks: LocalTrack[];
};

export type LibraryPlaylist = {
  id: string;
  title: string;
  tracks: PlayableTrack[];
};

const initialState: LibraryState = {
  favorites: [],
  recentTracks: [],
  playlists: [],
  localTracks: [],
};

function sameTrack(left: PlayableTrack, right: PlayableTrack) {
  return left.id === right.id && left.source === right.source;
}

const librarySlice = createSlice({
  name: 'library',
  initialState,
  reducers: {
    toggleFavorite(state, action: PayloadAction<PlayableTrack>) {
      const index = state.favorites.findIndex(track =>
        sameTrack(track, action.payload),
      );
      if (index >= 0) state.favorites.splice(index, 1);
      else state.favorites.unshift(action.payload);
    },
    recordRecent(state, action: PayloadAction<PlayableTrack>) {
      state.recentTracks = [
        action.payload,
        ...state.recentTracks.filter(
          track => !sameTrack(track, action.payload),
        ),
      ].slice(0, MAX_RECENT_TRACKS);
    },
    clearRecent(state) {
      state.recentTracks = [];
    },
    importLocalTracks(state, action: PayloadAction<LocalTrack[]>) {
      action.payload.slice(0, 500).forEach(track => {
        if (!track.contentUri) return;
        const existing = state.localTracks.find(
          item => item.contentUri === track.contentUri,
        );
        if (existing) {
          // Re-selecting a repaired document refreshes metadata and access.
          Object.assign(existing, track, {
            id: existing.id,
            accessStatus: 'available',
          });
          return;
        }
        if (
          state.localTracks.length >= MAX_LOCAL_TRACKS ||
          state.localTracks.some(item => item.id === track.id)
        )
          return;
        state.localTracks.push(track);
      });
    },
    removeLocalTrack(state, action: PayloadAction<string>) {
      state.localTracks = state.localTracks.filter(
        track => track.id !== action.payload,
      );
      // Local tracks can also appear in favorites, history, and a user playlist
      // during this session. Remove those dangling references with the library
      // record so a released content URI is never offered for playback again.
      state.favorites = state.favorites.filter(
        track => track.id !== action.payload,
      );
      state.recentTracks = state.recentTracks.filter(
        track => track.id !== action.payload,
      );
      state.playlists.forEach(playlist => {
        playlist.tracks = playlist.tracks.filter(
          track => track.id !== action.payload,
        );
      });
    },
    markLocalTrackNeedsRepair(state, action: PayloadAction<string>) {
      const track = state.localTracks.find(item => item.id === action.payload);
      if (track) track.accessStatus = 'needs-repair';
    },
    restoreLibrary(
      state,
      action: PayloadAction<{
        favorites: PlayableTrack[];
        playlists: LibraryPlaylist[];
      }>,
    ) {
      // Backup validation happens before this action is dispatched.  Copy the
      // arrays so the persisted slice never retains references to modal state.
      state.favorites = action.payload.favorites.slice();
      state.playlists = action.payload.playlists.map(playlist => ({
        ...playlist,
        tracks: playlist.tracks.slice(),
      }));
    },
    createPlaylist(
      state,
      action: PayloadAction<{ id: string; title: string }>,
    ) {
      const title = action.payload.title.trim().slice(0, 80);
      if (!title || state.playlists.some(item => item.id === action.payload.id))
        return;
      state.playlists.unshift({ id: action.payload.id, title, tracks: [] });
    },
    deletePlaylist(state, action: PayloadAction<string>) {
      state.playlists = state.playlists.filter(
        item => item.id !== action.payload,
      );
    },
    addTrackToPlaylist(
      state,
      action: PayloadAction<{ playlistId: string; track: PlayableTrack }>,
    ) {
      const playlist = state.playlists.find(
        item => item.id === action.payload.playlistId,
      );
      if (
        !playlist ||
        playlist.tracks.some(track => sameTrack(track, action.payload.track))
      )
        return;
      playlist.tracks.push(action.payload.track);
    },
    removeTrackFromPlaylist(
      state,
      action: PayloadAction<{ playlistId: string; track: PlayableTrack }>,
    ) {
      const playlist = state.playlists.find(
        item => item.id === action.payload.playlistId,
      );
      if (!playlist) return;
      playlist.tracks = playlist.tracks.filter(
        track => !sameTrack(track, action.payload.track),
      );
    },
  },
});

export const {
  addTrackToPlaylist,
  clearRecent,
  createPlaylist,
  deletePlaylist,
  recordRecent,
  importLocalTracks,
  markLocalTrackNeedsRepair,
  removeLocalTrack,
  removeTrackFromPlaylist,
  restoreLibrary,
  toggleFavorite,
} = librarySlice.actions;
export default librarySlice.reducer;
