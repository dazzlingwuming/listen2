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
};
const mockBootstrap = jest.fn();

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
  providerClient: { bootstrapTrack: (...args: unknown[]) => mockBootstrap(...args) },
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
    mockBootstrap.mockResolvedValue({ url: 'https://music.example/lifecycle.mp3' });
    state = reducer(undefined, { type: 'init' });
    configurePlayerController({ dispatch, getPlayerState: () => state });
  });

  it('allows setup to retry after a transient setup failure', async () => {
    mockNative.setupPlayer
      .mockRejectedValueOnce(new Error('setup unavailable'))
      .mockResolvedValueOnce(undefined);

    await expect(playerController.playTrack(dispatch, track)).resolves.toBe(false);
    await expect(playerController.playTrack(dispatch, track)).resolves.toBe(true);

    expect(mockNative.setupPlayer).toHaveBeenCalledTimes(2);
  });

  it('settles restore failure as a safe error without hiding the rejection in store setup', async () => {
    state = reducer(state, playerActions.replacePlaylist({ tracks: [track] }));
    mockNative.setupPlayer.mockRejectedValueOnce(new Error('restore setup failed'));

    await expect(playerController.restore()).resolves.toBe(false);

    expect(state.isPlaying).toBe(false);
    expect(state.error).toBe('playback-unavailable');
  });
});
