import TrackPlayer, {
  Capability,
  RepeatMode,
  State,
} from 'react-native-track-player';
import { PermissionsAndroid, Platform } from 'react-native';
import { providerClient } from '../api/client';
import { isLocalTrack, type PlayableTrack } from '../types/music';
import {
  isOfflineDownloadEligible,
  offlineAudio,
} from '../offline/offlineAudio';
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

const STALE_NATIVE_COMMAND = Symbol('stale-native-command');
const MAX_SEEK_SECONDS = 86_400;

type NativeOperationContext = {
  isCurrent: () => boolean;
  isTargetAvailable: () => boolean;
  markMutation: () => void;
  markLoaded: (nativeTrackId: string, track: PlayableTrack) => void;
  didMutate: () => boolean;
};

type NativeCallbackIdentity = {
  nativeTrackId?: string;
  generation?: number;
  nativeTrackIndex?: number;
};

function assertNativeOperationCurrent(context?: NativeOperationContext) {
  if (context && (!context.isCurrent() || !context.isTargetAvailable()))
    throw STALE_NATIVE_COMMAND;
}

function isNativeOperationCurrent(context?: NativeOperationContext) {
  return !context || (context.isCurrent() && context.isTargetAvailable());
}

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

const SAFE_TYPED_PLAYER_ERRORS = new Set([
  'NETWORK_ERROR',
  'PROVIDER_ERROR',
  'ROUTE_UNAVAILABLE',
  'PLAYBACK_UNAVAILABLE',
  'LOGIN_REQUIRED',
  'MEMBERSHIP_REQUIRED',
  'REGION_RESTRICTED',
  'DRM_RESTRICTED',
  'REQUEST_TIMEOUT',
  'INVALID_RESPONSE',
  'VIDEO_UNAVAILABLE',
  'UNSUPPORTED_VIDEO_CODEC',
  'CANCELLED',
]);

function safePlayerError(error: unknown, fallback: string): string {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? (error as { code?: unknown }).code
      : undefined;
  return typeof code === 'string' && SAFE_TYPED_PLAYER_ERRORS.has(code)
    ? code
    : fallback;
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
  if (isOfflineDownloadEligible(track)) {
    const cached = await offlineAudio.resolveVerified(track.source, track.id);
    if (cached.status === 'hit') return { url: cached.uri };
  }
  let candidate: Awaited<ReturnType<typeof providerClient.bootstrapTrack>>;
  try {
    candidate = await providerClient.bootstrapTrack(track);
  } catch (error) {
    // Bilibili media URLs are intentionally transient. A single fresh native
    // resolution is allowed for transport failure; entitlement/DRM/cancel
    // failures are terminal and never alter the RNTP queue.
    if (!isRetryableBilibiliResolution(track, error)) throw error;
    candidate = await providerClient.bootstrapTrack(track);
  }
  const { url } = candidate;
  if (!url || typeof url !== 'string') throw new Error('provider-unavailable');
  if (track.source === 'bilibili' && !isExactBilibiliMedia(track.id, candidate))
    throw new Error('provider-unavailable');
  return candidate;
}

function isRetryableBilibiliResolution(track: PlayableTrack, error: unknown) {
  if (track.source !== 'bilibili') return false;
  const code =
    error && typeof error === 'object' && 'code' in error
      ? (error as { code?: unknown }).code
      : undefined;
  // Native player expiry callbacks have no provider code, and a native
  // NETWORK_ERROR can use one fresh signed handoff. Every typed provider
  // result, including REQUEST_TIMEOUT, is already a stable user-facing
  // outcome and must reach the reducer unchanged.
  return code === undefined || code === 'NETWORK_ERROR';
}

function isExactBilibiliMedia(
  id: string,
  candidate: { url: string; headers?: Readonly<Record<string, string>> },
): boolean {
  if (!/^bitrack_v_BV[0-9A-Za-z]{6,32}-[1-9][0-9]{0,17}$/.test(id))
    return false;
  if (
    !candidate.headers ||
    Object.keys(candidate.headers).length !== 1 ||
    candidate.headers.Referer !== 'https://www.bilibili.com/'
  )
    return false;
  try {
    const url = new URL(candidate.url);
    return (
      url.protocol === 'https:' &&
      (url.hostname === 'bilivideo.com' ||
        url.hostname.endsWith('.bilivideo.com')) &&
      url.username === '' &&
      url.password === '' &&
      url.hash === ''
    );
  } catch {
    return false;
  }
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

type NativeRollbackSnapshot = {
  track: PlayableTrack;
  media: { url: string; headers?: Readonly<Record<string, string>> };
  position: number;
  repeatMode: RepeatMode;
  volume: number;
  playing: boolean;
};

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some(character => character.charCodeAt(0) <= 0x1f);
}

function boundedNativeMedia(value: unknown): {
  url: string;
  headers?: Readonly<Record<string, string>>;
} | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as { url?: unknown; headers?: unknown };
  if (
    typeof candidate.url !== 'string' ||
    !candidate.url ||
    candidate.url.length > 4096 ||
    hasControlCharacter(candidate.url)
  ) {
    return null;
  }
  if (candidate.headers === undefined) return { url: candidate.url };
  if (!candidate.headers || typeof candidate.headers !== 'object') return null;
  const entries = Object.entries(candidate.headers as Record<string, unknown>);
  if (entries.length > 8) return null;
  const headers: Record<string, string> = {};
  for (const [key, headerValue] of entries) {
    if (
      !key ||
      key.length > 64 ||
      hasControlCharacter(key) ||
      typeof headerValue !== 'string' ||
      headerValue.length > 1024 ||
      hasControlCharacter(headerValue)
    ) {
      return null;
    }
    headers[key] = headerValue;
  }
  return { url: candidate.url, headers };
}

async function captureRollbackSnapshot(
  state: PlayerState,
): Promise<NativeRollbackSnapshot | null> {
  if (!state.nowPlaying) return null;
  const active = boundedNativeMedia(await TrackPlayer.getActiveTrack());
  const progress = await TrackPlayer.getProgress();
  const playback = await TrackPlayer.getPlaybackState();
  if (!active || !progress || !Number.isFinite(progress.position)) {
    throw new Error('snapshot-unavailable');
  }
  return {
    track: state.nowPlaying,
    media: active,
    position: Math.max(0, progress.position),
    repeatMode:
      state.playMode === PLAY_MODE.REPEAT_ONE
        ? RepeatMode.Track
        : RepeatMode.Off,
    volume: state.muted ? 0 : state.volume,
    playing: playback.state === State.Playing,
  };
}

async function restoreRollbackSnapshot(
  snapshot: NativeRollbackSnapshot,
  context?: NativeOperationContext,
): Promise<string> {
  assertNativeOperationCurrent(context);
  const nativeTrack = asNativeTrack(snapshot.track, snapshot.media);
  context?.markMutation();
  await TrackPlayer.reset();
  assertNativeOperationCurrent(context);
  await TrackPlayer.add(nativeTrack as any);
  context?.markLoaded(nativeTrack.id, snapshot.track);
  assertNativeOperationCurrent(context);
  await TrackPlayer.setRepeatMode(snapshot.repeatMode);
  assertNativeOperationCurrent(context);
  await TrackPlayer.setVolume(snapshot.volume);
  if (snapshot.position > 0) {
    assertNativeOperationCurrent(context);
    await TrackPlayer.seekTo(snapshot.position);
  }
  assertNativeOperationCurrent(context);
  if (snapshot.playing) await TrackPlayer.play();
  else await TrackPlayer.pause();
  return nativeTrack.id;
}

async function replaceNativeTrack(
  track: PlayableTrack,
  media: { url: string; headers?: Readonly<Record<string, string>> },
  state: PlayerState,
  context?: NativeOperationContext,
) {
  assertNativeOperationCurrent(context);
  const nativeTrack = asNativeTrack(track, media);
  context?.markMutation();
  await TrackPlayer.reset();
  assertNativeOperationCurrent(context);
  await TrackPlayer.add(nativeTrack as any);
  context?.markLoaded(nativeTrack.id, track);
  await configureNativeSnapshot(state, context);
  assertNativeOperationCurrent(context);
  await TrackPlayer.play();
}

async function ensurePlayer(): Promise<void> {
  if (!setupPromise) {
    const pending = (async () => {
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
    // A rejected setup must not poison every later user command. RNTP setup
    // can fail transiently while the app is backgrounded or the service is
    // still starting, so the next serialized command gets one fresh attempt.
    setupPromise = pending.catch(error => {
      setupPromise = null;
      throw error;
    });
  }
  return setupPromise;
}

async function configureNativeSnapshot(
  state: PlayerState,
  context?: NativeOperationContext,
) {
  assertNativeOperationCurrent(context);
  await TrackPlayer.setRepeatMode(
    state.playMode === PLAY_MODE.REPEAT_ONE ? RepeatMode.Track : RepeatMode.Off,
  );
  assertNativeOperationCurrent(context);
  await TrackPlayer.setVolume(state.muted ? 0 : state.volume);
}

async function loadAndPlay(
  dispatch: Dispatch | undefined,
  track: PlayableTrack,
  position: number,
  resolvedMedia?: { url: string; headers?: Readonly<Record<string, string>> },
  context?: NativeOperationContext,
): Promise<boolean> {
  try {
    assertNativeOperationCurrent(context);
    await ensurePlayer();
    assertNativeOperationCurrent(context);
    const media = resolvedMedia ?? (await resolveTrackUrl(track));
    assertNativeOperationCurrent(context);
    const state = playerState();
    const nativeTrack = asNativeTrack(track, media);
    context?.markMutation();
    await TrackPlayer.reset();
    assertNativeOperationCurrent(context);
    await TrackPlayer.add(nativeTrack as any);
    context?.markLoaded(nativeTrack.id, track);
    await configureNativeSnapshot(state, context);
    if (position > 0) {
      assertNativeOperationCurrent(context);
      await TrackPlayer.seekTo(position);
    }
    assertNativeOperationCurrent(context);
    await TrackPlayer.play();
    emit(dispatch, 'player/setPlaying', true);
    return true;
  } catch (error) {
    if (error === STALE_NATIVE_COMMAND) return false;
    if (!isNativeOperationCurrent(context)) return false;
    if (
      !isLocalTrack(track) &&
      resolvedMedia?.url.startsWith('content://') &&
      isOfflineDownloadEligible(track)
    ) {
      await offlineAudio.invalidate(track.source, track.id);
      try {
        return await loadAndPlay(
          dispatch,
          track,
          position,
          await providerClient.bootstrapTrack(track),
          context,
        );
      } catch {
        /* stable error below */
      }
    }
    if (resolvedMedia && isRetryableBilibiliResolution(track, error)) {
      try {
        assertNativeOperationCurrent(context);
        const replacement = await resolveTrackUrl(track);
        assertNativeOperationCurrent(context);
        const nativeTrack = asNativeTrack(track, replacement);
        context?.markMutation();
        await TrackPlayer.reset();
        assertNativeOperationCurrent(context);
        await TrackPlayer.add(nativeTrack as any);
        context?.markLoaded(nativeTrack.id, track);
        await configureNativeSnapshot(playerState(), context);
        if (position > 0) {
          assertNativeOperationCurrent(context);
          await TrackPlayer.seekTo(position);
        }
        assertNativeOperationCurrent(context);
        await TrackPlayer.play();
        emit(dispatch, 'player/setPlaying', true);
        return true;
      } catch {
        // One bounded replacement only; the stable error below preserves the queue snapshot.
      }
    }
    if (!isNativeOperationCurrent(context)) return false;
    emit(dispatch, 'player/setPlaying', false);
    if (isLocalTrack(track))
      emit(dispatch, 'library/markLocalTrackNeedsRepair', track.id);
    emit(
      dispatch,
      'player/setError',
      safePlayerError(
        error,
        isLocalTrack(track)
          ? 'local-media-unavailable'
          : resolvedMedia?.url.startsWith('content://')
          ? 'offline-media-unavailable'
          : 'playback-unavailable',
      ),
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
    currentOccurrenceId?: string | null;
    transitionToken?: number;
    consumePlayNext?: { occurrenceId: string; transitionToken: number };
    appendToPlaylist?: boolean;
  },
  context?: NativeOperationContext,
) {
  let rollback: NativeRollbackSnapshot | null = null;
  if (
    playerState().nowPlaying &&
    typeof (TrackPlayer as any).getActiveTrack === 'function'
  ) {
    try {
      await ensurePlayer();
      rollback = await captureRollbackSnapshot(playerState());
    } catch {
      emit(dispatch, 'player/setError', 'playback-transition-unavailable');
      return false;
    }
  }
  if (!isNativeOperationCurrent(context)) return false;
  let media: { url: string; headers?: Readonly<Record<string, string>> };
  try {
    media = await resolveTrackUrl(payload.track);
  } catch (error) {
    if (!isNativeOperationCurrent(context)) return false;
    emit(
      dispatch,
      'player/setError',
      safePlayerError(error, 'playback-unavailable'),
    );
    return false;
  }
  if (!isNativeOperationCurrent(context)) return false;
  const started = await loadAndPlay(
    dispatch,
    payload.track,
    payload.position || 0,
    media,
    context,
  );
  if (
    !started &&
    rollback &&
    context?.didMutate() &&
    isNativeOperationCurrent(context)
  ) {
    try {
      await restoreRollbackSnapshot(rollback, context);
      playerController.markNativeTrackLoaded();
      emit(dispatch, 'player/setPlaying', rollback.playing);
    } catch {
      try {
        await TrackPlayer.pause();
      } catch {
        // Recovery is bounded to a single best-effort native pause.
      }
      emit(dispatch, 'player/setPlaying', false);
      emit(dispatch, 'player/setError', 'playback-recovery-required');
    }
    return false;
  }
  if (!isNativeOperationCurrent(context)) {
    // A stale load may already have reset RNTP.  Do not restore the old item:
    // the newer semantic transaction owns the next native queue.  Leaving a
    // reload-required semantic snapshot is safer than reviving either stale
    // media item.
    if (context?.didMutate()) {
      try {
        await TrackPlayer.pause();
        await TrackPlayer.reset();
      } catch {
        // The newer command can still reload the authoritative semantic item.
      }
      playerController.markNativeQueueCleared();
      emit(dispatch, 'player/setPlaying', false);
    }
    return false;
  }
  if (started) {
    playerController.markNativeTrackLoaded();
    if (payload.appendToPlaylist)
      emit(dispatch, 'player/appendPlaylistTrack', payload.track);
    emit(dispatch, 'player/activateTrack', payload);
    if (payload.consumePlayNext)
      emit(dispatch, 'player/consumeQueuedNext', payload.consumePlayNext);
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
  private queueTransitionInFlight: Promise<boolean | void> | null = null;
  private nativeMutationTail: Promise<void> | null = null;
  private transitionSequence = 0;
  private restoredNeedsLoad = false;
  private nativeGeneration = 0;
  private activeNativeTrackId: string | null = null;
  private activeNativeGeneration = 0;
  private activeNativeTrackIndex: number | null = null;

  /**
   * RNTP has one mutable queue.  Running each user command through this gate
   * prevents a seek/volume/transition interleave from applying to a reset queue.
   */
  private runNativeMutation<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.nativeMutationTail;
    const running = previous ? previous.then(operation) : operation();
    const settled = running.then(
      () => undefined,
      () => undefined,
    );
    this.nativeMutationTail = settled;
    settled.finally(() => {
      if (this.nativeMutationTail === settled) this.nativeMutationTail = null;
    });
    return running;
  }

  private createTransitionContext(
    transitionToken: number,
    isTargetAvailable: () => boolean = () => true,
  ): NativeOperationContext {
    let mutated = false;
    return {
      isCurrent: () => playerState().transitionToken === transitionToken,
      isTargetAvailable,
      markMutation: () => {
        mutated = true;
        this.nativeGeneration += 1;
      },
      markLoaded: (nativeTrackId: string) => {
        this.activeNativeTrackId = nativeTrackId;
        this.activeNativeGeneration = this.nativeGeneration;
        this.activeNativeTrackIndex = 0;
      },
      didMutate: () => mutated,
    };
  }

  markNativeTrackLoaded(nativeTrackId?: string) {
    if (nativeTrackId) this.activeNativeTrackId = nativeTrackId;
    this.activeNativeGeneration = this.nativeGeneration;
    this.restoredNeedsLoad = false;
  }

  markNativeQueueCleared() {
    this.activeNativeTrackId = null;
    this.nativeGeneration += 1;
    this.activeNativeGeneration = this.nativeGeneration;
    this.activeNativeTrackIndex = null;
    this.restoredNeedsLoad = Boolean(playerState().nowPlaying);
  }

  private beginTransition(
    dispatch: Dispatch | undefined,
    isTargetAvailable?: () => boolean,
  ) {
    const state = playerState();
    const transitionToken = Math.max(
      state.transitionToken + 1,
      this.transitionSequence + 1,
    );
    this.transitionSequence = transitionToken;
    emit(dispatch, 'player/beginTransition', transitionToken);
    return {
      transitionToken,
      context: this.createTransitionContext(transitionToken, isTargetAvailable),
    };
  }

  private hasPlaylistTrack(track: PlayableTrack) {
    return playerState().playlist.some(
      item => trackId(item) === trackId(track),
    );
  }

  private hasQueuedOccurrence(occurrenceId: string) {
    return playerState().playNextQueue.some(
      item => item.occurrenceId === occurrenceId,
    );
  }

  private isQueuedOccurrenceHead(occurrenceId: string) {
    return playerState().playNextQueue[0]?.occurrenceId === occurrenceId;
  }

  private hasHistoryEntry(entry: HistoryEntry) {
    return playerState().history.some(
      item =>
        trackId(item.track) === trackId(entry.track) &&
        item.position === entry.position &&
        item.occurrenceId === entry.occurrenceId,
    );
  }

  private runQueueTransition(operation: () => Promise<boolean | void>) {
    if (this.queueTransitionInFlight) return this.queueTransitionInFlight;
    const running = operation();
    this.queueTransitionInFlight = running;
    return running.finally(() => {
      if (this.queueTransitionInFlight === running)
        this.queueTransitionInFlight = null;
    });
  }

  async play(dispatch?: Dispatch) {
    return this.runNativeMutation(() => this.playInternal(dispatch));
  }

  private async playInternal(dispatch?: Dispatch): Promise<boolean> {
    const state = playerState();
    if (!state.nowPlaying) return false;
    if (state.error || this.restoredNeedsLoad) {
      const { context } = this.beginTransition(
        dispatch,
        () => playerState().nowPlaying?.id === state.nowPlaying?.id,
      );
      const started = await loadAndPlay(
        dispatch,
        state.nowPlaying,
        state.position,
        undefined,
        context,
      );
      if (started && isNativeOperationCurrent(context)) {
        this.restoredNeedsLoad = false;
        this.markNativeTrackLoaded();
        emit(dispatch, 'player/setError', null);
        emit(dispatch, 'library/recordRecent', state.nowPlaying);
      }
      return started;
    }
    try {
      await ensurePlayer();
      await configureNativeSnapshot(state);
      await TrackPlayer.play();
      emit(dispatch, 'player/setPlaying', true);
      emit(dispatch, 'player/setError', null);
      return true;
    } catch (error) {
      emit(
        dispatch,
        'player/setError',
        safePlayerError(error, 'playback-unavailable'),
      );
      return false;
    }
  }

  async pause(dispatch?: Dispatch) {
    return this.runNativeMutation(() => this.pauseInternal(dispatch));
  }

  private async pauseInternal(dispatch?: Dispatch): Promise<boolean> {
    try {
      await ensurePlayer();
      await TrackPlayer.pause();
      emit(dispatch, 'player/setPlaying', false);
      return true;
    } catch (error) {
      emit(
        dispatch,
        'player/setError',
        safePlayerError(error, 'playback-unavailable'),
      );
      return false;
    }
  }

  async toggle(dispatch?: Dispatch) {
    if (playerState().isPlaying) return this.pause(dispatch);
    return this.play(dispatch);
  }

  async playTrack(dispatch: Dispatch | undefined, track: PlayableTrack) {
    return this.runNativeMutation(() =>
      this.playTrackInternal(dispatch, track),
    );
  }

  private async playTrackInternal(
    dispatch: Dispatch | undefined,
    track: PlayableTrack,
  ): Promise<boolean> {
    const state = playerState();
    let playlistIndex = state.playlist.indexOf(track);
    if (playlistIndex < 0)
      playlistIndex = state.playlist.findIndex(
        item => trackId(item) === trackId(track),
      );
    if (playlistIndex < 0) {
      playlistIndex = state.playlist.length;
    }
    const { transitionToken, context } = this.beginTransition(
      dispatch,
      playlistIndex === state.playlist.length
        ? undefined
        : () => this.hasPlaylistTrack(track),
    );
    return transition(
      dispatch,
      {
        track,
        playlistIndex,
        source: 'playlist',
        rememberCurrent: Boolean(state.nowPlaying),
        shuffleCursor: state.shuffleOrder.indexOf(playlistIndex),
        appendToPlaylist: playlistIndex === state.playlist.length,
        transitionToken,
      },
      context,
    );
  }

  async playTracks(
    dispatch: Dispatch | undefined,
    tracks: PlayableTrack[],
    startIndex = 0,
  ): Promise<boolean> {
    return this.runNativeMutation(() =>
      this.playTracksInternal(dispatch, tracks, startIndex),
    );
  }

  private async playTracksInternal(
    dispatch: Dispatch | undefined,
    tracks: PlayableTrack[],
    startIndex = 0,
  ): Promise<boolean> {
    const target = tracks[startIndex];
    if (!target) return false;
    const { context } = this.beginTransition(dispatch);
    let media: { url: string; headers?: Readonly<Record<string, string>> };
    try {
      media = await resolveTrackUrl(target);
      assertNativeOperationCurrent(context);
    } catch (error) {
      if (!isNativeOperationCurrent(context)) return false;
      emit(
        dispatch,
        'player/setError',
        safePlayerError(error, 'playback-unavailable'),
      );
      return false;
    }

    const state = playerState();
    let snapshot: NativeRollbackSnapshot | null;
    try {
      await ensurePlayer();
      snapshot = await captureRollbackSnapshot(state);
      assertNativeOperationCurrent(context);
    } catch {
      if (!isNativeOperationCurrent(context)) return false;
      emit(dispatch, 'player/setError', 'playback-transition-unavailable');
      return false;
    }

    try {
      await replaceNativeTrack(target, media, state, context);
    } catch {
      if (!isNativeOperationCurrent(context)) return false;
      if (!snapshot) {
        emit(dispatch, 'player/setPlaying', false);
        emit(dispatch, 'player/setError', 'playback-unavailable');
        return false;
      }
      try {
        await restoreRollbackSnapshot(snapshot, context);
        emit(dispatch, 'player/setPlaying', snapshot.playing);
        emit(dispatch, 'player/setError', 'playback-unavailable');
      } catch {
        try {
          await TrackPlayer.pause();
        } catch {
          // Recovery is bounded to one best-effort native pause.
        }
        emit(dispatch, 'player/setPlaying', false);
        emit(dispatch, 'player/setError', 'playback-recovery-required');
      }
      return false;
    }
    if (!isNativeOperationCurrent(context)) {
      if (context.didMutate()) {
        try {
          await TrackPlayer.pause();
          await TrackPlayer.reset();
        } catch {
          // The authoritative transaction will reload the semantic item.
        }
        this.markNativeQueueCleared();
        emit(dispatch, 'player/setPlaying', false);
      }
      return false;
    }
    this.restoredNeedsLoad = false;
    emit(dispatch, 'player/setPlaying', true);
    emit(dispatch, 'player/replacePlaylist', { tracks, startIndex });
    emit(dispatch, 'library/recordRecent', target);
    return true;
  }

  /**
   * Backup overwrite is a native transaction, not a reducer-only queue edit.
   * It either installs the imported first item paused or clears both native and
   * semantic current-item state while retaining the imported playlist.
   */
  async replacePlaylistForImport(
    dispatch: Dispatch | undefined,
    tracks: PlayableTrack[],
  ): Promise<boolean> {
    // Allocate before entering the native queue so a deferred old bootstrap is
    // stale immediately, rather than being allowed to commit ahead of import.
    const { context } = this.beginTransition(dispatch);
    return this.runNativeMutation(() =>
      this.replacePlaylistForImportInternal(dispatch, tracks, context),
    );
  }

  private async replacePlaylistForImportInternal(
    dispatch: Dispatch | undefined,
    tracks: PlayableTrack[],
    context: NativeOperationContext,
  ): Promise<boolean> {
    const target = tracks[0];
    let media: {
      url: string;
      headers?: Readonly<Record<string, string>>;
    } | null = null;
    if (target) {
      try {
        media = await resolveTrackUrl(target);
        assertNativeOperationCurrent(context);
      } catch {
        if (!isNativeOperationCurrent(context)) return false;
        // A backup remains useful when its first provider item has expired.
        // Commit it with no active item after clearing the old native queue.
        media = null;
      }
    }
    const priorState = playerState();
    let rollback: NativeRollbackSnapshot | null;
    try {
      await ensurePlayer();
      rollback = await captureRollbackSnapshot(priorState);
      assertNativeOperationCurrent(context);
    } catch {
      if (!isNativeOperationCurrent(context)) return false;
      // Do not reset RNTP unless the existing semantic item has a native
      // snapshot we can restore.  An empty semantic player intentionally has
      // no snapshot and may still proceed with an import.
      if (priorState.nowPlaying) {
        emit(dispatch, 'player/setError', 'playback-transition-unavailable');
        return false;
      }
      rollback = null;
    }
    try {
      context.markMutation();
      await TrackPlayer.stop();
      assertNativeOperationCurrent(context);
      await TrackPlayer.reset();
      assertNativeOperationCurrent(context);
      if (target && media) {
        const nativeTrack = asNativeTrack(target, media);
        await TrackPlayer.add(nativeTrack as any);
        context.markLoaded(nativeTrack.id, target);
        await configureNativeSnapshot(playerState(), context);
        assertNativeOperationCurrent(context);
        await TrackPlayer.pause();
        emit(dispatch, 'player/replacePlaylist', { tracks, startIndex: 0 });
        emit(dispatch, 'player/setPlaying', false);
        this.restoredNeedsLoad = false;
        return true;
      }
      this.markNativeQueueCleared();
      emit(dispatch, 'player/replacePlaylist', { tracks, startIndex: -1 });
      emit(dispatch, 'player/setPlaying', false);
      return true;
    } catch (error) {
      if (!isNativeOperationCurrent(context)) return false;
      if (context.didMutate() && rollback) {
        try {
          await restoreRollbackSnapshot(rollback, context);
          this.markNativeTrackLoaded();
          emit(dispatch, 'player/setPlaying', rollback.playing);
          emit(dispatch, 'player/setError', 'playback-unavailable');
          return false;
        } catch {
          try {
            await TrackPlayer.pause();
          } catch {
            // Recovery is bounded to a single best-effort native pause.
          }
          // The old semantic queue remains authoritative, but RNTP can no
          // longer be trusted.  Force the next Play through a fresh load.
          this.markNativeQueueCleared();
          emit(dispatch, 'player/setPlaying', false);
          emit(dispatch, 'player/setError', 'playback-recovery-required');
          return false;
        }
      }
      if (context.didMutate()) {
        this.markNativeQueueCleared();
        emit(dispatch, 'player/setPlaying', false);
      }
      emit(
        dispatch,
        'player/setError',
        safePlayerError(error, 'playback-unavailable'),
      );
      return false;
    }
  }

  async next(dispatch?: Dispatch) {
    return this.runQueueTransition(() =>
      this.runNativeMutation(() => this.nextInternal(dispatch)),
    );
  }

  private async nextInternal(dispatch?: Dispatch): Promise<boolean | void> {
    const state = playerState();
    if (state.playNextQueue.length) {
      const occurrence = state.playNextQueue[0];
      const { transitionToken, context } = this.beginTransition(dispatch, () =>
        this.isQueuedOccurrenceHead(occurrence.occurrenceId),
      );
      return transition(
        dispatch,
        {
          track: occurrence.track,
          playlistIndex: state.currentIndex,
          source: 'play-next',
          rememberCurrent: Boolean(state.nowPlaying),
          currentOccurrenceId: occurrence.occurrenceId,
          transitionToken,
          consumePlayNext: {
            occurrenceId: occurrence.occurrenceId,
            transitionToken,
          },
        },
        context,
      );
    }
    const target = nextPlaylistTarget(state);
    if (!target) return this.pause(dispatch);
    const { transitionToken, context } = this.beginTransition(dispatch, () =>
      this.hasPlaylistTrack(state.playlist[target.index]),
    );
    return transition(
      dispatch,
      {
        track: state.playlist[target.index],
        playlistIndex: target.index,
        source: 'playlist',
        rememberCurrent: Boolean(state.nowPlaying),
        shuffleOrder: target.shuffleOrder,
        shuffleCursor: target.shuffleCursor,
        transitionToken,
      },
      context,
    );
  }

  async playQueuedAt(dispatch: Dispatch | undefined, occurrenceId: string) {
    return this.runQueueTransition(() =>
      this.runNativeMutation(() =>
        this.playQueuedOccurrence(dispatch, occurrenceId),
      ),
    );
  }

  private async playQueuedOccurrence(
    dispatch: Dispatch | undefined,
    occurrenceId: string,
  ) {
    const state = playerState();
    const occurrence = state.playNextQueue.find(
      item => item.occurrenceId === occurrenceId,
    );
    if (!occurrence) return false;
    const { transitionToken, context } = this.beginTransition(dispatch, () =>
      this.hasQueuedOccurrence(occurrence.occurrenceId),
    );
    return transition(
      dispatch,
      {
        track: occurrence.track,
        playlistIndex: state.currentIndex,
        source: 'play-next',
        rememberCurrent: Boolean(state.nowPlaying),
        currentOccurrenceId: occurrence.occurrenceId,
        transitionToken,
        consumePlayNext: {
          occurrenceId: occurrence.occurrenceId,
          transitionToken,
        },
      },
      context,
    );
  }

  async previous(dispatch?: Dispatch) {
    return this.runNativeMutation(() => this.previousInternal(dispatch));
  }

  private async previousInternal(dispatch?: Dispatch): Promise<boolean> {
    const state = playerState();
    const entry = state.history[state.history.length - 1];
    if (!entry) return false;
    const { context } = this.beginTransition(dispatch, () =>
      this.hasHistoryEntry(entry),
    );
    const remaining = state.history.slice(0, -1);
    let media: { url: string; headers?: Readonly<Record<string, string>> };
    try {
      media = await resolveTrackUrl(entry.track);
      assertNativeOperationCurrent(context);
    } catch (error) {
      if (!isNativeOperationCurrent(context)) return false;
      emit(
        dispatch,
        'player/setError',
        safePlayerError(error, 'playback-unavailable'),
      );
      return false;
    }
    const started = await loadAndPlay(
      dispatch,
      entry.track,
      entry.position,
      media,
      context,
    );
    if (started && isNativeOperationCurrent(context))
      emit(dispatch, 'player/restoreHistory', { entry, remaining });
    return started;
  }

  async seek(dispatch: Dispatch | undefined, position: number) {
    if (
      !Number.isFinite(position) ||
      position < 0 ||
      position > MAX_SEEK_SECONDS
    ) {
      emit(dispatch, 'player/setError', 'seek-unavailable');
      return false;
    }
    return this.runNativeMutation(() => this.seekInternal(dispatch, position));
  }

  private async seekInternal(
    dispatch: Dispatch | undefined,
    target: number,
  ): Promise<boolean> {
    try {
      await ensurePlayer();
      await TrackPlayer.seekTo(target);
      emit(dispatch, 'player/setProgress', { position: target });
      return true;
    } catch (error) {
      emit(
        dispatch,
        'player/setError',
        safePlayerError(error, 'seek-unavailable'),
      );
      return false;
    }
  }

  async setVolume(dispatch: Dispatch | undefined, volume: number) {
    if (!Number.isFinite(volume) || volume < 0 || volume > 1) {
      emit(dispatch, 'player/setError', 'volume-unavailable');
      return false;
    }
    return this.runNativeMutation(() =>
      this.setVolumeInternal(dispatch, volume),
    );
  }

  private async setVolumeInternal(
    dispatch: Dispatch | undefined,
    target: number,
  ): Promise<boolean> {
    try {
      await ensurePlayer();
      await TrackPlayer.setVolume(playerState().muted ? 0 : target);
      emit(dispatch, 'player/setVolumeSnapshot', target);
      return true;
    } catch (error) {
      emit(
        dispatch,
        'player/setError',
        safePlayerError(error, 'volume-unavailable'),
      );
      return false;
    }
  }

  async setMuted(dispatch: Dispatch | undefined, muted: boolean) {
    if (typeof muted !== 'boolean') return false;
    return this.runNativeMutation(() => this.setMutedInternal(dispatch, muted));
  }

  private async setMutedInternal(
    dispatch: Dispatch | undefined,
    muted: boolean,
  ): Promise<boolean> {
    try {
      await ensurePlayer();
      await TrackPlayer.setVolume(muted ? 0 : playerState().volume);
      emit(dispatch, 'player/setMutedSnapshot', muted);
      return true;
    } catch (error) {
      emit(
        dispatch,
        'player/setError',
        safePlayerError(error, 'volume-unavailable'),
      );
      return false;
    }
  }

  async setMode(dispatch: Dispatch | undefined, mode: PlayerState['playMode']) {
    if (
      mode !== PLAY_MODE.LOOP &&
      mode !== PLAY_MODE.SHUFFLE &&
      mode !== PLAY_MODE.REPEAT_ONE
    ) {
      emit(dispatch, 'player/setError', 'mode-unavailable');
      return false;
    }
    return this.runNativeMutation(() => this.setModeInternal(dispatch, mode));
  }

  private async setModeInternal(
    dispatch: Dispatch | undefined,
    mode: PlayerState['playMode'],
  ): Promise<boolean> {
    const previousMode = playerState().playMode;
    try {
      await ensurePlayer();
      await configureNativeSnapshot({ ...playerState(), playMode: mode });
      emit(dispatch, 'player/setPlayModeSnapshot', mode);
      return true;
    } catch (error) {
      emit(dispatch, 'player/setPlayModeSnapshot', previousMode);
      emit(
        dispatch,
        'player/setError',
        safePlayerError(error, 'mode-unavailable'),
      );
      return false;
    }
  }

  async stop(dispatch?: Dispatch): Promise<boolean> {
    // Stop is semantic cancellation as well as a native reset. Do this before
    // queueing behind a provider resolution so RemoteStop cannot briefly load
    // and announce the stale item.
    this.beginTransition(dispatch);
    return this.runNativeMutation(async () => {
      try {
        await ensurePlayer();
        await TrackPlayer.stop();
        await TrackPlayer.reset();
        this.markNativeQueueCleared();
        emit(dispatch, 'player/setPlaying', false);
        emit(dispatch, 'player/setProgress', { position: 0 });
        return true;
      } catch (error) {
        emit(
          dispatch,
          'player/setError',
          safePlayerError(error, 'playback-unavailable'),
        );
        return false;
      }
    });
  }

  async forgetTrack(dispatch: Dispatch | undefined, track: PlayableTrack) {
    const removedCurrent = playerState().nowPlaying?.id === track.id;
    // Invalidate before waiting behind a pending native command. Otherwise a
    // deferred provider resolution can re-add an item that the catalog has
    // already forgotten.
    emit(dispatch, 'player/removeTrackReferences', track.id);
    return this.runNativeMutation(async () => {
      if (!removedCurrent || this.hasPlaylistTrack(track)) return;
      try {
        await ensurePlayer();
        // A later import may have reintroduced this logical ID while this
        // deletion waited for the native queue. Do not reset that new item.
        if (this.hasPlaylistTrack(track)) return;
        await TrackPlayer.stop();
        await TrackPlayer.reset();
        this.markNativeQueueCleared();
      } catch {
        // The catalog must still forget an item if native playback is gone.
      }
    });
  }

  onProgress(
    position: number,
    duration: number,
    bufferedPosition: number,
    identity?: NativeCallbackIdentity,
  ) {
    if (!this.isNativeCallbackCurrent(identity)) return;
    emit(undefined, 'player/setProgress', {
      position,
      duration,
      bufferedPosition,
    });
  }

  onPlaybackState(nativeState: State, identity?: NativeCallbackIdentity) {
    if (!this.isNativeCallbackCurrent(identity)) return;
    emit(undefined, 'player/setPlaying', nativeState === State.Playing);
  }

  onPlaybackError(identity?: NativeCallbackIdentity) {
    if (!this.isNativeCallbackCurrent(identity)) return;
    this.restoredNeedsLoad = true;
    emit(undefined, 'player/setPlaying', false);
    emit(undefined, 'player/setError', 'native-playback-error');
  }

  onPlaybackQueueEnded(identity?: NativeCallbackIdentity) {
    if (!this.isNativeCallbackCurrent(identity)) return false;
    return this.next();
  }

  onNativeActiveTrackChanged(
    track: unknown,
    nativeTrackIndex?: number,
  ): NativeCallbackIdentity | null {
    const nativeTrackId =
      track && typeof track === 'object' && 'id' in track
        ? (track as { id?: unknown }).id
        : undefined;
    if (
      typeof nativeTrackId !== 'string' ||
      nativeTrackId !== this.activeNativeTrackId ||
      this.activeNativeGeneration !== this.nativeGeneration
    )
      return null;
    this.activeNativeTrackIndex =
      typeof nativeTrackIndex === 'number' && nativeTrackIndex >= 0
        ? nativeTrackIndex
        : 0;
    this.activeNativeGeneration = this.nativeGeneration;
    return {
      nativeTrackId: this.activeNativeTrackId,
      generation: this.activeNativeGeneration,
      nativeTrackIndex: this.activeNativeTrackIndex,
    };
  }

  private isNativeCallbackCurrent(identity?: NativeCallbackIdentity) {
    // PlaybackState and PlaybackError omit an RNTP track identity.  They can
    // arrive late after a reset/load, so treating them as whichever item is
    // current would let A mutate B.  Only callbacks closed over an identity
    // observed in PlaybackActiveTrackChanged are allowed through.
    if (!identity) return false;
    return (
      identity.nativeTrackId === this.activeNativeTrackId &&
      identity.generation === this.activeNativeGeneration &&
      (identity.nativeTrackIndex === undefined ||
        identity.nativeTrackIndex === this.activeNativeTrackIndex)
    );
  }

  snapshot(): PlayerState {
    return playerState();
  }

  resetForTests() {
    this.queueTransitionInFlight = null;
    this.nativeMutationTail = null;
    this.transitionSequence = 0;
    this.restoredNeedsLoad = false;
    this.nativeGeneration = 0;
    this.activeNativeTrackId = null;
    this.activeNativeGeneration = 0;
    this.activeNativeTrackIndex = null;
  }

  async restore(): Promise<boolean> {
    return this.runNativeMutation(() => this.restoreInternal());
  }

  private async restoreInternal(): Promise<boolean> {
    const state = playerState();
    if (!state.nowPlaying) return false;
    this.restoredNeedsLoad = true;
    // Rehydration restores semantic state for the UI only. Media resolution
    // and native loading wait for an explicit user play command.
    try {
      await ensurePlayer();
      await TrackPlayer.pause();
      await configureNativeSnapshot(state);
      emit(undefined, 'player/setPlaying', false);
      return true;
    } catch (error) {
      try {
        await TrackPlayer.pause();
      } catch {
        // Configuration is nonessential; native silence remains the contract.
      }
      emit(
        undefined,
        'player/setError',
        safePlayerError(error, 'playback-unavailable'),
      );
      emit(undefined, 'player/setPlaying', false);
      return false;
    }
  }
}

export const playerController = new PlayerController();

/** Test isolation only: production config is intentionally initialized once. */
export function resetPlayerControllerForTests() {
  runtime = null;
  setupPromise = null;
  playerController.resetForTests();
}
export type { HistoryEntry };
