import React from 'react';
import renderer, { act } from 'react-test-renderer';

import { DiscoverScreen } from '../DiscoverScreen';
import { providerClient } from '../../api/client';

const mockNavigate = jest.fn();

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
}));

jest.mock('../../api/client', () => ({
  providerClient: { getDiscover: jest.fn() },
}));

describe('Discover flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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

  it('retains cards only during refresh and ignores stale success or failure', async () => {
    const refresh = deferred<any>();
    const stale = deferred<any>();
    const kugou = deferred<any>();
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
      .mockReturnValueOnce(stale.promise)
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
    await act(async () => {
      stale.reject(new Error('late provider text must not render'));
      await Promise.resolve();
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
      tree.root.findByProps({ children: 'late provider text must not render' }),
    ).toThrow();
  });
});
