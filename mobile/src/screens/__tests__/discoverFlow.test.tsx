import React from 'react';
import renderer, { act } from 'react-test-renderer';

import { DiscoverScreen } from '../DiscoverScreen';
import { providerClient } from '../../api/client';

const mockNavigate = jest.fn();

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
});
