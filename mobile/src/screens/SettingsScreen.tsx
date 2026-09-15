import React, { useState } from 'react';
import {
  Alert,
  Image,
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
import { clearRecent, mutationReceived } from '../store/librarySlice';
import {
  BACKUP_LIMITS,
  backupErrorMessage,
  parseBackup,
  stringifyBackup,
  type BackupDocument,
  type BackupImportState,
} from '../backup/backupCodec';
import { createPortableBackupState } from '../localAudio/backup';
import { libraryClient, type LibraryBackupPreview } from '../library/libraryClient';
import {
  cancelDownload,
  clearDownloads,
  hydrateDownloads,
  removeDownload,
  retryDownload,
} from '../store/downloadSlice';
import { offlineDownloadErrorCopy } from '../offline/offlineErrorCopy';
import { bilibiliClient } from '../bilibili/client';
import type { BilibiliPublicState } from '../bilibili/types';
import { deepSeekClient } from '../deepseek/client';
import type { DeepSeekStatus } from '../deepseek/types';

export function SettingsScreen() {
  const dispatch = useDispatch<AppDispatch>();
  const library = useSelector((state: RootState) => state.library);
  const downloads = useSelector((state: RootState) => state.downloads);
  const [importVisible, setImportVisible] = useState(false);
  const [importText, setImportText] = useState('');
  const [importDocument, setImportDocument] = useState<BackupDocument | null>(
    null,
  );
  const [importPreview, setImportPreview] = useState<LibraryBackupPreview | null>(null);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [bilibili, setBilibili] = useState<BilibiliPublicState | null>(null);
  const [deepSeek, setDeepSeek] = useState<DeepSeekStatus | null>(null);
  const [deepSeekBusy, setDeepSeekBusy] = useState(false);
  const liveAttempt = React.useRef('');
  const pollTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = React.useRef(true);
  const clearAttempt = () => {
    liveAttempt.current = '';
    if (pollTimer.current) clearTimeout(pollTimer.current);
    pollTimer.current = null;
  };
  const refreshDeepSeek = React.useCallback(async () => {
    try {
      setDeepSeek(await deepSeekClient.status());
    } catch {
      setDeepSeek({
        secureStorageAvailable: false,
        hasApiKey: false,
        errorCode: 'SECURE_STORAGE_UNAVAILABLE',
      });
    }
  }, []);
  React.useEffect(() => {
    refreshDeepSeek().catch(() => undefined);
  }, [refreshDeepSeek]);
  const configureDeepSeek = async () => {
    setDeepSeekBusy(true);
    try {
      setDeepSeek(await deepSeekClient.configure());
    } catch {
      setDeepSeek({
        secureStorageAvailable: false,
        hasApiKey: false,
        errorCode: 'CONFIGURE_UNAVAILABLE',
      });
    } finally {
      setDeepSeekBusy(false);
    }
  };
  const testDeepSeek = async () => {
    setDeepSeekBusy(true);
    try {
      const result = await deepSeekClient.test();
      Alert.alert(
        result.status === 'ok' ? 'DeepSeek 连接成功' : 'DeepSeek 连接不可用',
        result.status === 'ok'
          ? '测试请求可能产生 API 费用。'
          : result.errorCode || '请检查安全存储和 API key。',
      );
    } catch {
      Alert.alert('DeepSeek 连接不可用', '请检查安全存储和 API key。');
    } finally {
      setDeepSeekBusy(false);
    }
  };
  const clearDeepSeek = async () => {
    setDeepSeekBusy(true);
    try {
      setDeepSeek(await deepSeekClient.delete());
    } catch {
      setDeepSeek({
        secureStorageAvailable: false,
        hasApiKey: false,
        errorCode: 'SECURE_STORAGE_UNAVAILABLE',
      });
    } finally {
      setDeepSeekBusy(false);
    }
  };
  const terminalState = (value: BilibiliPublicState) => ({
    ...value,
    attemptId: '',
    expiresAt: 0,
    qrPngDataUri: '',
  });
  const pollBilibili = async (attemptId: string, count = 0): Promise<void> => {
    if (!mounted.current || liveAttempt.current !== attemptId) return;
    if (count >= 90) {
      clearAttempt();
      setBilibili(current =>
        current
          ? terminalState({
              ...current,
              status: 'error',
              retryable: true,
              nextAction: 'begin',
              errorCode: 'REQUEST_TIMEOUT',
            })
          : current,
      );
      return;
    }
    try {
      const next = await bilibiliClient.qrPoll(attemptId);
      if (!mounted.current || liveAttempt.current !== attemptId) return;
      if (next.status === 'waiting' || next.status === 'scanned') {
        setBilibili(next);
        pollTimer.current = setTimeout(() => {
          void pollBilibili(attemptId, count + 1);
        }, 2000);
      } else {
        clearAttempt();
        setBilibili(terminalState(next));
      }
    } catch {
      if (liveAttempt.current === attemptId) {
        clearAttempt();
        setBilibili(current =>
          current
            ? terminalState({
                ...current,
                status: 'error',
                retryable: true,
                nextAction: 'begin',
                errorCode: 'PROVIDER_ERROR',
              })
            : current,
        );
      }
    }
  };
  const beginBilibili = async () => {
    clearAttempt();
    try {
      const next = await bilibiliClient.qrBegin();
      if (!mounted.current) return;
      setBilibili(next);
      if (next.attemptId) {
        liveAttempt.current = next.attemptId;
        void pollBilibili(next.attemptId);
      }
    } catch {
      setBilibili({
        status: 'error',
        attemptId: '',
        expiresAt: 0,
        qrPngDataUri: '',
        retryable: true,
        nextAction: 'begin',
        errorCode: 'PROVIDER_ERROR',
      });
    }
  };
  const cancelBilibili = async () => {
    const attemptId = liveAttempt.current;
    clearAttempt();
    if (!attemptId) return;
    try {
      setBilibili(terminalState(await bilibiliClient.qrCancel(attemptId)));
    } catch {
      setBilibili(current =>
        current
          ? terminalState({
              ...current,
              status: 'cancelled',
              retryable: false,
              nextAction: 'begin',
            })
          : current,
      );
    }
  };
  const logoutBilibili = async () => {
    clearAttempt();
    try {
      setBilibili(terminalState(await bilibiliClient.logout()));
    } catch {
      setBilibili({
        status: 'error',
        attemptId: '',
        expiresAt: 0,
        qrPngDataUri: '',
        retryable: true,
        nextAction: 'begin',
        errorCode: 'PROVIDER_ERROR',
      });
    }
  };
  React.useEffect(() => {
    dispatch(hydrateDownloads());
  }, [dispatch]);
  React.useEffect(() => {
    bilibiliClient
      .status()
      .then(value => {
        if (mounted.current) setBilibili(terminalState(value));
      })
      .catch(() => {
        if (mounted.current)
          setBilibili({
            status: 'unavailable',
            attemptId: '',
            expiresAt: 0,
            qrPngDataUri: '',
            retryable: false,
            nextAction: 'begin',
          });
      });
    return () => {
      mounted.current = false;
      const attemptId = liveAttempt.current;
      clearAttempt();
      if (attemptId)
        void bilibiliClient.qrCancel(attemptId).catch(() => undefined);
    };
  }, []);
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
    createPortableBackupState(library);

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

  const previewImport = async () => {
    try {
      const document = parseBackup(importText);
      const preview = await libraryClient.previewBackup(
        document,
        library.revision || 0,
        'merge',
      );
      setImportDocument(document);
      setImportPreview(preview);
      setBackupError(null);
    } catch (error) {
      setImportDocument(null);
      setImportPreview(null);
      setBackupError(backupErrorMessage(error));
    }
  };

  const applyImport = async (mode: 'merge' | 'overwrite') => {
    if (!importDocument || !importPreview) return;
    try {
      const preview = mode === 'merge'
        ? importPreview
        : await libraryClient.previewBackup(importDocument, library.revision || 0, mode);
      const receipt = await libraryClient.applyBackup(preview);
      dispatch(mutationReceived(receipt));
      if (receipt.status !== 'accepted') {
        setBackupError('备份预览已过期；本机数据没有修改，请重新预览。');
        return;
      }
      closeImport();
      Alert.alert(
        mode === 'merge' ? '合并导入完成' : '覆盖导入完成',
        mode === 'merge'
          ? `新增 ${preview.addedFavorites} 首收藏、${preview.addedPlaylists} 个歌单。`
          : '收藏和自建歌单已按备份恢复。',
      );
    } catch (error) {
      setBackupError(backupErrorMessage(error));
    }
  };

  const confirmOverwrite = () => {
    Alert.alert(
      '覆盖当前收藏、歌单和队列？',
      '这会移除本机现有的收藏和自建歌单；本地音频、历史、歌词、设置、缓存和账号不受影响。此操作需要再次确认。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '确认覆盖',
          style: 'destructive',
          onPress: () => {
            void applyImport('overwrite');
          },
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
      <View style={sectionStyles.section}>
        <Text style={text.heading}>DeepSeek 歌词翻译</Text>
        <View style={sectionStyles.card}>
          <Text style={text.body}>
            {deepSeek?.secureStorageAvailable === false
              ? '安全存储不可用'
              : deepSeek?.hasApiKey
              ? '已在本机安全存储中配置 API key'
              : '尚未配置 API key'}
          </Text>
          <Text style={text.meta}>
            设置和测试均使用原生安全页面；不会将 key 传入应用
            JavaScript。测试和翻译可能产生费用。
          </Text>
          <View style={styles.actions}>
            <Pressable
              accessibilityLabel="设置或替换 DeepSeek API key"
              disabled={deepSeekBusy}
              onPress={configureDeepSeek}
              style={styles.actionButton}
            >
              <Text style={styles.actionText}>
                {deepSeek?.hasApiKey ? '替换 API key' : '设置 API key'}
              </Text>
            </Pressable>
            <Pressable
              accessibilityLabel="测试 DeepSeek 连接"
              disabled={deepSeekBusy || !deepSeek?.hasApiKey}
              onPress={testDeepSeek}
              style={styles.actionButton}
            >
              <Text style={styles.actionText}>测试连接</Text>
            </Pressable>
            {deepSeek?.hasApiKey ? (
              <Pressable
                accessibilityLabel="清除 DeepSeek API key"
                disabled={deepSeekBusy}
                onPress={clearDeepSeek}
                style={styles.actionButton}
              >
                <Text style={styles.actionText}>清除 key</Text>
              </Pressable>
            ) : null}
          </View>
          {deepSeek?.errorCode ? (
            <Text style={styles.status}>状态：{deepSeek.errorCode}</Text>
          ) : null}
        </View>
      </View>
      <View style={sectionStyles.section}>
        <Text style={text.heading}>Bilibili 账号</Text>
        <View style={sectionStyles.card}>
          <Text style={text.meta}>
            {bilibili?.status === 'authenticated'
              ? `已登录${
                  bilibili.displayName ? `：${bilibili.displayName}` : ''
                }`
              : bilibili?.status === 'scanned'
              ? '已扫码，请在 Bilibili 中确认登录。'
              : bilibili?.status === 'waiting'
              ? '请使用 Bilibili 扫码登录。'
              : bilibili?.status === 'expired'
              ? '二维码已过期，请重新获取。'
              : bilibili?.status === 'unavailable'
              ? '本机暂不支持 Bilibili 安全登录。'
              : bilibili?.status === 'error'
              ? '登录暂未完成，请重试。'
              : '可选择扫码登录以使用账号可用的音质。'}
          </Text>
          {bilibili?.qrPngDataUri ? (
            <Image
              accessibilityLabel="Bilibili 登录二维码"
              source={{ uri: bilibili.qrPngDataUri }}
              style={styles.qrCode}
            />
          ) : null}
          {bilibili?.status === 'authenticated' ? (
            <Pressable
              accessibilityLabel="退出 Bilibili 登录"
              onPress={logoutBilibili}
              style={sectionStyles.secondaryButton}
            >
              <Text style={sectionStyles.secondaryText}>退出登录</Text>
            </Pressable>
          ) : bilibili?.status === 'waiting' ||
            bilibili?.status === 'scanned' ? (
            <Pressable
              accessibilityLabel="取消 Bilibili 扫码登录"
              onPress={cancelBilibili}
              style={sectionStyles.secondaryButton}
            >
              <Text style={sectionStyles.secondaryText}>取消登录</Text>
            </Pressable>
          ) : (
            <Pressable
              accessibilityLabel="开始 Bilibili 扫码登录"
              disabled={bilibili?.status === 'unavailable'}
              onPress={beginBilibili}
              style={sectionStyles.button}
            >
              <Text style={sectionStyles.buttonText}>
                {bilibili?.retryable ? '重新获取二维码' : '扫码登录'}
              </Text>
            </Pressable>
          )}
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
            仅包含收藏和自建歌单。本地音频、播放队列、历史、歌词、设置、缓存和账号不会导出，也不会导出登录凭据或本地路径。
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
                  {importDocument?.favorites.length ?? 0} 首
                </Text>
                <Text style={text.meta}>
                  合并将新增 {importPreview.addedFavorites} 首收藏、
                  {importPreview.addedPlaylists}{' '}
                  个歌单；同内容歌单跳过，冲突歌单保留为新歌单。
                </Text>
                <View style={styles.previewActions}>
                  <Pressable
                    accessibilityLabel="合并导入备份"
                    onPress={() => {
                      void applyImport('merge');
                    }}
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
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  actionButton: {
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  actionText: { ...text.body, color: colors.accent, fontWeight: '600' },
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
  qrCode: {
    alignSelf: 'center',
    width: 192,
    height: 192,
    backgroundColor: '#ffffff',
  },
});
