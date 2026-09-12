import React, { useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useDispatch, useSelector } from 'react-redux';
import type { RootState } from '../store';
import { ScreenLayout, sectionStyles } from './ScreenLayout';
import { colors, spacing, text } from '../theme';
import { createPlaylist } from '../store/librarySlice';

export function MyMusicScreen() {
  const navigation = useNavigation<any>();
  const dispatch = useDispatch();
  const [creating, setCreating] = useState(false);
  const [playlistTitle, setPlaylistTitle] = useState('');
  const favorites = useSelector((state: RootState) => state.library.favorites);
  const recentTracks = useSelector(
    (state: RootState) => state.library.recentTracks,
  );
  const playlists = useSelector((state: RootState) => state.library.playlists);
  const submitPlaylist = () => {
    const title = playlistTitle.trim();
    if (!title) return;
    dispatch(
      createPlaylist({
        id: `myplaylist_${Date.now().toString(36)}`,
        title,
      }),
    );
    setPlaylistTitle('');
    setCreating(false);
  };
  return (
    <ScreenLayout subtitle="你的收藏、最近播放和歌单" title="我的">
      <View style={[sectionStyles.card, styles.hero]}>
        <Text style={text.heading}>今天想听什么？</Text>
        <Text style={text.meta}>从你的歌单开始，或去发现新的音乐。</Text>
        <Pressable
          accessibilityLabel="去搜索音乐"
          onPress={() => navigation.navigate('Search')}
          style={sectionStyles.button}
        >
          <Text style={sectionStyles.buttonText}>搜索音乐</Text>
        </Pressable>
      </View>
      <View style={styles.grid}>
        <Pressable
          accessibilityLabel="打开我喜欢的音乐"
          onPress={() =>
            navigation.navigate('PlaylistDetail', {
              sourceId: 'local',
              title: '我喜欢的音乐',
              tracks: favorites,
              libraryCollection: 'favorites',
            })
          }
          style={styles.tile}
        >
          <Text style={styles.tileIcon}>♥</Text>
          <Text style={styles.tileTitle}>我喜欢的音乐</Text>
          <Text style={text.meta}>
            {favorites.length ? `${favorites.length} 首歌曲` : '还没有收藏歌曲'}
          </Text>
        </Pressable>
        <Pressable
          accessibilityLabel="打开最近播放"
          onPress={() =>
            navigation.navigate('PlaylistDetail', {
              sourceId: 'local',
              title: '最近播放',
              tracks: recentTracks,
              libraryCollection: 'recent',
            })
          }
          style={styles.tile}
        >
          <Text style={styles.tileIcon}>◷</Text>
          <Text style={styles.tileTitle}>最近播放</Text>
          <Text style={text.meta}>
            {recentTracks.length
              ? `${recentTracks.length} 条记录`
              : '还没有播放记录'}
          </Text>
        </Pressable>
      </View>
      <View style={sectionStyles.section}>
        <View style={styles.sectionTitle}>
          <Text style={text.heading}>我的歌单</Text>
          <Pressable
            accessibilityLabel="新建歌单"
            onPress={() => setCreating(true)}
            style={styles.add}
          >
            <Text style={styles.addText}>＋ 新建</Text>
          </Pressable>
        </View>
        {playlists.length ? (
          playlists.map(playlist => (
            <Pressable
              accessibilityLabel={`打开歌单${playlist.title}`}
              key={playlist.id}
              onPress={() =>
                navigation.navigate('PlaylistDetail', {
                  sourceId: 'local',
                  title: playlist.title,
                  tracks: playlist.tracks,
                  libraryPlaylistId: playlist.id,
                })
              }
              style={styles.playlist}
            >
              <View>
                <Text style={text.body}>{playlist.title}</Text>
                <Text style={text.meta}>{playlist.tracks.length} 首歌曲</Text>
              </View>
              <Text style={styles.arrow}>›</Text>
            </Pressable>
          ))
        ) : (
          <View style={sectionStyles.card}>
            <Text style={text.body}>还没有自建歌单</Text>
            <Text style={text.meta}>新建后，可以从歌曲详情加入。</Text>
          </View>
        )}
      </View>
      <Modal
        animationType="fade"
        onRequestClose={() => setCreating(false)}
        transparent
        visible={creating}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={text.heading}>新建歌单</Text>
            <TextInput
              accessibilityLabel="歌单名称"
              autoFocus
              maxLength={80}
              onChangeText={setPlaylistTitle}
              onSubmitEditing={submitPlaylist}
              placeholder="输入歌单名称"
              placeholderTextColor={colors.muted}
              returnKeyType="done"
              style={styles.input}
              value={playlistTitle}
            />
            <View style={styles.modalActions}>
              <Pressable
                onPress={() => setCreating(false)}
                style={sectionStyles.secondaryButton}
              >
                <Text style={sectionStyles.secondaryText}>取消</Text>
              </Pressable>
              <Pressable
                disabled={!playlistTitle.trim()}
                onPress={submitPlaylist}
                style={sectionStyles.button}
              >
                <Text style={sectionStyles.buttonText}>创建</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </ScreenLayout>
  );
}

const styles = StyleSheet.create({
  hero: { gap: spacing.md },
  grid: { gap: spacing.md },
  tile: {
    minHeight: 112,
    borderRadius: 16,
    padding: spacing.md,
    gap: spacing.xs,
    backgroundColor: colors.surface,
  },
  tileIcon: { color: colors.accent, fontSize: 24 },
  tileTitle: { ...text.body, fontWeight: '600' },
  sectionTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  add: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  addText: { ...text.body, color: colors.accent, fontWeight: '600' },
  playlist: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    borderRadius: 14,
    backgroundColor: colors.surface,
  },
  arrow: { color: colors.muted, fontSize: 28 },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
  modalCard: {
    gap: spacing.md,
    borderRadius: 18,
    padding: spacing.lg,
    backgroundColor: colors.surface,
  },
  input: {
    minHeight: 52,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    color: colors.text,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
  },
});
