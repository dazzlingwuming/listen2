import { NativeEventEmitter, NativeModules } from 'react-native';
import { isLocalTrack, type PlayableTrack } from '../types/music';

export type DownloadStatus =
  | 'queued'
  | 'downloading'
  | 'ready'
  | 'failed'
  | 'cancelled';
export type DownloadEntry = {
  operationId: string;
  source: 'netease' | 'kugou';
  trackId: string;
  title: string;
  artist: string;
  status: DownloadStatus;
  downloadedBytes: number;
  totalBytes: number;
  errorCode: string | null;
  updatedAt: number;
};
export type DownloadSnapshot = {
  usedBytes: number;
  quotaBytes: number;
  entries: DownloadEntry[];
};
const module = NativeModules.Listen2OfflineAudio as
  | Record<string, unknown>
  | undefined;
const empty: DownloadSnapshot = {
  usedBytes: 0,
  quotaBytes: 512 * 1024 * 1024,
  entries: [],
};
const eligibleId = (source: unknown, id: unknown) =>
  (source === 'netease' &&
    typeof id === 'string' &&
    /^netrack_[1-9][0-9]{0,17}$/.test(id)) ||
  (source === 'kugou' &&
    typeof id === 'string' &&
    /^kgtrack_[A-Za-z0-9]{8,128}$/.test(id));
export function isOfflineDownloadEligible(track: PlayableTrack): boolean {
  return !isLocalTrack(track) && eligibleId(track.source, track.id);
}
function snapshot(value: unknown): DownloadSnapshot {
  if (!value || typeof value !== 'object') return empty;
  const raw = value as Record<string, unknown>;
  const entries = Array.isArray(raw.entries)
    ? raw.entries.flatMap(value => {
        const e = value as Record<string, unknown>;
        if (
          !eligibleId(e.source, e.trackId) ||
          typeof e.operationId !== 'string' ||
          typeof e.title !== 'string' ||
          typeof e.artist !== 'string' ||
          !['queued', 'downloading', 'ready', 'failed', 'cancelled'].includes(
            String(e.status),
          )
        )
          return [];
        const ints = ['downloadedBytes', 'totalBytes', 'updatedAt'] as const;
        if (ints.some(k => !Number.isSafeInteger(e[k]) || Number(e[k]) < 0))
          return [];
        return [
          {
            operationId: e.operationId,
            source: e.source as 'netease' | 'kugou',
            trackId: e.trackId as string,
            title: e.title.slice(0, 256),
            artist: e.artist.slice(0, 256),
            status: e.status as DownloadStatus,
            downloadedBytes: Number(e.downloadedBytes),
            totalBytes: Number(e.totalBytes),
            errorCode:
              typeof e.errorCode === 'string' ? e.errorCode.slice(0, 64) : null,
            updatedAt: Number(e.updatedAt),
          },
        ];
      })
    : [];
  return {
    usedBytes:
      Number.isSafeInteger(raw.usedBytes) && Number(raw.usedBytes) >= 0
        ? Number(raw.usedBytes)
        : 0,
    quotaBytes:
      Number.isSafeInteger(raw.quotaBytes) && Number(raw.quotaBytes) > 0
        ? Number(raw.quotaBytes)
        : empty.quotaBytes,
    entries,
  };
}
async function call(
  name: string,
  ...args: unknown[]
): Promise<DownloadSnapshot> {
  const fn = module?.[name];
  if (typeof fn !== 'function') return empty;
  try {
    return snapshot(
      await (fn as (...a: unknown[]) => Promise<unknown>)(...args),
    );
  } catch {
    return empty;
  }
}
export const offlineAudio = {
  listDownloads: () => call('listDownloads'),
  enqueueDownload: (track: PlayableTrack) =>
    isOfflineDownloadEligible(track)
      ? call('enqueueDownload', {
          source: track.source,
          trackId: track.id,
          title: track.title,
          artist: track.artist,
          album: track.album,
          durationMs: track.durationMs,
        })
      : Promise.resolve(empty),
  cancelDownload: (id: string) => call('cancelDownload', id),
  retryDownload: (s: string, id: string) =>
    eligibleId(s, id) ? call('retryDownload', s, id) : Promise.resolve(empty),
  removeDownload: (s: string, id: string) =>
    eligibleId(s, id) ? call('removeDownload', s, id) : Promise.resolve(empty),
  clearDownloads: () => call('clearDownloads'),
  invalidate: (s: string, id: string) =>
    eligibleId(s, id) ? call('invalidate', s, id) : Promise.resolve(empty),
  async resolveVerified(
    s: string,
    id: string,
  ): Promise<
    | { status: 'hit'; uri: string; mimeType: string }
    | { status: 'miss' | 'corrupt' }
  > {
    if (!eligibleId(s, id) || !module?.resolveVerified)
      return { status: 'miss' };
    try {
      const v = (await (module.resolveVerified as Function)(s, id)) as Record<
        string,
        unknown
      >;
      return v.status === 'hit' &&
        typeof v.uri === 'string' &&
        v.uri.startsWith('content://') &&
        typeof v.mimeType === 'string'
        ? { status: 'hit', uri: v.uri, mimeType: v.mimeType }
        : { status: v.status === 'corrupt' ? 'corrupt' : 'miss' };
    } catch {
      return { status: 'miss' };
    }
  },
  subscribe(listener: (value: DownloadSnapshot) => void) {
    if (!module) return () => {};
    const emitter = new NativeEventEmitter(module as any);
    const subscription = emitter.addListener('catalogChanged', (v: unknown) =>
      listener(snapshot(v)),
    );
    return () => subscription.remove();
  },
};
