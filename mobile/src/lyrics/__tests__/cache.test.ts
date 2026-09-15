export {};

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

  it('recovers the newest valid slot when the head is corrupt or stale', async () => {
    const { bilibiliLyricCache } = require('../cache');
    const lyric = (text: string) => ({
      trackId: 'bitrack_v_BV1xx411c7mD-12',
      source: 'bilibili',
      text,
      provenance: {
        mode: 'manual',
        matchedProvider: 'netease',
        matchedCandidateId: 'netrack_1',
        matchScore: 1,
      },
    });
    await bilibiliLyricCache.put({ lyric: lyric('[00:01.00]first') });
    const first = await bilibiliLyricCache.get('bitrack_v_BV1xx411c7mD-12');
    await bilibiliLyricCache.put(
      { lyric: lyric('[00:01.00]second') },
      first.revision,
    );
    mockStorage.set('listen2:bilibili-lyrics:head', 'broken');
    await expect(
      bilibiliLyricCache.get('bitrack_v_BV1xx411c7mD-12'),
    ).resolves.toMatchObject({ lyric: { text: '[00:01.00]second' } });
    expect(mockStorage.get('listen2:bilibili-lyrics:head')).toBe('0');
    await expect(
      bilibiliLyricCache.put({ lyric: lyric('[00:01.00]stale') }, 0),
    ).resolves.toMatchObject({ status: 'stale' });
  });

  it('adapts a compatible cached Bilibili manual selection without rewriting it', async () => {
    const { bilibiliLyricCache } = require('../cache');
    const { selectionFromBilibiliCache } = require('../selectionStore');
    const lyric = {
      trackId: 'bitrack_v_BV1xx411c7mD-12',
      source: 'bilibili',
      text: '[00:01.00]manual',
      provenance: {
        mode: 'manual',
        matchedProvider: 'qq',
        matchedCandidateId: 'qqtrack_1',
        matchScore: 1,
      },
    };
    const stored = await bilibiliLyricCache.put({ lyric });
    const record = await bilibiliLyricCache.get(lyric.trackId);
    expect(selectionFromBilibiliCache(record)).toMatchObject({
      key: { source: 'bilibili', trackId: lyric.trackId, partId: '12' },
      revision: stored.record.revision,
      manual: { provider: 'qq', candidateId: 'qqtrack_1' },
      offsetMs: 0,
    });
    expect(await bilibiliLyricCache.get(lyric.trackId)).toEqual(record);
  });
});
