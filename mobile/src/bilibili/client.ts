import { NativeModules } from 'react-native';
import { parseExactBilibiliTrackId } from '../api/ids';
import { resolveNativeMedia } from '../api/nativePlayback';
import type { MediaDescriptor } from '../types';
import type {
  BilibiliAudioRequest,
  BilibiliPart,
  BilibiliPublicState,
  BilibiliPublicStatus,
  BilibiliSearchPage,
  BilibiliVideoDetail,
} from './types';

const MAX_TEXT = 256;
const MAX_QR_DATA_URI = 192 * 1024;
const MAX_SEARCH_QUERY_BYTES = 256;
const MAX_SEARCH_PAGE = 1_000;
const MAX_SEARCH_ROWS = 50;
const MAX_SEARCH_TOTAL = 1_000_000_000;
const statusValues = new Set<BilibiliPublicStatus>([
  'idle',
  'waiting',
  'scanned',
  'authenticated',
  'expired',
  'cancelled',
  'error',
  'unavailable',
]);
const native = NativeModules.Listen2Bilibili as
  | Record<string, unknown>
  | undefined;

export class BilibiliClientError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'BilibiliClientError';
  }
}
const fail = (code = 'INVALID_RESPONSE'): never => {
  throw new BilibiliClientError(code);
};
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : fail();
const keys = (
  value: Record<string, unknown>,
  allowed: readonly string[],
  optional: readonly string[] = [],
) => {
  const accepted = new Set([...allowed, ...optional]);
  if (Object.keys(value).some(key => !accepted.has(key))) fail();
};
const text = (value: unknown, limit = MAX_TEXT): string =>
  typeof value === 'string' &&
  value.trim() &&
  value.length <= limit &&
  !/[\u0000-\u001f]/.test(value)
    ? value.trim()
    : fail();
const numericText = (value: unknown): string =>
  typeof value === 'string' &&
  /^[1-9][0-9]{0,17}$/.test(value) &&
  Number.isSafeInteger(Number(value))
    ? value
    : fail();
const utf8ByteLength = (value: string): number => {
  try {
    return encodeURIComponent(value).replace(/%[0-9a-f]{2}/gi, 'x').length;
  } catch {
    return -1;
  }
};
const searchQuery = (value: unknown): string => {
  const candidate = text(value, MAX_TEXT);
  return utf8ByteLength(candidate) <= MAX_SEARCH_QUERY_BYTES
    ? candidate
    : fail('INVALID_REQUEST');
};
const searchPageNumber = (value: unknown): number =>
  typeof value === 'number' &&
  Number.isSafeInteger(value) &&
  value >= 1 &&
  value <= MAX_SEARCH_PAGE
    ? value
    : fail('INVALID_REQUEST');
const bvid = (value: unknown) =>
  /^BV[0-9A-Za-z]{6,32}$/.test(text(value, 40))
    ? text(value, 40)
    : fail('INVALID_REQUEST');
const errorCode = (value: unknown) =>
  typeof value === 'string' && /^[A-Z_]{3,64}$/.test(value) ? value : undefined;

function qr(value: unknown): string {
  if (value === '') return '';
  const candidate = text(value, MAX_QR_DATA_URI);
  return candidate.startsWith('data:image/png;base64,') &&
    /^[A-Za-z0-9+/=]+$/.test(candidate.slice(22))
    ? candidate
    : fail();
}
function call(name: string, ...args: unknown[]): Promise<unknown> {
  const fn = native?.[name];
  if (typeof fn !== 'function')
    return Promise.reject(new BilibiliClientError('UNAVAILABLE'));
  return (fn as (...items: unknown[]) => Promise<unknown>)(...args);
}
function publicState(value: unknown): BilibiliPublicState {
  const raw = object(value);
  keys(raw, [
    'status',
    'attemptId',
    'expiresAt',
    'qrPngDataUri',
    'displayName',
    'avatarUrl',
    'retryable',
    'nextAction',
    'errorCode',
  ]);
  if (raw.errorCode) fail(errorCode(raw.errorCode));
  const status = text(raw.status, 16) as BilibiliPublicStatus;
  const retryable = raw.retryable;
  if (!statusValues.has(status) || typeof retryable !== 'boolean') fail();
  const attemptId = raw.attemptId === '' ? '' : text(raw.attemptId, 64);
  const expiresAt =
    typeof raw.expiresAt === 'number' &&
    Number.isSafeInteger(raw.expiresAt) &&
    raw.expiresAt >= 0
      ? raw.expiresAt
      : fail();
  const png = qr(raw.qrPngDataUri);
  const nextAction = raw.nextAction;
  if (
    nextAction !== 'begin' &&
    nextAction !== 'poll' &&
    nextAction !== 'logout'
  )
    fail();
  const active = status === 'waiting' || status === 'scanned';
  if (
    active !== Boolean(attemptId) ||
    active !== Boolean(png) ||
    (active && expiresAt <= Date.now())
  )
    fail();
  return {
    status,
    attemptId,
    expiresAt,
    qrPngDataUri: png,
    displayName:
      raw.displayName === undefined ? undefined : text(raw.displayName, 80),
    avatarUrl:
      raw.avatarUrl === undefined ? undefined : safeAvatar(raw.avatarUrl),
    retryable: retryable as boolean,
    nextAction: nextAction as 'begin' | 'poll' | 'logout',
  };
}
function safeAvatar(value: unknown): string {
  const candidate = text(value, 2048);
  try {
    const url = new URL(candidate);
    return url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.hash
      ? url.toString()
      : fail();
  } catch {
    return fail();
  }
}
function part(value: unknown, index: number): BilibiliPart {
  const raw = object(value);
  keys(raw, ['cid', 'page', 'title', 'durationMs']);
  const page = numericText(raw.page);
  if (Number(page) !== index + 1) fail();
  const duration = raw.durationMs;
  return {
    cid: numericText(raw.cid),
    page,
    title: text(raw.title, 160),
    durationMs:
      duration === undefined
        ? undefined
        : typeof duration === 'number' &&
          Number.isSafeInteger(duration) &&
          duration > 0 &&
          duration <= 8 * 60 * 60 * 1000
        ? duration
        : fail(),
  };
}
function detail(value: unknown): BilibiliVideoDetail {
  const raw = object(value);
  keys(raw, ['bvid', 'title', 'owner', 'parts']);
  const parts = raw.parts;
  if (!Array.isArray(parts) || parts.length < 1 || parts.length > 50) fail();
  return {
    bvid: bvid(raw.bvid),
    title: text(raw.title, 160),
    owner: raw.owner === undefined ? undefined : text(raw.owner, 80),
    parts: (parts as unknown[]).map(part),
  };
}
function searchArtwork(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const candidate = text(value, 2048);
  try {
    const url = new URL(candidate);
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.hash &&
      !url.port &&
      (host === 'hdslb.com' ||
        host.endsWith('.hdslb.com') ||
        host === 'biliimg.com' ||
        host.endsWith('.biliimg.com'))
      ? url.toString()
      : fail();
  } catch {
    return fail();
  }
}
function searchTrack(value: unknown) {
  const raw = object(value);
  keys(raw, ['bvid', 'title', 'artist'], ['durationMs', 'artworkUrl']);
  const duration = raw.durationMs;
  return {
    bvid: bvid(raw.bvid),
    title: text(raw.title, 160),
    artist: text(raw.artist, 160),
    durationMs:
      duration === undefined
        ? undefined
        : typeof duration === 'number' &&
          Number.isSafeInteger(duration) &&
          duration > 0 &&
          duration <= 8 * 60 * 60 * 1000
        ? duration
        : fail(),
    artworkUrl: searchArtwork(raw.artworkUrl),
  };
}
function searchResultPage(value: unknown): BilibiliSearchPage {
  const raw = object(value);
  if (raw.errorCode !== undefined) fail(errorCode(raw.errorCode));
  keys(raw, ['query', 'page', 'results'], ['total']);
  const rowsValue = raw.results;
  if (!Array.isArray(rowsValue) || rowsValue.length > MAX_SEARCH_ROWS) fail();
  const rows = rowsValue as unknown[];
  const total = raw.total;
  return {
    query: searchQuery(raw.query),
    page: searchPageNumber(raw.page),
    total:
      total === undefined
        ? undefined
        : typeof total === 'number' &&
          Number.isSafeInteger(total) &&
          total >= 0 &&
          total <= MAX_SEARCH_TOTAL
        ? total
        : fail(),
    results: rows.map(searchTrack),
  };
}
export const bilibiliClient = {
  status: () => call('status').then(publicState),
  qrBegin: () => call('qrBegin').then(publicState),
  qrPoll: (attemptId: string) =>
    call('qrPoll', { attemptId: text(attemptId, 64) }).then(publicState),
  qrCancel: (attemptId: string) =>
    call('qrCancel', { attemptId: text(attemptId, 64) }).then(publicState),
  logout: () => call('logout').then(publicState),
  search: (
    query: string,
    page = 1,
    options?: { signal?: AbortSignal },
  ): Promise<BilibiliSearchPage> => {
    try {
      const normalized = searchQuery(query);
      const normalizedPage = searchPageNumber(page);
      if (options?.signal?.aborted)
        return Promise.reject(new BilibiliClientError('CANCELLED'));
      return call('search', { query: normalized, page: normalizedPage }).then(
        value => {
          if (options?.signal?.aborted) fail('CANCELLED');
          const result = searchResultPage(value);
          if (result.query !== normalized || result.page !== normalizedPage)
            fail('INVALID_RESPONSE');
          return result;
        },
      );
    } catch (error) {
      return Promise.reject(error);
    }
  },
  videoDetail: (id: string, _options?: { signal?: AbortSignal }) =>
    call('videoDetail', { bvid: bvid(id) }).then(detail),
  resolveAudio: (request: BilibiliAudioRequest): Promise<MediaDescriptor> => {
    const exact = { bvid: bvid(request.bvid), cid: numericText(request.cid) };
    const track = {
      id: `bitrack_v_${exact.bvid}-${exact.cid}`,
      source: 'bilibili' as const,
      title: 'Bilibili',
      artist: 'Bilibili',
    };
    return resolveNativeMedia(track);
  },
};

export { parseExactBilibiliTrackId };
