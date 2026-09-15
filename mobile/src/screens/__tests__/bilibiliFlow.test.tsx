import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { BilibiliDetailScreen } from '../BilibiliDetailScreen';
import { SearchScreen } from '../SearchScreen';
import reducer, { type PlayerState } from '../../store/playerSlice';
import {
  configurePlayerController,
  playerController,
} from '../../player/playerController';

const mockNavigate = jest.fn();
const mockDetail = jest.fn();
const mockDispatch = jest.fn();
const mockSearch = jest.fn();
const mockResolveMedia = jest.fn();
const SAFE_MEDIA_URI = 'content://com.dazzlingwuming.listen2.media/lease/' + 'a'.repeat(48);
const nativeMediaFixture = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const result = { ...(value as Record<string, unknown>) };
  const playableUri =
    typeof result.playableUri === 'string' ? result.playableUri : SAFE_MEDIA_URI;
  delete result.url;
  delete result.headers;
  return { ...result, playableUri };
};
const mockResolveVerified = jest.fn();
const mockNativePlayer = {
  setupPlayer: jest.fn(),
  updateOptions: jest.fn(),
  setRepeatMode: jest.fn(),
  setVolume: jest.fn(),
  reset: jest.fn(),
  add: jest.fn(),
  seekTo: jest.fn(),
  play: jest.fn(),
  pause: jest.fn(),
};
let mockRoute: any = { params: { bvid: 'BV1xx411c7mD', title: '搜索结果' } };
let mockPlayerState!: PlayerState;

const integrationDispatch = (action: unknown): unknown => {
  if (typeof action === 'function')
    return (action as (dispatch: typeof integrationDispatch) => unknown)(
      integrationDispatch,
    );
  mockPlayerState = reducer(mockPlayerState, action as any);
  return action;
};

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
jest.mock('react-native-track-player', () => ({
  __esModule: true,
  default: {
    setupPlayer: (...args: unknown[]) => mockNativePlayer.setupPlayer(...args),
    updateOptions: (...args: unknown[]) =>
      mockNativePlayer.updateOptions(...args),
    setRepeatMode: (...args: unknown[]) =>
      mockNativePlayer.setRepeatMode(...args),
    setVolume: (...args: unknown[]) => mockNativePlayer.setVolume(...args),
    reset: (...args: unknown[]) => mockNativePlayer.reset(...args),
    add: (...args: unknown[]) => mockNativePlayer.add(...args),
    seekTo: (...args: unknown[]) => mockNativePlayer.seekTo(...args),
    play: (...args: unknown[]) => mockNativePlayer.play(...args),
    pause: (...args: unknown[]) => mockNativePlayer.pause(...args),
  },
  Capability: {
    Play: 'play',
    Pause: 'pause',
    Stop: 'stop',
    SkipToNext: 'next',
    SkipToPrevious: 'previous',
    SeekTo: 'seek',
  },
  RepeatMode: { Track: 'track', Off: 'off' },
  State: { Playing: 'playing' },
}));
jest.mock('../../api/client', () => ({
  PROVIDER_CAPABILITIES: {
    bilibili: { search: true, playlistSearch: false, playback: true },
  },
  providerClient: {
    search: (...args: unknown[]) => mockSearch(...args),
    resolveMedia: (...args: unknown[]) => Promise.resolve(mockResolveMedia(...args)).then(nativeMediaFixture),
  },
}));
jest.mock('../../offline/offlineAudio', () => ({
  isOfflineDownloadEligible: () => false,
  offlineAudio: {
    resolveVerified: (...args: unknown[]) => mockResolveVerified(...args),
  },
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
    mockNativePlayer.setupPlayer.mockResolvedValue(undefined);
    mockNativePlayer.updateOptions.mockResolvedValue(undefined);
    mockNativePlayer.setRepeatMode.mockResolvedValue(undefined);
    mockNativePlayer.setVolume.mockResolvedValue(undefined);
    mockNativePlayer.reset.mockResolvedValue(undefined);
    mockNativePlayer.add.mockResolvedValue(undefined);
    mockNativePlayer.seekTo.mockResolvedValue(undefined);
    mockNativePlayer.play.mockResolvedValue(undefined);
    mockNativePlayer.pause.mockResolvedValue(undefined);
    mockResolveVerified.mockResolvedValue({ status: 'miss' });
    mockResolveMedia.mockReset();
    mockDispatch.mockImplementation((action: unknown) =>
      integrationDispatch(action),
    );
    mockPlayerState = reducer(undefined, { type: 'test/init' });
    playerController.resetForTests();
    configurePlayerController({
      dispatch: integrationDispatch,
      getPlayerState: () => mockPlayerState,
    });
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
    mockResolveMedia.mockResolvedValueOnce({
      trackId: 'bitrack_v_BV1xx411c7mD-13',
      source: 'bilibili',
      url: SAFE_MEDIA_URI,
      headers: { Referer: SAFE_MEDIA_URI },
    });
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<BilibiliDetailScreen />);
    });
    await act(async () => {
      await tree.root
        .findByProps({ accessibilityLabel: '播放第二段' })
        .props.onPress();
    });
    expect(mockDispatch).toHaveBeenCalledWith(expect.any(Function));
    expect(mockResolveMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'bitrack_v_BV1xx411c7mD-13',
        source: 'bilibili',
      }),
      expect.any(AbortSignal),
    );
    expect(mockNativePlayer.add).toHaveBeenCalledWith(
      expect.objectContaining({
        url: SAFE_MEDIA_URI,
        title: '视频 · 第二段',
        artist: '作者',
      }),
    );
    expect(mockNativePlayer.play).toHaveBeenCalledTimes(1);
    expect(mockPlayerState.currentTrack).toEqual(
      expect.objectContaining({ id: 'bitrack_v_BV1xx411c7mD-13' }),
    );
    expect(mockNavigate).toHaveBeenCalledWith('Player');
  });

  it('lets a fast second part press abort the first detail thunk before RNTP changes', async () => {
    mockDetail.mockResolvedValue({
      bvid: 'BV1xx411c7mD',
      title: '视频',
      owner: '作者',
      parts: [
        { cid: '12', page: '1', title: '第一段' },
        { cid: '13', page: '2', title: '第二段' },
      ],
    });
    mockResolveMedia
      .mockImplementationOnce(
        (_track: unknown, signal?: AbortSignal) =>
          new Promise<never>((_resolve, reject) => {
            signal?.addEventListener(
              'abort',
              () => reject({ code: 'CANCELLED' }),
              { once: true },
            );
          }),
      )
      .mockResolvedValueOnce({
        trackId: 'bitrack_v_BV1xx411c7mD-13',
        source: 'bilibili',
        url: SAFE_MEDIA_URI,
        headers: { Referer: SAFE_MEDIA_URI },
      });
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<BilibiliDetailScreen />);
    });

    const first = tree.root
      .findByProps({ accessibilityLabel: '播放第一段' })
      .props.onPress();
    for (
      let turn = 0;
      turn < 10 && mockResolveMedia.mock.calls.length === 0;
      turn += 1
    )
      await Promise.resolve();
    const firstSignal = mockResolveMedia.mock.calls[0][1] as AbortSignal;
    const second = tree.root
      .findByProps({ accessibilityLabel: '播放第二段' })
      .props.onPress();
    await act(async () => {
      await Promise.all([first, second]);
    });

    expect(firstSignal.aborted).toBe(true);
    expect(mockNativePlayer.reset).toHaveBeenCalledTimes(1);
    expect(mockNativePlayer.add).toHaveBeenCalledTimes(1);
    expect(mockNativePlayer.add).toHaveBeenLastCalledWith(
      expect.objectContaining({
        id: expect.stringContaining('bitrack_v_BV1xx411c7mD-13'),
      }),
    );
    expect(mockPlayerState.currentTrack).toEqual(
      expect.objectContaining({ id: 'bitrack_v_BV1xx411c7mD-13' }),
    );
  });

  it('keeps the detail screen in place when the exact part bootstrap fails', async () => {
    mockDetail.mockResolvedValue({
      bvid: 'BV1xx411c7mD',
      title: '视频',
      owner: '作者',
      parts: [
        { cid: '12', page: '1', title: '第一段' },
        { cid: '13', page: '2', title: '第二段' },
      ],
    });
    mockResolveMedia.mockRejectedValueOnce({ code: 'LOGIN_REQUIRED' });
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<BilibiliDetailScreen />);
    });
    await act(async () => {
      await tree.root
        .findByProps({ accessibilityLabel: '播放第二段' })
        .props.onPress();
    });
    expect(mockResolveMedia).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'bitrack_v_BV1xx411c7mD-13' }),
      expect.any(AbortSignal),
    );
    expect(mockNativePlayer.add).not.toHaveBeenCalled();
    expect(mockPlayerState.currentTrack).toBeNull();
    expect(mockNavigate).not.toHaveBeenCalledWith('Player');
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
    expect(mockResolveMedia).not.toHaveBeenCalled();
  });
});
