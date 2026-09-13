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

describe('PlayerController queue transitions', () => {
  let state: PlayerState;
  const dispatch = (action: unknown) => {
    state = reducer(state, action as any);
    return action;
  };

  beforeEach(() => {
    jest.clearAllMocks();
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
    expect(state.playNextQueue.map(item => item.id)).toEqual([queued.id]);
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
    expect(state.playNextQueue.map(item => item.id)).toEqual([
      first.id,
      selected.id,
    ]);
    expect(playerController.snapshot().playNextQueue).toHaveLength(2);
    await playerController.playQueuedAt(dispatch, 1);

    // Diagnostic assertion keeps failures readable without exposing provider data.
    expect(mockBootstrapTrack).toHaveBeenCalledWith(selected);

    expect(state.currentTrack?.id).toBe(selected.id);
    expect(state.playNextQueue.map(item => item.id)).toEqual([first.id]);
    expect(mockNativePlayer.add).toHaveBeenCalledTimes(1);
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
    expect(state.playNextQueue.map(item => item.id)).toEqual([queued.id]);
    expect(state.error).toBe('native-load-failed');
    expect(state.isPlaying).toBe(false);
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
    expect(state.playNextQueue.map(item => item.id)).toEqual([local.id]);
    expect(state.error).toBe('native-load-failed');
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
});
