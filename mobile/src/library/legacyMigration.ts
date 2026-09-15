import AsyncStorage from '@react-native-async-storage/async-storage';
import { sanitizePlayerState } from '../store/playerPersistence';
import { libraryClient } from './libraryClient';
import type { LegacyMigrationRequest } from './types';

export const LEGACY_LIBRARY_KEY = 'listen2-mobile-library';
const MAX_ENTRIES = 2_000;
const MAX_TEXT = 128;

type UnknownRecord = Record<string, unknown>;
type LegacyExport = LegacyMigrationRequest & {
  pausedPlayer: ReturnType<typeof sanitizePlayerState>;
};

function object(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function text(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_TEXT
    ? value.trim()
    : fallback;
}

function decodeField(root: UnknownRecord, name: string) {
  const value = root[name];
  if (typeof value !== 'string' || value.length > 1_000_000) return [];
  try {
    const decoded = JSON.parse(value);
    return Array.isArray(decoded) ? decoded.slice(0, MAX_ENTRIES) : [];
  } catch {
    return [];
  }
}

function checksum(exported: Pick<LegacyMigrationRequest, 'playlists' | 'favorites' | 'queueCheckpoint' | 'lyricMetadata' | 'localEntries'>) {
  let hash = 0x811c9dc5;
  const canonical = [
    ...exported.playlists.map(item => [
      `p:${item.playlistId}|${item.title}|${item.position}\n`,
      ...item.tracks.map(track => `t:${track.source}|${track.trackId}|${track.title}|${track.artist}\n`),
    ].join('')),
    ...exported.favorites.map(track => `f:${track.source}|${track.trackId}|${track.title}|${track.artist}\n`),
    ...exported.queueCheckpoint.map(item => `q:${item.occurrenceId}|${item.position}|${item.source}|${item.trackId}\n`),
    ...exported.lyricMetadata.map(item => `y:${item.source}|${item.trackId}|${item.selectedVariantId ?? ''}|${item.offsetMillis}\n`),
    ...exported.localEntries.map(item => `l:${item.title}|${item.artist}\n`),
  ].join('');
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

const SOURCES = ['netease', 'kugou', 'kuwo', 'qq', 'bilibili', 'local'] as const;
const REMOTE_SOURCES = SOURCES.filter(source => source !== 'local');
const SAFE_ID = /^[A-Za-z0-9._:-]{1,128}$/;
function track(value: unknown, localAllowed = true) {
  const item = object(value);
  const source = typeof item?.source === 'string' && SOURCES.includes(item.source as typeof SOURCES[number]) ? item.source : null;
  const trackId = typeof item?.trackId === 'string' ? item.trackId : typeof item?.id === 'string' ? item.id : null;
  if (!source || (!localAllowed && !REMOTE_SOURCES.includes(source as typeof REMOTE_SOURCES[number])) || !trackId || !SAFE_ID.test(trackId)) return null;
  return { source, trackId, title: text(item?.title, '未知歌曲'), artist: text(item?.artist, '未知艺人') } as LegacyMigrationRequest['favorites'][number];
}

/** Converts only the one known Redux Persist key; arbitrary AsyncStorage is never enumerated. */
export function exportLegacyMigration(value: string, attemptId: string): LegacyExport | null {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(attemptId) || value.length > 1_000_000) return null;
  let root: UnknownRecord | null = null;
  try { root = object(JSON.parse(value)); } catch { return null; }
  if (!root) return null;
  const playlists = decodeField(root, 'playlists').map((item, position) => {
    const playlist = object(item);
    const playlistId = typeof playlist?.playlistId === 'string' ? playlist.playlistId : typeof playlist?.id === 'string' ? playlist.id : `legacy_playlist_${position}`;
    return {
      playlistId: SAFE_ID.test(playlistId) ? playlistId : `legacy_playlist_${position}`,
      title: text(playlist?.title, '未命名歌单'),
      position,
      tracks: (Array.isArray(playlist?.tracks) ? playlist.tracks : []).map(item => track(item)).filter((item): item is NonNullable<typeof item> => item !== null),
    };
  });
  const favorites = decodeField(root, 'favorites').map(item => track(item, false)).filter((item): item is NonNullable<typeof item> => item !== null);
  const queueCheckpoint = decodeField(root, 'queueCheckpoint').map((item, position) => {
    const checkpoint = object(item); const value = track(checkpoint);
    const occurrenceId = typeof checkpoint?.occurrenceId === 'string' ? checkpoint.occurrenceId : `legacy_queue_${position}`;
    return value && SAFE_ID.test(occurrenceId) ? { occurrenceId, position, source: value.source, trackId: value.trackId } : null;
  }).filter((item): item is NonNullable<typeof item> => item !== null);
  const lyricMetadata = decodeField(root, 'lyricMetadata').map(item => {
    const metadata = object(item); const value = track(metadata);
    const offsetMillis = metadata?.offsetMillis;
    const selectedVariantId = typeof metadata?.selectedVariantId === 'string' && SAFE_ID.test(metadata.selectedVariantId) ? metadata.selectedVariantId : null;
    return value && typeof offsetMillis === 'number' && Number.isSafeInteger(offsetMillis) && Math.abs(offsetMillis) <= 86_400_000
      ? { source: value.source, trackId: value.trackId, selectedVariantId, offsetMillis } : null;
  }).filter((item): item is NonNullable<typeof item> => item !== null);
  const localEntries = decodeField(root, 'localTracks').map(item => {
    const local = object(item);
    return { title: text(local?.title, '未知本地音乐'), artist: text(local?.artist, '未知艺人') };
  });
  const playerRaw = typeof root.player === 'string' ? root.player : '{}';
  let playerValue: unknown = {};
  try { playerValue = JSON.parse(playerRaw); } catch { /* preserve a safe empty paused checkpoint */ }
  const pausedPlayer = sanitizePlayerState(playerValue);
  const safePlaylists = playlists.slice(0, MAX_ENTRIES);
  const safeLocalEntries = localEntries.slice(0, MAX_ENTRIES);
  return {
    schemaVersion: 1,
    attemptId,
    checksum: checksum({ playlists: safePlaylists, favorites, queueCheckpoint, lyricMetadata, localEntries: safeLocalEntries }),
    playlists: safePlaylists,
    favorites,
    queueCheckpoint,
    lyricMetadata,
    localEntries: safeLocalEntries,
    pausedPlayer: { ...pausedPlayer, isPlaying: false },
  };
}

export async function migrateKnownLegacyLibrary(attemptId: string) {
  const stored = await AsyncStorage.getItem(LEGACY_LIBRARY_KEY);
  if (!stored) return { status: 'no-legacy' as const };
  const exported = exportLegacyMigration(stored, attemptId);
  if (!exported) return { status: 'invalid-legacy' as const };
  // Player UI state is deliberately not a native migration field; only bounded semantic rows cross.
  const request: LegacyMigrationRequest = {
    schemaVersion: exported.schemaVersion,
    attemptId: exported.attemptId,
    checksum: exported.checksum,
    playlists: exported.playlists,
    favorites: exported.favorites,
    queueCheckpoint: exported.queueCheckpoint,
    lyricMetadata: exported.lyricMetadata,
    localEntries: exported.localEntries,
  };
  const status = await libraryClient.beginLegacyMigration(request);
  if (status.attemptId !== exported.attemptId || status.checksum !== exported.checksum)
    return { status: 'unconfirmed' as const, exported };
  if (status.phase === 'failed')
    return { status: 'retryable' as const, exported, nativeStatus: status };
  return { status: 'migrated' as const, exported, nativeStatus: status };
}
