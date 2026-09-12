import type { Track } from '../types/music';

/**
 * The mobile backup is deliberately a small, metadata-only interchange
 * format.  It is not a general Redux/state serializer: credentials, local
 * files and transport details must never become portable data.
 */
export const BACKUP_FORMAT = 'listen2-mobile-backup';
export const BACKUP_VERSION = 1;

export const BACKUP_LIMITS = Object.freeze({
  maxBytes: 5 * 1024 * 1024,
  maxPlaylists: 500,
  maxTracksPerPlaylist: 5000,
  maxQueueTracks: 5000,
  maxTotalTracks: 50000,
  maxIdLength: 200,
  maxTitleLength: 80,
  maxTextLength: 256,
  maxArtworkUrlLength: 4096,
  maxDurationMs: 24 * 60 * 60 * 1000,
});

export type QueueMode = 'playlist' | 'play-next';

export type BackupPlaylist = {
  id: string;
  title: string;
  tracks: Track[];
};

export type BackupSnapshot = {
  favorites: Track[];
  playlists: BackupPlaylist[];
  queue: Track[];
  queueMode?: QueueMode;
};

export type BackupDocument = {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  exportedAt: string;
  favorites: Track[];
  playlists: BackupPlaylist[];
  queue: Track[];
  queueMode: QueueMode;
};

export type BackupErrorCode =
  | 'INVALID_JSON'
  | 'INVALID_BACKUP'
  | 'UNSUPPORTED_VERSION'
  | 'BACKUP_TOO_LARGE'
  | 'UNSAFE_FIELD'
  | 'INVALID_TRACK'
  | 'INVALID_PLAYLIST';

export class BackupValidationError extends Error {
  readonly code: BackupErrorCode;

  constructor(code: BackupErrorCode, message: string) {
    super(message);
    this.name = 'BackupValidationError';
    this.code = code;
  }
}

export type BackupPreview = {
  version: number;
  bytes: number;
  favorites: number;
  playlists: number;
  playlistTracks: number;
  queueTracks: number;
  totalTracks: number;
  queueMode: QueueMode;
};

export type BackupImportState = {
  favorites: Track[];
  playlists: BackupPlaylist[];
  queue: Track[];
  queueMode?: QueueMode;
};

export type ImportMode = 'merge' | 'overwrite';

export type ImportPlanSummary = {
  mode: ImportMode;
  addedFavorites: number;
  addedPlaylists: number;
  skippedPlaylists: number;
  conflictedPlaylists: number;
  queueTracks: number;
  queueTracksToAdd: number;
  overwrittenFavorites: number;
  overwrittenPlaylists: number;
  overwrittenQueueTracks: number;
};

export type ImportPlan = {
  mode: ImportMode;
  favorites: Track[];
  playlists: BackupPlaylist[];
  queue: Track[];
  queueMode: QueueMode;
  /** Only the imported queue entries; useful for append-only reducer actions. */
  queueToAppend: Track[];
  /** Only newly accepted playlists; existing playlists are already in `playlists`. */
  playlistsToAdd: BackupPlaylist[];
  summary: ImportPlanSummary;
};

const ROOT_KEYS = new Set([
  'format',
  'version',
  'exportedAt',
  'favorites',
  'playlists',
  'queue',
  'queueMode',
]);
const TRACK_KEYS = new Set([
  'id',
  'source',
  'title',
  'artist',
  'album',
  'durationMs',
  'artworkUrl',
]);
const PLAYLIST_KEYS = new Set(['id', 'title', 'tracks']);
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const CREDENTIAL_KEY_PATTERN =
  /(?:token|cookie|secret|password|passwd|authorization|credential|session|refresh|api[_-]?key|access[_-]?key|header)/i;
const LOCAL_PATH_PATTERN =
  /^(?:file|content):\/\/|^(?:\/|~[\\/]|\.{1,2}[\\/]|[a-z]:[\\/]|\\\\)/i;

function fail(code: BackupErrorCode, message: string): never {
  throw new BackupValidationError(code, message);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) index += 1;
      bytes += 4;
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

function isCredentialKey(key: string): boolean {
  return CREDENTIAL_KEY_PATTERN.test(key);
}

function assertSafeTree(value: unknown, depth = 0, active = new Set<object>()) {
  if (depth > 32) fail('INVALID_BACKUP', '备份数据嵌套层级过深');
  if (typeof value === 'string') {
    if (LOCAL_PATH_PATTERN.test(value))
      fail('UNSAFE_FIELD', '备份数据包含本地路径');
    return;
  }
  if (value === null || typeof value !== 'object') return;
  if (active.has(value)) fail('INVALID_BACKUP', '备份数据包含循环引用');
  active.add(value);
  if (Array.isArray(value)) {
    value.forEach(item => assertSafeTree(item, depth + 1, active));
  } else if (isPlainObject(value)) {
    Object.keys(value).forEach(key => {
      if (FORBIDDEN_KEYS.has(key))
        fail('UNSAFE_FIELD', '备份数据包含不安全字段');
      if (isCredentialKey(key)) fail('UNSAFE_FIELD', '备份数据包含凭据字段');
      assertSafeTree(value[key], depth + 1, active);
    });
  } else {
    fail('INVALID_BACKUP', '备份数据包含不支持的对象');
  }
  active.delete(value);
}

function assertSize(value: string): number {
  const bytes = utf8ByteLength(value);
  if (bytes > BACKUP_LIMITS.maxBytes)
    fail('BACKUP_TOO_LARGE', '备份内容超过 5 MiB 上限');
  return bytes;
}

function asText(
  value: unknown,
  field: string,
  maxLength: number,
  required?: true,
): string;
function asText(
  value: unknown,
  field: string,
  maxLength: number,
  required: false,
): string | undefined;
function asText(
  value: unknown,
  field: string,
  maxLength: number,
  required = true,
): string | undefined {
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string') fail('INVALID_TRACK', `${field} 必须是文本`);
  const text = value.trim();
  if (required && !text) fail('INVALID_TRACK', `${field} 不能为空`);
  if (text.length > maxLength)
    fail('BACKUP_TOO_LARGE', `${field} 超过长度上限`);
  if (LOCAL_PATH_PATTERN.test(text))
    fail('UNSAFE_FIELD', `${field} 不能是本地路径`);
  return text;
}

function trackKey(track: Track): string {
  return `${track.source}:${track.id}`;
}

function normalizeTrack(value: unknown, strict: boolean): Track {
  if (!isPlainObject(value)) fail('INVALID_TRACK', '歌曲条目格式错误');
  const raw = value;
  if (strict) {
    Object.keys(raw).forEach(key => {
      if (!TRACK_KEYS.has(key))
        fail('UNSAFE_FIELD', `歌曲包含未允许字段：${key}`);
    });
  }
  const id = asText(raw.id, '歌曲 ID', BACKUP_LIMITS.maxIdLength);
  if (FORBIDDEN_KEYS.has(id)) fail('UNSAFE_FIELD', '歌曲 ID 不安全');
  const source = asText(raw.source, '歌曲来源', 32);
  const knownSources = ['netease', 'kugou', 'kuwo', 'qq', 'bilibili'];
  if (!source || !knownSources.includes(source))
    fail('INVALID_TRACK', '歌曲来源不可用');
  const title = asText(raw.title, '歌曲标题', BACKUP_LIMITS.maxTextLength);
  const artist = asText(raw.artist, '歌曲艺人', BACKUP_LIMITS.maxTextLength);
  const album = asText(
    raw.album,
    '歌曲专辑',
    BACKUP_LIMITS.maxTextLength,
    false,
  );
  const artworkUrl = asText(
    raw.artworkUrl,
    '封面地址',
    BACKUP_LIMITS.maxArtworkUrlLength,
    false,
  );
  if (artworkUrl && !/^https:\/\//i.test(artworkUrl))
    fail('UNSAFE_FIELD', '封面地址必须使用 HTTPS');
  const durationMs = raw.durationMs;
  if (
    durationMs !== undefined &&
    (typeof durationMs !== 'number' ||
      !Number.isInteger(durationMs) ||
      durationMs < 0 ||
      durationMs > BACKUP_LIMITS.maxDurationMs)
  ) {
    fail('INVALID_TRACK', '歌曲时长超出范围');
  }
  const track: Track = { id, source: source as Track['source'], title, artist };
  if (album) track.album = album;
  if (durationMs !== undefined) track.durationMs = durationMs;
  if (artworkUrl) track.artworkUrl = artworkUrl;
  return track;
}

function normalizeTrackList(
  value: unknown,
  field: string,
  maxLength: number,
  deduplicate: boolean,
  strict: boolean,
): Track[] {
  if (!Array.isArray(value)) fail('INVALID_BACKUP', `${field} 必须是数组`);
  if (value.length > maxLength) fail('BACKUP_TOO_LARGE', `${field} 数量过多`);
  const result: Track[] = [];
  const known = new Set<string>();
  value.forEach(item => {
    const track = normalizeTrack(item, strict);
    const key = trackKey(track);
    if (deduplicate && known.has(key)) return;
    known.add(key);
    result.push(track);
  });
  return result;
}

function normalizePlaylist(value: unknown, strict: boolean): BackupPlaylist {
  if (!isPlainObject(value)) fail('INVALID_PLAYLIST', '歌单条目格式错误');
  if (strict) {
    Object.keys(value).forEach(key => {
      if (!PLAYLIST_KEYS.has(key))
        fail('UNSAFE_FIELD', `歌单包含未允许字段：${key}`);
    });
  }
  const id = asText(value.id, '歌单 ID', BACKUP_LIMITS.maxIdLength);
  if (FORBIDDEN_KEYS.has(id)) fail('UNSAFE_FIELD', '歌单 ID 不安全');
  const title = asText(value.title, '歌单名称', BACKUP_LIMITS.maxTitleLength);
  const tracks = normalizeTrackList(
    value.tracks,
    '歌单歌曲',
    BACKUP_LIMITS.maxTracksPerPlaylist,
    true,
    strict,
  );
  return { id, title, tracks };
}

function assertTrackTotals(
  favorites: Track[],
  playlists: BackupPlaylist[],
  queue: Track[],
) {
  if (playlists.length > BACKUP_LIMITS.maxPlaylists)
    fail('BACKUP_TOO_LARGE', '歌单数量过多');
  const playlistTracks = playlists.reduce(
    (total, playlist) => total + playlist.tracks.length,
    0,
  );
  const total = favorites.length + playlistTracks + queue.length;
  if (total > BACKUP_LIMITS.maxTotalTracks)
    fail('BACKUP_TOO_LARGE', '备份歌曲总数过多');
}

function normalizeQueueMode(value: unknown): QueueMode {
  if (value === undefined) return 'play-next';
  if (value !== 'playlist' && value !== 'play-next')
    fail('INVALID_BACKUP', '播放队列模式不可用');
  return value;
}

function normalizeDocument(value: unknown, strict: boolean): BackupDocument {
  if (!isPlainObject(value)) fail('INVALID_BACKUP', '备份根对象格式错误');
  if (strict) {
    Object.keys(value).forEach(key => {
      if (!ROOT_KEYS.has(key))
        fail('INVALID_BACKUP', `备份包含未知字段：${key}`);
    });
  }
  if (value.format !== BACKUP_FORMAT)
    fail('INVALID_BACKUP', '不是 Listen2 手机备份');
  if (value.version !== BACKUP_VERSION)
    fail('UNSUPPORTED_VERSION', '不支持的备份版本');
  const favorites = normalizeTrackList(
    value.favorites,
    '收藏歌曲',
    BACKUP_LIMITS.maxTotalTracks,
    true,
    strict,
  );
  if (!Array.isArray(value.playlists))
    fail('INVALID_BACKUP', '歌单列表格式错误');
  if (value.playlists.length > BACKUP_LIMITS.maxPlaylists)
    fail('BACKUP_TOO_LARGE', '歌单数量过多');
  const playlists = value.playlists.map(item =>
    normalizePlaylist(item, strict),
  );
  const ids = new Set<string>();
  playlists.forEach(playlist => {
    if (ids.has(playlist.id)) fail('INVALID_PLAYLIST', '歌单 ID 重复');
    ids.add(playlist.id);
  });
  const queue = normalizeTrackList(
    value.queue,
    '播放队列',
    BACKUP_LIMITS.maxQueueTracks,
    false,
    strict,
  );
  const exportedAt = value.exportedAt;
  if (
    typeof exportedAt !== 'string' ||
    !exportedAt ||
    exportedAt.length > 64 ||
    Number.isNaN(Date.parse(exportedAt))
  ) {
    fail('INVALID_BACKUP', '导出时间格式错误');
  }
  assertTrackTotals(favorites, playlists, queue);
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt,
    favorites,
    playlists,
    queue,
    queueMode: normalizeQueueMode(value.queueMode),
  };
}

/** Build a sanitized versioned backup object from current app state. */
export function createBackup(
  snapshot: BackupSnapshot,
  now: Date = new Date(),
): BackupDocument {
  assertSafeTree(snapshot);
  if (!(now instanceof Date) || Number.isNaN(now.getTime()))
    fail('INVALID_BACKUP', '导出时间无效');
  const exportedAt = now.toISOString();
  const favorites = normalizeTrackList(
    snapshot.favorites,
    '收藏歌曲',
    BACKUP_LIMITS.maxTotalTracks,
    true,
    false,
  );
  if (!Array.isArray(snapshot.playlists))
    fail('INVALID_BACKUP', '歌单列表格式错误');
  const playlists = snapshot.playlists.map(item =>
    normalizePlaylist(item, false),
  );
  const queue = normalizeTrackList(
    snapshot.queue,
    '播放队列',
    BACKUP_LIMITS.maxQueueTracks,
    false,
    false,
  );
  assertTrackTotals(favorites, playlists, queue);
  const document: BackupDocument = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt,
    favorites,
    playlists,
    queue,
    queueMode: normalizeQueueMode(snapshot.queueMode),
  };
  assertSize(JSON.stringify(document));
  return document;
}

/** Serialize state for RN Share or a text-based backup handoff. */
export function stringifyBackup(
  snapshot: BackupSnapshot,
  now: Date = new Date(),
): string {
  const document = createBackup(snapshot, now);
  const serialized = JSON.stringify(document);
  assertSize(serialized);
  return serialized;
}

/** Parse and validate pasted/imported backup text without mutating app state. */
export function parseBackup(raw: unknown): BackupDocument {
  let value = raw;
  if (typeof raw === 'string') {
    assertSize(raw);
    try {
      value = JSON.parse(raw) as unknown;
    } catch {
      fail('INVALID_JSON', '备份文本不是有效的 JSON');
    }
  }
  assertSafeTree(value);
  return normalizeDocument(value, true);
}

export function previewBackup(raw: unknown): BackupPreview {
  const document = parseBackup(raw);
  const playlistTracks = document.playlists.reduce(
    (total, playlist) => total + playlist.tracks.length,
    0,
  );
  const serialized = JSON.stringify(document);
  return {
    version: document.version,
    bytes: utf8ByteLength(serialized),
    favorites: document.favorites.length,
    playlists: document.playlists.length,
    playlistTracks,
    queueTracks: document.queue.length,
    totalTracks:
      document.favorites.length + playlistTracks + document.queue.length,
    queueMode: document.queueMode,
  };
}

function cloneTrack(track: Track): Track {
  return { ...track };
}

function clonePlaylist(playlist: BackupPlaylist): BackupPlaylist {
  return { ...playlist, tracks: playlist.tracks.map(cloneTrack) };
}

function playlistFingerprint(playlist: BackupPlaylist): string {
  return JSON.stringify({
    title: playlist.title,
    tracks: playlist.tracks,
  });
}

function generatedPlaylistId(baseId: string, used: Set<string>): string {
  const safeBase =
    baseId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64) || 'playlist';
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const suffix = attempt ? `_${attempt.toString(36)}` : '';
    const candidate = `myplaylist_import_${safeBase}${suffix}`.slice(
      0,
      BACKUP_LIMITS.maxIdLength,
    );
    if (!used.has(candidate)) return candidate;
  }
  fail('INVALID_PLAYLIST', '无法为冲突歌单生成安全 ID');
}

function normalizedImportState(state: BackupImportState): BackupImportState {
  const favorites = normalizeTrackList(
    state.favorites,
    '本机收藏歌曲',
    BACKUP_LIMITS.maxTotalTracks,
    true,
    false,
  );
  if (!Array.isArray(state.playlists))
    fail('INVALID_BACKUP', '本机歌单列表格式错误');
  const playlists = state.playlists.map(item => normalizePlaylist(item, false));
  const queue = normalizeTrackList(
    state.queue,
    '本机播放队列',
    BACKUP_LIMITS.maxQueueTracks,
    false,
    false,
  );
  assertTrackTotals(favorites, playlists, queue);
  return {
    favorites,
    playlists,
    queue,
    queueMode: normalizeQueueMode(state.queueMode),
  };
}

/**
 * Produce a side-effect-free merge/overwrite plan.  The caller applies the
 * plan in one UI action after preview; this function never touches Redux.
 */
export function planImport(
  existing: BackupImportState,
  incoming: BackupDocument | string,
  mode: ImportMode = 'merge',
): ImportPlan {
  if (mode !== 'merge' && mode !== 'overwrite')
    fail('INVALID_BACKUP', '导入模式不可用');
  const current = normalizedImportState(existing);
  const document = parseBackup(incoming);

  if (mode === 'overwrite') {
    const favorites = document.favorites.map(cloneTrack);
    const playlists = document.playlists.map(clonePlaylist);
    const queue = document.queue.map(cloneTrack);
    return {
      mode,
      favorites,
      playlists,
      queue,
      queueMode: document.queueMode,
      queueToAppend: queue.map(cloneTrack),
      playlistsToAdd: playlists.map(clonePlaylist),
      summary: {
        mode,
        addedFavorites: favorites.length,
        addedPlaylists: playlists.length,
        skippedPlaylists: 0,
        conflictedPlaylists: 0,
        queueTracks: queue.length,
        queueTracksToAdd: queue.length,
        overwrittenFavorites: current.favorites.length,
        overwrittenPlaylists: current.playlists.length,
        overwrittenQueueTracks: current.queue.length,
      },
    };
  }

  const favorites = current.favorites.map(cloneTrack);
  const knownFavorites = new Set(favorites.map(trackKey));
  let addedFavorites = 0;
  document.favorites.forEach(track => {
    const copy = cloneTrack(track);
    if (knownFavorites.has(trackKey(copy))) return;
    knownFavorites.add(trackKey(copy));
    favorites.push(copy);
    addedFavorites += 1;
  });

  const playlists = current.playlists.map(clonePlaylist);
  const playlistsToAdd: BackupPlaylist[] = [];
  const usedIds = new Set(playlists.map(playlist => playlist.id));
  let skippedPlaylists = 0;
  let conflictedPlaylists = 0;
  document.playlists.forEach(sourcePlaylist => {
    const sameId = playlists.find(item => item.id === sourcePlaylist.id);
    if (
      sameId &&
      playlistFingerprint(sameId) === playlistFingerprint(sourcePlaylist)
    ) {
      skippedPlaylists += 1;
      return;
    }
    const target = clonePlaylist(sourcePlaylist);
    if (usedIds.has(target.id)) {
      target.id = generatedPlaylistId(target.id, usedIds);
      conflictedPlaylists += 1;
    }
    usedIds.add(target.id);
    playlists.push(target);
    playlistsToAdd.push(clonePlaylist(target));
  });

  const queue = [
    ...current.queue.map(cloneTrack),
    ...document.queue.map(cloneTrack),
  ];
  const queueMode = current.queue.length
    ? current.queueMode || 'play-next'
    : document.queueMode;
  assertTrackTotals(favorites, playlists, queue);
  return {
    mode,
    favorites,
    playlists,
    queue,
    queueMode,
    queueToAppend: document.queue.map(cloneTrack),
    playlistsToAdd,
    summary: {
      mode,
      addedFavorites,
      addedPlaylists: playlistsToAdd.length,
      skippedPlaylists,
      conflictedPlaylists,
      queueTracks: queue.length,
      queueTracksToAdd: document.queue.length,
      overwrittenFavorites: 0,
      overwrittenPlaylists: 0,
      overwrittenQueueTracks: 0,
    },
  };
}

export function backupErrorMessage(error: unknown): string {
  if (!(error instanceof BackupValidationError))
    return '备份操作未完成，请检查文本后重试。';
  switch (error.code) {
    case 'INVALID_JSON':
      return '备份文本不是有效的 JSON。';
    case 'UNSUPPORTED_VERSION':
      return '备份版本较新，当前版本暂不支持。';
    case 'BACKUP_TOO_LARGE':
      return '备份过大，已超过手机端安全上限。';
    case 'UNSAFE_FIELD':
      return '备份包含凭据、本地路径或不安全字段，已拒绝导入。';
    default:
      return '备份格式无法识别，未修改本机数据。';
  }
}
