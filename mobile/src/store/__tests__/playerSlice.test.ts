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

    expect(state.playNextQueue.map(item => item.track.id)).toEqual([
      'ne_1',
      'ne_1',
      'ne_2',
    ]);
    expect(state.playNextQueue[0].occurrenceId).not.toBe(
      state.playNextQueue[1].occurrenceId,
    );
    state = reducer(state, playerActions.beginTransition(1));
    state = reducer(
      state,
      playerActions.consumeQueuedNext({
        occurrenceId: state.playNextQueue[0].occurrenceId,
        transitionToken: 1,
      }),
    );
    expect(state.playNextQueue.map(item => item.track.id)).toEqual([
      'ne_1',
      'ne_2',
    ]);
  });

  it('edits queued rows by occurrence rather than a duplicate track identity', () => {
    const duplicate = track('ne_1');
    let state = reducer(undefined, playerActions.enqueueNext(duplicate));
    state = reducer(state, playerActions.enqueueNext(duplicate));
    state = reducer(state, playerActions.enqueueNext(track('ne_2')));
    const [first, second, third] = state.playNextQueue;

    state = reducer(
      state,
      playerActions.moveQueuedNext({
        occurrenceId: third.occurrenceId,
        direction: -1,
      }),
    );
    expect(state.playNextQueue.map(item => item.occurrenceId)).toEqual([
      first.occurrenceId,
      third.occurrenceId,
      second.occurrenceId,
    ]);
    state = reducer(state, playerActions.removeQueuedNext(second.occurrenceId));
    expect(state.playNextQueue.map(item => item.occurrenceId)).toEqual([
      first.occurrenceId,
      third.occurrenceId,
    ]);
    state = reducer(state, playerActions.clearPlayNextQueue());
    expect(state.playNextQueue).toEqual([]);
    expect(state.playlist).toEqual([]);
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

  it('invalidates an in-flight transition when the play-next queue is cleared', () => {
    let state = reducer(undefined, playerActions.beginTransition(7));
    state = reducer(state, playerActions.enqueueNext(track('ne_1')));
    state = reducer(state, playerActions.clearPlayNextQueue());

    expect(state.playNextQueue).toEqual([]);
    expect(state.transitionToken).toBeGreaterThan(7);
  });

  it('invalidates an in-flight transition when a queued occurrence is reordered', () => {
    let state = reducer(undefined, playerActions.enqueueNext(track('ne_1')));
    state = reducer(state, playerActions.enqueueNext(track('ne_2')));
    state = reducer(state, playerActions.beginTransition(7));
    state = reducer(
      state,
      playerActions.moveQueuedNext({
        occurrenceId: state.playNextQueue[0].occurrenceId,
        direction: 1,
      }),
    );

    expect(state.playNextQueue.map(item => item.track.id)).toEqual([
      'ne_2',
      'ne_1',
    ]);
    expect(state.transitionToken).toBeGreaterThan(7);
  });

  it('invalidates an in-flight transition when the playlist is replaced', () => {
    let state = reducer(undefined, playerActions.beginTransition(4));
    state = reducer(
      state,
      playerActions.replacePlaylist({ tracks: [track('ne_new')] }),
    );

    expect(state.currentTrack?.id).toBe('ne_new');
    expect(state.transitionToken).toBeGreaterThan(4);
  });

  it('invalidates an in-flight transition when a track is removed everywhere', () => {
    const removed = track('ne_remove');
    let state = reducer(
      undefined,
      playerActions.replacePlaylist({ tracks: [track('ne_1'), removed] }),
    );
    state = reducer(state, playerActions.enqueueNext(removed));
    state = reducer(state, playerActions.beginTransition(9));
    state = reducer(state, playerActions.removeTrackReferences(removed.id));

    expect(state.transitionToken).toBeGreaterThan(9);
    expect(state.playlist.map(item => item.id)).not.toContain(removed.id);
    expect(state.playNextQueue.map(item => item.track.id)).not.toContain(
      removed.id,
    );
  });

  it('keeps the shuffle round and cursor valid when a playlist item is appended', () => {
    let state = reducer(
      undefined,
      playerActions.replacePlaylist({
        tracks: [track('ne_1'), track('ne_2'), track('ne_3')],
        startIndex: 1,
      }),
    );
    state = reducer(
      state,
      playerActions.setPlayModeSnapshot(PLAY_MODE.SHUFFLE),
    );
    const priorOrder = state.shuffleOrder;
    const priorCursor = state.shuffleCursor;
    state = reducer(state, playerActions.appendPlaylistTrack(track('ne_4')));

    expect(state.shuffleOrder.slice(0, priorOrder.length)).toEqual(priorOrder);
    expect(state.shuffleOrder).toContain(3);
    expect(state.shuffleCursor).toBe(priorCursor);
    expect(state.shuffleOrder[state.shuffleCursor]).toBe(state.currentIndex);
  });
});
