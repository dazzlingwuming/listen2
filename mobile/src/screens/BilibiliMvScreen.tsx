import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useDispatch, useSelector } from 'react-redux';
import { BilibiliMvView } from '../components/BilibiliMvView';
import { bilibiliMvClient } from '../bilibili/mvClient';
import type {
  BilibiliMvPublicState,
  BilibiliMvQualityId,
} from '../bilibili/types';
import { mvActions } from '../store/mvSlice';
import type { RootState } from '../store';
import { colors, spacing, text } from '../theme';

const CODECS = ['avc1'] as const;
const safeBvid = (value: unknown) =>
  typeof value === 'string' && /^BV[0-9A-Za-z]{6,32}$/.test(value)
    ? value
    : null;
const safeCid = (value: unknown) =>
  typeof value === 'string' && /^[1-9][0-9]{0,17}$/.test(value) ? value : null;

/** Phone-only MV shell. Music remains on RNTP; the native view is always muted video. */
export function BilibiliMvScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const dispatch = useDispatch<any>();
  const player = useSelector((root: RootState) => root.player);
  const playerTrackIdentityRef = useRef<string | null>(null);
  playerTrackIdentityRef.current =
    player.nowPlaying?.source === 'bilibili' ? player.nowPlaying.id : null;
  const bvid = safeBvid(route.params?.bvid);
  const cid = safeCid(route.params?.cid);
  const [mv, setMv] = useState<BilibiliMvPublicState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inPip, setInPip] = useState(false);
  const epoch = useRef(0);
  const mounted = useRef(false);
  const handleRef = useRef<string | null>(null);
  const syncEpoch = useRef(0);
  const mismatchPauseHandle = useRef<string | null>(null);
  const releaseStale = (value: BilibiliMvPublicState) => {
    if (value.handle)
      bilibiliMvClient.close(value.handle).catch(() => undefined);
  };
  const applyMv = useCallback((value: BilibiliMvPublicState) => {
    if (!value.handle) throw new Error('VIDEO_UNAVAILABLE');
    handleRef.current = value.handle;
    setMv(value);
    if (bvid && cid)
      dispatch(
        mvActions.setSnapshot({
          bvid,
          cid,
          qualityId: value.qualityId,
          positionMs: value.positionMs,
          playIntent: value.playIntent,
        }),
      );
  }, [bvid, cid, dispatch]);
  const open = (forceRefresh = false) => {
    if (!bvid || !cid) {
      setError('INVALID_REQUEST');
      return;
    }
    const current = ++epoch.current;
    const restore = route.params?.restore;
    setError(null);
    bilibiliMvClient
      .open({
        bvid,
        cid,
        qualityId: restore?.qualityId || 'auto',
        preferredCodecs: CODECS,
        forceRefresh,
      })
      .then(value => {
        if (!mounted.current || current !== epoch.current) {
          releaseStale(value);
          return;
        }
        applyMv(value);
        if (
          restore &&
          value.handle &&
          playerTrackIdentityRef.current === `bitrack_v_${bvid}-${cid}`
        )
          return bilibiliMvClient
            .sync(
              value.handle,
              value.bvid || bvid,
              value.cid || cid,
              restore.positionMs,
              restore.playIntent,
            )
            .then(synced => {
              if (mounted.current && current === epoch.current) applyMv(synced);
              else releaseStale(synced);
            });
      })
      .catch(value => {
        if (mounted.current && current === epoch.current)
          setError(value?.code || 'VIDEO_UNAVAILABLE');
      });
  };
  useEffect(() => {
    mounted.current = true;
    if (route.params?.restore) open();
    else if (bvid && cid) {
      const current = ++epoch.current;
      bilibiliMvClient
        .restore(bvid, cid)
        .then(value => {
          if (mounted.current && current === epoch.current) applyMv(value);
          else releaseStale(value);
        })
        .catch(() => {
          if (mounted.current && current === epoch.current) open();
        });
    } else open();
    return () => {
      mounted.current = false;
      epoch.current += 1;
      const handle = handleRef.current;
      handleRef.current = null;
      if (handle) bilibiliMvClient.close(handle).catch(() => undefined);
      dispatch(mvActions.clearSnapshot());
    };
    // The screen identity is semantic and never changes after navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bvid, cid]);
  // The native surface is deliberately video-only.  Its timeline must follow
  // the RNTP-owned audio state rather than the stale playIntent returned while
  // resolving a fresh, opaque media handle.
  useEffect(() => {
    const handle = handleRef.current;
    if (!handle || !bvid || !cid) return;
    const current = ++syncEpoch.current;
    const expectedTrackId = `bitrack_v_${bvid}-${cid}`;
    if (playerTrackIdentityRef.current !== expectedTrackId) {
      // A mounted MV must never follow position/play state from another
      // semantic track. Pause this handle once, then invalidate any older
      // sync response until the matching audio item becomes current again.
      if (mismatchPauseHandle.current === handle) return;
      mismatchPauseHandle.current = handle;
      bilibiliMvClient
        .sync(
          handle,
          bvid,
          cid,
          Math.max(0, Math.round(mv?.positionMs || 0)),
          false,
        )
        .then(value => {
          if (
            mounted.current &&
            current === syncEpoch.current &&
            handleRef.current === handle
          )
            applyMv(value);
        })
        .catch(value => {
          if (
            mounted.current &&
            current === syncEpoch.current &&
            handleRef.current === handle
          )
            setError(value?.code || 'VIDEO_UNAVAILABLE');
        });
      return;
    }
    mismatchPauseHandle.current = null;
    const positionMs = Math.max(0, Math.round(player.position * 1000));
    bilibiliMvClient
      .sync(handle, bvid, cid, positionMs, player.isPlaying)
      .then(value => {
        if (
          mounted.current &&
          current === syncEpoch.current &&
          handleRef.current === handle
        )
          applyMv(value);
      })
      .catch(value => {
        if (mounted.current && current === syncEpoch.current)
          setError(value?.code || 'VIDEO_UNAVAILABLE');
      });
  }, [
    bvid,
    cid,
    applyMv,
    mv?.handle,
    mv?.positionMs,
    player.isPlaying,
    player.position,
    player.nowPlaying?.source,
    player.nowPlaying?.id,
  ]);
  useEffect(() => {
    const subscription = bilibiliMvClient.onPipState(value => {
      if (value.handle === handleRef.current) setInPip(value.active);
    });
    return () => subscription.remove();
  }, []);
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
    const previousHandle = mv.handle;
    const current = ++epoch.current;
    bilibiliMvClient
      .selectQuality(previousHandle, qualityId)
      .then(value => {
        if (!mounted.current || current !== epoch.current) {
          releaseStale(value);
          return;
        }
        applyMv(value);
      })
      .catch(value => {
        if (!mounted.current || current !== epoch.current) return;
        handleRef.current = null;
        setMv(null);
        dispatch(mvActions.clearSnapshot());
        bilibiliMvClient.close(previousHandle).catch(() => undefined);
        setError(value?.code || 'VIDEO_UNAVAILABLE');
      });
  };
  const invoke = (
    operation: 'enterFullscreen' | 'exitFullscreen' | 'requestPip',
  ) => {
    if (!mv?.handle) return;
    bilibiliMvClient[operation](mv.handle).catch(value =>
      setError(value?.code || 'VIDEO_UNAVAILABLE'),
    );
  };
  return (
    <View style={styles.page}>
      <View style={styles.top}>
        {!inPip ? (
          <Pressable
            accessibilityLabel="关闭MV画面"
            onPress={close}
            style={styles.button}
          >
            <Text style={styles.buttonText}>关闭</Text>
          </Pressable>
        ) : null}
        <Text accessibilityRole="header" numberOfLines={1} style={text.heading}>
          {route.params?.title || 'Bilibili MV'}
        </Text>
        <Pressable
          accessibilityLabel="进入画中画"
          disabled={!mv?.handle}
          onPress={() => invoke('requestPip')}
          style={styles.button}
        >
          <Text style={styles.buttonText}>画中画</Text>
        </Pressable>
      </View>
      <View style={styles.video}>
        {mv?.handle ? (
          <BilibiliMvView handle={mv.handle} style={StyleSheet.absoluteFill} />
        ) : (
          <ActivityIndicator color={colors.accent} />
        )}
      </View>
      {error ? (
        <View style={styles.error}>
          <Text style={text.heading}>视频画面暂不可用</Text>
          <Text style={text.meta}>音频播放没有中断。</Text>
          <Pressable
            accessibilityLabel="重试MV画面"
            onPress={() => open(true)}
            style={styles.button}
          >
            <Text style={styles.buttonText}>重试画面</Text>
          </Pressable>
        </View>
      ) : null}
      {!inPip ? (
        <View style={styles.controls}>
          <Pressable
            accessibilityLabel="全屏播放MV"
            disabled={!mv?.handle}
            onPress={() => invoke('enterFullscreen')}
            style={styles.button}
          >
            <Text style={styles.buttonText}>全屏</Text>
          </Pressable>
          <Pressable
            accessibilityLabel="退出MV全屏"
            disabled={!mv?.handle}
            onPress={() => invoke('exitFullscreen')}
            style={styles.button}
          >
            <Text style={styles.buttonText}>退出全屏</Text>
          </Pressable>
        </View>
      ) : null}
      {!inPip ? (
        <View style={styles.qualities}>
          {mv?.variants.map(variant => (
            <Pressable
              accessibilityLabel={`选择${variant.label}画质`}
              key={variant.id}
              onPress={() => chooseQuality(variant.id)}
              style={[
                styles.button,
                mv.qualityId === variant.id && styles.selected,
              ]}
            >
              <Text style={styles.buttonText}>{variant.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: colors.background,
    padding: spacing.md,
    gap: spacing.md,
  },
  top: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  video: {
    minHeight: 220,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  button: {
    minHeight: 48,
    minWidth: 48,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: colors.surface,
  },
  buttonText: { color: colors.accent, fontWeight: '600' },
  controls: { flexDirection: 'row', gap: spacing.sm },
  qualities: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  selected: { borderWidth: 1, borderColor: colors.accent },
  error: {
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: 8,
  },
});
