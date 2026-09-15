import { NativeEventEmitter, NativeModules } from 'react-native';
import type { PlayableTrack } from '../types/music';

export type CacheOwner = 'temporary' | 'playlist' | 'explicit';
export type CacheStatus =
  | 'queued'
  | 'transferring'
  | 'ready'
  | 'failed'
  | 'cancelled'
  | 'repair-required';
export type CacheEntry = {
  operationId: string;
  source: string;
  trackId: string;
  title: string;
  artist: string;
  owners: CacheOwner[];
  status: CacheStatus;
  downloadedBytes: number;
  totalBytes: number;
  errorCode: string | null;
  updatedAt: number;
};
export type CacheSnapshot = {
  usedBytes: number;
  reservedBytes: number;
  quotaBytes: number | null;
  entries: CacheEntry[];
};
const native = NativeModules?.Listen2OfflineAudio as
  | Record<string, unknown>
  | undefined;
const empty: CacheSnapshot = {
  usedBytes: 0,
  reservedBytes: 0,
  quotaBytes: 2 * 1024 ** 3,
  entries: [],
};
const safeId = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(value);
const cacheableSources = new Set(['netease', 'kugou']);
export const isOfflineDownloadEligible = (track: PlayableTrack) =>
  !('local' in track && track.local === true) &&
  cacheableSources.has(track.source) &&
  safeId(track.id);
function snapshot(value: unknown): CacheSnapshot {
  if (!value || typeof value !== 'object') return empty;
  const raw = value as Record<string, unknown>;
  const entries = Array.isArray(raw.entries)
    ? raw.entries.flatMap(value => {
        const item = value as Record<string, unknown>;
        const source = item.source;
        const trackId = item.trackId;
        if (
          !safeId(source) ||
          !safeId(trackId) ||
          typeof item.operationId !== 'string' ||
          typeof item.title !== 'string' ||
          typeof item.artist !== 'string' ||
          ![
            'queued',
            'transferring',
            'downloading',
            'ready',
            'failed',
            'cancelled',
            'repair-required',
          ].includes(String(item.status))
        )
          return [];
        const owners = Array.isArray(item.owners)
          ? (item.owners.filter(
              owner =>
                owner === 'temporary' ||
                owner === 'playlist' ||
                owner === 'explicit',
            ) as CacheOwner[])
          : [];
        return [
          {
            operationId: item.operationId.slice(0, 96),
            source,
            trackId,
            title: item.title.slice(0, 256),
            artist: item.artist.slice(0, 256),
            owners,
            status:
              item.status === 'downloading'
                ? 'transferring'
                : (item.status as CacheStatus),
            downloadedBytes: Number.isSafeInteger(item.downloadedBytes)
              ? Number(item.downloadedBytes)
              : 0,
            totalBytes: Number.isSafeInteger(item.totalBytes)
              ? Number(item.totalBytes)
              : 0,
            errorCode:
              typeof item.errorCode === 'string'
                ? item.errorCode.slice(0, 64)
                : null,
            updatedAt: Number.isSafeInteger(item.updatedAt)
              ? Number(item.updatedAt)
              : 0,
          },
        ];
      })
    : [];
  return {
    usedBytes: Number.isSafeInteger(raw.usedBytes) ? Number(raw.usedBytes) : 0,
    reservedBytes: Number.isSafeInteger(raw.reservedBytes)
      ? Number(raw.reservedBytes)
      : 0,
    quotaBytes:
      raw.quotaBytes === null ||
      (Number.isSafeInteger(raw.quotaBytes) && Number(raw.quotaBytes) > 0)
        ? (raw.quotaBytes as number | null)
        : empty.quotaBytes,
    entries,
  };
}
async function call(name: string, ...args: unknown[]) {
  const fn = native?.[name];
  if (typeof fn !== 'function') return empty;
  return snapshot(
    await (fn as (...items: unknown[]) => Promise<unknown>)(...args),
  );
}
export const offlineAudio = {
  list: () => call('cacheSnapshot'),
  requestExplicit: (track: PlayableTrack) =>
    isOfflineDownloadEligible(track)
      ? call('requestExplicitCache', {
          source: track.source,
          trackId: track.id,
          title: track.title,
          artist: track.artist,
        })
      : Promise.resolve(empty),
  promote: (source: string, trackId: string) =>
    safeId(source) && safeId(trackId)
      ? call('promoteCache', source, trackId)
      : Promise.resolve(empty),
  action: (
    action: 'cancel' | 'retry' | 'repair' | 'remove' | 'clearEligible',
    value?: string,
  ) => call('cacheAction', action, value || ''),
  invalidate: (source: string, trackId: string) =>
    safeId(source) && safeId(trackId)
      ? call('invalidate', source, trackId)
      : Promise.resolve(empty),
  setQuota: (bytes: number | null) =>
    bytes === null || [1, 2, 5, 10].includes(bytes / 1024 ** 3)
      ? call('setCacheQuota', bytes)
      : Promise.resolve(empty),
  async resolveReady(source: string, trackId: string) {
    if (!safeId(source) || !safeId(trackId) || !native?.resolveVerified)
      return { status: 'miss' as const };
    const raw = (await (native.resolveVerified as Function)(
      source,
      trackId,
    )) as Record<string, unknown>;
    return raw.status === 'hit' &&
      typeof raw.uri === 'string' &&
      raw.uri.startsWith('content://')
      ? {
          status: 'hit' as const,
          uri: raw.uri,
          mimeType:
            typeof raw.mimeType === 'string'
              ? raw.mimeType
              : 'application/octet-stream',
        }
      : { status: 'miss' as const };
  },
  subscribe(listener: (next: CacheSnapshot) => void) {
    if (!native) return () => {};
    const subscription = new NativeEventEmitter(native as any).addListener(
      'catalogChanged',
      value => listener(snapshot(value)),
    );
    return () => subscription.remove();
  },
};
