const mockStorage = new Map<string, string>();

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn((key: string) =>
    Promise.resolve(mockStorage.get(key) ?? null),
  ),
  setItem: jest.fn((key: string, value: string) => {
    mockStorage.set(key, value);
    return Promise.resolve();
  }),
}));

describe('Bilibili exact-part lyric cache', () => {
  beforeEach(() => {
    mockStorage.clear();
    jest.resetModules();
  });

  it('does not allow a second part to inherit a cached lyric', async () => {
    const { bilibiliLyricCache } = require('../cache');
    const lyric = {
      trackId: 'bitrack_v_BV1xx411c7mD-12',
      source: 'bilibili',
      text: '[00:01.00]original',
      provenance: {
        mode: 'manual',
        matchedProvider: 'netease',
        matchedCandidateId: 'netrack_1',
        matchScore: 1,
      },
    };
    await expect(bilibiliLyricCache.put({ lyric })).resolves.toMatchObject({
      status: 'ok',
    });
    await expect(bilibiliLyricCache.get(lyric.trackId)).resolves.toMatchObject({
      lyric,
    });
    await expect(
      bilibiliLyricCache.get('bitrack_v_BV1xx411c7mD-13'),
    ).resolves.toBeNull();
  });
});
