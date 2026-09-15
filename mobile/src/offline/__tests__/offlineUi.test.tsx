const mockListeners: Array<(value: unknown) => void> = [];
const mockNativeModule = {
  cacheSnapshot: jest.fn(),
  requestExplicitCache: jest.fn(),
  promoteCache: jest.fn(),
  cacheAction: jest.fn(),
  invalidate: jest.fn(),
  setCacheQuota: jest.fn(),
  resolveVerified: jest.fn(),
};

const mockReactNative = () => {
  class MockNativeEventEmitter {
    addListener(_event: string, listener: (value: unknown) => void) {
      mockListeners.push(listener);
      return {
        remove: () => mockListeners.splice(mockListeners.indexOf(listener), 1),
      };
    }
  }
  return {
    NativeModules: { Listen2OfflineAudio: mockNativeModule },
    NativeEventEmitter: MockNativeEventEmitter,
  };
};

import { offlineDownloadErrorCopy } from '../offlineErrorCopy';

let offlineAudio: typeof import('../offlineAudio').offlineAudio;
let isOfflineDownloadEligible: typeof import('../offlineAudio').isOfflineDownloadEligible;

const readySnapshot = {
  usedBytes: 12,
  reservedBytes: 0,
  quotaBytes: 512 * 1024 * 1024,
  entries: [
    {
      operationId: 'operation',
      source: 'netease',
      trackId: 'netrack_1',
      title: 'title',
      artist: 'artist',
      owners: ['explicit'],
      status: 'ready',
      downloadedBytes: 12,
      totalBytes: 12,
      errorCode: null,
      updatedAt: 1,
    },
  ],
};

describe('offline cache adapter and native catalog projection', () => {
  const track = (source: string, id: string) =>
    ({ source, id, title: '歌', artist: '艺人' } as any);

  beforeEach(() => {
    jest.resetModules();
    jest.doMock('react-native', mockReactNative);
    ({ offlineAudio, isOfflineDownloadEligible } = require('../offlineAudio'));
    jest.clearAllMocks();
    mockListeners.splice(0);
    Object.values(mockNativeModule).forEach(method =>
      (method as jest.Mock).mockResolvedValue(readySnapshot),
    );
  });

  it('allows only semantic NetEase and Kugou requests', () => {
    expect(isOfflineDownloadEligible(track('netease', 'netrack_123'))).toBe(
      true,
    );
    expect(isOfflineDownloadEligible(track('kugou', 'kgtrack_abcdefgh'))).toBe(
      true,
    );
    expect(isOfflineDownloadEligible(track('bilibili', 'bitrack_1'))).toBe(
      false,
    );
    expect(isOfflineDownloadEligible(track('qq', 'qqtrack_1'))).toBe(false);
    expect(
      isOfflineDownloadEligible({ ...track('local', 'local_1'), local: true }),
    ).toBe(false);
  });

  it('uses explicit native cache methods with semantic metadata only', async () => {
    await offlineAudio.requestExplicit(track('netease', 'netrack_1'));
    await offlineAudio.promote('netease', 'netrack_1');
    await offlineAudio.action('retry', 'operation');
    await offlineAudio.setQuota(2 * 1024 ** 3);
    expect(mockNativeModule.requestExplicitCache).toHaveBeenCalledWith({
      source: 'netease',
      trackId: 'netrack_1',
      title: '歌',
      artist: '艺人',
    });
    expect(mockNativeModule.promoteCache).toHaveBeenCalledWith(
      'netease',
      'netrack_1',
    );
    expect(mockNativeModule.cacheAction).toHaveBeenCalledWith(
      'retry',
      'operation',
    );
    expect(mockNativeModule.setCacheQuota).toHaveBeenCalledWith(2 * 1024 ** 3);
  });

  it('sanitizes catalog events without exposing transport or filesystem fields', () => {
    const received = jest.fn();
    const unsubscribe = offlineAudio.subscribe(received);
    mockListeners[0]({
      ...readySnapshot,
      candidateUrl: 'https://private.example/audio',
      filesystemPath: '/private/cache',
    });
    expect(received).toHaveBeenCalledWith(
      expect.objectContaining({
        entries: [
          expect.not.objectContaining({
            candidateUrl: expect.anything(),
            filesystemPath: expect.anything(),
          }),
        ],
      }),
    );
    unsubscribe();
    expect(mockListeners).toEqual([]);
  });

  it('turns malformed snapshots and native failures into an empty safe catalog', async () => {
    mockNativeModule.cacheSnapshot.mockResolvedValueOnce({
      usedBytes: -1,
      entries: [{ source: 'bilibili', trackId: 'bitrack_1' }],
    });
    expect((await offlineAudio.list()).entries).toEqual([]);
    mockNativeModule.cacheSnapshot.mockRejectedValueOnce(
      new Error('native-failure'),
    );
    await expect(offlineAudio.list()).rejects.toThrow('native-failure');
  });

  it('maps stable failures to fixed actionable Chinese copy', () => {
    expect(offlineDownloadErrorCopy('QUEUE_FULL')).toBe(
      '下载任务已满，请等待当前任务完成后重试。',
    );
    expect(offlineDownloadErrorCopy('CAPACITY_EXCEEDED')).toBe(
      '离线空间不足，请删除已下载内容后重试。',
    );
    expect(offlineDownloadErrorCopy('https://private.example')).toBe(
      '下载失败，请重试。',
    );
  });
});
