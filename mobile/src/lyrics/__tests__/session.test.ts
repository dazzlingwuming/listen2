import {
  createLyricSession,
  lyricSessionKey,
  reduceLyricSession,
} from '../session';

describe('lyric sessions', () => {
  const first = createLyricSession({
    source: 'bilibili',
    trackId: 'bitrack_v_BV1xx411c7mD-123',
    occurrenceId: 'play-next-a',
    revision: 2,
  });

  it('binds results to exact source, part, occurrence and revision', () => {
    expect(first).not.toBeNull();
    const loading = reduceLyricSession(
      { generation: 0, status: 'idle' },
      { type: 'begin', session: first! },
    );
    const otherOccurrence = createLyricSession({
      source: 'bilibili',
      trackId: 'bitrack_v_BV1xx411c7mD-123',
      occurrenceId: 'play-next-b',
      revision: 2,
    })!;
    expect(
      reduceLyricSession(loading, {
        type: 'resolve',
        session: otherOccurrence,
        generation: loading.generation,
        value: 'late lyric',
      }),
    ).toEqual(loading);
    expect(
      reduceLyricSession(loading, {
        type: 'resolve',
        session: first!,
        generation: loading.generation,
        value: 'current lyric',
      }),
    ).toMatchObject({ status: 'ready', value: 'current lyric' });
  });

  it('invalidates late settlement after part or revision changes', () => {
    const loading = reduceLyricSession(
      { generation: 4, status: 'ready', value: 'old' },
      { type: 'begin', session: first! },
    );
    const revised = createLyricSession({
      source: 'bilibili',
      trackId: 'bitrack_v_BV1xx411c7mD-124',
      occurrenceId: 'play-next-a',
      revision: 3,
    })!;
    const switched = reduceLyricSession(loading, { type: 'begin', session: revised });
    expect(lyricSessionKey(switched.session!)).not.toBe(lyricSessionKey(first!));
    expect(
      reduceLyricSession(switched, {
        type: 'reject',
        session: first!,
        generation: loading.generation,
        error: 'late',
      }),
    ).toEqual(switched);
  });
});
