export {};

const mockStorage = new Map<string, string>();

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn((key: string) => Promise.resolve(mockStorage.get(key) ?? null)),
  setItem: jest.fn((key: string, value: string) => {
    mockStorage.set(key, value);
    return Promise.resolve();
  }),
}));

const key = {
  source: 'bilibili' as const,
  trackId: 'bitrack_v_BV1xx411c7mD-12',
  partId: '12',
};

describe('lyric selection store', () => {
  beforeEach(() => {
    mockStorage.clear();
    jest.resetModules();
  });

  it('persists manual semantic metadata and signed offsets with revision CAS', async () => {
    const { lyricSelectionStore } = require('../selectionStore');
    const saved = await lyricSelectionStore.put(
      {
        key,
        offsetMs: -500,
        manual: { provider: 'netease', candidateId: 'netrack_1' },
      },
      0,
    );
    expect(saved).toMatchObject({ status: 'ok', record: { revision: 1, offsetMs: -500 } });
    await expect(lyricSelectionStore.put({ key, offsetMs: 0 }, 0)).resolves.toMatchObject({ status: 'stale' });
    await expect(lyricSelectionStore.get(key)).resolves.toMatchObject({
      revision: 1,
      manual: { provider: 'netease', candidateId: 'netrack_1' },
      offsetMs: -500,
    });
  });

  it('fails closed for malformed identity and oversized offsets', async () => {
    const { lyricSelectionStore } = require('../selectionStore');
    await expect(
      lyricSelectionStore.put({
        key: { ...key, partId: '13' },
        offsetMs: 999999,
      }),
    ).resolves.toEqual({ status: 'invalid' });
    await expect(lyricSelectionStore.get({ ...key, source: 'netease' })).resolves.toBeNull();
  });
});
