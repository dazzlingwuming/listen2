import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigation } from '@react-navigation/native';
import type { RootState } from '../store';
import * as playerActions from '../store/playerSlice';
import { colors, spacing, text } from '../theme';
import { playerErrorCopy } from '../player/playerErrorCopy';
import {
  artwork,
  formatDuration,
  trackArtist,
  trackSource,
  trackTitle,
  type PresentableTrack,
} from '../components/TrackRow';
import { providerLabels } from '../components/SourceTabs';
import { Sheet } from '../components/Sheet';
import { PROVIDER_CAPABILITIES, providerClient } from '../api/client';
import { ProviderClientError } from '../api/errors';
import { parseExactBilibiliTrackId } from '../api/ids';
import { findBilibiliLyricCandidates } from '../bilibili/lyrics';
import type {
  BilibiliLyricCandidate,
  BilibiliLyricCandidateResult,
} from '../bilibili/types';
import { BilibiliLyricPicker } from '../components/BilibiliLyricPicker';
import {
  continuityLyricMetadataObserved,
  continuityLyricMetadataRemoved,
  mutationPending,
  mutationReceived,
} from '../store/librarySlice';
import { libraryClient } from '../library/libraryClient';
import { isLocalTrack } from '../types/music';
import type { Lyric, SourceId, Track } from '../types/provider';
import {
  findActiveLyricIndex,
  MAX_LYRIC_OFFSET_MS,
  parseLyricTimeline,
  type LyricTimelineLine,
} from '../lyrics/timeline';
import { bilibiliLyricCache } from '../lyrics/cache';
import {
  lyricSelectionStore,
  type LyricSelectionKey,
} from '../lyrics/selectionStore';
import { createLyricSession, lyricSessionKey } from '../lyrics/session';
import { DeepSeekConsentSheet } from '../components/DeepSeekConsentSheet';
import {
  createDeepSeekConsent,
  hasCompleteDeepSeekConsent,
} from '../deepseek/consent';
import {
  DeepSeekClientError,
  deepSeekClient,
  hashLyric,
  hashTrack,
  translationLinesToLrc,
} from '../deepseek/client';
import type { DeepSeekConsent } from '../deepseek/types';
import { bilibiliMvClient } from '../bilibili/mvClient';
import {
  audioEffectsClient,
  audioEffectsLabel,
  type AudioEffectsSnapshot,
} from '../audioFx/client';

export type LyricFailurePresentation = Readonly<{
  code:
    | 'cancelled'
    | 'timeout'
    | 'mismatch'
    | 'missing'
    | 'unsupported'
    | 'provider';
  title: string;
  message: string;
  action: 'retry' | 'choose-source';
}>;

/** Stable, bounded semantic revision used to fence a translation transaction. */
export function playerTranslationRevision(
  lyric: string,
  fallbackRevision = 0,
): number {
  const candidate = Number.parseInt(hashLyric(lyric).slice(0, 13), 16);
  if (Number.isSafeInteger(candidate) && candidate >= 0) return candidate;
  return Number.isSafeInteger(fallbackRevision) && fallbackRevision >= 0
    ? fallbackRevision
    : 0;
}

/** Stable lyric failures are product states, never a rendered provider error. */
export function lyricFailurePresentation(
  error: unknown,
): LyricFailurePresentation {
  const code =
    error instanceof ProviderClientError ? error.code : 'PROVIDER_ERROR';
  if (code === 'CANCELLED')
    return {
      code: 'cancelled',
      title: '歌词请求已取消',
      message: '可重新加载歌词。',
      action: 'retry',
    };
  if (code === 'REQUEST_TIMEOUT')
    return {
      code: 'timeout',
      title: '歌词请求超时',
      message: '请稍后重试。',
      action: 'retry',
    };
  if (code === 'INVALID_RESPONSE' || code === 'UNKNOWN_TRACK')
    return {
      code: 'mismatch',
      title: '歌词信息不匹配',
      message: '请选择其他歌曲或歌词来源。',
      action: 'choose-source',
    };
  if (code === 'LYRIC_UNAVAILABLE')
    return {
      code: 'missing',
      title: '未找到可用歌词',
      message: '可重试或选择其他歌词来源。',
      action: 'choose-source',
    };
  if (code === 'ROUTE_UNAVAILABLE')
    return {
      code: 'unsupported',
      title: '此来源暂不支持歌词',
      message: '请选择其他歌曲或歌词来源。',
      action: 'choose-source',
    };
  return {
    code: 'provider',
    title: '歌词来源暂时不可用',
    message: '请稍后重试。',
    action: 'retry',
  };
}

function manualLyricFromCandidate(
  trackId: string,
  candidate: BilibiliLyricCandidate,
): Lyric {
  return {
    trackId,
    source: 'bilibili',
    text: candidate.text,
    translation: candidate.translation,
    provenance: {
      mode: 'manual',
      matchedProvider: candidate.matchedProvider,
      matchedCandidateId: candidate.id,
      matchScore: candidate.matchScore,
      ...(candidate.translation
        ? { translationProvider: candidate.matchedProvider }
        : {}),
    },
  };
}

export function PlayerScreen() {
  const navigation = useNavigation<any>();
  const dispatch = useDispatch<any>();
  const state = useSelector((root: RootState) => (root as any).player || {});
  const current = (state.currentTrack || state.current || state.track) as
    | PresentableTrack
    | undefined;
  const queue = (
    state.playNextQueue?.length
      ? state.playNextQueue
      : state.playlist || state.tracks || []
  ) as QueueItem[];
  const showingPlayNext = Boolean(state.playNextQueue?.length);
  const playing = Boolean(state.isPlaying ?? state.playing);
  const currentPosition = state.position ?? state.progress ?? 0;
  const currentBilibiliTrackId =
    current && trackSource(current) === 'bilibili' ? current.id : null;
  const error = playerErrorCopy(
    typeof state.error === 'string' ? state.error : null,
  );
  const favorites = useSelector((root: RootState) => root.library.favorites);
  const libraryRevision = useSelector((root: RootState) => root.library.revision || 0);
  const [showQueue, setShowQueue] = useState(false);
  const [showLyrics, setShowLyrics] = useState(false);
  const [lyrics, setLyrics] = useState<Lyric | null>(null);
  const [lyricsLoading, setLyricsLoading] = useState(false);
  const [lyricsUnavailable, setLyricsUnavailable] = useState(false);
  const [lyricFailure, setLyricFailure] =
    useState<LyricFailurePresentation | null>(null);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [candidates, setCandidates] = useState<BilibiliLyricCandidate[]>([]);
  const [candidateLoading, setCandidateLoading] = useState(false);
  const [candidatePartial, setCandidatePartial] = useState(false);
  const [candidateProviderErrors, setCandidateProviderErrors] = useState<
    BilibiliLyricCandidateResult['providerErrors']
  >([]);
  const [candidateError, setCandidateError] = useState(false);
  const [bilibiliCacheRevision, setBilibiliCacheRevision] = useState<
    number | undefined
  >();
  const [lyricOffsetMs, setLyricOffsetMs] = useState(0);
  const [selectionRevision, setSelectionRevision] = useState<
    number | undefined
  >();
  const [restoredManualVariantId, setRestoredManualVariantId] = useState<
    string | null
  >(null);
  const [offsetSaving, setOffsetSaving] = useState(false);
  const [offsetNotice, setOffsetNotice] = useState<string | null>(null);
  const [machineTranslation, setMachineTranslation] = useState<string | null>(
    null,
  );
  const [translationError, setTranslationError] = useState<string | null>(null);
  const [consentVisible, setConsentVisible] = useState(false);
  const [forceRefreshRequested, setForceRefreshRequested] = useState(false);
  const [translationBusy, setTranslationBusy] = useState(false);
  const [audioEffects, setAudioEffects] = useState<AudioEffectsSnapshot>({
    status: 'unavailable',
    preset: 'neutral',
    fixedGain: 1,
  });
  const lyricRequest = useRef<AbortController | null>(null);
  const lyricEpoch = useRef(0);
  const candidateRequest = useRef<AbortController | null>(null);
  const candidateEpoch = useRef(0);
  const selectionEpoch = useRef(0);
  const offsetEpoch = useRef(0);
  const translationEpoch = useRef(0);
  const translationOperation = useRef<string | null>(null);
  const translationBinding = useRef<TranslationBinding | null>(null);
  const translationLyricHash = lyrics ? hashLyric(lyrics.text) : null;
  const translationRevision = lyrics
    ? playerTranslationRevision(lyrics.text, bilibiliCacheRevision ?? 0)
    : 0;
  const translationIdentity =
    current && lyrics && translationLyricHash
      ? `${trackSource(current)}\n${current.id}\n${translationLyricHash}\n${translationRevision}`
      : null;
  const previousTranslationIdentity = useRef<string | null>(null);
  const favorite = current
    ? favorites.some(
        item => item.id === current.id && item.source === current.source,
      )
    : false;
  const lyricSession = useMemo(
    () =>
      current
        ? createLyricSession({
            source: trackSource(current) as SourceId,
            trackId: current.id,
            occurrenceId:
              state.currentOccurrenceId ||
              `track:${trackSource(current)}:${current.id}`,
            revision: bilibiliCacheRevision ?? 0,
          })
        : null,
    [bilibiliCacheRevision, current, state.currentOccurrenceId],
  );
  const lyricSessionRef = useRef(lyricSession);
  lyricSessionRef.current = lyricSession;
  const isCurrentLyricSession = (candidate: typeof lyricSession) =>
    Boolean(
      candidate &&
        lyricSessionRef.current &&
        lyricSessionKey(candidate) === lyricSessionKey(lyricSessionRef.current),
    );
  const selectionKey = useMemo<LyricSelectionKey | null>(() => {
    const exact = parseExactBilibiliTrackId(currentBilibiliTrackId);
    return exact
      ? { source: 'bilibili', trackId: exact.trackId, partId: exact.cid }
      : null;
  }, [currentBilibiliTrackId]);
  const nativeLyricMetadata = useSelector((root: RootState) =>
    selectionKey
      ? root.library.lyricMetadata?.find(item => item.source === selectionKey.source && item.trackId === selectionKey.trackId)
      : undefined,
  );
  const nativeLyricMetadataRef = useRef(nativeLyricMetadata);
  nativeLyricMetadataRef.current = nativeLyricMetadata;
  const operations = current
    ? PROVIDER_CAPABILITIES?.[trackSource(current) as SourceId]?.operations
    : undefined;
  const manualLyricsAvailable =
    operations?.['manual-lyrics']?.status === 'available';
  const offsetAvailable = operations?.offset?.status === 'available';
  useEffect(() => {
    setLyricOffsetMs(0);
    setSelectionRevision(undefined);
    setRestoredManualVariantId(null);
    const requestSession = lyricSession;
    if (!selectionKey || !requestSession) return;
    const requestKey = lyricSessionKey(requestSession);
    const nativeMetadata = nativeLyricMetadata;
    const nativeMetadataIsCurrent = () => {
      const latest = nativeLyricMetadataRef.current;
      return nativeMetadata
        ? Boolean(
            latest &&
              latest.source === nativeMetadata.source &&
              latest.trackId === nativeMetadata.trackId &&
              latest.selectedVariantId === nativeMetadata.selectedVariantId &&
              latest.offsetMillis === nativeMetadata.offsetMillis,
          )
        : latest === undefined;
    };
    if (nativeMetadata) {
      // Room is the durable owner. Seed the render state synchronously so a
      // user opening lyrics immediately after hydration cannot fall through
      // to automatic matching before the AsyncStorage read settles.
      setLyricOffsetMs(nativeMetadata.offsetMillis);
      setRestoredManualVariantId(nativeMetadata.selectedVariantId);
    }
    lyricSelectionStore.get(selectionKey).then(record => {
      if (
        !lyricSessionRef.current ||
        lyricSessionKey(lyricSessionRef.current) !== requestKey ||
        !nativeMetadataIsCurrent()
      )
        return;
      if (nativeMetadata) {
        // Do not let an older or mismatched JS selection overwrite the native
        // projection. Its revision is still useful for a subsequent local
        // CAS write (for example, adjusting the offset).
        setLyricOffsetMs(nativeMetadata.offsetMillis);
        setRestoredManualVariantId(nativeMetadata.selectedVariantId);
        setSelectionRevision(record?.revision);
      } else if (record) {
        setLyricOffsetMs(record.offsetMs);
        setSelectionRevision(record.revision);
        setRestoredManualVariantId(record.manual?.candidateId || null);
        dispatch(
          continuityLyricMetadataObserved({
            source: selectionKey.source,
            trackId: selectionKey.trackId,
            selectedVariantId: record.manual?.candidateId || null,
            offsetMillis: record.offsetMs,
          }),
        );
      }
    });
  }, [dispatch, lyricSession, nativeLyricMetadata, selectionKey]);
  useEffect(() => {
    const identity = parseExactBilibiliTrackId(currentBilibiliTrackId);
    if (!identity) return;
    bilibiliMvClient
      .syncActive(
        identity.bvid,
        identity.cid,
        playbackPositionMs(currentPosition),
        playing,
      )
      .catch(() => undefined);
  }, [currentBilibiliTrackId, currentPosition, playing]);
  const invalidateLyricWork = () => {
    lyricRequest.current?.abort();
    candidateRequest.current?.abort();
    lyricEpoch.current += 1;
    candidateEpoch.current += 1;
    selectionEpoch.current += 1;
    offsetEpoch.current += 1;
  };
  const invalidateTranslationWork = (settleUi: boolean) => {
    // Clear the operation before cancelling it so a close followed by an
    // unmount/track change cannot send duplicate cancellation requests.
    translationEpoch.current += 1;
    const operationId = translationOperation.current;
    translationOperation.current = null;
    translationBinding.current = null;
    cancelPlayerTranslation(operationId);
    if (settleUi) {
      setTranslationBusy(false);
      setTranslationError(null);
      setConsentVisible(false);
      setForceRefreshRequested(false);
    }
  };
  useEffect(() => {
    invalidateLyricWork();
    setLyrics(null);
    setLyricsLoading(false);
    setLyricsUnavailable(false);
    setLyricFailure(null);
    setPickerVisible(false);
    setCandidates([]);
    setCandidateLoading(false);
    setCandidatePartial(false);
    setCandidateProviderErrors([]);
    setCandidateError(false);
    setBilibiliCacheRevision(undefined);
    setLyricOffsetMs(0);
    setSelectionRevision(undefined);
    setOffsetSaving(false);
    setOffsetNotice(null);
    setMachineTranslation(null);
    setTranslationError(null);
    invalidateTranslationWork(true);
  }, [current?.id, current?.source, state.currentOccurrenceId]);
  useEffect(() => {
    return () => {
      invalidateLyricWork();
      invalidateTranslationWork(false);
    };
  }, []);
  useEffect(() => {
    const previous = previousTranslationIdentity.current;
    if (previous !== null && previous !== translationIdentity) {
      invalidateTranslationWork(true);
      setMachineTranslation(null);
      setTranslationError(null);
    }
    previousTranslationIdentity.current = translationIdentity;
  }, [translationIdentity]);
  const openLyrics = async (force = false) => {
    setShowLyrics(true);
    if (!current || (!force && (lyrics || lyricsLoading))) return;
    if (isLocalTrack(current)) {
      setLyricsUnavailable(true);
      setLyricFailure({
        code: 'unsupported',
        title: '本地音频暂不提供网络歌词',
        message: '为保护本地文件信息，应用不会请求网络歌词。',
        action: 'choose-source',
      });
      return;
    }
    lyricRequest.current?.abort();
    const controller = new AbortController();
    lyricRequest.current = controller;
    const epoch = ++lyricEpoch.current;
    const requestSession = lyricSession;
    if (!requestSession) return;
    setLyricsLoading(true);
    setLyricsUnavailable(false);
    setLyricFailure(null);
    if (force) setPickerVisible(false);
    try {
      const bilibiliIdentity =
        trackSource(current) === 'bilibili'
          ? parseExactBilibiliTrackId(current.id)
          : null;
      if (bilibiliIdentity) {
        const cached = await bilibiliLyricCache.get(current.id);
        const nativeVariantId = nativeLyricMetadata?.selectedVariantId || null;
        const nativeOffsetMillis = nativeLyricMetadata?.offsetMillis ?? 0;
        const nativeMetadataIsCurrent = () => {
          const latest = nativeLyricMetadataRef.current;
          return Boolean(
            latest &&
              latest.source === 'bilibili' &&
              latest.trackId === current.id &&
              latest.selectedVariantId === nativeVariantId &&
              latest.offsetMillis === nativeOffsetMillis,
          );
        };
        if (nativeVariantId) {
          const cachedProvenance = cached?.lyric.provenance;
          if (
            cached &&
            cachedProvenance?.mode === 'manual' &&
            cachedProvenance.matchedCandidateId === nativeVariantId &&
            epoch === lyricEpoch.current &&
            !controller.signal.aborted &&
            isCurrentLyricSession(requestSession) &&
            nativeMetadataIsCurrent()
          ) {
            setLyrics(cached.lyric);
            setBilibiliCacheRevision(cached.revision);
            setLyricOffsetMs(nativeOffsetMillis);
            setRestoredManualVariantId(nativeVariantId);
            return;
          }
          const result = await findBilibiliLyricCandidates(current as Track, {
            signal: controller.signal,
          });
          if (
            epoch !== lyricEpoch.current ||
            controller.signal.aborted ||
            !isCurrentLyricSession(requestSession) ||
            !nativeMetadataIsCurrent()
          )
            return;
          const candidate = result.candidates.find(
            item => item.id === nativeVariantId,
          );
          if (!candidate) {
            setCandidates([...result.candidates]);
            setCandidatePartial(result.partial);
            setCandidateProviderErrors(result.providerErrors);
            setCandidateError(false);
            setLyricsUnavailable(true);
            setLyricFailure({
              code: 'missing',
              title: '未找到已保存的歌词版本',
              message: '请选择其他歌词来源。',
              action: 'choose-source',
            });
            setPickerVisible(true);
            return;
          }
          const restoredLyric = manualLyricFromCandidate(
            bilibiliIdentity.trackId,
            candidate,
          );
          let saved = await bilibiliLyricCache.put(
            { lyric: restoredLyric },
            bilibiliCacheRevision,
          );
          if (
            saved.status === 'stale' &&
            epoch === lyricEpoch.current &&
            !controller.signal.aborted &&
            isCurrentLyricSession(requestSession) &&
            nativeMetadataIsCurrent()
          ) {
            const latest = await bilibiliLyricCache.get(
              bilibiliIdentity.trackId,
            );
            if (
              epoch === lyricEpoch.current &&
              !controller.signal.aborted &&
              isCurrentLyricSession(requestSession) &&
              nativeMetadataIsCurrent()
            ) {
              saved = await bilibiliLyricCache.put(
                { lyric: restoredLyric },
                latest?.revision ?? 0,
              );
            }
          }
          if (
            epoch !== lyricEpoch.current ||
            controller.signal.aborted ||
            !isCurrentLyricSession(requestSession) ||
            !nativeMetadataIsCurrent()
          )
            return;
          setLyrics(restoredLyric);
          setLyricOffsetMs(nativeOffsetMillis);
          setRestoredManualVariantId(nativeVariantId);
          if (saved.status === 'ok')
            setBilibiliCacheRevision(saved.record.revision);
          return;
        }
        if (
          cached &&
          (!nativeLyricMetadata || cached.lyric.provenance?.mode !== 'manual') &&
          epoch === lyricEpoch.current &&
          !controller.signal.aborted
        ) {
          setLyrics(cached.lyric);
          setBilibiliCacheRevision(cached.revision);
          return;
        }
      }
      const response = await providerClient.getLyric(current as Track, {
        signal: controller.signal,
      });
      if (epoch === lyricEpoch.current && !controller.signal.aborted) {
        setLyrics(response);
        if (bilibiliIdentity && response.provenance) {
          const saved = await bilibiliLyricCache.put({ lyric: response });
          if (
            saved.status === 'ok' &&
            epoch === lyricEpoch.current &&
            !controller.signal.aborted
          )
            setBilibiliCacheRevision(saved.record.revision);
        }
      }
    } catch (caught) {
      if (epoch === lyricEpoch.current && !controller.signal.aborted) {
        setLyricFailure(lyricFailurePresentation(caught));
        setLyricsUnavailable(true);
        if (trackSource(current) === 'bilibili' && manualLyricsAvailable)
          setPickerVisible(true);
      }
    } finally {
      if (epoch === lyricEpoch.current && !controller.signal.aborted)
        setLyricsLoading(false);
    }
  };
  const searchBilibiliCandidates = async (query: string) => {
    if (
      !current ||
      trackSource(current) !== 'bilibili' ||
      !manualLyricsAvailable
    )
      return;
    const identity = parseExactBilibiliTrackId(current.id);
    if (!identity) return;
    candidateRequest.current?.abort();
    const controller = new AbortController();
    candidateRequest.current = controller;
    const epoch = ++candidateEpoch.current;
    const selectionGeneration = ++selectionEpoch.current;
    const requestSession = lyricSession;
    if (!requestSession) return;
    setCandidateLoading(true);
    setCandidateError(false);
    try {
      const result = await findBilibiliLyricCandidates(
        { ...(current as Track), title: query.trim() || trackTitle(current) },
        { signal: controller.signal },
      );
      if (
        epoch === candidateEpoch.current &&
        selectionGeneration === selectionEpoch.current &&
        isCurrentLyricSession(requestSession) &&
        !controller.signal.aborted
      ) {
        setCandidates([...result.candidates]);
        setCandidatePartial(result.partial);
        setCandidateProviderErrors(result.providerErrors);
        setCandidateError(false);
      }
    } catch {
      if (
        epoch === candidateEpoch.current &&
        selectionGeneration === selectionEpoch.current &&
        isCurrentLyricSession(requestSession) &&
        !controller.signal.aborted
      ) {
        setCandidatePartial(true);
        setCandidateProviderErrors([]);
        setCandidateError(true);
      }
    } finally {
      if (
        epoch === candidateEpoch.current &&
        selectionGeneration === selectionEpoch.current &&
        isCurrentLyricSession(requestSession)
      )
        setCandidateLoading(false);
    }
  };
  const chooseBilibiliCandidate = async (candidate: BilibiliLyricCandidate) => {
    if (
      !current ||
      trackSource(current) !== 'bilibili' ||
      !manualLyricsAvailable
    )
      return;
    const identity = parseExactBilibiliTrackId(current.id);
    const token = ++selectionEpoch.current;
    offsetEpoch.current += 1;
    const candidateGeneration = candidateEpoch.current;
    if (!identity) return;
    const requestSession = lyricSession;
    if (!requestSession) return;
    const lyric = manualLyricFromCandidate(identity.trackId, candidate);
    let saved = await bilibiliLyricCache.put({ lyric }, bilibiliCacheRevision);
    if (
      saved.status === 'stale' &&
      token === selectionEpoch.current &&
      candidateGeneration === candidateEpoch.current &&
      isCurrentLyricSession(requestSession)
    ) {
      const latest = await bilibiliLyricCache.get(identity.trackId);
      if (
        token === selectionEpoch.current &&
        candidateGeneration === candidateEpoch.current &&
        isCurrentLyricSession(requestSession)
      ) {
        saved = await bilibiliLyricCache.put({ lyric }, latest?.revision ?? 0);
      }
    }
    if (
      token !== selectionEpoch.current ||
      candidateGeneration !== candidateEpoch.current ||
      !isCurrentLyricSession(requestSession) ||
      saved.status !== 'ok'
    )
      return;
    setLyrics(lyric);
    setBilibiliCacheRevision(saved.record.revision);
    setRestoredManualVariantId(candidate.id);
    if (selectionKey) {
      const selection = await lyricSelectionStore.put(
        {
          key: selectionKey,
          offsetMs: lyricOffsetMs,
          manual: {
            provider: candidate.matchedProvider,
            candidateId: candidate.id,
          },
        },
        selectionRevision ?? 0,
      );
      if (selection.status === 'ok' && isCurrentLyricSession(requestSession))
        setSelectionRevision(selection.record.revision);
      if (selection.status === 'ok' && isCurrentLyricSession(requestSession))
        dispatch(continuityLyricMetadataObserved({
          source: selectionKey.source,
          trackId: selectionKey.trackId,
          selectedVariantId: candidate.id,
          offsetMillis: selection.record.offsetMs,
        }));
    }
    setMachineTranslation(null);
    setTranslationError(null);
    setPickerVisible(false);
  };
  const restoreBilibiliAutomatic = async () => {
    if (
      !current ||
      trackSource(current) !== 'bilibili' ||
      !manualLyricsAvailable
    )
      return;
    const identity = parseExactBilibiliTrackId(current.id);
    if (!identity) return;
    const token = ++selectionEpoch.current;
    offsetEpoch.current += 1;
    const requestSession = lyricSession;
    if (!requestSession) return;
    lyricRequest.current?.abort();
    candidateRequest.current?.abort();
    lyricEpoch.current += 1;
    candidateEpoch.current += 1;
    if (!selectionKey) return;
    const selection = await lyricSelectionStore.clearManual(
      selectionKey,
      selectionRevision,
    );
    if (
      (selection.status !== 'ok' && selection.status !== 'not-found') ||
      token !== selectionEpoch.current ||
      !isCurrentLyricSession(requestSession)
    )
      return;
    await bilibiliLyricCache.clear(identity.trackId);
    if (
      token !== selectionEpoch.current ||
      !isCurrentLyricSession(requestSession)
    )
      return;
    if (selection.status === 'ok') {
      setSelectionRevision(selection.record.revision);
      dispatch(continuityLyricMetadataObserved({
        source: selectionKey.source,
        trackId: selectionKey.trackId,
        selectedVariantId: null,
        offsetMillis: selection.record.offsetMs,
      }));
    } else {
      setSelectionRevision(undefined);
      dispatch(continuityLyricMetadataRemoved({ source: selectionKey.source, trackId: selectionKey.trackId }));
    }
    setRestoredManualVariantId(null);
    setLyrics(null);
    setLyricsUnavailable(false);
    setLyricFailure(null);
    setMachineTranslation(null);
    setTranslationError(null);
    setBilibiliCacheRevision(undefined);
    setPickerVisible(false);
    await openLyrics(true);
  };
  const updateLyricOffset = async (deltaMs: number) => {
    if (!selectionKey || !offsetAvailable || !Number.isFinite(deltaMs)) return;
    const nextOffset = Math.max(
      -MAX_LYRIC_OFFSET_MS,
      Math.min(MAX_LYRIC_OFFSET_MS, lyricOffsetMs + deltaMs),
    );
    if (nextOffset === lyricOffsetMs) return;
    const token = ++selectionEpoch.current;
    const offsetToken = ++offsetEpoch.current;
    const requestSession = lyricSession;
    if (!requestSession) return;
    setOffsetSaving(true);
    setOffsetNotice(null);
    try {
      const saved = await lyricSelectionStore.setOffset(
        selectionKey,
        nextOffset,
        selectionRevision ?? 0,
      );
      if (
        token !== selectionEpoch.current ||
        offsetToken !== offsetEpoch.current ||
        !isCurrentLyricSession(requestSession)
      )
        return;
      if (saved.status === 'ok') {
        setLyricOffsetMs(saved.record.offsetMs);
        setSelectionRevision(saved.record.revision);
        dispatch(continuityLyricMetadataObserved({
          source: selectionKey.source,
          trackId: selectionKey.trackId,
          selectedVariantId: nativeLyricMetadata
            ? nativeLyricMetadata.selectedVariantId
            : restoredManualVariantId || saved.record.manual?.candidateId || null,
          offsetMillis: saved.record.offsetMs,
        }));
        setOffsetNotice(
          `已保存 ${saved.record.offsetMs >= 0 ? '+' : ''}${
            saved.record.offsetMs
          }毫秒`,
        );
      } else if (saved.status === 'stale') {
        setOffsetNotice('歌词校正已在其他操作更新，请重新调整。');
      } else {
        setOffsetNotice('歌词校正未保存，请重试。');
      }
    } finally {
      if (
        offsetToken === offsetEpoch.current &&
        isCurrentLyricSession(requestSession)
      )
        setOffsetSaving(false);
    }
  };
  const closeLyrics = () => {
    invalidateLyricWork();
    invalidateTranslationWork(true);
    setShowLyrics(false);
    setPickerVisible(false);
    setLyricsLoading(false);
    setCandidateLoading(false);
  };
  const closePicker = () => {
    candidateRequest.current?.abort();
    candidateEpoch.current += 1;
    selectionEpoch.current += 1;
    setPickerVisible(false);
    setCandidateLoading(false);
  };
  const translationEligible = Boolean(
    current &&
      lyrics &&
      (trackSource(current) === 'netease' ||
        trackSource(current) === 'qq' ||
        (trackSource(current) === 'bilibili' &&
          parseExactBilibiliTrackId(current.id) &&
          lyrics.provenance &&
          (lyrics.provenance.matchedProvider === 'netease' ||
            lyrics.provenance.matchedProvider === 'qq'))) &&
      parseLyricTimeline(lyrics.text).some(line => line.timestampMs !== null),
  );
  const requestTranslation = async (
    consent: DeepSeekConsent,
    forceRefresh: boolean,
  ) => {
    if (!current || !lyrics || !translationEligible) return;
    const provider = trackSource(current);
    if (provider !== 'netease' && provider !== 'qq' && provider !== 'bilibili')
      return;
    if (
      provider === 'bilibili' &&
      (!parseExactBilibiliTrackId(current.id) || !lyrics.provenance)
    )
      return;
    const lyricHash = translationLyricHash || hashLyric(lyrics.text);
    const trackHash = hashTrack(provider, current.id, lyricHash);
    const revision = playerTranslationRevision(
      lyrics.text,
      bilibiliCacheRevision ?? 0,
    );
    const plan = playerTranslationPlan(consent, forceRefresh);
    if (
      plan.allowNetwork &&
      !sameTranslationBinding(translationBinding.current, {
        source: provider,
        trackId: current.id,
        lyricHash,
        trackHash,
        revision,
      })
    )
      return;
    const epoch = ++translationEpoch.current;
    const operationId = `deepseek_${Date.now()}_${epoch}`;
    translationOperation.current = operationId;
    setTranslationBusy(true);
    setTranslationError(null);
    try {
      const result = await deepSeekClient.translate({
        operationId,
        provider,
        sourceTrackId: current.id,
        lyric: lyrics.text,
        title: trackTitle(current),
        artist: trackArtist(current),
        style: '',
        lyricHash,
        trackHash,
        revision,
        target: 'zh-CN',
        consent,
        allowNetwork: plan.allowNetwork,
        forceRefresh: plan.forceRefresh,
        ...(provider === 'bilibili'
          ? {
              matchedProvider: lyrics.provenance!.matchedProvider,
              matchedCandidateId: lyrics.provenance!.matchedCandidateId,
            }
          : {}),
      });
      if (
        !shouldApplyPlayerTranslation(
          epoch,
          translationEpoch.current,
          trackHash,
          result.trackHash,
          revision,
          result.revision,
        )
      )
        return;
      if (result.status === 'ok' && result.translationLines)
        setMachineTranslation(translationLinesToLrc(result.translationLines));
      else if (result.status === 'not-cached') {
        setForceRefreshRequested(false);
        translationBinding.current = {
          source: provider,
          trackId: current.id,
          lyricHash,
          trackHash,
          revision,
        };
        setConsentVisible(true);
      } else setTranslationError(playerTranslationErrorCopy(result.errorCode));
    } catch (caught) {
      if (epoch === translationEpoch.current)
        setTranslationError(
          caught instanceof DeepSeekClientError
            ? caught.code
            : 'PROVIDER_ERROR',
        );
    } finally {
      if (epoch === translationEpoch.current) {
        if (translationOperation.current === operationId)
          translationOperation.current = null;
        setTranslationBusy(false);
      }
    }
  };
  const lookupTranslation = () => {
    translationBinding.current = null;
    requestTranslation(
      createDeepSeekConsent(
        {
          lyrics: false,
          title: false,
          artist: false,
          possibleCost: false,
          cancellation: false,
          failureImpact: false,
        },
        0,
      ),
      false,
    ).catch(() => undefined);
  };
  const toggle = () =>
    invoke(
      dispatch,
      playing ? ['pause', 'togglePlayback'] : ['play', 'togglePlayback'],
    );
  useEffect(() => {
    let active = true;
    void audioEffectsClient.status().then(snapshot => {
      if (active) setAudioEffects(snapshot);
    });
    return () => {
      active = false;
    };
  }, []);
  return (
    <View style={styles.page}>
      <View style={styles.top}>
        <Pressable
          accessibilityLabel="关闭播放器"
          onPress={() => navigation.goBack()}
          style={styles.iconButton}
        >
          <Text style={styles.icon}>⌄</Text>
        </Pressable>
        <Text
          accessibilityRole="header"
          numberOfLines={1}
          style={styles.source}
        >
          {current
            ? providerLabels[trackSource(current)] || trackSource(current)
            : '播放器'}
        </Text>
        <View style={styles.iconButton} />
      </View>
      {current ? (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.artFrame}>
            {artwork(current) ? (
              <Image
                source={{ uri: artwork(current) }}
                style={styles.artwork}
              />
            ) : (
              <Text style={styles.placeholder}>♪</Text>
            )}
          </View>
          <View style={styles.trackCopy}>
            <Text numberOfLines={2} style={text.display}>
              {trackTitle(current)}
            </Text>
            <Text numberOfLines={1} style={text.meta}>
              {trackArtist(current)}
            </Text>
          </View>
          {error ? (
            <View style={styles.error}>
              <Text style={styles.errorTitle}>这首歌暂时无法播放</Text>
              <Text style={text.meta}>
                请重试，或返回搜索结果选择其他歌曲。
              </Text>
            </View>
          ) : null}
          <Progress
            position={currentPosition}
            duration={
              state.duration ?? current.duration ?? current.durationMs ?? 0
            }
            onSeek={position => invoke(dispatch, ['seekTo'], position)}
          />
          <View style={styles.actions}>
            <Pressable
              accessibilityLabel="后退15秒"
              accessibilityRole="button"
              onPress={() =>
                invoke(dispatch, ['seekTo'], Math.max(0, currentPosition - 15))
              }
              style={styles.action}
            >
              <Text style={styles.actionText}>−15秒</Text>
            </Pressable>
            <Pressable
              accessibilityLabel="前进15秒"
              accessibilityRole="button"
              onPress={() => invoke(dispatch, ['seekTo'], currentPosition + 15)}
              style={styles.action}
            >
              <Text style={styles.actionText}>+15秒</Text>
            </Pressable>
            <Pressable
              accessibilityLabel={state.muted ? '取消静音' : '静音'}
              accessibilityRole="button"
              onPress={() => invoke(dispatch, ['toggleMute'])}
              style={styles.action}
            >
              <Text style={styles.actionText}>
                {state.muted ? '取消静音' : '静音'}
              </Text>
            </Pressable>
            <Pressable
              accessibilityLabel={`降低音量，当前${Math.round(
                (state.volume ?? 1) * 100,
              )}%`}
              accessibilityRole="button"
              onPress={() =>
                invoke(
                  dispatch,
                  ['setVolume'],
                  Math.max(0, (state.volume ?? 1) - 0.1),
                )
              }
              style={styles.action}
            >
              <Text style={styles.actionText}>音量−</Text>
            </Pressable>
            <Pressable
              accessibilityLabel={`提高音量，当前${Math.round(
                (state.volume ?? 1) * 100,
              )}%`}
              accessibilityRole="button"
              onPress={() =>
                invoke(
                  dispatch,
                  ['setVolume'],
                  Math.min(1, (state.volume ?? 1) + 0.1),
                )
              }
              style={styles.action}
            >
              <Text style={styles.actionText}>音量+</Text>
            </Pressable>
            <Pressable
              accessibilityLabel="切换播放模式"
              accessibilityRole="button"
              onPress={() => invoke(dispatch, ['changePlayMode'])}
              style={styles.action}
            >
              <Text style={styles.actionText}>
                {['循环', '随机', '单曲'][state.playMode ?? 0]}
              </Text>
            </Pressable>
          </View>
          <View style={styles.audioEffects}>
            <Text accessibilityLabel="音效状态" style={text.meta}>
              {audioEffectsLabel(audioEffects)}
            </Text>
            <View style={styles.effectsActions}>
              {(['neutral', 'bass', 'vocal', 'treble'] as const).map(preset => (
                <Pressable
                  accessibilityLabel={`选择${preset}音效预设`}
                  key={preset}
                  onPress={() => {
                    void audioEffectsClient.selectPreset(preset).then(setAudioEffects);
                  }}
                  style={styles.effectButton}
                >
                  <Text style={styles.actionText}>{preset === 'neutral' ? '原声' : preset}</Text>
                </Pressable>
              ))}
            </View>
          </View>
          <View style={styles.controls}>
            <Pressable
              accessibilityLabel="上一首"
              onPress={() =>
                invoke(dispatch, ['prevTrack', 'previous', 'skipPrevious'])
              }
              style={styles.control}
            >
              <Text style={styles.controlIcon}>Ⅰ◀</Text>
            </Pressable>
            <Pressable
              accessibilityLabel={playing ? '暂停播放' : '继续播放'}
              onPress={toggle}
              style={[styles.control, styles.primaryControl]}
            >
              <Text style={styles.primaryIcon}>{playing ? 'Ⅱ' : '▶'}</Text>
            </Pressable>
            <Pressable
              accessibilityLabel="下一首"
              onPress={() =>
                invoke(dispatch, ['nextTrack', 'next', 'skipNext'])
              }
              style={styles.control}
            >
              <Text style={styles.controlIcon}>▶Ⅰ</Text>
            </Pressable>
          </View>
          <View style={styles.actions}>
            {current && parseExactBilibiliTrackId(current.id) ? (
              <Pressable
                accessibilityLabel="打开当前歌曲MV画面"
                onPress={() => {
                  const identity = parseExactBilibiliTrackId(current.id);
                  if (identity)
                    navigation.navigate('BilibiliMv', {
                      bvid: identity.bvid,
                      cid: identity.cid,
                      title: trackTitle(current),
                    });
                }}
                style={styles.action}
              >
                <Text style={styles.actionText}>MV</Text>
              </Pressable>
            ) : null}
            <Pressable
              accessibilityLabel="查看歌词"
              onPress={() => {
                openLyrics().catch(() => undefined);
              }}
              style={styles.action}
            >
              <Text style={styles.actionText}>歌词</Text>
            </Pressable>
            <Pressable
              accessibilityLabel={favorite ? '取消收藏' : '收藏当前歌曲'}
              onPress={() => {
                if (!current || isLocalTrack(current)) return;
                const requestId = `favorite_${Date.now()}`;
                dispatch(mutationPending({ requestId }));
                const mutation = favorite
                  ? { requestId, revision: libraryRevision, kind: 'unfavorite' as const, payload: { playlistId: 'favorites' as const, source: current.source, trackId: current.id } }
                  : { requestId, revision: libraryRevision, kind: 'favorite' as const, payload: { playlistId: 'favorites' as const, source: current.source, trackId: current.id, title: trackTitle(current), artist: trackArtist(current) } };
                void libraryClient.applyMutation(mutation).then(receipt => dispatch(mutationReceived(receipt))).catch(() => dispatch(mutationReceived({ requestId, status: 'rejected', revision: libraryRevision, errorCode: 'NATIVE_UNAVAILABLE' })));
              }}
              style={styles.action}
            >
              <Text style={styles.actionText}>
                {favorite ? '♥ 已收藏' : '♡ 收藏'}
              </Text>
            </Pressable>
            <Pressable
              accessibilityLabel={`打开播放队列，共${queue.length}首`}
              onPress={() => setShowQueue(true)}
              style={styles.action}
            >
              <Text style={styles.actionText}>队列 {queue.length}</Text>
            </Pressable>
          </View>
        </ScrollView>
      ) : (
        <View style={styles.noTrack}>
          <Text style={text.heading}>还没有正在播放的歌曲</Text>
          <Text style={text.meta}>从搜索结果中选择一首歌开始播放。</Text>
        </View>
      )}
      <QueueSheet
        queue={queue}
        visible={showQueue}
        onClose={() => setShowQueue(false)}
        onPlay={item => {
          const track = item.track || item;
          const action = showingPlayNext
            ? item.occurrenceId
              ? (playerActions as any).playQueuedTrack?.(item.occurrenceId)
              : undefined
            : (playerActions as any).playTrack?.(track);
          if (action) dispatch(action);
          setShowQueue(false);
        }}
        onMove={(occurrenceId, direction) =>
          dispatch(
            (playerActions as any).movePlayNextTrack(occurrenceId, direction),
          )
        }
        onRemove={occurrenceId =>
          dispatch((playerActions as any).removePlayNextTrack(occurrenceId))
        }
        onClear={() => dispatch((playerActions as any).clearPlayNextQueue())}
        showingPlayNext={showingPlayNext}
      />
      <LyricsSheet
        current={current}
        lyrics={lyrics}
        loading={lyricsLoading}
        unavailable={lyricsUnavailable}
        localAudio={Boolean(current && isLocalTrack(current))}
        machineTranslation={machineTranslation}
        visible={showLyrics}
        position={currentPosition}
        userOffsetMs={lyricOffsetMs}
        offsetAvailable={offsetAvailable}
        offsetNotice={offsetNotice}
        offsetReason={
          operations?.offset?.status === 'available'
            ? undefined
            : '当前来源尚未验证歌词偏移校正'
        }
        offsetSaving={offsetSaving}
        lyricFailure={lyricFailure}
        translationBusy={translationBusy}
        translationEligible={translationEligible}
        translationError={translationError}
        onLookupTranslation={lookupTranslation}
        onRetranslate={() => {
          setForceRefreshRequested(true);
          translationBinding.current = current && lyrics
            ? {
                source: trackSource(current),
                trackId: current.id,
                lyricHash: translationLyricHash || hashLyric(lyrics.text),
                trackHash: hashTrack(
                  trackSource(current),
                  current.id,
                  translationLyricHash || hashLyric(lyrics.text),
                ),
                revision: translationRevision,
              }
            : null;
          setConsentVisible(true);
        }}
        onRestoreSource={() => {
          setMachineTranslation(null);
          setTranslationError(null);
        }}
        onAdjustOffset={deltaMs => {
          updateLyricOffset(deltaMs).catch(() => undefined);
        }}
        onChooseAnotherSource={closeLyrics}
        onRetryLyrics={() => {
          openLyrics(true).catch(() => undefined);
        }}
        onClose={closeLyrics}
      />
      <DeepSeekConsentSheet
        artist={current ? trackArtist(current) : ''}
        title={current ? trackTitle(current) : ''}
        visible={consentVisible}
        onClose={() => {
          invalidateTranslationWork(true);
        }}
        onConfirm={consent => {
          const binding = translationBinding.current;
          const expectedBinding = current && lyrics
            ? {
                source: trackSource(current),
                trackId: current.id,
                lyricHash: translationLyricHash || hashLyric(lyrics.text),
                trackHash: hashTrack(
                  trackSource(current),
                  current.id,
                  translationLyricHash || hashLyric(lyrics.text),
                ),
                revision: translationRevision,
              }
            : null;
          if (!expectedBinding || !sameTranslationBinding(binding, expectedBinding)) {
            invalidateTranslationWork(true);
            return;
          }
          setConsentVisible(false);
          requestTranslation(consent, forceRefreshRequested).catch(
            () => undefined,
          );
        }}
      />
      <BilibiliLyricPicker
        candidates={candidates}
        error={candidateError}
        failureMessage={lyricFailure?.message}
        failureTitle={lyricFailure?.title}
        loading={candidateLoading}
        onClose={closePicker}
        onRestore={() => {
          restoreBilibiliAutomatic().catch(() => undefined);
        }}
        onRetryAutomatic={() => {
          openLyrics(true).catch(() => undefined);
        }}
        onSearch={query => {
          searchBilibiliCandidates(query).catch(() => undefined);
        }}
        onSelect={candidate => {
          chooseBilibiliCandidate(candidate).catch(() => undefined);
        }}
        partial={candidatePartial}
        providerErrors={candidateProviderErrors}
        visible={pickerVisible}
      />
    </View>
  );
}

/** Explicit actions call this planner; render, playback, and lyric hydration never do. */
export function playerTranslationPlan(
  consent: DeepSeekConsent,
  forceRefresh: boolean,
) {
  const consented = hasCompleteDeepSeekConsent(consent);
  return {
    allowNetwork: consented,
    forceRefresh: consented && forceRefresh,
    requiresConsent: !consented,
  };
}

export function shouldApplyPlayerTranslation(
  requestEpoch: number,
  currentEpoch: number,
  expectedTrackHash: string,
  resultTrackHash: string | undefined,
  expectedRevision?: number,
  resultRevision?: number,
): boolean {
  // Cache misses and native errors intentionally omit identity hashes. They
  // still belong to the active request, while a supplied different hash is a
  // stale response that must never update the current lyric view.
  return (
    requestEpoch === currentEpoch &&
    (!resultTrackHash || expectedTrackHash === resultTrackHash) &&
    (resultRevision === undefined || expectedRevision === resultRevision)
  );
}

function sameTranslationBinding(
  left: TranslationBinding | null,
  right: TranslationBinding,
): boolean {
  return Boolean(
    left &&
      left.source === right.source &&
      left.trackId === right.trackId &&
      left.lyricHash === right.lyricHash &&
      left.trackHash === right.trackHash &&
      left.revision === right.revision,
  );
}

function playerTranslationErrorCopy(code?: string): string {
  if (code === 'STALE_REVISION' || code === 'STALE_IDENTITY' || code === 'INVALID_ALIGNMENT')
    return '翻译结果与当前歌词不匹配，未保存。';
  if (code === 'KEYSTORE_UNAVAILABLE' || code === 'MISSING_KEY')
    return '当前设备无法安全保存 DeepSeek 密钥，因此翻译功能已停用。';
  if (code === 'NOT_CACHED') return '当前没有已验证的本地译文。';
  return '翻译暂不可用，请稍后重试。';
}

/** Only normalized provenance is rendered; provider replies never become UI copy. */
export function lyricProvenanceLabel(
  lyric: Lyric | null,
  current?: PresentableTrack,
  machineTranslation?: string | null,
): string | null {
  if (machineTranslation) return 'DeepSeek 机器翻译';
  const provenance = lyric?.provenance;
  if (provenance) {
    const provider =
      providerLabels[provenance.matchedProvider] || provenance.matchedProvider;
    return `${
      provenance.mode === 'manual' ? '手动选择' : '自动匹配'
    }：${provider}歌词`;
  }
  if (!lyric || !current) return null;
  return `来源直连：${
    providerLabels[trackSource(current)] || trackSource(current)
  } 歌词`;
}

export function lyricRowAccessibilityLabel(
  line: LyricTimelineLine,
  active: boolean,
  offsetMs: number,
  provenance: string | null,
): string {
  const offset = `${offsetMs >= 0 ? '+' : ''}${offsetMs}毫秒`;
  return [
    active ? '当前歌词' : '歌词',
    `原文：${line.text}`,
    line.translation ? `译文：${line.translation}` : '无译文',
    active ? `歌词校正 ${offset}` : null,
    active && provenance ? `来源：${provenance}` : null,
  ]
    .filter(Boolean)
    .join('；');
}

export function cancelPlayerTranslation(operationId: string | null): void {
  if (operationId) deepSeekClient.cancel(operationId).catch(() => undefined);
}

function Progress({
  position,
  duration,
  onSeek,
}: {
  position: number;
  duration: number;
  onSeek: (position: number) => void;
}) {
  const safeDuration = duration > 1000 ? duration / 1000 : duration;
  const safePosition = position > 1000 ? position / 1000 : position;
  const fraction = safeDuration
    ? Math.min(1, Math.max(0, safePosition / safeDuration))
    : 0;
  return (
    <View style={styles.progressBlock}>
      <Pressable
        accessibilityLabel={`播放进度 ${formatDuration(
          safePosition * 1000,
        )} / ${formatDuration(safeDuration * 1000)}`}
        accessibilityRole="adjustable"
        accessibilityValue={{
          min: 0,
          max: safeDuration,
          now: safePosition,
          text: `${formatDuration(safePosition * 1000)} / ${formatDuration(
            safeDuration * 1000,
          )}`,
        }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={event => {
          if (!safeDuration) return;
          const delta = event.nativeEvent.actionName === 'increment' ? 15 : -15;
          onSeek(Math.min(safeDuration, Math.max(0, safePosition + delta)));
        }}
        style={styles.track}
      >
        <View style={[styles.progress, { width: `${fraction * 100}%` }]} />
      </Pressable>
      <View style={styles.times}>
        <Text style={text.meta}>{formatDuration(safePosition)}</Text>
        <Text style={text.meta}>{formatDuration(safeDuration)}</Text>
      </View>
    </View>
  );
}

type QueueItem = PresentableTrack & {
  occurrenceId?: string;
  track?: PresentableTrack;
};

type TranslationBinding = {
  source: string;
  trackId: string;
  lyricHash: string;
  trackHash: string;
  revision: number;
};

function QueueSheet({
  visible,
  onClose,
  queue,
  onPlay,
  onMove,
  onRemove,
  onClear,
  showingPlayNext,
}: {
  visible: boolean;
  onClose: () => void;
  queue: QueueItem[];
  onPlay: (item: QueueItem, index: number) => void;
  onMove: (occurrenceId: string, direction: -1 | 1) => void;
  onRemove: (occurrenceId: string) => void;
  onClear: () => void;
  showingPlayNext: boolean;
}) {
  const [confirmClear, setConfirmClear] = useState(false);
  return (
    <Sheet onClose={onClose} title="播放队列" visible={visible}>
      <ScrollView contentContainerStyle={styles.sheetContent}>
        {showingPlayNext && queue.length ? (
          confirmClear ? (
            <View style={styles.queueTools}>
              <Text style={text.meta}>清空后不会影响当前播放或基础歌单。</Text>
              <Pressable
                accessibilityLabel="确认清空待播队列"
                accessibilityRole="button"
                onPress={() => {
                  onClear();
                  setConfirmClear(false);
                }}
                style={styles.action}
              >
                <Text style={styles.actionText}>确认清空</Text>
              </Pressable>
              <Pressable
                accessibilityLabel="取消清空待播队列"
                accessibilityRole="button"
                onPress={() => setConfirmClear(false)}
                style={styles.action}
              >
                <Text style={styles.actionText}>取消</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable
              accessibilityLabel="清空待播队列"
              accessibilityRole="button"
              onPress={() => setConfirmClear(true)}
              style={styles.action}
            >
              <Text style={styles.actionText}>清空待播</Text>
            </Pressable>
          )
        ) : null}
        {queue.length ? (
          queue.map((item, index) => {
            const track = item.track || item;
            const duplicateOrdinal = queue
              .slice(0, index + 1)
              .filter(candidate => {
                const candidateTrack = candidate.track || candidate;
                return candidateTrack.id === track.id;
              }).length;
            return (
              <View
                key={item.occurrenceId || `${track.id || 'track'}-${index}`}
                style={styles.queueRow}
              >
                <Pressable
                  accessibilityLabel={`播放队列第${index + 1}首，${trackTitle(
                    track,
                  )}${
                    duplicateOrdinal > 1 ? `，重复第${duplicateOrdinal}项` : ''
                  }`}
                  accessibilityRole="button"
                  onPress={() => onPlay(item, index)}
                  style={styles.queueCopy}
                >
                  <Text numberOfLines={1} style={text.body}>
                    {trackTitle(track)}
                  </Text>
                  <Text numberOfLines={1} style={text.meta}>
                    {trackArtist(track)} ·{' '}
                    {providerLabels[trackSource(track)] || trackSource(track)}
                  </Text>
                </Pressable>
                {showingPlayNext && item.occurrenceId ? (
                  <View style={styles.queueActions}>
                    <Pressable
                      accessibilityLabel={`上移${trackTitle(track)}`}
                      accessibilityRole="button"
                      disabled={index === 0}
                      onPress={() => onMove(item.occurrenceId!, -1)}
                      style={styles.queueAction}
                    >
                      <Text style={styles.actionText}>上移</Text>
                    </Pressable>
                    <Pressable
                      accessibilityLabel={`下移${trackTitle(track)}`}
                      accessibilityRole="button"
                      disabled={index === queue.length - 1}
                      onPress={() => onMove(item.occurrenceId!, 1)}
                      style={styles.queueAction}
                    >
                      <Text style={styles.actionText}>下移</Text>
                    </Pressable>
                    <Pressable
                      accessibilityLabel={`移除${trackTitle(track)}`}
                      accessibilityRole="button"
                      onPress={() => onRemove(item.occurrenceId!)}
                      style={styles.queueAction}
                    >
                      <Text style={styles.actionText}>移除</Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            );
          })
        ) : (
          <Text style={text.meta}>播放队列为空</Text>
        )}
      </ScrollView>
    </Sheet>
  );
}

function LyricsSheet({
  visible,
  onClose,
  current,
  lyrics,
  loading,
  unavailable,
  localAudio,
  machineTranslation,
  position,
  userOffsetMs,
  offsetAvailable,
  offsetNotice,
  offsetReason,
  offsetSaving,
  lyricFailure,
  translationBusy,
  translationEligible,
  translationError,
  onLookupTranslation,
  onRetranslate,
  onRestoreSource,
  onAdjustOffset,
  onChooseAnotherSource,
  onRetryLyrics,
}: {
  visible: boolean;
  onClose: () => void;
  current?: PresentableTrack;
  lyrics: Lyric | null;
  loading: boolean;
  unavailable: boolean;
  localAudio: boolean;
  machineTranslation: string | null;
  position: number;
  userOffsetMs: number;
  offsetAvailable: boolean;
  offsetNotice: string | null;
  offsetReason?: string;
  offsetSaving: boolean;
  lyricFailure: LyricFailurePresentation | null;
  translationBusy: boolean;
  translationEligible: boolean;
  translationError: string | null;
  onLookupTranslation: () => void;
  onRetranslate: () => void;
  onRestoreSource: () => void;
  onAdjustOffset: (deltaMs: number) => void;
  onChooseAnotherSource: () => void;
  onRetryLyrics: () => void;
}) {
  const lines = useMemo(
    () =>
      parseLyricTimeline(
        lyrics?.text,
        machineTranslation || lyrics?.translation,
      ),
    [lyrics?.text, lyrics?.translation, machineTranslation],
  );
  const activeIndex = findActiveLyricIndex(
    lines,
    playbackPositionMs(position),
    userOffsetMs,
  );
  const provenance = lyricProvenanceLabel(lyrics, current, machineTranslation);
  const scrollView = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const lineOffsets = useRef<Record<number, number>>({});
  const scrollToLine = useCallback((index: number) => {
    const offset = lineOffsets.current[index];
    if (offset === undefined) return;
    scrollView.current?.scrollTo({
      y: Math.max(0, offset - 120),
      animated: true,
    });
  }, []);

  useEffect(() => {
    // Layout coordinates belong to the previous lyric document after a track
    // change, so never reuse them for the next request's timeline.
    lineOffsets.current = {};
  }, [lines]);

  useEffect(() => {
    if (!visible || activeIndex < 0) return;
    scrollToLine(activeIndex);
  }, [activeIndex, scrollToLine, visible]);

  return (
    <Sheet onClose={onClose} title="歌词" visible={visible}>
      <ScrollView contentContainerStyle={styles.lyrics} ref={scrollView}>
        {current ? (
          <Text style={styles.lyricMeta}>
            {trackTitle(current)} ·{' '}
            {providerLabels[trackSource(current)] || trackSource(current)}
          </Text>
        ) : null}
        {provenance ? (
          <Text
            accessibilityLabel={`歌词来源：${provenance}`}
            style={styles.lyricMeta}
          >
            歌词来源：{provenance}
          </Text>
        ) : null}
        {translationEligible ? (
          <View style={styles.translationActions}>
            <Pressable
              accessibilityLabel={
                machineTranslation ? '恢复来源译文' : '翻译当前歌词'
              }
              disabled={translationBusy}
              onPress={
                machineTranslation ? onRestoreSource : onLookupTranslation
              }
              style={styles.translationButton}
            >
              <Text style={styles.actionText}>
                {machineTranslation ? '恢复来源译文' : '翻译当前歌词'}
              </Text>
            </Pressable>
            <Pressable
              accessibilityLabel="重新翻译当前歌词"
              disabled={translationBusy}
              onPress={onRetranslate}
              style={styles.translationButton}
            >
              <Text style={styles.actionText}>重新翻译</Text>
            </Pressable>
          </View>
        ) : null}
        {offsetAvailable ? (
          <View style={styles.offsetControls}>
            <Text
              accessibilityLabel={`本地歌词校正，当前${
                userOffsetMs >= 0 ? '+' : ''
              }${userOffsetMs}毫秒${
                offsetSaving
                  ? '，正在保存'
                  : offsetNotice
                  ? `，${offsetNotice}`
                  : '，已保存'
              }`}
              style={text.meta}
            >
              歌词校正：{userOffsetMs >= 0 ? '+' : ''}
              {userOffsetMs}毫秒
            </Text>
            <View style={styles.offsetActions}>
              <Pressable
                accessibilityLabel="减少歌词校正250毫秒"
                accessibilityRole="button"
                accessibilityState={{
                  disabled:
                    offsetSaving || userOffsetMs <= -MAX_LYRIC_OFFSET_MS,
                }}
                disabled={offsetSaving || userOffsetMs <= -MAX_LYRIC_OFFSET_MS}
                onPress={() => onAdjustOffset(-250)}
                style={styles.translationButton}
              >
                <Text style={styles.actionText}>-250毫秒</Text>
              </Pressable>
              <Pressable
                accessibilityLabel="增加歌词校正250毫秒"
                accessibilityRole="button"
                accessibilityState={{
                  disabled: offsetSaving || userOffsetMs >= MAX_LYRIC_OFFSET_MS,
                }}
                disabled={offsetSaving || userOffsetMs >= MAX_LYRIC_OFFSET_MS}
                onPress={() => onAdjustOffset(250)}
                style={styles.translationButton}
              >
                <Text style={styles.actionText}>+250毫秒</Text>
              </Pressable>
            </View>
            {offsetNotice ? (
              <Text accessibilityLiveRegion="polite" style={text.meta}>
                {offsetNotice}
              </Text>
            ) : null}
          </View>
        ) : offsetReason ? (
          <Text style={text.meta}>{offsetReason}</Text>
        ) : null}
        {machineTranslation ? (
          <Text style={styles.machineBadge}>DeepSeek 机器翻译</Text>
        ) : null}
        {translationBusy ? (
          <Text style={text.meta}>正在处理歌词翻译…</Text>
        ) : null}
        {translationError ? (
          <Text style={styles.translationError}>
            翻译未应用：{translationError}
          </Text>
        ) : null}
        {lyricFailure ? (
          <View accessibilityLiveRegion="polite" style={styles.lyricFailure}>
            <Text
              accessibilityLabel={`歌词状态：${lyricFailure.title}。${lyricFailure.message}`}
              style={styles.translationError}
            >
              {lyricFailure.title}：{lyricFailure.message}
            </Text>
            <Pressable
              accessibilityLabel={
                lyricFailure.action === 'retry'
                  ? '重试加载歌词'
                  : '选择其他歌曲'
              }
              accessibilityRole="button"
              onPress={
                lyricFailure.action === 'retry'
                  ? onRetryLyrics
                  : onChooseAnotherSource
              }
              style={styles.translationButton}
            >
              <Text style={styles.actionText}>
                {lyricFailure.action === 'retry' ? '重试歌词' : '选择其他歌曲'}
              </Text>
            </Pressable>
          </View>
        ) : null}
        {loading ? (
          <Text style={text.meta}>正在加载歌词…</Text>
        ) : lines.length ? (
          <>
            {lines.map((line, index) => (
              <View
                key={`${line.timestampMs ?? 'plain'}-${line.text}-${index}`}
                onLayout={event => {
                  lineOffsets.current[index] = event.nativeEvent.layout.y;
                  if (visible && index === activeIndex) scrollToLine(index);
                }}
                style={styles.lyricRow}
              >
                <Text
                  accessibilityLabel={lyricRowAccessibilityLabel(
                    line,
                    index === activeIndex,
                    userOffsetMs,
                    provenance,
                  )}
                  accessibilityLiveRegion={
                    index === activeIndex ? 'polite' : 'none'
                  }
                  accessibilityState={{ selected: index === activeIndex }}
                  style={[
                    styles.lyricLine,
                    index === activeIndex && styles.activeLyricLine,
                  ]}
                >
                  {line.text}
                </Text>
                {line.translation ? (
                  <Text
                    style={[
                      styles.translationLine,
                      index === activeIndex && styles.activeTranslationLine,
                    ]}
                  >
                    {line.translation}
                  </Text>
                ) : null}
              </View>
            ))}
          </>
        ) : (
          <View style={styles.noLyrics}>
            <Text style={text.heading}>
              {localAudio
                ? '本地音频暂不提供网络歌词'
                : unavailable
                ? '该来源暂无可用歌词'
                : '暂时没有歌词'}
            </Text>
            <Text style={text.meta}>
              {localAudio
                ? '播放不受影响；为了保护本地文件信息，应用不会为它请求网络歌词。'
                : '歌词不可用不会影响播放。请稍后重试或选择其他歌曲。'}
            </Text>
          </View>
        )}
      </ScrollView>
    </Sheet>
  );
}

function playbackPositionMs(position: number): number {
  if (!Number.isFinite(position)) return 0;
  // Track Player and the Redux player state use seconds; the LRC axis uses ms.
  return Math.max(0, position * 1_000);
}
function invoke(dispatch: any, names: string[], value?: unknown) {
  for (const name of names) {
    const action = (playerActions as any)[name];
    if (action) {
      dispatch(value === undefined ? action() : action(value));
      return;
    }
  }
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  top: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
  },
  iconButton: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: { color: colors.text, fontSize: 32 },
  source: { ...text.body, color: colors.muted },
  content: {
    alignItems: 'center',
    gap: spacing.xl,
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  artFrame: {
    width: '100%',
    aspectRatio: 1,
    maxWidth: 360,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: colors.placeholder,
  },
  artwork: { width: '100%', height: '100%' },
  placeholder: { color: colors.muted, fontSize: 72 },
  trackCopy: { width: '100%', alignItems: 'center', gap: spacing.sm },
  progressBlock: { width: '100%', gap: spacing.xs },
  track: {
    height: 4,
    overflow: 'hidden',
    borderRadius: 2,
    backgroundColor: colors.border,
  },
  progress: { height: 4, backgroundColor: colors.accent },
  times: { flexDirection: 'row', justifyContent: 'space-between' },
  controls: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    alignItems: 'center',
  },
  control: {
    minWidth: 56,
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlIcon: { color: colors.text, fontSize: 20 },
  primaryControl: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.accent,
  },
  primaryIcon: { color: colors.text, fontSize: 28 },
  actions: { width: '100%', flexDirection: 'row', gap: spacing.md },
  audioEffects: { width: '100%', gap: spacing.sm },
  effectsActions: { flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' },
  effectButton: {
    minHeight: 38,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: colors.surface,
  },
  action: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: colors.surface,
  },
  actionText: { ...text.body, color: colors.accent, fontWeight: '600' },
  error: {
    width: '100%',
    gap: spacing.xs,
    borderRadius: 12,
    padding: spacing.md,
    backgroundColor: '#321f25',
  },
  errorTitle: { ...text.body, color: '#ff9aa9', fontWeight: '600' },
  noTrack: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.xl,
  },
  sheetContent: { padding: spacing.md },
  queueRow: {
    minHeight: 64,
    gap: spacing.xs,
    justifyContent: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  queueCopy: { minHeight: 48, justifyContent: 'center' },
  queueActions: {
    flexDirection: 'row',
    gap: spacing.xs,
    paddingBottom: spacing.sm,
  },
  queueAction: {
    minWidth: 48,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  queueTools: { gap: spacing.sm, paddingBottom: spacing.md },
  lyrics: { gap: spacing.lg, alignItems: 'center', padding: spacing.lg },
  translationActions: { flexDirection: 'row', gap: spacing.sm },
  offsetControls: { alignItems: 'center', gap: spacing.xs },
  offsetActions: { flexDirection: 'row', gap: spacing.sm },
  translationButton: {
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: spacing.md,
  },
  machineBadge: { color: colors.accent, fontSize: 12, fontWeight: '700' },
  translationError: { color: '#ff9aa9', fontSize: 13 },
  lyricFailure: { alignItems: 'center', gap: spacing.sm },
  lyricMeta: text.meta,
  lyricRow: { width: '100%', alignItems: 'center', gap: spacing.xs },
  lyricLine: { ...text.body, textAlign: 'center' },
  activeLyricLine: { color: colors.accent, fontWeight: '700' },
  translationLine: { ...text.meta, textAlign: 'center' },
  activeTranslationLine: { color: colors.text },
  noLyrics: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xl,
  },
});
