import {
  canAutoApplyBilibiliCandidate,
  scoreBilibiliCandidate,
} from '../lyrics';

const track = {
  id: 'bitrack_v_BV1xx411c7mD-12',
  source: 'bilibili' as const,
  title: 'Song Title',
  artist: 'Artist',
  durationMs: 180_000,
};

describe('Bilibili lyric identity and strict scorer', () => {
  const candidate = {
    id: 'netrack_1',
    matchedProvider: 'netease' as const,
    title: 'Song Title',
    artist: 'Artist',
    durationMs: 180_000,
    text: '[00:01.00]Original',
    matchScore: 1,
    hasTranslation: false,
  };

  it('requires an exact safe BVID/CID selection for automatic lyrics', () => {
    expect(canAutoApplyBilibiliCandidate(track, candidate)).toBe(true);
    expect(
      canAutoApplyBilibiliCandidate(
        { ...track, durationMs: undefined },
        candidate,
      ),
    ).toBe(false);
    expect(
      canAutoApplyBilibiliCandidate(track, { ...candidate, text: 'plain' }),
    ).toBe(false);
  });

  it('scores title/artist/duration deterministically and penalizes version drift', () => {
    expect(scoreBilibiliCandidate(track, candidate)).toBeGreaterThanOrEqual(
      0.93,
    );
    expect(
      scoreBilibiliCandidate(track, { ...candidate, title: 'Song Title live' }),
    ).toBeLessThan(0.93);
  });

  it('scores before bounded lyric fetches and reports search/lyric partial failures', async () => {
    jest.resetModules();
    const mockSearch = jest.fn((source: string) => {
      if (source === 'qq') return Promise.reject(new Error('down'));
      return Promise.resolve({
        results: [
          {
            kind: 'track',
            track: {
              id: 'netrack_9',
              source: 'netease',
              title: 'Unrelated',
              artist: 'Other',
              durationMs: 180000,
            },
          },
          {
            kind: 'track',
            track: {
              id: 'netrack_1',
              source: 'netease',
              title: 'Song Title',
              artist: 'Artist',
              durationMs: 180000,
            },
          },
          {
            kind: 'track',
            track: {
              id: 'netrack_2',
              source: 'netease',
              title: 'Song Title',
              artist: 'Artist',
              durationMs: 180000,
            },
          },
        ],
      });
    });
    const mockNetEaseLyric = jest
      .fn()
      .mockResolvedValueOnce({ text: '[00:01.00]good' })
      .mockRejectedValueOnce(new Error('one lyric failed'));
    jest.doMock('../../api/providers', () => ({
      providerFor: (source: string) => ({ search: () => mockSearch(source) }),
      getNetEaseLyric: (...args: unknown[]) => mockNetEaseLyric(...args),
      getQqLyric: jest.fn(),
    }));
    const { findBilibiliLyricCandidates } = require('../lyrics');
    const result = await findBilibiliLyricCandidates(track);
    expect(mockNetEaseLyric).toHaveBeenCalledWith('netrack_1', undefined);
    expect(mockNetEaseLyric).not.toHaveBeenCalledWith('netrack_9', undefined);
    expect(result.candidates).toHaveLength(1);
    expect(result.partial).toBe(true);
    expect(result.providerErrors).toEqual(
      expect.arrayContaining([
        { provider: 'qq', stage: 'search' },
        { provider: 'netease', stage: 'lyric' },
      ]),
    );
  });
});
