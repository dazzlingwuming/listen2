import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { ScreenLayout, sectionStyles } from './ScreenLayout';
import { colors, spacing, text } from '../theme';
import { providerClient } from '../api/client';
import type {
  DiscoverPage,
  DiscoverSection,
  DiscoverSource,
} from '../types/provider';

const SOURCE_LABELS: Record<DiscoverSource, string> = {
  netease: '网易云音乐',
  kugou: '酷狗音乐',
};

function titleFor(source: DiscoverSource, section: DiscoverSection): string {
  if (section.kind === 'featured') return '精选歌单';
  return source === 'netease' ? '热门榜单' : '酷狗榜单';
}

function safeStatusCopy(section: DiscoverSection): string | null {
  if (section.status === 'unavailable') {
    return '该内容暂未提供经过验证的公开来源。';
  }
  if (section.status === 'error') return '内容暂时无法加载，请稍后重试。';
  return section.items.length === 0 ? '暂时没有可显示的内容。' : null;
}

export function DiscoverScreen() {
  const navigation = useNavigation<any>();
  const [source, setSource] = useState<DiscoverSource>('netease');
  const [page, setPage] = useState<DiscoverPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const epoch = useRef(0);
  const controller = useRef<AbortController | null>(null);

  const load = useCallback(
    async (nextSource: DiscoverSource, refresh = false) => {
      controller.current?.abort();
      const nextController = new AbortController();
      controller.current = nextController;
      const requestEpoch = ++epoch.current;
      if (refresh) setRefreshing(true);
      else {
        setLoading(true);
        setPage(null);
      }
      try {
        const nextPage = await providerClient.getDiscover(nextSource, {
          signal: nextController.signal,
        });
        if (requestEpoch === epoch.current) setPage(nextPage);
      } catch {
        if (requestEpoch === epoch.current && !nextController.signal.aborted) {
          setPage({
            source: nextSource,
            sections: [
              {
                kind: 'featured',
                status: 'error',
                code: 'NETWORK_ERROR',
                retryable: true,
              },
              {
                kind: 'charts',
                status: 'error',
                code: 'NETWORK_ERROR',
                retryable: true,
              },
            ],
          });
        }
      } finally {
        if (requestEpoch === epoch.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    load(source).catch(() => undefined);
    return () => controller.current?.abort();
  }, [load, source]);

  return (
    <ScreenLayout subtitle="从正式来源发现音乐" title="发现">
      <Pressable
        accessibilityLabel="搜索歌曲、歌手或歌单"
        onPress={() => navigation.navigate('Search', { sourceId: 'netease' })}
        style={styles.search}
      >
        <Text style={styles.searchIcon}>⌕</Text>
        <Text style={styles.searchText}>搜索歌曲、歌手或歌单</Text>
      </Pressable>
      <View style={styles.filters}>
        {(Object.keys(SOURCE_LABELS) as DiscoverSource[]).map(item => (
          <Pressable
            accessibilityLabel={`切换至${SOURCE_LABELS[item]}`}
            key={item}
            onPress={() => item !== source && setSource(item)}
            style={[styles.filter, source === item && styles.filterSelected]}
          >
            <Text style={text.body}>{SOURCE_LABELS[item]}</Text>
          </Pressable>
        ))}
      </View>
      <Pressable
        accessibilityLabel={`刷新${SOURCE_LABELS[source]}发现内容`}
        disabled={loading || refreshing}
        onPress={() => {
          load(source, true).catch(() => undefined);
        }}
        style={styles.refresh}
      >
        <Text style={text.body}>{refreshing ? '正在刷新…' : '刷新'}</Text>
      </Pressable>
      {loading && !page ? (
        <Text style={text.meta}>正在加载发现内容…</Text>
      ) : null}
      <ScrollView contentContainerStyle={styles.content}>
        {page?.sections.map(section => {
          const statusCopy = safeStatusCopy(section);
          return (
            <View key={section.kind} style={sectionStyles.section}>
              <Text style={text.heading}>{titleFor(source, section)}</Text>
              {section.status === 'ready'
                ? section.items.map(item => (
                    <Pressable
                      accessibilityLabel={`${SOURCE_LABELS[source]} 歌单：${item.title}`}
                      key={item.id}
                      onPress={() =>
                        navigation.navigate('PlaylistDetail', {
                          sourceId: source,
                          title: item.title,
                          remotePlaylistId: item.id,
                        })
                      }
                      style={sectionStyles.card}
                    >
                      <Text style={text.body}>{item.title}</Text>
                      <Text style={text.meta}>
                        {item.author ?? '未知创建者'} ·{' '}
                        {item.trackCount ?? '未知'} 首
                      </Text>
                    </Pressable>
                  ))
                : null}
              {statusCopy ? <Text style={text.meta}>{statusCopy}</Text> : null}
              {section.status === 'error' ? (
                <Pressable
                  accessibilityLabel={`重试${titleFor(source, section)}`}
                  onPress={() => {
                    load(source, true).catch(() => undefined);
                  }}
                  style={styles.retry}
                >
                  <Text style={text.body}>重试</Text>
                </Pressable>
              ) : null}
            </View>
          );
        })}
      </ScrollView>
    </ScreenLayout>
  );
}

const styles = StyleSheet.create({
  search: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: 14,
    backgroundColor: colors.surface,
  },
  searchIcon: { color: colors.muted, fontSize: 24 },
  searchText: { ...text.body, color: colors.muted },
  filters: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  filter: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: 24,
    backgroundColor: colors.surface,
  },
  filterSelected: { backgroundColor: colors.accent },
  refresh: { minHeight: 48, justifyContent: 'center', alignItems: 'center' },
  retry: { minHeight: 48, justifyContent: 'center' },
  content: { paddingBottom: spacing.lg },
});
