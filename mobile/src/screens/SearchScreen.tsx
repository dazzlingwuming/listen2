import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  NativeScrollEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type NativeSyntheticEvent,
  type ScrollViewInstance,
} from 'react-native';
import { useDispatch } from 'react-redux';
import { useNavigation, useRoute } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type {
  SearchKind,
  SearchPage,
  SearchResult,
  SourceId,
  Track,
} from '../types/music';
import { isSourceId } from '../types/music';
import { PROVIDER_CAPABILITIES, providerClient } from '../api/client';
import { presentProviderError } from '../api/errors';
import * as playerActions from '../store/playerSlice';
import { colors, spacing, text } from '../theme';
import { SourceTabs, providerLabels } from '../components/SourceTabs';
import { TrackRow, type PresentableTrack } from '../components/TrackRow';
import { sectionStyles } from './ScreenLayout';
import { isOfflineDownloadEligible, offlineAudio } from '../offline/offlineAudio';
import {
  createSearchJourneyRestoration,
  createSearchJourneyState,
  reduceSearchJourney,
  restoreSearchJourneyState,
  searchResultIdentity,
  setSearchJourneyScrollAnchor,
  setSearchJourneySelection,
} from '../search/searchJourneyState';

type SearchStatus =
  | 'guide'
  | 'loading'
  | 'loadingMore'
  | 'ready'
  | 'empty'
  | 'error'
  | 'errorMore'
  | 'cancelled'
  | 'cancelledMore';

export function SearchScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const dispatch = useDispatch<any>();
  const routeRestoration =
    route.params?.restorationScope ?? route.params?.restoration;
  const initialRestoredJourney = restoreSearchJourneyState(routeRestoration);
  const initialSource: SourceId =
    initialRestoredJourney?.scope.source ||
    (isKnownSource(route.params?.sourceId) ? route.params.sourceId : 'netease');
  const initialQuery =
    initialRestoredJourney?.scope.query ?? String(route.params?.query ?? '');
  const initialKind: SearchKind =
    initialRestoredJourney?.scope.kind ||
    (route.params?.kind === 'playlist' ? 'playlist' : 'track');
  const initialJourney =
    initialRestoredJourney ||
    createSearchJourneyState({
      source: initialSource,
      query: initialQuery,
      kind: initialKind,
      requestId: 'initial',
      generation: 0,
    });
  const [sourceId, setSourceId] = useState<SourceId>(initialSource);
  const [query, setQuery] = useState(initialQuery);
  const [searchKind, setSearchKind] = useState<SearchKind>(initialKind);
  const [journey, setJourney] = useState(initialJourney);
  const [status, setStatus] = useState<SearchStatus>(() =>
    statusForJourney(initialJourney),
  );
  const [errorCopy, setErrorCopy] = useState<ReturnType<
    typeof presentProviderError
  > | null>(null);
  const requestEpoch = useRef(initialJourney.scope.generation);
  const requestController = useRef<AbortController | null>(null);
  const requestPage = useRef(
    initialJourney.retryPage ||
      (initialJourney.page > 0 ? initialJourney.page + 1 : 1),
  );
  const handledRouteRequest = useRef<string | null>(null);
  const scrollRef = useRef<ScrollViewInstance | null>(null);
  const scrollAnchorRef = useRef(initialJourney.scrollAnchor);
  const pendingRestoreAnchor = useRef(initialJourney.scrollAnchor);

  const search = useCallback(
    async (
      nextPage = 1,
      requestedSource = sourceId,
      requestedQuery = query,
      requestedKind = searchKind,
    ) => {
      const trimmed = requestedQuery.trim();
      if (!trimmed) {
        requestController.current?.abort();
        requestController.current = null;
        const epoch = ++requestEpoch.current;
        setStatus('guide');
        setJourney(() =>
          createSearchJourneyState({
            source: requestedSource,
            query: '',
            kind: requestedKind,
            requestId: `search-${epoch}`,
            generation: epoch,
            rows: [],
            page: 0,
            cursor: undefined,
            hasMore: false,
            retryPage: undefined,
            selectedIdentity: undefined,
            scrollAnchor: 0,
            terminal: 'guide',
          }),
        );
        scrollAnchorRef.current = 0;
        return;
      }
      requestController.current?.abort();
      const controller = new AbortController();
      requestController.current = controller;
      requestPage.current = nextPage;
      const epoch = ++requestEpoch.current;
      const requestId = `search-${epoch}`;
      setJourney(previous =>
        createSearchJourneyState({
          source: requestedSource,
          query: trimmed,
          kind: requestedKind,
          requestId,
          generation: epoch,
          rows: nextPage === 1 ? [] : previous.rows,
          page: nextPage === 1 ? 0 : previous.page,
          cursor: nextPage === 1 ? undefined : previous.cursor,
          hasMore: nextPage === 1 ? false : previous.hasMore,
          retryPage: undefined,
          selectedIdentity:
            nextPage === 1 ? undefined : previous.selectedIdentity,
          scrollAnchor: nextPage === 1 ? 0 : previous.scrollAnchor,
          terminal: nextPage === 1 ? 'loading' : 'loading-more',
        }),
      );
      setStatus(nextPage === 1 ? 'loading' : 'loadingMore');
      setErrorCopy(null);
      try {
        const response = await searchProvider(
          requestedSource,
          trimmed,
          nextPage,
          controller.signal,
          requestedKind,
        );
        if (epoch !== requestEpoch.current || controller.signal.aborted) return;
        if (requestController.current === controller)
          requestController.current = null;
        setJourney(previous => {
          const total = Number((response as any)?.total);
          const currentRows = nextPage === 1 ? 0 : previous.rows.length;
          const hasMore = Boolean(
            (response as any)?.hasMore ??
              (response as any)?.nextCursor ??
              (response as any)?.nextPage ??
              (Number.isFinite(total) &&
                currentRows + response.results.length < total &&
                response.results.length > 0),
          );
          const next = reduceSearchJourney(previous, {
            type: 'success',
            requestId,
            generation: epoch,
            page: nextPage,
            cursor:
              typeof (response as any)?.nextCursor === 'string'
                ? (response as any).nextCursor
                : undefined,
            hasMore,
            results: response.results,
          });
          setStatus(next.terminal === 'empty' ? 'empty' : 'ready');
          return next;
        });
      } catch (error) {
        if (epoch !== requestEpoch.current || controller.signal.aborted) return;
        if (requestController.current === controller)
          requestController.current = null;
        const presentation = presentProviderError(error);
        if (
          (error instanceof Error && error.name === 'AbortError') ||
          presentation.terminal === 'cancelled'
        ) {
          setErrorCopy(null);
          setJourney(previous =>
            reduceSearchJourney(previous, {
              type: 'cancelled',
              requestId,
              generation: epoch,
              page: nextPage,
            }),
          );
          setStatus(nextPage > 1 ? 'cancelledMore' : 'cancelled');
          return;
        }
        setErrorCopy(presentation);
        setJourney(previous =>
          reduceSearchJourney(previous, {
            type: 'failed',
            requestId,
            generation: epoch,
            page: nextPage,
          }),
        );
        setStatus(nextPage > 1 ? 'errorMore' : 'error');
      }
    },
    [query, searchKind, sourceId],
  );

  useEffect(() => {
    const restored = restoreSearchJourneyState(
      route.params?.restorationScope ?? route.params?.restoration,
    );
    if (restored) {
      const signature = restorationSignature(restored);
      if (handledRouteRequest.current === signature) return;
      handledRouteRequest.current = signature;
      const hadActiveRequest = requestController.current !== null;
      requestController.current?.abort();
      requestController.current = null;
      if (hadActiveRequest) requestEpoch.current += 1;
      else
        requestEpoch.current = Math.max(
          requestEpoch.current,
          restored.scope.generation,
        );
      requestPage.current =
        restored.retryPage || (restored.page > 0 ? restored.page + 1 : 1);
      scrollAnchorRef.current = restored.scrollAnchor;
      pendingRestoreAnchor.current = restored.scrollAnchor;
      setSourceId(restored.scope.source);
      setQuery(restored.scope.query);
      setSearchKind(restored.scope.kind);
      setJourney(restored);
      setStatus(statusForJourney(restored));
      setErrorCopy(null);
      return;
    }
    const requestedQuery = String(route.params?.query ?? '').trim();
    if (!requestedQuery) return;
    const requestedSource = isKnownSource(route.params?.sourceId)
      ? route.params.sourceId
      : 'netease';
    const requestedKind: SearchKind =
      route.params?.kind === 'playlist' ? 'playlist' : 'track';
    const signature = `${requestedSource}:${requestedQuery}:${requestedKind}`;
    if (handledRouteRequest.current === signature) return;
    handledRouteRequest.current = signature;
    setSourceId(requestedSource);
    setQuery(requestedQuery);
    setJourney(
      createSearchJourneyState({
        source: requestedSource,
        query: requestedQuery,
        kind: requestedKind,
        requestId: 'route',
        generation: requestEpoch.current,
      }),
    );
    search(1, requestedSource, requestedQuery, requestedKind);
  }, [
    route.params?.query,
    route.params?.sourceId,
    route.params?.kind,
    route.params?.restorationScope,
    route.params?.restoration,
    search,
  ]);
  const selectSource = (source: SourceId) => {
    requestController.current?.abort();
    requestController.current = null;
    const epoch = ++requestEpoch.current;
    setSourceId(source);
    setJourney(
      createSearchJourneyState({
        source,
        query,
        kind: searchKind,
        requestId: `source-${epoch}`,
        generation: epoch,
      }),
    );
    scrollAnchorRef.current = 0;
    setErrorCopy(null);
    setStatus('guide');
  };
  const cancel = () => {
    requestController.current?.abort();
    requestController.current = null;
    const page = requestPage.current;
    const epoch = ++requestEpoch.current;
    setJourney(previous => {
      const next = createSearchJourneyState({
        ...previous.scope,
        requestId: `cancel-${epoch}`,
        generation: epoch,
        rows: previous.rows,
        page: previous.page,
        cursor: previous.cursor,
        hasMore: previous.hasMore,
        retryPage: page,
        selectedIdentity: previous.selectedIdentity,
        scrollAnchor: previous.scrollAnchor,
        terminal:
          page > 1 && previous.rows.length > 0 ? 'cancelled-more' : 'cancelled',
      });
      setStatus(
        page > 1 && previous.rows.length > 0 ? 'cancelledMore' : 'cancelled',
      );
      return next;
    });
    setErrorCopy(null);
  };
  const selectSearchKind = (kind: SearchKind) => {
    requestController.current?.abort();
    requestController.current = null;
    const epoch = ++requestEpoch.current;
    setSearchKind(kind);
    setJourney(
      createSearchJourneyState({
        source: sourceId,
        query,
        kind,
        requestId: `kind-${epoch}`,
        generation: epoch,
      }),
    );
    scrollAnchorRef.current = 0;
    setErrorCopy(null);
    setStatus('guide');
  };
  const updateJourneyForNavigation = (selectedIdentity?: string) => {
    const withScroll = setSearchJourneyScrollAnchor(
      journey,
      scrollAnchorRef.current,
    );
    const next = setSearchJourneySelection(withScroll, selectedIdentity);
    const restorationScope = createSearchJourneyRestoration(next);
    // Persist the bounded DTO on this tab route before pushing detail. The
    // tab may be rebuilt while detail is on top during Android recreation.
    navigation.setParams({ restorationScope });
    setJourney(next);
    return restorationScope;
  };
  const play = (track: PresentableTrack, selectedIdentity?: string) => {
    const restorationScope = updateJourneyForNavigation(selectedIdentity);
    if (track.source === 'bilibili') {
      const match = /^bitrack_v_(BV[0-9A-Za-z]{6,32})$/.exec(String(track.id));
      if (match) {
        navigation.navigate('BilibiliDetail', {
          bvid: match[1],
          title: track.title || 'Bilibili 视频',
          restorationScope,
        });
        return;
      }
    }
    const creator =
      (playerActions as any).playTrack ||
      (playerActions as any).setCurrentTrack ||
      (playerActions as any).selectTrack;
    if (creator) dispatch(creator(track as Track));
  };
  const addNext = (track: PresentableTrack) => {
    if (
      !isKnownSource(track.source) ||
      !isOperationAvailable(track.source, 'playback')
    )
      return;
    const enqueue = (playerActions as any).addNextTrack;
    if (enqueue) dispatch(enqueue(track as Track));
  };
  const retry = () => {
    const page = journey.retryPage || (journey.page > 0 ? journey.page + 1 : 1);
    search(page, journey.scope.source, journey.scope.query, journey.scope.kind);
  };
  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offset = event.nativeEvent.contentOffset?.y;
    if (!Number.isFinite(offset) || offset < 0) return;
    scrollAnchorRef.current = offset;
    setJourney(previous => setSearchJourneyScrollAnchor(previous, offset));
  };
  useEffect(() => {
    const anchor = pendingRestoreAnchor.current;
    if (!anchor) return;
    pendingRestoreAnchor.current = 0;
    scrollRef.current?.scrollTo({ y: anchor, animated: false });
  }, [journey.scope.requestId, journey.rows.length]);

  useEffect(
    () => () => {
      requestController.current?.abort();
      requestController.current = null;
      // Invalidate a late provider reply after this screen leaves the tree.
      requestEpoch.current += 1;
    },
    [],
  );

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        onScroll={onScroll}
        ref={scrollRef}
        scrollEventThrottle={64}
      >
        <View style={styles.header}>
          <Text accessibilityRole="header" style={text.display}>
            搜索
          </Text>
          <Text style={styles.subtitle}>所有结果都会保留来源标签</Text>
        </View>
        <View style={styles.inputWrap}>
          <TextInput
            accessibilityLabel="搜索歌曲、歌手或歌单"
            autoCapitalize="none"
            onChangeText={setQuery}
            onSubmitEditing={() => search(1)}
            placeholder="搜索歌曲、歌手或歌单"
            placeholderTextColor={colors.muted}
            returnKeyType="search"
            style={styles.input}
            value={query}
          />
          {query ? (
            <Pressable
              accessibilityLabel="清除关键词"
              onPress={() => {
                requestController.current?.abort();
                requestController.current = null;
                const epoch = ++requestEpoch.current;
                setQuery('');
                setJourney(
                  createSearchJourneyState({
                    source: sourceId,
                    query: '',
                    kind: searchKind,
                    requestId: `clear-${epoch}`,
                    generation: epoch,
                  }),
                );
                scrollAnchorRef.current = 0;
                setErrorCopy(null);
                setStatus('guide');
              }}
              style={styles.clear}
            >
              <Text style={styles.clearText}>×</Text>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityLabel="搜索音乐"
            onPress={() => search(1)}
            style={styles.submit}
          >
            <Text style={styles.submitText}>搜索</Text>
          </Pressable>
        </View>
        <SourceTabs onChange={selectSource} value={sourceId} />
        <View accessibilityRole="tablist" style={styles.kindTabs}>
          <Pressable
            accessibilityLabel="搜索歌曲"
            accessibilityRole="tab"
            accessibilityState={{ selected: searchKind === 'track' }}
            onPress={() => selectSearchKind('track')}
            style={[
              styles.kindTab,
              searchKind === 'track' && styles.kindSelected,
            ]}
          >
            <Text
              style={[
                styles.kindText,
                searchKind === 'track' && styles.kindSelectedText,
              ]}
            >
              歌曲
            </Text>
          </Pressable>
          <Pressable
            accessibilityLabel="搜索歌单"
            accessibilityRole="tab"
            accessibilityState={{ selected: searchKind === 'playlist' }}
            onPress={() => selectSearchKind('playlist')}
            style={[
              styles.kindTab,
              searchKind === 'playlist' && styles.kindSelected,
            ]}
          >
            <Text
              style={[
                styles.kindText,
                searchKind === 'playlist' && styles.kindSelectedText,
              ]}
            >
              歌单
            </Text>
          </Pressable>
        </View>
        {status === 'loading' || status === 'loadingMore' ? (
          <View style={styles.loadingLine}>
            <ActivityIndicator color={colors.accent} />
            <Text style={text.meta}>
              {status === 'loading'
                ? `正在搜索${providerLabels[sourceId]}…`
                : '正在加载更多…'}
            </Text>
            {status === 'loading' || status === 'loadingMore' ? (
              <Pressable
                accessibilityLabel="取消搜索"
                onPress={cancel}
                style={styles.cancel}
              >
                <Text style={styles.cancelText}>取消搜索</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
        <SearchSurface
          items={journey.rows}
          onPlay={play}
          onAddNext={addNext}
          onRetry={retry}
          onDownload={track => void offlineAudio.requestExplicit(track as Track)}
          onSelectPlaylist={playlist => {
            if (!isOperationAvailable(playlist.source, 'detail')) return;
            const restorationScope = updateJourneyForNavigation(
              searchResultIdentity({ kind: 'playlist', playlist }),
            );
            navigation.navigate('PlaylistDetail', {
              sourceId: playlist.source,
              title: playlist.title,
              remotePlaylistId: playlist.id,
              restorationScope,
            });
          }}
          searchKind={searchKind}
          sourceId={sourceId}
          status={status}
          errorCopy={errorCopy}
        />
        {['ready', 'errorMore', 'cancelledMore'].includes(status) &&
        journey.hasMore ? (
          <Pressable
            accessibilityLabel="加载更多搜索结果"
            onPress={() =>
              search(
                journey.retryPage || journey.page + 1,
                journey.scope.source,
                journey.scope.query,
                journey.scope.kind,
              )
            }
            style={sectionStyles.secondaryButton}
          >
            <Text style={sectionStyles.secondaryText}>加载更多</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function SearchSurface({
  status,
  sourceId,
  items,
  searchKind,
  onSelectPlaylist,
  onPlay,
  onAddNext,
  onRetry,
  onDownload,
  errorCopy,
}: {
  status: SearchStatus;
  sourceId: SourceId;
  searchKind: SearchKind;
  items: SearchResult[];
  onSelectPlaylist: (
    playlist: Extract<SearchResult, { kind: 'playlist' }>['playlist'],
  ) => void;
  onPlay: (track: PresentableTrack, selectedIdentity?: string) => void;
  onAddNext: (track: PresentableTrack) => void;
  onRetry: () => void;
  onDownload: (track: PresentableTrack) => void;
  errorCopy: ReturnType<typeof presentProviderError> | null;
}) {
  if (status === 'guide')
    return (
      <View style={[sectionStyles.card, styles.state]}>
        <Text style={text.heading}>开始搜索</Text>
        <Text style={text.meta}>
          {searchKind === 'playlist' &&
          !isOperationAvailable(sourceId, 'detail')
            ? `${providerLabels[sourceId]}暂不提供经过验证的公开歌单搜索。`
            : '输入关键词后选择来源，结果会显示在这里。'}
        </Text>
      </View>
    );
  if (status === 'loading' && !items.length)
    return (
      <View
        accessibilityLabel={`正在搜索${providerLabels[sourceId]}`}
        style={styles.skeletons}
      >
        {[1, 2, 3, 4].map(key => (
          <View key={key} style={styles.skeleton} />
        ))}
      </View>
    );
  if (status === 'empty')
    return (
      <View style={[sectionStyles.card, styles.state]}>
        <Text style={text.heading}>还没有搜索结果</Text>
        <Text style={text.meta}>换个关键词，或选择其他音乐来源后再试。</Text>
      </View>
    );
  if (status === 'error' && !items.length)
    return (
      <View
        accessibilityRole="alert"
        style={[sectionStyles.card, styles.state]}
      >
        <Text style={text.heading}>
          {errorCopy?.title || `${providerLabels[sourceId]}暂时无法完成此操作`}
        </Text>
        <Text style={text.meta}>
          {errorCopy?.message || '请检查网络后重试，或选择其他来源。'}
        </Text>
        {errorCopy?.action === 'retry' ? (
          <Pressable
            accessibilityLabel="重试搜索"
            onPress={onRetry}
            style={sectionStyles.button}
          >
            <Text style={sectionStyles.buttonText}>重试</Text>
          </Pressable>
        ) : null}
      </View>
    );
  if (status === 'cancelled' && !items.length)
    return (
      <View style={[sectionStyles.card, styles.state]}>
        <Text style={text.heading}>已取消本次搜索</Text>
        <Text style={text.meta}>关键词和来源已保留，可以重新搜索。</Text>
        <Pressable
          accessibilityLabel="重试搜索"
          onPress={onRetry}
          style={sectionStyles.button}
        >
          <Text style={sectionStyles.buttonText}>重试</Text>
        </Pressable>
      </View>
    );
  return (
    <View>
      {status === 'errorMore' || status === 'cancelledMore' ? (
        <View
          accessibilityRole="alert"
          style={[sectionStyles.card, styles.state]}
        >
          <Text style={text.meta}>
            {status === 'cancelledMore'
              ? '已取消加载更多，已显示的结果仍可使用。'
              : errorCopy?.message || '加载更多失败，已显示的结果仍可使用。'}
          </Text>
          {status === 'cancelledMore' || errorCopy?.action === 'retry' ? (
            <Pressable
              accessibilityLabel="重试加载更多搜索结果"
              onPress={onRetry}
              style={sectionStyles.secondaryButton}
            >
              <Text style={sectionStyles.secondaryText}>重试加载更多</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {items.map((item, index) =>
        item.kind === 'track' ? (
          <TrackRow
            key={`${identity(item)}-${index}`}
            onPlay={
              isOperationAvailable(item.track.source, 'playback')
                ? () => onPlay(item.track, identity(item))
                : undefined
            }
            onPress={
              isOperationAvailable(item.track.source, 'playback')
                ? () => onPlay(item.track, identity(item))
                : undefined
            }
            onAddNext={
              isOperationAvailable(item.track.source, 'playback')
                ? () => onAddNext(item.track)
                : undefined
            }
            nextUnavailableReason={
              isOperationAvailable(item.track.source, 'playback')
                ? undefined
                : nextActionUnavailableReason(item.track.source)
            }
            track={item.track}
            onDownload={
              isOfflineDownloadEligible(item.track)
                ? () => onDownload(item.track)
                : undefined
            }
          />
        ) : (
          <Pressable
            accessibilityLabel={`打开歌单${item.playlist.title}`}
            key={`${identity(item)}-${index}`}
            onPress={() => onSelectPlaylist(item.playlist)}
            style={[sectionStyles.card, styles.playlistResult]}
          >
            <View style={styles.playlistMark}>
              <Text style={styles.playlistMarkText}>♫</Text>
            </View>
            <View style={styles.playlistCopy}>
              <Text style={text.body}>{item.playlist.title}</Text>
              <Text style={text.meta}>
                {[
                  item.playlist.author,
                  item.playlist.trackCount
                    ? `${item.playlist.trackCount} 首`
                    : undefined,
                ]
                  .filter(Boolean)
                  .join(' · ') || providerLabels[item.playlist.source]}
              </Text>
            </View>
            <Text style={styles.playlistArrow}>›</Text>
          </Pressable>
        ),
      )}
    </View>
  );
}

async function searchProvider(
  sourceId: SourceId,
  query: string,
  page: number,
  signal: AbortSignal,
  kind: SearchKind,
): Promise<SearchPage> {
  return providerClient.search(sourceId, query, page, { signal, kind });
}

function isOperationAvailable(
  source: SourceId,
  operation: 'detail' | 'playback',
): boolean {
  const capabilities = PROVIDER_CAPABILITIES[source] as any;
  const projected = capabilities?.operations?.[operation];
  if (projected) return projected.status === 'available';
  // Keeps isolated older test seams compatible while production always reads
  // the operation-level projection.
  return operation === 'detail'
    ? capabilities?.playlist === true || capabilities?.playlistSearch === true
    : capabilities?.playback === true;
}

function isKnownSource(value: unknown): value is SourceId {
  return isSourceId(value);
}

function statusForJourney(journey: {
  rows: SearchResult[];
  terminal: string;
}): SearchStatus {
  if (journey.terminal === 'ready') return 'ready';
  if (journey.terminal === 'empty') return 'empty';
  if (journey.terminal === 'error') return 'error';
  if (journey.terminal === 'error-more') return 'errorMore';
  if (journey.terminal === 'cancelled') return 'cancelled';
  if (journey.terminal === 'cancelled-more') return 'cancelledMore';
  if (journey.terminal === 'loading-more') return 'loadingMore';
  if (journey.terminal === 'loading') return 'loading';
  return journey.rows.length ? 'ready' : 'guide';
}

function restorationSignature(journey: {
  scope: {
    source: SourceId;
    query: string;
    kind: SearchKind;
    requestId: string;
    generation: number;
  };
  page: number;
  cursor?: string;
  hasMore: boolean;
  retryPage?: number;
  rows: SearchResult[];
  selectedIdentity?: string;
  scrollAnchor: number;
  terminal: string;
}) {
  return JSON.stringify([
    journey.scope.source,
    journey.scope.query,
    journey.scope.kind,
    journey.scope.requestId,
    journey.scope.generation,
    journey.page,
    journey.cursor || '',
    journey.hasMore,
    journey.retryPage || 0,
    journey.rows,
    journey.selectedIdentity || '',
    journey.scrollAnchor,
    journey.terminal,
  ]);
}

function nextActionUnavailableReason(source: SourceId): string {
  const capabilities = PROVIDER_CAPABILITIES[source] as any;
  const playback = capabilities?.operations?.playback;
  if (playback?.reason === 'login-required') return '请先登录该来源。';
  if (playback?.reason === 'unverified-route')
    return '该来源尚未验证播放路径。';
  return '该来源暂不支持播放。';
}

function identity(item: SearchResult) {
  return item.kind === 'track'
    ? `track:${item.track.source}:${item.track.id}`
    : `playlist:${item.playlist.source}:${item.playlist.id}`;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  scroll: { gap: spacing.lg, padding: spacing.md, paddingBottom: spacing.xxl },
  header: { gap: spacing.xs },
  subtitle: text.meta,
  inputWrap: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  input: {
    flex: 1,
    minWidth: 0,
    minHeight: 52,
    color: colors.text,
    fontSize: 14,
    paddingHorizontal: spacing.md,
  },
  clear: {
    width: 40,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearText: { color: colors.muted, fontSize: 24 },
  submit: {
    minWidth: 64,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    marginRight: 2,
    backgroundColor: colors.accent,
  },
  submitText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  loadingLine: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  cancel: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  cancelText: { color: colors.accent, fontSize: 12 },
  kindTabs: { flexDirection: 'row', gap: spacing.sm },
  kindTab: {
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  kindSelected: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent,
  },
  kindText: { ...text.meta, color: colors.muted },
  kindSelectedText: { color: colors.text, fontWeight: '600' },
  skeletons: { gap: spacing.sm },
  skeleton: { height: 76, borderRadius: 12, backgroundColor: colors.surface },
  state: { gap: spacing.sm, minHeight: 132, justifyContent: 'center' },
  playlistResult: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  playlistMark: {
    width: 48,
    height: 48,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.placeholder,
  },
  playlistMarkText: { color: colors.muted, fontSize: 22 },
  playlistCopy: { flex: 1, gap: spacing.xs },
  playlistArrow: { color: colors.muted, fontSize: 28 },
});
