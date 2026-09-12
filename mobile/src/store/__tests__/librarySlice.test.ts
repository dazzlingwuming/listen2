import reducer, {
  addTrackToPlaylist,
  clearRecent,
  createPlaylist,
  recordRecent,
  toggleFavorite,
} from '../librarySlice';
import type { Track } from '../../types/music';

const track = (id: string): Track => ({
  id,
  source: 'netease',
  title: `song-${id}`,
  artist: 'artist',
});

describe('librarySlice', () => {
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
});
