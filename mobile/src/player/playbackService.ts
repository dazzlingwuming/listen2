import TrackPlayer, { Event, State } from 'react-native-track-player';
import { playerController } from './playerController';

/**
 * This service is registered from index.js. It intentionally delegates every
 * command to PlayerController so the native player remains the only audio owner
 * and Redux only receives a snapshot of that native state.
 */
export default async function playbackService() {
  const settle = async (operation: () => Promise<unknown>) => {
    try {
      await operation();
    } catch {
      // Event callbacks have no caller to receive a rejection. Controller
      // methods already emit safe state; never leak an unhandled promise.
    }
  };
  TrackPlayer.addEventListener(Event.RemotePlay, () => settle(() => playerController.play()));
  TrackPlayer.addEventListener(Event.RemotePause, () =>
    settle(() => playerController.pause()),
  );
  TrackPlayer.addEventListener(Event.RemoteStop, () =>
    settle(() => playerController.stop()),
  );
  TrackPlayer.addEventListener(Event.RemoteNext, () => settle(() => playerController.next()));
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
    playerController.onProgress(event.position, event.duration, event.buffered);
  });
  TrackPlayer.addEventListener(Event.PlaybackState, event => {
    playerController.onPlaybackState(event.state as State);
  });
  TrackPlayer.addEventListener(Event.PlaybackError, () => {
    playerController.onPlaybackError();
  });
  TrackPlayer.addEventListener(Event.PlaybackQueueEnded, () =>
    playerController.onPlaybackQueueEnded(),
  );
}
