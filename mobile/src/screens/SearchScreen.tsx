import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigation, useRoute } from '@react-navigation/native';
import type {
  SearchKind,
  SearchPage,
  SearchResult,
  SourceId,
  Track,
} from '../types/music';
import { PROVIDER_CAPABILITIES, providerClient } from '../api/client';
import { presentProviderError } from '../api/errors';
import * as playerActions from '../store/playerSlice';
import { colors, spacing, text } from '../theme';
import { SourceTabs, providerLabels } from '../components/SourceTabs';
import { TrackRow, type PresentableTrack } from '../components/TrackRow';
import { ScreenLayout, sectionStyles } from './ScreenLayout';
import { isOfflineDownloadEligible } from '../offline/offlineAudio';
import { requestDownload } from '../store/downloadSlice';
import type { RootState } from '../store';
import {
  createSearchJourneyState,
  reduceSearchJourney,
} from '../search/searchJourneyState';

type SearchStatus =
  | 'guide'
  | 'loading'
  | 'loadingMore'
  | 'ready'
  | 'empty'
  | 'error'
  | 'cancelled';

export function SearchScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const dispatch = useDispatch<any>();
  const downloads = useSelector((state: RootState) => state.downloads.entries);
  const [sourceId, setSourceId] = useState<SourceId>(
    route.params?.sourceId || ('netease' as SourceId),
  );
  const [query, setQuery] = useState(route.params?.query || '');
  const [searchKind, setSearchKind] = useState<SearchKind>('track');
  const [journey, setJourney] = useState(() =>
    createSearchJourneyState({
      source: route.params?.sourceId || ('netease' as SourceId),
      query: route.params?.query || '',
      kind: 'track',
      requestId: 'initial',
      generation: 0,
    }),
  );
  const [status, setStatus] = useState<SearchStatus>('guide');
  const [errorCopy, setErrorCopy] = useState<ReturnType<
    typeof presentProviderError
  > | null>(null);
  const requestEpoch = useRef(0);
  const requestController = useRef<AbortController | null>(null);
  const handledRouteRequest = useRef<string | null>(null);

  const search = useCallback(
    async (
      nextPage = 1,
      requestedSource = sourceId,
      requestedQuery = query,
      requestedKind = searchKind,
    ) => {
      const trimmed = requestedQuery.trim();
      if (!trimmed) {
        setStatus('guide');
        setJourney(previous =>
          createSearchJourneyState({
            ...previous.scope,
            query: '',
            rows: [],
            terminal: 'guide',
          }),
        );
        return;
      }
      requestController.current?.abort();
      const controller = new AbortController();
      requestController.current = controller;
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
          selectedIdentity: previous.selectedIdentity,
          scrollAnchor: previous.scrollAnchor,
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
        if (epoch !== requestEpoch.current) return;
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
        if (epoch === requestEpoch.current) {
          if (controller.signal.aborted) {
            setJourney(previous =>
              reduceSearchJourney(previous, {
                type: 'cancelled',
                requestId,
                generation: epoch,
                page: nextPage,
              }),
            );
          }
          setErrorCopy(
            controller.signal.aborted ? null : presentProviderError(error),
          );
          setStatus(controller.signal.aborted ? 'cancelled' : 'error');
        }
      }
    },
    [query, searchKind, sourceId],
  );

  useEffect(() => {
    const requestedQuery = String(route.params?.query ?? '').trim();
    if (!requestedQuery) return;
    const requestedSource = (route.params?.sourceId ?? 'netease') as SourceId;
    const signature = `${requestedSource}:${requestedQuery}`;
    if (handledRouteRequest.current === signature) return;
    handledRouteRequest.current = signature;
    setSourceId(requestedSource);
    setQuery(requestedQuery);
    setJourney(
      createSearchJourneyState({
        source: requestedSource,
        query: requestedQuery,
        kind: 'track',
        requestId: 'route',
        generation: requestEpoch.current,
      }),
    );
    search(1, requestedSource, requestedQuery);
  }, [route.params?.query, route.params?.sourceId, search]);
  const selectSource = (source: SourceId) => {
    requestController.current?.abort();
    requestEpoch.current += 1;
    setSourceId(source);
    setJourney(
      createSearchJourneyState({
        source,
        query,
        kind: searchKind,
        requestId: 'source-change',
        generation: requestEpoch.current,
      }),
    );
    setStatus('guide');
  };
  const cancel = () => {
    requestController.current?.abort();
    requestEpoch.current += 1;
    setStatus('cancelled');
  };
  const selectSearchKind = (kind: SearchKind) => {
    requestController.current?.abort();
    requestEpoch.current += 1;
    setSearchKind(kind);
    setJourney(
      createSearchJourneyState({
        source: sourceId,
        query,
        kind,
        requestId: 'kind-change',
        generation: requestEpoch.current,
      }),
    );
    setStatus('guide');
  };
  const play = (track: PresentableTrack) => {
    if (track.source === 'bilibili') {
      const match = /^bitrack_v_(BV[0-9A-Za-z]{6,32})$/.exec(String(track.id));
      if (match) {
        navigation.navigate('BilibiliDetail', {
          bvid: match[1],
          title: track.title || 'Bilibili 视频',
          restorationScope: journey.scope,
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

  return (
    <ScreenLayout subtitle="所有结果都会保留来源标签" title="搜索">
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
              requestEpoch.current += 1;
              setQuery('');
              setJourney(
                createSearchJourneyState({
                  source: sourceId,
                  query: '',
                  kind: searchKind,
                  requestId: 'clear',
                  generation: requestEpoch.current,
                }),
              );
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
          {status === 'loading' ? (
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
        downloads={downloads}
        onDownload={track => dispatch(requestDownload(track as Track))}
        onSelectPlaylist={playlist =>
          isOperationAvailable(playlist.source, 'detail') &&
          navigation.navigate('PlaylistDetail', {
            sourceId: playlist.source,
            title: playlist.title,
            remotePlaylistId: playlist.id,
            restorationScope: journey.scope,
          })
        }
        searchKind={searchKind}
        sourceId={sourceId}
        status={status}
        errorCopy={errorCopy}
      />
      {status === 'ready' && journey.hasMore ? (
        <Pressable
          accessibilityLabel="加载更多搜索结果"
          onPress={() => search(journey.page + 1)}
          style={sectionStyles.secondaryButton}
        >
          <Text style={sectionStyles.secondaryText}>加载更多</Text>
        </Pressable>
      ) : null}
    </ScreenLayout>
  );
}

function SearchSurface({
  status,
  sourceId,
  items,
  searchKind,
  onSelectPlaylist,
  onPlay,
  downloads,
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
  onPlay: (track: PresentableTrack) => void;
  downloads: RootState['downloads']['entries'];
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
  if (status === 'error')
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
      </View>
    );
  if (status === 'cancelled')
    return (
      <View style={[sectionStyles.card, styles.state]}>
        <Text style={text.heading}>已取消本次搜索</Text>
        <Text style={text.meta}>关键词和来源已保留，可以重新搜索。</Text>
      </View>
    );
  return (
    <View>
      {items.map((item, index) =>
        item.kind === 'track' ? (
          <TrackRow
            key={`${identity(item)}-${index}`}
            onPlay={
              isOperationAvailable(item.track.source, 'playback')
                ? () => onPlay(item.track)
                : undefined
            }
            onPress={
              isOperationAvailable(item.track.source, 'playback')
                ? () => onPlay(item.track)
                : undefined
            }
            track={item.track}
            onDownload={
              isOfflineDownloadEligible(item.track)
                ? () => onDownload(item.track)
                : undefined
            }
            downloadStatus={
              downloads.find(
                entry =>
                  entry.source === item.track.source &&
                  entry.trackId === item.track.id,
              )?.status
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
function identity(item: SearchResult) {
  return item.kind === 'track'
    ? `track:${item.track.source}:${item.track.id}`
    : `playlist:${item.playlist.source}:${item.playlist.id}`;
}

const styles = StyleSheet.create({
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
