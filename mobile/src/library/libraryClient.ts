import { NativeModules } from 'react-native';
import {
  LIBRARY_SCHEMA_VERSION,
  MAX_LIBRARY_PLAYLISTS,
  MAX_LIBRARY_TITLE_LENGTH,
  type LibraryMigrationStatus,
  type LibraryMutation,
  type LibraryMutationReceipt,
  type LibraryPlaylistRecord,
  type LibrarySnapshot,
} from './types';

const CALL_TIMEOUT_MS = 8_000;
const MAX_ID_LENGTH = 128;
const MAX_ERROR_CODE_LENGTH = 64;
const SAFE_ID = /^[A-Za-z0-9._:-]+$/;
const SAFE_ERROR_CODE = /^[A-Z][A-Z0-9_]*$/;

type UnknownRecord = Record<string, unknown>;
type NativeLibraryModule = {
  getSnapshot(schemaVersion: number): Promise<unknown>;
  applyMutation(mutation: LibraryMutation): Promise<unknown>;
  getMigrationStatus(): Promise<unknown>;
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
    !exactKeys(candidate, ['schemaVersion', 'revision', 'personalPlaylists']) ||
    candidate.schemaVersion !== LIBRARY_SCHEMA_VERSION ||
    revision(candidate.revision) === null ||
    !Array.isArray(candidate.personalPlaylists) ||
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
      !exactKeys(playlist, ['playlistId', 'title', 'position']) ||
      !playlistId ||
      !title ||
      position === null
    )
      throw new LibraryClientError('INVALID_RESPONSE');
    return { playlistId, title, position };
  });
  personalPlaylists.sort((left, right) => left.position - right.position);
  if (personalPlaylists.some((playlist, index) => playlist.position !== index))
    throw new LibraryClientError('INVALID_RESPONSE');
  return {
    schemaVersion: LIBRARY_SCHEMA_VERSION,
    revision: revision(candidate.revision) as number,
    personalPlaylists,
  };
}

function parseReceipt(value: unknown): LibraryMutationReceipt {
  const candidate = object(value);
  const status = candidate?.status;
  const requestId = candidate && boundedString(candidate.requestId, MAX_ID_LENGTH, SAFE_ID);
  const nextRevision = candidate && revision(candidate.revision);
  const errorCode = candidate?.errorCode;
  if (
    !candidate ||
    !exactKeys(candidate, ['requestId', 'status', 'revision', 'errorCode', 'snapshot']) ||
    !requestId ||
    nextRevision === null ||
    (status !== 'accepted' && status !== 'stale-revision' && status !== 'rejected') ||
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
    status,
    revision: nextRevision,
    errorCode: typeof errorCode === 'string' ? errorCode : null,
    ...(snapshot ? { snapshot } : {}),
  };
}

function validateMutation(mutation: LibraryMutation) {
  const candidate = object(mutation);
  const payload = candidate && object(candidate.payload);
  if (
    !candidate ||
    !payload ||
    !exactKeys(candidate, ['requestId', 'revision', 'kind', 'payload']) ||
    !exactKeys(payload, ['playlistId', 'title']) ||
    candidate.kind !== 'createPlaylist'
  )
    throw new LibraryClientError('INVALID_REQUEST');
  const requestId = boundedString(mutation.requestId, MAX_ID_LENGTH, SAFE_ID);
  const playlistId = boundedString(mutation.payload.playlistId, MAX_ID_LENGTH, SAFE_ID);
  const title = boundedString(mutation.payload.title, MAX_LIBRARY_TITLE_LENGTH);
  if (!requestId || !playlistId || !title || revision(mutation.revision) === null)
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
    const receipt = parseReceipt(await withTimeout(nativeModule().applyMutation(mutation)));
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
};
