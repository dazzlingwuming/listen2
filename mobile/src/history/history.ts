import { NativeModules } from 'react-native';
import type { PlayableTrack } from '../types/music';

type NativeHistory = Record<string, (...args: any[]) => Promise<unknown>>;
let clearGeneration = 0;
let sequence = 0;
let active: { id: string; trackId: string } | null = null;
const native = () => NativeModules.Listen2History as NativeHistory | undefined;
const safe = (track: PlayableTrack) => ({ source: track.source, trackId: track.id, title: track.title.slice(0, 160), artist: track.artist.slice(0, 160) });
const fire = (method: string, value: Record<string, unknown>) => { try { const fn = native()?.[method]; if (typeof fn === 'function') void fn(value).catch(() => undefined); } catch {} };
/** Fire-and-forget side channel: no player command awaits native history work. */
export const history = {
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
  async clear() { const result: any = await native()?.clearHistory?.(); const value = result?.data?.clearGeneration; if (typeof value === 'number') { clearGeneration = value; active = null; } return result; },
  async recordingEnabled() { return native()?.getRecordingPreference?.(); },
  async setRecordingEnabled(enabled: boolean) { return native()?.setRecordingPreference?.(enabled); },
  async getHistory(limit = 100) { return native()?.getHistory?.(limit); },
  async recap(year: number) { return native()?.getRecap?.(year); },
  async exportSafe(year: number) { return native()?.exportSafeHistory?.(year, 500); },
};
