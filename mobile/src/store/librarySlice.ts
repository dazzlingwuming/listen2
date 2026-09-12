import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { Track } from '../types/music';

const MAX_RECENT_TRACKS = 200;

export type LibraryState = {
  favorites: Track[];
  recentTracks: Track[];
  playlists: { id: string; title: string; tracks: Track[] }[];
};

const initialState: LibraryState = {
  favorites: [],
  recentTracks: [],
  playlists: [],
};

function sameTrack(left: Track, right: Track) {
  return left.id === right.id && left.source === right.source;
}

const librarySlice = createSlice({
  name: 'library',
  initialState,
  reducers: {
    toggleFavorite(state, action: PayloadAction<Track>) {
      const index = state.favorites.findIndex(track =>
        sameTrack(track, action.payload),
      );
      if (index >= 0) state.favorites.splice(index, 1);
      else state.favorites.unshift(action.payload);
    },
    recordRecent(state, action: PayloadAction<Track>) {
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
      action: PayloadAction<{ playlistId: string; track: Track }>,
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
      action: PayloadAction<{ playlistId: string; track: Track }>,
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
  removeTrackFromPlaylist,
  toggleFavorite,
} = librarySlice.actions;
export default librarySlice.reducer;
