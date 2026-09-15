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

function checksum(playlists: LegacyMigrationRequest['playlists'], localEntries: LegacyMigrationRequest['localEntries']) {
  let hash = 0x811c9dc5;
  const canonical = [...playlists.map(item => `p:${item.title}\n`), ...localEntries.map(item => `l:${item.title}|${item.artist}\n`)].join('');
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

/** Converts only the one known Redux Persist key; arbitrary AsyncStorage is never enumerated. */
export function exportLegacyMigration(value: string, attemptId: string): LegacyExport | null {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(attemptId) || value.length > 1_000_000) return null;
  let root: UnknownRecord | null = null;
  try { root = object(JSON.parse(value)); } catch { return null; }
  if (!root) return null;
  const playlists = decodeField(root, 'playlists').map(item => ({ title: text(object(item)?.title, '未命名歌单') }));
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
    checksum: checksum(safePlaylists, safeLocalEntries),
    playlists: safePlaylists,
    localEntries: safeLocalEntries,
    pausedPlayer: { ...pausedPlayer, isPlaying: false },
  };
}

export async function migrateKnownLegacyLibrary(attemptId: string) {
  const stored = await AsyncStorage.getItem(LEGACY_LIBRARY_KEY);
  if (!stored) return { status: 'no-legacy' as const };
  const exported = exportLegacyMigration(stored, attemptId);
  if (!exported) return { status: 'invalid-legacy' as const };
  const status = await libraryClient.beginLegacyMigration(exported);
  if (status.attemptId !== exported.attemptId || status.checksum !== exported.checksum)
    return { status: 'unconfirmed' as const, exported };
  if (status.phase === 'failed')
    return { status: 'retryable' as const, exported, nativeStatus: status };
  return { status: 'migrated' as const, exported, nativeStatus: status };
}
