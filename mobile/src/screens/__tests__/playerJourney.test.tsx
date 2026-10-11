import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Alert } from 'react-native';

const mockDispatch = jest.fn();
let mockPlayerState: any;
const mockRequestDownload = jest.fn();
const mockCacheList = jest.fn();
let mockCacheListener: (snapshot: any) => void;
jest.mock('../../offline/offlineAudio', () => ({
  ...jest.requireActual('../../offline/offlineAudio'),
  offlineAudio: {
    list: () => mockCacheList(),
    requestExplicit: (...args: unknown[]) => mockRequestDownload(...args),
    subscribe: (listener: (snapshot: any) => void) => {
      mockCacheListener = listener;
      return jest.fn();
    },
  },
}));

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: jest.fn(), navigate: jest.fn() }),
}));
jest.mock('react-redux', () => ({
  useDispatch: () => mockDispatch,
  useSelector: (selector: (state: unknown) => unknown) =>
    selector({ player: mockPlayerState, library: { favorites: [] } }),
}));
jest.mock('../../api/client', () => ({
  providerClient: { getLyric: jest.fn() },
}));
jest.mock('../../bilibili/lyrics', () => ({
  findBilibiliLyricCandidates: jest.fn(),
}));
jest.mock('../../bilibili/mvClient', () => ({
  bilibiliMvClient: { syncActive: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('../../lyrics/selectionStore', () => ({
  lyricSelectionStore: { get: jest.fn().mockResolvedValue(null) },
}));
jest.mock('../../lyrics/cache', () => ({
  bilibiliLyricCache: { get: jest.fn(), put: jest.fn(), clear: jest.fn() },
}));
jest.mock('../../deepseek/client', () => ({
  deepSeekClient: { cancel: jest.fn(), translate: jest.fn() },
  hashLyric: () => 'a'.repeat(64),
  hashTrack: () => 'b'.repeat(64),
}));
jest.mock('../../store/playerSlice', () => ({
  clearPlayNextQueue: () => ({ type: 'player/clearPlayNextQueue' }),
  movePlayNextTrack: (occurrenceId: string, direction: number) => ({
    type: 'player/moveQueuedNext',
    payload: { occurrenceId, direction },
  }),
  playQueuedTrack: (occurrenceId: string) => ({
    type: 'player/playQueuedTrack',
    payload: occurrenceId,
  }),
  removePlayNextTrack: (occurrenceId: string) => ({
    type: 'player/removeQueuedNext',
    payload: occurrenceId,
  }),
  seekTo: (position: number) => ({
    type: 'player/seekTo',
    payload: position,
  }),
  togglePlayback: () => ({ type: 'player/togglePlayback' }),
}));
jest.mock('../../store/librarySlice', () => ({ toggleFavorite: jest.fn() }));
jest.mock('../../types/music', () => ({ isLocalTrack: () => false }));
jest.mock('../../components/TrackRow', () => ({
  artwork: () => undefined,
  formatDuration: (value: number) => {
    const seconds = value > 1000 ? Math.floor(value / 1000) : Math.floor(value);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(
      2,
      '0',
    )}`;
  },
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
  }: {
    children: React.ReactNode;
    visible: boolean;
  }) => (visible ? <>{children}</> : null),
}));

const { PlayerScreen } = require('../PlayerScreen');

describe('PlayerScreen play-next queue', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCacheList.mockResolvedValue({ entries: [] });
    const track = {
      id: 'ne_1',
      source: 'netease',
      title: '同一首歌',
      artist: 'Listen2',
    };
    mockPlayerState = {
      currentTrack: track,
      isPlaying: false,
      position: 0,
      duration: 120,
      playNextQueue: [
        { ...track, occurrenceId: 'play-next-a', track },
        { ...track, occurrenceId: 'play-next-b', track },
      ],
    };
  });

  it('offers exact-part download and immediately explains missing Bilibili authorization', async () => {
    const selected = {
      id: 'bitrack_v_BV1234567890-123',
      source: 'bilibili',
      title: '分P',
      artist: '作者',
    };
    mockPlayerState.currentTrack = selected;
    const failed = {
      source: selected.source,
      trackId: selected.id,
      status: 'failed',
      errorCode: 'BILIBILI_AUTHORIZATION_REQUIRED',
      downloadedBytes: 0,
      totalBytes: 0,
    };
    mockRequestDownload.mockResolvedValue({ entries: [failed] });
    const alert = jest
      .spyOn(Alert, 'alert')
      .mockImplementation(() => undefined);
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<PlayerScreen />);
    });
    await act(async () => {
      tree.root
        .findByProps({ accessibilityLabel: '离线下载当前分P' })
        .props.onPress();
    });
    expect(mockRequestDownload).toHaveBeenCalledWith(selected);
    expect(alert).toHaveBeenCalledWith(
      '无法离线下载',
      expect.stringContaining('当前不支持匿名离线下载'),
    );
    expect(
      tree.root.findByProps({ accessibilityLabel: '当前分P下载状态' }).props
        .children,
    ).toContain('请先登录 Bilibili');
    await act(async () => {
      mockCacheListener({
        entries: [
          {
            ...failed,
            status: 'transferring',
            downloadedBytes: 12,
            totalBytes: 24,
          },
        ],
      });
    });
    expect(
      tree.root.findByProps({ accessibilityLabel: '当前分P下载状态' }).props
        .children,
    ).toBe('下载进度 50%');
    expect(
      tree.root.findByProps({ accessibilityLabel: '离线下载当前分P' }).props
        .disabled,
    ).toBe(true);
    await act(async () => {
      mockCacheListener({ entries: [{ ...failed, status: 'ready' }] });
    });
    expect(
      tree.root.findByProps({ accessibilityLabel: '当前分P下载状态' }).props
        .children,
    ).toBe('已下载并校验');
    alert.mockRestore();
  });

  it('does not offer an ambiguous Bilibili video download without a part id', async () => {
    mockPlayerState.currentTrack = {
      id: 'bitrack_v_BV1234567890',
      source: 'bilibili',
      title: '视频',
      artist: '作者',
    };
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<PlayerScreen />);
    });
    expect(
      tree.root.findAllByProps({ accessibilityLabel: '离线下载当前分P' }),
    ).toHaveLength(0);
  });

  it('addresses duplicate queue rows through occurrence-specific accessible actions', async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<PlayerScreen />);
    });
    await act(async () => {
      tree.root
        .findByProps({ accessibilityLabel: '打开播放队列，共2首' })
        .props.onPress();
    });

    expect(
      tree.root.findByProps({
        accessibilityLabel: '播放队列第2首，同一首歌，重复第2项',
      }),
    ).toBeTruthy();
    const actionable = (label: string, occurrence: number) =>
      tree.root
        .findAllByProps({ accessibilityLabel: label })
        .filter(item => typeof item.props.onPress === 'function')[occurrence];
    await act(async () => {
      actionable('下移同一首歌', 1).props.onPress();
      actionable('移除同一首歌', 1).props.onPress();
      tree.root
        .findByProps({ accessibilityLabel: '清空待播队列' })
        .props.onPress();
    });
    await act(async () => {
      tree.root
        .findByProps({ accessibilityLabel: '确认清空待播队列' })
        .props.onPress();
    });
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'player/moveQueuedNext',
        payload: { occurrenceId: 'play-next-b', direction: 1 },
      }),
    );
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'player/clearPlayNextQueue',
      }),
    );
  });

  it('exposes a controlled adjustable seek surface with confirmed value and actions', async () => {
    mockPlayerState = {
      ...mockPlayerState,
      position: 30,
      duration: 120,
      playNextQueue: [],
    };
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<PlayerScreen />);
    });

    const slider = tree.root.findByProps({
      accessibilityRole: 'adjustable',
    });
    expect(slider.props.accessibilityValue).toEqual({
      min: 0,
      max: 120,
      now: 30,
      text: '0:30 / 2:00',
    });
    expect(slider.props.accessibilityActions).toEqual(
      expect.arrayContaining([{ name: 'increment' }, { name: 'decrement' }]),
    );

    await act(async () => {
      slider.props.onAccessibilityAction({
        nativeEvent: { actionName: 'increment' },
      });
    });

    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'player/seekTo',
      payload: 45,
    });
  });
});
