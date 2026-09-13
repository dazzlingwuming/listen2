const mockNative = {
  setupPlayer: jest.fn().mockResolvedValue(undefined),
  updateOptions: jest.fn().mockResolvedValue(undefined),
  setRepeatMode: jest.fn().mockResolvedValue(undefined),
  setVolume: jest.fn().mockResolvedValue(undefined),
  reset: jest.fn().mockResolvedValue(undefined),
  add: jest.fn().mockResolvedValue(undefined),
  seekTo: jest.fn().mockResolvedValue(undefined),
  play: jest.fn().mockResolvedValue(undefined),
  pause: jest.fn().mockResolvedValue(undefined),
  getActiveTrack: jest.fn(),
  getProgress: jest.fn(),
  getPlaybackState: jest.fn(),
};
const mockBootstrapTrack = jest.fn();

jest.mock('react-native-track-player', () => ({
  __esModule: true,
  default: {
    setupPlayer: (...args: unknown[]) => mockNative.setupPlayer(...args),
    updateOptions: (...args: unknown[]) => mockNative.updateOptions(...args),
    setRepeatMode: (...args: unknown[]) => mockNative.setRepeatMode(...args),
    setVolume: (...args: unknown[]) => mockNative.setVolume(...args),
    reset: (...args: unknown[]) => mockNative.reset(...args),
    add: (...args: unknown[]) => mockNative.add(...args),
    seekTo: (...args: unknown[]) => mockNative.seekTo(...args),
    play: (...args: unknown[]) => mockNative.play(...args),
    pause: (...args: unknown[]) => mockNative.pause(...args),
    getActiveTrack: (...args: unknown[]) => mockNative.getActiveTrack(...args),
    getProgress: (...args: unknown[]) => mockNative.getProgress(...args),
    getPlaybackState: (...args: unknown[]) =>
      mockNative.getPlaybackState(...args),
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
  isOfflineDownloadEligible: () => false,
  offlineAudio: { resolveVerified: jest.fn() },
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
import { Platform } from 'react-native';

const track = (id: string): Track => ({
  id,
  source: 'netease',
  title: id,
  artist: 'Listen2',
});

describe('collection playback rollback', () => {
  let state: PlayerState;
  const dispatch = (action: unknown) => {
    state = reducer(state, action as any);
    return action;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    Object.values(mockNative).forEach(mock => {
      if ('mockResolvedValue' in mock)
        (mock as jest.Mock).mockResolvedValue(undefined);
    });
    mockNative.getActiveTrack.mockResolvedValue({
      url: 'https://media.example/old.mp3',
      headers: { Referer: 'https://media.example/' },
    });
    mockNative.getProgress.mockResolvedValue({ position: 37 });
    mockNative.getPlaybackState.mockResolvedValue({ state: 'playing' });
    mockBootstrapTrack.mockResolvedValue({
      url: 'https://media.example/new.mp3',
    });
    Object.defineProperty(Platform, 'Version', {
      value: 32,
      configurable: true,
    });
    state = reducer(undefined, { type: 'test/init' });
    state = reducer(
      state,
      playerActions.replacePlaylist({ tracks: [track('netrack_1')] }),
    );
    state = reducer(state, playerActions.setPlaying(true));
    configurePlayerController({ dispatch, getPlayerState: () => state });
  });

  it('restores a playing native item after replacement add fails without changing durable queue', async () => {
    const before = state;
    mockNative.add.mockRejectedValueOnce(new Error('new-add-failed'));

    await expect(
      playerController.playTracks(dispatch, [track('netrack_2')]),
    ).resolves.toBe(false);

    expect(state.playlist).toEqual(before.playlist);
    expect(state.currentTrack).toEqual(before.currentTrack);
    expect(state.history).toEqual(before.history);
    expect(state.playNextQueue).toEqual(before.playNextQueue);
    expect(mockNative.reset).toHaveBeenCalledTimes(2);
    expect(mockNative.add).toHaveBeenCalledTimes(2);
    expect(mockNative.add.mock.invocationCallOrder[0]).toBeLessThan(
      mockNative.reset.mock.invocationCallOrder[1],
    );
    expect(mockNative.play).toHaveBeenCalledTimes(1);
    expect(state.isPlaying).toBe(true);
    expect(state.error).toBe('playback-unavailable');
  });

  it('restores a paused item by pausing instead of replaying it', async () => {
    state = reducer(state, playerActions.setPlaying(false));
    mockNative.getPlaybackState.mockResolvedValue({ state: 'paused' });
    mockNative.add.mockRejectedValueOnce(new Error('new-add-failed'));

    await expect(
      playerController.playTracks(dispatch, [track('netrack_2')]),
    ).resolves.toBe(false);

    expect(mockNative.play).not.toHaveBeenCalled();
    expect(mockNative.pause).toHaveBeenCalledTimes(1);
    expect(state.isPlaying).toBe(false);
  });

  it('uses bounded recovery when rollback itself fails', async () => {
    mockNative.add
      .mockRejectedValueOnce(new Error('new-add-failed'))
      .mockRejectedValueOnce(new Error('rollback-add-failed'));

    await expect(
      playerController.playTracks(dispatch, [track('netrack_2')]),
    ).resolves.toBe(false);

    expect(mockNative.pause).toHaveBeenCalledTimes(1);
    expect(state.error).toBe('playback-recovery-required');
    expect(state.isPlaying).toBe(false);
    expect(JSON.stringify(state)).not.toContain('https://media.example');
  });
});
