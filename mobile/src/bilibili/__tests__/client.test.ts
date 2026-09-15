const nativeModule = {
  provider: 'bilibili',
  version: 1,
  policyReady: true,
  mediaAuthority: 'com.dazzlingwuming.listen2.media',
  approvedHosts: ['bilivideo.com'],
  status: jest.fn(),
  qrBegin: jest.fn(),
  qrPoll: jest.fn(),
  qrCancel: jest.fn(),
  logout: jest.fn(),
  videoDetail: jest.fn(),
  resolveAudio: jest.fn(),
  cancelAudio: jest.fn(),
};

let bilibiliClient: typeof import('../client').bilibiliClient;

const deadline = () => (Math.floor(Date.now() / 1000) + 60) * 1000;
const activeState = (status: 'waiting' | 'scanned', attemptId = 'attempt') => ({
  status,
  attemptId,
  expiresAt: deadline(),
  qrPngDataUri: 'data:image/png;base64,AA==',
  retryable: false,
  nextAction: 'poll',
});
const terminalState = (status: string, extra = {}) => ({
  status,
  attemptId: '',
  expiresAt: 0,
  qrPngDataUri: '',
  retryable: status === 'expired' || status === 'error',
  nextAction: status === 'authenticated' ? 'logout' : 'begin',
  ...extra,
});
const mediaReply = (request: { requestId: string; bvid: string; cid: string }, overrides = {}) => {
  return {
    version: 1,
    requestId: request.requestId,
    source: 'bilibili',
    semanticTrackId: `bitrack_v_${request.bvid}-${request.cid}`,
    partId: request.cid,
    generation: 3,
    playableUri: `content://com.dazzlingwuming.listen2.media/lease/${'b'.repeat(48)}`,
    mimeType: 'audio/mp4',
    container: 'mp4',
    codec: 'mp4a.40.2',
    durationMs: 12000,
    selectedRenditionId: 'audio',
    renditions: [{
      id: 'audio', label: 'authorized', mimeType: 'audio/mp4', container: 'mp4', codec: 'mp4a.40.2', durationMs: 12000,
    }],
    parts: [{ cid: request.cid, page: '2', title: '第二段', durationMs: 12000 }],
    entitlementStatus: 'allowed',
    leaseExpiresAt: Date.now() + 60_000,
    ...overrides,
  };
};

describe('strict Bilibili native adapter', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.doMock('react-native', () => ({
      NativeModules: { Listen2Bilibili: nativeModule },
    }));
    ({ bilibiliClient } = require('../client'));
    jest.clearAllMocks();
  });

  it('accepts every QR public lifecycle state and sends only opaque attempt IDs', async () => {
    nativeModule.status.mockResolvedValue(terminalState('idle'));
    nativeModule.qrBegin.mockResolvedValue(activeState('waiting'));
    nativeModule.qrPoll
      .mockResolvedValueOnce(activeState('scanned'))
      .mockResolvedValueOnce(terminalState('expired'));
    nativeModule.qrCancel.mockResolvedValue(terminalState('cancelled'));
    nativeModule.logout.mockResolvedValue(terminalState('idle'));

    await expect(bilibiliClient.status()).resolves.toMatchObject({
      status: 'idle',
    });
    await expect(bilibiliClient.qrBegin()).resolves.toMatchObject({
      status: 'waiting',
    });
    await expect(bilibiliClient.qrPoll('attempt')).resolves.toMatchObject({
      status: 'scanned',
    });
    await expect(bilibiliClient.qrPoll('attempt')).resolves.toMatchObject({
      status: 'expired',
    });
    await expect(bilibiliClient.qrCancel('attempt')).resolves.toMatchObject({
      status: 'cancelled',
    });
    await expect(bilibiliClient.logout()).resolves.toMatchObject({
      status: 'idle',
    });
    expect(nativeModule.qrPoll).toHaveBeenCalledWith({ attemptId: 'attempt' });
    expect(JSON.stringify(nativeModule.qrBegin.mock.calls)).not.toContain(
      'refresh',
    );
  });

  it('rejects credential-shaped and error native replies instead of sending them to JS state', async () => {
    nativeModule.qrBegin.mockResolvedValue({
      ...activeState('waiting'),
      qrcode_key: 'must-not-cross',
    });
    await expect(bilibiliClient.qrBegin()).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
    nativeModule.status.mockResolvedValue(
      terminalState('error', { errorCode: 'LOGIN_REQUIRED' }),
    );
    await expect(bilibiliClient.status()).rejects.toMatchObject({
      code: 'LOGIN_REQUIRED',
    });
  });

  it('sends one exact semantic detail/audio request and validates a native descriptor', async () => {
    nativeModule.videoDetail.mockResolvedValue({
      bvid: 'BV1xx411c7mD',
      title: '视频',
      owner: '作者',
      parts: [{ cid: '11', page: '1', title: '第一段', durationMs: 12_000 }],
    });
    nativeModule.resolveAudio.mockImplementation((request: { requestId: string; bvid: string; cid: string }) => mediaReply(request));
    await expect(
      bilibiliClient.videoDetail('BV1xx411c7mD'),
    ).resolves.toMatchObject({
      parts: [expect.objectContaining({ cid: '11', page: '1' })],
    });
    await expect(
      bilibiliClient.resolveAudio({ bvid: 'BV1xx411c7mD', cid: '12' }),
    ).resolves.toMatchObject({
      semanticTrackId: 'bitrack_v_BV1xx411c7mD-12',
      playableUri: expect.stringMatching(/^content:\/\/com\.dazzlingwuming\.listen2\.media\/lease\/[a-f0-9]{48}$/),
    });
    expect(nativeModule.resolveAudio).toHaveBeenCalledWith(expect.objectContaining({
      version: 1,
      bvid: 'BV1xx411c7mD',
      cid: '12',
      requestId: expect.any(String),
    }));
  });
});
