import reducer, {
  createPlaylist,
  hydrationFailed,
  hydrationStarted,
  hydrationSucceeded,
  mutationPending,
  mutationReceived,
} from '../librarySlice';

const snapshot = (revision: number) => ({
  schemaVersion: 1 as const,
  revision,
  personalPlaylists: [
    { playlistId: 'myplaylist_one', title: 'Road trip', position: 0, tracks: [] },
  ],
  favorites: [],
});

describe('librarySlice', () => {
  it('hydrates a native projection and never accepts an older revision', () => {
    let state = reducer(undefined, hydrationStarted());
    expect(state.hydrationPending).toBe(true);
    state = reducer(state, hydrationSucceeded(snapshot(4)));
    expect(state).toMatchObject({ revision: 4, hydrated: true, hydrationPending: false });
    expect(state.playlists).toEqual([{ id: 'myplaylist_one', title: 'Road trip', tracks: [] }]);
    state = reducer(state, hydrationSucceeded(snapshot(3)));
    expect(state.revision).toBe(4);
  });

  it('tracks a correlated receipt without making Redux a second write backend', () => {
    let state = reducer(undefined, mutationPending({ requestId: 'request-1' }));
    state = reducer(state, mutationReceived({
      requestId: 'request-1', status: 'accepted', revision: 5, errorCode: null, snapshot: snapshot(5),
    }));
    expect(state.pendingRequestIds).toEqual([]);
    expect(state.revision).toBe(5);
    const unchanged = reducer(state, createPlaylist({ id: 'wrong', title: 'Wrong backend' }));
    expect(unchanged.playlists).toEqual(state.playlists);
  });

  it('keeps boot failure explicit and retryable', () => {
    const state = reducer(reducer(undefined, hydrationStarted()), hydrationFailed('TIMEOUT'));
    expect(state).toMatchObject({ hydrated: false, hydrationPending: false, hydrationError: 'TIMEOUT' });
  });
});
