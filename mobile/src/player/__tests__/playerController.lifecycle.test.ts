const mockNative = {
  setupPlayer: jest.fn(),
  updateOptions: jest.fn().mockResolvedValue(undefined),
  setRepeatMode: jest.fn().mockResolvedValue(undefined),
  setVolume: jest.fn().mockResolvedValue(undefined),
  reset: jest.fn().mockResolvedValue(undefined),
  add: jest.fn().mockResolvedValue(undefined),
  seekTo: jest.fn().mockResolvedValue(undefined),
  play: jest.fn().mockResolvedValue(undefined),
  pause: jest.fn().mockResolvedValue(undefined),
  stop: jest.fn().mockResolvedValue(undefined),
  getActiveTrack: jest.fn().mockResolvedValue(undefined),
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

jest.mock('react-native', () => ({
  Platform: { OS: 'ios', Version: 0 },
  PermissionsAndroid: {
    request: jest.fn(),
    PERMISSIONS: { POST_NOTIFICATIONS: 'post' },
  },
}));
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
    stop: (...args: unknown[]) => mockNative.stop(...args),
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
    resolveMedia: (...args: unknown[]) => Promise.resolve(mockResolveMedia(...args)).then(nativeMediaFixture),
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
  resetPlayerControllerForTests,
} from '../playerController';

const track = {
  id: 'ne_lifecycle',
  source: 'netease' as const,
  title: '生命周期测试',
  artist: 'Listen2',
};

describe('PlayerController lifecycle recovery', () => {
  let state: PlayerState;
  const dispatch = (action: unknown) => {
    state = reducer(state, action as any);
    return action;
  };

  beforeEach(() => {
    resetPlayerControllerForTests();
    jest.clearAllMocks();
    Object.values(mockNative).forEach(mock => {
      if ('mockResolvedValue' in mock)
        (mock as jest.Mock).mockResolvedValue(undefined);
    });
    mockResolveMedia.mockResolvedValue({
      url: SAFE_MEDIA_URI,
    });
    state = reducer(undefined, { type: 'init' });
    configurePlayerController({ dispatch, getPlayerState: () => state });
  });

  it('allows setup to retry after a transient setup failure', async () => {
    mockNative.setupPlayer
      .mockRejectedValueOnce(new Error('setup unavailable'))
      .mockResolvedValueOnce(undefined);

    await expect(playerController.playTrack(dispatch, track)).resolves.toBe(
      false,
    );
    await expect(playerController.playTrack(dispatch, track)).resolves.toBe(
      true,
    );

    expect(mockNative.setupPlayer).toHaveBeenCalledTimes(2);
  });

  it('settles restore failure as a safe error without hiding the rejection in store setup', async () => {
    state = reducer(state, playerActions.replacePlaylist({ tracks: [track] }));
    mockNative.setupPlayer.mockRejectedValueOnce(
      new Error('restore setup failed'),
    );

    await expect(playerController.restore()).resolves.toBe(false);

    expect(state.isPlaying).toBe(false);
    expect(state.error).toBe('playback-unavailable');
  });

  it('best-effort pauses native playback when restore configuration rejects', async () => {
    state = reducer(state, playerActions.replacePlaylist({ tracks: [track] }));
    mockNative.setVolume.mockRejectedValueOnce(new Error('volume unavailable'));

    await expect(playerController.restore()).resolves.toBe(false);

    expect(mockNative.pause).toHaveBeenCalledTimes(2);
    expect(state.isPlaying).toBe(false);
    expect(state.error).toBe('playback-unavailable');
  });

  it('replaces a restored semantic item when RNTP has no native queue to roll back', async () => {
    const restored = { ...track, id: 'netrack_restored' };
    const selected = { ...track, id: 'netrack_selected' };
    state = reducer(state, playerActions.replacePlaylist({ tracks: [restored] }));

    await expect(playerController.restore()).resolves.toBe(true);
    await expect(playerController.playTracks(dispatch, [selected])).resolves.toBe(
      true,
    );

    expect(mockNative.reset).toHaveBeenCalledTimes(1);
    expect(mockNative.add).toHaveBeenCalledTimes(1);
    expect(mockNative.play).toHaveBeenCalledTimes(1);
    expect(state.currentTrack?.id).toBe('netrack_selected');
    expect(state.error).toBeNull();
  });

  it('allows playTrack to replace a restored semantic item without a native queue', async () => {
    const restored = { ...track, id: 'netrack_restored' };
    const selected = { ...track, id: 'netrack_selected' };
    state = reducer(
      state,
      playerActions.replacePlaylist({ tracks: [restored, selected] }),
    );

    await expect(playerController.restore()).resolves.toBe(true);
    await expect(playerController.playTrack(dispatch, selected)).resolves.toBe(
      true,
    );

    expect(mockNative.reset).toHaveBeenCalledTimes(1);
    expect(mockNative.add).toHaveBeenCalledTimes(1);
    expect(state.currentTrack?.id).toBe(selected.id);
  });

  it('allows next to replace a restored semantic item without a native queue', async () => {
    const restored = { ...track, id: 'netrack_restored' };
    const selected = { ...track, id: 'netrack_selected' };
    state = reducer(
      state,
      playerActions.replacePlaylist({ tracks: [restored, selected] }),
    );

    await expect(playerController.restore()).resolves.toBe(true);
    await expect(playerController.next(dispatch)).resolves.toBe(true);

    expect(mockNative.reset).toHaveBeenCalledTimes(1);
    expect(mockNative.add).toHaveBeenCalledTimes(1);
    expect(state.currentTrack?.id).toBe(selected.id);
  });

  it('fails closed when a restored semantic item has a malformed native snapshot', async () => {
    const restored = { ...track, id: 'netrack_restored' };
    const selected = { ...track, id: 'netrack_selected' };
    state = reducer(
      state,
      playerActions.replacePlaylist({ tracks: [restored, selected] }),
    );

    await expect(playerController.restore()).resolves.toBe(true);
    mockNative.getActiveTrack.mockResolvedValue({ url: 'https://invalid.test' });

    await expect(playerController.playTrack(dispatch, selected)).resolves.toBe(
      false,
    );

    expect(mockNative.reset).not.toHaveBeenCalled();
    expect(mockNative.add).not.toHaveBeenCalled();
    expect(state.currentTrack?.id).toBe(restored.id);
    expect(state.error).toBe('playback-transition-unavailable');
  });
});
