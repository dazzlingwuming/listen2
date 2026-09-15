import reducer, { hydrationSucceeded, mutationReceived } from '../../store/librarySlice';

const snapshot = (revision: number) => ({
  schemaVersion: 1 as const,
  revision,
  personalPlaylists: [{ playlistId: 'p-one', title: 'Road trip', position: 0, tracks: [{ source: 'netease' as const, trackId: 'track-one', title: 'Song', artist: 'Artist' }] }],
  favorites: [{ source: 'netease' as const, trackId: 'track-one', title: 'Song', artist: 'Artist' }],
  localRecords: [],
});

describe('receipt-backed library flow', () => {
  it('replaces visible personal and favorite sections only from a confirmed receipt', () => {
    let state = reducer(undefined, hydrationSucceeded(snapshot(2)));
    expect(state.playlists[0].tracks[0]).toMatchObject({ id: 'track-one', source: 'netease' });
    expect(state.favorites).toHaveLength(1);
    state = reducer(state, mutationReceived({ requestId: 'create-1', status: 'accepted', revision: 3, errorCode: null, snapshot: snapshot(3) }));
    expect(state.revision).toBe(3);
    expect(state.playlists[0].title).toBe('Road trip');
  });
});
