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
import type {
  SearchKind,
  SearchPage,
  SearchResult,
  SourceId,
  Track,
} from '../types/music';
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
  const [searchKind, setSearchKind] = useState<SearchKind>('track');
  const [items, setItems] = useState<SearchResult[]>([]);
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
      requestedKind = searchKind,
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
          requestedKind,
        );
        if (epoch !== requestEpoch.current) return;
        const resultItems = response.results;
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
    [items, query, searchKind, sourceId],
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
  const selectSearchKind = (kind: SearchKind) => {
    requestController.current?.abort();
    requestEpoch.current += 1;
    setSearchKind(kind);
    setItems([]);
    setPage(1);
    setHasMore(false);
    setStatus('guide');
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
        items={items}
        onPlay={play}
        onSelectPlaylist={playlist =>
          navigation.navigate('PlaylistDetail', {
            sourceId: playlist.source,
            title: playlist.title,
            remotePlaylistId: playlist.id,
          })
        }
        searchKind={searchKind}
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
  searchKind,
  onSelectPlaylist,
  onPlay,
}: {
  status: SearchStatus;
  sourceId: SourceId;
  searchKind: SearchKind;
  items: SearchResult[];
  onSelectPlaylist: (
    playlist: Extract<SearchResult, { kind: 'playlist' }>['playlist'],
  ) => void;
  onPlay: (track: PresentableTrack) => void;
}) {
  if (status === 'guide')
    return (
      <View style={[sectionStyles.card, styles.state]}>
        <Text style={text.heading}>开始搜索</Text>
        <Text style={text.meta}>
          {searchKind === 'playlist' &&
          !PROVIDER_CAPABILITIES[sourceId].playlistSearch
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
      {items.map((item, index) =>
        item.kind === 'track' ? (
          <TrackRow
            key={`${identity(item)}-${index}`}
            onPlay={
              PROVIDER_CAPABILITIES[item.track.source].playback
                ? () => onPlay(item.track)
                : undefined
            }
            onPress={
              PROVIDER_CAPABILITIES[item.track.source].playback
                ? () => onPlay(item.track)
                : undefined
            }
            track={item.track}
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
