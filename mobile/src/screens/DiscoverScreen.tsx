import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { ScreenLayout, sectionStyles } from './ScreenLayout';
import { colors, spacing, text } from '../theme';

const topics = ['每日推荐', '流行', '华语', '轻音乐'];

export function DiscoverScreen() {
  const navigation = useNavigation<any>();
  return (
    <ScreenLayout subtitle="从网易云音乐开始发现" title="发现">
      <Pressable
        accessibilityLabel="搜索歌曲、歌手或歌单"
        onPress={() => navigation.navigate('Search', { sourceId: 'netease' })}
        style={styles.search}
      >
        <Text style={styles.searchIcon}>⌕</Text>
        <Text style={styles.searchText}>搜索歌曲、歌手或歌单</Text>
      </Pressable>
      <View style={sectionStyles.section}>
        <Text style={text.heading}>为你推荐</Text>
        <View style={sectionStyles.card}>
          <Text style={text.body}>输入关键词，探索来自多个来源的音乐。</Text>
          <Text style={text.meta}>
            默认使用网易云音乐，也可以在搜索页切换来源。
          </Text>
        </View>
      </View>
      <View style={sectionStyles.section}>
        <Text style={text.heading}>热门分类</Text>
        <View style={styles.topics}>
          {topics.map(topic => (
            <Pressable
              accessibilityLabel={`搜索${topic}`}
              key={topic}
              onPress={() =>
                navigation.navigate('Search', {
                  sourceId: 'netease',
                  query: topic,
                })
              }
              style={styles.topic}
            >
              <Text style={styles.topicText}>{topic}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    </ScreenLayout>
  );
}

const styles = StyleSheet.create({
  search: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: 14,
    backgroundColor: colors.surface,
  },
  searchIcon: { color: colors.muted, fontSize: 24 },
  searchText: { ...text.body, color: colors.muted },
  topics: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  topic: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: 24,
    backgroundColor: colors.surface,
  },
  topicText: text.body,
});
