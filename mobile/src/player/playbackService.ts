import TrackPlayer, { Event, State } from 'react-native-track-player';
import { playerController } from './playerController';

/**
 * This service is registered from index.js. It intentionally delegates every
 * command to PlayerController so the native player remains the only audio owner
 * and Redux only receives a snapshot of that native state.
 */
export default async function playbackService() {
  TrackPlayer.addEventListener(Event.RemotePlay, () => playerController.play());
  TrackPlayer.addEventListener(Event.RemotePause, () =>
    playerController.pause(),
  );
  TrackPlayer.addEventListener(Event.RemoteStop, () =>
    playerController.pause(),
  );
  TrackPlayer.addEventListener(Event.RemoteNext, () => playerController.next());
  TrackPlayer.addEventListener(Event.RemotePrevious, () =>
    playerController.previous(),
  );
  TrackPlayer.addEventListener(Event.RemoteSeek, event =>
    playerController.seek(undefined, event.position),
  );
  TrackPlayer.addEventListener(Event.RemoteDuck, event => {
    if (event.paused || event.permanent) return playerController.pause();
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
    playerController.next(),
  );
}
