import { Event, State } from 'react-native-track-player';

const mockListeners = new Map<string, (...args: any[]) => unknown>();
const mockNative = {
  addEventListener: jest.fn(
    (event: string, listener: (...args: any[]) => unknown) => {
      mockListeners.set(event, listener);
      return { remove: jest.fn() };
    },
  ),
  getActiveTrack: jest.fn(),
  getPlaybackState: jest.fn(),
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
};

jest.mock('react-native-track-player', () => ({
  __esModule: true,
  default: {
    addEventListener: (...args: unknown[]) =>
      (mockNative.addEventListener as jest.Mock)(...args),
    getActiveTrack: (...args: unknown[]) => mockNative.getActiveTrack(...args),
    getPlaybackState: (...args: unknown[]) =>
      mockNative.getPlaybackState(...args),
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
  State: { Playing: 'playing', Paused: 'paused', Error: 'error' },
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
  },
}));

import playbackService from '../playbackService';

describe('playbackService delegation', () => {
  beforeEach(() => {
    mockListeners.clear();
    jest.clearAllMocks();
    mockNative.getActiveTrack.mockResolvedValue(undefined);
    mockNative.getPlaybackState.mockResolvedValue({ state: State.Playing });
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

  it('binds generated active-track identity to progress and verified terminal callbacks', async () => {
    const identity = {
      nativeTrackId: 'listen2:netrack_2:generated',
      generation: 7,
      nativeTrackIndex: 0,
    };
    mockController.onNativeActiveTrackChanged.mockReturnValue(identity);
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
    mockNative.getActiveTrack.mockResolvedValue({ id: identity.nativeTrackId });
    mockNative.getPlaybackState.mockResolvedValue({ state: State.Playing });
    await mockListeners.get(Event.PlaybackState)?.({ state: State.Playing });
    mockNative.getPlaybackState.mockResolvedValue({ state: State.Error });
    await mockListeners.get(Event.PlaybackError)?.({});
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

  it('rejects late A terminal events after B is active, while accepting B pause and error', async () => {
    const firstIdentity = {
      nativeTrackId: 'listen2:netrack_a:generated',
      generation: 7,
      nativeTrackIndex: 0,
    };
    const secondIdentity = {
      nativeTrackId: 'listen2:netrack_b:generated',
      generation: 8,
      nativeTrackIndex: 0,
    };
    mockController.onNativeActiveTrackChanged
      .mockReturnValueOnce(firstIdentity)
      .mockReturnValueOnce(secondIdentity);
    await playbackService();

    mockListeners.get(Event.PlaybackActiveTrackChanged)?.({
      index: 0,
      track: { id: firstIdentity.nativeTrackId },
    });
    mockListeners.get(Event.PlaybackActiveTrackChanged)?.({
      index: 0,
      track: { id: secondIdentity.nativeTrackId },
    });

    // A delayed A callback cannot be assigned to B merely because RNTP now
    // reports B as active: its reported event state must match live native
    // state, and an error must have reached RNTP's Error state.
    mockNative.getActiveTrack.mockResolvedValue({
      id: secondIdentity.nativeTrackId,
    });
    mockNative.getPlaybackState.mockResolvedValue({ state: State.Playing });
    await mockListeners.get(Event.PlaybackState)?.({ state: State.Paused });
    await mockListeners.get(Event.PlaybackError)?.({});

    expect(mockController.onPlaybackState).not.toHaveBeenCalled();
    expect(mockController.onPlaybackError).not.toHaveBeenCalled();

    mockNative.getPlaybackState.mockResolvedValue({ state: State.Paused });
    await mockListeners.get(Event.PlaybackState)?.({ state: State.Paused });
    mockNative.getPlaybackState.mockResolvedValue({ state: State.Error });
    await mockListeners.get(Event.PlaybackError)?.({});

    expect(mockController.onPlaybackState).toHaveBeenLastCalledWith(
      State.Paused,
      secondIdentity,
    );
    expect(mockController.onPlaybackError).toHaveBeenLastCalledWith(
      secondIdentity,
    );
  });

  it('drops an identifier-less terminal callback when active generation changes during its native query', async () => {
    const firstIdentity = {
      nativeTrackId: 'listen2:netrack_a:generated',
      generation: 7,
      nativeTrackIndex: 0,
    };
    const secondIdentity = {
      nativeTrackId: 'listen2:netrack_b:generated',
      generation: 8,
      nativeTrackIndex: 0,
    };
    let resolveActiveTrack: ((value: { id: string }) => void) | undefined;
    let resolvePlaybackState: ((value: { state: string }) => void) | undefined;
    mockController.onNativeActiveTrackChanged
      .mockReturnValueOnce(firstIdentity)
      .mockReturnValueOnce(secondIdentity);
    mockNative.getActiveTrack.mockImplementation(
      () =>
        new Promise(resolve => {
          resolveActiveTrack = resolve;
        }),
    );
    mockNative.getPlaybackState.mockImplementation(
      () =>
        new Promise(resolve => {
          resolvePlaybackState = resolve;
        }),
    );
    await playbackService();

    mockListeners.get(Event.PlaybackActiveTrackChanged)?.({
      index: 0,
      track: { id: firstIdentity.nativeTrackId },
    });
    const pendingState = mockListeners.get(Event.PlaybackState)?.({
      state: State.Paused,
    });
    mockListeners.get(Event.PlaybackActiveTrackChanged)?.({
      index: 0,
      track: { id: secondIdentity.nativeTrackId },
    });
    resolveActiveTrack?.({ id: secondIdentity.nativeTrackId });
    resolvePlaybackState?.({ state: State.Paused });
    await pendingState;

    expect(mockController.onPlaybackState).not.toHaveBeenCalled();
  });
});
