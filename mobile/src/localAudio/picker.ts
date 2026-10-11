import { NativeModules } from 'react-native';

export const MAX_LOCAL_AUDIO_IMPORTS = 500;
export type LocalAudioImport = { status: 'success' | 'cancelled' | 'error'; imported: number; rejected: number };
export type LocalArtwork = { status: 'success' | 'unavailable' | 'error'; data?: string };
export type LocalRecordOperation = 'repaired' | 'mismatch' | 'cancelled' | 'rejected';
type NativeLocal = { importAudio(requestId: string): Promise<unknown>; attachExplicitLrc(recordId: string, requestId: string): Promise<unknown>; loadArtwork(recordId: string): Promise<unknown>; cancelLocalRequest(requestId: string): Promise<unknown>; repairLocalAudio?(recordId: string, requestId: string): Promise<unknown>; removeLocalAudio?(recordId: string, requestId: string): Promise<unknown>; prepareLocalPlayback?(recordId: string, requestId: string): Promise<unknown>; verifyLocalPlayback?(recordId: string, requestId: string): Promise<unknown>; endLocalPlayback?(preservePlaybackRequestId: string | null): Promise<unknown> };
const native = (): NativeLocal => {
  const module = NativeModules.Listen2LocalAudio as NativeLocal | undefined;
  if (!module || typeof module.importAudio !== 'function') throw new Error('NATIVE_UNAVAILABLE');
  return module;
};
let playbackSequence = 0;
const playbackRequestId = () => `local_play_${Date.now().toString(36)}_${++playbackSequence}`;
const validLocalRecordId = (value: string) => /^[A-Za-z0-9-]{16,64}$/.test(value);
function playbackUnavailable(): Error {
  return Object.assign(new Error('local-media-unavailable'), { code: 'local-media-unavailable' });
}
/** Transient RNTP-only transport. Callers must never put this receipt in application state. */
export async function prepareLocalPlayback(recordId: string): Promise<{ privatePlaybackUri: string; playbackRequestId: string; seekable: boolean }> {
  const module = NativeModules?.Listen2LocalAudio as NativeLocal | undefined;
  if (!validLocalRecordId(recordId) || typeof module?.prepareLocalPlayback !== 'function') throw playbackUnavailable();
  const requestId = playbackRequestId();
  let value: unknown;
  try { value = await module.prepareLocalPlayback(recordId, requestId); } catch { throw playbackUnavailable(); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw playbackUnavailable();
  const receipt = value as Record<string, unknown>;
  const keys = ['recordId', 'playbackRequestId', 'status', 'privatePlaybackUri', 'seekable'];
  if (Object.keys(receipt).length !== keys.length || Object.keys(receipt).some(key => !keys.includes(key)) || receipt.recordId !== recordId || receipt.playbackRequestId !== requestId || receipt.status !== 'success' || typeof receipt.privatePlaybackUri !== 'string' || !/^content:\/\/com\.dazzlingwuming\.listen2\.local-media\/play\/[A-Za-z0-9_-]{32,128}$/.test(receipt.privatePlaybackUri) || typeof receipt.seekable !== 'boolean') throw playbackUnavailable();
  return { privatePlaybackUri: receipt.privatePlaybackUri, playbackRequestId: requestId, seekable: receipt.seekable };
}
/** A restore probe receives only a semantic availability receipt, never a token. */
export async function verifyLocalPlayback(recordId: string): Promise<boolean> {
  const module = NativeModules?.Listen2LocalAudio as NativeLocal | undefined;
  if (!validLocalRecordId(recordId) || typeof module?.verifyLocalPlayback !== 'function') return false;
  const requestId = playbackRequestId();
  try {
    const value = await module.verifyLocalPlayback(recordId, requestId);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const receipt = value as Record<string, unknown>;
    return Object.keys(receipt).length === 3 && Object.keys(receipt).every(key => ['recordId', 'playbackRequestId', 'status'].includes(key)) && receipt.recordId === recordId && receipt.playbackRequestId === requestId && receipt.status === 'success';
  } catch { return false; }
}
/** RNTP cleared its one-item queue. Preserve only the exact unopened local replacement. */
export async function endLocalPlayback(preservePlaybackRequestId: string | null = null): Promise<void> {
  const module = NativeModules?.Listen2LocalAudio as NativeLocal | undefined;
  if (!module) return;
  if (typeof module.endLocalPlayback !== 'function') throw playbackUnavailable();
  if (preservePlaybackRequestId !== null && !/^[A-Za-z0-9_-]{1,96}$/.test(preservePlaybackRequestId)) throw playbackUnavailable();
  try { if (await module.endLocalPlayback(preservePlaybackRequestId) !== 'released') throw playbackUnavailable(); } catch { throw playbackUnavailable(); }
}
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
function parseRecordOperation(value: unknown, requestId: string, recordId: string): LocalRecordOperation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'rejected';
  const item = value as Record<string, unknown>;
  if (Object.keys(item).length !== 3 || Object.keys(item).some(key => !['requestId', 'recordId', 'status'].includes(key)) || item.requestId !== requestId || item.recordId !== recordId || !['repaired', 'mismatch', 'cancelled', 'rejected'].includes(String(item.status))) return 'rejected';
  return item.status as LocalRecordOperation;
}
export async function repairLocalAudio(recordId: string): Promise<LocalRecordOperation> {
  if (!/^[A-Za-z0-9-]{16,64}$/.test(recordId)) return 'rejected';
  const requestId = `repair_${Date.now().toString(36)}`;
  try {
    const module = native();
    if (typeof module.repairLocalAudio !== 'function') return 'rejected';
    return parseRecordOperation(await module.repairLocalAudio(recordId, requestId), requestId, recordId);
  } catch { return 'rejected'; }
}
export async function removeLocalAudio(recordId: string): Promise<LocalRecordOperation> {
  if (!/^[A-Za-z0-9-]{16,64}$/.test(recordId)) return 'rejected';
  const requestId = `remove_${Date.now().toString(36)}`;
  try {
    const module = native();
    if (typeof module.removeLocalAudio !== 'function') return 'rejected';
    return parseRecordOperation(await module.removeLocalAudio(recordId, requestId), requestId, recordId);
  } catch { return 'rejected'; }
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
