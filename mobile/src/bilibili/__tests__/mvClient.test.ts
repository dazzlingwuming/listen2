export {};

const nativeModule = {
  mvOpen: jest.fn(),
  mvSelectQuality: jest.fn(),
  mvSync: jest.fn(),
  mvRefresh: jest.fn(),
  mvClose: jest.fn(),
  mvEnterFullscreen: jest.fn(),
  mvExitFullscreen: jest.fn(),
  mvRequestPip: jest.fn(),
  mvConsumePendingRestore: jest.fn(),
};

let client: typeof import('../mvClient').bilibiliMvClient;

const reply = (overrides = {}) => ({
  state: 'ready',
  handle: 'opaque_handle_abcdefghijklmnop',
  bvid: 'BV1xx411c7mD',
  cid: '12',
  qualityId: '80',
  variants: [
    { id: '80', label: '高清', codec: 'avc1', width: 1920, height: 1080 },
  ],
  positionMs: 0,
  playIntent: true,
  refreshing: false,
  ...overrides,
});

describe('strict semantic Bilibili MV adapter', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.doMock('react-native', () => ({
      NativeModules: { Listen2Bilibili: nativeModule },
    }));
    ({ bilibiliMvClient: client } = require('../mvClient'));
    jest.clearAllMocks();
  });

  it('sends only exact semantic identity and returns an opaque safe state', async () => {
    nativeModule.mvOpen.mockResolvedValue(reply());
    await expect(
      client.open({
        bvid: 'BV1xx411c7mD',
        cid: '12',
        qualityId: '80',
        preferredCodecs: ['avc1'],
      }),
    ).resolves.toMatchObject({ handle: 'opaque_handle_abcdefghijklmnop' });
    expect(nativeModule.mvOpen).toHaveBeenCalledWith({
      bvid: 'BV1xx411c7mD',
      cid: '12',
      qualityId: '80',
      preferredCodecs: ['avc1'],
      forceRefresh: false,
    });
    expect(JSON.stringify(nativeModule.mvOpen.mock.calls)).not.toContain(
      'deadline',
    );
  });

  it.each([
    [
      'a signed URL',
      reply({ url: 'https://upos.bilivideo.com/video?deadline=1' }),
    ],
    ['a cookie', reply({ cookie: 'secret' })],
    ['a provider error map', { errorCode: 'LOGIN_REQUIRED' }],
  ])('rejects %s from native MV replies', async (_name, value) => {
    nativeModule.mvOpen.mockResolvedValue(value);
    await expect(
      client.open({ bvid: 'BV1xx411c7mD', cid: '12' }),
    ).rejects.toMatchObject({
      code: (value as { errorCode?: string }).errorCode || 'INVALID_RESPONSE',
    });
  });

  it('does not issue sync after close and rejects malformed opaque handles', async () => {
    nativeModule.mvOpen.mockResolvedValue(reply());
    nativeModule.mvClose.mockResolvedValue(
      reply({
        state: 'closed',
        handle: undefined,
        bvid: undefined,
        cid: undefined,
      }),
    );
    await client.open({ bvid: 'BV1xx411c7mD', cid: '12' });
    await client.close('opaque_handle_abcdefghijklmnop');
    await expect(
      client.syncActive('BV1xx411c7mD', '12', 2000, true),
    ).resolves.toBeNull();
    expect(() => client.refresh('https://not-a-handle')).toThrow(
      'INVALID_RESPONSE',
    );
  });

  it('refreshes the active handle before subsequent active synchronization', async () => {
    nativeModule.mvOpen.mockResolvedValue(reply());
    nativeModule.mvRefresh.mockResolvedValue(
      reply({ handle: 'opaque_handle_refreshed_abcdefg' }),
    );
    nativeModule.mvSync.mockResolvedValue(
      reply({ handle: 'opaque_handle_refreshed_abcdefg' }),
    );
    await client.open({ bvid: 'BV1xx411c7mD', cid: '12' });
    await client.refresh('opaque_handle_abcdefghijklmnop');
    await client.syncActive('BV1xx411c7mD', '12', 1000, true);
    expect(nativeModule.mvSync).toHaveBeenCalledWith(
      expect.objectContaining({ handle: 'opaque_handle_refreshed_abcdefg' }),
    );
  });

  it('treats a full native error state as failure and replaces the active handle after quality switch', async () => {
    nativeModule.mvOpen.mockResolvedValue(
      reply({
        state: 'error',
        errorCode: 'VIDEO_UNAVAILABLE',
        handle: undefined,
        bvid: undefined,
        cid: undefined,
      }),
    );
    await expect(
      client.open({ bvid: 'BV1xx411c7mD', cid: '12' }),
    ).rejects.toMatchObject({ code: 'VIDEO_UNAVAILABLE' });
    nativeModule.mvOpen.mockResolvedValue(reply());
    nativeModule.mvSelectQuality.mockResolvedValue(
      reply({ handle: 'opaque_handle_replaced_abcdefgh', qualityId: '64' }),
    );
    nativeModule.mvSync.mockResolvedValue(
      reply({ handle: 'opaque_handle_replaced_abcdefgh', qualityId: '64' }),
    );
    await client.open({ bvid: 'BV1xx411c7mD', cid: '12' });
    await client.selectQuality('opaque_handle_abcdefghijklmnop', '64');
    await client.syncActive('BV1xx411c7mD', '12', 1000, true);
    expect(nativeModule.mvSync).toHaveBeenCalledWith(
      expect.objectContaining({ handle: 'opaque_handle_replaced_abcdefgh' }),
    );
  });

  it('accepts a one-shot recovery payload without a handle or signed transport', async () => {
    nativeModule.mvConsumePendingRestore.mockResolvedValue({
      bvid: 'BV1xx411c7mD',
      cid: '12',
      qualityId: '80',
      positionMs: 1200,
      playIntent: true,
    });
    await expect(client.consumePendingRestore()).resolves.toEqual({
      bvid: 'BV1xx411c7mD',
      cid: '12',
      qualityId: '80',
      positionMs: 1200,
      playIntent: true,
    });
    expect(nativeModule.mvConsumePendingRestore).toHaveBeenCalledWith();
  });

  it('keeps the current active handle when releasing an older exact handle', async () => {
    const first = 'opaque_handle_abcdefghijklmnop';
    const replacement = 'opaque_handle_replaced_abcdefgh';
    nativeModule.mvOpen.mockResolvedValue(reply({ handle: first }));
    nativeModule.mvSelectQuality.mockResolvedValue(
      reply({ handle: replacement }),
    );
    nativeModule.mvClose.mockResolvedValue(
      reply({
        state: 'closed',
        handle: undefined,
        bvid: undefined,
        cid: undefined,
      }),
    );
    nativeModule.mvSync.mockResolvedValue(reply({ handle: replacement }));
    await client.open({ bvid: 'BV1xx411c7mD', cid: '12' });
    await client.selectQuality(first, '64');
    await client.close(first);
    await client.syncActive('BV1xx411c7mD', '12', 1000, true);
    expect(nativeModule.mvSync).toHaveBeenCalledWith(
      expect.objectContaining({ handle: replacement }),
    );
  });
});
