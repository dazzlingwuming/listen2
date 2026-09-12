import {
  errorCodes,
  isErrorWithCode,
  pick,
  types,
  type DocumentPickerResponseOpenLongTerm,
} from '@react-native-documents/picker';
import type { LocalTrack } from '../types/music';

export const MAX_LOCAL_AUDIO_IMPORTS = 500;
const MAX_CONTENT_URI_LENGTH = 4096;
const MAX_LOCAL_TEXT_LENGTH = 256;
const AUDIO_EXTENSIONS = new Set([
  'aac',
  'flac',
  'm4a',
  'mp3',
  'ogg',
  'opus',
  'wav',
]);

export type LocalAudioImport =
  | { status: 'cancelled'; tracks: []; rejected: 0 }
  | { status: 'error'; tracks: []; rejected: 0 }
  | { status: 'success'; tracks: LocalTrack[]; rejected: number };

function stableId(value: string): string {
  let hash = 17;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) % 2147483647;
  }
  return `local_${hash.toString(36)}`;
}

function displayTitle(fileName: string): string {
  const withoutExtension = fileName
    .replace(/\.[^.]+$/, '')
    .trim()
    .slice(0, MAX_LOCAL_TEXT_LENGTH);
  return withoutExtension || '未命名音频';
}

function validText(
  value: unknown,
  maximum = MAX_LOCAL_TEXT_LENGTH,
): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.trim().length <= maximum &&
    !Array.from(value).some(character => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127;
    })
  );
}

function audioTypeOrExtension(type: string | null, name: string): boolean {
  if (typeof type === 'string' && /^audio\/[a-z0-9.+-]+$/i.test(type))
    return true;
  const extension = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase();
  return Boolean(extension && AUDIO_EXTENSIONS.has(extension));
}

function isAcceptedDocument(
  item: DocumentPickerResponseOpenLongTerm,
): item is DocumentPickerResponseOpenLongTerm & {
  uri: string;
  name: string;
  bookmarkStatus: 'success';
} {
  return (
    !item.error &&
    item.isVirtual !== true &&
    item.hasRequestedType === true &&
    typeof item.uri === 'string' &&
    item.uri.startsWith('content://') &&
    item.uri.length <= MAX_CONTENT_URI_LENGTH &&
    !/[\r\n]/.test(item.uri) &&
    validText(item.name) &&
    audioTypeOrExtension(item.type, item.name) &&
    item.bookmarkStatus === 'success'
  );
}

/**
 * Convert only persistable, physical Android documents. This is pure so tests
 * can prove that temporary, virtual, invalid, and duplicate selections never
 * enter persisted Redux state.
 */
export function convertPickedLocalAudio(
  documents: readonly DocumentPickerResponseOpenLongTerm[],
): { tracks: LocalTrack[]; rejected: number } {
  const tracks: LocalTrack[] = [];
  const knownUris = new Set<string>();
  const knownIds = new Set<string>();
  let rejected = Math.max(0, documents.length - MAX_LOCAL_AUDIO_IMPORTS);

  documents.slice(0, MAX_LOCAL_AUDIO_IMPORTS).forEach(item => {
    if (!isAcceptedDocument(item) || knownUris.has(item.uri)) {
      rejected += 1;
      return;
    }
    const id = stableId(item.uri);
    if (knownIds.has(id)) {
      rejected += 1;
      return;
    }
    knownUris.add(item.uri);
    knownIds.add(id);
    const fileName = item.name.trim();
    const track: LocalTrack = {
      id,
      source: 'local',
      title: displayTitle(fileName),
      artist: '本地音频',
      contentUri: item.uri,
      fileName,
      accessStatus: 'available',
    };
    if (item.type) track.mimeType = item.type;
    if ('bookmark' in item && typeof item.bookmark === 'string')
      track.bookmark = item.bookmark;
    tracks.push(track);
  });
  return { tracks, rejected };
}

export function isPickerCancellation(error: unknown): boolean {
  return isErrorWithCode(error) && error.code === errorCodes.OPERATION_CANCELED;
}

/** Open documents with Android's persistable URI permission; never copy media. */
export async function pickLocalAudio(): Promise<LocalAudioImport> {
  try {
    const documents = await pick({
      mode: 'open',
      type: [types.audio],
      allowMultiSelection: true,
      requestLongTermAccess: true,
    });
    const converted = convertPickedLocalAudio(documents);
    return { status: 'success', ...converted };
  } catch (error) {
    if (isPickerCancellation(error))
      return { status: 'cancelled', tracks: [], rejected: 0 };
    return { status: 'error', tracks: [], rejected: 0 };
  }
}
