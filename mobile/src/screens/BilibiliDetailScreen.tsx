import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useDispatch, useSelector } from 'react-redux';
import { bilibiliClient } from '../bilibili/client';
import type { BilibiliVideoDetail } from '../bilibili/types';
import type { Track } from '../types/music';
import type { RootState } from '../store';
import * as playerActions from '../store/playerSlice';
import { playerErrorCopy } from '../player/playerErrorCopy';
import { ScreenLayout, sectionStyles } from './ScreenLayout';
import { colors, spacing, text } from '../theme';

export function BilibiliDetailScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const dispatch = useDispatch<any>();
  const bvid = typeof route.params?.bvid === 'string' ? route.params.bvid : '';
  const playerError = useSelector((root: RootState) =>
    typeof (root as any).player?.error === 'string'
      ? (root as any).player.error
      : null,
  );
  const [detail, setDetail] = useState<BilibiliVideoDetail | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(
    'loading',
  );
  const [reload, setReload] = useState(0);
  const [failedPart, setFailedPart] = useState<
    BilibiliVideoDetail['parts'][number] | null
  >(null);
  const epoch = useRef(0);
  useEffect(() => {
    const controller = new AbortController();
    const current = ++epoch.current;
    setStatus('loading');
    bilibiliClient
      .videoDetail(bvid, { signal: controller.signal })
      .then(value => {
        if (
          !controller.signal.aborted &&
          current === epoch.current &&
          value.bvid === bvid
        ) {
          setDetail(value);
          setStatus('ready');
        }
      })
      .catch(() => {
        if (!controller.signal.aborted && current === epoch.current)
          setStatus('error');
      });
    return () => {
      controller.abort();
      epoch.current += 1;
    };
  }, [bvid, reload]);
  const play = async (part: BilibiliVideoDetail['parts'][number]) => {
    if (!detail || detail.bvid !== bvid) return;
    if (failedPart) setFailedPart(null);
    const track: Track = {
      id: `bitrack_v_${bvid}-${part.cid}`,
      source: 'bilibili',
      title: `${detail.title} · ${part.title}`,
      artist: detail.owner || 'Bilibili',
      durationMs: part.durationMs,
    };
    const action = playerActions.playTracks([track]);
    const result = await dispatch(action);
    if (result === true) navigation.navigate('Player');
    else setFailedPart(part);
  };
  return (
    <ScreenLayout title="视频分段" subtitle={route.params?.title || 'Bilibili'}>
      {status === 'loading' ? (
        <View style={styles.state}>
          <ActivityIndicator color={colors.accent} />
          <Text style={text.meta}>正在加载视频分段…</Text>
        </View>
      ) : null}
      {status === 'error' ? (
        <View style={[sectionStyles.card, styles.state]}>
          <Text style={text.heading}>无法加载视频分段</Text>
          <Text style={text.meta}>请重试，或返回保留的搜索结果。</Text>
          <Pressable
            accessibilityLabel="重试加载视频分段"
            onPress={() => setReload(value => value + 1)}
            style={sectionStyles.button}
          >
            <Text style={sectionStyles.buttonText}>重试</Text>
          </Pressable>
          <Pressable
            accessibilityLabel="返回搜索结果"
            onPress={() => navigation.goBack()}
            style={sectionStyles.secondaryButton}
          >
            <Text style={sectionStyles.secondaryText}>返回搜索结果</Text>
          </Pressable>
        </View>
      ) : null}
      {status === 'ready' && detail ? (
        <View style={sectionStyles.section}>
          <Text style={text.heading}>{detail.title}</Text>
          <Text style={text.meta}>
            {detail.owner || 'Bilibili'} · 请选择要播放的分段
          </Text>
          {failedPart ? (
            <View accessibilityRole="alert" style={styles.failure}>
              <Text style={text.heading}>该分段暂时无法播放</Text>
              <Text style={text.meta}>
                {playerErrorCopy(playerError) || '请稍后重试，或选择其他分段。'}
              </Text>
              <Pressable
                accessibilityLabel={`重试播放${failedPart.title}`}
                onPress={() => play(failedPart)}
                style={sectionStyles.secondaryButton}
              >
                <Text style={sectionStyles.secondaryText}>重试播放</Text>
              </Pressable>
            </View>
          ) : null}
          {detail.parts.map(part => (
            <Pressable
              accessibilityLabel={`播放${part.title}`}
              key={`${part.page}:${part.cid}`}
              onPress={() => play(part)}
              style={styles.part}
            >
              <View style={styles.copy}>
                <Text style={text.body}>
                  P{part.page} · {part.title}
                </Text>
                <Text style={text.meta}>
                  {part.durationMs
                    ? `${Math.floor(part.durationMs / 60000)}:${String(
                        Math.floor(part.durationMs / 1000) % 60,
                      ).padStart(2, '0')}`
                    : '时长未知'}
                </Text>
              </View>
              <Text style={styles.play}>播放</Text>
              <Pressable
                accessibilityLabel={`打开${part.title}MV画面`}
                onPress={() =>
                  navigation.navigate('BilibiliMv', {
                    bvid,
                    cid: part.cid,
                    title: `${detail.title} · ${part.title}`,
                  })
                }
                style={styles.mv}
              >
                <Text style={styles.play}>MV</Text>
              </Pressable>
            </Pressable>
          ))}
        </View>
      ) : null}
    </ScreenLayout>
  );
}
const styles = StyleSheet.create({
  state: {
    minHeight: 144,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  part: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  copy: { flex: 1, gap: 2 },
  failure: {
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  play: {
    color: colors.accent,
    minWidth: 48,
    textAlign: 'center',
    fontWeight: '600',
  },
  mv: {
    minHeight: 48,
    minWidth: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
