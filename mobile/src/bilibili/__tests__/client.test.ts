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
const audioReply = (overrides = {}) => {
  const value = deadline();
  return {
    bvid: 'BV1xx411c7mD',
    cid: '12',
    page: '2',
    url: `https://upos-sz-mirrorcos.bilivideo.com/audio.m4s?deadline=${
      value / 1000
    }`,
    deadline: value,
    headers: { Referer: 'https://www.bilibili.com/' },
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

  it.each([
    ['expired signed URL', () => audioReply({ deadline: deadline() - 1 })],
    [
      'deadline longer than a day',
      () => {
        const tooLate =
          (Math.floor(Date.now() / 1000) + 24 * 60 * 60 + 1) * 1000;
        return audioReply({
          url: `https://upos-sz-mirrorcos.bilivideo.com/audio.m4s?deadline=${
            tooLate / 1000
          }`,
          deadline: tooLate,
        });
      },
    ],
    [
      'wrong media host',
      () =>
        audioReply({
          url: `https://example.com/audio.m4s?deadline=${deadline() / 1000}`,
        }),
    ],
    [
      'mismatched signed deadline',
      () => audioReply({ deadline: deadline() + 1 }),
    ],
    [
      'duplicate signed deadline',
      () => {
        const value = deadline();
        return audioReply({
          url: `https://upos-sz-mirrorcos.bilivideo.com/audio.m4s?deadline=${
            value / 1000
          }&deadline=${value / 1000}`,
          deadline: value,
        });
      },
    ],
    [
      'unapproved credential header',
      () =>
        audioReply({
          headers: { Referer: 'https://www.bilibili.com/', Cookie: 'secret' },
        }),
    ],
    [
      'unknown handoff key',
      () => ({ ...audioReply(), alternate: 'https://bad.example/' }),
    ],
  ])(
    'rejects hostile audio manifest: %s',
    async (_name, reply: () => unknown) => {
      nativeModule.resolveAudio.mockResolvedValue(reply());
      await expect(
        bilibiliClient.resolveAudio({ bvid: 'BV1xx411c7mD', cid: '12' }),
      ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    },
  );

  it('sends one exact semantic detail/audio request and validates a signed reply', async () => {
    nativeModule.videoDetail.mockResolvedValue({
      bvid: 'BV1xx411c7mD',
      title: '视频',
      owner: '作者',
      parts: [{ cid: '11', page: '1', title: '第一段', durationMs: 12_000 }],
    });
    nativeModule.resolveAudio.mockResolvedValue(audioReply());
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
