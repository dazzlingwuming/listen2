import AsyncStorage from '@react-native-async-storage/async-storage';
import { sanitizePlayerState } from '../store/playerPersistence';
import { sha256 } from '../deepseek/client';
import { libraryClient } from './libraryClient';
import type {
  LegacyMigrationRequest,
  LibraryLyricMetadata,
  LibraryQueueCheckpoint,
  LibraryRemoteCollection,
  LibraryTrackRecord,
} from './types';

/** The two records written by the pre-Phase-6 Redux Persist reducers. */
export const LEGACY_LIBRARY_KEY = 'persist:listen2-mobile-library';
export const LEGACY_PLAYER_KEY = 'persist:listen2-mobile';

const MAX_ENTRIES = 2_000;
const MAX_TEXT = 128;
const MAX_SERIALIZED_FIELD = 1_000_000;
const SOURCES = ['netease', 'kugou', 'kuwo', 'qq', 'bilibili', 'local'] as const;
const REMOTE_SOURCES = SOURCES.filter(source => source !== 'local');
const SAFE_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const SAFE_PLAYLIST_ID = /^[A-Za-z0-9._:-]{1,64}$/;

type UnknownRecord = Record<string, unknown>;
type SafeTrack = LibraryTrackRecord;
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

/** Decode one Redux Persist field while preserving the distinction from a missing/broken field. */
function decodeArrayField(root: UnknownRecord, name: string): unknown[] | null {
  if (!Object.prototype.hasOwnProperty.call(root, name)) return null;
  const value = root[name];
  const decoded = typeof value === 'string'
    ? (() => {
        if (value.length > MAX_SERIALIZED_FIELD) return null;
        try { return JSON.parse(value); } catch { return null; }
      })()
    : value;
  // A bounded migration must reject an oversized source, not silently slice it.
  // Slicing would activate a partial library while still allowing the legacy
  // record to look successfully migrated.
  return Array.isArray(decoded) && decoded.length <= MAX_ENTRIES ? decoded : null;
}

function decodeOptionalArrayField(root: UnknownRecord, name: string): unknown[] | undefined | null {
  if (!Object.prototype.hasOwnProperty.call(root, name)) return undefined;
  return decodeArrayField(root, name);
}

/** Redux Persist stores every reducer field as a JSON string inside the outer record. */
function decodePersistedRecord(value: string): UnknownRecord | null {
  if (value.length > MAX_SERIALIZED_FIELD) return null;
  let root: UnknownRecord | null = null;
  try { root = object(JSON.parse(value)); } catch { return null; }
  if (!root) return null;
  const decoded: UnknownRecord = {};
  for (const [key, field] of Object.entries(root)) {
    if (typeof field !== 'string') {
      decoded[key] = field;
      continue;
    }
    if (field.length > MAX_SERIALIZED_FIELD) return null;
    try { decoded[key] = JSON.parse(field); } catch { return null; }
  }
  return decoded;
}

function track(value: unknown, localAllowed = true): SafeTrack | null {
  const item = object(value);
  const source = typeof item?.source === 'string' && SOURCES.includes(item.source as typeof SOURCES[number])
    ? item.source
    : null;
  const trackId = typeof item?.trackId === 'string'
    ? item.trackId
    : typeof item?.id === 'string'
    ? item.id
    : null;
  if (
    !source ||
    (!localAllowed && !REMOTE_SOURCES.includes(source as typeof REMOTE_SOURCES[number])) ||
    !trackId ||
    !SAFE_ID.test(trackId)
  ) return null;
  return {
    source,
    trackId,
    title: text(item?.title ?? item?.name, '未知歌曲'),
    artist: text(item?.artist ?? item?.artists, '未知艺人'),
  } as SafeTrack;
}

function uniqueBy<T>(values: T[], key: (value: T) => string): T[] {
  const seen = new Set<string>();
  return values.filter(value => {
    const identity = key(value);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

function safeTracks(values: unknown[], localAllowed = true): SafeTrack[] {
  return uniqueBy(
    values
      .map(item => track(item, localAllowed))
      .filter((item): item is SafeTrack => item !== null),
    item => `${item.source}:${item.trackId}`,
  );
}

function remoteCollection(value: unknown): LibraryRemoteCollection | null {
  const item = object(value);
  const collectionId = typeof item?.collectionId === 'string'
    ? item.collectionId
    : typeof item?.id === 'string'
    ? item.id
    : null;
  const source = item?.source;
  const title = item?.title;
  const syncState = item?.syncState;
  if (
    !collectionId ||
    !SAFE_ID.test(collectionId) ||
    typeof source !== 'string' ||
    !REMOTE_SOURCES.includes(source as typeof REMOTE_SOURCES[number]) ||
    typeof title !== 'string' ||
    title.trim().length === 0 ||
    title.length > MAX_TEXT ||
    !['ready', 'refreshing', 'error', 'unavailable'].includes(String(syncState))
  ) return null;
  return {
    collectionId,
    source: source as LibraryRemoteCollection['source'],
    title: title.trim(),
    syncState: syncState as LibraryRemoteCollection['syncState'],
  };
}

function queueCheckpoint(value: unknown, position: number): LibraryQueueCheckpoint | null {
  const item = object(value);
  const parsed = track(item?.track ?? item);
  const occurrenceId = typeof item?.occurrenceId === 'string' ? item.occurrenceId : `legacy_queue_${position}`;
  return parsed && SAFE_ID.test(occurrenceId)
    ? { occurrenceId, position, source: parsed.source, trackId: parsed.trackId }
    : null;
}

function lyricMetadata(value: unknown): LibraryLyricMetadata | null {
  const item = object(value);
  const parsed = track(item);
  const offsetMillis = item?.offsetMillis;
  const selectedVariantId = item?.selectedVariantId;
  return parsed &&
    typeof offsetMillis === 'number' &&
    Number.isSafeInteger(offsetMillis) &&
    Math.abs(offsetMillis) <= 86_400_000 &&
    (selectedVariantId === null || selectedVariantId === undefined ||
      (typeof selectedVariantId === 'string' && SAFE_ID.test(selectedVariantId)))
    ? {
        source: parsed.source,
        trackId: parsed.trackId,
        selectedVariantId: typeof selectedVariantId === 'string' ? selectedVariantId : null,
        offsetMillis,
      }
    : null;
}

function safePlayerTrack(value: unknown): UnknownRecord | null {
  const item = object(value);
  if (!item || item.source === 'local') return null;
  // sanitizePlayerState already strips transport URLs from the player reducer;
  // remove artwork URLs too so this migration result is genuinely URL-free.
  const safe = { ...item };
  delete safe.artworkUrl;
  delete safe.artwork;
  delete safe.url;
  delete safe.headers;
  return safe;
}

function safePausedPlayer(value: unknown): ReturnType<typeof sanitizePlayerState> {
  const state = sanitizePlayerState(value);
  const playlist = state.playlist
    .map(safePlayerTrack)
    .filter((item): item is UnknownRecord => item !== null);
  const playNextQueue = state.playNextQueue
    .map(item => {
      const safeTrack = safePlayerTrack(item.track ?? item);
      return safeTrack ? { ...safeTrack, occurrenceId: item.occurrenceId, track: safeTrack } : null;
    })
    .filter(
      (item): item is NonNullable<typeof item> => item !== null,
    );
  const current = safePlayerTrack(state.currentTrack ?? state.nowPlaying);
  const history = state.history
    .map(entry => {
      const safeTrack = safePlayerTrack(entry.track);
      return safeTrack ? { ...entry, track: safeTrack } : null;
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);
  return {
    ...state,
    playlist,
    tracks: playlist,
    queue: playlist,
    playNextQueue,
    history,
    nowPlaying: current,
    currentTrack: current,
    currentIndex: current ? playlist.findIndex(item => item.id === current.id) : -1,
    currentSource: current ? state.currentSource : 'playlist',
    currentOccurrenceId: current ? state.currentOccurrenceId : null,
    // Reopening a migrated app must always be explicitly resumed by the user.
    isPlaying: false,
  } as ReturnType<typeof sanitizePlayerState>;
}

function checksum(exported: Pick<LegacyMigrationRequest, 'playlists' | 'favorites' | 'remoteCollections' | 'queueCheckpoint' | 'lyricMetadata' | 'localEntries'>) {
  const field = (value: string | number | null) => `${String(value ?? '').length}:${String(value ?? '')}`;
  const compareText = (left: string, right: string) => left === right ? 0 : left < right ? -1 : 1;
  const playlists = exported.playlists.slice().sort((left, right) => left.position - right.position || compareText(left.playlistId, right.playlistId));
  const favorites = exported.favorites.slice().sort((left, right) => compareText(left.source, right.source) || compareText(left.trackId, right.trackId));
  const remoteCollections = exported.remoteCollections.slice().sort((left, right) => compareText(left.source, right.source) || compareText(left.title, right.title) || compareText(left.collectionId, right.collectionId));
  const queueCheckpoint = exported.queueCheckpoint.slice().sort((left, right) => left.position - right.position || compareText(left.occurrenceId, right.occurrenceId));
  const lyricMetadata = exported.lyricMetadata.slice().sort((left, right) => compareText(left.source, right.source) || compareText(left.trackId, right.trackId));
  const canonical = [
    ...playlists.map(item => [
      `p${field(item.playlistId)}${field(item.title)}${field(item.position)}\n`,
      ...item.tracks.map(track => `t${field(track.source)}${field(track.trackId)}${field(track.title)}${field(track.artist)}\n`),
    ].join('')),
    ...favorites.map(track => `f${field(track.source)}${field(track.trackId)}${field(track.title)}${field(track.artist)}\n`),
    ...remoteCollections.map(item => `r${field(item.collectionId)}${field(item.source)}${field(item.title)}${field(item.syncState)}\n`),
    ...queueCheckpoint.map(item => `q${field(item.occurrenceId)}${field(item.position)}${field(item.source)}${field(item.trackId)}\n`),
    ...lyricMetadata.map(item => `y${field(item.source)}${field(item.trackId)}${field(item.selectedVariantId)}${field(item.offsetMillis)}\n`),
    ...exported.localEntries.map(item => `l${field(item.title)}${field(item.artist)}\n`),
  ].join('');
  return sha256(canonical);
}

function exportFromRoots(libraryRoot: UnknownRecord, playerRoot: UnknownRecord | null, attemptId: string): LegacyExport | null {
  // The old reducer always wrote playlists and favorites. localTracks was
  // added later, so an absent field is an older (but complete) payload; an
  // explicitly present broken field still means partial input.
  const playlistValues = decodeArrayField(libraryRoot, 'playlists');
  const favoriteValues = decodeArrayField(libraryRoot, 'favorites');
  const localValues = decodeOptionalArrayField(libraryRoot, 'localTracks');
  if (!playlistValues || !favoriteValues || localValues === null) return null;

  const playlists: LegacyMigrationRequest['playlists'] = [];
  for (const [position, raw] of playlistValues.entries()) {
    const item = object(raw);
    // A malformed playlist row is isolated, but its tracks field is a
    // container: a missing, non-array, or oversized tracks list is partial
    // source data and must fail the migration rather than look empty.
    if (!item) continue;
    const rawTracks = Array.isArray(item.tracks) && item.tracks.length <= MAX_ENTRIES ? item.tracks : null;
    if (!rawTracks) return null;
    const parsedTracks = safeTracks(rawTracks);
    const rawId = typeof item.playlistId === 'string' ? item.playlistId : item.id;
    const playlistId = typeof rawId === 'string' && SAFE_PLAYLIST_ID.test(rawId)
      ? rawId
      : `legacy_playlist_${position}`;
    playlists.push({
      playlistId,
      title: text(item.title, '未命名歌单'),
      position,
      tracks: parsedTracks,
    });
  }
  const normalizedPlaylists = uniqueBy(playlists, item => item.playlistId)
    .map((item, position) => ({ ...item, position }));
  // Favorites are row-level legacy data. Keep every independently safe remote
  // row, while isolating unsupported/local/malformed rows and collapsing
  // duplicates before the native primary-key write.
  const favorites = safeTracks(favoriteValues, false);

  const remoteValues = decodeOptionalArrayField(libraryRoot, 'remoteCollections');
  if (remoteValues === null) return null;
  const safeRemoteCollections = uniqueBy(
    (remoteValues ?? [])
      .map(remoteCollection)
      .filter((item): item is LibraryRemoteCollection => item !== null),
    item => item.collectionId,
  );

  const libraryQueueValues = decodeOptionalArrayField(libraryRoot, 'queueCheckpoint');
  const playerQueueValues = playerRoot ? decodeOptionalArrayField(playerRoot, 'playNextQueue') : undefined;
  if (libraryQueueValues === null) return null;
  const queueValues = libraryQueueValues ?? (playerQueueValues ?? []);
  const safeQueue = uniqueBy(
    queueValues
      .map(queueCheckpoint)
      .filter((item): item is LibraryQueueCheckpoint => item !== null),
    item => item.occurrenceId,
  ).map((item, position) => ({ ...item, position }));

  const libraryLyricValues = decodeOptionalArrayField(libraryRoot, 'lyricMetadata');
  const playerLyricValues = playerRoot ? decodeOptionalArrayField(playerRoot, 'lyricMetadata') : undefined;
  if (libraryLyricValues === null) return null;
  const lyricValues = libraryLyricValues ?? (playerLyricValues ?? []);
  const safeLyrics = uniqueBy(
    lyricValues
      .map(lyricMetadata)
      .filter((item): item is LibraryLyricMetadata => item !== null),
    item => `${item.source}:${item.trackId}`,
  );

  const safeLocalEntries = uniqueBy(
    (localValues ?? [])
      .map(value => {
        const item = object(value);
        return item ? { title: text(item.title, '未知本地音乐'), artist: text(item.artist, '未知艺人') } : null;
      })
      .filter((item): item is { title: string; artist: string } => item !== null),
    item => JSON.stringify([item.title, item.artist]),
  );
  const exportedWithoutPlayer = {
    playlists: normalizedPlaylists,
    favorites,
    remoteCollections: safeRemoteCollections,
    queueCheckpoint: safeQueue,
    lyricMetadata: safeLyrics,
    localEntries: safeLocalEntries,
  };
  return {
    schemaVersion: 1,
    attemptId,
    checksum: checksum(exportedWithoutPlayer),
    ...exportedWithoutPlayer,
    pausedPlayer: safePausedPlayer(playerRoot || {}),
  };
}

/**
 * Convert the exact former library record plus the separately approved player
 * record. Never enumerate arbitrary AsyncStorage and never use the player
 * record as a fallback library source.
 */
export function exportLegacyMigration(value: string, attemptId: string, playerValue?: string | null): LegacyExport | null {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(attemptId) || value.length > MAX_SERIALIZED_FIELD) return null;
  let libraryRoot: UnknownRecord | null = null;
  try { libraryRoot = object(JSON.parse(value)); } catch { return null; }
  if (!libraryRoot) return null;
  const playerRoot = playerValue ? decodePersistedRecord(playerValue) : null;
  // The player record is an auxiliary continuity hint. A permanently broken
  // Redux Persist blob must not make the authoritative library un-migratable;
  // exportFromRoots treats null as a safe empty player and still reads any
  // queue/lyric fields present in the library record.
  return exportFromRoots(libraryRoot, playerRoot, attemptId);
}

export async function migrateKnownLegacyLibrary(attemptId: string) {
  let storedLibrary: string | null;
  try {
    storedLibrary = await AsyncStorage.getItem(LEGACY_LIBRARY_KEY);
  } catch {
    return { status: 'storage-error' as const };
  }
  if (!storedLibrary) return { status: 'no-legacy' as const };

  // A queue/lyric value may have lived in the player reducer. Read only this
  // named record; a failure is retryable rather than silently dropping it.
  let storedPlayer: string | null;
  try {
    storedPlayer = await AsyncStorage.getItem(LEGACY_PLAYER_KEY);
  } catch {
    return { status: 'storage-error' as const };
  }
  const exported = exportLegacyMigration(storedLibrary, attemptId, storedPlayer);
  if (!exported) return { status: 'invalid-legacy' as const };
  const request: LegacyMigrationRequest = {
    schemaVersion: exported.schemaVersion,
    attemptId: exported.attemptId,
    checksum: exported.checksum,
    playlists: exported.playlists,
    favorites: exported.favorites,
    remoteCollections: exported.remoteCollections,
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
