jest.mock('react-native-track-player', () => ({
  __esModule: true,
  default: {},
  Capability: {},
  RepeatMode: {},
  State: {},
}));

import reducer, {
  PLAY_MODE,
  playerActions,
  shuffleIndexes,
} from '../playerSlice';

const track = (id: string) => ({
  id,
  source: 'netease' as const,
  title: id,
  artist: 'Listen1',
});

describe('playerSlice', () => {
  it('keeps duplicate play-next requests in FIFO order', () => {
    const duplicate = track('ne_1');
    let state = reducer(undefined, playerActions.enqueueNext(duplicate));
    state = reducer(state, playerActions.enqueueNext(duplicate));
    state = reducer(state, playerActions.enqueueNext(track('ne_2')));

    expect(state.playNextQueue.map(item => item.id)).toEqual([
      'ne_1',
      'ne_1',
      'ne_2',
    ]);
    state = reducer(state, playerActions.consumeQueuedNext());
    expect(state.playNextQueue.map(item => item.id)).toEqual(['ne_1', 'ne_2']);
  });

  it('records actual previous history rather than deriving previous from the playlist', () => {
    let state = reducer(
      undefined,
      playerActions.replacePlaylist({ tracks: [track('ne_1'), track('ne_2')] }),
    );
    state = reducer(
      state,
      playerActions.activateTrack({
        track: track('ne_3'),
        playlistIndex: 0,
        source: 'play-next',
        rememberCurrent: true,
      }),
    );
    const entry = state.history[state.history.length - 1];
    state = reducer(
      state,
      playerActions.restoreHistory({ entry, remaining: [] }),
    );

    expect(state.currentTrack?.id).toBe('ne_1');
    expect(state.currentSource).toBe('playlist');
    expect(state.history).toEqual([]);
  });

  it('retains the v0.8.2 numeric play-mode contract and generates a permutation', () => {
    expect(PLAY_MODE).toEqual({ LOOP: 0, SHUFFLE: 1, REPEAT_ONE: 2 });
    expect(shuffleIndexes(5, () => 0)).toEqual([1, 2, 3, 4, 0]);
  });
});
