import { NativeModules } from 'react-native';
import type { PlayableTrack } from '../types/music';

type NativeHistory = Record<string, (...args: unknown[]) => unknown>;
export type RecentHistoryChange = 'commit' | 'clear';
let clearGeneration = 0;
let sequence = 0;
let active: { id: string; trackId: string } | null = null;
const recentListeners = new Set<(reason: RecentHistoryChange) => void>();
const native = () => NativeModules.Listen2History as NativeHistory | undefined;
const safe = (track: PlayableTrack) => ({ source: track.source, trackId: track.id, title: track.title.slice(0, 160), artist: track.artist.slice(0, 160) });
const responseData = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const data = (value as { data?: unknown }).data;
  return data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : null;
};
const notifyRecent = (reason: RecentHistoryChange) => {
  recentListeners.forEach(listener => { try { listener(reason); } catch {} });
};
const fire = (method: string, value: Record<string, unknown>) => {
  try {
    const fn = native()?.[method];
    if (typeof fn !== 'function') return;
    const result = Promise.resolve(fn(value));
    if (method === 'observePlayback') void result.then(receipt => {
      const data = responseData(receipt);
      if ((receipt as { status?: unknown } | null)?.status === 'success' && data?.committed === true) notifyRecent('commit');
    }, () => undefined);
  } catch {}
};
function recent(value: unknown): PlayableTrack[] {
  const response = value as { status?: unknown; data?: unknown } | null;
  if (response?.status !== 'success' || !Array.isArray(response.data)) return [];
  const seen = new Set<string>();
  return response.data.flatMap((entry: any) => {
    if (!entry || typeof entry !== 'object' || !['netease', 'kugou', 'kuwo', 'qq', 'bilibili', 'local'].includes(entry.source) || typeof entry.trackId !== 'string' || typeof entry.title !== 'string' || typeof entry.artist !== 'string' || entry.trackId.length > 128 || entry.title.length > 160 || entry.artist.length > 160) return [];
    const key = `${entry.source}:${entry.trackId}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ id: entry.trackId, source: entry.source, title: entry.title, artist: entry.artist } as PlayableTrack];
  });
}
/** Fire-and-forget side channel: no player command awaits native history work. */
export const history = {
  subscribeRecent(listener: (reason: RecentHistoryChange) => void) {
    recentListeners.add(listener);
    return () => recentListeners.delete(listener);
  },
  begin(track: PlayableTrack) {
    const id = `history_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    active = { id, trackId: track.id }; sequence = 0;
    fire('beginPlayback', { playbackInstanceId: id, clearGeneration, ...safe(track), durationMs: track.durationMs || 0, startedElapsedMs: Date.now() });
  },
  observe(track: PlayableTrack | null, kind: 'play' | 'progress' | 'pause' | 'buffer' | 'seek' | 'failure', positionMs?: number) {
    if (!active || !track || active.trackId !== track.id) return;
    sequence += 1;
    fire('observePlayback', { playbackInstanceId: active.id, clearGeneration, sequence, kind, positionMs: positionMs ?? null, observedElapsedMs: Date.now() });
  },
  async clear() {
    const result = await Promise.resolve(native()?.clearHistory?.());
    const data = responseData(result);
    const value = data?.clearGeneration;
    if ((result as { status?: unknown } | null)?.status === 'success' && typeof value === 'number' && Number.isSafeInteger(value) && value >= clearGeneration) {
      clearGeneration = value;
      active = null;
      notifyRecent('clear');
    }
    return result;
  },
  async recordingEnabled() { return native()?.getRecordingPreference?.(); },
  async setRecordingEnabled(enabled: boolean) { return native()?.setRecordingPreference?.(enabled); },
  async getHistory(limit = 100) { return native()?.getHistory?.(limit); },
  async recentTracks() { return recent(await native()?.getHistory?.(100)); },
  async recap(year: number) { return native()?.getRecap?.(year); },
  async exportSafe(year: number) { return native()?.exportSafeHistory?.(year, 500); },
};
