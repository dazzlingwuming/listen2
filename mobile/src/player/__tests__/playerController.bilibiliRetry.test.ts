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
  },
  Capability: {
    Play: 1,
    Pause: 2,
    Stop: 3,
    SkipToNext: 4,
    SkipToPrevious: 5,
    SeekTo: 6,
  },
  RepeatMode: { Track: 1, Off: 0 },
  State: { Playing: 1 },
}));
jest.mock('../../api/client', () => ({
  providerClient: {
    bootstrapTrack: (...args: unknown[]) => mockBootstrap(...args),
  },
}));
jest.mock('../../offline/offlineAudio', () => ({
  isOfflineDownloadEligible: () => false,
  offlineAudio: { resolveVerified: jest.fn() },
}));

import reducer, { type PlayerState } from '../../store/playerSlice';
import {
  configurePlayerController,
  playerController,
} from '../playerController';

describe('Bilibili bounded native retry', () => {
  let state: PlayerState;
  const dispatch = (action: any) => {
    state = reducer(state, action);
    return action;
  };
  beforeEach(() => {
    jest.clearAllMocks();
    Object.values(mockNative).forEach(mock =>
      mock.mockResolvedValue(undefined),
    );
    state = reducer(undefined, { type: 'init' });
    configurePlayerController({ dispatch, getPlayerState: () => state });
    const deadline = Math.floor(Date.now() / 1000) + 60;
    mockBootstrap.mockResolvedValue({
      url: `https://upos-sz-mirrorcos.bilivideo.com/audio.m4s?deadline=${deadline}`,
      headers: { Referer: 'https://www.bilibili.com/' },
    });
  });
  it('re-resolves a transient Bilibili item once without adding a video item', async () => {
    mockNative.add.mockRejectedValueOnce(
      Object.assign(new Error('expired'), { code: 'NETWORK_ERROR' }),
    );
    await expect(
      playerController.playTrack(dispatch, {
        id: 'bitrack_v_BV1xx411c7mD-12',
        source: 'bilibili',
        title: '测试',
        artist: '作者',
      }),
    ).resolves.toBe(true);
    expect(mockBootstrap).toHaveBeenCalledTimes(2);
    expect(mockNative.add).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(mockNative.add.mock.calls)).not.toContain(
      'video/mp4',
    );
  });
});
