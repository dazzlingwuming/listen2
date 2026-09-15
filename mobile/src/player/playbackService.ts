import TrackPlayer, { Event, State } from 'react-native-track-player';
import { playerController } from './playerController';

/**
 * This service is registered from index.js. It intentionally delegates every
 * command to PlayerController so the native player remains the only audio owner
 * and Redux only receives a snapshot of that native state.
 */
export default async function playbackService() {
  // RNTP progress/terminal callbacks do not all carry a track object.  The
  // active-track event is the only authoritative identity hand-off.  In
  // particular, state/error events have no track identifier, so they stay
  // quarantined until RNTP can verify the observed active identity.
  let activeIdentity: ReturnType<
    typeof playerController.onNativeActiveTrackChanged
  > = null;
  const callbackIdentity = (nativeTrackIndex?: number) => {
    if (!activeIdentity) return undefined;
    if (
      nativeTrackIndex !== undefined &&
      activeIdentity.nativeTrackIndex !== undefined &&
      nativeTrackIndex !== activeIdentity.nativeTrackIndex
    ) {
      return undefined;
    }
    return activeIdentity;
  };
  const sameIdentity = (
    first: typeof activeIdentity,
    second: typeof activeIdentity,
  ) =>
    first === second ||
    Boolean(
      first &&
        second &&
        first.nativeTrackId === second.nativeTrackId &&
        first.generation === second.generation &&
        first.nativeTrackIndex === second.nativeTrackIndex,
    );
  const verifiedTerminalIdentity = async (
    expectedState: State,
  ): Promise<typeof activeIdentity> => {
    // RNTP omits the originating track from state/error events. Capture the
    // last native active-track hand-off, then confirm it is still active and
    // that RNTP's current state still has the event's meaning. This prevents
    // a late A callback from being attributed to B after a queue transition.
    const observedIdentity = activeIdentity;
    if (!observedIdentity) return null;
    try {
      const [nativeTrack, playbackState] = await Promise.all([
        TrackPlayer.getActiveTrack(),
        TrackPlayer.getPlaybackState(),
      ]);
      if (
        !sameIdentity(observedIdentity, activeIdentity) ||
        !nativeTrack ||
        nativeTrack.id !== observedIdentity.nativeTrackId ||
        playbackState.state !== expectedState
      ) {
        return null;
      }
      return observedIdentity;
    } catch {
      // A reset or service teardown can reject these reads. No verified
      // identity means no terminal reducer mutation.
      return null;
    }
  };
  const settle = async (operation: () => Promise<unknown>) => {
    try {
      await operation();
    } catch {
      // Event callbacks have no caller to receive a rejection. Controller
      // methods already emit safe state; never leak an unhandled promise.
    }
  };
  TrackPlayer.addEventListener(Event.RemotePlay, () =>
    settle(() => playerController.play()),
  );
  TrackPlayer.addEventListener(Event.RemotePause, () =>
    settle(() => playerController.pause()),
  );
  TrackPlayer.addEventListener(Event.RemoteStop, () =>
    settle(() => playerController.stop()),
  );
  TrackPlayer.addEventListener(Event.RemoteNext, () =>
    settle(() => playerController.next()),
  );
  TrackPlayer.addEventListener(Event.RemotePrevious, () =>
    settle(() => playerController.previous()),
  );
  TrackPlayer.addEventListener(Event.RemoteSeek, event =>
    settle(() => playerController.seek(undefined, event.position)),
  );
  TrackPlayer.addEventListener(Event.RemoteDuck, event => {
    if (event.paused || event.permanent)
      return settle(() => playerController.pause());
  });
  TrackPlayer.addEventListener(Event.PlaybackProgressUpdated, event => {
    playerController.onProgress(
      event.position,
      event.duration,
      event.buffered,
      callbackIdentity(event.track),
    );
  });
  TrackPlayer.addEventListener(Event.PlaybackState, event =>
    settle(async () => {
      const state = event.state as State;
      const identity = await verifiedTerminalIdentity(state);
      if (identity) playerController.onPlaybackState(state, identity);
    }),
  );
  TrackPlayer.addEventListener(Event.PlaybackError, () =>
    settle(async () => {
      const identity = await verifiedTerminalIdentity(State.Error);
      if (identity) playerController.onPlaybackError(identity);
    }),
  );
  TrackPlayer.addEventListener(Event.PlaybackQueueEnded, event =>
    playerController.onPlaybackQueueEnded(callbackIdentity(event.track)),
  );
  TrackPlayer.addEventListener(Event.PlaybackActiveTrackChanged, event => {
    const nextIdentity = playerController.onNativeActiveTrackChanged(
      event.track,
      event.index,
    );
    if (nextIdentity) activeIdentity = nextIdentity;
  });
}
