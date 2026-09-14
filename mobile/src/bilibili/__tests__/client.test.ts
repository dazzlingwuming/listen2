const nativeModule = {
  status: jest.fn(),
  qrBegin: jest.fn(),
  qrPoll: jest.fn(),
  qrCancel: jest.fn(),
  logout: jest.fn(),
  videoDetail: jest.fn(),
  resolveAudio: jest.fn(),
};

let bilibiliClient: typeof import('../client').bilibiliClient;

describe('strict Bilibili native adapter', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.doMock('react-native', () => ({
      NativeModules: { Listen2Bilibili: nativeModule },
    }));
    ({ bilibiliClient } = require('../client'));
    jest.clearAllMocks();
  });

  it('uses only an opaque attempt ID and rejects credential-shaped native replies', async () => {
    nativeModule.qrBegin.mockResolvedValue({
      status: 'waiting',
      attemptId: 'attempt-opaque-value',
      expiresAt: Date.now() + 60_000,
      qrPngDataUri: 'data:image/png;base64,AA==',
      retryable: false,
      nextAction: 'poll',
      qrcode_key: 'must-not-cross',
    });
    await expect(bilibiliClient.qrBegin()).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
    expect(nativeModule.qrBegin).toHaveBeenCalledWith();
  });

  it('sends one exact semantic detail/audio request and validates its closed reply', async () => {
    nativeModule.videoDetail.mockResolvedValue({
      bvid: 'BV1xx411c7mD',
      title: '视频',
      owner: '作者',
      parts: [{ cid: '11', page: '1', title: '第一段', durationMs: 12_000 }],
    });
    nativeModule.resolveAudio.mockResolvedValue({
      bvid: 'BV1xx411c7mD',
      cid: '12',
      page: '2',
      url: 'https://upos-sz-mirrorcos.bilivideo.com/audio.m4s',
      deadline: Date.now() + 60_000,
      headers: { Referer: 'https://www.bilibili.com/' },
    });
    await expect(
      bilibiliClient.videoDetail('BV1xx411c7mD'),
    ).resolves.toMatchObject({
      parts: [expect.objectContaining({ cid: '11', page: '1' })],
    });
    await expect(
      bilibiliClient.resolveAudio({ bvid: 'BV1xx411c7mD', cid: '12' }),
    ).resolves.toMatchObject({ cid: '12', page: '2' });
    expect(nativeModule.resolveAudio).toHaveBeenCalledWith({
      bvid: 'BV1xx411c7mD',
      cid: '12',
    });
  });
});
