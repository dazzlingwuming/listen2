import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, Text, TextInput, View } from 'react-native';
import { ScreenLayout, sectionStyles } from './ScreenLayout';
import { colors, text } from '../theme';
import { offlineAudio, type CacheEntry, type CacheSnapshot } from '../offline/offlineAudio';
import { offlineDownloadErrorCopy } from '../offline/offlineErrorCopy';

export function filterCache(entries: CacheEntry[], query: string, owner: string, status: string) {
  const needle = query.trim().toLowerCase();
  return entries.filter(entry => (!needle || `${entry.title} ${entry.artist} ${entry.source}`.toLowerCase().includes(needle)) && (owner === 'all' || entry.owners.includes(owner as any)) && (status === 'all' || entry.status === status)).sort((a, b) => b.updatedAt - a.updatedAt || a.title.localeCompare(b.title));
}
export function CacheLibraryScreen() {
  const [snapshot, setSnapshot] = useState<CacheSnapshot>({ usedBytes: 0, reservedBytes: 0, quotaBytes: 2 * 1024 ** 3, entries: [] });
  const [query, setQuery] = useState(''); const [owner, setOwner] = useState('all'); const [status, setStatus] = useState('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const refresh = () => void offlineAudio.list().then(setSnapshot);
  useEffect(() => {
    refresh();
    return offlineAudio.subscribe(setSnapshot);
  }, []);
  const entries = useMemo(() => filterCache(snapshot.entries, query, owner, status), [snapshot.entries, query, owner, status]);
  const act = (action: 'cancel'|'retry'|'repair'|'remove'|'clearEligible', id?: string) => void offlineAudio.action(action, id).then(setSnapshot);
  const toggle = (entry: CacheEntry) => setSelected(current => {
    const next = new Set(current);
    if (next.has(entry.operationId)) next.delete(entry.operationId); else next.add(entry.operationId);
    return next;
  });
  const selectedEntries = entries.filter(entry => selected.has(entry.operationId));
  const bulkRemove = () => void Promise.all(selectedEntries.map(entry => offlineAudio.action('remove', entry.operationId)))
    .then(values => { setSnapshot(values[values.length - 1] || snapshot); setSelected(new Set()); });
  const bulkPromote = () => void Promise.all(selectedEntries.map(entry => offlineAudio.promote(entry.source, entry.trackId)))
    .then(values => { setSnapshot(values[values.length - 1] || snapshot); setSelected(new Set()); });
  return <ScreenLayout title="缓存与下载" subtitle={`已用 ${Math.floor(snapshot.usedBytes / 1024 / 1024)} MiB；预留 ${Math.floor(snapshot.reservedBytes / 1024 / 1024)} MiB`}>
    <View style={sectionStyles.card}><TextInput accessibilityLabel="搜索缓存" placeholder="搜索歌曲、艺人或来源" value={query} onChangeText={setQuery} style={{ color: colors.text }} />
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>{['all','temporary','playlist','explicit'].map(value => <Pressable key={value} accessibilityRole="button" onPress={() => setOwner(value)}><Text style={[text.meta, owner === value && { color: colors.accent }]}>{value}</Text></Pressable>)}</View>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>{['all','ready','failed','repair-required'].map(value => <Pressable key={value} accessibilityRole="button" onPress={() => setStatus(value)}><Text style={[text.meta, status === value && { color: colors.accent }]}>{value}</Text></Pressable>)}</View>
    </View>
    <Pressable accessibilityLabel="修复缓存目录" onPress={() => act('repair')} style={sectionStyles.secondaryButton}><Text style={sectionStyles.secondaryText}>检查并修复</Text></Pressable>
    <Pressable accessibilityLabel="清理可回收缓存" onPress={() => Alert.alert('清理可回收缓存？', '明确下载不会自动删除。', [{ text: '取消', style: 'cancel' }, { text: '清理', style: 'destructive', onPress: () => act('clearEligible') }])} style={sectionStyles.secondaryButton}><Text style={sectionStyles.secondaryText}>清理可回收缓存</Text></Pressable>
    {selectedEntries.length ? <View style={sectionStyles.card}><Text style={text.meta}>已选择 {selectedEntries.length} 项</Text><View style={{ flexDirection: 'row', gap: 12 }}><Pressable accessibilityLabel="批量永久下载缓存" onPress={bulkPromote}><Text style={text.meta}>批量永久下载</Text></Pressable><Pressable accessibilityLabel="批量删除缓存" onPress={() => Alert.alert('删除已选缓存？', '将按每条真实来源和缓存记录处理。', [{ text: '取消', style: 'cancel' }, { text: '删除', style: 'destructive', onPress: bulkRemove }])}><Text style={text.meta}>批量删除</Text></Pressable></View></View> : null}
    {entries.map(entry => <View key={entry.operationId} style={sectionStyles.card}><Pressable accessibilityLabel={`${selected.has(entry.operationId) ? '取消选择' : '选择'}${entry.title}`} onPress={() => toggle(entry)}><Text style={text.body}>{selected.has(entry.operationId) ? '✓ ' : ''}{entry.title}</Text></Pressable><Text style={text.meta}>{entry.artist} · {entry.owners.join('、') || '无 owner'} · {entry.status}</Text>{entry.errorCode ? <Text accessibilityRole="alert" style={text.meta}>{offlineDownloadErrorCopy(entry.errorCode)}</Text> : null}<View style={{ flexDirection: 'row', gap: 12 }}><Pressable accessibilityLabel={`永久下载${entry.title}`} onPress={() => void offlineAudio.promote(entry.source, entry.trackId).then(setSnapshot)}><Text style={text.meta}>永久下载</Text></Pressable><Pressable accessibilityLabel={`重试或修复${entry.title}`} onPress={() => act(entry.status === 'ready' ? 'repair' : 'retry', entry.operationId)}><Text style={text.meta}>重试/修复</Text></Pressable><Pressable accessibilityLabel={`删除${entry.title}`} onPress={() => Alert.alert('删除此缓存？', '共享或明确下载内容仅在对应 owner 被移除后才删除。', [{ text: '取消', style: 'cancel' }, { text: '删除', style: 'destructive', onPress: () => act('remove', entry.operationId) }])}><Text style={text.meta}>删除</Text></Pressable></View></View>)}
  </ScreenLayout>;
}
