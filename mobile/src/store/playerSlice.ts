import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { PlayableTrack as Track } from '../types/music';
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

/**
 * A play-next request is an occurrence, not a track identity.  Keeping the
 * semantic track nested makes the persisted boundary explicit; spreading it
 * preserves the legacy read-only track shape used by portable backups.
 */
export type PlayNextOccurrence = Track & {
  occurrenceId: string;
  track: Track;
};

export type HistoryEntry = {
  track: Track;
  playlistIndex: number;
  source: PlaybackSource;
  position: number;
  occurrenceId?: string | null;
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
  currentOccurrenceId: string | null;
  playNextQueue: PlayNextOccurrence[];
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
  /** Monotonic semantic transaction identifiers; RNTP IDs are never stored. */
  transitionToken: number;
  acceptedTransitionToken: number;
};

const MAX_PLAYER_POSITION = 86_400;

const initialState: PlayerState = {
  playlist: [],
  tracks: [],
  queue: [],
  nowPlaying: null,
  currentTrack: null,
  currentIndex: -1,
  currentSource: 'playlist',
  currentOccurrenceId: null,
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
  transitionToken: 0,
  acceptedTransitionToken: 0,
};

let occurrenceSequence = 0;

function mintOccurrenceId(state: PlayerState): string {
  let occurrenceId = '';
  do {
    occurrenceSequence += 1;
    occurrenceId = `play-next-${occurrenceSequence.toString(36)}`;
  } while (
    state.playNextQueue.some(item => item.occurrenceId === occurrenceId)
  );
  return occurrenceId;
}

function playlistOccurrenceId(track: Track, index: number): string {
  return `playlist-${index}-${String(track.id)}`;
}

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

function finitePosition(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(MAX_PLAYER_POSITION, value))
    : fallback;
}

function isValidPlayMode(value: unknown): value is PlayMode {
  return (
    value === PLAY_MODE.LOOP ||
    value === PLAY_MODE.SHUFFLE ||
    value === PLAY_MODE.REPEAT_ONE
  );
}

function isPermutation(value: unknown, length: number): value is number[] {
  return (
    Array.isArray(value) &&
    value.length === length &&
    value.every(
      index => Number.isInteger(index) && index >= 0 && index < length,
    ) &&
    new Set(value).size === length
  );
}

function invalidateTransition(state: PlayerState) {
  const next = Math.max(state.transitionToken, state.acceptedTransitionToken) + 1;
  state.transitionToken = next;
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
    currentOccurrenceId?: string | null;
  },
) {
  if (payload.rememberCurrent && state.nowPlaying) {
    state.history.push({
      track: state.nowPlaying,
      playlistIndex: state.currentIndex,
      source: state.currentSource,
      position: state.position,
      occurrenceId: state.currentOccurrenceId,
    });
  }
  state.nowPlaying = payload.track;
  state.currentTrack = payload.track;
  state.currentIndex = payload.playlistIndex;
  state.currentSource = payload.source;
  state.currentOccurrenceId =
    payload.currentOccurrenceId ??
    (payload.source === 'playlist'
      ? playlistOccurrenceId(payload.track, payload.playlistIndex)
      : null);
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
      // A replacement is a destructive semantic boundary. Any asynchronous
      // queue transition resolving against the old playlist must be rejected.
      invalidateTransition(state);
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
        state.currentSource = 'playlist';
        state.currentOccurrenceId = null;
        state.isPlaying = false;
        state.position = 0;
        state.duration = 0;
        state.bufferedPosition = 0;
      }
    },
    appendPlaylistTrack(state, action: PayloadAction<Track>) {
      const previousLength = state.playlist.length;
      const previousOrder = state.shuffleOrder.slice();
      const previousCursor = state.shuffleCursor;
      state.playlist.push(action.payload);
      state.tracks = state.playlist;
      state.queue = state.playlist;
      if (isPermutation(previousOrder, previousLength)) {
        // Keep the active shuffle round intact. The appended occurrence joins
        // the unvisited tail instead of silently reshuffling already visited
        // items or changing the current cursor.
        state.shuffleOrder = [...previousOrder, previousLength];
        state.shuffleCursor = previousCursor;
        if (
          state.currentIndex >= 0 &&
          state.shuffleOrder[state.shuffleCursor] !== state.currentIndex
        )
          state.shuffleCursor = state.shuffleOrder.indexOf(state.currentIndex);
      } else {
        state.shuffleOrder = shuffleIndexes(state.playlist.length);
        state.shuffleCursor = state.shuffleOrder.indexOf(state.currentIndex);
      }
    },
    enqueueNext(state, action: PayloadAction<Track>) {
      // Do not de-duplicate: two taps mean two requested plays.
      state.playNextQueue.push({
        ...action.payload,
        occurrenceId: mintOccurrenceId(state),
        track: action.payload,
      });
    },
    removeQueuedNext(state, action: PayloadAction<string>) {
      const index = state.playNextQueue.findIndex(
        item => item.occurrenceId === action.payload,
      );
      if (index >= 0) state.playNextQueue.splice(index, 1);
    },
    moveQueuedNext(
      state,
      action: PayloadAction<{
        occurrenceId: string;
        direction: -1 | 1;
      }>,
    ) {
      const index = state.playNextQueue.findIndex(
        item => item.occurrenceId === action.payload.occurrenceId,
      );
      const target = index + action.payload.direction;
      if (index < 0 || target < 0 || target >= state.playNextQueue.length)
        return;
      [state.playNextQueue[index], state.playNextQueue[target]] = [
        state.playNextQueue[target],
        state.playNextQueue[index],
      ];
    },
    removeTrackReferences(state, action: PayloadAction<string>) {
      const id = action.payload;
      const removedCurrent = state.nowPlaying?.id === id;
      state.playlist = state.playlist.filter(track => track.id !== id);
      state.tracks = state.playlist;
      state.queue = state.playlist;
      state.playNextQueue = state.playNextQueue.filter(
        occurrence => occurrence.track.id !== id,
      );
      state.history = state.history.filter(entry => entry.track.id !== id);
      state.shuffleOrder = shuffleIndexes(state.playlist.length);
      if (removedCurrent) {
        state.nowPlaying = null;
        state.currentTrack = null;
        state.currentIndex = -1;
        state.currentSource = 'playlist';
        state.currentOccurrenceId = null;
        state.isPlaying = false;
        state.position = 0;
        state.duration = 0;
        state.bufferedPosition = 0;
      } else if (state.nowPlaying) {
        state.currentIndex = state.playlist.findIndex(
          track => track.id === state.nowPlaying?.id,
        );
      }
      state.shuffleCursor = state.shuffleOrder.indexOf(state.currentIndex);
    },
    clearPlayNextQueue(state) {
      invalidateTransition(state);
      state.playNextQueue = [];
    },
    beginTransition(state, action: PayloadAction<number>) {
      if (Number.isInteger(action.payload) && action.payload > state.transitionToken)
        state.transitionToken = action.payload;
    },
    consumeQueuedNext(
      state,
      action: PayloadAction<{ occurrenceId: string; transitionToken: number }>,
    ) {
      if (
        action.payload.transitionToken !== state.transitionToken ||
        action.payload.transitionToken <= state.acceptedTransitionToken
      )
        return;
      const index = state.playNextQueue.findIndex(
        item => item.occurrenceId === action.payload.occurrenceId,
      );
      if (index < 0) return;
      state.playNextQueue.splice(index, 1);
      state.acceptedTransitionToken = action.payload.transitionToken;
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
        currentOccurrenceId?: string | null;
        transitionToken?: number;
      }>,
    ) {
      if (
        action.payload.transitionToken !== undefined &&
        action.payload.transitionToken !== state.transitionToken
      )
        return;
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
      if (typeof action.payload === 'boolean') state.isPlaying = action.payload;
    },
    setProgress(
      state,
      action: PayloadAction<{
        position: number;
        duration?: number;
        bufferedPosition?: number;
      }>,
    ) {
      state.position = finitePosition(action.payload.position, state.position);
      if (action.payload.duration !== undefined)
        state.duration = finitePosition(action.payload.duration, state.duration);
      if (action.payload.bufferedPosition !== undefined) {
        state.bufferedPosition = finitePosition(
          action.payload.bufferedPosition,
          state.bufferedPosition,
        );
      }
    },
    setVolumeSnapshot(state, action: PayloadAction<number>) {
      state.volume = clampVolume(action.payload);
    },
    setMutedSnapshot(state, action: PayloadAction<boolean>) {
      state.muted = action.payload;
    },
    setPlayModeSnapshot(state, action: PayloadAction<PlayMode>) {
      if (!isValidPlayMode(action.payload)) return;
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
      state.error = typeof action.payload === 'string' || action.payload === null
        ? action.payload
        : state.error;
    },
    clearPlayer(state) {
      invalidateTransition(state);
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
  moveQueuedNext,
  removeQueuedNext,
  removeTrackReferences,
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
export const playQueuedTrack = (occurrenceId: string) => (dispatch: Dispatch) =>
  playerController.playQueuedAt(dispatch, occurrenceId);
export const movePlayNextTrack =
  (occurrenceId: string, direction: -1 | 1) => (dispatch: Dispatch) =>
    dispatch(moveQueuedNext({ occurrenceId, direction }));
export const removePlayNextTrack =
  (occurrenceId: string) => (dispatch: Dispatch) =>
    dispatch(removeQueuedNext(occurrenceId));
export const forgetTrack = (track: Track) => (dispatch: Dispatch) =>
  playerController.forgetTrack(dispatch, track);

export default playerSlice.reducer;
