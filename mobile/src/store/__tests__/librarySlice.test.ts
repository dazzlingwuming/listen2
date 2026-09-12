import reducer, {
  addTrackToPlaylist,
  clearRecent,
  createPlaylist,
  importLocalTracks,
  recordRecent,
  removeLocalTrack,
  toggleFavorite,
} from '../librarySlice';
import type { LocalTrack, Track } from '../../types/music';

const track = (id: string): Track => ({
  id,
  source: 'netease',
  title: `song-${id}`,
  artist: 'artist',
});

describe('librarySlice', () => {
  const localTrack = (id: string, contentUri: string): LocalTrack => ({
    id,
    source: 'local',
    title: `local-${id}`,
    artist: '本地音频',
    contentUri,
    fileName: `${id}.mp3`,
  });

  it('toggles a favorite using its provider identity', () => {
    let state = reducer(undefined, toggleFavorite(track('netrack_1')));
    expect(state.favorites).toHaveLength(1);
    state = reducer(state, toggleFavorite(track('netrack_1')));
    expect(state.favorites).toHaveLength(0);
  });

  it('keeps recent tracks unique and newest first', () => {
    let state = reducer(undefined, recordRecent(track('netrack_1')));
    state = reducer(state, recordRecent(track('netrack_2')));
    state = reducer(state, recordRecent(track('netrack_1')));
    expect(state.recentTracks.map(item => item.id)).toEqual([
      'netrack_1',
      'netrack_2',
    ]);
    expect(reducer(state, clearRecent()).recentTracks).toEqual([]);
  });

  it('creates a playlist and de-duplicates tracks inside it', () => {
    let state = reducer(
      undefined,
      createPlaylist({ id: 'myplaylist_one', title: '  Road trip  ' }),
    );
    state = reducer(
      state,
      addTrackToPlaylist({
        playlistId: 'myplaylist_one',
        track: track('netrack_1'),
      }),
    );
    state = reducer(
      state,
      addTrackToPlaylist({
        playlistId: 'myplaylist_one',
        track: track('netrack_1'),
      }),
    );
    expect(state.playlists[0]).toMatchObject({
      title: 'Road trip',
      tracks: [{ id: 'netrack_1' }],
    });
  });

  it('persists imported local tracks once and removes their stale references', () => {
    const imported = localTrack('local_1', 'content://provider/one');
    let state = reducer(
      undefined,
      importLocalTracks([
        imported,
        localTrack('local_2', 'content://provider/one'),
      ]),
    );
    state = reducer(
      state,
      createPlaylist({ id: 'myplaylist_2', title: 'Local' }),
    );
    state = reducer(
      state,
      addTrackToPlaylist({
        playlistId: 'myplaylist_2',
        track: imported,
      }),
    );

    expect(state.localTracks).toEqual([imported]);
    state = reducer(state, removeLocalTrack(imported.id));
    expect(state.localTracks).toEqual([]);
    expect(state.playlists[0].tracks).toEqual([]);
  });

  it('repairs an existing local URI instead of creating a duplicate', () => {
    const imported = {
      ...localTrack('local_1', 'content://provider/one'),
      accessStatus: 'needs-repair' as const,
    };
    let state = reducer(undefined, importLocalTracks([imported]));
    state = reducer(
      state,
      importLocalTracks([
        {
          ...localTrack('different_id', imported.contentUri),
          title: 'Refreshed',
          accessStatus: 'available',
        },
      ]),
    );

    expect(state.localTracks).toHaveLength(1);
    expect(state.localTracks[0]).toMatchObject({
      id: imported.id,
      title: 'Refreshed',
      accessStatus: 'available',
    });
  });
});
