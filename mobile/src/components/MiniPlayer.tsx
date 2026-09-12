import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigation } from '@react-navigation/native';
import * as playerActions from '../store/playerSlice';
import type { RootState } from '../store';
import { colors, shadow, spacing, text } from '../theme';
import {
  artwork,
  trackArtist,
  trackSource,
  trackTitle,
  type PresentableTrack,
} from './TrackRow';
import { providerLabels } from './SourceTabs';

export function MiniPlayer() {
  const navigation = useNavigation<any>();
  const dispatch = useDispatch<any>();
  const player = useSelector((state: RootState) => (state as any).player || {});
  const current = (player.currentTrack || player.current || player.track) as
    | PresentableTrack
    | undefined;
  const playing = Boolean(player.isPlaying ?? player.playing);
  if (!current) return null;
  const toggle = () => {
    const action =
      (playerActions as any).togglePlayback ||
      (playing ? (playerActions as any).pause : (playerActions as any).play);
    if (action) dispatch(action());
  };
  return (
    <View
      accessibilityLabel={`迷你播放器，${trackTitle(current)}，${
        playing ? '正在播放' : '已暂停'
      }`}
      style={styles.bar}
    >
      <Pressable
        accessibilityLabel="打开播放器"
        onPress={() => navigation.navigate('Player')}
        style={styles.info}
      >
        {artwork(current) ? (
          <Image source={{ uri: artwork(current) }} style={styles.artwork} />
        ) : (
          <View style={styles.artworkFallback}>
            <Text style={styles.fallback}>♪</Text>
          </View>
        )}
        <View style={styles.copy}>
          <Text numberOfLines={1} style={styles.title}>
            {trackTitle(current)}
          </Text>
          <Text numberOfLines={1} style={styles.meta}>
            {trackArtist(current)} ·{' '}
            {providerLabels[trackSource(current)] || trackSource(current)}
          </Text>
        </View>
      </Pressable>
      <Pressable
        accessibilityLabel={playing ? '暂停播放' : '继续播放'}
        accessibilityRole="button"
        onPress={toggle}
        style={styles.control}
      >
        <Text style={styles.controlText}>{playing ? 'Ⅱ' : '▶'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    height: 64,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: spacing.md,
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    ...shadow,
  },
  info: {
    flex: 1,
    minWidth: 0,
    height: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  artwork: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: colors.placeholder,
  },
  artworkFallback: {
    width: 44,
    height: 44,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.placeholder,
  },
  fallback: { color: colors.muted, fontSize: 18 },
  copy: { flex: 1, minWidth: 0 },
  title: { ...text.body, fontWeight: '600' },
  meta: text.meta,
  control: {
    minWidth: 64,
    minHeight: 64,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlText: { color: colors.text, fontSize: 22 },
});
