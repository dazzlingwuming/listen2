import { NativeModules } from 'react-native';
import type {
  MediaDescriptor,
  MediaPart,
  MediaRendition,
  ProviderErrorCode,
  SourceId,
  Track,
} from '../types';
import { sourceForTrackId } from './ids';
import { ProviderClientError } from './errors';

/** Version of the semantic resolver/descriptor protocol. */
export const NATIVE_MEDIA_VERSION = 1 as const;

/** This is the application-owned authority declared by AndroidManifest.xml. */
export const NATIVE_MEDIA_AUTHORITY = 'com.dazzlingwuming.listen2.media';

const MAX_DESCRIPTOR_TTL_MS = 120_000;
const MAX_MEDIA_BYTES = 20 * 1024 * 1024 * 1024;
const MAX_DURATION_MS = 24 * 60 * 60 * 1000;
const LEASE_ID = '[a-f0-9]{48}';
const REQUEST_ID = /^[A-Za-z0-9_-]{8,96}$/;
const TEXT = /^[^\u0000-\u001f]{1,256}$/;
const PART_ID = /^[A-Za-z0-9_.:-]{1,80}$/;
const RENDITION_ID = /^[A-Za-z0-9_.-]{1,80}$/;
const CONTAINER = /^[a-z0-9]{1,16}$/;
const CODEC = /^[A-Za-z0-9._-]{1,80}$/;
const allowedMime = new Set([
  'audio/aac',
  'audio/flac',
  'audio/m4a',
  'audio/mp4',
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
  'audio/x-flac',
  'audio/x-m4a',
]);

const sourceModules: Readonly<Record<SourceId, string>> = {
  bilibili: 'Listen2Bilibili',
  netease: 'Listen2NeteasePlayback',
  kugou: 'Listen2KugouPlayback',
  qq: 'Listen2QqPlayback',
  kuwo: 'Listen2KuwoPlayback',
};

const sourceCancelMethods: Readonly<Record<SourceId, string>> = {
  bilibili: 'cancelAudio',
  netease: 'cancel',
  kugou: 'cancel',
  qq: 'cancel',
  kuwo: 'cancel',
};
const approvedHosts: Readonly<Record<SourceId, readonly string[]>> = {
  bilibili: ['bilivideo.com'],
  netease: ['music.163.com'],
  kugou: ['wwwapi.kugou.com', 'sharefs.kugou.com'],
  qq: ['isure.stream.qqmusic.qq.com'],
  kuwo: ['er-sycdn.kuwo.cn'],
};

const safeErrorCodes = new Set<ProviderErrorCode>([
  'INVALID_REQUEST',
  'UNKNOWN_SOURCE',
  'UNKNOWN_TRACK',
  'ROUTE_UNAVAILABLE',
  'PLAYBACK_UNAVAILABLE',
  'LYRIC_UNAVAILABLE',
  'REQUEST_TIMEOUT',
  'CANCELLED',
  'NETWORK_ERROR',
  'PROVIDER_ERROR',
  'INVALID_RESPONSE',
  'LOGIN_REQUIRED',
  'MEMBERSHIP_REQUIRED',
  'DRM_RESTRICTED',
  'REGION_RESTRICTED',
  'DOWNLOAD_FIRST',
  'API_LEVEL_UNSUPPORTED',
  'EXPIRED',
]);

type NativeResolver = Record<string, unknown>;
let sequence = 0;

function nativeFor(source: SourceId): NativeResolver | undefined {
  const candidate = NativeModules[sourceModules[source]];
  return candidate && typeof candidate === 'object'
    ? (candidate as NativeResolver)
    : undefined;
}

function throwError(code: ProviderErrorCode, source: SourceId): never {
  throw new ProviderClientError(code, source, 'bootstrap');
}

function errorCode(value: unknown): ProviderErrorCode {
  if (
    typeof value === 'string' &&
    safeErrorCodes.has(value as ProviderErrorCode)
  )
    return value as ProviderErrorCode;
  return 'INVALID_RESPONSE';
}

function nativeContractIsValid(source: SourceId, native: NativeResolver) {
  const resolve = native.resolveAudio;
  const cancel = native[sourceCancelMethods[source]];
  if (typeof resolve !== 'function' || typeof cancel !== 'function') return false;

  // The resolver is available only when the native module proves the same
  // provider, protocol version, policy gate, and app-owned URI authority.
  return (
    native.provider === source &&
    native.version === NATIVE_MEDIA_VERSION &&
    native.policyReady === true &&
    native.mediaAuthority === NATIVE_MEDIA_AUTHORITY &&
    Array.isArray(native.approvedHosts) &&
    native.approvedHosts.length === approvedHosts[source].length &&
    native.approvedHosts.every(
      (host, index) => host === approvedHosts[source][index],
    )
  );
}

function safeRequestId(source: SourceId): string {
  sequence = (sequence + 1) % 1_000_000_000;
  return `media-${source}-${Date.now().toString(36)}-${sequence.toString(36)}`;
}

function exactKeys(
  raw: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
) {
  const allowed = new Set([...required, ...optional]);
  const keys = Object.keys(raw);
  return !(
    keys.some(key => !allowed.has(key)) ||
    required.some(key => !Object.prototype.hasOwnProperty.call(raw, key))
  );
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown, expression: RegExp = TEXT): string | null {
  return typeof value === 'string' && expression.test(value) ? value : null;
}

function safeInteger(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= min &&
    value <= max
    ? value
    : null;
}

function safeSize(value: unknown): number | undefined | null {
  if (value === undefined) return undefined;
  return safeInteger(value, 1, MAX_MEDIA_BYTES);
}

function safeUri(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 256) return null;
  const pattern = new RegExp(
    `^content://${NATIVE_MEDIA_AUTHORITY}/lease/${LEASE_ID}$`,
  );
  if (!pattern.test(value)) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'content:' &&
      parsed.hostname === NATIVE_MEDIA_AUTHORITY &&
      parsed.username === '' &&
      parsed.password === '' &&
      parsed.port === '' &&
      parsed.search === '' &&
      parsed.hash === ''
      ? value
      : null;
  } catch {
    return null;
  }
}

function safePart(value: unknown): MediaPart | null {
  const raw = object(value);
  if (!raw || !exactKeys(raw, ['cid', 'page', 'title'], ['durationMs']))
    return null;
  const cid = text(raw.cid, /^[1-9][0-9]{0,17}$/);
  const page = text(raw.page, /^[1-9][0-9]{0,2}$/);
  const title = text(raw.title);
  const durationMs =
    raw.durationMs === undefined
      ? undefined
      : safeInteger(raw.durationMs, 1, MAX_DURATION_MS);
  return cid && page && title && (raw.durationMs === undefined || durationMs)
    ? {
        cid,
        page,
        title,
        ...(durationMs === undefined || durationMs === null
          ? {}
          : { durationMs }),
      }
    : null;
}

function safeRendition(value: unknown): MediaRendition | null {
  const raw = object(value);
  if (
    !raw ||
    !exactKeys(
      raw,
      ['id', 'label', 'mimeType', 'container', 'codec', 'durationMs'],
      ['sizeBytes'],
    )
  )
    return null;
  const id = text(raw.id, RENDITION_ID);
  const label = text(raw.label);
  const mimeType =
    typeof raw.mimeType === 'string' && allowedMime.has(raw.mimeType)
      ? raw.mimeType
      : null;
  const container = text(raw.container, CONTAINER);
  const codec = text(raw.codec, CODEC);
  const durationMs = safeInteger(raw.durationMs, 1, MAX_DURATION_MS);
  const sizeBytes = safeSize(raw.sizeBytes);
  if (
    !id ||
    !label ||
    !mimeType ||
    !container ||
    !codec ||
    !durationMs ||
    (raw.sizeBytes !== undefined && !sizeBytes)
  )
    return null;
  return {
    id,
    label,
    mimeType,
    container,
    codec,
    durationMs,
    ...(sizeBytes === undefined || sizeBytes === null ? {} : { sizeBytes }),
  };
}

const descriptorRequiredKeys = [
  'version',
  'requestId',
  'source',
  'semanticTrackId',
  'generation',
  'playableUri',
  'mimeType',
  'container',
  'codec',
  'durationMs',
  'selectedRenditionId',
  'renditions',
  'entitlementStatus',
  'leaseExpiresAt',
] as const;

/**
 * Validate and normalize a native reply. This is the sole point where native
 * descriptor data becomes a JS playback value.
 */
export function validateNativeMediaDescriptor(
  value: unknown,
  expected: Pick<Track, 'id' | 'source'> & { requestId: string },
): MediaDescriptor {
  const raw = object(value);
  if (!raw) throwError('INVALID_RESPONSE', expected.source);
  if (
    raw &&
    Object.keys(raw).length === 1 &&
    typeof raw.errorCode === 'string'
  )
    throwError(errorCode(raw.errorCode), expected.source);
  if (
    !raw ||
    !exactKeys(raw, descriptorRequiredKeys, ['partId', 'sizeBytes', 'parts'])
  )
    throwError('INVALID_RESPONSE', expected.source);

  const now = Date.now();
  const source = raw.source;
  const semanticTrackId = raw.semanticTrackId;
  const requestId = raw.requestId;
  const generation = safeInteger(raw.generation, 0, Number.MAX_SAFE_INTEGER);
  const playableUri = safeUri(raw.playableUri);
  const leaseExpiresAt = safeInteger(
    raw.leaseExpiresAt,
    now + 1,
    now + MAX_DESCRIPTOR_TTL_MS + 5_000,
  );
  const mimeType =
    typeof raw.mimeType === 'string' && allowedMime.has(raw.mimeType)
      ? raw.mimeType
      : null;
  const container = text(raw.container, CONTAINER);
  const codec = text(raw.codec, CODEC);
  const durationMs = safeInteger(raw.durationMs, 1, MAX_DURATION_MS);
  const sizeBytes = safeSize(raw.sizeBytes);
  const entitlementStatus = raw.entitlementStatus;
  const partId = raw.partId;

  if (
    raw.version !== NATIVE_MEDIA_VERSION ||
    requestId !== expected.requestId ||
    source !== expected.source ||
    semanticTrackId !== expected.id ||
    !REQUEST_ID.test(String(requestId)) ||
    generation === null ||
    !playableUri ||
    leaseExpiresAt === null ||
    !mimeType ||
    !container ||
    !codec ||
    !durationMs ||
    (raw.sizeBytes !== undefined && !sizeBytes) ||
    entitlementStatus !== 'allowed'
  )
    throwError('INVALID_RESPONSE', expected.source);

  if (expected.source === 'bilibili') {
    const match = /^bitrack_v_BV[0-9A-Za-z]{6,32}-([1-9][0-9]{0,17})$/.exec(
      expected.id,
    );
    if (!match || partId !== match[1])
      throwError('INVALID_RESPONSE', expected.source);
  } else if (partId !== undefined) {
    throwError('INVALID_RESPONSE', expected.source);
  }
  if (
    partId !== undefined &&
    (typeof partId !== 'string' || !PART_ID.test(partId))
  )
    throwError('INVALID_RESPONSE', expected.source);

  const renditionValues = raw.renditions;
  if (
    !Array.isArray(renditionValues) ||
    renditionValues.length < 1 ||
    renditionValues.length > 8
  )
    throwError('INVALID_RESPONSE', expected.source);
  const renditions = renditionValues.map(safeRendition);
  if (renditions.some(value => value === null))
    throwError('INVALID_RESPONSE', expected.source);
  const safeRenditions = renditions as MediaRendition[];
  if (
    new Set(safeRenditions.map(value => value.id)).size !==
    safeRenditions.length
  )
    throwError('INVALID_RESPONSE', expected.source);
  const selectedRenditionId = raw.selectedRenditionId;
  if (
    typeof selectedRenditionId !== 'string' ||
    !RENDITION_ID.test(selectedRenditionId)
  )
    throwError('INVALID_RESPONSE', expected.source);
  const selected = safeRenditions.find(
    value => value.id === selectedRenditionId,
  );
  if (
    !selected ||
    selected.mimeType !== mimeType ||
    selected.container !== container ||
    selected.codec !== codec ||
    selected.durationMs !== durationMs
  )
    throwError('INVALID_RESPONSE', expected.source);
  if ((selected.sizeBytes ?? undefined) !== (sizeBytes ?? undefined))
    throwError('INVALID_RESPONSE', expected.source);

  const rawParts = raw.parts;
  let parts: readonly MediaPart[] | undefined;
  if (rawParts !== undefined) {
    if (
      !Array.isArray(rawParts) ||
      rawParts.length < 1 ||
      rawParts.length > 50
    )
      throwError('INVALID_RESPONSE', expected.source);
    const safeParts = rawParts.map(safePart);
    if (safeParts.some(value => value === null))
      throwError('INVALID_RESPONSE', expected.source);
    parts = safeParts as MediaPart[];
    if (new Set(parts.map(value => value.cid)).size !== parts.length)
      throwError('INVALID_RESPONSE', expected.source);
    if (
      expected.source === 'bilibili' &&
      !parts.some(value => value.cid === partId)
    )
      throwError('INVALID_RESPONSE', expected.source);
  }

  return {
    version: NATIVE_MEDIA_VERSION,
    requestId: expected.requestId,
    source: expected.source,
    semanticTrackId: expected.id,
    ...(partId === undefined ? {} : { partId }),
    generation,
    playableUri,
    mimeType,
    container,
    codec,
    durationMs,
    ...(sizeBytes === undefined || sizeBytes === null ? {} : { sizeBytes }),
    selectedRenditionId,
    renditions: safeRenditions,
    ...(parts === undefined ? {} : { parts }),
    entitlementStatus: 'allowed',
    leaseExpiresAt,
  };
}

function requestForTrack(track: Track, requestId: string): Record<string, unknown> {
  if (track.source === 'bilibili') {
    const match = /^bitrack_v_(BV[0-9A-Za-z]{6,32})-([1-9][0-9]{0,17})$/.exec(
      track.id,
    );
    if (!match) throwError('UNKNOWN_TRACK', track.source);
    return {
      version: NATIVE_MEDIA_VERSION,
      requestId,
      bvid: match[1],
      cid: match[2],
    };
  }
  return { version: NATIVE_MEDIA_VERSION, requestId, trackId: track.id };
}

function invoke(
  fn: unknown,
  request: Record<string, unknown>,
): Promise<unknown> {
  return Promise.resolve(
    (fn as (value: Record<string, unknown>) => unknown)(request),
  );
}

export function isNativePlaybackReady(source: SourceId): boolean {
  const native = nativeFor(source);
  return native !== undefined && nativeContractIsValid(source, native);
}

/** Resolve semantic track identity to a descriptor; no provider transport is accepted here. */
export async function resolveNativeMedia(
  track: Track,
  signal?: AbortSignal,
): Promise<MediaDescriptor> {
  const source = sourceForTrackId(track.id);
  if (!source || source !== track.source) {
    throwError(
      source === null ? 'UNKNOWN_TRACK' : 'INVALID_REQUEST',
      track.source,
    );
  }
  // `throwError` is typed as `never`; the explicit guard also keeps this
  // narrowing stable across TypeScript versions used by the mobile package.
  if (!source) throw new Error('unreachable-source');
  const resolvedSource: SourceId = source;
  const native = nativeFor(resolvedSource);
  if (!native || !nativeContractIsValid(resolvedSource, native))
    throwError('PLAYBACK_UNAVAILABLE', resolvedSource);
  if (signal?.aborted) throwError('CANCELLED', resolvedSource);

  const requestId = safeRequestId(resolvedSource);
  const request = requestForTrack(track, requestId);
  const cancel = native[sourceCancelMethods[resolvedSource]];
  let cancelled = false;
  let rejectAbort: ((reason: ProviderClientError) => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  const abort = () => {
    if (cancelled) return;
    cancelled = true;
    try {
      void invoke(cancel, { version: NATIVE_MEDIA_VERSION, requestId }).catch(
        () => undefined,
      );
    } catch {
      // The caller still receives the deterministic cancellation result.
    }
    rejectAbort?.(
      new ProviderClientError('CANCELLED', resolvedSource, 'bootstrap'),
    );
  };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const result = await Promise.race([
      invoke(native.resolveAudio, request),
      aborted,
    ]);
    if (cancelled || signal?.aborted)
      throwError('CANCELLED', resolvedSource);
    return validateNativeMediaDescriptor(result, {
      id: track.id,
      source: resolvedSource,
      requestId,
    });
  } catch (cause) {
    if (cancelled || signal?.aborted)
      throwError('CANCELLED', resolvedSource);
    if (cause instanceof ProviderClientError) throw cause;
    throw new ProviderClientError('PROVIDER_ERROR', resolvedSource, 'bootstrap');
  } finally {
    signal?.removeEventListener('abort', abort);
  }
}
