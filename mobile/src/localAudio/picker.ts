import { NativeModules } from 'react-native';

export const MAX_LOCAL_AUDIO_IMPORTS = 500;
export type LocalAudioImport = { status: 'success' | 'cancelled' | 'error'; imported: number; rejected: number };
type NativeLocal = { importAudio(requestId: string): Promise<unknown>; cancelLocalRequest(requestId: string): Promise<unknown> };
const native = (): NativeLocal => {
  const module = NativeModules.Listen2LocalAudio as NativeLocal | undefined;
  if (!module || typeof module.importAudio !== 'function') throw new Error('NATIVE_UNAVAILABLE');
  return module;
};
function parse(value: unknown, requestId: string): LocalAudioImport {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { status: 'error', imported: 0, rejected: 0 };
  const item = value as Record<string, unknown>;
  if (item.requestId !== requestId || !['success', 'cancelled', 'rejected', 'unavailable'].includes(String(item.status)) || !Number.isSafeInteger(item.imported) || !Number.isSafeInteger(item.unsupported)) return { status: 'error', imported: 0, rejected: 0 };
  return item.status === 'success' ? { status: 'success', imported: item.imported as number, rejected: item.unsupported as number } : { status: item.status === 'cancelled' ? 'cancelled' : 'error', imported: 0, rejected: item.unsupported as number };
}
/** Starts the system picker; JS never receives a URI, bookmark, path, filename, or descriptor. */
export async function pickLocalAudio(): Promise<LocalAudioImport> {
  const requestId = `local_${Date.now().toString(36)}`;
  try { return parse(await native().importAudio(requestId), requestId); } catch { return { status: 'error', imported: 0, rejected: 0 }; }
}
