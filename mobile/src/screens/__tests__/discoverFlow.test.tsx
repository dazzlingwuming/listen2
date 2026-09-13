import React from 'react';
import renderer, { act } from 'react-test-renderer';

import { DiscoverScreen } from '../DiscoverScreen';
import { PlaylistDetailScreen } from '../PlaylistDetailScreen';
import { providerClient } from '../../api/client';
import * as playerActions from '../../store/playerSlice';

const mockNavigate = jest.fn();
const mockDispatch = jest.fn();
let mockRoute: { params?: Record<string, unknown> } = {};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
  useRoute: () => mockRoute,
}));

jest.mock('../../api/client', () => ({
  PROVIDER_CAPABILITIES: { netease: { playback: true } },
  providerClient: { getDiscover: jest.fn(), getPlaylist: jest.fn() },
}));

jest.mock('react-redux', () => ({
  useDispatch: () => mockDispatch,
  useSelector: (selector: (state: unknown) => unknown) =>
    selector({
      library: {
        favorites: [],
        recentTracks: [],
        playlists: [],
        localTracks: [],
      },
    }),
}));

jest.mock('../../store/playerSlice', () => ({ playTracks: jest.fn() }));
jest.mock('../../store/librarySlice', () => ({
  addTrackToPlaylist: jest.fn(),
  deletePlaylist: jest.fn(),
  removeLocalTrack: jest.fn(),
  removeTrackFromPlaylist: jest.fn(),
  toggleFavorite: jest.fn(),
}));
jest.mock('../../components/SourceTabs', () => ({
  providerLabels: { netease: '网易云音乐' },
}));
jest.mock('../../components/TrackRow', () => ({ TrackRow: () => null }));
jest.mock('../ScreenLayout', () => ({
  ScreenLayout: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  sectionStyles: {
    button: {},
    buttonText: {},
    card: {},
  },
}));
jest.mock('../../components/Sheet', () => ({
  Sheet: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
jest.mock('../../localAudio/access', () => ({
  releaseLocalAudioAccess: jest.fn(),
}));

describe('Discover flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRoute = {};
  });

  it('loads NetEase featured collections and opens semantic detail', async () => {
    (providerClient.getDiscover as jest.Mock).mockResolvedValue({
      source: 'netease',
      sections: [
        {
          kind: 'featured',
          status: 'ready',
          items: [
            {
              id: 'neplaylist_1',
              source: 'netease',
              title: '真实歌单',
              author: 'Listen2',
              trackCount: 1,
            },
          ],
        },
        { kind: 'charts', status: 'unavailable', reason: 'unverified-route' },
      ],
    });

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<DiscoverScreen />);
    });

    expect(providerClient.getDiscover).toHaveBeenCalledWith(
      'netease',
      expect.objectContaining({ signal: expect.any(Object) }),
    );
    const card = tree.root.findByProps({
      accessibilityLabel: '网易云音乐 歌单：真实歌单',
    });
    act(() => card.props.onPress());
    expect(mockNavigate).toHaveBeenCalledWith('PlaylistDetail', {
      sourceId: 'netease',
      title: '真实歌单',
      remotePlaylistId: 'neplaylist_1',
    });
  });

  it('switches to the closed Kugou featured state without exposing a transport value', async () => {
    (providerClient.getDiscover as jest.Mock)
      .mockResolvedValueOnce({
        source: 'netease',
        sections: [
          { kind: 'featured', status: 'ready', items: [] },
          { kind: 'charts', status: 'ready', items: [] },
        ],
      })
      .mockResolvedValueOnce({
        source: 'kugou',
        sections: [
          {
            kind: 'featured',
            status: 'unavailable',
            reason: 'unverified-route',
          },
          { kind: 'charts', status: 'ready', items: [] },
        ],
      });
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<DiscoverScreen />);
    });
    await act(async () => {
      tree.root
        .findByProps({ accessibilityLabel: '切换至酷狗音乐' })
        .props.onPress();
    });
    expect(providerClient.getDiscover).toHaveBeenLastCalledWith(
      'kugou',
      expect.objectContaining({ signal: expect.any(Object) }),
    );
    expect(
      tree.root.findByProps({ children: '该内容暂未提供经过验证的公开来源。' }),
    ).toBeTruthy();
  });

  it('retains cards during refresh, aborts stale requests, and ignores stale success', async () => {
    const refresh = deferred<any>();
    const stale = deferred<any>();
    const kugou = deferred<any>();
    let staleSignal: AbortSignal | undefined;
    (providerClient.getDiscover as jest.Mock)
      .mockResolvedValueOnce({
        source: 'netease',
        sections: [
          {
            kind: 'featured',
            status: 'ready',
            items: [{ id: 'neplaylist_1', source: 'netease', title: '旧歌单' }],
          },
          { kind: 'charts', status: 'ready', items: [] },
        ],
      })
      .mockReturnValueOnce(refresh.promise)
      .mockImplementationOnce((_source, options) => {
        expect(options.signal).toBeInstanceOf(AbortSignal);
        staleSignal = options.signal;
        return stale.promise;
      })
      .mockReturnValueOnce(kugou.promise);
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<DiscoverScreen />);
    });
    await act(async () => {
      tree.root
        .findByProps({ accessibilityLabel: '刷新网易云音乐发现内容' })
        .props.onPress();
    });
    expect(tree.root.findByProps({ children: '旧歌单' })).toBeTruthy();
    await act(async () => {
      refresh.resolve({
        source: 'netease',
        sections: [
          { kind: 'featured', status: 'ready', items: [] },
          { kind: 'charts', status: 'ready', items: [] },
        ],
      });
      await refresh.promise;
    });
    expect(() => tree.root.findByProps({ children: '旧歌单' })).toThrow();

    await act(async () => {
      tree.root
        .findByProps({ accessibilityLabel: '刷新网易云音乐发现内容' })
        .props.onPress();
      tree.root
        .findByProps({ accessibilityLabel: '切换至酷狗音乐' })
        .props.onPress();
    });
    expect(staleSignal?.aborted).toBe(true);
    await act(async () => {
      stale.resolve({
        source: 'netease',
        sections: [
          {
            kind: 'featured',
            status: 'ready',
            items: [
              {
                id: 'neplaylist_2',
                source: 'netease',
                title: '过期成功不得显示',
              },
            ],
          },
          { kind: 'charts', status: 'ready', items: [] },
        ],
      });
      await stale.promise;
      kugou.resolve({
        source: 'kugou',
        sections: [
          {
            kind: 'featured',
            status: 'unavailable',
            reason: 'unverified-route',
          },
          { kind: 'charts', status: 'ready', items: [] },
        ],
      });
      await kugou.promise;
    });
    expect(
      tree.root.findByProps({ children: '该内容暂未提供经过验证的公开来源。' }),
    ).toBeTruthy();
    expect(() =>
      tree.root.findByProps({ children: '过期成功不得显示' }),
    ).toThrow();
  });

  it('opens Player only when play-all dispatch confirms native playback', async () => {
    mockRoute = {
      params: {
        sourceId: 'netease',
        title: '可播放歌单',
        tracks: [
          {
            id: 'netrack_1',
            source: 'netease',
            title: 'Song',
            artist: 'Artist',
          },
        ],
      },
    };
    (playerActions.playTracks as jest.Mock).mockReturnValue('play-all-action');
    mockDispatch.mockResolvedValue(true);
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<PlaylistDetailScreen />);
    });

    await act(async () => {
      tree.root
        .findByProps({ accessibilityLabel: '可播放歌单播放全部歌曲' })
        .props.onPress();
      await Promise.resolve();
    });
    expect(mockDispatch).toHaveBeenCalledWith('play-all-action');
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith('Player');
  });

  it.each([
    ['returns false', () => Promise.resolve(false)],
    ['rejects', () => Promise.reject(new Error('native transition failed'))],
  ])('never opens Player when play-all %s', async (_case, createOutcome) => {
    mockRoute = {
      params: {
        sourceId: 'netease',
        title: '不可确认歌单',
        tracks: [
          {
            id: 'netrack_1',
            source: 'netease',
            title: 'Song',
            artist: 'Artist',
          },
        ],
      },
    };
    (playerActions.playTracks as jest.Mock).mockReturnValue('play-all-action');
    mockDispatch.mockImplementation(() => createOutcome());
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<PlaylistDetailScreen />);
    });

    await act(async () => {
      tree.root
        .findByProps({ accessibilityLabel: '不可确认歌单播放全部歌曲' })
        .props.onPress();
      await Promise.resolve();
    });
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
