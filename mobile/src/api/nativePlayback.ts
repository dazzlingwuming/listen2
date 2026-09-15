import { NativeModules } from 'react-native';
import type { BootstrapTrack, SourceId, Track } from '../types';
import { ProviderClientError } from './errors';

const VERSION = 1;
const MAX_LEASE_MS = 60_000;
const MAX_MEDIA_BYTES = 512 * 1024 * 1024;
const MAX_MEDIA_URL = 4096;
const allowedMime = new Set([
  'audio/mpeg',
  'audio/mp4',
  'audio/aac',
  'audio/x-m4a',
]);
const sourceModule = {
  qq: 'Listen2QqPlayback',
  kuwo: 'Listen2KuwoPlayback',
} as const;
const expectedHosts = {
  qq: new Set(['isure.stream.qqmusic.qq.com']),
  kuwo: new Set(['er-sycdn.kuwo.cn']),
} as const;
type NativeSource = keyof typeof sourceModule;
type NativeResolver = Record<string, unknown>;
let sequence = 0;

function error(code: string, source: SourceId): never {
  throw new ProviderClientError(code as any, source, 'bootstrap');
}
function nativeFor(source: NativeSource): NativeResolver | undefined {
  const candidate = NativeModules[sourceModule[source]];
  return candidate && typeof candidate === 'object'
    ? (candidate as NativeResolver)
    : undefined;
}
function constants(source: NativeSource): { hosts: Set<string> } | null {
  const native = nativeFor(source);
  if (
    !native ||
    native.provider !== source ||
    native.version !== VERSION ||
    native.policyReady !== true ||
    !Array.isArray(native.approvedHosts)
  )
    return null;
  const hosts = native.approvedHosts;
  if (
    !hosts.length ||
    hosts.some(
      host => typeof host !== 'string' || !/^[a-z0-9.-]{1,253}$/.test(host),
    )
  )
    return null;
  const expected = expectedHosts[source];
  if (
    hosts.length !== expected.size ||
    new Set(hosts).size !== hosts.length ||
    hosts.some(host => !expected.has(host))
  )
    return null;
  return { hosts: new Set(hosts) };
}
function safeRequestId(source: NativeSource): string {
  sequence = (sequence + 1) % 1_000_000_000;
  return `${source}-${Date.now().toString(36)}-${sequence.toString(36)}`;
}
function safeError(value: unknown): string {
  const code =
    value && typeof value === 'object'
      ? (value as Record<string, unknown>).errorCode
      : undefined;
  return typeof code === 'string' && /^[A-Z_]{3,64}$/.test(code)
    ? code
    : 'INVALID_RESPONSE';
}
function descriptor(
  value: unknown,
  source: NativeSource,
  requestId: string,
  trackId: string,
  hosts: Set<string>,
): BootstrapTrack {
  const raw =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : error('INVALID_RESPONSE', source);
  if (typeof raw.errorCode === 'string') error(safeError(raw), source);
  const keys = [
    'version',
    'requestId',
    'trackId',
    'source',
    'url',
    'mimeType',
    'sizeBytes',
    'expiresAt',
  ];
  if (
    Object.keys(raw).length !== keys.length ||
    Object.keys(raw).some(key => !keys.includes(key))
  )
    error('INVALID_RESPONSE', source);
  if (
    raw.version !== VERSION ||
    raw.requestId !== requestId ||
    raw.trackId !== trackId ||
    raw.source !== source ||
    typeof raw.url !== 'string' ||
    raw.url.length > MAX_MEDIA_URL ||
    typeof raw.mimeType !== 'string' ||
    !allowedMime.has(raw.mimeType) ||
    !Number.isSafeInteger(raw.sizeBytes) ||
    (raw.sizeBytes as number) < 1 ||
    (raw.sizeBytes as number) > MAX_MEDIA_BYTES ||
    !Number.isSafeInteger(raw.expiresAt) ||
    (raw.expiresAt as number) <= Date.now() ||
    (raw.expiresAt as number) - Date.now() > MAX_LEASE_MS
  )
    error('INVALID_RESPONSE', source);
  try {
    const url = new URL(raw.url);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      url.hash ||
      !hosts.has(url.hostname)
    )
      error('INVALID_RESPONSE', source);
  } catch {
    return error('INVALID_RESPONSE', source);
  }
  return { trackId, source, url: raw.url as string };
}

export function isNativePlaybackReady(source: SourceId): boolean {
  return (source === 'qq' || source === 'kuwo') && constants(source) !== null;
}

export async function bootstrapNativeTrack(
  track: Track,
  signal?: AbortSignal,
): Promise<BootstrapTrack> {
  const source = track.source;
  if (
    (source !== 'qq' && source !== 'kuwo') ||
    !new RegExp(
      `^${
        source === 'qq'
          ? 'qqtrack_[A-Za-z0-9_-]{1,128}'
          : 'kwtrack_[1-9][0-9]{0,17}'
      }$`,
    ).test(track.id)
  )
    error('UNKNOWN_TRACK', source);
  const policy = constants(source);
  const native = nativeFor(source);
  const resolve = native?.resolveAudio;
  const cancel = native?.cancel;
  if (!policy || typeof resolve !== 'function' || typeof cancel !== 'function')
    error('PLAYBACK_UNAVAILABLE', source);
  if (signal?.aborted) error('CANCELLED', source);
  const requestId = safeRequestId(source);
  let cancelled = false;
  let rejectAbort: ((reason: ProviderClientError) => void) | undefined;
  const abortResult = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  const abort = () => {
    if (!cancelled) {
      cancelled = true;
      void (cancel as (request: unknown) => Promise<unknown>)({
        version: VERSION,
        requestId,
      }).catch(() => undefined);
      rejectAbort?.(new ProviderClientError('CANCELLED', source, 'bootstrap'));
    }
  };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const result = await Promise.race([
      (resolve as (request: unknown) => Promise<unknown>)({
        version: VERSION,
        requestId,
        trackId: track.id,
      }),
      abortResult,
    ]);
    if (cancelled || signal?.aborted) error('CANCELLED', source);
    return descriptor(result, source, requestId, track.id, policy.hosts);
  } catch (cause) {
    if (cancelled || signal?.aborted) error('CANCELLED', source);
    if (cause instanceof ProviderClientError) throw cause;
    return error(safeError(cause), source);
  } finally {
    signal?.removeEventListener('abort', abort);
  }
}
