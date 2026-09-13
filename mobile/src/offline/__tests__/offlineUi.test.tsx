const mockListeners: Array<(value: unknown) => void> = [];
const mockNativeModule = {
  listDownloads: jest.fn(),
  enqueueDownload: jest.fn(),
  cancelDownload: jest.fn(),
  retryDownload: jest.fn(),
  removeDownload: jest.fn(),
  clearDownloads: jest.fn(),
  invalidate: jest.fn(),
};

const mockReactNative = () => {
  class MockNativeEventEmitter {
    addListener(_event: string, listener: (value: unknown) => void) {
      mockListeners.push(listener);
      return {
        remove: () => {
          const index = mockListeners.indexOf(listener);
          if (index >= 0) mockListeners.splice(index, 1);
        },
      };
    }
  }
  return {
    NativeModules: { Listen2OfflineAudio: mockNativeModule },
    NativeEventEmitter: MockNativeEventEmitter,
  };
};

import type { DownloadSnapshot } from '../offlineAudio';
import type { DownloadEntry } from '../offlineAudio';
import { offlineDownloadErrorCopy } from '../offlineErrorCopy';

let offlineAudio: typeof import('../offlineAudio').offlineAudio;
let isOfflineDownloadEligible: typeof import('../offlineAudio').isOfflineDownloadEligible;
let reducer: typeof import('../../store/downloadSlice').default;
let downloadActions: typeof import('../../store/downloadSlice').downloadActions;

const readySnapshot: DownloadSnapshot = {
  usedBytes: 12,
  quotaBytes: 512 * 1024 * 1024,
  entries: [
    {
      operationId: 'operation',
      source: 'netease',
      trackId: 'netrack_1',
      title: 'title',
      artist: 'artist',
      status: 'ready',
      downloadedBytes: 12,
      totalBytes: 12,
      errorCode: null,
      updatedAt: 1,
    },
  ],
};

describe('offline download adapter and volatile catalog projection', () => {
  const track = (source: string, id: string) =>
    ({ source, id, title: '歌', artist: '艺人' } as any);

  beforeEach(() => {
    jest.resetModules();
    jest.doMock('react-native', mockReactNative);
    ({ offlineAudio, isOfflineDownloadEligible } = require('../offlineAudio'));
    ({
      default: reducer,
      downloadActions,
    } = require('../../store/downloadSlice'));
    jest.clearAllMocks();
    mockListeners.splice(0);
    Object.values(mockNativeModule).forEach(method =>
      (method as jest.Mock).mockResolvedValue(readySnapshot),
    );
  });

  it('allows only explicit semantic NetEase and Kugou tracks', () => {
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
      isOfflineDownloadEligible({
        ...track('local', 'local_1'),
        contentUri: 'content://documents/1',
        fileName: 'a.mp3',
      }),
    ).toBe(false);
  });

  it('uses only semantic track metadata in explicit native actions', async () => {
    await offlineAudio.enqueueDownload(track('netease', 'netrack_1'));
    expect(mockNativeModule.enqueueDownload).toHaveBeenCalledWith({
      source: 'netease',
      trackId: 'netrack_1',
      title: '歌',
      artist: '艺人',
      album: undefined,
      durationMs: undefined,
    });
    await offlineAudio.cancelDownload('operation');
    await offlineAudio.retryDownload('netease', 'netrack_1');
    await offlineAudio.removeDownload('netease', 'netrack_1');
    await offlineAudio.clearDownloads();
    expect(mockNativeModule.cancelDownload).toHaveBeenCalledWith('operation');
    expect(mockNativeModule.retryDownload).toHaveBeenCalledWith(
      'netease',
      'netrack_1',
    );
    expect(mockNativeModule.removeDownload).toHaveBeenCalledWith(
      'netease',
      'netrack_1',
    );
    expect(mockNativeModule.clearDownloads).toHaveBeenCalledTimes(1);
  });

  it('hydrates Redux from native progress events without polling or private fields', () => {
    let state = reducer(undefined, { type: 'init' });
    const unsubscribe = offlineAudio.subscribe(value => {
      state = reducer(state, downloadActions.received(value));
    });
    mockListeners[0]({
      ...readySnapshot,
      entries: [{ ...readySnapshot.entries[0], status: 'downloading' }],
      candidateUrl: 'https://private.example/audio',
      filesystemPath: '/private/cache',
    });
    expect(state.hydrated).toBe(true);
    expect(state.entries as DownloadEntry[]).toEqual([
      expect.objectContaining({ status: 'downloading', trackId: 'netrack_1' }),
    ]);
    expect(state.entries[0]).not.toHaveProperty('candidateUrl');
    expect(state.entries[0]).not.toHaveProperty('filesystemPath');
    unsubscribe();
    expect(mockListeners).toEqual([]);
  });

  it('turns malformed snapshots and native failures into an unchanged safe catalog', async () => {
    mockNativeModule.listDownloads.mockResolvedValueOnce({
      usedBytes: -1,
      entries: [{ source: 'bilibili', trackId: 'bitrack_1' }],
    });
    const invalid = await offlineAudio.listDownloads();
    expect(invalid.entries).toEqual([]);
    const state = reducer(undefined, downloadActions.received(invalid));
    expect(state.entries).toEqual([]);
    mockNativeModule.listDownloads.mockRejectedValueOnce(
      new Error('native-failure'),
    );
    expect(await offlineAudio.listDownloads()).toEqual({
      usedBytes: 0,
      quotaBytes: 512 * 1024 * 1024,
      entries: [],
    });
  });

  it('maps stable download failures to fixed actionable Chinese copy', () => {
    expect(offlineDownloadErrorCopy('QUEUE_FULL')).toBe(
      '下载任务已满，请等待当前任务完成后重试。',
    );
    expect(offlineDownloadErrorCopy('CAPACITY_EXCEEDED')).toBe(
      '离线空间不足，请删除已下载内容后重试。',
    );
    expect(offlineDownloadErrorCopy('FILE_TOO_LARGE')).toBe(
      '文件超过离线下载大小限制，请选择其他音源。',
    );
    expect(offlineDownloadErrorCopy('CANCELLED')).toBe(
      '下载已取消，可随时重新下载。',
    );
    expect(offlineDownloadErrorCopy('NETWORK')).toBe(
      '网络连接不稳定，请检查网络后重试。',
    );
    expect(offlineDownloadErrorCopy('PROVIDER_REJECTED')).toBe(
      '音源暂不可下载，请稍后重试或更换音源。',
    );
    expect(offlineDownloadErrorCopy('CORRUPT')).toBe(
      '离线文件不可用，请移除后重新下载。',
    );
    expect(offlineDownloadErrorCopy('https://private.example')).toBe(
      '下载失败，请重试。',
    );
  });
});
