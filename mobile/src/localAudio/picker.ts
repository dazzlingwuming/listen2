import { NativeModules } from 'react-native';

export const MAX_LOCAL_AUDIO_IMPORTS = 500;
export type LocalAudioImport = { status: 'success' | 'cancelled' | 'error'; imported: number; rejected: number };
export type LocalArtwork = { status: 'success' | 'unavailable' | 'error'; data?: string };
type NativeLocal = { importAudio(requestId: string): Promise<unknown>; attachExplicitLrc(recordId: string, requestId: string): Promise<unknown>; loadArtwork(recordId: string): Promise<unknown>; cancelLocalRequest(requestId: string): Promise<unknown> };
const native = (): NativeLocal => {
  const module = NativeModules.Listen2LocalAudio as NativeLocal | undefined;
  if (!module || typeof module.importAudio !== 'function') throw new Error('NATIVE_UNAVAILABLE');
  return module;
};
function parse(value: unknown, requestId: string): LocalAudioImport {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { status: 'error', imported: 0, rejected: 0 };
  const item = value as Record<string, unknown>;
  const keys = ['requestId', 'status', 'imported', 'duplicates', 'unsupported', 'unreadable', 'cancelled', 'records'];
  if (Object.keys(item).length !== keys.length || Object.keys(item).some(key => !keys.includes(key)) || item.requestId !== requestId || !['success', 'cancelled', 'rejected', 'unavailable'].includes(String(item.status)) || !['imported', 'duplicates', 'unsupported', 'unreadable', 'cancelled'].every(key => Number.isSafeInteger(item[key]) && (item[key] as number) >= 0 && (item[key] as number) <= MAX_LOCAL_AUDIO_IMPORTS) || !Array.isArray(item.records) || item.records.length !== 0) return { status: 'error', imported: 0, rejected: 0 };
  const rejected = (item.duplicates as number) + (item.unsupported as number) + (item.unreadable as number);
  return item.status === 'success' ? { status: 'success', imported: item.imported as number, rejected } : { status: item.status === 'cancelled' ? 'cancelled' : 'error', imported: 0, rejected };
}
/** Starts the system picker; JS never receives a URI, bookmark, path, filename, or descriptor. */
export async function pickLocalAudio(): Promise<LocalAudioImport> {
  const requestId = `local_${Date.now().toString(36)}`;
  try { return parse(await native().importAudio(requestId), requestId); } catch { return { status: 'error', imported: 0, rejected: 0 }; }
}
export async function attachExplicitLrc(recordId: string): Promise<'success' | 'cancelled' | 'error'> {
  if (!/^[A-Za-z0-9-]{16,64}$/.test(recordId) || typeof native().attachExplicitLrc !== 'function') return 'error';
  const requestId = `lrc_${Date.now().toString(36)}`;
  try { return parse(await native().attachExplicitLrc(recordId, requestId), requestId).status; } catch { return 'error'; }
}
/** Artwork is transient screen data, not a Redux, backup, route, or accessibility value. */
export async function loadLocalArtwork(recordId: string): Promise<LocalArtwork> {
  if (!/^[A-Za-z0-9-]{16,64}$/.test(recordId) || typeof native().loadArtwork !== 'function') return { status: 'error' };
  try {
    const value = await native().loadArtwork(recordId);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { status: 'error' };
    const item = value as Record<string, unknown>;
    if (Object.keys(item).length !== 3 || Object.keys(item).some(key => !['recordId', 'status', 'data'].includes(key)) || item.recordId !== recordId || !['success', 'unavailable', 'rejected'].includes(String(item.status)) || !(item.data === null || (typeof item.data === 'string' && item.data.length > 0 && item.data.length <= 700_000 && /^[A-Za-z0-9+/]+={0,2}$/.test(item.data)))) return { status: 'error' };
    return item.status === 'success' && typeof item.data === 'string' ? { status: 'success', data: `data:image/*;base64,${item.data}` } : { status: 'unavailable' };
  } catch { return { status: 'error' }; }
}
