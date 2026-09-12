import { createBackup, stringifyBackup } from '../../backup/backupCodec';
import { createPortableBackupState } from '../backup';
import type { LocalTrack, Track } from '../../types/music';
import type { LibraryState } from '../../store/librarySlice';
import type { PlayerState } from '../../store/playerSlice';

const remote: Track = {
  id: 'netrack_1',
  source: 'netease',
  title: 'Remote',
  artist: 'Listen2',
};
const local: LocalTrack = {
  id: 'local_1',
  source: 'local',
  title: 'Private',
  artist: '本地音频',
  contentUri: 'content://documents/private-audio',
  fileName: 'Private.mp3',
  mimeType: 'audio/mpeg',
};

it('filters local audio from every portable backup collection', () => {
  const library: LibraryState = {
    favorites: [remote, local as unknown as Track],
    recentTracks: [],
    localTracks: [local],
    playlists: [
      {
        id: 'myplaylist_1',
        title: 'Mixed',
        tracks: [remote, local as unknown as Track],
      },
    ],
  };
  const player = {
    playlist: [remote, local as unknown as Track],
    playNextQueue: [],
  } as unknown as PlayerState;

  const snapshot = createPortableBackupState(library, player);
  const serialized = stringifyBackup(
    snapshot,
    new Date('2026-09-12T00:00:00Z'),
  );

  expect(createBackup(snapshot).favorites).toEqual([remote]);
  expect(JSON.parse(serialized)).toMatchObject({
    favorites: [remote],
    playlists: [{ tracks: [remote] }],
    queue: [remote],
  });
  expect(serialized).not.toContain('content://');
});
