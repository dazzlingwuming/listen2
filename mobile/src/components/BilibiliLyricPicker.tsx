import React, { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { BilibiliLyricCandidate } from '../bilibili/types';
import { colors, spacing, text } from '../theme';
import { Sheet } from './Sheet';

export function BilibiliLyricPicker({
  visible,
  candidates,
  loading,
  partial,
  error,
  onSearch,
  onSelect,
  onRestore,
  onClose,
}: {
  visible: boolean;
  candidates: readonly BilibiliLyricCandidate[];
  loading: boolean;
  partial: boolean;
  error: boolean;
  onSearch: (query: string) => void;
  onSelect: (candidate: BilibiliLyricCandidate) => void;
  onRestore: () => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  return (
    <Sheet onClose={onClose} title="选择歌词" visible={visible}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={text.meta}>
          仅搜索网易云音乐和 QQ 音乐的受控歌词候选。
        </Text>
        <View style={styles.searchRow}>
          <TextInput
            accessibilityLabel="搜索 Bilibili 歌词候选"
            maxLength={128}
            onChangeText={setQuery}
            placeholder="输入歌名或歌手"
            placeholderTextColor={colors.muted}
            style={styles.input}
            value={query}
          />
          <Pressable
            accessibilityLabel="搜索歌词候选"
            disabled={loading || !query.trim()}
            onPress={() => onSearch(query)}
            style={styles.button}
          >
            <Text style={styles.buttonText}>搜索</Text>
          </Pressable>
        </View>
        {loading ? <Text style={text.meta}>正在搜索歌词候选…</Text> : null}
        {partial ? (
          <Text style={styles.notice}>部分歌词来源暂不可用。</Text>
        ) : null}
        {error ? (
          <Text style={styles.notice}>歌词候选加载失败，可重试。</Text>
        ) : null}
        {candidates.map(candidate => (
          <Pressable
            accessibilityLabel={`选择${candidate.matchedProvider}歌词，${candidate.title}`}
            accessibilityRole="button"
            key={`${candidate.matchedProvider}:${candidate.id}`}
            onPress={() => onSelect(candidate)}
            style={styles.candidate}
          >
            <Text numberOfLines={1} style={text.body}>
              {candidate.title}
            </Text>
            <Text numberOfLines={1} style={text.meta}>
              {candidate.matchedProvider} · {candidate.artist}
              {candidate.album ? ` · ${candidate.album}` : ''} · 匹配{' '}
              {Math.round(candidate.matchScore * 100)}%
            </Text>
            {candidate.hasTranslation ? (
              <Text style={styles.badge}>含来源译文</Text>
            ) : null}
          </Pressable>
        ))}
        {!loading && !candidates.length ? (
          <Text style={text.meta}>没有可选择的歌词候选。</Text>
        ) : null}
        <Pressable
          accessibilityLabel="恢复自动歌词"
          onPress={onRestore}
          style={styles.restore}
        >
          <Text style={styles.buttonText}>恢复自动匹配</Text>
        </Pressable>
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md, padding: spacing.lg },
  searchRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  input: {
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    color: colors.text,
    flex: 1,
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  button: {
    alignItems: 'center',
    backgroundColor: colors.accent,
    borderRadius: 10,
    justifyContent: 'center',
    minHeight: 48,
    minWidth: 72,
    paddingHorizontal: spacing.md,
  },
  buttonText: { ...text.body, color: colors.text, fontWeight: '600' },
  candidate: {
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: spacing.xs,
    minHeight: 72,
    justifyContent: 'center',
  },
  badge: { color: colors.accent, fontSize: 12, fontWeight: '700' },
  notice: { color: '#ffbc70', fontSize: 13 },
  restore: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 48,
  },
});
