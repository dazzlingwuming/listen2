import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { SourceId } from '../types/music';
import { colors, spacing, text } from '../theme';

export const providerLabels: Record<string, string> = {
  netease: '网易云音乐',
  kugou: '酷狗音乐',
  kuwo: '酷我音乐',
  qq: 'QQ音乐',
  bilibili: '哔哩哔哩',
  local: '本地音乐库',
};

export const providerOrder: SourceId[] = [
  'netease' as SourceId,
  'kugou' as SourceId,
  'kuwo' as SourceId,
  'qq' as SourceId,
  'bilibili' as SourceId,
];

type Props = { value: SourceId; onChange: (source: SourceId) => void };

export function SourceTabs({ value, onChange }: Props) {
  return (
    <View>
      <Text accessibilityRole="header" style={styles.label}>
        选择音乐来源
      </Text>
      <ScrollView
        accessibilityRole="tablist"
        contentContainerStyle={styles.list}
        horizontal
        showsHorizontalScrollIndicator={false}
      >
        {providerOrder.map(source => {
          const selected = value === source;
          return (
            <Pressable
              accessibilityHint={`切换到${providerLabels[source]}搜索结果`}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              key={source}
              onPress={() => onChange(source)}
              style={[styles.tab, selected && styles.selected]}
            >
              <Text style={[styles.tabText, selected && styles.selectedText]}>
                {providerLabels[source]}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { ...text.meta, marginBottom: spacing.sm },
  list: { gap: spacing.sm, paddingRight: spacing.md },
  tab: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  selected: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  tabText: { ...text.body, fontSize: 12, color: colors.muted },
  selectedText: { color: colors.text, fontWeight: '600' },
});
