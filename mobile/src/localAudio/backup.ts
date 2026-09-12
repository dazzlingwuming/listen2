import type { BackupImportState } from '../backup/backupCodec';
import type { LibraryState } from '../store/librarySlice';
import type { PlayerState } from '../store/playerSlice';
import type { PlayableTrack, Track } from '../types/music';

function remoteOnly(tracks: readonly PlayableTrack[]): Track[] {
  return tracks.filter((track): track is Track => track.source !== 'local');
}

/** Keep local content URIs and their metadata out of portable JSON backups. */
export function createPortableBackupState(
  library: LibraryState,
  player: PlayerState,
): BackupImportState {
  const currentQueue = player.playNextQueue.length
    ? { queue: player.playNextQueue, queueMode: 'play-next' as const }
    : { queue: player.playlist, queueMode: 'playlist' as const };
  return {
    favorites: remoteOnly(library.favorites),
    playlists: library.playlists.map(playlist => ({
      ...playlist,
      tracks: remoteOnly(playlist.tracks),
    })),
    queue: remoteOnly(currentQueue.queue),
    queueMode: currentQueue.queueMode,
  };
}
