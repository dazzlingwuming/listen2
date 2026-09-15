import React from 'react';
import renderer, { act } from 'react-test-renderer';

const mockGetLyric = jest.fn();
const mockCacheGet = jest.fn();
const mockCacheClear = jest.fn();
const mockCachePut = jest.fn();
const mockFindCandidates = jest.fn();
const mockDispatch = jest.fn();
const mockSelectionGet = jest.fn();
const mockSelectionPut = jest.fn();
const mockSelectionClearManual = jest.fn();
const mockSelectionSetOffset = jest.fn();
let mockPlayerState: any;

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
  PROVIDER_CAPABILITIES: {
    bilibili: {
      operations: {
        'manual-lyrics': { status: 'available' },
        offset: { status: 'available' },
      },
    },
  },
}));
jest.mock('../../bilibili/lyrics', () => ({
  findBilibiliLyricCandidates: (...args: unknown[]) =>
    mockFindCandidates(...args),
}));
jest.mock('../../lyrics/cache', () => ({
  bilibiliLyricCache: {
    get: (...args: unknown[]) => mockCacheGet(...args),
    put: (...args: unknown[]) => mockCachePut(...args),
    clear: (...args: unknown[]) => mockCacheClear(...args),
  },
}));
jest.mock('../../lyrics/selectionStore', () => ({
  lyricSelectionStore: {
    get: (...args: unknown[]) => mockSelectionGet(...args),
    put: (...args: unknown[]) => mockSelectionPut(...args),
    clearManual: (...args: unknown[]) => mockSelectionClearManual(...args),
    setOffset: (...args: unknown[]) => mockSelectionSetOffset(...args),
  },
}));
jest.mock('../../deepseek/client', () => ({
  deepSeekClient: { cancel: jest.fn(), translate: jest.fn() },
  hashLyric: () => 'a'.repeat(64),
  hashTrack: () => 'b'.repeat(64),
}));
jest.mock('../../store/playerSlice', () => ({ togglePlayback: jest.fn() }));
jest.mock('../../store/librarySlice', () => ({ toggleFavorite: jest.fn() }));
jest.mock('../../types/music', () => ({ isLocalTrack: () => false }));
jest.mock('../../components/TrackRow', () => ({
  artwork: () => undefined,
  formatDuration: () => '0:00',
  trackArtist: (track: any) => track.artist,
  trackSource: (track: any) => track.source,
  trackTitle: (track: any) => track.title,
}));
jest.mock('../../components/SourceTabs', () => ({
  providerLabels: { bilibili: 'Bilibili' },
}));
jest.mock('../../components/Sheet', () => ({
  Sheet: ({
    children,
    visible,
  }: {
    children: React.ReactNode;
    visible: boolean;
  }) => (visible ? <>{children}</> : null),
}));

const { PlayerScreen } = require('../PlayerScreen');

describe('Bilibili lyric player flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPlayerState = {
      currentTrack: {
        id: 'bitrack_v_BV1xx411c7mD-12',
        source: 'bilibili',
        title: 'Song',
        artist: 'Artist',
        durationMs: 120_000,
      },
      position: 0,
    };
    mockCacheGet.mockResolvedValue(null);
    mockCacheClear.mockResolvedValue({ status: 'ok' });
    mockCachePut.mockResolvedValue({ status: 'ok', record: { revision: 1 } });
    mockSelectionGet.mockResolvedValue(null);
    mockSelectionPut.mockResolvedValue({
      status: 'ok',
      record: { revision: 1 },
    });
    mockSelectionClearManual.mockResolvedValue({
      status: 'ok',
      record: { revision: 1 },
    });
    mockSelectionSetOffset.mockResolvedValue({
      status: 'ok',
      record: { revision: 1, offsetMs: 250 },
    });
    mockGetLyric.mockRejectedValue(new Error('LYRIC_UNAVAILABLE'));
    mockFindCandidates.mockResolvedValue({
      candidates: [],
      partial: false,
      providerErrors: [],
    });
  });

  it('keeps playback independent and offers exact-part restore after an auto miss', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<PlayerScreen />);
    });
    await act(async () => {
      tree.root.findByProps({ accessibilityLabel: '查看歌词' }).props.onPress();
      await Promise.resolve();
    });
    expect(mockGetLyric).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'bitrack_v_BV1xx411c7mD-12' }),
      expect.any(Object),
    );
    await act(async () => {
      tree.root
        .findByProps({ accessibilityLabel: '恢复自动歌词' })
        .props.onPress();
      await Promise.resolve();
    });
    expect(mockCacheClear).toHaveBeenCalledWith('bitrack_v_BV1xx411c7mD-12');
  });

  it('retries automatic Bilibili lyrics after a miss with no manual record', async () => {
    mockSelectionClearManual.mockResolvedValueOnce({ status: 'not-found' });
    mockGetLyric
      .mockRejectedValueOnce(new Error('missing lyric'))
      .mockResolvedValueOnce({
        trackId: 'bitrack_v_BV1xx411c7mD-12',
        source: 'bilibili',
        text: '[00:01.00]retried',
        provenance: {
          mode: 'auto',
          matchedProvider: 'netease',
          matchedCandidateId: 'netrack_1',
          matchScore: 1,
        },
      });
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<PlayerScreen />);
    });
    await act(async () => {
      tree.root.findByProps({ accessibilityLabel: '查看歌词' }).props.onPress();
      await Promise.resolve();
    });
    await act(async () => {
      tree.root
        .findByProps({ accessibilityLabel: '恢复自动歌词' })
        .props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockSelectionClearManual).toHaveBeenCalledWith(
      expect.objectContaining({
        trackId: 'bitrack_v_BV1xx411c7mD-12',
        partId: '12',
      }),
      undefined,
    );
    expect(mockCacheClear).toHaveBeenCalledWith('bitrack_v_BV1xx411c7mD-12');
    expect(mockGetLyric).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(tree.toJSON())).toContain('retried');
  });

  it('persists a confirmed local offset for the active exact part', async () => {
    mockGetLyric.mockResolvedValue({
      trackId: 'bitrack_v_BV1xx411c7mD-12',
      source: 'bilibili',
      text: '[00:01.00]line',
      provenance: {
        mode: 'auto',
        matchedProvider: 'qq',
        matchedCandidateId: 'qqtrack_1',
        matchScore: 1,
      },
    });
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<PlayerScreen />);
    });
    await act(async () => {
      tree.root.findByProps({ accessibilityLabel: '查看歌词' }).props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      tree.root
        .findByProps({ accessibilityLabel: '增加歌词校正250毫秒' })
        .props.onPress();
      await Promise.resolve();
    });

    expect(mockSelectionSetOffset).toHaveBeenCalledWith(
      expect.objectContaining({
        trackId: 'bitrack_v_BV1xx411c7mD-12',
        partId: '12',
      }),
      250,
      0,
    );
    expect(JSON.stringify(tree.toJSON())).toContain('已保存 +250毫秒');
  });

  it('drops a late lyric response after the current Bilibili part changes', async () => {
    let resolveLyric!: (value: unknown) => void;
    mockGetLyric.mockImplementation(
      () =>
        new Promise(resolve => {
          resolveLyric = resolve;
        }),
    );
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<PlayerScreen />);
    });
    await act(async () => {
      tree.root.findByProps({ accessibilityLabel: '查看歌词' }).props.onPress();
    });
    mockPlayerState = {
      ...mockPlayerState,
      currentTrack: {
        ...mockPlayerState.currentTrack,
        id: 'bitrack_v_BV1xx411c7mD-13',
      },
    };
    await act(async () => {
      tree.update(<PlayerScreen />);
    });
    await act(async () => {
      resolveLyric({ text: '[00:01.00]old line' });
      await Promise.resolve();
    });
    expect(tree.root.findAllByProps({ children: 'old line' })).toHaveLength(0);
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('keeps only the newest candidate query and renders partial provider status', async () => {
    let resolveFirst!: (value: unknown) => void;
    let resolveSecond!: (value: unknown) => void;
    mockFindCandidates
      .mockImplementationOnce(
        () =>
          new Promise(resolve => {
            resolveFirst = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise(resolve => {
            resolveSecond = resolve;
          }),
      );
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<PlayerScreen />);
    });
    await act(async () => {
      tree.root.findByProps({ accessibilityLabel: '查看歌词' }).props.onPress();
      await Promise.resolve();
    });
    const input = tree.root.findByProps({
      accessibilityLabel: '搜索 Bilibili 歌词候选',
    });
    await act(async () => {
      input.props.onChangeText('first');
    });
    await act(async () => {
      tree.root
        .findByProps({ accessibilityLabel: '搜索歌词候选' })
        .props.onPress();
    });
    await act(async () => {
      input.props.onChangeText('second');
    });
    await act(async () => {
      tree.root
        .findByProps({ accessibilityLabel: '搜索歌词候选' })
        .props.onPress();
    });
    const candidate = (id: string) => ({
      id,
      matchedProvider: 'netease',
      title: id,
      artist: 'Artist',
      text: '[00:01.00]line',
      matchScore: 1,
      hasTranslation: false,
    });
    await act(async () => {
      resolveFirst({
        candidates: [candidate('old')],
        partial: false,
        providerErrors: [],
      });
      await Promise.resolve();
    });
    expect(
      tree.root.findAllByProps({ accessibilityLabel: '选择netease歌词，old' }),
    ).toHaveLength(0);
    await act(async () => {
      resolveSecond({
        candidates: [candidate('new')],
        partial: true,
        providerErrors: [{ provider: 'qq', stage: 'search' }],
      });
      await Promise.resolve();
    });
    expect(
      tree.root.findByProps({ accessibilityLabel: '选择netease歌词，new' }),
    ).toBeTruthy();
    expect(JSON.stringify(tree.toJSON())).toContain('qq搜索');
  });
});
