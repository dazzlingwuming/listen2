import React from 'react';
import renderer, { act } from 'react-test-renderer';

const mockDispatch = jest.fn();
const mockGetLyric = jest.fn();
const mockTranslate = jest.fn();
const mockCancel = jest.fn().mockResolvedValue({ status: 'cancelled' });
const mockReact = React;
let mockPlayerState: any;

const mockLyricHash = 'a'.repeat(64);
const mockTrackAHash = 'b'.repeat(64);
const mockTrackBHash = 'c'.repeat(64);
const sourceLyrics = {
  text: '[00:01.00] first line',
  translation: '[00:01.00] 来源译文',
};
const trackA = {
  id: 'track-a',
  source: 'netease',
  title: '甲',
  artist: '歌手甲',
};
const trackB = { ...trackA, id: 'track-b', title: '乙' };

jest.mock('../../deepseek/client', () => ({
  deepSeekClient: {
    cancel: (...args: unknown[]) => mockCancel(...args),
    translate: (...args: unknown[]) => mockTranslate(...args),
  },
  hashLyric: () => mockLyricHash,
  hashTrack: (_provider: string, sourceTrackId: string) =>
    sourceTrackId === 'track-a' ? mockTrackAHash : mockTrackBHash,
}));

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: jest.fn() }),
}));
jest.mock('react-redux', () => ({
  useDispatch: () => mockDispatch,
  useSelector: (selector: (state: unknown) => unknown) =>
    selector({ player: mockPlayerState, library: { favorites: [] } }),
}));
jest.mock('../../api/client', () => ({
  providerClient: { getLyric: (...args: unknown[]) => mockGetLyric(...args) },
}));
jest.mock('../../lyrics/cache', () => ({
  bilibiliLyricCache: {
    get: jest.fn().mockResolvedValue(null),
    put: jest.fn().mockResolvedValue({ status: 'ok', record: { revision: 1 } }),
    clear: jest.fn().mockResolvedValue({ status: 'ok' }),
  },
}));
jest.mock('../../lyrics/selectionStore', () => ({
  lyricSelectionStore: {
    get: jest.fn(() => Promise.resolve(null)),
    put: jest.fn(() => Promise.resolve({ status: 'ok', record: { revision: 1 } })),
    clearManual: jest.fn(() => Promise.resolve({ status: 'ok', record: { revision: 1 } })),
  },
}));
jest.mock('../../store/playerSlice', () => ({
  togglePlayback: () => ({ type: 'player/togglePlayback' }),
}));
jest.mock('../../store/librarySlice', () => ({ toggleFavorite: jest.fn() }));
jest.mock('../../components/TrackRow', () => ({
  artwork: () => undefined,
  formatDuration: () => '0:00',
  trackArtist: (track: any) => track.artist,
  trackSource: (track: any) => track.source,
  trackTitle: (track: any) => track.title,
}));
jest.mock('../../components/SourceTabs', () => ({
  providerLabels: { netease: '网易云音乐' },
}));
jest.mock('../../components/Sheet', () => ({
  Sheet: ({
    children,
    visible,
    onClose,
  }: {
    children: React.ReactNode;
    visible: boolean;
    onClose: () => void;
  }) =>
    visible
      ? mockReact.createElement(
          'mock-sheet',
          { onPress: onClose, testID: 'mock-sheet' },
          children,
        )
      : null,
}));
jest.mock('../../types/music', () => ({ isLocalTrack: () => false }));

const { PlayerScreen } = require('../PlayerScreen');

describe('PlayerScreen translation orchestration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPlayerState = { currentTrack: trackA, isPlaying: false, position: 0 };
    mockGetLyric.mockResolvedValue(sourceLyrics);
    mockTranslate.mockResolvedValue({
      status: 'ok',
      translation: '[00:01.00] 机器译文',
      lyricHash: mockLyricHash,
      trackHash: mockTrackAHash,
      cacheHit: true,
    });
  });

  async function openLyrics(tree: renderer.ReactTestRenderer) {
    await act(async () => {
      tree.root.findByProps({ accessibilityLabel: '查看歌词' }).props.onPress();
      await Promise.resolve();
    });
  }

  async function renderPlayer() {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<PlayerScreen />);
    });
    return tree;
  }

  async function flushTranslation() {
    await Promise.resolve();
    await Promise.resolve();
  }

  async function confirmAllDisclosures(tree: renderer.ReactTestRenderer) {
    const disclosures = [
      '将发送当前完整同步歌词',
      '将发送歌曲标题',
      '将发送歌手名称',
      '此请求可能产生 API 费用',
      '切歌或关闭时可取消请求',
      '失败时会保留原歌词，不会伪造译文',
    ];
    await act(async () => {
      disclosures.forEach(label =>
        tree.root.findByProps({ accessibilityLabel: label }).props.onPress(),
      );
    });
    expect(
      tree.root.findByProps({ accessibilityLabel: '确认使用 DeepSeek 翻译' })
        .props.disabled,
    ).toBe(false);
    await act(async () => {
      tree.root
        .findByProps({ accessibilityLabel: '确认使用 DeepSeek 翻译' })
        .props.onPress();
      await Promise.resolve();
    });
  }

  async function closeLyrics(tree: renderer.ReactTestRenderer) {
    await act(async () => {
      tree.root.findAllByProps({ testID: 'mock-sheet' })[0].props.onPress();
    });
  }

  it('does not translate on render, playback, or lyric hydration', async () => {
    const tree = await renderPlayer();
    await act(async () => {
      tree.root.findByProps({ accessibilityLabel: '继续播放' }).props.onPress();
    });
    await openLyrics(tree);
    expect(mockGetLyric).toHaveBeenCalledTimes(1);
    expect(mockTranslate).not.toHaveBeenCalled();
  });

  it('permits cache-only Bilibili translation only for an exact matched lyric', async () => {
    mockPlayerState = {
      currentTrack: {
        id: 'bitrack_v_BV1xx411c7mD-12',
        source: 'bilibili',
        title: '甲',
        artist: '歌手甲',
      },
      position: 0,
    };
    mockGetLyric.mockResolvedValue({
      ...sourceLyrics,
      provenance: {
        mode: 'manual',
        matchedProvider: 'netease',
        matchedCandidateId: 'netrack_1',
        matchScore: 1,
      },
    });
    const tree = await renderPlayer();
    await openLyrics(tree);
    await act(async () => {
      tree.root
        .findByProps({ accessibilityLabel: '翻译当前歌词' })
        .props.onPress();
      await flushTranslation();
    });
    expect(mockTranslate).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'bilibili',
        sourceTrackId: 'bitrack_v_BV1xx411c7mD-12',
        matchedProvider: 'netease',
        matchedCandidateId: 'netrack_1',
        allowNetwork: false,
      }),
    );
  });

  it('uses the cache without consent or network and restores the source translation', async () => {
    const tree = await renderPlayer();
    await openLyrics(tree);
    await act(async () => {
      tree.root
        .findByProps({ accessibilityLabel: '翻译当前歌词' })
        .props.onPress();
      await flushTranslation();
    });
    expect(mockTranslate).toHaveBeenCalledWith(
      expect.objectContaining({ allowNetwork: false, forceRefresh: false }),
    );
    expect(
      tree.root.findAllByProps({
        accessibilityLabel: '确认使用 DeepSeek 翻译',
      }),
    ).toHaveLength(0);
    expect(
      tree.root.findByProps({ accessibilityLabel: '恢复来源译文' }),
    ).toBeTruthy();
    await act(async () => {
      tree.root
        .findByProps({ accessibilityLabel: '恢复来源译文' })
        .props.onPress();
    });
    expect(tree.root.findByProps({ children: '来源译文' })).toBeTruthy();
  });

  it('does not network on a cache miss until all six consent disclosures are accepted', async () => {
    mockTranslate
      .mockImplementationOnce(async () => ({
        status: 'not-cached',
        cacheHit: false,
      }))
      .mockImplementationOnce(async () => ({
        status: 'ok',
        translation: '[00:01.00] 机器译文',
        lyricHash: mockLyricHash,
        trackHash: mockTrackAHash,
        cacheHit: false,
      }));
    const tree = await renderPlayer();
    await openLyrics(tree);
    await act(async () => {
      tree.root
        .findByProps({ accessibilityLabel: '翻译当前歌词' })
        .props.onPress();
      await flushTranslation();
    });
    expect(mockTranslate).toHaveBeenCalledWith(
      expect.objectContaining({ allowNetwork: false, forceRefresh: false }),
    );
    expect(await mockTranslate.mock.results[0].value).toEqual({
      status: 'not-cached',
      cacheHit: false,
    });
    expect(
      tree.root.findByProps({ accessibilityLabel: '确认使用 DeepSeek 翻译' })
        .props.disabled,
    ).toBe(true);
    await confirmAllDisclosures(tree);
    expect(mockTranslate).toHaveBeenLastCalledWith(
      expect.objectContaining({ allowNetwork: true, forceRefresh: false }),
    );
  });

  it('requires consent again before a force refresh', async () => {
    const tree = await renderPlayer();
    await openLyrics(tree);
    await act(async () => {
      tree.root
        .findByProps({ accessibilityLabel: '重新翻译当前歌词' })
        .props.onPress();
    });
    expect(mockTranslate).not.toHaveBeenCalled();
    await confirmAllDisclosures(tree);
    expect(mockTranslate).toHaveBeenCalledWith(
      expect.objectContaining({ allowNetwork: true, forceRefresh: true }),
    );
  });

  it('cancels on a track change and ignores a late result for the previous hash', async () => {
    let resolveTranslation!: (value: unknown) => void;
    mockTranslate.mockImplementation(
      () =>
        new Promise(resolve => {
          resolveTranslation = resolve;
        }),
    );
    const tree = await renderPlayer();
    await openLyrics(tree);
    await act(async () => {
      tree.root
        .findByProps({ accessibilityLabel: '翻译当前歌词' })
        .props.onPress();
    });
    mockPlayerState = { ...mockPlayerState, currentTrack: trackB };
    await act(async () => {
      tree.update(<PlayerScreen />);
    });
    expect(mockCancel).toHaveBeenCalledWith(
      expect.stringMatching(/^deepseek_/),
    );
    await act(async () => {
      resolveTranslation({
        status: 'ok',
        translation: '[00:01.00] 不应显示',
        lyricHash: mockLyricHash,
        trackHash: mockTrackAHash,
        cacheHit: false,
      });
      await Promise.resolve();
    });
    expect(tree.root.findAllByProps({ children: '不应显示' })).toHaveLength(0);
  });

  it('cancels an in-flight translation on unmount', async () => {
    mockTranslate.mockImplementation(() => new Promise(() => undefined));
    const tree = await renderPlayer();
    await openLyrics(tree);
    await act(async () => {
      tree.root
        .findByProps({ accessibilityLabel: '翻译当前歌词' })
        .props.onPress();
    });
    await act(async () => tree.unmount());
    expect(mockCancel).toHaveBeenCalledWith(
      expect.stringMatching(/^deepseek_/),
    );
  });

  it('cancels a cache lookup on lyric close and suppresses its late miss', async () => {
    let resolveLookup!: (value: unknown) => void;
    mockTranslate.mockImplementation(
      () =>
        new Promise(resolve => {
          resolveLookup = resolve;
        }),
    );
    const tree = await renderPlayer();
    await openLyrics(tree);
    await act(async () => {
      tree.root
        .findByProps({ accessibilityLabel: '翻译当前歌词' })
        .props.onPress();
    });
    const operationId = mockTranslate.mock.calls[0][0].operationId;
    await closeLyrics(tree);
    expect(mockCancel).toHaveBeenCalledTimes(1);
    expect(mockCancel).toHaveBeenCalledWith(operationId);
    await act(async () => {
      resolveLookup({ status: 'not-cached', cacheHit: false });
      await flushTranslation();
    });
    expect(
      tree.root.findAllByProps({
        accessibilityLabel: '确认使用 DeepSeek 翻译',
      }),
    ).toHaveLength(0);
    await openLyrics(tree);
    expect(
      tree.root.findAllByProps({ children: '正在处理歌词翻译…' }),
    ).toHaveLength(0);
    expect(tree.root.findByProps({ children: '来源译文' })).toBeTruthy();
  });

  it('cancels an active network translation once on lyric close and reopens cleanly', async () => {
    let settleNetwork!: (value: unknown) => void;
    mockTranslate
      .mockResolvedValueOnce({ status: 'not-cached', cacheHit: false })
      .mockImplementationOnce(
        () =>
          new Promise(resolve => {
            settleNetwork = resolve;
          }),
      );
    const tree = await renderPlayer();
    await openLyrics(tree);
    await act(async () => {
      tree.root
        .findByProps({ accessibilityLabel: '翻译当前歌词' })
        .props.onPress();
      await flushTranslation();
    });
    await confirmAllDisclosures(tree);
    const operationId = mockTranslate.mock.calls[1][0].operationId;
    await closeLyrics(tree);
    expect(mockCancel).toHaveBeenCalledTimes(1);
    expect(mockCancel).toHaveBeenCalledWith(operationId);
    await act(async () => {
      settleNetwork({
        status: 'ok',
        translation: '[00:01.00] 不应显示',
        lyricHash: mockLyricHash,
        trackHash: mockTrackAHash,
        cacheHit: false,
      });
      await flushTranslation();
    });
    expect(tree.root.findAllByProps({ children: '不应显示' })).toHaveLength(0);
    await openLyrics(tree);
    expect(
      tree.root.findAllByProps({ children: '正在处理歌词翻译…' }),
    ).toHaveLength(0);
    expect(tree.root.findByProps({ children: '来源译文' })).toBeTruthy();
  });

  it('does not let a late network error or finally clear a newer translation state', async () => {
    let rejectFirst!: (reason: unknown) => void;
    mockTranslate
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectFirst = reject;
          }),
      )
      .mockResolvedValueOnce({
        status: 'ok',
        translation: '[00:01.00] 新译文',
        lyricHash: mockLyricHash,
        trackHash: mockTrackAHash,
        cacheHit: true,
      });
    const tree = await renderPlayer();
    await openLyrics(tree);
    await act(async () => {
      tree.root
        .findByProps({ accessibilityLabel: '翻译当前歌词' })
        .props.onPress();
    });
    await closeLyrics(tree);
    await openLyrics(tree);
    await act(async () => {
      tree.root
        .findByProps({ accessibilityLabel: '翻译当前歌词' })
        .props.onPress();
      await flushTranslation();
    });
    await act(async () => {
      rejectFirst(new Error('STALE_ERROR'));
      await flushTranslation();
    });
    expect(tree.root.findByProps({ children: '新译文' })).toBeTruthy();
    expect(
      tree.root.findAllByProps({ children: '翻译未应用：STALE_ERROR' }),
    ).toHaveLength(0);
  });
});
