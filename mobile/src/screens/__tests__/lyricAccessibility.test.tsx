jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: jest.fn() }),
}));
jest.mock('react-redux', () => ({
  useDispatch: () => jest.fn(),
  useSelector: () => ({}),
}));
jest.mock('../../api/client', () => ({ providerClient: {} }));
jest.mock('../../lyrics/cache', () => ({ bilibiliLyricCache: {} }));
jest.mock('../../bilibili/mvClient', () => ({ bilibiliMvClient: {} }));
jest.mock('../../store/playerSlice', () => ({ togglePlayback: jest.fn() }));
jest.mock('../../store/librarySlice', () => ({ toggleFavorite: jest.fn() }));

const {
  lyricFailurePresentation,
  lyricProvenanceLabel,
  lyricRowAccessibilityLabel,
} = require('../PlayerScreen');
const { ProviderClientError } = require('../../api/errors');

describe('lyric accessibility semantics', () => {
  it('names fallback provider truthfully instead of calling it native Bilibili lyrics', () => {
    expect(
      lyricProvenanceLabel(
        {
          trackId: 'bitrack_v_BV1xx411c7mD-12',
          source: 'bilibili',
          text: 'line',
          provenance: {
            mode: 'manual',
            matchedProvider: 'netease',
            matchedCandidateId: 'netrack_1',
            matchScore: 1,
          },
        },
        { id: 'bitrack_v_BV1xx411c7mD-12', source: 'bilibili' } as any,
      ),
    ).toBe('手动选择：网易云音乐歌词');
  });

  it('announces original, translation, active state, offset and provenance only for the active row', () => {
    expect(
      lyricRowAccessibilityLabel(
        { text: 'original', translation: '译文', timestampMs: 1_000 },
        true,
        -500,
        '自动匹配：QQ音乐歌词',
      ),
    ).toContain(
      '当前歌词；原文：original；译文：译文；歌词校正 -500毫秒；来源：自动匹配：QQ音乐歌词',
    );
  });

  it('maps every lyric terminal to safe copy and an actionable recovery', () => {
    const cases = [
      ['CANCELLED', 'cancelled', 'retry'],
      ['REQUEST_TIMEOUT', 'timeout', 'retry'],
      ['INVALID_RESPONSE', 'mismatch', 'choose-source'],
      ['LYRIC_UNAVAILABLE', 'missing', 'choose-source'],
      ['ROUTE_UNAVAILABLE', 'unsupported', 'choose-source'],
      ['PROVIDER_ERROR', 'provider', 'retry'],
    ] as const;

    for (const [errorCode, code, action] of cases) {
      expect(
        lyricFailurePresentation(
          new ProviderClientError(errorCode, 'bilibili', 'lyric'),
        ),
      ).toMatchObject({ code, action });
    }
    expect(
      lyricFailurePresentation(new Error('secret provider reply')).message,
    ).not.toContain('secret provider reply');
  });
});
