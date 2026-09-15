const mockNativePlayer = {
  setupPlayer: jest.fn().mockResolvedValue(undefined),
  updateOptions: jest.fn().mockResolvedValue(undefined),
  setRepeatMode: jest.fn().mockResolvedValue(undefined),
  setVolume: jest.fn().mockResolvedValue(undefined),
  reset: jest.fn().mockResolvedValue(undefined),
  add: jest.fn().mockResolvedValue(undefined),
  seekTo: jest.fn().mockResolvedValue(undefined),
  play: jest.fn().mockResolvedValue(undefined),
  pause: jest.fn().mockResolvedValue(undefined),
  stop: jest.fn().mockResolvedValue(undefined),
  getActiveTrack: jest.fn(),
  getProgress: jest.fn(),
  getPlaybackState: jest.fn(),
};
const mockResolveMedia = jest.fn();
const SAFE_MEDIA_URI = 'content://com.dazzlingwuming.listen2.media/lease/' + 'a'.repeat(48);
const nativeMediaFixture = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const result = { ...(value as Record<string, unknown>) };
  const playableUri =
    typeof result.playableUri === 'string' ? result.playableUri : SAFE_MEDIA_URI;
  delete result.url;
  delete result.headers;
  return { ...result, playableUri };
};
const mockResolveVerified = jest.fn().mockResolvedValue({ status: 'miss' });
const mockInvalidate = jest.fn().mockResolvedValue({});
const mockPrepareLocalPlayback = jest.fn();

jest.mock('react-native-track-player', () => ({
  __esModule: true,
  default: {
    setupPlayer: (...args: unknown[]) => mockNativePlayer.setupPlayer(...args),
    updateOptions: (...args: unknown[]) =>
      mockNativePlayer.updateOptions(...args),
    setRepeatMode: (...args: unknown[]) =>
      mockNativePlayer.setRepeatMode(...args),
    setVolume: (...args: unknown[]) => mockNativePlayer.setVolume(...args),
    reset: (...args: unknown[]) => mockNativePlayer.reset(...args),
    add: (...args: unknown[]) => mockNativePlayer.add(...args),
    seekTo: (...args: unknown[]) => mockNativePlayer.seekTo(...args),
    play: (...args: unknown[]) => mockNativePlayer.play(...args),
    pause: (...args: unknown[]) => mockNativePlayer.pause(...args),
    stop: (...args: unknown[]) => mockNativePlayer.stop(...args),
    getActiveTrack: (...args: unknown[]) =>
      mockNativePlayer.getActiveTrack(...args),
    getProgress: (...args: unknown[]) => mockNativePlayer.getProgress(...args),
    getPlaybackState: (...args: unknown[]) =>
      mockNativePlayer.getPlaybackState(...args),
  },
  Capability: {
    Play: 'play',
    Pause: 'pause',
    Stop: 'stop',
    SkipToNext: 'next',
    SkipToPrevious: 'previous',
    SeekTo: 'seek',
  },
  RepeatMode: { Track: 'track', Off: 'off' },
  State: { Playing: 'playing' },
}));

jest.mock('../../api/client', () => ({
  providerClient: {
    resolveMedia: (...args: unknown[]) => Promise.resolve(mockResolveMedia(...args)).then(nativeMediaFixture),
  },
}));
jest.mock('../../offline/offlineAudio', () => ({
  isOfflineDownloadEligible: (value: any) =>
    value?.source === 'netease' || value?.source === 'kugou',
  offlineAudio: {
    resolveVerified: (...args: unknown[]) => mockResolveVerified(...args),
    invalidate: (...args: unknown[]) => mockInvalidate(...args),
  },
}));

import reducer, {
  playerActions,
  type PlayerState,
} from '../../store/playerSlice';
import {
  configurePlayerController,
  playerController,
} from '../playerController';
import type { Track } from '../../types/music';
import type { LocalTrack } from '../../types/music';
import { NativeModules, Platform } from 'react-native';
import { playerErrorCopy } from '../playerErrorCopy';

const track = (id: string): Track => ({
  id,
  source: 'netease',
  title: id,
  artist: 'Listen2',
});
const localTrack = (id: string): LocalTrack => ({
  id: '11111111-1111-4111-8111-111111111111',
  source: 'local',
  title: id,
  artist: '本地音频',
  accessStatus: 'available',
});
const bilibiliTrack = (id = 'bitrack_v_BV1xx411c7mD-456'): Track => ({
  id,
  source: 'bilibili',
  title: '精确分段',
  artist: '上传者',
});

async function waitForBootstrapStart() {
  for (
    let turn = 0;
    turn < 10 && mockResolveMedia.mock.calls.length === 0;
    turn += 1
  )
    await Promise.resolve();
  expect(mockResolveMedia).toHaveBeenCalled();
}

describe('PlayerController queue transitions', () => {
  let state: PlayerState;
  const dispatch = (action: unknown) => {
    state = reducer(state, action as any);
    return action;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveMedia.mockReset();
    mockNativePlayer.add.mockReset().mockResolvedValue(undefined);
    mockNativePlayer.reset.mockReset().mockResolvedValue(undefined);
    mockNativePlayer.play.mockReset().mockResolvedValue(undefined);
    mockNativePlayer.pause.mockReset().mockResolvedValue(undefined);
    mockNativePlayer.stop.mockReset().mockResolvedValue(undefined);
    mockNativePlayer.setRepeatMode.mockReset().mockResolvedValue(undefined);
    mockNativePlayer.setVolume.mockReset().mockResolvedValue(undefined);
    mockNativePlayer.getActiveTrack
      .mockReset()
      .mockResolvedValue({ url: SAFE_MEDIA_URI });
    mockNativePlayer.getProgress.mockReset().mockResolvedValue({ position: 0 });
    mockNativePlayer.getPlaybackState
      .mockReset()
      .mockResolvedValue({ state: 'playing' });
    mockResolveVerified.mockResolvedValue({ status: 'miss' });
    mockPrepareLocalPlayback.mockReset();
    Object.defineProperty(NativeModules, 'Listen2LocalAudio', {
      configurable: true,
      value: {
        prepareLocalPlayback: (...args: unknown[]) =>
          mockPrepareLocalPlayback(...args),
      },
    });
    Object.defineProperty(Platform, 'Version', {
      value: 32,
      configurable: true,
    });
    state = reducer(undefined, { type: 'test/init' });
    configurePlayerController({ dispatch, getPlayerState: () => state });
  });

  it('does not consume play-next when bootstrap fails', async () => {
    const current = track('netrack_1');
    const queued = track('netrack_2');
    state = reducer(
      state,
      playerActions.replacePlaylist({ tracks: [current] }),
    );
    state = reducer(state, playerActions.setPlaying(true));
    state = reducer(state, playerActions.enqueueNext(queued));
    mockResolveMedia.mockRejectedValueOnce(new Error('PLAYBACK_UNAVAILABLE'));

    await playerController.next(dispatch);

    expect(state.currentTrack?.id).toBe(current.id);
    expect(state.playNextQueue.map(item => item.track.id)).toEqual([queued.id]);
  });

  it('consumes exactly the selected queued occurrence after bootstrap', async () => {
    const first = track('netrack_2');
    const selected = track('netrack_3');
    state = reducer(
      state,
      playerActions.replacePlaylist({ tracks: [track('netrack_1')] }),
    );
    state = reducer(state, playerActions.enqueueNext(first));
    state = reducer(state, playerActions.enqueueNext(selected));
    mockResolveMedia.mockResolvedValueOnce({
      trackId: selected.id,
      source: selected.source,
      url: SAFE_MEDIA_URI,
    });
    expect(state.playNextQueue.map(item => item.track.id)).toEqual([
      first.id,
      selected.id,
    ]);
    expect(playerController.snapshot().playNextQueue).toHaveLength(2);
    await playerController.playQueuedAt(
      dispatch,
      state.playNextQueue[1].occurrenceId,
    );

    // Diagnostic assertion keeps failures readable without exposing provider data.
    expect(mockResolveMedia).toHaveBeenCalledWith(selected, expect.any(AbortSignal));

    expect(state.currentTrack?.id).toBe(selected.id);
    expect(state.playNextQueue.map(item => item.track.id)).toEqual([first.id]);
    expect(mockNativePlayer.add).toHaveBeenCalledTimes(1);
  });

  it('coalesces rapid next callbacks so one accepted transition consumes one row', async () => {
    const first = track('netrack_2');
    const second = track('netrack_3');
    state = reducer(
      state,
      playerActions.replacePlaylist({ tracks: [track('netrack_1')] }),
    );
    state = reducer(state, playerActions.enqueueNext(first));
    state = reducer(state, playerActions.enqueueNext(second));
    let resolveBootstrap!: (value: { url: string }) => void;
    mockResolveMedia.mockImplementationOnce(
      () =>
        new Promise<{ url: string }>(resolve => {
          resolveBootstrap = resolve;
        }),
    );

    const firstNext = playerController.next(dispatch);
    const secondNext = playerController.next(dispatch);
    await waitForBootstrapStart();
    expect(mockResolveMedia).toHaveBeenCalledTimes(1);
    resolveBootstrap({ url: SAFE_MEDIA_URI });
    await Promise.all([firstNext, secondNext]);

    expect(state.currentTrack?.id).toBe(first.id);
    expect(state.playNextQueue.map(item => item.track.id)).toEqual([second.id]);
  });

  it('aborts a superseded QQ selection before a ready Kuwo selection can mutate RNTP', async () => {
    const qq = { ...track('qqtrack_001'), source: 'qq' as const };
    const kuwo = { ...track('kwtrack_123456'), source: 'kuwo' as const };
    let resolveQq!: (value: { url: string }) => void;
    mockResolveMedia
      .mockImplementationOnce(
        () => new Promise<{ url: string }>(resolve => { resolveQq = resolve; }),
      )
      .mockResolvedValueOnce({ url: SAFE_MEDIA_URI });

    const stale = playerController.playTrack(dispatch, qq);
    await waitForBootstrapStart();
    const staleSignal = mockResolveMedia.mock.calls[0][1] as AbortSignal;
    const current = playerController.playTrack(dispatch, kuwo);
    await expect(stale).resolves.toBe(false);
    await expect(current).resolves.toBe(true);
    expect(staleSignal.aborted).toBe(true);
    expect(mockNativePlayer.add).toHaveBeenCalledTimes(1);
    expect(mockNativePlayer.add).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: expect.stringContaining(kuwo.id) }),
    );
    resolveQq({ url: SAFE_MEDIA_URI });
  });

  it('keeps the current track and queued occurrence when native loading fails', async () => {
    const current = track('netrack_1');
    const queued = track('netrack_2');
    state = reducer(
      state,
      playerActions.replacePlaylist({ tracks: [current] }),
    );
    state = reducer(state, playerActions.setPlaying(true));
    state = reducer(state, playerActions.enqueueNext(queued));
    mockResolveMedia.mockResolvedValueOnce({
      trackId: queued.id,
      source: queued.source,
      url: SAFE_MEDIA_URI,
    });
    mockNativePlayer.add.mockRejectedValueOnce(new Error('native-load-failed'));

    await playerController.next(dispatch);

    expect(state.currentTrack?.id).toBe(current.id);
    expect(state.playNextQueue.map(item => item.track.id)).toEqual([queued.id]);
    expect(state.error).toBe('playback-unavailable');
    expect(state.isPlaying).toBe(true);
  });

  it('does not expose an opaque local record as a content URI', async () => {
    const local = localTrack('local_1');
    state = reducer(
      state,
      playerActions.replacePlaylist({ tracks: [track('netrack_1')] }),
    );
    state = reducer(state, playerActions.enqueueNext(local));

    await playerController.next(dispatch);

    expect(mockResolveMedia).not.toHaveBeenCalled();
    expect(state.currentTrack?.id).toBe('netrack_1');
    expect(state.playNextQueue.map(item => item.track.id)).toEqual([local.id]);
    expect(mockNativePlayer.add).not.toHaveBeenCalled();
  });

  it('uses a verified cache hit before provider bootstrap', async () => {
    const queued = track('netrack_2');
    state = reducer(
      state,
      playerActions.replacePlaylist({ tracks: [track('netrack_1')] }),
    );
    state = reducer(state, playerActions.enqueueNext(queued));
    mockResolveVerified.mockResolvedValueOnce({
      status: 'hit',
      uri: SAFE_MEDIA_URI,
      mimeType: 'audio/mpeg',
    });
    await playerController.next(dispatch);
    expect(mockResolveMedia).not.toHaveBeenCalled();
    expect(mockNativePlayer.add).toHaveBeenCalledWith(
      expect.objectContaining({ url: SAFE_MEDIA_URI }),
    );
  });

  it('keeps a validated Bilibili handoff transient until the single native add', async () => {
    const selected = bilibiliTrack();
    const signedUrl = SAFE_MEDIA_URI;
    mockResolveMedia.mockResolvedValueOnce({
      trackId: selected.id,
      source: selected.source,
      url: signedUrl,
      headers: { Referer: SAFE_MEDIA_URI },
    });
    await playerController.playTracks(dispatch, [selected]);
    expect(mockResolveMedia).toHaveBeenCalledWith(selected, expect.any(AbortSignal));
    expect(mockNativePlayer.add).toHaveBeenCalledWith(
      expect.objectContaining({ url: signedUrl }),
    );
    expect(JSON.stringify(state)).not.toContain(signedUrl);
    expect(JSON.stringify(state)).not.toContain('Referer');
  });

  it('aborts a superseded Bilibili parts transition before only the latest part mutates RNTP', async () => {
    const first = bilibiliTrack('bitrack_v_BV1xx411c7mD-12');
    const second = bilibiliTrack('bitrack_v_BV1xx411c7mD-13');
    mockResolveMedia
      .mockImplementationOnce(
        (_track: Track, signal?: AbortSignal) =>
          new Promise<{ url: string }>((_resolve, reject) => {
            signal?.addEventListener(
              'abort',
              () => reject({ code: 'CANCELLED' }),
              { once: true },
            );
          }),
      )
      .mockResolvedValueOnce({
        url: SAFE_MEDIA_URI,
        headers: { Referer: SAFE_MEDIA_URI },
      });

    const stale = playerController.playTracks(dispatch, [first]);
    await waitForBootstrapStart();
    const staleSignal = mockResolveMedia.mock.calls[0][1] as AbortSignal;
    const current = playerController.playTracks(dispatch, [second]);

    await expect(stale).resolves.toBe(false);
    await expect(current).resolves.toBe(true);
    expect(staleSignal.aborted).toBe(true);
    expect(mockNativePlayer.reset).toHaveBeenCalledTimes(1);
    expect(mockNativePlayer.add).toHaveBeenCalledTimes(1);
    expect(mockNativePlayer.add).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: expect.stringContaining(second.id) }),
    );
  });

  it.each([
    'LOGIN_REQUIRED',
    'MEMBERSHIP_REQUIRED',
    'REGION_RESTRICTED',
    'DRM_RESTRICTED',
    'REQUEST_TIMEOUT',
    'CANCELLED',
  ])('preserves the typed Bilibili provider error %s', async code => {
    mockResolveMedia.mockRejectedValueOnce({ code });
    await playerController.playTracks(dispatch, [bilibiliTrack()]);
    expect(state.error).toBe(code);
    expect(mockResolveMedia).toHaveBeenCalledTimes(1);
  });

  it('uses exactly one online bootstrap after a cache miss or corrupt result', async () => {
    const queued = track('netrack_2');
    state = reducer(
      state,
      playerActions.replacePlaylist({ tracks: [track('netrack_1')] }),
    );
    state = reducer(state, playerActions.enqueueNext(queued));
    mockResolveVerified.mockResolvedValueOnce({ status: 'corrupt' });
    mockResolveMedia.mockResolvedValueOnce({
      url: SAFE_MEDIA_URI,
    });

    await playerController.next(dispatch);

    expect(mockResolveVerified).toHaveBeenCalledWith('netease', queued.id);
    expect(mockResolveMedia).toHaveBeenCalledTimes(1);
    expect(state.playNextQueue).toEqual([]);
  });

  it('invalidates a cache load failure and performs one online fallback', async () => {
    const queued = track('netrack_2');
    state = reducer(
      state,
      playerActions.replacePlaylist({ tracks: [track('netrack_1')] }),
    );
    state = reducer(state, playerActions.enqueueNext(queued));
    mockResolveVerified.mockResolvedValueOnce({
      status: 'hit',
      uri: SAFE_MEDIA_URI,
      mimeType: 'audio/mpeg',
    });
    mockNativePlayer.add.mockRejectedValueOnce(new Error('cache-load-failed'));
    mockResolveMedia.mockResolvedValueOnce({
      url: SAFE_MEDIA_URI,
    });
    await playerController.next(dispatch);
    expect(mockInvalidate).toHaveBeenCalledWith('netease', queued.id);
    expect(mockResolveMedia).toHaveBeenCalledTimes(1);
    expect(state.playNextQueue).toEqual([]);
  });

  it('keeps the transaction unchanged when cache fallback and online bootstrap fail', async () => {
    const current = track('netrack_1');
    const queued = track('netrack_2');
    state = reducer(
      state,
      playerActions.replacePlaylist({ tracks: [current] }),
    );
    state = reducer(state, playerActions.setPlaying(true));
    state = reducer(state, playerActions.enqueueNext(queued));
    mockResolveVerified.mockResolvedValueOnce({
      status: 'hit',
      uri: SAFE_MEDIA_URI,
      mimeType: 'audio/mpeg',
    });
    mockNativePlayer.add.mockRejectedValueOnce(new Error('cache-load-failed'));
    mockResolveMedia.mockRejectedValueOnce(new Error('online-failed'));

    await playerController.next(dispatch);

    expect(mockInvalidate).toHaveBeenCalledWith('netease', queued.id);
    expect(mockResolveMedia).toHaveBeenCalledTimes(1);
    expect(state.currentTrack?.id).toBe(current.id);
    expect(state.playNextQueue.map(item => item.track.id)).toEqual([queued.id]);
  });

  it('never stores content or provider locations from rejected playback errors', async () => {
    const queued = track('netrack_2');
    state = reducer(
      state,
      playerActions.replacePlaylist({ tracks: [track('netrack_1')] }),
    );
    state = reducer(state, playerActions.enqueueNext(queued));
    mockResolveMedia.mockRejectedValueOnce(
      new Error(
        SAFE_MEDIA_URI,
      ),
    );

    await playerController.next(dispatch);

    expect(state.error).toBe('playback-unavailable');
    expect(state.error).not.toContain(SAFE_MEDIA_URI);
    expect(state.error).not.toContain('content://');
    expect(playerErrorCopy(state.error)).toBe('播放暂不可用，请稍后重试。');
    expect(playerErrorCopy(SAFE_MEDIA_URI)).toBe(
      '播放暂不可用，请稍后重试。',
    );
  });

  it('does not query offline storage for an unsupported provider', async () => {
    const unsupported = { ...track('qqtrack_1'), source: 'qq' as const };
    state = reducer(
      state,
      playerActions.replacePlaylist({ tracks: [track('netrack_1')] }),
    );
    state = reducer(state, playerActions.enqueueNext(unsupported));
    mockResolveMedia.mockResolvedValueOnce({
      url: SAFE_MEDIA_URI,
    });

    await playerController.next(dispatch);

    expect(mockResolveVerified).not.toHaveBeenCalled();
    expect(mockResolveMedia).toHaveBeenCalledWith(unsupported, expect.any(AbortSignal));
  });

  it('does not consume a local queued track when native loading fails', async () => {
    const local = localTrack('local_2');
    state = reducer(
      state,
      playerActions.replacePlaylist({ tracks: [track('netrack_1')] }),
    );
    state = reducer(state, playerActions.enqueueNext(local));
    mockNativePlayer.add.mockRejectedValueOnce(new Error('native-load-failed'));

    await playerController.next(dispatch);

    expect(mockResolveMedia).not.toHaveBeenCalled();
    expect(state.playNextQueue.map(item => item.track.id)).toEqual([local.id]);
    expect(state.error).toBe('local-media-unavailable');
  });

  it('hands an opaque local record directly to RNTP without persisting its private provider URI', async () => {
    const local = localTrack('local_handoff');
    mockPrepareLocalPlayback.mockImplementationOnce(
      (recordId: string, playbackRequestId: string) =>
        Promise.resolve({
          recordId,
          playbackRequestId,
          status: 'success',
          privatePlaybackUri:
            'content://com.dazzlingwuming.listen2.local-media/play/abcdefghijklmnopqrstuvwxyzABCDEF',
          seekable: true,
        }),
    );

    await expect(playerController.playTrack(dispatch, local)).resolves.toBe(true);

    expect(mockPrepareLocalPlayback).toHaveBeenCalledWith(local.id, expect.stringMatching(/^local_play_/));
    expect(mockNativePlayer.add).toHaveBeenCalledWith(expect.objectContaining({
      url: 'content://com.dazzlingwuming.listen2.local-media/play/abcdefghijklmnopqrstuvwxyzABCDEF',
    }));
    expect(JSON.stringify(state)).not.toContain('.local-media/play/');
  });

  it('stops native playback and purges a forgotten current local track', async () => {
    const local = localTrack('local_3');
    state = reducer(
      state,
      playerActions.replacePlaylist({ tracks: [local, track('netrack_1')] }),
    );
    state = reducer(state, playerActions.enqueueNext(local));

    await playerController.forgetTrack(dispatch, local);

    expect(mockNativePlayer.stop).toHaveBeenCalledTimes(1);
    expect(state.currentTrack).toBeNull();
    expect(state.playlist.map(item => item.id)).toEqual(['netrack_1']);
    expect(state.playNextQueue).toEqual([]);
  });

  it('does not commit a queued transition after the queue is cleared while resolving', async () => {
    const current = track('netrack_1');
    const queued = track('netrack_2');
    state = reducer(
      state,
      playerActions.replacePlaylist({ tracks: [current] }),
    );
    state = reducer(state, playerActions.enqueueNext(queued));
    let resolveBootstrap!: (value: { url: string }) => void;
    mockResolveMedia.mockImplementationOnce(
      () =>
        new Promise<{ url: string }>(resolve => {
          resolveBootstrap = resolve;
        }),
    );

    const pending = playerController.next(dispatch);
    await waitForBootstrapStart();
    dispatch(playerActions.clearPlayNextQueue());
    resolveBootstrap({ url: SAFE_MEDIA_URI });
    await pending;

    expect(state.currentTrack?.id).toBe(current.id);
    expect(state.playNextQueue).toEqual([]);
  });

  it('invalidates a deferred next when its requested occurrence is moved behind a new head', async () => {
    const current = track('netrack_1');
    const first = track('netrack_2');
    const second = track('netrack_3');
    state = reducer(
      state,
      playerActions.replacePlaylist({ tracks: [current] }),
    );
    state = reducer(state, playerActions.enqueueNext(first));
    state = reducer(state, playerActions.enqueueNext(second));
    let resolveBootstrap!: (value: { url: string }) => void;
    mockResolveMedia.mockImplementationOnce(
      () =>
        new Promise<{ url: string }>(resolve => {
          resolveBootstrap = resolve;
        }),
    );

    const pending = playerController.next(dispatch);
    await waitForBootstrapStart();
    expect(mockResolveMedia).toHaveBeenCalledWith(first, expect.any(AbortSignal));
    dispatch(
      playerActions.moveQueuedNext({
        occurrenceId: state.playNextQueue[0].occurrenceId,
        direction: 1,
      }),
    );
    resolveBootstrap({ url: SAFE_MEDIA_URI });
    await pending;

    expect(state.currentTrack?.id).toBe(current.id);
    expect(state.playNextQueue.map(item => item.track.id)).toEqual([
      second.id,
      first.id,
    ]);

    mockResolveMedia.mockResolvedValueOnce({
      url: SAFE_MEDIA_URI,
    });
    await playerController.next(dispatch);

    expect(state.currentTrack?.id).toBe(second.id);
    expect(state.playNextQueue.map(item => item.track.id)).toEqual([first.id]);
  });

  it('does not commit a queued transition after the playlist is replaced while resolving', async () => {
    const current = track('netrack_1');
    const queued = track('netrack_2');
    const replacement = track('netrack_replacement');
    state = reducer(
      state,
      playerActions.replacePlaylist({ tracks: [current] }),
    );
    state = reducer(state, playerActions.enqueueNext(queued));
    let resolveBootstrap!: (value: { url: string }) => void;
    mockResolveMedia.mockImplementationOnce(
      () =>
        new Promise<{ url: string }>(resolve => {
          resolveBootstrap = resolve;
        }),
    );

    const pending = playerController.next(dispatch);
    await waitForBootstrapStart();
    dispatch(
      playerActions.replacePlaylist({ tracks: [replacement], startIndex: 0 }),
    );
    resolveBootstrap({ url: SAFE_MEDIA_URI });
    await pending;

    expect(state.currentTrack?.id).toBe(replacement.id);
    expect(state.playNextQueue).toEqual([]);
  });

  it('does not load an ordinary playlist next item after replacement invalidates it', async () => {
    const current = track('netrack_1');
    const staleNext = track('netrack_2');
    const replacement = track('netrack_replacement');
    state = reducer(
      state,
      playerActions.replacePlaylist({ tracks: [current, staleNext] }),
    );
    let resolveBootstrap!: (value: { url: string }) => void;
    mockResolveMedia.mockImplementationOnce(
      () =>
        new Promise<{ url: string }>(resolve => {
          resolveBootstrap = resolve;
        }),
    );

    const pending = playerController.next(dispatch);
    await waitForBootstrapStart();
    dispatch(playerActions.replacePlaylist({ tracks: [replacement] }));
    resolveBootstrap({ url: SAFE_MEDIA_URI });
    await pending;

    expect(state.currentTrack?.id).toBe(replacement.id);
    expect(mockNativePlayer.add).not.toHaveBeenCalled();
  });

  it('invalidates and serializes a removal while its queued item is resolving', async () => {
    const current = track('netrack_1');
    const removed = track('netrack_2');
    state = reducer(
      state,
      playerActions.replacePlaylist({ tracks: [current] }),
    );
    state = reducer(state, playerActions.enqueueNext(removed));
    let resolveBootstrap!: (value: { url: string }) => void;
    mockResolveMedia.mockImplementationOnce(
      () =>
        new Promise<{ url: string }>(resolve => {
          resolveBootstrap = resolve;
        }),
    );

    const pending = playerController.next(dispatch);
    await waitForBootstrapStart();
    const forgetting = playerController.forgetTrack(dispatch, removed);
    expect(state.playNextQueue).toEqual([]);
    resolveBootstrap({ url: SAFE_MEDIA_URI });
    await Promise.all([pending, forgetting]);

    expect(state.playlist.map(item => item.id)).toEqual([current.id]);
    expect(state.currentTrack?.id).toBe(current.id);
    expect(mockNativePlayer.add).not.toHaveBeenCalled();
  });

  it('reloads the semantic current item after a native stop resets the queue', async () => {
    const current = track('netrack_1');
    state = reducer(
      state,
      playerActions.replacePlaylist({ tracks: [current] }),
    );
    state = reducer(state, playerActions.setPlaying(true));
    mockResolveMedia.mockResolvedValueOnce({
      url: SAFE_MEDIA_URI,
    });

    await expect(playerController.stop(dispatch)).resolves.toBe(true);
    await expect(playerController.play(dispatch)).resolves.toBe(true);

    expect(mockNativePlayer.add).toHaveBeenCalledWith(
      expect.objectContaining({ id: expect.stringContaining(current.id) }),
    );
    expect(mockNativePlayer.play).toHaveBeenCalled();
    expect(state.currentTrack?.id).toBe(current.id);
    expect(state.isPlaying).toBe(true);
  });

  it('overwrites a backup queue through one paused native transaction', async () => {
    const current = track('netrack_old');
    const imported = track('netrack_imported');
    state = reducer(
      state,
      playerActions.replacePlaylist({ tracks: [current] }),
    );
    state = reducer(state, playerActions.setPlaying(true));
    mockResolveMedia.mockResolvedValueOnce({
      url: SAFE_MEDIA_URI,
    });

    await expect(
      playerController.replacePlaylistForImport(dispatch, [imported]),
    ).resolves.toBe(true);

    expect(mockNativePlayer.stop).toHaveBeenCalledTimes(1);
    expect(mockNativePlayer.reset).toHaveBeenCalledTimes(1);
    expect(mockNativePlayer.add).toHaveBeenCalledWith(
      expect.objectContaining({ id: expect.stringContaining(imported.id) }),
    );
    expect(mockNativePlayer.pause).toHaveBeenCalledTimes(1);
    expect(state.playlist.map(item => item.id)).toEqual([imported.id]);
    expect(state.currentTrack?.id).toBe(imported.id);
    expect(state.isPlaying).toBe(false);
  });

  it.each([
    [
      'adding the imported track',
      () => mockNativePlayer.add.mockRejectedValueOnce(new Error('add failed')),
    ],
    [
      'configuring the imported track',
      () =>
        mockNativePlayer.setVolume.mockRejectedValueOnce(
          new Error('configure failed'),
        ),
    ],
    [
      'pausing the imported track',
      () =>
        mockNativePlayer.pause.mockRejectedValueOnce(new Error('pause failed')),
    ],
  ])(
    'restores the old native snapshot when overwrite fails while %s',
    async (_case, fail) => {
      const current = track('netrack_old');
      const imported = track('netrack_imported');
      state = reducer(
        state,
        playerActions.replacePlaylist({ tracks: [current] }),
      );
      state = reducer(state, playerActions.setPlaying(true));
      mockResolveMedia.mockResolvedValueOnce({
        url: SAFE_MEDIA_URI,
      });
      fail();

      await expect(
        playerController.replacePlaylistForImport(dispatch, [imported]),
      ).resolves.toBe(false);

      expect(state.currentTrack?.id).toBe(current.id);
      expect(state.playlist.map(item => item.id)).toEqual([current.id]);
      expect(state.isPlaying).toBe(true);
      expect(state.error).toBe('playback-unavailable');
      expect(mockNativePlayer.reset).toHaveBeenCalledTimes(2);
      expect(mockNativePlayer.add).toHaveBeenCalledTimes(2);
    },
  );

  it('marks a failed overwrite recovery reload-required instead of leaving Redux playing', async () => {
    const current = track('netrack_old');
    const imported = track('netrack_imported');
    state = reducer(
      state,
      playerActions.replacePlaylist({ tracks: [current] }),
    );
    state = reducer(state, playerActions.setPlaying(true));
    mockResolveMedia
      .mockResolvedValueOnce({ url: SAFE_MEDIA_URI })
      .mockResolvedValueOnce({ url: SAFE_MEDIA_URI });
    mockNativePlayer.add
      .mockRejectedValueOnce(new Error('import add failed'))
      .mockRejectedValueOnce(new Error('rollback add failed'));

    await expect(
      playerController.replacePlaylistForImport(dispatch, [imported]),
    ).resolves.toBe(false);

    expect(state.currentTrack?.id).toBe(current.id);
    expect(state.isPlaying).toBe(false);
    expect(state.error).toBe('playback-recovery-required');

    await expect(playerController.play(dispatch)).resolves.toBe(true);
    expect(mockResolveMedia).toHaveBeenLastCalledWith(current, expect.any(AbortSignal));
    expect(mockNativePlayer.add).toHaveBeenCalledTimes(3);
    expect(state.isPlaying).toBe(true);
  });

  it('cancels an in-flight ordinary transition before backup overwrite owns RNTP', async () => {
    const current = track('netrack_old');
    const staleNext = track('netrack_stale');
    const imported = track('netrack_imported');
    state = reducer(
      state,
      playerActions.replacePlaylist({ tracks: [current, staleNext] }),
    );
    let resolveStale!: (value: { url: string }) => void;
    mockResolveMedia.mockImplementationOnce(
      () =>
        new Promise<{ url: string }>(resolve => {
          resolveStale = resolve;
        }),
    );
    mockResolveMedia.mockResolvedValueOnce({
      url: SAFE_MEDIA_URI,
    });

    const staleTransition = playerController.next(dispatch);
    await waitForBootstrapStart();
    const overwrite = playerController.replacePlaylistForImport(dispatch, [
      imported,
    ]);
    resolveStale({ url: SAFE_MEDIA_URI });
    await Promise.all([staleTransition, overwrite]);

    expect(state.currentTrack?.id).toBe(imported.id);
    expect(mockNativePlayer.add).toHaveBeenCalledTimes(1);
    expect(mockNativePlayer.add).toHaveBeenCalledWith(
      expect.objectContaining({ id: expect.stringContaining(imported.id) }),
    );
  });

  it('serializes seek and volume mutations through the same native command boundary', async () => {
    state = reducer(
      state,
      playerActions.replacePlaylist({ tracks: [track('ne_1')] }),
    );
    let resolveSeek!: () => void;
    mockNativePlayer.seekTo.mockImplementationOnce(
      () =>
        new Promise<void>(resolve => {
          resolveSeek = resolve;
        }),
    );

    const seek = playerController.seek(dispatch, 12);
    const volume = playerController.setVolume(dispatch, 0.4);
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    expect(mockNativePlayer.setVolume).not.toHaveBeenCalled();
    resolveSeek();
    await Promise.all([seek, volume]);
    expect(mockNativePlayer.seekTo).toHaveBeenCalledWith(12);
    expect(mockNativePlayer.setVolume).toHaveBeenCalledWith(0.4);
  });

  it('clears a latched playback error after the current track is recovered', async () => {
    const current = track('netrack_1');
    state = reducer(
      state,
      playerActions.replacePlaylist({ tracks: [current] }),
    );
    state = reducer(state, playerActions.setError('native-playback-error'));
    mockResolveMedia.mockResolvedValueOnce({
      url: SAFE_MEDIA_URI,
    });

    await expect(playerController.play(dispatch)).resolves.toBe(true);

    expect(state.error).toBeNull();
    expect(state.isPlaying).toBe(true);
  });

  it('keeps the previous playing snapshot when native pause rejects', async () => {
    state = reducer(
      state,
      playerActions.replacePlaylist({ tracks: [track('ne_1')] }),
    );
    state = reducer(state, playerActions.setPlaying(true));
    mockNativePlayer.pause.mockRejectedValueOnce(new Error('pause failed'));

    await expect(playerController.pause(dispatch)).resolves.toBe(false);

    expect(state.isPlaying).toBe(true);
    expect(state.error).toBe('playback-unavailable');
  });

  it('returns the native transition result from playTrack', async () => {
    const current = track('netrack_1');
    const next = track('netrack_2');
    mockResolveMedia.mockResolvedValue({ playableUri: SAFE_MEDIA_URI });

    await expect(playerController.playTrack(dispatch, current)).resolves.toBe(
      true,
    );
    mockNativePlayer.add.mockRejectedValueOnce(new Error('load failed'));
    await expect(playerController.playTrack(dispatch, next)).resolves.toBe(
      true,
    );
  });

  it('rejects invalid seek and mode inputs without mutating native state', async () => {
    state = reducer(
      state,
      playerActions.replacePlaylist({ tracks: [track('ne_1')] }),
    );
    const seekBefore = mockNativePlayer.seekTo.mock.calls.length;
    const modeBefore = mockNativePlayer.setRepeatMode.mock.calls.length;

    await expect(playerController.seek(dispatch, Number.NaN)).resolves.toBe(
      false,
    );
    await expect(playerController.setMode(dispatch, 99 as any)).resolves.toBe(
      false,
    );

    expect(mockNativePlayer.seekTo.mock.calls.length).toBe(seekBefore);
    expect(mockNativePlayer.setRepeatMode.mock.calls.length).toBe(modeBefore);
    expect(state.error).toBe('mode-unavailable');
  });

  it('does not seek non-seekable local audio while leaving sequential playback available', async () => {
    const local = { ...localTrack('local_stream'), seekable: false };
    state = reducer(state, playerActions.replacePlaylist({ tracks: [local] }));
    const before = mockNativePlayer.seekTo.mock.calls.length;

    await expect(playerController.seek(dispatch, 12)).resolves.toBe(false);

    expect(mockNativePlayer.seekTo.mock.calls.length).toBe(before);
    expect(state.error).toBe('seek-unavailable');
  });

  it('ignores a progress callback identified as belonging to an older native track', async () => {
    const first = track('netrack_1');
    const second = track('netrack_2');
    mockResolveMedia.mockResolvedValue({
      url: SAFE_MEDIA_URI,
    });
    await playerController.playTrack(dispatch, first);
    const firstNativeId = mockNativePlayer.add.mock.calls.at(-1)?.[0]?.id;
    await playerController.playTrack(dispatch, second);
    const before = state.position;

    (playerController as any).onProgress(88, 120, 90, {
      nativeTrackId: firstNativeId,
    });

    expect(state.position).toBe(before);
  });

  it('ignores stale state, error, and queue-ended callbacks from an older native item', async () => {
    const first = track('netrack_1');
    const second = track('netrack_2');
    mockResolveMedia.mockResolvedValue({
      url: SAFE_MEDIA_URI,
    });
    await playerController.playTrack(dispatch, first);
    const firstNativeId = mockNativePlayer.add.mock.calls.at(-1)?.[0]?.id;
    const firstIdentity = playerController.onNativeActiveTrackChanged(
      { id: firstNativeId },
      0,
    );
    await playerController.playTrack(dispatch, second);
    state = reducer(state, playerActions.setPlaying(false));
    const addsBefore = mockNativePlayer.add.mock.calls.length;

    playerController.onPlaybackState(
      'playing' as any,
      firstIdentity ?? undefined,
    );
    playerController.onPlaybackError(firstIdentity ?? undefined);
    await playerController.onPlaybackQueueEnded(firstIdentity ?? undefined);

    expect(state.isPlaying).toBe(false);
    expect(state.error).toBeNull();
    expect(mockNativePlayer.add).toHaveBeenCalledTimes(addsBefore);
  });

  it('quarantines identifier-less state and error callbacks while accepting the current observed identity', async () => {
    const current = track('netrack_1');
    mockResolveMedia.mockResolvedValue({
      url: SAFE_MEDIA_URI,
    });
    await playerController.playTrack(dispatch, current);
    const nativeTrackId = mockNativePlayer.add.mock.calls.at(-1)?.[0]?.id;
    const identity = playerController.onNativeActiveTrackChanged(
      { id: nativeTrackId },
      0,
    );
    state = reducer(state, playerActions.setPlaying(true));

    playerController.onPlaybackState('paused' as any);
    playerController.onPlaybackError();

    expect(state.isPlaying).toBe(true);
    expect(state.error).toBeNull();

    playerController.onPlaybackState('paused' as any, identity ?? undefined);
    expect(state.isPlaying).toBe(false);
  });

  it('keeps B intact when A state/error callbacks arrive after B becomes active', async () => {
    const first = track('netrack_a');
    const second = track('netrack_b');
    mockResolveMedia.mockResolvedValue({
      url: SAFE_MEDIA_URI,
    });
    await playerController.playTrack(dispatch, first);
    const firstNativeId = mockNativePlayer.add.mock.calls.at(-1)?.[0]?.id;
    const firstIdentity = playerController.onNativeActiveTrackChanged(
      { id: firstNativeId },
      0,
    );
    await playerController.playTrack(dispatch, second);
    const secondNativeId = mockNativePlayer.add.mock.calls.at(-1)?.[0]?.id;
    const secondIdentity = playerController.onNativeActiveTrackChanged(
      { id: secondNativeId },
      0,
    );
    state = reducer(state, playerActions.setPlaying(true));

    playerController.onPlaybackState(
      'paused' as any,
      firstIdentity ?? undefined,
    );
    playerController.onPlaybackError(firstIdentity ?? undefined);
    playerController.onPlaybackState('paused' as any);
    playerController.onPlaybackError();

    expect(state.currentTrack?.id).toBe(second.id);
    expect(state.isPlaying).toBe(true);
    expect(state.error).toBeNull();

    playerController.onPlaybackState(
      'paused' as any,
      secondIdentity ?? undefined,
    );
    expect(state.isPlaying).toBe(false);

    playerController.onPlaybackError(secondIdentity ?? undefined);
    expect(state.isPlaying).toBe(false);
    expect(state.error).toBe('native-playback-error');
  });
});
