import React, { useEffect, useState } from 'react';
import {
  Alert,
  Image,
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
import { hydrationSucceeded, mutationPending, mutationReceived } from '../store/librarySlice';
import { attachExplicitLrc, loadLocalArtwork, pickLocalAudio, removeLocalAudio, repairLocalAudio } from '../localAudio/picker';
import { libraryClient } from '../library/libraryClient';
import * as playerActions from '../store/playerSlice';

export function MyMusicScreen() {
  const navigation = useNavigation<any>();
  const dispatch = useDispatch<any>();
  const [creating, setCreating] = useState(false);
  const [playlistTitle, setPlaylistTitle] = useState('');
  const [localImportStatus, setLocalImportStatus] = useState<string | null>(
    null,
  );
  const [importingLocalAudio, setImportingLocalAudio] = useState(false);
  const [creatingRequest, setCreatingRequest] = useState(false);
  const [localActionRecordId, setLocalActionRecordId] = useState<string | null>(null);
  const favorites = useSelector((state: RootState) => state.library.favorites);
  const recentTracks = useSelector(
    (state: RootState) => state.library.recentTracks,
  );
  const playlists = useSelector((state: RootState) => state.library.playlists);
  const localTracks = useSelector(
    (state: RootState) => state.library.localTracks,
  );
  const library = useSelector((state: RootState) => state.library);
  const importAudio = async () => {
    if (importingLocalAudio) return;
    setImportingLocalAudio(true);
    setLocalImportStatus(null);
    const result = await pickLocalAudio();
    setImportingLocalAudio(false);
    if (result.status === 'cancelled') return;
    if (result.status === 'error') {
      setLocalImportStatus('无法取得长期访问权限，未导入任何音频。');
      return;
    }
    if (!result.imported) {
      setLocalImportStatus('未导入音频：请选择可长期访问的真实音频文件。');
      return;
    }
    try { dispatch(hydrationSucceeded(await libraryClient.getSnapshot())); } catch { setLocalImportStatus('已导入音频，但无法刷新本地列表；请返回后重试。'); return; }
    setLocalImportStatus(
      result.rejected
        ? `已导入 ${result.imported} 首，跳过 ${result.rejected} 个不可用或重复文件。`
        : `已导入 ${result.imported} 首本地音频。`,
    );
  };
  const chooseLyric = async (recordId: string) => {
    const status = await attachExplicitLrc(recordId);
    if (status === 'success') {
      try { dispatch(hydrationSucceeded(await libraryClient.getSnapshot())); setLocalImportStatus('歌词已附加到这首本地音频。'); } catch { setLocalImportStatus('歌词已附加；列表将在下次打开时刷新。'); }
    } else if (status !== 'cancelled') setLocalImportStatus('无法附加歌词，请选择 UTF-8 LRC 文件后重试。');
  };
  const refreshLocalLibrary = async () => {
    dispatch(hydrationSucceeded(await libraryClient.getSnapshot()));
  };
  const repairLocal = async (recordId: string) => {
    if (localActionRecordId) return;
    setLocalActionRecordId(recordId);
    const status = await repairLocalAudio(recordId);
    setLocalActionRecordId(null);
    if (status === 'cancelled') return;
    if (status !== 'repaired') {
      setLocalImportStatus(status === 'mismatch' ? '所选文件不是兼容的音频，保留原本地记录。' : '无法重新取得文件访问权限，保留原本地记录。');
      return;
    }
    try { await refreshLocalLibrary(); setLocalImportStatus('已重新连接本地音频。'); } catch { setLocalImportStatus('文件已重新连接；列表将在下次打开时刷新。'); }
  };
  const confirmRemoveLocal = (recordId: string) => {
    Alert.alert(
      '从本地音乐移除？只会移除 Listen2 记录，不会删除设备上的原文件。',
      undefined,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '移除', style: 'destructive', onPress: () => {
            void (async () => {
              if (localActionRecordId) return;
              setLocalActionRecordId(recordId);
              const status = await removeLocalAudio(recordId);
              setLocalActionRecordId(null);
              if (status !== 'repaired') {
                if (status !== 'cancelled') setLocalImportStatus('无法移除本地记录，已保留原记录。');
                return;
              }
              try { await refreshLocalLibrary(); setLocalImportStatus('已移除 Listen2 本地记录，设备原文件未被删除。'); } catch { setLocalImportStatus('已移除本地记录；列表将在下次打开时刷新。'); }
            })();
          },
        },
      ],
    );
  };
  const submitPlaylist = async () => {
    const title = playlistTitle.trim();
    if (!title || creatingRequest) return;
    const requestId = `create-${Date.now().toString(36)}`;
    setCreatingRequest(true);
    dispatch(mutationPending({ requestId }));
    try {
      const receipt = await libraryClient.applyMutation({ requestId, revision: library.revision || 0, kind: 'createPlaylist', payload: { playlistId: `myplaylist_${Date.now().toString(36)}`, title } });
      dispatch(mutationReceived(receipt));
      if (receipt.snapshot) {
        setPlaylistTitle('');
        setCreating(false);
      } else if (receipt.status === 'stale-revision') {
        dispatch(hydrationSucceeded(await libraryClient.getSnapshot()));
      }
    } finally { setCreatingRequest(false); }
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
        <Pressable accessibilityLabel="打开听歌历史与年度回响" onPress={() => navigation.navigate('History')} style={styles.tile}>
          <Text style={styles.tileIcon}>◷</Text><Text style={styles.tileTitle}>听歌历史与年度回响</Text><Text style={text.meta}>查看有效播放与年度统计</Text>
        </Pressable>
        <Pressable
          accessibilityLabel="打开本地音乐"
          onPress={() =>
            navigation.navigate('PlaylistDetail', {
              sourceId: 'local',
              title: '本地音乐',
              tracks: localTracks,
              libraryCollection: 'local',
            })
          }
          style={styles.tile}
        >
          <Text style={styles.tileIcon}>♫</Text>
          <Text style={styles.tileTitle}>本地音乐</Text>
          <Text style={text.meta}>
            {localTracks.length
              ? `${localTracks.length} 首已导入`
              : '从设备选择音频'}
          </Text>
        </Pressable>
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
        <Text style={text.heading}>本地音频</Text>
        <View style={sectionStyles.card}>
          <Text style={text.meta}>
            从系统文件选择器导入；音频不会复制到应用，也不会请求媒体库权限。
          </Text>
          <Pressable
            accessibilityLabel="导入本地音频"
            disabled={importingLocalAudio}
            onPress={importAudio}
            style={sectionStyles.button}
          >
            <Text style={sectionStyles.buttonText}>
              {importingLocalAudio ? '正在打开选择器…' : '导入本地音频'}
            </Text>
          </Pressable>
          {localImportStatus ? (
            <Text accessibilityRole="alert" style={text.meta}>
              {localImportStatus}
            </Text>
          ) : null}
          {localTracks.length ? (
            <View style={styles.localList}>
              {localTracks.map(track => (
                <View key={track.id} style={styles.localRow}>
                  {track.hasArtwork ? <LocalArtworkPreview recordId={track.id} /> : <View style={styles.artworkFallback}><Text style={styles.artworkNote}>♫</Text></View>}
                  <View style={styles.localCopy}>
                    <Text numberOfLines={1} style={text.body}>{track.title}</Text>
                    <Text numberOfLines={1} style={text.meta}>{track.artist}{track.album ? ` · ${track.album}` : ''}{track.lyricState === 'attached' ? ' · 已有歌词' : ''}{track.seekable === false ? ' · 仅顺序播放' : ''}</Text>
                    {track.accessStatus !== 'available' ? <Text accessibilityRole="alert" style={text.meta}>文件当前不可访问，请重新选择。</Text> : null}
                  </View>
                  {track.accessStatus === 'available' && track.capabilities?.includes('lyrics') ? <Pressable accessibilityLabel={`为${track.title}选择歌词`} onPress={() => { void chooseLyric(track.id); }} style={styles.localAction}>
                    <Text style={styles.localActionText}>歌词</Text>
                  </Pressable> : null}
                  {track.accessStatus === 'available' && track.capabilities?.includes('queue') ? <Pressable accessibilityLabel={`下一首播放${track.title}`} onPress={() => dispatch(playerActions.addNextTrack(track))} style={styles.localAction}>
                    <Text style={styles.localActionText}>下一首</Text>
                  </Pressable> : null}
                  {track.accessStatus !== 'available' ? <Pressable accessibilityLabel={`重新选择${track.title}`} disabled={localActionRecordId === track.id} onPress={() => { void repairLocal(track.id); }} style={styles.localAction}>
                    <Text style={styles.localActionText}>{localActionRecordId === track.id ? '处理中…' : '重新选择'}</Text>
                  </Pressable> : null}
                  <Pressable accessibilityLabel={`移除本地记录${track.title}`} disabled={localActionRecordId === track.id} onPress={() => confirmRemoveLocal(track.id)} style={styles.localAction}>
                    <Text style={styles.localActionText}>移除</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          ) : null}
        </View>
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
              onSubmitEditing={() => { void submitPlaylist(); }}
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
                onPress={() => { void submitPlaylist(); }}
                style={sectionStyles.button}
              >
                <Text style={sectionStyles.buttonText}>{creatingRequest ? '创建中…' : '创建'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </ScreenLayout>
  );
}

function LocalArtworkPreview({ recordId }: { recordId: string }) {
  const [uri, setUri] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void loadLocalArtwork(recordId).then(result => { if (active && result.status === 'success') setUri(result.data || null); });
    return () => { active = false; };
  }, [recordId]);
  return uri ? <Image accessibilityLabel="本地音频封面" source={{ uri }} style={styles.artwork} /> : <View style={styles.artworkFallback}><Text style={styles.artworkNote}>♫</Text></View>;
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
  localList: { marginTop: spacing.md, gap: spacing.xs },
  localRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  localCopy: { flex: 1, minWidth: 0 },
  artwork: { width: 40, height: 40, borderRadius: 6 },
  artworkFallback: { width: 40, height: 40, borderRadius: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.border },
  artworkNote: { color: colors.muted },
  localAction: { minHeight: 48, justifyContent: 'center', paddingHorizontal: spacing.sm },
  localActionText: { color: colors.accent, fontWeight: '600' },
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
