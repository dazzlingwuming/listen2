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
});
