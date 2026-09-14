import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useDispatch } from 'react-redux';
import { BilibiliMvView } from '../components/BilibiliMvView';
import { bilibiliMvClient } from '../bilibili/mvClient';
import type { BilibiliMvPublicState, BilibiliMvQualityId } from '../bilibili/types';
import { mvActions } from '../store/mvSlice';
import { colors, spacing, text } from '../theme';

const CODECS = ['avc1'] as const;
const safeBvid = (value: unknown) => typeof value === 'string' && /^BV[0-9A-Za-z]{6,32}$/.test(value) ? value : null;
const safeCid = (value: unknown) => typeof value === 'string' && /^[1-9][0-9]{0,17}$/.test(value) ? value : null;

/** Phone-only MV shell. Music remains on RNTP; the native view is always muted video. */
export function BilibiliMvScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const dispatch = useDispatch<any>();
  const bvid = safeBvid(route.params?.bvid);
  const cid = safeCid(route.params?.cid);
  const [mv, setMv] = useState<BilibiliMvPublicState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const epoch = useRef(0);
  const handleRef = useRef<string | null>(null);
  const open = (forceRefresh = false) => {
    if (!bvid || !cid) {
      setError('INVALID_REQUEST');
      return;
    }
    const current = ++epoch.current;
    setError(null);
    bilibiliMvClient
      .open({ bvid, cid, qualityId: 'auto', preferredCodecs: CODECS, forceRefresh })
      .then(value => {
        if (current !== epoch.current) return;
        setMv(value);
        handleRef.current = value.handle ?? null;
        if (value.handle) {
          dispatch(mvActions.setSnapshot({ bvid, cid, qualityId: value.qualityId, positionMs: value.positionMs, playIntent: value.playIntent }));
        }
      })
      .catch(value => {
        if (current === epoch.current) setError(value?.code || 'VIDEO_UNAVAILABLE');
      });
  };
  useEffect(() => {
    open();
    return () => {
      epoch.current += 1;
      const handle = handleRef.current;
      handleRef.current = null;
      if (handle) bilibiliMvClient.close(handle).catch(() => undefined);
      dispatch(mvActions.clearSnapshot());
    };
    // The screen identity is semantic and never changes after navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bvid, cid]);
  const close = () => {
    epoch.current += 1;
    const handle = handleRef.current;
    handleRef.current = null;
    dispatch(mvActions.clearSnapshot());
    if (handle) bilibiliMvClient.close(handle).catch(() => undefined);
    navigation.goBack();
  };
  const chooseQuality = (qualityId: BilibiliMvQualityId) => {
    if (!mv?.handle) return;
    bilibiliMvClient.selectQuality(mv.handle, qualityId).then(setMv).catch(value => setError(value?.code || 'VIDEO_UNAVAILABLE'));
  };
  const invoke = (operation: 'enterFullscreen' | 'exitFullscreen' | 'requestPip') => {
    if (!mv?.handle) return;
    bilibiliMvClient[operation](mv.handle).catch(value => setError(value?.code || 'VIDEO_UNAVAILABLE'));
  };
  return (
    <View style={styles.page}>
      <View style={styles.top}>
        <Pressable accessibilityLabel="关闭MV画面" onPress={close} style={styles.button}><Text style={styles.buttonText}>关闭</Text></Pressable>
        <Text accessibilityRole="header" numberOfLines={1} style={text.heading}>{route.params?.title || 'Bilibili MV'}</Text>
        <Pressable accessibilityLabel="进入画中画" disabled={!mv?.handle} onPress={() => invoke('requestPip')} style={styles.button}><Text style={styles.buttonText}>画中画</Text></Pressable>
      </View>
      <View style={styles.video}>
        {mv?.handle ? <BilibiliMvView handle={mv.handle} style={StyleSheet.absoluteFill} /> : <ActivityIndicator color={colors.accent} />}
      </View>
      {error ? <View style={styles.error}><Text style={text.heading}>视频画面暂不可用</Text><Text style={text.meta}>音频播放没有中断。</Text><Pressable accessibilityLabel="重试MV画面" onPress={() => open(true)} style={styles.button}><Text style={styles.buttonText}>重试画面</Text></Pressable></View> : null}
      <View style={styles.controls}>
        <Pressable accessibilityLabel="全屏播放MV" disabled={!mv?.handle} onPress={() => invoke('enterFullscreen')} style={styles.button}><Text style={styles.buttonText}>全屏</Text></Pressable>
        <Pressable accessibilityLabel="退出MV全屏" disabled={!mv?.handle} onPress={() => invoke('exitFullscreen')} style={styles.button}><Text style={styles.buttonText}>退出全屏</Text></Pressable>
      </View>
      <View style={styles.qualities}>
        {mv?.variants.map(variant => <Pressable accessibilityLabel={`选择${variant.label}画质`} key={variant.id} onPress={() => chooseQuality(variant.id)} style={[styles.button, mv.qualityId === variant.id && styles.selected]}><Text style={styles.buttonText}>{variant.label}</Text></Pressable>)}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background, padding: spacing.md, gap: spacing.md },
  top: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  video: { minHeight: 220, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  button: { minHeight: 48, minWidth: 48, paddingHorizontal: spacing.md, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: colors.surface },
  buttonText: { color: colors.accent, fontWeight: '600' },
  controls: { flexDirection: 'row', gap: spacing.sm },
  qualities: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  selected: { borderWidth: 1, borderColor: colors.accent },
  error: { gap: spacing.sm, padding: spacing.md, backgroundColor: colors.surface, borderRadius: 8 },
});
