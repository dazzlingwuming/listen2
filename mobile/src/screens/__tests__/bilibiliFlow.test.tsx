import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { BilibiliDetailScreen } from '../BilibiliDetailScreen';
import { SearchScreen } from '../SearchScreen';

const mockNavigate = jest.fn();
const mockDetail = jest.fn();
const mockDispatch = jest.fn();
const mockPlayTracks = jest.fn();
const mockSearch = jest.fn();
let mockRoute: any = { params: { bvid: 'BV1xx411c7mD', title: '搜索结果' } };

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, setParams: jest.fn() }),
  useRoute: () => mockRoute,
}));
jest.mock('../../bilibili/client', () => ({
  bilibiliClient: { videoDetail: (...args: unknown[]) => mockDetail(...args) },
}));
jest.mock('react-redux', () => ({
  useDispatch: () => mockDispatch,
  useSelector: () => [],
}));
jest.mock('../../store/playerSlice', () => ({
  playTracks: (...args: any[]) => mockPlayTracks(...args),
}));
jest.mock('../../api/client', () => ({
  PROVIDER_CAPABILITIES: {
    bilibili: { search: true, playlistSearch: false, playback: true },
  },
  providerClient: { search: (...args: unknown[]) => mockSearch(...args) },
}));
jest.mock('../../components/SourceTabs', () => ({
  SourceTabs: () => null,
  providerLabels: { bilibili: 'Bilibili' },
}));
jest.mock('../../components/TrackRow', () => ({
  TrackRow: ({ track, onPress }: any) => {
    const ReactNative = require('react-native');
    const MockReact = require('react');
    return MockReact.createElement(ReactNative.Pressable, {
      accessibilityLabel: `播放搜索结果${track.id}`,
      onPress,
    });
  },
}));
jest.mock('../ScreenLayout', () => ({
  ScreenLayout: ({ children }: any) => <>{children}</>,
  sectionStyles: {
    card: {},
    button: {},
    buttonText: {},
    secondaryButton: {},
    secondaryText: {},
  },
}));

describe('Bilibili exact part flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPlayTracks.mockImplementation(payload => ({
      type: 'player/playTracks',
      payload,
    }));
    mockDispatch.mockResolvedValue(true);
    mockRoute = { params: { bvid: 'BV1xx411c7mD', title: '搜索结果' } };
  });
  it('renders ordered exact parts instead of choosing the first result', async () => {
    mockDetail.mockResolvedValue({
      bvid: 'BV1xx411c7mD',
      title: '视频',
      owner: '作者',
      parts: [
        { cid: '12', page: '1', title: '第一段' },
        { cid: '13', page: '2', title: '第二段' },
      ],
    });
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<BilibiliDetailScreen />);
    });
    expect(mockDetail).toHaveBeenCalledWith(
      'BV1xx411c7mD',
      expect.objectContaining({ signal: expect.any(Object) }),
    );
    expect(
      tree.root.findByProps({ accessibilityLabel: '播放第二段' }),
    ).toBeTruthy();
  });

  it('dispatches the explicitly pressed second part and never falls back to P1', async () => {
    mockDetail.mockResolvedValue({
      bvid: 'BV1xx411c7mD',
      title: '视频',
      owner: '作者',
      parts: [
        { cid: '12', page: '1', title: '第一段' },
        { cid: '13', page: '2', title: '第二段' },
      ],
    });
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<BilibiliDetailScreen />);
    });
    await act(async () => {
      tree.root
        .findByProps({ accessibilityLabel: '播放第二段' })
        .props.onPress();
      await Promise.resolve();
    });
    expect(mockPlayTracks).toHaveBeenCalledWith({
      tracks: [expect.objectContaining({ id: 'bitrack_v_BV1xx411c7mD-13' })],
    });
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'player/playTracks' }),
    );
    expect(mockNavigate).toHaveBeenCalledWith('Player');
  });

  it('opens exact Bilibili detail from search instead of constructing a first-part track', async () => {
    mockRoute = { params: { sourceId: 'bilibili', query: '视频' } };
    mockSearch.mockResolvedValue({
      results: [
        {
          kind: 'track',
          track: {
            id: 'bitrack_v_BV1xx411c7mD',
            source: 'bilibili',
            title: '视频',
            artist: '作者',
          },
        },
      ],
    });
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<SearchScreen />);
      await Promise.resolve();
    });
    await act(async () => {
      tree.root
        .findByProps({
          accessibilityLabel: '播放搜索结果bitrack_v_BV1xx411c7mD',
        })
        .props.onPress();
    });
    expect(mockSearch).toHaveBeenCalledWith(
      'bilibili',
      '视频',
      1,
      expect.objectContaining({ signal: expect.any(Object), kind: 'track' }),
    );
    expect(mockNavigate).toHaveBeenCalledWith('BilibiliDetail', {
      bvid: 'BV1xx411c7mD',
      title: '视频',
      restorationScope: expect.objectContaining({
        source: 'bilibili',
        query: '视频',
        kind: 'track',
      }),
    });
    expect(mockPlayTracks).not.toHaveBeenCalled();
  });
});
