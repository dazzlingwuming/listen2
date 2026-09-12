import React from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useDispatch } from 'react-redux';
import { ScreenLayout, sectionStyles } from './ScreenLayout';
import { colors, spacing, text } from '../theme';
import { PROVIDER_CAPABILITIES } from '../api/client';
import { providerLabels, providerOrder } from '../components/SourceTabs';
import { clearRecent } from '../store/librarySlice';

export function SettingsScreen() {
  const dispatch = useDispatch();
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
      <View style={sectionStyles.card}>
        <Text style={text.heading}>Listen2 Android</Text>
        <Text style={text.meta}>版本 2.34.0-android</Text>
        <Text style={text.meta}>本机收藏、最近播放和播放队列会自动保存。</Text>
      </View>
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
});
