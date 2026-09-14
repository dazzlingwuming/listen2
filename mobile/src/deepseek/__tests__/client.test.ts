describe('deepSeekClient', () => {
  const native = {
    status: jest.fn(),
    configure: jest.fn(),
    test: jest.fn(),
    delete: jest.fn(),
    translate: jest.fn(),
    cancel: jest.fn(),
  };

  beforeEach(() => {
    jest.resetModules();
    Object.values(native).forEach(mock => mock.mockReset());
    jest.doMock('react-native', () => ({
      NativeModules: { Listen2DeepSeek: native },
    }));
  });

  it('uses exact native operations and never accepts an API key or transport input', async () => {
    native.status.mockResolvedValue({
      secureStorageAvailable: true,
      hasApiKey: true,
    });
    native.configure.mockResolvedValue({
      status: 'configured',
      secureStorageAvailable: true,
      hasApiKey: true,
    });
    const { deepSeekClient } = require('../client');
    await expect(deepSeekClient.status()).resolves.toEqual({
      secureStorageAvailable: true,
      hasApiKey: true,
    });
    await expect(deepSeekClient.configure()).resolves.toMatchObject({
      status: 'configured',
    });
    expect(native.configure).toHaveBeenCalledWith();
    await expect(
      deepSeekClient.translate({ apiKey: 'forbidden' }),
    ).rejects.toThrow('INVALID_REQUEST');
    await expect(
      deepSeekClient.translate({ url: 'https://forbidden.test' }),
    ).rejects.toThrow('INVALID_REQUEST');
  });

  it('requires exact identity and complete consent before a translation call', async () => {
    const { deepSeekClient, hashLyric, hashTrack } = require('../client');
    const lyric = '[00:01.00]one';
    const lyricHash = hashLyric(lyric);
    const trackHash = hashTrack('netease', 'netrack_1', lyricHash);
    native.translate.mockResolvedValue({
      status: 'ok',
      translation: '[00:01.00]一',
      lyricHash,
      trackHash,
      cacheHit: false,
    });
    const request = {
      operationId: 'operation-1',
      provider: 'netease',
      sourceTrackId: 'netrack_1',
      lyric,
      title: 'Song',
      artist: 'Artist',
      style: '',
      lyricHash,
      trackHash,
      target: 'zh-CN',
      consent: {
        lyrics: true,
        title: true,
        artist: true,
        possibleCost: true,
        cancellation: true,
        failureImpact: true,
        acceptedAtEpochMs: 1700000000000,
      },
      allowNetwork: true,
      forceRefresh: false,
    };
    await expect(deepSeekClient.translate(request)).resolves.toMatchObject({
      status: 'ok',
      trackHash,
    });
    expect(native.translate).toHaveBeenCalledWith(request);
    await expect(
      deepSeekClient.translate({
        ...request,
        trackHash: hashTrack('qq', 'qqtrack_1', lyricHash),
      }),
    ).rejects.toThrow('STALE_IDENTITY');
    await expect(
      deepSeekClient.translate({
        ...request,
        consent: { ...request.consent, lyrics: false },
      }),
    ).rejects.toThrow('CONSENT_REQUIRED');
  });
});
