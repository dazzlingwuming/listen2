import React, { useEffect, useRef, useState } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigation } from '@react-navigation/native';
import type { RootState } from '../store';
import * as playerActions from '../store/playerSlice';
import { colors, spacing, text } from '../theme';
import {
  artwork,
  formatDuration,
  trackArtist,
  trackSource,
  trackTitle,
  type PresentableTrack,
} from '../components/TrackRow';
import { providerLabels } from '../components/SourceTabs';
import { Sheet } from '../components/Sheet';
import { providerClient } from '../api/client';
import { toggleFavorite } from '../store/librarySlice';
import type { Track } from '../types/music';
import type { Lyric } from '../types/provider';

export function PlayerScreen() {
  const navigation = useNavigation<any>();
  const dispatch = useDispatch<any>();
  const state = useSelector((root: RootState) => (root as any).player || {});
  const current = (state.currentTrack || state.current || state.track) as
    | PresentableTrack
    | undefined;
  const queue = (
    state.playNextQueue?.length
      ? state.playNextQueue
      : state.playlist || state.tracks || []
  ) as PresentableTrack[];
  const showingPlayNext = Boolean(state.playNextQueue?.length);
  const playing = Boolean(state.isPlaying ?? state.playing);
  const error = typeof state.error === 'string' ? state.error : null;
  const favorites = useSelector((root: RootState) => root.library.favorites);
  const [showQueue, setShowQueue] = useState(false);
  const [showLyrics, setShowLyrics] = useState(false);
  const [lyrics, setLyrics] = useState<Lyric | null>(null);
  const [lyricsLoading, setLyricsLoading] = useState(false);
  const [lyricsUnavailable, setLyricsUnavailable] = useState(false);
  const lyricRequest = useRef<AbortController | null>(null);
  const lyricEpoch = useRef(0);
  const favorite = current
    ? favorites.some(
        item => item.id === current.id && item.source === current.source,
      )
    : false;
  useEffect(() => {
    lyricRequest.current?.abort();
    lyricEpoch.current += 1;
    setLyrics(null);
    setLyricsLoading(false);
    setLyricsUnavailable(false);
  }, [current?.id, current?.source]);
  const openLyrics = async () => {
    setShowLyrics(true);
    if (!current || lyrics || lyricsLoading) return;
    lyricRequest.current?.abort();
    const controller = new AbortController();
    lyricRequest.current = controller;
    const epoch = ++lyricEpoch.current;
    setLyricsLoading(true);
    setLyricsUnavailable(false);
    try {
      const response = await providerClient.getLyric(current.id, {
        signal: controller.signal,
      });
      if (epoch === lyricEpoch.current) setLyrics(response);
    } catch {
      if (epoch === lyricEpoch.current && !controller.signal.aborted)
        setLyricsUnavailable(true);
    } finally {
      if (epoch === lyricEpoch.current) setLyricsLoading(false);
    }
  };
  const toggle = () =>
    invoke(
      dispatch,
      playing ? ['pause', 'togglePlayback'] : ['play', 'togglePlayback'],
    );
  return (
    <View style={styles.page}>
      <View style={styles.top}>
        <Pressable
          accessibilityLabel="关闭播放器"
          onPress={() => navigation.goBack()}
          style={styles.iconButton}
        >
          <Text style={styles.icon}>⌄</Text>
        </Pressable>
        <Text
          accessibilityRole="header"
          numberOfLines={1}
          style={styles.source}
        >
          {current
            ? providerLabels[trackSource(current)] || trackSource(current)
            : '播放器'}
        </Text>
        <View style={styles.iconButton} />
      </View>
      {current ? (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.artFrame}>
            {artwork(current) ? (
              <Image
                source={{ uri: artwork(current) }}
                style={styles.artwork}
              />
            ) : (
              <Text style={styles.placeholder}>♪</Text>
            )}
          </View>
          <View style={styles.trackCopy}>
            <Text numberOfLines={2} style={text.display}>
              {trackTitle(current)}
            </Text>
            <Text numberOfLines={1} style={text.meta}>
              {trackArtist(current)}
            </Text>
          </View>
          {error ? (
            <View style={styles.error}>
              <Text style={styles.errorTitle}>这首歌暂时无法播放</Text>
              <Text style={text.meta}>
                请重试，或返回搜索结果选择其他歌曲。
              </Text>
            </View>
          ) : null}
          <Progress
            position={state.position ?? state.progress ?? 0}
            duration={
              state.duration ?? current.duration ?? current.durationMs ?? 0
            }
          />
          <View style={styles.controls}>
            <Pressable
              accessibilityLabel="上一首"
              onPress={() =>
                invoke(dispatch, ['prevTrack', 'previous', 'skipPrevious'])
              }
              style={styles.control}
            >
              <Text style={styles.controlIcon}>Ⅰ◀</Text>
            </Pressable>
            <Pressable
              accessibilityLabel={playing ? '暂停播放' : '继续播放'}
              onPress={toggle}
              style={[styles.control, styles.primaryControl]}
            >
              <Text style={styles.primaryIcon}>{playing ? 'Ⅱ' : '▶'}</Text>
            </Pressable>
            <Pressable
              accessibilityLabel="下一首"
              onPress={() =>
                invoke(dispatch, ['nextTrack', 'next', 'skipNext'])
              }
              style={styles.control}
            >
              <Text style={styles.controlIcon}>▶Ⅰ</Text>
            </Pressable>
          </View>
          <View style={styles.actions}>
            <Pressable
              accessibilityLabel="查看歌词"
              onPress={openLyrics}
              style={styles.action}
            >
              <Text style={styles.actionText}>歌词</Text>
            </Pressable>
            <Pressable
              accessibilityLabel={favorite ? '取消收藏' : '收藏当前歌曲'}
              onPress={() => dispatch(toggleFavorite(current as Track))}
              style={styles.action}
            >
              <Text style={styles.actionText}>
                {favorite ? '♥ 已收藏' : '♡ 收藏'}
              </Text>
            </Pressable>
            <Pressable
              accessibilityLabel={`打开播放队列，共${queue.length}首`}
              onPress={() => setShowQueue(true)}
              style={styles.action}
            >
              <Text style={styles.actionText}>队列 {queue.length}</Text>
            </Pressable>
          </View>
        </ScrollView>
      ) : (
        <View style={styles.noTrack}>
          <Text style={text.heading}>还没有正在播放的歌曲</Text>
          <Text style={text.meta}>从搜索结果中选择一首歌开始播放。</Text>
        </View>
      )}
      <QueueSheet
        queue={queue}
        visible={showQueue}
        onClose={() => setShowQueue(false)}
        onPlay={(track, index) => {
          const action = showingPlayNext
            ? (playerActions as any).playQueuedTrack?.(index)
            : (playerActions as any).playTrack?.(track);
          if (action) dispatch(action);
          setShowQueue(false);
        }}
      />
      <LyricsSheet
        current={current}
        lyrics={lyrics}
        loading={lyricsLoading}
        unavailable={lyricsUnavailable}
        visible={showLyrics}
        onClose={() => setShowLyrics(false)}
      />
    </View>
  );
}

function Progress({
  position,
  duration,
}: {
  position: number;
  duration: number;
}) {
  const safeDuration = duration > 1000 ? duration / 1000 : duration;
  const safePosition = position > 1000 ? position / 1000 : position;
  const fraction = safeDuration
    ? Math.min(1, Math.max(0, safePosition / safeDuration))
    : 0;
  return (
    <View style={styles.progressBlock}>
      <View
        accessibilityLabel={`播放进度 ${formatDuration(
          safePosition,
        )} / ${formatDuration(safeDuration)}`}
        style={styles.track}
      >
        <View style={[styles.progress, { width: `${fraction * 100}%` }]} />
      </View>
      <View style={styles.times}>
        <Text style={text.meta}>{formatDuration(safePosition)}</Text>
        <Text style={text.meta}>{formatDuration(safeDuration)}</Text>
      </View>
    </View>
  );
}

function QueueSheet({
  visible,
  onClose,
  queue,
  onPlay,
}: {
  visible: boolean;
  onClose: () => void;
  queue: PresentableTrack[];
  onPlay: (track: PresentableTrack, index: number) => void;
}) {
  return (
    <Sheet onClose={onClose} title="播放队列" visible={visible}>
      <ScrollView contentContainerStyle={styles.sheetContent}>
        {queue.length ? (
          queue.map((track, index) => (
            <Pressable
              accessibilityLabel={`播放队列第${index + 1}首，${trackTitle(
                track,
              )}`}
              key={`${track.id || 'track'}-${index}`}
              onPress={() => onPlay(track, index)}
              style={styles.queueRow}
            >
              <Text numberOfLines={1} style={text.body}>
                {trackTitle(track)}
              </Text>
              <Text numberOfLines={1} style={text.meta}>
                {trackArtist(track)} ·{' '}
                {providerLabels[trackSource(track)] || trackSource(track)}
              </Text>
            </Pressable>
          ))
        ) : (
          <Text style={text.meta}>播放队列为空</Text>
        )}
      </ScrollView>
    </Sheet>
  );
}

function LyricsSheet({
  visible,
  onClose,
  current,
  lyrics,
  loading,
  unavailable,
}: {
  visible: boolean;
  onClose: () => void;
  current?: PresentableTrack;
  lyrics: Lyric | null;
  loading: boolean;
  unavailable: boolean;
}) {
  const lines = toLines(lyrics?.text);
  const translationLines = toLines(lyrics?.translation);
  return (
    <Sheet onClose={onClose} title="歌词" visible={visible}>
      <ScrollView contentContainerStyle={styles.lyrics}>
        {current ? (
          <Text style={styles.lyricMeta}>
            {trackTitle(current)} ·{' '}
            {providerLabels[trackSource(current)] || trackSource(current)}
          </Text>
        ) : null}
        {loading ? (
          <Text style={text.meta}>正在加载歌词…</Text>
        ) : lines.length ? (
          <>
            {lines.map((line, index) => (
              <Text key={`${line}-${index}`} style={styles.lyricLine}>
                {line}
              </Text>
            ))}
            {translationLines.length ? (
              <View style={styles.translation}>
                <Text style={styles.translationTitle}>译文</Text>
                {translationLines.map((line, index) => (
                  <Text
                    key={`translation-${line}-${index}`}
                    style={styles.translationLine}
                  >
                    {line}
                  </Text>
                ))}
              </View>
            ) : null}
          </>
        ) : (
          <View style={styles.noLyrics}>
            <Text style={text.heading}>
              {unavailable ? '该来源暂无可用歌词' : '暂时没有歌词'}
            </Text>
            <Text style={text.meta}>
              歌词不可用不会影响播放。请稍后重试或选择其他歌曲。
            </Text>
          </View>
        )}
      </ScrollView>
    </Sheet>
  );
}

function toLines(value: any): string[] {
  if (Array.isArray(value))
    return value
      .map(line => (typeof line === 'string' ? line : line?.text))
      .filter(Boolean);
  if (typeof value === 'string')
    return value
      .split('\n')
      .map(line => line.replace(/^\[[^\]]+\]/, '').trim())
      .filter(Boolean);
  return [];
}
function invoke(dispatch: any, names: string[]) {
  for (const name of names) {
    const action = (playerActions as any)[name];
    if (action) {
      dispatch(action());
      return;
    }
  }
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  top: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
  },
  iconButton: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: { color: colors.text, fontSize: 32 },
  source: { ...text.body, color: colors.muted },
  content: {
    alignItems: 'center',
    gap: spacing.xl,
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  artFrame: {
    width: '100%',
    aspectRatio: 1,
    maxWidth: 360,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: colors.placeholder,
  },
  artwork: { width: '100%', height: '100%' },
  placeholder: { color: colors.muted, fontSize: 72 },
  trackCopy: { width: '100%', alignItems: 'center', gap: spacing.sm },
  progressBlock: { width: '100%', gap: spacing.xs },
  track: {
    height: 4,
    overflow: 'hidden',
    borderRadius: 2,
    backgroundColor: colors.border,
  },
  progress: { height: 4, backgroundColor: colors.accent },
  times: { flexDirection: 'row', justifyContent: 'space-between' },
  controls: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    alignItems: 'center',
  },
  control: {
    minWidth: 56,
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlIcon: { color: colors.text, fontSize: 20 },
  primaryControl: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.accent,
  },
  primaryIcon: { color: colors.text, fontSize: 28 },
  actions: { width: '100%', flexDirection: 'row', gap: spacing.md },
  action: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: colors.surface,
  },
  actionText: { ...text.body, color: colors.accent, fontWeight: '600' },
  error: {
    width: '100%',
    gap: spacing.xs,
    borderRadius: 12,
    padding: spacing.md,
    backgroundColor: '#321f25',
  },
  errorTitle: { ...text.body, color: '#ff9aa9', fontWeight: '600' },
  noTrack: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.xl,
  },
  sheetContent: { padding: spacing.md },
  queueRow: {
    minHeight: 64,
    gap: spacing.xs,
    justifyContent: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  lyrics: { gap: spacing.lg, alignItems: 'center', padding: spacing.lg },
  lyricMeta: text.meta,
  lyricLine: { ...text.body, textAlign: 'center' },
  translation: {
    width: '100%',
    gap: spacing.md,
    marginTop: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: spacing.lg,
  },
  translationTitle: { ...text.heading, textAlign: 'center' },
  translationLine: { ...text.meta, textAlign: 'center' },
  noLyrics: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xl,
  },
});
