import { Event, State } from 'react-native-track-player';

const mockListeners = new Map<string, (...args: any[]) => unknown>();
const mockNative = {
  addEventListener: jest.fn(
    (event: string, listener: (...args: any[]) => unknown) => {
      mockListeners.set(event, listener);
      return { remove: jest.fn() };
    },
  ),
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
  onNativeActiveTrackChanged: jest.fn(),
  nativeCallbackIdentity: jest.fn(),
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
    onPlaybackError: (...args: unknown[]) =>
      mockController.onPlaybackError(...args),
    onPlaybackQueueEnded: (...args: unknown[]) =>
      mockController.onPlaybackQueueEnded(...args),
    onNativeActiveTrackChanged: (...args: unknown[]) =>
      mockController.onNativeActiveTrackChanged(...args),
    nativeCallbackIdentity: (...args: unknown[]) =>
      mockController.nativeCallbackIdentity(...args),
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
    mockController.pause.mockRejectedValueOnce(
      new Error('native pause failed'),
    );
    await playbackService();

    await expect(
      mockListeners.get(Event.RemotePause)?.(),
    ).resolves.toBeUndefined();
  });

  it('binds generated active-track identity to progress and terminal callbacks', async () => {
    const identity = {
      nativeTrackId: 'listen2:netrack_2:generated',
      generation: 7,
      nativeTrackIndex: 0,
    };
    mockController.onNativeActiveTrackChanged.mockReturnValue(identity);
    mockController.nativeCallbackIdentity.mockReturnValue(identity);
    await playbackService();

    mockListeners.get(Event.PlaybackActiveTrackChanged)?.({
      index: 0,
      track: { id: identity.nativeTrackId },
    });
    mockListeners.get(Event.PlaybackProgressUpdated)?.({
      position: 12,
      duration: 120,
      buffered: 24,
      track: 0,
    });
    mockListeners.get(Event.PlaybackState)?.({ state: State.Playing });
    mockListeners.get(Event.PlaybackError)?.({});
    await mockListeners.get(Event.PlaybackQueueEnded)?.({ track: 0 });

    expect(mockController.onNativeActiveTrackChanged).toHaveBeenCalledWith(
      { id: identity.nativeTrackId },
      0,
    );
    expect(mockController.onProgress).toHaveBeenCalledWith(
      12,
      120,
      24,
      identity,
    );
    expect(mockController.onPlaybackState).toHaveBeenCalledWith(
      State.Playing,
      identity,
    );
    expect(mockController.onPlaybackError).toHaveBeenCalledWith(identity);
    expect(mockController.onPlaybackQueueEnded).toHaveBeenCalledWith(identity);
  });
});
