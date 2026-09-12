import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useDispatch } from 'react-redux';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { SearchPage, SourceId, Track } from '../types/music';
import { PROVIDER_CAPABILITIES, providerClient } from '../api/client';
import * as playerActions from '../store/playerSlice';
import { colors, spacing, text } from '../theme';
import { SourceTabs, providerLabels } from '../components/SourceTabs';
import { TrackRow, type PresentableTrack } from '../components/TrackRow';
import { ScreenLayout, sectionStyles } from './ScreenLayout';

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
  const [sourceId, setSourceId] = useState<SourceId>(
    route.params?.sourceId || ('netease' as SourceId),
  );
  const [query, setQuery] = useState(route.params?.query || '');
  const [items, setItems] = useState<PresentableTrack[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [status, setStatus] = useState<SearchStatus>('guide');
  const requestEpoch = useRef(0);
  const requestController = useRef<AbortController | null>(null);
  const handledRouteRequest = useRef<string | null>(null);

  const search = useCallback(
    async (
      nextPage = 1,
      requestedSource = sourceId,
      requestedQuery = query,
    ) => {
      const trimmed = requestedQuery.trim();
      if (!trimmed) {
        setStatus('guide');
        setItems([]);
        return;
      }
      requestController.current?.abort();
      const controller = new AbortController();
      requestController.current = controller;
      const epoch = ++requestEpoch.current;
      setStatus(nextPage === 1 ? 'loading' : 'loadingMore');
      try {
        const response = await searchProvider(
          requestedSource,
          trimmed,
          nextPage,
          controller.signal,
        );
        if (epoch !== requestEpoch.current) return;
        const resultItems = normalizedItems(response, requestedSource);
        const previousCount = nextPage === 1 ? 0 : items.length;
        const uniqueItems =
          nextPage === 1
            ? resultItems
            : resultItems.filter(
                item => !items.some(old => identity(old) === identity(item)),
              );
        setItems(previous =>
          nextPage === 1 ? resultItems : [...previous, ...uniqueItems],
        );
        setPage(nextPage);
        const total = Number((response as any)?.total);
        setHasMore(
          Boolean(
            (response as any)?.hasMore ??
              (response as any)?.nextCursor ??
              (response as any)?.nextPage ??
              (Number.isFinite(total) &&
                previousCount + uniqueItems.length < total &&
                resultItems.length > 0),
          ),
        );
        setStatus(resultItems.length || nextPage > 1 ? 'ready' : 'empty');
      } catch {
        if (epoch === requestEpoch.current)
          setStatus(controller.signal.aborted ? 'cancelled' : 'error');
      }
    },
    [items, query, sourceId],
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
    setItems([]);
    setPage(1);
    search(1, requestedSource, requestedQuery);
  }, [route.params?.query, route.params?.sourceId, search]);
  const selectSource = (source: SourceId) => {
    requestController.current?.abort();
    requestEpoch.current += 1;
    setSourceId(source);
    setItems([]);
    setPage(1);
    setStatus('guide');
  };
  const cancel = () => {
    requestController.current?.abort();
    requestEpoch.current += 1;
    setStatus('cancelled');
  };
  const play = (track: PresentableTrack) => {
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
              setItems([]);
              setHasMore(false);
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
        items={items}
        onPlay={play}
        onSelect={track =>
          navigation.navigate('PlaylistDetail', {
            sourceId: (track.sourceId || sourceId) as SourceId,
            title: track.title || track.name || '音乐详情',
            tracks: [track],
          })
        }
        sourceId={sourceId}
        status={status}
      />
      {status === 'ready' && hasMore ? (
        <Pressable
          accessibilityLabel="加载更多搜索结果"
          onPress={() => search(page + 1)}
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
  onSelect,
  onPlay,
}: {
  status: SearchStatus;
  sourceId: SourceId;
  items: PresentableTrack[];
  onSelect: (track: PresentableTrack) => void;
  onPlay: (track: PresentableTrack) => void;
}) {
  if (status === 'guide')
    return (
      <View style={[sectionStyles.card, styles.state]}>
        <Text style={text.heading}>开始搜索</Text>
        <Text style={text.meta}>输入关键词后选择来源，结果会显示在这里。</Text>
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
      <View style={[sectionStyles.card, styles.state]}>
        <Text style={text.heading}>
          {providerLabels[sourceId]}暂时无法完成此操作
        </Text>
        <Text style={text.meta}>请检查网络后重试，或选择其他来源。</Text>
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
      {items.map((track, index) => (
        <TrackRow
          key={`${identity(track)}-${index}`}
          onPlay={
            PROVIDER_CAPABILITIES[sourceOf(track)].playback
              ? () => onPlay(track)
              : undefined
          }
          onPress={() => onSelect(track)}
          track={track}
        />
      ))}
    </View>
  );
}

async function searchProvider(
  sourceId: SourceId,
  query: string,
  page: number,
  signal: AbortSignal,
): Promise<SearchPage | unknown> {
  const client: any = providerClient as any;
  if (typeof client.search === 'function')
    return client.search(sourceId, query, page, { signal });
  if (typeof client.searchTracks === 'function')
    return client.searchTracks({ sourceId, query, page });
  if (client.providers?.[sourceId]?.search)
    return client.providers[sourceId].search({ query, page });
  throw new Error('Search capability is unavailable');
}

function normalizedItems(result: any, sourceId: SourceId): PresentableTrack[] {
  const records =
    result?.tracks || result?.items || result?.results || result?.data || [];
  return Array.isArray(records)
    ? records.map((record: any) => ({
        ...record,
        sourceId: record.sourceId || record.source || sourceId,
      }))
    : [];
}
function identity(track: PresentableTrack) {
  return String(
    track.id ||
      (track as any).trackId ||
      `${track.sourceId}:${track.title || track.name}`,
  );
}
function sourceOf(track: PresentableTrack): SourceId {
  return (track.sourceId || track.source || 'netease') as SourceId;
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
  skeletons: { gap: spacing.sm },
  skeleton: { height: 76, borderRadius: 12, backgroundColor: colors.surface },
  state: { gap: spacing.sm, minHeight: 132, justifyContent: 'center' },
});
