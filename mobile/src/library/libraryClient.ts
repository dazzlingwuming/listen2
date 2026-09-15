import { NativeModules } from 'react-native';
import {
  LIBRARY_SCHEMA_VERSION,
  MAX_LIBRARY_PLAYLISTS,
  MAX_LIBRARY_TITLE_LENGTH,
  type LibraryMigrationStatus,
  type LibraryLocalRecord,
  type LibraryRemoteCollection,
  type LibraryQueueCheckpoint,
  type LibraryLyricMetadata,
  type LegacyMigrationRequest,
  type LibraryMutation,
  type LibraryMutationReceipt,
  type LibraryPlaylistRecord,
  type LibrarySnapshot,
} from './types';
import type { BackupDocument, ImportMode } from '../backup/backupCodec';

const CALL_TIMEOUT_MS = 8_000;
const MAX_ID_LENGTH = 128;
const MAX_ERROR_CODE_LENGTH = 64;
const SAFE_ID = /^[A-Za-z0-9._:-]+$/;
const SAFE_ERROR_CODE = /^[A-Z][A-Z0-9_]*$/;

type UnknownRecord = Record<string, unknown>;
type NativeLibraryModule = {
  getSnapshot(schemaVersion: number): Promise<unknown>;
  applyMutation(mutation: {
    schemaVersion: number;
    requestId: string;
    expectedRevision: number;
    operation: string;
    payload: Record<string, string>;
  }): Promise<unknown>;
  getMigrationStatus(): Promise<unknown>;
  beginLegacyMigration?(request: LegacyMigrationRequest): Promise<unknown>;
  previewBackup?(request: unknown): Promise<unknown>;
  applyBackup?(token: string, checksum: string, expectedRevision: number): Promise<unknown>;
  replaceRemoteCollections?(request: { schemaVersion: number; expectedRevision: number; collections: LibraryRemoteCollection[] }): Promise<unknown>;
  replaceContinuityMetadata?(request: { schemaVersion: number; expectedRevision: number; queueCheckpoint: LibraryQueueCheckpoint[]; lyricMetadata: LibraryLyricMetadata[] }): Promise<unknown>;
};

export type LibraryBackupPreview = {
  token: string;
  checksum: string;
  baseRevision: number;
  addedFavorites: number;
  addedPlaylists: number;
  skippedPlaylists: number;
  conflictedPlaylists: number;
};

export class LibraryClientError extends Error {
  constructor(
    readonly code:
      | 'INVALID_REQUEST'
      | 'INVALID_RESPONSE'
      | 'NATIVE_UNAVAILABLE'
      | 'TIMEOUT',
  ) {
    super(code);
    this.name = 'LibraryClientError';
  }
}

function object(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function exactKeys(value: UnknownRecord, allowed: readonly string[]) {
  return Object.keys(value).every(key => allowed.includes(key));
}

function boundedString(value: unknown, maximum: number, pattern?: RegExp) {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maximum &&
    (!pattern || pattern.test(value))
    ? value
    : null;
}

function revision(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function nativeModule(): NativeLibraryModule {
  const candidate = NativeModules.Listen2Library as NativeLibraryModule | undefined;
  if (
    !candidate ||
    typeof candidate.getSnapshot !== 'function' ||
    typeof candidate.applyMutation !== 'function' ||
    typeof candidate.getMigrationStatus !== 'function'
  )
    throw new LibraryClientError('NATIVE_UNAVAILABLE');
  return candidate;
}

function withTimeout<T>(request: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new LibraryClientError('TIMEOUT')), CALL_TIMEOUT_MS);
    request.then(
      value => {
        clearTimeout(timeout);
        resolve(value);
      },
      () => {
        clearTimeout(timeout);
        reject(new LibraryClientError('INVALID_RESPONSE'));
      },
    );
  });
}

export function parseLibrarySnapshot(value: unknown): LibrarySnapshot {
  const candidate = object(value);
  if (
    !candidate ||
    !exactKeys(candidate, ['schemaVersion', 'revision', 'personalPlaylists', 'favorites', 'localRecords', 'remoteCollections', 'queueCheckpoint', 'lyricMetadata']) ||
    candidate.schemaVersion !== LIBRARY_SCHEMA_VERSION ||
    revision(candidate.revision) === null ||
    !Array.isArray(candidate.personalPlaylists) || !Array.isArray(candidate.favorites) || !Array.isArray(candidate.localRecords) ||
    candidate.personalPlaylists.length > MAX_LIBRARY_PLAYLISTS
  )
    throw new LibraryClientError('INVALID_RESPONSE');

  const personalPlaylists: LibraryPlaylistRecord[] = candidate.personalPlaylists.map(item => {
    const playlist = object(item);
    const playlistId = playlist && boundedString(playlist.playlistId, MAX_ID_LENGTH, SAFE_ID);
    const title = playlist && boundedString(playlist.title, MAX_LIBRARY_TITLE_LENGTH);
    const position = playlist && revision(playlist.position);
    if (
      !playlist ||
      !exactKeys(playlist, ['playlistId', 'title', 'position', 'tracks']) ||
      !playlistId ||
      !title ||
      position === null || !Array.isArray(playlist.tracks)
    )
      throw new LibraryClientError('INVALID_RESPONSE');
    return { playlistId, title, position, tracks: playlist.tracks.map(parseTrack) };
  });
  personalPlaylists.sort((left, right) => left.position - right.position);
  if (personalPlaylists.some((playlist, index) => playlist.position !== index))
    throw new LibraryClientError('INVALID_RESPONSE');
  const remoteCollections = candidate.remoteCollections === undefined ? [] : candidate.remoteCollections;
  const queueCheckpoint = candidate.queueCheckpoint === undefined ? [] : candidate.queueCheckpoint;
  const lyricMetadata = candidate.lyricMetadata === undefined ? [] : candidate.lyricMetadata;
  if (!Array.isArray(remoteCollections) || !Array.isArray(queueCheckpoint) || !Array.isArray(lyricMetadata)) throw new LibraryClientError('INVALID_RESPONSE');
  const parsedRemote: LibraryRemoteCollection[] = remoteCollections.map(item => {
    const collection = object(item);
    const collectionId = collection && boundedString(collection.collectionId, MAX_ID_LENGTH, SAFE_ID);
    const title = collection && boundedString(collection.title, MAX_LIBRARY_TITLE_LENGTH);
    if (!collection || !exactKeys(collection, ['collectionId', 'source', 'title', 'syncState']) || !collectionId || !title || !['netease', 'kugou', 'kuwo', 'qq', 'bilibili'].includes(String(collection.source)) || !['ready', 'refreshing', 'error', 'unavailable'].includes(String(collection.syncState))) throw new LibraryClientError('INVALID_RESPONSE');
    return { collectionId, title, source: collection.source as LibraryRemoteCollection['source'], syncState: collection.syncState as LibraryRemoteCollection['syncState'] };
  });
  const parsedQueue = queueCheckpoint.map(item => {
    const checkpoint = object(item);
    if (!checkpoint || !exactKeys(checkpoint, ['occurrenceId', 'position', 'source', 'trackId']) || !boundedString(checkpoint.occurrenceId, MAX_ID_LENGTH, SAFE_ID) || revision(checkpoint.position) === null || !['netease', 'kugou', 'kuwo', 'qq', 'bilibili', 'local'].includes(String(checkpoint.source)) || !boundedString(checkpoint.trackId, MAX_ID_LENGTH, SAFE_ID)) throw new LibraryClientError('INVALID_RESPONSE');
    return { occurrenceId: checkpoint.occurrenceId as string, position: checkpoint.position as number, source: checkpoint.source as NonNullable<LibrarySnapshot['queueCheckpoint']>[number]['source'], trackId: checkpoint.trackId as string };
  });
  const parsedLyrics = lyricMetadata.map(item => {
    const metadata = object(item);
    if (!metadata || !exactKeys(metadata, ['source', 'trackId', 'selectedVariantId', 'offsetMillis']) || !['netease', 'kugou', 'kuwo', 'qq', 'bilibili', 'local'].includes(String(metadata.source)) || !boundedString(metadata.trackId, MAX_ID_LENGTH, SAFE_ID) || !(metadata.selectedVariantId === null || boundedString(metadata.selectedVariantId, MAX_ID_LENGTH, SAFE_ID)) || !Number.isSafeInteger(metadata.offsetMillis) || Math.abs(metadata.offsetMillis as number) > 86_400_000) throw new LibraryClientError('INVALID_RESPONSE');
    return { source: metadata.source as NonNullable<LibrarySnapshot['lyricMetadata']>[number]['source'], trackId: metadata.trackId as string, selectedVariantId: metadata.selectedVariantId as string | null, offsetMillis: metadata.offsetMillis as number };
  });
  return {
    schemaVersion: LIBRARY_SCHEMA_VERSION,
    revision: revision(candidate.revision) as number,
    personalPlaylists,
    favorites: candidate.favorites.map(parseTrack),
    localRecords: candidate.localRecords.map(parseLocalRecord),
    remoteCollections: parsedRemote,
    queueCheckpoint: parsedQueue,
    lyricMetadata: parsedLyrics,
  };
}

function parseLocalRecord(value: unknown): LibraryLocalRecord {
  const candidate = object(value);
  const recordId = candidate && boundedString(candidate.recordId, MAX_ID_LENGTH, /^[A-Za-z0-9-]+$/);
  const title = candidate && boundedString(candidate.title, MAX_LIBRARY_TITLE_LENGTH);
  const artist = candidate && boundedString(candidate.artist, MAX_LIBRARY_TITLE_LENGTH);
  const album = candidate?.album;
  const durationMs = candidate?.durationMs;
  const lyricState = candidate?.lyricState;
  const availability = candidate?.availability;
  const capabilities = candidate?.capabilities;
  if (
    !candidate ||
    !exactKeys(candidate, ['recordId', 'title', 'artist', 'album', 'durationMs', 'hasArtwork', 'lyricState', 'availability', 'capabilities']) ||
    !recordId || !title || !artist ||
    !(album === null || boundedString(album, MAX_LIBRARY_TITLE_LENGTH)) ||
    !(durationMs === null || (typeof durationMs === 'number' && Number.isSafeInteger(durationMs) && durationMs >= 0 && durationMs <= 86_400_000)) ||
    typeof candidate.hasArtwork !== 'boolean' ||
    !['none', 'attached'].includes(String(lyricState)) ||
    !['available', 'needs-repair', 'revoked', 'unreadable', 'unsupported', 'duplicate'].includes(String(availability)) ||
    !Array.isArray(capabilities) || capabilities.length > 3 ||
    capabilities.some(item => !['playlist', 'queue', 'lyrics'].includes(String(item))) ||
    new Set(capabilities).size !== capabilities.length
  ) throw new LibraryClientError('INVALID_RESPONSE');
  return { recordId, title, artist, album: album as string | null, durationMs: durationMs as number | null, hasArtwork: candidate.hasArtwork, lyricState: lyricState as 'none' | 'attached', availability: availability as LibraryLocalRecord['availability'], capabilities: capabilities as Array<'playlist' | 'queue' | 'lyrics'> };
}

function parseTrack(value: unknown) {
  const candidate = object(value);
  const source = candidate?.source;
  const trackId = candidate && boundedString(candidate.trackId, MAX_ID_LENGTH, SAFE_ID);
  const title = candidate && boundedString(candidate.title, MAX_LIBRARY_TITLE_LENGTH);
  const artist = candidate && boundedString(candidate.artist, MAX_LIBRARY_TITLE_LENGTH);
  if (!candidate || !exactKeys(candidate, ['source', 'trackId', 'title', 'artist']) || !['netease', 'kugou', 'kuwo', 'qq', 'bilibili', 'local'].includes(String(source)) || !trackId || !title || !artist)
    throw new LibraryClientError('INVALID_RESPONSE');
  return { source: source as 'netease' | 'kugou' | 'kuwo' | 'qq' | 'bilibili' | 'local', trackId, title, artist };
}

function parseReceipt(value: unknown): LibraryMutationReceipt {
  const candidate = object(value);
  const nativeStatus = candidate?.status;
  const requestId = candidate && boundedString(candidate.requestId, MAX_ID_LENGTH, SAFE_ID);
  const nextRevision = candidate && revision(candidate.revision);
  const errorCode = candidate?.errorCode;
  if (
    !candidate ||
    !exactKeys(candidate, ['requestId', 'status', 'revision', 'errorCode', 'snapshot']) ||
    !requestId ||
    nextRevision === null ||
    (nativeStatus !== 'applied' && nativeStatus !== 'stale' && nativeStatus !== 'rejected') ||
    !(
      errorCode === null ||
      errorCode === undefined ||
      boundedString(errorCode, MAX_ERROR_CODE_LENGTH, SAFE_ERROR_CODE)
    )
  )
    throw new LibraryClientError('INVALID_RESPONSE');
  const snapshot = candidate.snapshot === undefined || candidate.snapshot === null
    ? undefined
    : parseLibrarySnapshot(candidate.snapshot);
  return {
    requestId,
    status: nativeStatus === 'applied' ? 'accepted' : nativeStatus === 'stale' ? 'stale-revision' : 'rejected',
    revision: nextRevision,
    errorCode: typeof errorCode === 'string' ? errorCode : null,
    ...(snapshot ? { snapshot } : {}),
  };
}

function parseBackupPreview(value: unknown): LibraryBackupPreview {
  const candidate = object(value);
  if (!candidate || !exactKeys(candidate, ['status', 'token', 'checksum', 'baseRevision', 'addedFavorites', 'addedPlaylists', 'skippedPlaylists', 'conflictedPlaylists', 'errorCode']) || candidate.status !== 'ready' || !boundedString(candidate.token, MAX_ID_LENGTH, SAFE_ID) || !boundedString(candidate.checksum, 64, /^[a-f0-9]{64}$/) || revision(candidate.baseRevision) === null || !['addedFavorites', 'addedPlaylists', 'skippedPlaylists', 'conflictedPlaylists'].every(key => revision(candidate[key]) !== null) || candidate.errorCode !== null)
    throw new LibraryClientError('INVALID_RESPONSE');
  return {
    token: candidate.token as string,
    checksum: candidate.checksum as string,
    baseRevision: candidate.baseRevision as number,
    addedFavorites: candidate.addedFavorites as number,
    addedPlaylists: candidate.addedPlaylists as number,
    skippedPlaylists: candidate.skippedPlaylists as number,
    conflictedPlaylists: candidate.conflictedPlaylists as number,
  };
}

function backupRequest(document: BackupDocument, expectedRevision: number, mode: ImportMode) {
  const track = (value: BackupDocument['favorites'][number]) => ({ source: value.source, trackId: value.id, title: value.title, artist: value.artist });
  return {
    schemaVersion: LIBRARY_SCHEMA_VERSION,
    expectedRevision,
    mode,
    favorites: document.favorites.map(track),
    playlists: document.playlists.map(playlist => ({ playlistId: playlist.id, title: playlist.title, tracks: playlist.tracks.map(track) })),
  };
}

function validateMutation(mutation: LibraryMutation) {
  const candidate = object(mutation);
  const payload = candidate && object(candidate.payload);
  if (
    !candidate ||
    !payload ||
    !exactKeys(candidate, ['requestId', 'revision', 'kind', 'payload']) ||
    !Object.keys(payload).every(key => ['playlistId', 'title', 'direction', 'source', 'trackId', 'artist'].includes(key)) ||
    !['createPlaylist', 'renamePlaylist', 'deletePlaylist', 'movePlaylist', 'addTrack', 'removeTrack', 'favorite', 'unfavorite'].includes(String(candidate.kind))
  )
    throw new LibraryClientError('INVALID_REQUEST');
  const requestId = boundedString(mutation.requestId, MAX_ID_LENGTH, SAFE_ID);
  const values = Object.values(mutation.payload);
  if (!requestId || !values.every(value => boundedString(value, MAX_LIBRARY_TITLE_LENGTH)) || revision(mutation.revision) === null)
    throw new LibraryClientError('INVALID_REQUEST');
}

function parseMigrationStatus(value: unknown): LibraryMigrationStatus {
  const candidate = object(value);
  const phase = candidate?.phase;
  const attemptId = candidate?.attemptId;
  const checksum = candidate?.checksum;
  if (
    !candidate ||
    !exactKeys(candidate, [
      'backend',
      'phase',
      'sourceRetained',
      'laterStartValidated',
      'attemptId',
      'checksum',
    ]) ||
    candidate.backend !== 'Room' ||
    !['not-started', 'copying', 'validated', 'complete', 'failed'].includes(String(phase)) ||
    typeof candidate.sourceRetained !== 'boolean' ||
    typeof candidate.laterStartValidated !== 'boolean' ||
    !(attemptId === null || boundedString(attemptId, MAX_ID_LENGTH, SAFE_ID)) ||
    !(checksum === null || boundedString(checksum, MAX_ID_LENGTH, SAFE_ID))
  )
    throw new LibraryClientError('INVALID_RESPONSE');
  return {
    backend: 'Room',
    phase: phase as LibraryMigrationStatus['phase'],
    sourceRetained: candidate.sourceRetained,
    laterStartValidated: candidate.laterStartValidated,
    attemptId: attemptId as string | null,
    checksum: checksum as string | null,
  };
}

let staleReload: Promise<LibrarySnapshot> | null = null;

export const libraryClient = {
  getSnapshot(): Promise<LibrarySnapshot> {
    return withTimeout(nativeModule().getSnapshot(LIBRARY_SCHEMA_VERSION)).then(parseLibrarySnapshot);
  },
  async applyMutation(mutation: LibraryMutation): Promise<LibraryMutationReceipt> {
    validateMutation(mutation);
    const receipt = parseReceipt(await withTimeout(nativeModule().applyMutation({
      schemaVersion: LIBRARY_SCHEMA_VERSION,
      requestId: mutation.requestId,
      expectedRevision: mutation.revision,
      operation: mutation.kind,
      payload: mutation.payload,
    })));
    if (receipt.requestId !== mutation.requestId)
      throw new LibraryClientError('INVALID_RESPONSE');
    if (receipt.status === 'stale-revision') {
      if (!staleReload) staleReload = this.getSnapshot().finally(() => { staleReload = null; });
      await staleReload;
    }
    return receipt;
  },
  getMigrationStatus(): Promise<LibraryMigrationStatus> {
    return withTimeout(nativeModule().getMigrationStatus()).then(parseMigrationStatus);
  },
  async beginLegacyMigration(request: LegacyMigrationRequest): Promise<LibraryMigrationStatus> {
    const module = nativeModule();
    if (typeof module.beginLegacyMigration !== 'function') throw new LibraryClientError('NATIVE_UNAVAILABLE');
    if (
      !boundedString(request.attemptId, MAX_ID_LENGTH, SAFE_ID) ||
      !boundedString(request.checksum, MAX_ID_LENGTH, SAFE_ID) ||
      request.schemaVersion !== LIBRARY_SCHEMA_VERSION ||
      request.playlists.length > MAX_LIBRARY_PLAYLISTS ||
      request.localEntries.length > MAX_LIBRARY_PLAYLISTS ||
      request.favorites.length > 50_000 || request.queueCheckpoint.length > 50_000 || request.lyricMetadata.length > 50_000 ||
      request.remoteCollections.length > MAX_LIBRARY_PLAYLISTS ||
      request.playlists.some(item => !object(item) || !exactKeys(item, ['playlistId', 'title', 'position', 'tracks']) || !boundedString(item.playlistId, MAX_ID_LENGTH, SAFE_ID) || !boundedString(item.title, MAX_LIBRARY_TITLE_LENGTH) || revision(item.position) === null || !Array.isArray(item.tracks) || item.tracks.some(track => !parseTrackSafe(track))) ||
      request.favorites.some(track => !parseTrackSafe(track, false)) ||
      request.queueCheckpoint.some(item => !object(item) || !exactKeys(item, ['occurrenceId', 'position', 'source', 'trackId']) || !boundedString(item.occurrenceId, MAX_ID_LENGTH, SAFE_ID) || revision(item.position) === null || !['netease', 'kugou', 'kuwo', 'qq', 'bilibili', 'local'].includes(item.source) || !boundedString(item.trackId, MAX_ID_LENGTH, SAFE_ID)) ||
      request.lyricMetadata.some(item => !object(item) || !exactKeys(item, ['source', 'trackId', 'selectedVariantId', 'offsetMillis']) || !['netease', 'kugou', 'kuwo', 'qq', 'bilibili', 'local'].includes(item.source) || !boundedString(item.trackId, MAX_ID_LENGTH, SAFE_ID) || !(item.selectedVariantId === null || boundedString(item.selectedVariantId, MAX_ID_LENGTH, SAFE_ID)) || !Number.isSafeInteger(item.offsetMillis) || Math.abs(item.offsetMillis) > 86_400_000) ||
      request.remoteCollections.some(item => !object(item) || !exactKeys(item, ['collectionId', 'source', 'title', 'syncState']) || !boundedString(item.collectionId, MAX_ID_LENGTH, SAFE_ID) || !['netease', 'kugou', 'kuwo', 'qq', 'bilibili'].includes(item.source) || !boundedString(item.title, MAX_LIBRARY_TITLE_LENGTH) || !['ready', 'refreshing', 'error', 'unavailable'].includes(item.syncState)) ||
      request.localEntries.some(item => !object(item) || !exactKeys(item, ['title', 'artist']) || !boundedString(item.title, MAX_LIBRARY_TITLE_LENGTH) || !boundedString(item.artist, MAX_LIBRARY_TITLE_LENGTH))
    )
      throw new LibraryClientError('INVALID_REQUEST');
    return withTimeout(module.beginLegacyMigration(request)).then(parseMigrationStatus);
  },
  async previewBackup(document: BackupDocument, expectedRevision: number, mode: ImportMode): Promise<LibraryBackupPreview> {
    if (revision(expectedRevision) === null) throw new LibraryClientError('INVALID_REQUEST');
    const module = nativeModule();
    if (typeof module.previewBackup !== 'function') throw new LibraryClientError('NATIVE_UNAVAILABLE');
    return parseBackupPreview(await withTimeout(module.previewBackup(backupRequest(document, expectedRevision, mode))));
  },
  async applyBackup(preview: LibraryBackupPreview): Promise<LibraryMutationReceipt> {
    const module = nativeModule();
    if (typeof module.applyBackup !== 'function') throw new LibraryClientError('NATIVE_UNAVAILABLE');
    return parseReceipt(await withTimeout(module.applyBackup(preview.token, preview.checksum, preview.baseRevision)));
  },
  async replaceRemoteCollections(collections: LibraryRemoteCollection[], expectedRevision?: number): Promise<LibrarySnapshot> {
    const module = nativeModule();
    if (typeof module.replaceRemoteCollections !== 'function') throw new LibraryClientError('NATIVE_UNAVAILABLE');
    if (!validRemoteCollections(collections)) throw new LibraryClientError('INVALID_REQUEST');
    const revisionToUse = expectedRevision === undefined ? (await this.getSnapshot()).revision : expectedRevision;
    if (revision(revisionToUse) === null) throw new LibraryClientError('INVALID_REQUEST');
    return parseLibrarySnapshot(await withTimeout(module.replaceRemoteCollections({ schemaVersion: LIBRARY_SCHEMA_VERSION, expectedRevision: revisionToUse as number, collections })));
  },
  async replaceContinuityMetadata(queueCheckpoint: LibraryQueueCheckpoint[], lyricMetadata: LibraryLyricMetadata[], expectedRevision?: number): Promise<LibrarySnapshot> {
    const module = nativeModule();
    if (typeof module.replaceContinuityMetadata !== 'function') throw new LibraryClientError('NATIVE_UNAVAILABLE');
    if (!validContinuityMetadata(queueCheckpoint, lyricMetadata)) throw new LibraryClientError('INVALID_REQUEST');
    const revisionToUse = expectedRevision === undefined ? (await this.getSnapshot()).revision : expectedRevision;
    if (revision(revisionToUse) === null) throw new LibraryClientError('INVALID_REQUEST');
    return parseLibrarySnapshot(await withTimeout(module.replaceContinuityMetadata({ schemaVersion: LIBRARY_SCHEMA_VERSION, expectedRevision: revisionToUse as number, queueCheckpoint, lyricMetadata })));
  },
};

function validRemoteCollections(collections: LibraryRemoteCollection[]) {
  return Array.isArray(collections) && collections.length <= MAX_LIBRARY_PLAYLISTS &&
    collections.every(item => object(item) !== null && exactKeys(item as UnknownRecord, ['collectionId', 'source', 'title', 'syncState']) && boundedString(item.collectionId, MAX_ID_LENGTH, SAFE_ID) !== null && ['netease', 'kugou', 'kuwo', 'qq', 'bilibili'].includes(item.source) && boundedString(item.title, MAX_LIBRARY_TITLE_LENGTH) !== null && ['ready', 'refreshing', 'error', 'unavailable'].includes(item.syncState)) &&
    new Set(collections.map(item => item.collectionId)).size === collections.length;
}

function validContinuityMetadata(queueCheckpoint: LibraryQueueCheckpoint[], lyricMetadata: LibraryLyricMetadata[]) {
  return Array.isArray(queueCheckpoint) && queueCheckpoint.length <= 50_000 &&
    Array.isArray(lyricMetadata) && lyricMetadata.length <= 50_000 &&
    new Set(queueCheckpoint.map(item => item.occurrenceId)).size === queueCheckpoint.length &&
    queueCheckpoint.every(item => object(item) !== null && exactKeys(item as UnknownRecord, ['occurrenceId', 'position', 'source', 'trackId']) && boundedString(item.occurrenceId, MAX_ID_LENGTH, SAFE_ID) !== null && revision(item.position) !== null && ['netease', 'kugou', 'kuwo', 'qq', 'bilibili', 'local'].includes(item.source) && boundedString(item.trackId, MAX_ID_LENGTH, SAFE_ID) !== null) &&
    lyricMetadata.every(item => object(item) !== null && exactKeys(item as UnknownRecord, ['source', 'trackId', 'selectedVariantId', 'offsetMillis']) && ['netease', 'kugou', 'kuwo', 'qq', 'bilibili', 'local'].includes(item.source) && boundedString(item.trackId, MAX_ID_LENGTH, SAFE_ID) !== null && (item.selectedVariantId === null || boundedString(item.selectedVariantId, MAX_ID_LENGTH, SAFE_ID) !== null) && Number.isSafeInteger(item.offsetMillis) && Math.abs(item.offsetMillis) <= 86_400_000);
}

function parseTrackSafe(value: unknown, localAllowed = true) {
  const parsed = (() => { try { return parseTrack(value); } catch { return null; } })();
  return parsed && (localAllowed || parsed.source !== 'local');
}
