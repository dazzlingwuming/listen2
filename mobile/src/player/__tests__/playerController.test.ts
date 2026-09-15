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
const mockBootstrapTrack = jest.fn();
const mockResolveVerified = jest.fn().mockResolvedValue({ status: 'miss' });
const mockInvalidate = jest.fn().mockResolvedValue({});

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
    bootstrapTrack: (...args: unknown[]) => mockBootstrapTrack(...args),
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
import { Platform } from 'react-native';
import { playerErrorCopy } from '../playerErrorCopy';

const track = (id: string): Track => ({
  id,
  source: 'netease',
  title: id,
  artist: 'Listen2',
});
const localTrack = (id: string): LocalTrack => ({
  id,
  source: 'local',
  title: id,
  artist: '本地音频',
  contentUri: `content://documents/${id}`,
  fileName: `${id}.mp3`,
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
    turn < 10 && mockBootstrapTrack.mock.calls.length === 0;
    turn += 1
  )
    await Promise.resolve();
  expect(mockBootstrapTrack).toHaveBeenCalled();
}

describe('PlayerController queue transitions', () => {
  let state: PlayerState;
  const dispatch = (action: unknown) => {
    state = reducer(state, action as any);
    return action;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockBootstrapTrack.mockReset();
    mockNativePlayer.add.mockReset().mockResolvedValue(undefined);
    mockNativePlayer.reset.mockReset().mockResolvedValue(undefined);
    mockNativePlayer.play.mockReset().mockResolvedValue(undefined);
    mockNativePlayer.pause.mockReset().mockResolvedValue(undefined);
    mockNativePlayer.stop.mockReset().mockResolvedValue(undefined);
    mockNativePlayer.setRepeatMode.mockReset().mockResolvedValue(undefined);
    mockNativePlayer.setVolume.mockReset().mockResolvedValue(undefined);
    mockNativePlayer.getActiveTrack
      .mockReset()
      .mockResolvedValue({ url: 'https://music.example/old.mp3' });
    mockNativePlayer.getProgress.mockReset().mockResolvedValue({ position: 0 });
    mockNativePlayer.getPlaybackState
      .mockReset()
      .mockResolvedValue({ state: 'playing' });
    mockResolveVerified.mockResolvedValue({ status: 'miss' });
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
    mockBootstrapTrack.mockRejectedValueOnce(new Error('PLAYBACK_UNAVAILABLE'));

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
    mockBootstrapTrack.mockResolvedValueOnce({
      trackId: selected.id,
      source: selected.source,
      url: 'https://music.example/track.mp3',
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
    expect(mockBootstrapTrack).toHaveBeenCalledWith(selected, expect.any(AbortSignal));

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
    mockBootstrapTrack.mockImplementationOnce(
      () =>
        new Promise<{ url: string }>(resolve => {
          resolveBootstrap = resolve;
        }),
    );

    const firstNext = playerController.next(dispatch);
    const secondNext = playerController.next(dispatch);
    await waitForBootstrapStart();
    expect(mockBootstrapTrack).toHaveBeenCalledTimes(1);
    resolveBootstrap({ url: 'https://music.example/track.mp3' });
    await Promise.all([firstNext, secondNext]);

    expect(state.currentTrack?.id).toBe(first.id);
    expect(state.playNextQueue.map(item => item.track.id)).toEqual([second.id]);
  });

  it('aborts a superseded QQ selection before a ready Kuwo selection can mutate RNTP', async () => {
    const qq = { ...track('qqtrack_001'), source: 'qq' as const };
    const kuwo = { ...track('kwtrack_123456'), source: 'kuwo' as const };
    let resolveQq!: (value: { url: string }) => void;
    mockBootstrapTrack
      .mockImplementationOnce(
        () => new Promise<{ url: string }>(resolve => { resolveQq = resolve; }),
      )
      .mockResolvedValueOnce({ url: 'https://music.example/kuwo.mp3' });

    const stale = playerController.playTrack(dispatch, qq);
    await waitForBootstrapStart();
    const staleSignal = mockBootstrapTrack.mock.calls[0][1] as AbortSignal;
    const current = playerController.playTrack(dispatch, kuwo);
    await expect(stale).resolves.toBe(false);
    await expect(current).resolves.toBe(true);
    expect(staleSignal.aborted).toBe(true);
    expect(mockNativePlayer.add).toHaveBeenCalledTimes(1);
    expect(mockNativePlayer.add).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: expect.stringContaining(kuwo.id) }),
    );
    resolveQq({ url: 'https://music.example/late-qq.mp3' });
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
    mockBootstrapTrack.mockResolvedValueOnce({
      trackId: queued.id,
      source: queued.source,
      url: 'https://music.example/track.mp3',
    });
    mockNativePlayer.add.mockRejectedValueOnce(new Error('native-load-failed'));

    await playerController.next(dispatch);

    expect(state.currentTrack?.id).toBe(current.id);
    expect(state.playNextQueue.map(item => item.track.id)).toEqual([queued.id]);
    expect(state.error).toBe('playback-unavailable');
    expect(state.isPlaying).toBe(true);
  });

  it('plays a local content URI without calling the provider bootstrap', async () => {
    const local = localTrack('local_1');
    state = reducer(
      state,
      playerActions.replacePlaylist({ tracks: [track('netrack_1')] }),
    );
    state = reducer(state, playerActions.enqueueNext(local));

    await playerController.next(dispatch);

    expect(mockBootstrapTrack).not.toHaveBeenCalled();
    expect(state.currentTrack?.id).toBe(local.id);
    expect(state.playNextQueue).toEqual([]);
    expect(mockNativePlayer.add).toHaveBeenCalledWith(
      expect.objectContaining({ url: local.contentUri }),
    );
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
      uri: 'content://cache/abc',
      mimeType: 'audio/mpeg',
    });
    await playerController.next(dispatch);
    expect(mockBootstrapTrack).not.toHaveBeenCalled();
    expect(mockNativePlayer.add).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'content://cache/abc' }),
    );
  });

  it('keeps a validated Bilibili handoff transient until the single native add', async () => {
    const selected = bilibiliTrack();
    const signedUrl = 'https://upos-sz-mirror.example.bilivideo.com/audio.m4s';
    mockBootstrapTrack.mockResolvedValueOnce({
      trackId: selected.id,
      source: selected.source,
      url: signedUrl,
      headers: { Referer: 'https://www.bilibili.com/' },
    });
    await playerController.playTracks(dispatch, [selected]);
    expect(mockBootstrapTrack).toHaveBeenCalledWith(selected, expect.any(AbortSignal));
    expect(mockNativePlayer.add).toHaveBeenCalledWith(
      expect.objectContaining({
        url: signedUrl,
        headers: { Referer: 'https://www.bilibili.com/' },
      }),
    );
    expect(JSON.stringify(state)).not.toContain(signedUrl);
    expect(JSON.stringify(state)).not.toContain('Referer');
  });

  it('aborts a superseded Bilibili parts transition before only the latest part mutates RNTP', async () => {
    const first = bilibiliTrack('bitrack_v_BV1xx411c7mD-12');
    const second = bilibiliTrack('bitrack_v_BV1xx411c7mD-13');
    mockBootstrapTrack
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
        url: 'https://upos-sz-mirror.example.bilivideo.com/part-13.m4s',
        headers: { Referer: 'https://www.bilibili.com/' },
      });

    const stale = playerController.playTracks(dispatch, [first]);
    await waitForBootstrapStart();
    const staleSignal = mockBootstrapTrack.mock.calls[0][1] as AbortSignal;
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
    mockBootstrapTrack.mockRejectedValueOnce({ code });
    await playerController.playTracks(dispatch, [bilibiliTrack()]);
    expect(state.error).toBe(code);
    expect(mockBootstrapTrack).toHaveBeenCalledTimes(1);
  });

  it('uses exactly one online bootstrap after a cache miss or corrupt result', async () => {
    const queued = track('netrack_2');
    state = reducer(
      state,
      playerActions.replacePlaylist({ tracks: [track('netrack_1')] }),
    );
    state = reducer(state, playerActions.enqueueNext(queued));
    mockResolveVerified.mockResolvedValueOnce({ status: 'corrupt' });
    mockBootstrapTrack.mockResolvedValueOnce({
      url: 'https://music.example/track.mp3',
    });

    await playerController.next(dispatch);

    expect(mockResolveVerified).toHaveBeenCalledWith('netease', queued.id);
    expect(mockBootstrapTrack).toHaveBeenCalledTimes(1);
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
      uri: 'content://cache/abc',
      mimeType: 'audio/mpeg',
    });
    mockNativePlayer.add.mockRejectedValueOnce(new Error('cache-load-failed'));
    mockBootstrapTrack.mockResolvedValueOnce({
      url: 'https://music.example/track.mp3',
    });
    await playerController.next(dispatch);
    expect(mockInvalidate).toHaveBeenCalledWith('netease', queued.id);
    expect(mockBootstrapTrack).toHaveBeenCalledTimes(1);
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
      uri: 'content://cache/abc',
      mimeType: 'audio/mpeg',
    });
    mockNativePlayer.add.mockRejectedValueOnce(new Error('cache-load-failed'));
    mockBootstrapTrack.mockRejectedValueOnce(new Error('online-failed'));

    await playerController.next(dispatch);

    expect(mockInvalidate).toHaveBeenCalledWith('netease', queued.id);
    expect(mockBootstrapTrack).toHaveBeenCalledTimes(1);
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
    mockBootstrapTrack.mockRejectedValueOnce(
      new Error(
        'https://provider.example/path?token=secret content://cache/private',
      ),
    );

    await playerController.next(dispatch);

    expect(state.error).toBe('playback-unavailable');
    expect(state.error).not.toContain('https://');
    expect(state.error).not.toContain('content://');
    expect(playerErrorCopy(state.error)).toBe('播放暂不可用，请稍后重试。');
    expect(playerErrorCopy('https://provider.example/private')).toBe(
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
    mockBootstrapTrack.mockResolvedValueOnce({
      url: 'https://music.example/track.mp3',
    });

    await playerController.next(dispatch);

    expect(mockResolveVerified).not.toHaveBeenCalled();
    expect(mockBootstrapTrack).toHaveBeenCalledWith(unsupported, expect.any(AbortSignal));
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

    expect(mockBootstrapTrack).not.toHaveBeenCalled();
    expect(state.playNextQueue.map(item => item.track.id)).toEqual([local.id]);
    expect(state.error).toBe('local-media-unavailable');
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
    mockBootstrapTrack.mockImplementationOnce(
      () =>
        new Promise<{ url: string }>(resolve => {
          resolveBootstrap = resolve;
        }),
    );

    const pending = playerController.next(dispatch);
    await waitForBootstrapStart();
    dispatch(playerActions.clearPlayNextQueue());
    resolveBootstrap({ url: 'https://music.example/queued.mp3' });
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
    mockBootstrapTrack.mockImplementationOnce(
      () =>
        new Promise<{ url: string }>(resolve => {
          resolveBootstrap = resolve;
        }),
    );

    const pending = playerController.next(dispatch);
    await waitForBootstrapStart();
    expect(mockBootstrapTrack).toHaveBeenCalledWith(first, expect.any(AbortSignal));
    dispatch(
      playerActions.moveQueuedNext({
        occurrenceId: state.playNextQueue[0].occurrenceId,
        direction: 1,
      }),
    );
    resolveBootstrap({ url: 'https://music.example/first.mp3' });
    await pending;

    expect(state.currentTrack?.id).toBe(current.id);
    expect(state.playNextQueue.map(item => item.track.id)).toEqual([
      second.id,
      first.id,
    ]);

    mockBootstrapTrack.mockResolvedValueOnce({
      url: 'https://music.example/second.mp3',
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
    mockBootstrapTrack.mockImplementationOnce(
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
    resolveBootstrap({ url: 'https://music.example/queued.mp3' });
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
    mockBootstrapTrack.mockImplementationOnce(
      () =>
        new Promise<{ url: string }>(resolve => {
          resolveBootstrap = resolve;
        }),
    );

    const pending = playerController.next(dispatch);
    await waitForBootstrapStart();
    dispatch(playerActions.replacePlaylist({ tracks: [replacement] }));
    resolveBootstrap({ url: 'https://music.example/stale-next.mp3' });
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
    mockBootstrapTrack.mockImplementationOnce(
      () =>
        new Promise<{ url: string }>(resolve => {
          resolveBootstrap = resolve;
        }),
    );

    const pending = playerController.next(dispatch);
    await waitForBootstrapStart();
    const forgetting = playerController.forgetTrack(dispatch, removed);
    expect(state.playNextQueue).toEqual([]);
    resolveBootstrap({ url: 'https://music.example/removed.mp3' });
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
    mockBootstrapTrack.mockResolvedValueOnce({
      url: 'https://music.example/reloaded.mp3',
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
    mockBootstrapTrack.mockResolvedValueOnce({
      url: 'https://music.example/imported.mp3',
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
      mockBootstrapTrack.mockResolvedValueOnce({
        url: 'https://music.example/imported.mp3',
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
    mockBootstrapTrack
      .mockResolvedValueOnce({ url: 'https://music.example/imported.mp3' })
      .mockResolvedValueOnce({ url: 'https://music.example/old.mp3' });
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
    expect(mockBootstrapTrack).toHaveBeenLastCalledWith(current, expect.any(AbortSignal));
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
    mockBootstrapTrack.mockImplementationOnce(
      () =>
        new Promise<{ url: string }>(resolve => {
          resolveStale = resolve;
        }),
    );
    mockBootstrapTrack.mockResolvedValueOnce({
      url: 'https://music.example/imported.mp3',
    });

    const staleTransition = playerController.next(dispatch);
    await waitForBootstrapStart();
    const overwrite = playerController.replacePlaylistForImport(dispatch, [
      imported,
    ]);
    resolveStale({ url: 'https://music.example/stale.mp3' });
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
    mockBootstrapTrack.mockResolvedValueOnce({
      url: 'https://music.example/current.mp3',
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
    mockBootstrapTrack.mockResolvedValue({
      url: 'https://music.example/current.mp3',
    });

    await expect(playerController.playTrack(dispatch, current)).resolves.toBe(
      true,
    );
    mockNativePlayer.add.mockRejectedValueOnce(new Error('load failed'));
    await expect(playerController.playTrack(dispatch, next)).resolves.toBe(
      false,
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

  it('ignores a progress callback identified as belonging to an older native track', async () => {
    const first = track('netrack_1');
    const second = track('netrack_2');
    mockBootstrapTrack.mockResolvedValue({
      url: 'https://music.example/current.mp3',
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
    mockBootstrapTrack.mockResolvedValue({
      url: 'https://music.example/current.mp3',
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
    mockBootstrapTrack.mockResolvedValue({
      url: 'https://music.example/current.mp3',
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
    mockBootstrapTrack.mockResolvedValue({
      url: 'https://music.example/current.mp3',
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
