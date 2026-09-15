import React, { useEffect, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { history } from '../history/history';
import { ScreenLayout, sectionStyles } from './ScreenLayout';
import { text } from '../theme';

export function HistoryScreen() {
  const [entries, setEntries] = useState<any[]>([]); const [status, setStatus] = useState('loading'); const [enabled, setEnabled] = useState(true);
  const load = async () => { setStatus('loading'); try { const [rows, pref] = await Promise.all([history.getHistory(), history.recordingEnabled()]); setEntries(Array.isArray((rows as any)?.data) ? (rows as any).data : []); setEnabled(Boolean((pref as any)?.data?.recordingEnabled ?? true)); setStatus('ready'); } catch { setStatus('error'); } };
  useEffect(() => { void load(); }, []);
  const clear = () => Alert.alert('清空听歌历史？此操作不可恢复。', undefined, [{ text: '取消', style: 'cancel' }, { text: '清空', style: 'destructive', onPress: () => { void history.clear().then(load); } }]);
  return <ScreenLayout title="听歌历史与年度回响" subtitle="只记录有效播放；关闭记录不会删除已有历史。">
    <View style={sectionStyles.card}><Pressable accessibilityLabel="切换听歌记录" onPress={() => { void history.setRecordingEnabled(!enabled).then(() => setEnabled(!enabled)); }} style={sectionStyles.button}><Text style={sectionStyles.buttonText}>{enabled ? '关闭未来记录' : '开启未来记录'}</Text></Pressable><Text style={text.meta}>关闭后仅停止未来记录，已有历史会保留。</Text></View>
    <View style={sectionStyles.section}><Text style={text.heading}>最近有效播放</Text>{status === 'loading' ? <Text style={text.meta}>正在载入…</Text> : status === 'error' ? <Pressable accessibilityLabel="重试历史加载" onPress={() => void load()}><Text style={text.body}>载入失败，点此重试</Text></Pressable> : entries.length ? entries.map(item => <View key={item.eventId} style={sectionStyles.card}><Text style={text.body}>{item.title}</Text><Text style={text.meta}>{item.artist} · {item.date}</Text></View>) : <Text style={text.meta}>还没有满足有效播放条件的听歌历史。</Text>}</View>
    <View style={sectionStyles.section}><Pressable accessibilityLabel="导出安全听歌历史" onPress={() => { void history.exportSafe(new Date().getFullYear()); }} style={sectionStyles.secondaryButton}><Text style={sectionStyles.secondaryText}>导出安全历史</Text></Pressable><Pressable accessibilityLabel="清空听歌历史" onPress={clear} style={sectionStyles.secondaryButton}><Text style={sectionStyles.secondaryText}>清空历史</Text></Pressable></View>
  </ScreenLayout>;
}
