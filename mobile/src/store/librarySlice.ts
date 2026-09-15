import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { LocalTrack, PlayableTrack } from '../types/music';
import { acceptsLibraryRevision, projectLibrarySnapshot } from '../library/libraryProjection';
import type { LibraryMutationReceipt, LibrarySnapshot } from '../library/types';

export type LibraryPlaylist = { id: string; title: string; tracks: PlayableTrack[] };

/** Redux is a read-only projection of Room, never a second durable backend. */
export type LibraryState = {
  revision?: number;
  hydrated?: boolean;
  hydrationPending?: boolean;
  hydrationError?: 'NATIVE_UNAVAILABLE' | 'TIMEOUT' | 'INVALID_RESPONSE' | null;
  pendingRequestIds?: string[];
  favorites: PlayableTrack[];
  recentTracks: PlayableTrack[];
  playlists: LibraryPlaylist[];
  localTracks: LocalTrack[];
  remoteCollections?: NonNullable<LibrarySnapshot['remoteCollections']>;
  queueCheckpoint?: NonNullable<LibrarySnapshot['queueCheckpoint']>;
  lyricMetadata?: NonNullable<LibrarySnapshot['lyricMetadata']>;
};

const initialState: LibraryState = {
  revision: 0,
  hydrated: false,
  hydrationPending: false,
  hydrationError: null,
  pendingRequestIds: [],
  favorites: [],
  recentTracks: [],
  playlists: [],
  localTracks: [],
  remoteCollections: [],
  queueCheckpoint: [],
  lyricMetadata: [],
};

function applySnapshot(state: LibraryState, snapshot: LibrarySnapshot) {
  if (!acceptsLibraryRevision(state.revision || 0, snapshot.revision)) return;
  const projection = projectLibrarySnapshot(snapshot);
  state.revision = projection.revision;
  state.hydrated = projection.hydrated;
  state.favorites = projection.favorites;
  state.recentTracks = projection.recentTracks;
  state.playlists = projection.playlists;
  state.localTracks = projection.localTracks;
  state.remoteCollections = projection.remoteCollections;
  state.queueCheckpoint = projection.queueCheckpoint;
  state.lyricMetadata = projection.lyricMetadata;
}

const librarySlice = createSlice({
  name: 'library',
  initialState,
  reducers: {
    hydrationStarted(state) {
      state.hydrationPending = true;
      state.hydrationError = null;
    },
    hydrationSucceeded(state, action: PayloadAction<LibrarySnapshot>) {
      applySnapshot(state, action.payload);
      state.hydrationPending = false;
      state.hydrationError = null;
    },
    hydrationFailed(state, action: PayloadAction<LibraryState['hydrationError']>) {
      state.hydrationPending = false;
      state.hydrationError = action.payload || 'INVALID_RESPONSE';
    },
    mutationPending(state, action: PayloadAction<{ requestId: string }>) {
      if (!state.pendingRequestIds?.includes(action.payload.requestId)) state.pendingRequestIds = [...(state.pendingRequestIds || []), action.payload.requestId];
    },
    mutationReceived(state, action: PayloadAction<LibraryMutationReceipt>) {
      state.pendingRequestIds = (state.pendingRequestIds || []).filter(requestId => requestId !== action.payload.requestId);
      if (action.payload.snapshot) applySnapshot(state, action.payload.snapshot);
    },
    historyProjectionReceived(state, action: PayloadAction<PlayableTrack[]>) {
      // Recent rows are a disposable native-ledger projection, never a persisted
      // library authority.  Keep first-seen order and semantic identity only.
      const seen = new Set<string>();
      state.recentTracks = action.payload.filter(track => {
        const key = `${track.source}:${track.id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }).slice(0, 100);
    },
    continuityLyricMetadataObserved(state, action: PayloadAction<NonNullable<LibrarySnapshot['lyricMetadata']>[number]>) {
      const current = state.lyricMetadata || [];
      state.lyricMetadata = [
        ...current.filter(item => !(item.source === action.payload.source && item.trackId === action.payload.trackId)),
        action.payload,
      ];
    },
    continuityLyricMetadataRemoved(state, action: PayloadAction<{ source: string; trackId: string }>) {
      state.lyricMetadata = (state.lyricMetadata || []).filter(item => !(item.source === action.payload.source && item.trackId === action.payload.trackId));
    },
    toggleFavorite(_state, _action: PayloadAction<PlayableTrack>) {},
    recordRecent(_state, _action: PayloadAction<PlayableTrack>) {},
    clearRecent() {},
    importLocalTracks(_state, _action: PayloadAction<LocalTrack[]>) {},
    removeLocalTrack(_state, _action: PayloadAction<string>) {},
    markLocalTrackNeedsRepair(_state, _action: PayloadAction<string>) {},
    restoreLibrary(_state, _action: PayloadAction<{ favorites: PlayableTrack[]; playlists: LibraryPlaylist[] }>) {},
    createPlaylist(_state, _action: PayloadAction<{ id: string; title: string }>) {},
    deletePlaylist(_state, _action: PayloadAction<string>) {},
    addTrackToPlaylist(_state, _action: PayloadAction<{ playlistId: string; track: PlayableTrack }>) {},
    removeTrackFromPlaylist(_state, _action: PayloadAction<{ playlistId: string; track: PlayableTrack }>) {},
  },
});

export const {
  addTrackToPlaylist,
  clearRecent,
  createPlaylist,
  continuityLyricMetadataObserved,
  continuityLyricMetadataRemoved,
  deletePlaylist,
  hydrationFailed,
  historyProjectionReceived,
  hydrationStarted,
  hydrationSucceeded,
  importLocalTracks,
  markLocalTrackNeedsRepair,
  mutationPending,
  mutationReceived,
  recordRecent,
  removeLocalTrack,
  removeTrackFromPlaylist,
  restoreLibrary,
  toggleFavorite,
} = librarySlice.actions;
export default librarySlice.reducer;
