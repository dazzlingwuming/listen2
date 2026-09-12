import TrackPlayer, {
  Capability,
  RepeatMode,
  State,
} from 'react-native-track-player';
import { PermissionsAndroid, Platform } from 'react-native';
import { providerClient } from '../api/client';
import { isLocalTrack, type PlayableTrack } from '../types/music';
import {
  PLAY_MODE,
  type HistoryEntry,
  type PlayerState,
} from '../store/playerSlice';

type Dispatch = (action: unknown) => unknown;

type ControllerRuntime = {
  dispatch: Dispatch;
  getPlayerState: () => PlayerState;
};

let runtime: ControllerRuntime | null = null;
let setupPromise: Promise<void> | null = null;

export function configurePlayerController(nextRuntime: ControllerRuntime) {
  runtime = nextRuntime;
}

function requireRuntime(): ControllerRuntime {
  if (!runtime)
    throw new Error(
      'The player store must be configured before controlling playback.',
    );
  return runtime;
}

function playerState(): PlayerState {
  return requireRuntime().getPlayerState();
}

function emit(dispatch: Dispatch | undefined, type: string, payload?: unknown) {
  const send = dispatch || requireRuntime().dispatch;
  return send(payload === undefined ? { type } : { type, payload });
}

function trackId(track: PlayableTrack): string {
  const id = (track as PlayableTrack & { id?: unknown }).id;
  return id === undefined || id === null ? '' : String(id);
}

function trackText(track: PlayableTrack, keys: string[]): string | undefined {
  const candidate = track as PlayableTrack & Record<string, unknown>;
  for (const key of keys) {
    if (typeof candidate[key] === 'string' && candidate[key])
      return candidate[key] as string;
  }
  return undefined;
}

function validShuffleOrder(state: PlayerState): boolean {
  return (
    state.shuffleOrder.length === state.playlist.length &&
    new Set(state.shuffleOrder).size === state.playlist.length &&
    state.shuffleOrder.every(
      index => index >= 0 && index < state.playlist.length,
    )
  );
}

function shuffledIndexes(length: number): number[] {
  const indexes = Array.from({ length }, (_, index) => index);
  for (let index = indexes.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [indexes[index], indexes[swapIndex]] = [indexes[swapIndex], indexes[index]];
  }
  return indexes;
}

async function resolveTrackUrl(track: PlayableTrack) {
  if (isLocalTrack(track)) {
    return { url: track.contentUri };
  }
  const candidate = await providerClient.bootstrapTrack(track);
  const { url } = candidate;
  if (!url || typeof url !== 'string') throw new Error('provider-unavailable');
  return candidate;
}

function asNativeTrack(
  track: PlayableTrack,
  media: { url: string; headers?: Readonly<Record<string, string>> },
) {
  return {
    ...track,
    // The native player needs an unambiguous queue item, while Listen1 IDs are
    // source identities and may intentionally occur more than once in play-next.
    id: `listen2:${trackId(track)}:${Date.now()}:${Math.random()
      .toString(36)
      .slice(2)}`,
    url: media.url,
    headers: media.headers,
    title: trackText(track, ['title', 'name']) || '未知歌曲',
    artist: trackText(track, ['artist', 'artists']) || '未知艺人',
    album: trackText(track, ['album']),
    artwork: trackText(track, ['artworkUrl', 'artwork', 'cover', 'img_url']),
  };
}

async function ensurePlayer(): Promise<void> {
  if (!setupPromise) {
    setupPromise = (async () => {
      if (Platform.OS === 'android' && Platform.Version >= 33) {
        // Playback is a user-initiated action, so this is the least surprising
        // moment to request permission for the media notification controls.
        await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
        );
      }
      try {
        await TrackPlayer.setupPlayer({
          autoHandleInterruptions: true,
        });
      } catch (error) {
        // setupPlayer is not idempotent on every native target. Once an
        // existing player owns audio, its controls are still safe to configure.
        if (
          !(error instanceof Error) ||
          !/already been initialized/i.test(error.message)
        )
          throw error;
      }
      await TrackPlayer.updateOptions({
        capabilities: [
          Capability.Play,
          Capability.Pause,
          Capability.Stop,
          Capability.SkipToNext,
          Capability.SkipToPrevious,
          Capability.SeekTo,
        ],
        compactCapabilities: [
          Capability.Play,
          Capability.Pause,
          Capability.SkipToNext,
        ],
        notificationCapabilities: [
          Capability.Play,
          Capability.Pause,
          Capability.SkipToPrevious,
          Capability.SkipToNext,
          Capability.SeekTo,
        ],
        progressUpdateEventInterval: 1,
      });
    })();
  }
  return setupPromise;
}

async function configureNativeSnapshot(state: PlayerState) {
  await TrackPlayer.setRepeatMode(
    state.playMode === PLAY_MODE.REPEAT_ONE ? RepeatMode.Track : RepeatMode.Off,
  );
  await TrackPlayer.setVolume(state.muted ? 0 : state.volume);
}

async function loadAndPlay(
  dispatch: Dispatch | undefined,
  track: PlayableTrack,
  position: number,
  resolvedMedia?: { url: string; headers?: Readonly<Record<string, string>> },
): Promise<boolean> {
  try {
    await ensurePlayer();
    const media = resolvedMedia ?? (await resolveTrackUrl(track));
    const state = playerState();
    await TrackPlayer.reset();
    await TrackPlayer.add(asNativeTrack(track, media) as any);
    await configureNativeSnapshot(state);
    if (position > 0) await TrackPlayer.seekTo(position);
    await TrackPlayer.play();
    emit(dispatch, 'player/setPlaying', true);
    return true;
  } catch (error) {
    emit(dispatch, 'player/setPlaying', false);
    if (isLocalTrack(track))
      emit(dispatch, 'library/markLocalTrackNeedsRepair', track.id);
    emit(
      dispatch,
      'player/setError',
      error instanceof Error ? error.message : 'playback-unavailable',
    );
    return false;
  }
}

async function transition(
  dispatch: Dispatch | undefined,
  payload: {
    track: PlayableTrack;
    playlistIndex: number;
    source: 'playlist' | 'play-next';
    rememberCurrent?: boolean;
    position?: number;
    shuffleOrder?: number[];
    shuffleCursor?: number;
    consumePlayNext?: boolean;
    consumePlayNextIndex?: number;
    appendToPlaylist?: boolean;
  },
) {
  let media: { url: string; headers?: Readonly<Record<string, string>> };
  try {
    media = await resolveTrackUrl(payload.track);
  } catch (error) {
    emit(
      dispatch,
      'player/setError',
      error instanceof Error ? error.message : 'playback-unavailable',
    );
    return false;
  }
  const started = await loadAndPlay(
    dispatch,
    payload.track,
    payload.position || 0,
    media,
  );
  if (started) {
    if (payload.appendToPlaylist)
      emit(dispatch, 'player/appendPlaylistTrack', payload.track);
    emit(dispatch, 'player/activateTrack', payload);
    if (payload.consumePlayNext) emit(dispatch, 'player/consumeQueuedNext');
    if (payload.consumePlayNextIndex !== undefined)
      emit(dispatch, 'player/removeQueuedNext', payload.consumePlayNextIndex);
    emit(dispatch, 'library/recordRecent', payload.track);
  }
  return started;
}

function nextPlaylistTarget(state: PlayerState) {
  if (!state.playlist.length) return null;
  if (state.playMode !== PLAY_MODE.SHUFFLE) {
    const index =
      state.currentIndex < 0
        ? 0
        : (state.currentIndex + 1) % state.playlist.length;
    return {
      index,
      shuffleOrder: state.shuffleOrder,
      shuffleCursor: state.shuffleCursor,
    };
  }

  let order = validShuffleOrder(state)
    ? state.shuffleOrder.slice()
    : shuffledIndexes(state.playlist.length);
  let cursor = validShuffleOrder(state)
    ? state.shuffleCursor
    : order.indexOf(state.currentIndex);
  if (cursor < 0) cursor = 0;
  if (cursor + 1 >= order.length) {
    const previous = order[cursor];
    order = shuffledIndexes(state.playlist.length);
    if (order.length > 1 && order[0] === previous)
      [order[0], order[1]] = [order[1], order[0]];
    cursor = 0;
  } else {
    cursor += 1;
  }
  return { index: order[cursor], shuffleOrder: order, shuffleCursor: cursor };
}

class PlayerController {
  async play(dispatch?: Dispatch) {
    const state = playerState();
    if (!state.nowPlaying) return;
    if (state.error) {
      const started = await loadAndPlay(
        dispatch,
        state.nowPlaying,
        state.position,
      );
      if (started) emit(dispatch, 'library/recordRecent', state.nowPlaying);
      return;
    }
    try {
      await ensurePlayer();
      await configureNativeSnapshot(state);
      await TrackPlayer.play();
      emit(dispatch, 'player/setPlaying', true);
    } catch (error) {
      emit(
        dispatch,
        'player/setError',
        error instanceof Error ? error.message : 'playback-unavailable',
      );
    }
  }

  async pause(dispatch?: Dispatch) {
    try {
      await ensurePlayer();
      await TrackPlayer.pause();
    } finally {
      emit(dispatch, 'player/setPlaying', false);
    }
  }

  async toggle(dispatch?: Dispatch) {
    if (playerState().isPlaying) return this.pause(dispatch);
    return this.play(dispatch);
  }

  async playTrack(dispatch: Dispatch | undefined, track: PlayableTrack) {
    const state = playerState();
    let playlistIndex = state.playlist.indexOf(track);
    if (playlistIndex < 0)
      playlistIndex = state.playlist.findIndex(
        item => trackId(item) === trackId(track),
      );
    if (playlistIndex < 0) {
      playlistIndex = state.playlist.length;
    }
    await transition(dispatch, {
      track,
      playlistIndex,
      source: 'playlist',
      rememberCurrent: Boolean(state.nowPlaying),
      shuffleCursor: state.shuffleOrder.indexOf(playlistIndex),
      appendToPlaylist: playlistIndex === state.playlist.length,
    });
  }

  async playTracks(
    dispatch: Dispatch | undefined,
    tracks: PlayableTrack[],
    startIndex = 0,
  ) {
    const target = tracks[startIndex];
    if (!target) return;
    let media: { url: string; headers?: Readonly<Record<string, string>> };
    try {
      media = await resolveTrackUrl(target);
    } catch (error) {
      emit(
        dispatch,
        'player/setError',
        error instanceof Error ? error.message : 'playback-unavailable',
      );
      return;
    }
    const started = await loadAndPlay(dispatch, target, 0, media);
    if (started) {
      emit(dispatch, 'player/replacePlaylist', { tracks, startIndex });
      emit(dispatch, 'library/recordRecent', target);
    }
  }

  async next(dispatch?: Dispatch) {
    const state = playerState();
    if (state.playNextQueue.length) {
      const track = state.playNextQueue[0];
      await transition(dispatch, {
        track,
        playlistIndex: state.currentIndex,
        source: 'play-next',
        rememberCurrent: Boolean(state.nowPlaying),
        consumePlayNext: true,
      });
      return;
    }
    const target = nextPlaylistTarget(state);
    if (!target) return this.pause(dispatch);
    await transition(dispatch, {
      track: state.playlist[target.index],
      playlistIndex: target.index,
      source: 'playlist',
      rememberCurrent: Boolean(state.nowPlaying),
      shuffleOrder: target.shuffleOrder,
      shuffleCursor: target.shuffleCursor,
    });
  }

  async playQueuedAt(dispatch: Dispatch | undefined, index: number) {
    const state = playerState();
    const track = state.playNextQueue[index];
    if (!track) return;
    await transition(dispatch, {
      track,
      playlistIndex: state.currentIndex,
      source: 'play-next',
      rememberCurrent: Boolean(state.nowPlaying),
      consumePlayNextIndex: index,
    });
  }

  async previous(dispatch?: Dispatch) {
    const state = playerState();
    const entry = state.history[state.history.length - 1];
    if (!entry) return;
    const remaining = state.history.slice(0, -1);
    let media: { url: string; headers?: Readonly<Record<string, string>> };
    try {
      media = await resolveTrackUrl(entry.track);
    } catch (error) {
      emit(
        dispatch,
        'player/setError',
        error instanceof Error ? error.message : 'playback-unavailable',
      );
      return;
    }
    const started = await loadAndPlay(
      dispatch,
      entry.track,
      entry.position,
      media,
    );
    if (started) emit(dispatch, 'player/restoreHistory', { entry, remaining });
  }

  async seek(dispatch: Dispatch | undefined, position: number) {
    const target = Math.max(0, Number.isFinite(position) ? position : 0);
    try {
      await ensurePlayer();
      await TrackPlayer.seekTo(target);
      emit(dispatch, 'player/setProgress', { position: target });
    } catch (error) {
      emit(
        dispatch,
        'player/setError',
        error instanceof Error ? error.message : 'seek-unavailable',
      );
    }
  }

  async setVolume(dispatch: Dispatch | undefined, volume: number) {
    const target = Math.max(
      0,
      Math.min(1, Number.isFinite(volume) ? volume : 1),
    );
    emit(dispatch, 'player/setVolumeSnapshot', target);
    try {
      await ensurePlayer();
      await TrackPlayer.setVolume(playerState().muted ? 0 : target);
    } catch (error) {
      emit(
        dispatch,
        'player/setError',
        error instanceof Error ? error.message : 'volume-unavailable',
      );
    }
  }

  async setMuted(dispatch: Dispatch | undefined, muted: boolean) {
    emit(dispatch, 'player/setMutedSnapshot', muted);
    try {
      await ensurePlayer();
      await TrackPlayer.setVolume(muted ? 0 : playerState().volume);
    } catch (error) {
      emit(
        dispatch,
        'player/setError',
        error instanceof Error ? error.message : 'volume-unavailable',
      );
    }
  }

  async setMode(dispatch: Dispatch | undefined, mode: PlayerState['playMode']) {
    emit(dispatch, 'player/setPlayModeSnapshot', mode);
    try {
      await ensurePlayer();
      await configureNativeSnapshot(playerState());
    } catch (error) {
      emit(
        dispatch,
        'player/setError',
        error instanceof Error ? error.message : 'mode-unavailable',
      );
    }
  }

  async forgetTrack(dispatch: Dispatch | undefined, track: PlayableTrack) {
    if (playerState().nowPlaying?.id === track.id) {
      try {
        await ensurePlayer();
        await TrackPlayer.stop();
        await TrackPlayer.reset();
      } catch {
        // The catalog must still forget an item if native playback is gone.
      }
    }
    emit(dispatch, 'player/removeTrackReferences', track.id);
  }

  onProgress(position: number, duration: number, bufferedPosition: number) {
    emit(undefined, 'player/setProgress', {
      position,
      duration,
      bufferedPosition,
    });
  }

  onPlaybackState(nativeState: State) {
    emit(undefined, 'player/setPlaying', nativeState === State.Playing);
  }

  onPlaybackError() {
    emit(undefined, 'player/setPlaying', false);
    emit(undefined, 'player/setError', 'native-playback-error');
  }

  snapshot(): PlayerState {
    return playerState();
  }

  async restore() {
    const state = playerState();
    if (!state.nowPlaying) return;
    await loadAndPlay(undefined, state.nowPlaying, state.position);
    // restore is intentionally paused even if a previous process persisted a
    // stale `isPlaying` value. The user resumes from the visible shell.
    await this.pause();
  }
}

export const playerController = new PlayerController();
export type { HistoryEntry };
