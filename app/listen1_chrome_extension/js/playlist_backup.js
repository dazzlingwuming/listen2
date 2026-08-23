/* eslint-env browser, node */
/* eslint-disable no-param-reassign, no-use-before-define */
(function playlistBackupFactory(root) {
  const BACKUP_FORMAT = 'listen2-playlist-backup';
  const BACKUP_VERSION = 2;
  const SOURCE_MARKER = '__listen2BackupSource';
  const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
  const MY_PLAYLIST_PREFIX = 'myplaylist_';
  // These prefixes are emitted by the supported provider adapters.
  const REMOTE_PLAYLIST_PREFIXES = [
    'neplaylist_',
    'qqplaylist_',
    'kgplaylist_',
    'kwplaylist_',
    'biplaylist_',
    'mgplaylist_',
    'thplaylist_',
    'xmplaylist_',
  ];
  const MAX_BACKUP_BYTES = 5 * 1024 * 1024;
  const MAX_PLAYLISTS = 500;
  const MAX_TRACKS_PER_PLAYLIST = 5000;
  const MAX_TOTAL_TRACKS = 50000;

  function backupError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  function isPlainObject(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return false;
    }
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function assertSafeValue(value, depth) {
    if (depth > 64) {
      throw backupError('INVALID_BACKUP', '备份数据嵌套层级过深');
    }
    if (Array.isArray(value)) {
      value.forEach((item) => assertSafeValue(item, depth + 1));
      return;
    }
    if (!isPlainObject(value)) {
      return;
    }
    Object.keys(value).forEach((key) => {
      if (FORBIDDEN_KEYS.has(key)) {
        throw backupError('UNSAFE_BACKUP', '备份文件包含不安全字段');
      }
      assertSafeValue(value[key], depth + 1);
    });
  }

  function cloneValue(value, depth = 0) {
    if (depth > 64) {
      throw backupError('INVALID_BACKUP', '备份数据嵌套层级过深');
    }
    if (Array.isArray(value)) {
      return value.map((item) => cloneValue(item, depth + 1));
    }
    if (isPlainObject(value)) {
      const result = {};
      Object.keys(value).forEach((key) => {
        if (FORBIDDEN_KEYS.has(key)) {
          throw backupError('UNSAFE_BACKUP', '备份文件包含不安全字段');
        }
        result[key] = cloneValue(value[key], depth + 1);
      });
      return result;
    }
    if (
      value === null ||
      ['string', 'number', 'boolean'].includes(typeof value)
    ) {
      return value;
    }
    throw backupError('INVALID_BACKUP', '备份文件包含不支持的数据类型');
  }

  function isSafeId(value) {
    return (
      typeof value === 'string' &&
      value.length > 0 &&
      value.length <= 512 &&
      !FORBIDDEN_KEYS.has(value)
    );
  }

  function isMyPlaylistId(value) {
    return isSafeId(value) && value.startsWith(MY_PLAYLIST_PREFIX);
  }

  function isRemotePlaylistId(value) {
    return (
      isSafeId(value) &&
      REMOTE_PLAYLIST_PREFIXES.some((prefix) => value.startsWith(prefix))
    );
  }

  function utf8ByteLength(value) {
    return unescape(encodeURIComponent(value)).length;
  }

  function assertBackupSize(rawBackup) {
    let serialized = rawBackup;
    if (typeof rawBackup !== 'string') {
      try {
        serialized = JSON.stringify(rawBackup);
      } catch (error) {
        throw backupError('INVALID_BACKUP', '备份文件无法序列化');
      }
    }
    if (
      typeof serialized !== 'string' ||
      utf8ByteLength(serialized) > MAX_BACKUP_BYTES
    ) {
      throw backupError('BACKUP_TOO_LARGE', '备份文件超过 5 MiB 上限');
    }
  }

  function isLocalPath(value) {
    return (
      typeof value === 'string' &&
      (/^file:\/\//i.test(value) ||
        /^\//.test(value) ||
        /^[a-z]:[\\/]/i.test(value) ||
        /^\\\\/.test(value))
    );
  }

  function containsLocalPath(value, depth = 0, fieldName = '') {
    if (depth > 32) {
      return true;
    }
    if (typeof value === 'string') {
      if (/^file:\/\//i.test(value)) {
        return true;
      }
      if (/(?:path|url|file)/i.test(fieldName) && isLocalPath(value)) {
        return true;
      }
    }
    if (Array.isArray(value)) {
      return value.some((item) =>
        containsLocalPath(item, depth + 1, fieldName)
      );
    }
    if (isPlainObject(value)) {
      return Object.keys(value).some((key) =>
        containsLocalPath(value[key], depth + 1, key)
      );
    }
    return false;
  }

  function isLocalTrack(track) {
    return (
      track.source === 'localmusic' ||
      (typeof track.id === 'string' && track.id.startsWith('lmtrack_')) ||
      containsLocalPath(track)
    );
  }

  function dedupeTracks(tracks) {
    const knownIds = new Set();
    return tracks.reduce((result, track) => {
      if (
        !isPlainObject(track) ||
        !Object.prototype.hasOwnProperty.call(track, 'id')
      ) {
        return result;
      }
      if (isLocalTrack(track)) {
        return result;
      }
      const trackId = track.id;
      if (
        trackId === null ||
        trackId === undefined ||
        (typeof trackId !== 'string' && typeof trackId !== 'number')
      ) {
        return result;
      }
      const uniqueKey = `${typeof trackId}:${String(trackId)}`;
      if (knownIds.has(uniqueKey)) {
        return result;
      }
      knownIds.add(uniqueKey);
      result.push(cloneValue(track));
      return result;
    }, []);
  }

  function normalizeEntry(id, value, type) {
    const idIsValid =
      type === 'playlist' ? isMyPlaylistId(id) : isRemotePlaylistId(id);
    if (!idIsValid || !isPlainObject(value)) {
      return null;
    }
    if (
      Object.prototype.hasOwnProperty.call(value, 'tracks') &&
      !Array.isArray(value.tracks)
    ) {
      return null;
    }
    if (
      Array.isArray(value.tracks) &&
      value.tracks.length > MAX_TRACKS_PER_PLAYLIST
    ) {
      throw backupError('BACKUP_TOO_LARGE', '单个歌单歌曲数量超过安全上限');
    }
    let playlist;
    try {
      playlist = cloneValue(value);
    } catch (error) {
      return null;
    }
    if (!isPlainObject(playlist.info) || playlist.info.id !== id) {
      return null;
    }
    if (
      (type === 'playlist' && (!playlist.is_mine || playlist.is_fav)) ||
      (type === 'favorite' && (!playlist.is_fav || playlist.is_mine))
    ) {
      return null;
    }
    if (type === 'playlist' && !Array.isArray(playlist.tracks)) {
      return null;
    }
    if (Object.prototype.hasOwnProperty.call(playlist, 'tracks')) {
      if (!Array.isArray(playlist.tracks)) {
        return null;
      }
      playlist.tracks = dedupeTracks(playlist.tracks);
    }
    return { id, playlist };
  }

  function stableValue(value, omitMarker = false) {
    if (Array.isArray(value)) {
      return value.map((item) => stableValue(item, omitMarker));
    }
    if (isPlainObject(value)) {
      return Object.keys(value)
        .filter((key) => !(omitMarker && key === SOURCE_MARKER))
        .sort()
        .reduce((result, key) => {
          result[key] = stableValue(value[key], omitMarker);
          return result;
        }, {});
    }
    return value;
  }

  function entryFingerprint(entry) {
    return JSON.stringify(stableValue(entry.playlist, true));
  }

  function readObject(storage, key) {
    if (!storage || typeof storage.getObject !== 'function') {
      throw backupError('INVALID_STORAGE', '当前存储不可用于歌单备份');
    }
    return storage.getObject(key);
  }

  function readIndex(storage, key, type) {
    const value = readObject(storage, key);
    if (value === null || value === undefined) {
      return [];
    }
    if (!Array.isArray(value)) {
      throw backupError(
        'INVALID_STORAGE',
        `本机 ${key} 数据格式异常，未进行导入`
      );
    }
    if (value.length > MAX_PLAYLISTS) {
      throw backupError('BACKUP_TOO_LARGE', '歌单数量超过安全上限');
    }
    const idChecker = type === 'playlist' ? isMyPlaylistId : isRemotePlaylistId;
    const seen = new Set();
    value.forEach((id) => {
      if (!idChecker(id) || seen.has(id)) {
        throw backupError('INVALID_STORAGE', `本机 ${key} 包含无效歌单 ID`);
      }
      seen.add(id);
    });
    return value.slice();
  }

  function collectEntries(storage, indexKey, type) {
    return readIndex(storage, indexKey, type).reduce((result, id) => {
      const entry = normalizeEntry(id, readObject(storage, id), type);
      if (entry) {
        result.push(entry);
      }
      return result;
    }, []);
  }

  function createBackup(storage) {
    const backup = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      playlists: collectEntries(storage, 'playerlists', 'playlist'),
      favoritePlaylists: collectEntries(
        storage,
        'favoriteplayerlists',
        'favorite'
      ),
    };
    assertEntryLimits(backup.playlists, backup.favoritePlaylists);
    assertBackupSize(backup);
    return backup;
  }

  function isV2Backup(value) {
    return isPlainObject(value) && value.format === BACKUP_FORMAT;
  }

  function parseV2Entries(items, type, invalid) {
    if (!Array.isArray(items)) {
      throw backupError('INVALID_BACKUP', '备份歌单列表格式错误');
    }
    if (items.length > MAX_PLAYLISTS) {
      throw backupError('BACKUP_TOO_LARGE', '歌单数量超过安全上限');
    }
    const seen = new Set();
    return items.reduce((result, rawEntry) => {
      if (!isPlainObject(rawEntry)) {
        invalid.count += 1;
        return result;
      }
      const { id } = rawEntry;
      const entry = normalizeEntry(id, rawEntry.playlist, type);
      if (!entry || seen.has(entry.id)) {
        invalid.count += 1;
        return result;
      }
      seen.add(entry.id);
      result.push(entry);
      return result;
    }, []);
  }

  function parseLegacyEntries(backup, indexKey, type, invalid) {
    const ids = backup[indexKey];
    if (ids === undefined || ids === null) {
      return [];
    }
    if (!Array.isArray(ids)) {
      throw backupError('INVALID_BACKUP', '旧备份歌单索引格式错误');
    }
    if (ids.length > MAX_PLAYLISTS) {
      throw backupError('BACKUP_TOO_LARGE', '歌单数量超过安全上限');
    }
    const seen = new Set();
    return ids.reduce((result, id) => {
      const entry = normalizeEntry(id, backup[id], type);
      if (!entry || seen.has(id)) {
        invalid.count += 1;
        return result;
      }
      seen.add(id);
      result.push(entry);
      return result;
    }, []);
  }

  function assertRawCategoryIdsAreDistinct(playlistItems, favoriteItems) {
    const playlistIds = new Set(
      playlistItems
        .map((entry) => (isPlainObject(entry) ? entry.id : entry))
        .filter((id) => typeof id === 'string')
    );
    const duplicateId = favoriteItems
      .map((entry) => (isPlainObject(entry) ? entry.id : entry))
      .find((id) => playlistIds.has(id));
    if (duplicateId) {
      throw backupError(
        'DUPLICATE_PLAYLIST_ID',
        '备份中的歌单 ID 在类别间重复'
      );
    }
  }

  function parseBackup(rawBackup) {
    let backup = rawBackup;
    assertBackupSize(rawBackup);
    if (typeof rawBackup === 'string') {
      try {
        backup = JSON.parse(rawBackup);
      } catch (error) {
        throw backupError('INVALID_JSON', '备份文件不是有效的 JSON');
      }
    }
    if (!isPlainObject(backup)) {
      throw backupError('INVALID_BACKUP', '备份文件格式错误');
    }
    assertSafeValue(backup, 0);

    const invalid = { count: 0 };
    if (isV2Backup(backup)) {
      if (backup.version !== BACKUP_VERSION) {
        throw backupError('UNSUPPORTED_BACKUP_VERSION', '不支持的歌单备份版本');
      }
      if (
        !Array.isArray(backup.playlists) ||
        !Array.isArray(backup.favoritePlaylists)
      ) {
        throw backupError('INVALID_BACKUP', '备份歌单列表格式错误');
      }
      assertRawCategoryIdsAreDistinct(
        backup.playlists,
        backup.favoritePlaylists
      );
      const parsed = {
        format: 'v2',
        playlists: parseV2Entries(backup.playlists, 'playlist', invalid),
        favoritePlaylists: parseV2Entries(
          backup.favoritePlaylists,
          'favorite',
          invalid
        ),
        skippedInvalid: invalid.count,
      };
      assertEntryLimits(parsed.playlists, parsed.favoritePlaylists);
      assertNoCrossCategoryIds(parsed.playlists, parsed.favoritePlaylists);
      return parsed;
    }

    if (
      !Object.prototype.hasOwnProperty.call(backup, 'playerlists') &&
      !Object.prototype.hasOwnProperty.call(backup, 'favoriteplayerlists')
    ) {
      throw backupError('INVALID_BACKUP', '未找到可导入的歌单数据');
    }
    assertRawCategoryIdsAreDistinct(
      Array.isArray(backup.playerlists) ? backup.playerlists : [],
      Array.isArray(backup.favoriteplayerlists)
        ? backup.favoriteplayerlists
        : []
    );
    const parsed = {
      format: 'legacy',
      playlists: parseLegacyEntries(backup, 'playerlists', 'playlist', invalid),
      favoritePlaylists: parseLegacyEntries(
        backup,
        'favoriteplayerlists',
        'favorite',
        invalid
      ),
      skippedInvalid: invalid.count,
    };
    assertEntryLimits(parsed.playlists, parsed.favoritePlaylists);
    assertNoCrossCategoryIds(parsed.playlists, parsed.favoritePlaylists);
    return parsed;
  }

  function assertEntryLimits(playlists, favoritePlaylists) {
    if (playlists.length + favoritePlaylists.length > MAX_PLAYLISTS) {
      throw backupError('BACKUP_TOO_LARGE', '歌单数量超过安全上限');
    }
    const totalTracks = playlists.reduce((count, entry) => {
      if (entry.playlist.tracks.length > MAX_TRACKS_PER_PLAYLIST) {
        throw backupError('BACKUP_TOO_LARGE', '单个歌单歌曲数量超过安全上限');
      }
      return count + entry.playlist.tracks.length;
    }, 0);
    if (totalTracks > MAX_TOTAL_TRACKS) {
      throw backupError('BACKUP_TOO_LARGE', '备份歌曲总数超过安全上限');
    }
  }

  function assertNoCrossCategoryIds(playlists, favoritePlaylists) {
    const playlistIds = new Set(playlists.map((entry) => entry.id));
    const duplicateId = favoritePlaylists
      .map((entry) => entry.id)
      .find((id) => playlistIds.has(id));
    if (duplicateId) {
      throw backupError(
        'DUPLICATE_PLAYLIST_ID',
        '备份中的歌单 ID 在类别间重复'
      );
    }
  }

  function makeSummary(mode, skippedInvalid) {
    return {
      mode,
      importedPlaylists: 0,
      skippedPlaylists: 0,
      conflictedPlaylists: 0,
      importedFavorites: 0,
      skippedInvalid,
      added: 0,
      skipped: 0,
      conflicts: 0,
      favorites: 0,
    };
  }

  function updateSummaryAliases(summary) {
    summary.added = summary.importedPlaylists;
    summary.skipped = summary.skippedPlaylists;
    summary.conflicts = summary.conflictedPlaylists;
    summary.favorites = summary.importedFavorites;
    return summary;
  }

  function entryFromStorage(storage, id, type) {
    return normalizeEntry(id, readObject(storage, id), type);
  }

  function hasStoredValue(storage, id) {
    if (storage && typeof storage.getItem === 'function') {
      return storage.getItem(id) !== null;
    }
    return readObject(storage, id) !== null;
  }

  function isStoredAsExpectedCategory(storage, id, type) {
    return entryFromStorage(storage, id, type) !== null;
  }

  function conflictMarkerMatches(entry, sourceId, fingerprint) {
    const marker = entry && entry.playlist && entry.playlist[SOURCE_MARKER];
    return (
      isPlainObject(marker) &&
      marker.id === sourceId &&
      marker.fingerprint === fingerprint
    );
  }

  function createGeneratedId(idFactory, sourceId, attempt, usedIds, storage) {
    let generated = idFactory(sourceId, attempt);
    generated = String(generated || '');
    if (!generated.startsWith('myplaylist_')) {
      generated = `myplaylist_${generated}`;
    }
    if (
      !isSafeId(generated) ||
      usedIds.has(generated) ||
      hasStoredValue(storage, generated)
    ) {
      return null;
    }
    return generated;
  }

  function defaultIdFactory() {
    return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }

  function makeConflictEntry(entry, targetId, sourceFingerprint) {
    const playlist = cloneValue(entry.playlist);
    playlist.info.id = targetId;
    playlist[SOURCE_MARKER] = {
      id: entry.id,
      fingerprint: sourceFingerprint,
    };
    return { id: targetId, playlist };
  }

  function planMerge(storage, source, options) {
    const summary = makeSummary('merge', source.skippedInvalid);
    const targetPlaylistIds = readIndex(storage, 'playerlists', 'playlist');
    const targetFavoriteIds = readIndex(
      storage,
      'favoriteplayerlists',
      'favorite'
    );
    const usedPlaylistIds = new Set(targetPlaylistIds);
    const plannedEntries = new Map();
    const targetEntries = targetPlaylistIds
      .map((id) => entryFromStorage(storage, id, 'playlist'))
      .filter(Boolean);

    source.playlists.forEach((sourceEntry) => {
      const sourceFingerprint = entryFingerprint(sourceEntry);
      const existing = entryFromStorage(storage, sourceEntry.id, 'playlist');
      const plannedSameId = plannedEntries.get(sourceEntry.id);
      const comparable = plannedSameId || existing;
      if (usedPlaylistIds.has(sourceEntry.id) && comparable) {
        if (entryFingerprint(comparable) === sourceFingerprint) {
          summary.skippedPlaylists += 1;
          return;
        }
      }

      const alreadyImported = targetEntries.some((entry) =>
        conflictMarkerMatches(entry, sourceEntry.id, sourceFingerprint)
      );
      if (alreadyImported) {
        summary.skippedPlaylists += 1;
        return;
      }

      let targetId = sourceEntry.id;
      if (usedPlaylistIds.has(targetId) || hasStoredValue(storage, targetId)) {
        const factory = options.idFactory || defaultIdFactory;
        let attempt = 0;
        do {
          targetId = createGeneratedId(
            factory,
            sourceEntry.id,
            attempt,
            usedPlaylistIds,
            storage
          );
          attempt += 1;
        } while (targetId === null && attempt < 100);
        if (targetId === null) {
          throw backupError(
            'ID_GENERATION_FAILED',
            '无法为冲突歌单生成安全的本地 ID'
          );
        }
        const conflictEntry = makeConflictEntry(
          sourceEntry,
          targetId,
          sourceFingerprint
        );
        plannedEntries.set(targetId, conflictEntry);
        targetEntries.push(conflictEntry);
        summary.conflictedPlaylists += 1;
      } else {
        plannedEntries.set(targetId, sourceEntry);
        targetEntries.push(sourceEntry);
      }
      usedPlaylistIds.add(targetId);
      targetPlaylistIds.push(targetId);
      summary.importedPlaylists += 1;
    });

    const plannedFavorites = new Map();
    const knownFavoriteIds = new Set(targetFavoriteIds);
    source.favoritePlaylists.forEach((entry) => {
      if (knownFavoriteIds.has(entry.id)) {
        summary.skippedPlaylists += 1;
        return;
      }
      knownFavoriteIds.add(entry.id);
      targetFavoriteIds.push(entry.id);
      if (hasStoredValue(storage, entry.id)) {
        if (!isStoredAsExpectedCategory(storage, entry.id, 'favorite')) {
          throw backupError(
            'INVALID_STORAGE',
            '本机收藏歌单 ID 已被非收藏数据占用'
          );
        }
      } else {
        plannedFavorites.set(entry.id, entry);
      }
      summary.importedFavorites += 1;
    });

    return {
      summary: updateSummaryAliases(summary),
      writes: new Map([...plannedEntries, ...plannedFavorites]),
      indexes: {
        playerlists: targetPlaylistIds,
        favoriteplayerlists: targetFavoriteIds,
      },
    };
  }

  function planReplace(storage, source) {
    readIndex(storage, 'playerlists', 'playlist');
    readIndex(storage, 'favoriteplayerlists', 'favorite');
    const summary = makeSummary('replace', source.skippedInvalid);
    const playlistIds = [];
    const favoriteIds = [];
    const writes = new Map();
    const allIds = new Set();

    source.playlists.forEach((entry) => {
      if (allIds.has(entry.id)) {
        summary.skippedPlaylists += 1;
        return;
      }
      if (
        hasStoredValue(storage, entry.id) &&
        !isStoredAsExpectedCategory(storage, entry.id, 'playlist')
      ) {
        throw backupError(
          'INVALID_STORAGE',
          '本机自建歌单 ID 已被收藏歌单数据占用'
        );
      }
      allIds.add(entry.id);
      playlistIds.push(entry.id);
      writes.set(entry.id, entry);
      summary.importedPlaylists += 1;
    });
    source.favoritePlaylists.forEach((entry) => {
      if (allIds.has(entry.id)) {
        summary.skippedInvalid += 1;
        return;
      }
      if (
        hasStoredValue(storage, entry.id) &&
        !isStoredAsExpectedCategory(storage, entry.id, 'favorite')
      ) {
        throw backupError(
          'INVALID_STORAGE',
          '本机收藏歌单 ID 已被自建歌单数据占用'
        );
      }
      allIds.add(entry.id);
      favoriteIds.push(entry.id);
      writes.set(entry.id, entry);
      summary.importedFavorites += 1;
    });
    return {
      summary: updateSummaryAliases(summary),
      writes,
      indexes: {
        playerlists: playlistIds,
        favoriteplayerlists: favoriteIds,
      },
    };
  }

  function snapshotValue(storage, key) {
    if (storage && typeof storage.getItem === 'function') {
      const rawValue = storage.getItem(key);
      return { exists: rawValue !== null, value: readObject(storage, key) };
    }
    const value = readObject(storage, key);
    return { exists: value !== null && value !== undefined, value };
  }

  function writeObject(storage, key, value) {
    if (!storage || typeof storage.setObject !== 'function') {
      throw backupError('INVALID_STORAGE', '当前存储不可用于歌单导入');
    }
    storage.setObject(key, cloneValue(value));
  }

  function applyPlan(storage, plan) {
    const writeEntries = Array.from(plan.writes.entries());
    const keys = [
      ...writeEntries.map(([key]) => key),
      'playerlists',
      'favoriteplayerlists',
    ];
    const snapshots = new Map(
      keys.map((key) => [key, snapshotValue(storage, key)])
    );
    try {
      writeEntries.forEach(([key, entry]) =>
        writeObject(storage, key, entry.playlist)
      );
      writeObject(storage, 'playerlists', plan.indexes.playerlists);
      writeObject(
        storage,
        'favoriteplayerlists',
        plan.indexes.favoriteplayerlists
      );
    } catch (error) {
      const rollbackErrors = [];
      Array.from(snapshots.entries())
        .reverse()
        .forEach(([key, snapshot]) => {
          try {
            if (snapshot.exists) {
              writeObject(storage, key, snapshot.value);
            } else if (typeof storage.removeItem === 'function') {
              storage.removeItem(key);
            } else {
              rollbackErrors.push(key);
            }
          } catch (rollbackError) {
            rollbackErrors.push(key);
          }
        });
      const writeError = backupError(
        rollbackErrors.length > 0
          ? 'BACKUP_ROLLBACK_FAILED'
          : 'BACKUP_WRITE_FAILED',
        rollbackErrors.length > 0
          ? '导入失败，且部分原有歌单无法自动恢复'
          : '导入失败，已恢复原有歌单'
      );
      writeError.cause = error;
      writeError.rollbackErrors = rollbackErrors;
      throw writeError;
    }
  }

  function importBackup(storage, rawBackup, options = {}) {
    const mode = options.mode || 'merge';
    if (mode !== 'merge' && mode !== 'replace') {
      throw backupError('INVALID_IMPORT_MODE', '不支持的导入模式');
    }
    const source = parseBackup(rawBackup);
    const plan =
      mode === 'merge'
        ? planMerge(storage, source, options)
        : planReplace(storage, source);
    applyPlan(storage, plan);
    return plan.summary;
  }

  function getGistSummaryData(rawBackup) {
    try {
      const backup = parseBackup(rawBackup);
      const playlists = backup.playlists.map((entry) => entry.playlist);
      return {
        playlists,
        songsCount: playlists.reduce(
          (count, playlist) => count + playlist.tracks.length,
          0
        ),
      };
    } catch (error) {
      return { playlists: [], songsCount: 0 };
    }
  }

  const api = {
    BACKUP_FORMAT,
    BACKUP_VERSION,
    MAX_BACKUP_BYTES,
    MAX_PLAYLISTS,
    MAX_TRACKS_PER_PLAYLIST,
    MAX_TOTAL_TRACKS,
    createBackup,
    importBackup,
    getGistSummaryData,
  };

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) {
    const apiTarget = root;
    apiTarget.playlistBackup = api;
  }
})(typeof window !== 'undefined' ? window : global);
