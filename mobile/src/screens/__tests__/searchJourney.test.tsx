import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { ScrollView } from 'react-native';
import type { SearchResult, SourceId } from '../../types';
import {
  createSearchJourneyState,
  createSearchJourneyRestoration,
  reduceSearchJourney,
  restoreSearchJourneyState,
} from '../../search/searchJourneyState';
import { ProviderClientError, presentProviderError } from '../../api/errors';
import { SearchScreen } from '../SearchScreen';
import { TrackRow } from '../../components/TrackRow';

const mockNavigate = jest.fn();
const mockSetParams = jest.fn();
const mockDispatch = jest.fn();
const mockSearch = jest.fn();
let mockRoute: { params?: Record<string, unknown> } = {};

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: mockNavigate,
    setParams: mockSetParams,
    goBack: jest.fn(),
  }),
  useRoute: () => mockRoute,
}));
jest.mock('react-redux', () => ({
  useDispatch: () => mockDispatch,
  useSelector: (selector: (state: unknown) => unknown) =>
    selector({ downloads: { entries: [] } }),
}));
jest.mock('../../api/client', () => ({
  PROVIDER_CAPABILITIES: {
    netease: {
      operations: {
        playback: { status: 'available' },
        detail: { status: 'available' },
      },
    },
    kuwo: {
      operations: {
        playback: {
          status: 'unverified',
          reason: 'unverified-route',
          action: 'return',
        },
      },
    },
    bilibili: {
      operations: {
        playback: { status: 'available' },
        detail: { status: 'available' },
      },
    },
  },
  providerClient: { search: (...args: unknown[]) => mockSearch(...args) },
}));
jest.mock('../../store/playerSlice', () => ({
  playTrack: jest.fn(() => ({ type: 'player/playTrack' })),
  addNextTrack: jest.fn(() => ({ type: 'player/addNextTrack' })),
}));
jest.mock('../ScreenLayout', () => ({
  ScreenLayout: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  sectionStyles: {
    card: {},
    button: {},
    buttonText: {},
    secondaryButton: {},
    secondaryText: {},
  },
}));

const track = (id: string): SearchResult => ({
  kind: 'track',
  track: {
    id,
    source: 'netease',
    title: `歌曲 ${id}`,
    artist: '测试歌手',
  },
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('search journey state', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRoute = {};
    mockDispatch.mockImplementation(() => undefined);
  });

  it('keeps a semantic NetEase scope and exposes exact operation capability', () => {
    const state = createSearchJourneyState({
      source: 'netease',
      query: ' 青花瓷 ',
      kind: 'track',
      requestId: 'request-1',
      generation: 1,
    });
    const ready = reduceSearchJourney(state, {
      type: 'success',
      requestId: 'request-1',
      generation: 1,
      page: 1,
      cursor: '2',
      hasMore: true,
      results: [track('netease_1')],
    });

    expect(ready.scope).toMatchObject({
      source: 'netease',
      query: '青花瓷',
      kind: 'track',
      requestId: 'request-1',
      generation: 1,
    });
    expect(ready.rows).toHaveLength(1);
    expect(ready.rows[0]).toMatchObject({ kind: 'track' });
  });

  it('suppresses duplicate pages and stale generations', () => {
    const state = createSearchJourneyState({
      source: 'netease',
      query: '青花瓷',
      kind: 'track',
      requestId: 'request-2',
      generation: 2,
    });
    const first = reduceSearchJourney(state, {
      type: 'success',
      requestId: 'request-2',
      generation: 2,
      page: 1,
      results: [track('netease_1')],
    });
    const duplicate = reduceSearchJourney(first, {
      type: 'success',
      requestId: 'request-2',
      generation: 2,
      page: 2,
      results: [track('netease_1'), track('netease_2')],
    });
    const stale = reduceSearchJourney(duplicate, {
      type: 'success',
      requestId: 'request-1',
      generation: 1,
      page: 1,
      results: [track('stale')],
    });

    expect(
      duplicate.rows.map(item => item.kind === 'track' && item.track.id),
    ).toEqual(['netease_1', 'netease_2']);
    expect(stale).toBe(duplicate);
  });

  it('retains prior rows and scope after loading-more cancellation', () => {
    const state = createSearchJourneyState({
      source: 'netease',
      query: '青花瓷',
      kind: 'track',
      requestId: 'request-3',
      generation: 3,
    });
    const ready = reduceSearchJourney(state, {
      type: 'success',
      requestId: 'request-3',
      generation: 3,
      page: 1,
      cursor: '2',
      hasMore: true,
      results: [track('netease_1')],
    });
    const cancelled = reduceSearchJourney(ready, {
      type: 'cancelled',
      requestId: 'request-3',
      generation: 3,
      page: 2,
    });

    expect(cancelled.rows).toHaveLength(1);
    expect(cancelled.scope).toMatchObject({
      source: 'netease',
      query: '青花瓷',
    });
    expect(cancelled.terminal).toBe('cancelled-more');
  });

  it('restores semantic rows, selected identity, cursor, and scroll anchor without a request', () => {
    const state = createSearchJourneyState({
      source: 'netease',
      query: '青花瓷',
      kind: 'track',
      requestId: 'request-4',
      generation: 4,
      rows: [track('netease_1')],
      page: 2,
      cursor: '3',
      selectedIdentity: 'track:netease:netease_1',
      scrollAnchor: 96,
    });

    expect(state).toMatchObject({
      page: 2,
      cursor: '3',
      selectedIdentity: 'track:netease:netease_1',
      scrollAnchor: 96,
    });
    expect(state.rows).toHaveLength(1);
  });

  it('projects provider failures to safe, distinct recovery copy', () => {
    const timeout = presentProviderError(
      new ProviderClientError('REQUEST_TIMEOUT', 'bilibili', 'search'),
    );
    const login = presentProviderError(
      new ProviderClientError('LOGIN_REQUIRED', 'bilibili', 'bootstrap'),
    );
    const unavailable = presentProviderError(
      new ProviderClientError('ROUTE_UNAVAILABLE', 'qq', 'detail'),
    );
    const neteaseVerification = presentProviderError(
      new ProviderClientError('ROUTE_UNAVAILABLE', 'netease', 'search', {
        retryable: false,
        action: 'not-available',
      }),
    );
    const bilibiliSecurityPolicy = presentProviderError(
      new ProviderClientError('PROVIDER_ERROR', 'bilibili', 'search', {
        retryable: false,
        action: 'not-available',
      }),
    );

    expect(timeout).toMatchObject({ terminal: 'timeout', action: 'retry' });
    expect(login).toMatchObject({
      terminal: 'login-required',
      action: 'sign-in',
    });
    expect(unavailable).toMatchObject({
      terminal: 'unavailable',
      action: 'choose-another-source',
    });
    expect(neteaseVerification).toMatchObject({
      terminal: 'unavailable',
      title: '网易云要求完成验证',
      action: 'choose-another-source',
    });
    expect(bilibiliSecurityPolicy).toMatchObject({
      terminal: 'provider-error',
      title: '来源安全策略拒绝了请求',
      action: 'choose-another-source',
    });
    expect(JSON.stringify(timeout)).not.toMatch(/cookie|token|https?:\/\//i);
  });

  it.each([
    ['success', 'netease', false],
    ['error', 'netease', true],
    ['success', 'bilibili', false],
    ['error', 'bilibili', true],
  ] as const)(
    'keeps the typed query visible across source selection and a %s %s terminal',
    async (_terminal, source, shouldFail) => {
      const query = '用户输入的关键词';
      mockSearch.mockImplementation(
        (
          requestedSource: SourceId,
          requestedQuery: string,
          page: number,
        ) => {
          if (shouldFail) {
            return Promise.reject(
              new ProviderClientError('REQUEST_TIMEOUT', requestedSource, 'search'),
            );
          }
          return Promise.resolve({
            source: requestedSource,
            query: requestedQuery,
            page,
            kind: 'track',
            total: 1,
            hasMore: false,
            results: [
              {
                kind: 'track',
                track: {
                  id: `${requestedSource}_1`,
                  source: requestedSource,
                  title: `${requestedSource} 结果`,
                  artist: '测试歌手',
                },
              },
            ],
          });
        },
      );

      let tree!: renderer.ReactTestRenderer;
      await act(async () => {
        tree = renderer.create(<SearchScreen />);
        await Promise.resolve();
      });

      const input = () =>
        tree.root.findByProps({ accessibilityLabel: '搜索歌曲、歌手或歌单' });
      await act(async () => {
        input().props.onChangeText(query);
      });

      await act(async () => {
        tree.root
          .findByProps({
            accessibilityHint: `切换到${
              source === 'netease' ? '网易云音乐' : '哔哩哔哩'
            }搜索结果`,
          })
          .props.onPress();
      });
      expect(input().props.value).toBe(query);

      await act(async () => {
        tree.root.findByProps({ accessibilityLabel: '搜索音乐' }).props.onPress();
        await Promise.resolve();
      });

      expect(mockSearch).toHaveBeenLastCalledWith(
        source,
        query,
        1,
        expect.objectContaining({ kind: 'track', signal: expect.any(Object) }),
      );
      expect(input().props.value).toBe(query);
      if (shouldFail) {
        expect(
          tree.root.findByProps({ accessibilityLabel: '重试搜索' }),
        ).toBeTruthy();
      } else {
        expect(
          tree.root.findByProps({ children: `${source} 结果` }),
        ).toBeTruthy();
      }
    },
  );

  it('does not offer a pointless retry for the NetEase verification gate', async () => {
    mockSearch.mockRejectedValue(
      new ProviderClientError('ROUTE_UNAVAILABLE', 'netease', 'search', {
        retryable: false,
        action: 'not-available',
      }),
    );

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<SearchScreen />);
      await Promise.resolve();
    });
    const input = tree.root.findByProps({
      accessibilityLabel: '搜索歌曲、歌手或歌单',
    });
    await act(async () => {
      input.props.onChangeText('青花瓷');
    });
    await act(async () => {
      tree.root.findByProps({ accessibilityLabel: '搜索音乐' }).props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      tree.root.findByProps({ children: '网易云要求完成验证' }),
    ).toBeTruthy();
    expect(
      tree.root.findAllByProps({ accessibilityLabel: '重试搜索' }),
    ).toHaveLength(0);
  });

  it('keeps rows after a later-page error and records a retryable page', () => {
    const ready = reduceSearchJourney(
      createSearchJourneyState({
        source: 'netease',
        query: '青花瓷',
        kind: 'track',
        requestId: 'request-5',
        generation: 5,
      }),
      {
        type: 'success',
        requestId: 'request-5',
        generation: 5,
        page: 1,
        cursor: '2',
        hasMore: true,
        results: [track('netease_1')],
      },
    );
    const failed = reduceSearchJourney(ready, {
      type: 'failed',
      requestId: 'request-5',
      generation: 5,
      page: 2,
    });

    expect(failed.rows).toEqual(ready.rows);
    expect(failed.cursor).toBe('2');
    expect(failed.retryPage).toBe(2);
    expect(failed.terminal).toBe('error-more');
  });

  it('sanitizes a restoration DTO and restores it without a request', () => {
    const state = createSearchJourneyState({
      source: 'netease',
      query: ' 青花瓷 ',
      kind: 'track',
      requestId: 'request-6',
      generation: 6,
      rows: [track('netease_1')],
      page: 2,
      cursor: '3',
      hasMore: true,
      selectedIdentity: 'track:netease:netease_1',
      scrollAnchor: 128,
      terminal: 'ready',
    });
    const dto = createSearchJourneyRestoration(state);
    const restored = restoreSearchJourneyState({
      ...dto,
      rows: [
        ...dto.rows,
        { kind: 'track', track: { id: 'x', source: 'evil' } },
      ],
      scrollAnchor: 10_000_000,
      requestId: 'safe-restore',
    });

    expect(dto).toMatchObject({
      source: 'netease',
      query: '青花瓷',
      page: 2,
      cursor: '3',
      selectedIdentity: 'track:netease:netease_1',
      scrollAnchor: 128,
    });
    expect(restored).toMatchObject({
      page: 2,
      cursor: '3',
      selectedIdentity: 'track:netease:netease_1',
      scrollAnchor: 1_000_000,
    });
    expect(restored?.rows).toHaveLength(1);
  });

  it('renders an inline later-page retry and starts a fresh request scope', async () => {
    mockRoute = { params: { sourceId: 'netease', query: '青花瓷' } };
    mockSearch
      .mockResolvedValueOnce({
        source: 'netease',
        query: '青花瓷',
        page: 1,
        kind: 'track',
        total: 2,
        hasMore: true,
        results: [track('netease_1')],
      })
      .mockRejectedValueOnce(
        new ProviderClientError('REQUEST_TIMEOUT', 'netease', 'search'),
      )
      .mockResolvedValueOnce({
        source: 'netease',
        query: '青花瓷',
        page: 2,
        kind: 'track',
        total: 2,
        hasMore: false,
        results: [track('netease_2')],
      });

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<SearchScreen />);
      await Promise.resolve();
    });
    expect(tree.root.findByProps({ children: '歌曲 netease_1' })).toBeTruthy();
    await act(async () => {
      tree.root
        .findByProps({ accessibilityLabel: '加载更多搜索结果' })
        .props.onPress();
      await Promise.resolve();
    });

    expect(tree.root.findByProps({ children: '歌曲 netease_1' })).toBeTruthy();
    const retry = tree.root.findByProps({
      accessibilityLabel: '重试加载更多搜索结果',
    });
    expect(retry).toBeTruthy();
    await act(async () => {
      retry.props.onPress();
      await Promise.resolve();
    });
    expect(mockSearch).toHaveBeenLastCalledWith(
      'netease',
      '青花瓷',
      2,
      expect.objectContaining({ kind: 'track', signal: expect.any(Object) }),
    );
    expect(tree.root.findByProps({ children: '歌曲 netease_2' })).toBeTruthy();
  });

  it('cancels a later page with a fresh generation and ignores its late success', async () => {
    const nextPage = deferred<any>();
    mockRoute = { params: { sourceId: 'netease', query: '青花瓷' } };
    mockSearch
      .mockResolvedValueOnce({
        source: 'netease',
        query: '青花瓷',
        page: 1,
        kind: 'track',
        total: 2,
        hasMore: true,
        results: [track('netease_1')],
      })
      .mockReturnValueOnce(nextPage.promise);

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<SearchScreen />);
      await Promise.resolve();
    });
    await act(async () => {
      tree.root
        .findByProps({ accessibilityLabel: '加载更多搜索结果' })
        .props.onPress();
    });
    await act(async () => {
      tree.root.findByProps({ accessibilityLabel: '取消搜索' }).props.onPress();
    });
    expect(tree.root.findByProps({ children: '歌曲 netease_1' })).toBeTruthy();
    expect(
      tree.root.findByProps({ accessibilityLabel: '重试加载更多搜索结果' }),
    ).toBeTruthy();

    await act(async () => {
      nextPage.resolve({
        source: 'netease',
        query: '青花瓷',
        page: 2,
        kind: 'track',
        total: 2,
        hasMore: false,
        results: [track('late')],
      });
      await nextPage.promise;
    });
    expect(() => tree.root.findByProps({ children: '歌曲 late' })).toThrow();
    expect(mockSearch).toHaveBeenCalledTimes(2);
  });

  it('restores rows and opens detail with selection/scroll DTO without searching', async () => {
    const restoration = createSearchJourneyRestoration(
      createSearchJourneyState({
        source: 'bilibili',
        query: '视频',
        kind: 'track',
        requestId: 'request-7',
        generation: 7,
        rows: [
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
        page: 2,
        cursor: '3',
        hasMore: true,
        selectedIdentity: 'track:bilibili:bitrack_v_BV1xx411c7mD',
        scrollAnchor: 192,
        terminal: 'ready',
      }),
    );
    mockRoute = { params: { restorationScope: restoration } };

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<SearchScreen />);
      await Promise.resolve();
    });

    expect(mockSearch).not.toHaveBeenCalled();
    await act(async () => {
      tree.root.findByProps({ accessibilityLabel: '播放视频' }).props.onPress();
    });
    expect(mockNavigate).toHaveBeenCalledWith('BilibiliDetail', {
      bvid: 'BV1xx411c7mD',
      title: '视频',
      restorationScope: expect.objectContaining({
        source: 'bilibili',
        query: '视频',
        rows: expect.any(Array),
        page: 2,
        cursor: '3',
        selectedIdentity: 'track:bilibili:bitrack_v_BV1xx411c7mD',
        scrollAnchor: 192,
      }),
    });
  });

  it('persists the restoration DTO on the search route across stack recreation', async () => {
    mockRoute = { params: { sourceId: 'bilibili', query: '视频' } };
    mockSearch.mockResolvedValueOnce({
      source: 'bilibili',
      query: '视频',
      page: 1,
      kind: 'track',
      total: 1,
      nextCursor: 'cursor-2',
      hasMore: true,
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
    const scroll = tree.root.findByType(ScrollView);
    act(() => {
      scroll.props.onScroll({
        nativeEvent: { contentOffset: { y: 192 } },
      });
    });
    await act(async () => {
      tree.root.findByProps({ accessibilityLabel: '播放视频' }).props.onPress();
    });

    expect(mockSetParams).toHaveBeenCalledWith({
      restorationScope: expect.objectContaining({
        source: 'bilibili',
        query: '视频',
        rows: expect.any(Array),
        page: 1,
        cursor: 'cursor-2',
        selectedIdentity: 'track:bilibili:bitrack_v_BV1xx411c7mD',
        scrollAnchor: 192,
      }),
    });
    const persistedRouteParams =
      mockSetParams.mock.calls[mockSetParams.mock.calls.length - 1][0];

    act(() => {
      tree.unmount();
    });
    mockSetParams.mockClear();
    mockRoute = { params: persistedRouteParams };

    await act(async () => {
      tree = renderer.create(<SearchScreen />);
      await Promise.resolve();
    });

    expect(mockSearch).toHaveBeenCalledTimes(1);
    expect(
      tree.root.findByProps({ accessibilityLabel: '播放视频' }),
    ).toBeTruthy();
    await act(async () => {
      tree.root.findByProps({ accessibilityLabel: '播放视频' }).props.onPress();
    });
    expect(mockSetParams).toHaveBeenCalledWith({
      restorationScope: expect.objectContaining({
        rows: expect.any(Array),
        cursor: 'cursor-2',
        selectedIdentity: 'track:bilibili:bitrack_v_BV1xx411c7mD',
        scrollAnchor: 192,
      }),
    });
  });

  it('exposes a normal TrackRow next action and repeats remain separate calls', () => {
    const onAddNext = jest.fn();
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(
        <TrackRow
          onAddNext={onAddNext}
          track={
            (track('netease_1') as Extract<SearchResult, { kind: 'track' }>)
              .track
          }
        />,
      );
    });
    const button = tree.root.findByProps({
      accessibilityLabel: '下一首播放歌曲 netease_1',
    });
    act(() => {
      button.props.onPress({ stopPropagation: jest.fn() });
      button.props.onPress({ stopPropagation: jest.fn() });
    });
    expect(onAddNext).toHaveBeenCalledTimes(2);
  });

  it('dispatches the existing play-next thunk for every verified row action', async () => {
    mockRoute = { params: { sourceId: 'netease', query: '歌曲' } };
    mockSearch.mockResolvedValue({
      source: 'netease',
      query: '歌曲',
      page: 1,
      kind: 'track',
      total: 1,
      hasMore: false,
      results: [track('netease_1')],
    });

    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<SearchScreen />);
      await Promise.resolve();
    });
    const enqueue = tree.root.findByProps({
      accessibilityLabel: '下一首播放歌曲 netease_1',
    });
    await act(async () => {
      enqueue.props.onPress({ stopPropagation: jest.fn() });
      enqueue.props.onPress({ stopPropagation: jest.fn() });
    });

    expect(mockDispatch).toHaveBeenNthCalledWith(1, {
      type: 'player/addNextTrack',
    });
    expect(mockDispatch).toHaveBeenNthCalledWith(2, {
      type: 'player/addNextTrack',
    });
  });

  it('does not expose a next dispatch when playback is unverified', async () => {
    mockRoute = { params: { sourceId: 'kuwo', query: '歌曲' } };
    mockSearch.mockResolvedValue({
      source: 'kuwo',
      query: '歌曲',
      page: 1,
      kind: 'track',
      total: 1,
      hasMore: false,
      results: [
        {
          kind: 'track',
          track: {
            id: 'kwtrack_1',
            source: 'kuwo',
            title: '酷我歌曲',
            artist: '歌手',
          },
        },
      ],
    });
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<SearchScreen />);
      await Promise.resolve();
    });
    expect(
      tree.root.findByProps({
        children: '下一首播放不可用：该来源尚未验证播放路径。',
      }),
    ).toBeTruthy();
    expect(
      tree.root.findAllByProps({ accessibilityLabel: '下一首播放酷我歌曲' }),
    ).toHaveLength(0);
    expect(mockDispatch).not.toHaveBeenCalled();
  });
});
