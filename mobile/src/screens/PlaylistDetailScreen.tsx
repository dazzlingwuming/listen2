import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
import type { RootState } from '../store';
import {
  addTrackToPlaylist,
  deletePlaylist,
  removeTrackFromPlaylist,
  toggleFavorite,
} from '../store/librarySlice';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { PlaylistDetail, Track } from '../types/music';
import * as playerActions from '../store/playerSlice';
import { colors, spacing, text } from '../theme';
import { providerLabels } from '../components/SourceTabs';
import { TrackRow, type PresentableTrack } from '../components/TrackRow';
import { ScreenLayout, sectionStyles } from './ScreenLayout';
import { PROVIDER_CAPABILITIES, providerClient } from '../api/client';
import { Sheet } from '../components/Sheet';

type RemotePlaylistStatus = 'idle' | 'loading' | 'ready' | 'error';

export function PlaylistDetailScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const dispatch = useDispatch<any>();
  const {
    title,
    sourceId,
    tracks = [],
    remotePlaylistId,
    libraryPlaylistId,
    libraryCollection,
  } = route.params || {};
  const favorites = useSelector((state: RootState) => state.library.favorites);
  const recentTracks = useSelector(
    (state: RootState) => state.library.recentTracks,
  );
  const playlists = useSelector((state: RootState) => state.library.playlists);
  const [remoteDetail, setRemoteDetail] = useState<PlaylistDetail | null>(null);
  const [remoteStatus, setRemoteStatus] = useState<RemotePlaylistStatus>(
    remotePlaylistId ? 'loading' : 'idle',
  );
  const playableTracks = (
    remotePlaylistId
      ? remoteDetail?.tracks ?? []
      : libraryPlaylistId
      ? playlists.find(item => item.id === libraryPlaylistId)?.tracks ?? []
      : libraryCollection === 'favorites'
      ? favorites
      : libraryCollection === 'recent'
      ? recentTracks
      : tracks
  ) as PresentableTrack[];
  const [addTarget, setAddTarget] = useState<Track | null>(null);
  const loadRemotePlaylist = useCallback(
    async (signal: AbortSignal) => {
      if (!remotePlaylistId || sourceId === 'local') return;
      setRemoteStatus('loading');
      try {
        const detail = await providerClient.getPlaylist(remotePlaylistId, {
          signal,
        });
        if (signal.aborted) return;
        setRemoteDetail(detail);
        setRemoteStatus('ready');
      } catch {
        if (signal.aborted) return;
        setRemoteStatus('error');
      }
    },
    [remotePlaylistId, sourceId],
  );
  useEffect(() => {
    if (!remotePlaylistId || sourceId === 'local') return;
    const controller = new AbortController();
    loadRemotePlaylist(controller.signal);
    return () => controller.abort();
  }, [loadRemotePlaylist, remotePlaylistId, sourceId]);
  const retryRemotePlaylist = () => {
    const controller = new AbortController();
    loadRemotePlaylist(controller.signal);
  };
  const play = (track: PresentableTrack, index: number) => {
    const playTracks = (playerActions as any).playTracks;
    if (playTracks) {
      dispatch(playTracks(playableTracks as Track[], index));
      navigation.navigate('Player');
      return;
    }
    const action =
      (playerActions as any).playTrack ||
      (playerActions as any).setCurrentTrack ||
      (playerActions as any).selectTrack;
    if (action) dispatch(action(track as Track));
    navigation.navigate('Player');
  };
  const playAll = () => {
    const index = playableTracks.findIndex(
      track => PROVIDER_CAPABILITIES[track.source].playback,
    );
    if (index >= 0) play(playableTracks[index], index);
  };
  const hasPlayableTrack = playableTracks.some(
    track => PROVIDER_CAPABILITIES[track.source].playback,
  );
  const detailTitle = remoteDetail?.title || title || '音乐详情';
  const displaySource = remoteDetail?.source || sourceId;
  return (
    <ScreenLayout
      subtitle={providerLabels[displaySource] || displaySource}
      title={detailTitle}
    >
      <Pressable
        accessibilityLabel="返回上一页"
        onPress={() => navigation.goBack()}
        style={styles.back}
      >
        <Text style={styles.backText}>‹ 返回</Text>
      </Pressable>
      <View style={[sectionStyles.card, styles.summary]}>
        <View style={styles.cover}>
          <Text style={styles.coverNote}>♫</Text>
        </View>
        <View style={styles.summaryCopy}>
          <Text style={text.heading}>{detailTitle}</Text>
          <Text style={text.meta}>
            {providerLabels[displaySource] || displaySource} ·{' '}
            {playableTracks.length
              ? `${playableTracks.length} 首歌曲`
              : remoteStatus === 'loading'
              ? '正在加载歌单'
              : '歌曲详情'}
          </Text>
        </View>
      </View>
      {remoteStatus === 'loading' ? (
        <View accessibilityLabel="正在加载远程歌单" style={styles.remoteState}>
          <Text style={text.meta}>正在加载歌单歌曲…</Text>
        </View>
      ) : null}
      {remoteStatus === 'error' ? (
        <View style={[sectionStyles.card, styles.remoteState]}>
          <Text style={text.heading}>暂时无法加载这个歌单</Text>
          <Text style={text.meta}>请检查网络后重试，或返回搜索结果。</Text>
          <Pressable
            accessibilityLabel="重试加载歌单"
            onPress={retryRemotePlaylist}
            style={sectionStyles.button}
          >
            <Text style={sectionStyles.buttonText}>重试</Text>
          </Pressable>
        </View>
      ) : null}
      {libraryPlaylistId ? (
        <Pressable
          accessibilityLabel="删除当前歌单"
          onPress={() =>
            Alert.alert('删除歌单？', '歌曲本身不会被删除。', [
              { text: '取消', style: 'cancel' },
              {
                text: '删除',
                style: 'destructive',
                onPress: () => {
                  dispatch(deletePlaylist(libraryPlaylistId));
                  navigation.goBack();
                },
              },
            ])
          }
          style={styles.delete}
        >
          <Text style={styles.deleteText}>删除歌单</Text>
        </Pressable>
      ) : null}
      {playableTracks.length ? (
        <View>
          {hasPlayableTrack ? (
            <Pressable
              accessibilityLabel="播放全部歌曲"
              onPress={playAll}
              style={[sectionStyles.button, styles.playAll]}
            >
              <Text style={sectionStyles.buttonText}>▶ 播放全部</Text>
            </Pressable>
          ) : null}
          {playableTracks.map((track, index) => {
            const favorite = favorites.some(
              item => item.id === track.id && item.source === track.source,
            );
            const canPlay = PROVIDER_CAPABILITIES[track.source].playback;
            return (
              <View key={`${track.id || index}`} style={styles.trackBlock}>
                <TrackRow
                  onPlay={canPlay ? () => play(track, index) : undefined}
                  onPress={canPlay ? () => play(track, index) : undefined}
                  track={track}
                />
                <View style={styles.trackActions}>
                  <Pressable
                    accessibilityLabel={
                      favorite ? `取消收藏${track.title}` : `收藏${track.title}`
                    }
                    onPress={() => dispatch(toggleFavorite(track as Track))}
                    style={styles.favorite}
                  >
                    <Text style={styles.favoriteText}>
                      {favorite ? '♥ 已收藏' : '♡ 收藏'}
                    </Text>
                  </Pressable>
                  {libraryPlaylistId ? (
                    <Pressable
                      accessibilityLabel={`从歌单移除${track.title}`}
                      onPress={() =>
                        dispatch(
                          removeTrackFromPlaylist({
                            playlistId: libraryPlaylistId,
                            track: track as Track,
                          }),
                        )
                      }
                      style={styles.favorite}
                    >
                      <Text style={styles.deleteText}>移除</Text>
                    </Pressable>
                  ) : (
                    <Pressable
                      accessibilityLabel={`将${track.title}加入歌单`}
                      onPress={() => setAddTarget(track as Track)}
                      style={styles.favorite}
                    >
                      <Text style={styles.favoriteText}>＋ 歌单</Text>
                    </Pressable>
                  )}
                </View>
              </View>
            );
          })}
        </View>
      ) : remoteStatus !== 'loading' && remoteStatus !== 'error' ? (
        <View style={[sectionStyles.card, styles.empty]}>
          <Text style={text.heading}>暂无可展示的歌曲</Text>
          <Text style={text.meta}>
            这个详情没有返回可播放的歌曲。请返回搜索结果或选择其他来源。
          </Text>
        </View>
      ) : null}
      <Sheet
        onClose={() => setAddTarget(null)}
        title="加入歌单"
        visible={Boolean(addTarget)}
      >
        <ScrollView contentContainerStyle={styles.sheet}>
          {playlists.length ? (
            playlists.map(playlist => (
              <Pressable
                accessibilityLabel={`加入${playlist.title}`}
                key={playlist.id}
                onPress={() => {
                  if (addTarget)
                    dispatch(
                      addTrackToPlaylist({
                        playlistId: playlist.id,
                        track: addTarget,
                      }),
                    );
                  setAddTarget(null);
                }}
                style={styles.playlistChoice}
              >
                <Text style={text.body}>{playlist.title}</Text>
                <Text style={text.meta}>{playlist.tracks.length} 首</Text>
              </Pressable>
            ))
          ) : (
            <View style={styles.empty}>
              <Text style={text.heading}>还没有自建歌单</Text>
              <Text style={text.meta}>请先在“我的”页面新建歌单。</Text>
            </View>
          )}
        </ScrollView>
      </Sheet>
    </ScreenLayout>
  );
}

const styles = StyleSheet.create({
  back: {
    alignSelf: 'flex-start',
    minWidth: 80,
    minHeight: 48,
    justifyContent: 'center',
  },
  backText: { ...text.body, color: colors.accent, fontWeight: '600' },
  summary: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  cover: {
    width: 88,
    height: 88,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.placeholder,
  },
  coverNote: { color: colors.muted, fontSize: 30 },
  summaryCopy: { flex: 1, gap: spacing.sm },
  empty: { gap: spacing.sm, minHeight: 140, justifyContent: 'center' },
  remoteState: { gap: spacing.sm, minHeight: 72, justifyContent: 'center' },
  playAll: { alignSelf: 'flex-start', marginBottom: spacing.sm },
  trackBlock: { position: 'relative', paddingBottom: spacing.sm },
  favorite: {
    alignSelf: 'flex-end',
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  favoriteText: { ...text.meta, color: colors.accent },
  delete: {
    alignSelf: 'flex-end',
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  deleteText: { ...text.meta, color: '#ff9aa9' },
  trackActions: { flexDirection: 'row', justifyContent: 'flex-end' },
  sheet: { padding: spacing.md },
  playlistChoice: {
    minHeight: 60,
    justifyContent: 'center',
    gap: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
});
