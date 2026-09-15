import { Event } from 'react-native-track-player';

const mockListeners = new Map<string, () => unknown>();
const mockNative = {
  addEventListener: jest.fn((event: string, listener: () => unknown) => {
    mockListeners.set(event, listener);
    return { remove: jest.fn() };
  }),
};
const mockController = {
  play: jest.fn().mockResolvedValue(true),
  pause: jest.fn().mockResolvedValue(true),
  stop: jest.fn().mockResolvedValue(true),
  next: jest.fn().mockResolvedValue(true),
  previous: jest.fn().mockResolvedValue(true),
  seek: jest.fn().mockResolvedValue(true),
  onProgress: jest.fn(),
  onPlaybackState: jest.fn(),
  onPlaybackError: jest.fn(),
  onPlaybackQueueEnded: jest.fn().mockResolvedValue(true),
};

jest.mock('react-native-track-player', () => ({
  __esModule: true,
  default: {
    addEventListener: (...args: unknown[]) =>
      (mockNative.addEventListener as jest.Mock)(...args),
  },
  Event: {
    RemotePlay: 'remote-play',
    RemotePause: 'remote-pause',
    RemoteStop: 'remote-stop',
    RemoteNext: 'remote-next',
    RemotePrevious: 'remote-previous',
    RemoteSeek: 'remote-seek',
    RemoteDuck: 'remote-duck',
    PlaybackProgressUpdated: 'playback-progress-updated',
    PlaybackState: 'playback-state',
    PlaybackError: 'playback-error',
    PlaybackQueueEnded: 'playback-queue-ended',
    PlaybackActiveTrackChanged: 'playback-active-track-changed',
  },
  State: { Playing: 'playing' },
}));

jest.mock('../playerController', () => ({
  playerController: {
    play: (...args: unknown[]) => mockController.play(...args),
    pause: (...args: unknown[]) => mockController.pause(...args),
    stop: (...args: unknown[]) => mockController.stop(...args),
    next: (...args: unknown[]) => mockController.next(...args),
    previous: (...args: unknown[]) => mockController.previous(...args),
    seek: (...args: unknown[]) => mockController.seek(...args),
    onProgress: (...args: unknown[]) => mockController.onProgress(...args),
    onPlaybackState: (...args: unknown[]) =>
      mockController.onPlaybackState(...args),
    onPlaybackError: (...args: unknown[]) => mockController.onPlaybackError(...args),
    onPlaybackQueueEnded: (...args: unknown[]) =>
      mockController.onPlaybackQueueEnded(...args),
  },
}));

import playbackService from '../playbackService';

describe('playbackService delegation', () => {
  beforeEach(() => {
    mockListeners.clear();
    jest.clearAllMocks();
  });

  it('uses the controller stop/reset boundary for RemoteStop', async () => {
    await playbackService();

    const listener = mockListeners.get(Event.RemoteStop);
    expect(listener).toEqual(expect.any(Function));
    await listener?.();

    expect(mockController.stop).toHaveBeenCalledTimes(1);
    expect(mockController.pause).not.toHaveBeenCalled();
  });

  it('captures rejected remote commands instead of creating an unhandled callback rejection', async () => {
    mockController.pause.mockRejectedValueOnce(new Error('native pause failed'));
    await playbackService();

    await expect(mockListeners.get(Event.RemotePause)?.()).resolves.toBeUndefined();
  });
});
