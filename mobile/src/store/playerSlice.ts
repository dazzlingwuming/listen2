import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { Track } from '../types/music';
import { playerController } from '../player/playerController';

/**
 * Keep these numeric values compatible with listen1_mobile.  They are stored,
 * so changing their order would make a restored player choose a different mode.
 */
export const PLAY_MODE = Object.freeze({
  LOOP: 0,
  SHUFFLE: 1,
  REPEAT_ONE: 2,
} as const);

export type PlayMode = (typeof PLAY_MODE)[keyof typeof PLAY_MODE];
export type PlaybackSource = 'playlist' | 'play-next';

export type HistoryEntry = {
  track: Track;
  playlistIndex: number;
  source: PlaybackSource;
  position: number;
};

export type PlayerState = {
  /** The durable playlist, distinct from the one-shot "play next" FIFO. */
  playlist: Track[];
  /** Compatibility alias for legacy UI that calls the playlist `tracks`. */
  tracks: Track[];
  /** Screen-facing name for the durable playlist; not the play-next FIFO. */
  queue: Track[];
  nowPlaying: Track | null;
  /** Compatibility alias used by the new RN shell. */
  currentTrack: Track | null;
  currentIndex: number;
  currentSource: PlaybackSource;
  playNextQueue: Track[];
  history: HistoryEntry[];
  playMode: PlayMode;
  shuffleOrder: number[];
  shuffleCursor: number;
  isPlaying: boolean;
  position: number;
  duration: number;
  bufferedPosition: number;
  volume: number;
  muted: boolean;
  error: string | null;
};

const initialState: PlayerState = {
  playlist: [],
  tracks: [],
  queue: [],
  nowPlaying: null,
  currentTrack: null,
  currentIndex: -1,
  currentSource: 'playlist',
  playNextQueue: [],
  history: [],
  playMode: PLAY_MODE.LOOP,
  shuffleOrder: [],
  shuffleCursor: -1,
  isPlaying: false,
  position: 0,
  duration: 0,
  bufferedPosition: 0,
  volume: 1,
  muted: false,
  error: null,
};

export function shuffleIndexes(length: number, random = Math.random): number[] {
  const indexes = Array.from({ length }, (_, index) => index);
  for (let index = indexes.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [indexes[index], indexes[swapIndex]] = [indexes[swapIndex], indexes[index]];
  }
  return indexes;
}

function clampVolume(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 1));
}

function activate(
  state: PlayerState,
  payload: {
    track: Track;
    playlistIndex: number;
    source: PlaybackSource;
    rememberCurrent?: boolean;
    position?: number;
    shuffleOrder?: number[];
    shuffleCursor?: number;
  },
) {
  if (payload.rememberCurrent && state.nowPlaying) {
    state.history.push({
      track: state.nowPlaying,
      playlistIndex: state.currentIndex,
      source: state.currentSource,
      position: state.position,
    });
  }
  state.nowPlaying = payload.track;
  state.currentTrack = payload.track;
  state.currentIndex = payload.playlistIndex;
  state.currentSource = payload.source;
  state.position = Math.max(0, payload.position ?? 0);
  state.duration = 0;
  state.bufferedPosition = 0;
  state.error = null;
  if (payload.shuffleOrder) state.shuffleOrder = payload.shuffleOrder;
  if (payload.shuffleCursor !== undefined)
    state.shuffleCursor = payload.shuffleCursor;
}

const playerSlice = createSlice({
  name: 'player',
  initialState,
  reducers: {
    replacePlaylist(
      state,
      action: PayloadAction<{ tracks: Track[]; startIndex?: number }>,
    ) {
      state.playlist = action.payload.tracks.slice();
      state.tracks = state.playlist;
      state.queue = state.playlist;
      state.playNextQueue = [];
      state.history = [];
      state.shuffleOrder = shuffleIndexes(state.playlist.length);
      state.shuffleCursor = -1;
      const startIndex = action.payload.startIndex ?? 0;
      if (state.playlist[startIndex]) {
        activate(state, {
          track: state.playlist[startIndex],
          playlistIndex: startIndex,
          source: 'playlist',
          shuffleCursor: state.shuffleOrder.indexOf(startIndex),
        });
      } else {
        state.nowPlaying = null;
        state.currentTrack = null;
        state.currentIndex = -1;
      }
    },
    appendPlaylistTrack(state, action: PayloadAction<Track>) {
      state.playlist.push(action.payload);
      state.tracks = state.playlist;
      state.queue = state.playlist;
      state.shuffleOrder = shuffleIndexes(state.playlist.length);
      state.shuffleCursor = state.shuffleOrder.indexOf(state.currentIndex);
    },
    enqueueNext(state, action: PayloadAction<Track>) {
      // Do not de-duplicate: two taps mean two requested plays.
      state.playNextQueue.push(action.payload);
    },
    removeQueuedNext(state, action: PayloadAction<number>) {
      if (action.payload >= 0 && action.payload < state.playNextQueue.length) {
        state.playNextQueue.splice(action.payload, 1);
      }
    },
    clearPlayNextQueue(state) {
      state.playNextQueue = [];
    },
    consumeQueuedNext(state) {
      state.playNextQueue.shift();
    },
    activateTrack(
      state,
      action: PayloadAction<{
        track: Track;
        playlistIndex: number;
        source: PlaybackSource;
        rememberCurrent?: boolean;
        position?: number;
        shuffleOrder?: number[];
        shuffleCursor?: number;
      }>,
    ) {
      activate(state, action.payload);
    },
    restoreHistory(
      state,
      action: PayloadAction<{ entry: HistoryEntry; remaining: HistoryEntry[] }>,
    ) {
      state.history = action.payload.remaining;
      activate(state, {
        ...action.payload.entry,
        rememberCurrent: false,
      });
    },
    setPlaying(state, action: PayloadAction<boolean>) {
      state.isPlaying = action.payload;
    },
    setProgress(
      state,
      action: PayloadAction<{
        position: number;
        duration?: number;
        bufferedPosition?: number;
      }>,
    ) {
      state.position = Math.max(0, action.payload.position);
      if (action.payload.duration !== undefined)
        state.duration = Math.max(0, action.payload.duration);
      if (action.payload.bufferedPosition !== undefined) {
        state.bufferedPosition = Math.max(0, action.payload.bufferedPosition);
      }
    },
    setVolumeSnapshot(state, action: PayloadAction<number>) {
      state.volume = clampVolume(action.payload);
    },
    setMutedSnapshot(state, action: PayloadAction<boolean>) {
      state.muted = action.payload;
    },
    setPlayModeSnapshot(state, action: PayloadAction<PlayMode>) {
      state.playMode = action.payload;
      if (
        action.payload === PLAY_MODE.SHUFFLE &&
        state.shuffleOrder.length !== state.playlist.length
      ) {
        state.shuffleOrder = shuffleIndexes(state.playlist.length);
        state.shuffleCursor = state.shuffleOrder.indexOf(state.currentIndex);
      }
    },
    cyclePlayModeSnapshot(state) {
      state.playMode = ((state.playMode + 1) % 3) as PlayMode;
      if (state.playMode === PLAY_MODE.SHUFFLE) {
        state.shuffleOrder = shuffleIndexes(state.playlist.length);
        state.shuffleCursor = state.shuffleOrder.indexOf(state.currentIndex);
      }
    },
    setError(state, action: PayloadAction<string | null>) {
      state.error = action.payload;
    },
    clearPlayer(state) {
      Object.assign(state, initialState);
    },
  },
});

export const playerActions = playerSlice.actions;
export const {
  appendPlaylistTrack,
  clearPlayNextQueue,
  clearPlayer,
  consumeQueuedNext,
  cyclePlayModeSnapshot,
  enqueueNext,
  removeQueuedNext,
  replacePlaylist,
  restoreHistory,
  setError,
  setPlaying,
  setProgress,
} = playerSlice.actions;

type Dispatch = (action: unknown) => unknown;

export const play = () => (dispatch: Dispatch) =>
  playerController.play(dispatch);
export const pause = () => (dispatch: Dispatch) =>
  playerController.pause(dispatch);
export const togglePlayback = () => (dispatch: Dispatch) =>
  playerController.toggle(dispatch);
export const nextTrack = () => (dispatch: Dispatch) =>
  playerController.next(dispatch);
export const prevTrack = () => (dispatch: Dispatch) =>
  playerController.previous(dispatch);
export const next = nextTrack;
export const previous = prevTrack;
export const seekTo = (position: number) => (dispatch: Dispatch) =>
  playerController.seek(dispatch, position);
export const setVolume = (volume: number) => (dispatch: Dispatch) =>
  playerController.setVolume(dispatch, volume);
export const setPlayerVolume = setVolume;
export const setMuted = (muted: boolean) => (dispatch: Dispatch) =>
  playerController.setMuted(dispatch, muted);
export const setPlayerMuted = setMuted;
export const toggleMute = () => (dispatch: Dispatch) =>
  playerController.setMuted(dispatch, !playerController.snapshot().muted);
export const setPlayMode = (mode: PlayMode) => (dispatch: Dispatch) =>
  playerController.setMode(dispatch, mode);
export const changePlayMode = () => (dispatch: Dispatch) =>
  playerController.setMode(
    dispatch,
    ((playerController.snapshot().playMode + 1) % 3) as PlayMode,
  );
export const playTrack = (track: Track) => (dispatch: Dispatch) =>
  playerController.playTrack(dispatch, track);
export const playTracks =
  (tracks: Track[], startIndex = 0) =>
  (dispatch: Dispatch) =>
    playerController.playTracks(dispatch, tracks, startIndex);
export const playTrackInPlaylist =
  (track: Track, tracks: Track[]) => (dispatch: Dispatch) => {
    const index = tracks.indexOf(track);
    return playerController.playTracks(dispatch, tracks, Math.max(0, index));
  };
export const addNextTrack = (track: Track) => (dispatch: Dispatch) => {
  dispatch(enqueueNext(track));
};
export const playQueuedTrack = (index: number) => (dispatch: Dispatch) =>
  playerController.playQueuedAt(dispatch, index);

export default playerSlice.reducer;
