import React, { useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
import { ScreenLayout, sectionStyles } from './ScreenLayout';
import { colors, spacing, text } from '../theme';
import { PROVIDER_CAPABILITIES } from '../api/client';
import { providerLabels, providerOrder } from '../components/SourceTabs';
import type { AppDispatch, RootState } from '../store';
import * as playerActions from '../store/playerSlice';
import { clearRecent, restoreLibrary } from '../store/librarySlice';
import {
  BACKUP_LIMITS,
  backupErrorMessage,
  parseBackup,
  planImport,
  stringifyBackup,
  type BackupDocument,
  type BackupImportState,
  type ImportMode,
  type ImportPlan,
} from '../backup/backupCodec';
import { createPortableBackupState } from '../localAudio/backup';
import {
  cancelDownload,
  clearDownloads,
  hydrateDownloads,
  removeDownload,
  retryDownload,
} from '../store/downloadSlice';
import { offlineDownloadErrorCopy } from '../offline/offlineErrorCopy';

export function SettingsScreen() {
  const dispatch = useDispatch<AppDispatch>();
  const library = useSelector((state: RootState) => state.library);
  const player = useSelector((state: RootState) => state.player);
  const downloads = useSelector((state: RootState) => state.downloads);
  const [importVisible, setImportVisible] = useState(false);
  const [importText, setImportText] = useState('');
  const [importDocument, setImportDocument] = useState<BackupDocument | null>(
    null,
  );
  const [importPreview, setImportPreview] = useState<
    ImportPlan['summary'] | null
  >(null);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  React.useEffect(() => {
    dispatch(hydrateDownloads());
  }, [dispatch]);
  const confirmClearDownloads = () =>
    Alert.alert('清空全部下载？', '已下载的离线媒体将从本机移除。', [
      { text: '取消', style: 'cancel' },
      {
        text: '确认清空',
        style: 'destructive',
        onPress: () => dispatch(clearDownloads()),
      },
    ]);

  const currentBackupState = (): BackupImportState =>
    createPortableBackupState(library, player);

  const resetImport = () => {
    setImportText('');
    setImportDocument(null);
    setImportPreview(null);
    setBackupError(null);
  };

  const openImport = () => {
    resetImport();
    setImportVisible(true);
  };

  const closeImport = () => {
    setImportVisible(false);
    resetImport();
  };

  const shareBackup = async () => {
    if (sharing) return;
    setSharing(true);
    try {
      const message = stringifyBackup(currentBackupState());
      await Share.share({
        title: 'Listen2 手机备份',
        message,
      });
    } catch (error) {
      Alert.alert('导出未完成', backupErrorMessage(error));
    } finally {
      setSharing(false);
    }
  };

  const previewImport = () => {
    try {
      const document = parseBackup(importText);
      const plan = planImport(currentBackupState(), document, 'merge');
      setImportDocument(document);
      setImportPreview(plan.summary);
      setBackupError(null);
    } catch (error) {
      setImportDocument(null);
      setImportPreview(null);
      setBackupError(backupErrorMessage(error));
    }
  };

  const applyImport = (mode: ImportMode) => {
    if (!importDocument) return;
    try {
      const plan = planImport(currentBackupState(), importDocument, mode);
      dispatch(
        restoreLibrary({
          favorites: plan.favorites,
          playlists: plan.playlists,
        }),
      );
      applyQueuePlan(dispatch, plan);
      closeImport();
      Alert.alert(
        mode === 'merge' ? '合并导入完成' : '覆盖导入完成',
        mode === 'merge'
          ? `新增 ${plan.summary.addedFavorites} 首收藏、${plan.summary.addedPlaylists} 个歌单。`
          : '收藏、歌单和播放队列已按备份恢复。',
      );
    } catch (error) {
      setBackupError(backupErrorMessage(error));
    }
  };

  const confirmOverwrite = () => {
    Alert.alert(
      '覆盖当前收藏、歌单和队列？',
      '这会移除本机现有的收藏和自建歌单；最近播放记录不受影响。此操作需要再次确认。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '确认覆盖',
          style: 'destructive',
          onPress: () => applyImport('overwrite'),
        },
      ],
    );
  };

  const confirmClearRecent = () =>
    Alert.alert('清空最近播放？', '收藏和播放队列不会受到影响。', [
      { text: '取消', style: 'cancel' },
      {
        text: '清空',
        style: 'destructive',
        onPress: () => dispatch(clearRecent()),
      },
    ]);

  return (
    <ScreenLayout subtitle="能力与本地数据" title="设置">
      <View style={sectionStyles.section}>
        <Text style={text.heading}>来源状态</Text>
        <View style={styles.list}>
          {providerOrder.map(source => {
            const capability = PROVIDER_CAPABILITIES[source];
            const status = [
              capability.search ? '搜索' : null,
              capability.playback ? '播放' : null,
              capability.lyric ? '歌词' : null,
              capability.playlist ? '歌单' : null,
            ]
              .filter(Boolean)
              .join(' · ');
            return (
              <View key={source} style={styles.row}>
                <Text style={text.body}>{providerLabels[source]}</Text>
                <Text style={styles.status}>{status || '暂不可用'}</Text>
              </View>
            );
          })}
        </View>
      </View>
      <Pressable
        accessibilityLabel="清空最近播放"
        onPress={confirmClearRecent}
        style={sectionStyles.secondaryButton}
      >
        <Text style={sectionStyles.secondaryText}>清空最近播放</Text>
      </Pressable>
      <View style={sectionStyles.section}>
        <Text style={text.heading}>下载管理</Text>
        <View style={sectionStyles.card}>
          <Text style={text.meta}>
            已用 {Math.floor(downloads.usedBytes / 1024 / 1024)} MiB /{' '}
            {Math.floor(downloads.quotaBytes / 1024 / 1024)} MiB
          </Text>
          {downloads.entries.length === 0 ? (
            <Text style={text.meta}>暂无离线下载。</Text>
          ) : (
            downloads.entries.map(entry => {
              const failureCopy = offlineDownloadErrorCopy(entry.errorCode);
              return (
                <View
                  key={`${entry.source}:${entry.trackId}`}
                  style={styles.row}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={text.body}>{entry.title}</Text>
                    <Text style={text.meta}>
                      {entry.artist} · {entry.source} ·{' '}
                      {entry.status === 'ready'
                        ? '已下载'
                        : entry.status === 'downloading'
                        ? '下载中'
                        : entry.status === 'queued'
                        ? '等待下载'
                        : entry.status === 'cancelled'
                        ? '已取消'
                        : '下载失败'}{' '}
                      {entry.totalBytes > 0
                        ? `${Math.min(
                            100,
                            Math.floor(
                              (entry.downloadedBytes / entry.totalBytes) * 100,
                            ),
                          )}%`
                        : ''}
                    </Text>
                    {failureCopy ? (
                      <Text style={text.meta}>{failureCopy}</Text>
                    ) : null}
                  </View>
                  {entry.status === 'queued' ||
                  entry.status === 'downloading' ? (
                    <Pressable
                      accessibilityLabel={`取消下载${entry.title}`}
                      onPress={() =>
                        dispatch(cancelDownload(entry.operationId))
                      }
                    >
                      <Text style={styles.status}>取消</Text>
                    </Pressable>
                  ) : entry.status === 'failed' ||
                    entry.status === 'cancelled' ? (
                    <Pressable
                      accessibilityLabel={`重试下载${entry.title}`}
                      onPress={() => dispatch(retryDownload(entry))}
                    >
                      <Text style={styles.status}>重试</Text>
                    </Pressable>
                  ) : (
                    <Pressable
                      accessibilityLabel={`移除下载${entry.title}`}
                      onPress={() => dispatch(removeDownload(entry))}
                    >
                      <Text style={styles.status}>移除</Text>
                    </Pressable>
                  )}
                </View>
              );
            })
          )}
          {downloads.entries.length ? (
            <Pressable
              accessibilityLabel="清空全部下载"
              onPress={confirmClearDownloads}
              style={sectionStyles.secondaryButton}
            >
              <Text style={sectionStyles.secondaryText}>清空全部下载</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
      <View style={sectionStyles.section}>
        <Text style={text.heading}>数据备份</Text>
        <View style={sectionStyles.card}>
          <Text style={text.meta}>
            仅包含收藏、自建歌单和当前播放队列。本地音频不会导出，也不会导出登录凭据、本地路径、歌词或设置。
          </Text>
          <View style={styles.backupActions}>
            <Pressable
              accessibilityLabel="分享 JSON 备份"
              disabled={sharing}
              onPress={shareBackup}
              style={sectionStyles.button}
            >
              <Text style={sectionStyles.buttonText}>
                {sharing ? '正在准备…' : '分享 JSON 备份'}
              </Text>
            </Pressable>
            <Pressable
              accessibilityLabel="导入 JSON 备份文本"
              onPress={openImport}
              style={sectionStyles.secondaryButton}
            >
              <Text style={sectionStyles.secondaryText}>粘贴 JSON 备份</Text>
            </Pressable>
          </View>
        </View>
      </View>
      <View style={sectionStyles.card}>
        <Text style={text.heading}>Listen2 Android</Text>
        <Text style={text.meta}>版本 2.34.0-android</Text>
        <Text style={text.meta}>本机收藏、最近播放和播放队列会自动保存。</Text>
      </View>
      <Modal
        animationType="slide"
        onRequestClose={closeImport}
        transparent
        visible={importVisible}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={text.heading}>导入 JSON 备份</Text>
              <Pressable
                accessibilityLabel="关闭备份导入"
                onPress={closeImport}
              >
                <Text style={styles.closeText}>关闭</Text>
              </Pressable>
            </View>
            <Text style={text.meta}>
              从分享内容或其他设备复制
              JSON，粘贴到这里后先预览，再选择合并。覆盖需要二次确认。
            </Text>
            <TextInput
              accessibilityLabel="JSON 备份文本"
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={BACKUP_LIMITS.maxBytes}
              multiline
              onChangeText={value => {
                setImportText(value);
                setImportDocument(null);
                setImportPreview(null);
                setBackupError(null);
              }}
              placeholder="粘贴 listen2-mobile-backup JSON"
              placeholderTextColor={colors.muted}
              style={styles.backupInput}
              textAlignVertical="top"
              value={importText}
            />
            <Pressable
              accessibilityLabel="预览备份内容"
              disabled={!importText.trim()}
              onPress={previewImport}
              style={sectionStyles.button}
            >
              <Text style={sectionStyles.buttonText}>预览备份</Text>
            </Pressable>
            {backupError ? (
              <Text accessibilityRole="alert" style={styles.error}>
                {backupError}
              </Text>
            ) : null}
            {importPreview ? (
              <ScrollView
                contentContainerStyle={styles.preview}
                keyboardShouldPersistTaps="handled"
              >
                <Text style={text.heading}>导入预览</Text>
                <Text style={text.meta}>
                  备份 v{importDocument?.version} · 歌单{' '}
                  {importDocument?.playlists.length ?? 0} 个 · 收藏{' '}
                  {importDocument?.favorites.length ?? 0} 首 · 队列{' '}
                  {importDocument?.queue.length ?? 0} 首
                </Text>
                <Text style={text.meta}>
                  合并将新增 {importPreview.addedFavorites} 首收藏、
                  {importPreview.addedPlaylists}{' '}
                  个歌单；同内容歌单跳过，冲突歌单保留为新歌单。
                </Text>
                <View style={styles.previewActions}>
                  <Pressable
                    accessibilityLabel="合并导入备份"
                    onPress={() => applyImport('merge')}
                    style={sectionStyles.button}
                  >
                    <Text style={sectionStyles.buttonText}>合并导入</Text>
                  </Pressable>
                  <Pressable
                    accessibilityLabel="覆盖导入备份"
                    onPress={confirmOverwrite}
                    style={sectionStyles.secondaryButton}
                  >
                    <Text style={sectionStyles.secondaryText}>覆盖导入…</Text>
                  </Pressable>
                </View>
              </ScrollView>
            ) : null}
          </View>
        </View>
      </Modal>
    </ScreenLayout>
  );
}

function applyQueuePlan(dispatch: AppDispatch, plan: ImportPlan) {
  if (plan.mode === 'overwrite') {
    if (plan.queueMode === 'playlist') {
      dispatch(playerActions.replacePlaylist({ tracks: plan.queue }));
      dispatch(playerActions.clearPlayNextQueue());
    } else {
      dispatch(playerActions.clearPlayNextQueue());
      plan.queue.forEach(track => dispatch(playerActions.enqueueNext(track)));
    }
    return;
  }
  if (plan.queueMode === 'playlist') {
    plan.queueToAppend.forEach(track =>
      dispatch(playerActions.appendPlaylistTrack(track)),
    );
  } else {
    plan.queueToAppend.forEach(track =>
      dispatch(playerActions.enqueueNext(track)),
    );
  }
}

const styles = StyleSheet.create({
  list: {
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  row: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  status: { ...text.meta, flex: 1, textAlign: 'right' },
  backupActions: { gap: spacing.sm, marginTop: spacing.md },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
  modalCard: {
    maxHeight: '92%',
    gap: spacing.md,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: spacing.lg,
    backgroundColor: colors.surface,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  closeText: { ...text.body, color: colors.accent },
  backupInput: {
    minHeight: 160,
    maxHeight: 280,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    color: colors.text,
    backgroundColor: colors.background,
    fontFamily: 'monospace',
    fontSize: 12,
    lineHeight: 17,
  },
  error: { ...text.meta, color: colors.danger },
  preview: { gap: spacing.sm, paddingBottom: spacing.sm },
  previewActions: { gap: spacing.sm },
});
