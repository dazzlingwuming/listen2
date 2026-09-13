import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import type { PlayableTrack } from '../types/music';
import { colors, spacing, text } from '../theme';
import { providerLabels } from './SourceTabs';

export type PresentableTrack = PlayableTrack & {
  id?: string;
  title?: string;
  name?: string;
  artist?: string;
  artists?: string;
  album?: string;
  artwork?: string;
  artworkUrl?: string;
  cover?: string;
  sourceId?: string;
  source?: string;
  duration?: number;
  kind?: string;
};

export function trackTitle(track: PresentableTrack) {
  return track.title || track.name || '未知歌曲';
}
export function trackArtist(track: PresentableTrack) {
  return track.artist || track.artists || track.album || '未知艺人';
}
export function trackSource(track: PresentableTrack) {
  return track.sourceId || track.source || 'netease';
}
export function artwork(track: PresentableTrack) {
  return track.artwork || track.artworkUrl || track.cover;
}

export function TrackRow({
  track,
  onPress,
  onPlay,
  onDownload,
  downloadStatus,
}: {
  track: PresentableTrack;
  onPress?: () => void;
  onPlay?: () => void;
  onDownload?: () => void;
  downloadStatus?: string;
}) {
  const source = trackSource(track);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`查看${trackTitle(track)}详情`}
      onPress={onPress}
      style={styles.row}
    >
      {artwork(track) ? (
        <Image
          accessibilityIgnoresInvertColors
          source={{ uri: artwork(track) }}
          style={styles.artwork}
        />
      ) : (
        <View style={styles.artworkPlaceholder}>
          <Text style={styles.note}>音</Text>
        </View>
      )}
      <View style={styles.copy}>
        <Text numberOfLines={2} style={styles.title}>
          {trackTitle(track)}
        </Text>
        <Text numberOfLines={1} style={styles.meta}>
          {trackArtist(track)}
        </Text>
        <Text numberOfLines={1} style={styles.meta}>
          {providerLabels[source] || source} · {track.kind || '歌曲'}
          {track.duration || track.durationMs
            ? ` · ${formatDuration(track.duration || track.durationMs || 0)}`
            : ' · 时长未知'}
        </Text>
      </View>
      {onPlay ? (
        <Pressable
          accessibilityLabel={`播放${trackTitle(track)}`}
          accessibilityRole="button"
          hitSlop={8}
          onPress={onPlay}
          style={styles.play}
        >
          <Text style={styles.playText}>播放</Text>
        </Pressable>
      ) : (
        <Text style={styles.unavailable}>暂不可播</Text>
      )}
      {onDownload ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`下载${trackTitle(track)}`}
          hitSlop={8}
          onPress={event => {
            event.stopPropagation();
            onDownload();
          }}
          style={styles.play}
        >
          <Text style={styles.playText}>
            {downloadStatus === 'downloading'
              ? '下载中'
              : downloadStatus === 'ready'
              ? '已下载'
              : '下载'}
          </Text>
        </Pressable>
      ) : null}
    </Pressable>
  );
}

export function formatDuration(value: number) {
  const seconds = value > 1000 ? Math.floor(value / 1000) : Math.floor(value);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  row: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  artwork: {
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: colors.placeholder,
  },
  artworkPlaceholder: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: colors.placeholder,
  },
  note: { color: colors.muted, fontSize: 18 },
  copy: { flex: 1, minWidth: 0, gap: 1 },
  title: { ...text.body, fontWeight: '600' },
  meta: text.meta,
  play: {
    minWidth: 48,
    minHeight: 48,
    justifyContent: 'center',
    alignItems: 'center',
  },
  playText: { color: colors.accent, fontSize: 12, fontWeight: '600' },
  unavailable: { ...text.meta, maxWidth: 52, textAlign: 'center' },
});
