import { NativeModules } from 'react-native';
import type {
  BilibiliAudioHandoff,
  BilibiliAudioRequest,
  BilibiliPart,
  BilibiliPublicState,
  BilibiliPublicStatus,
  BilibiliVideoDetail,
} from './types';

const MAX_TEXT = 256;
const MAX_QR_DATA_URI = 192 * 1024;
const MAX_MEDIA_URL = 4096;
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
const keys = (value: Record<string, unknown>, allowed: readonly string[]) => {
  if (Object.keys(value).some(key => !allowed.includes(key))) fail();
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
function handoff(
  value: unknown,
  requested: BilibiliAudioRequest,
): BilibiliAudioHandoff {
  const raw = object(value);
  keys(raw, ['bvid', 'cid', 'page', 'url', 'deadline', 'headers']);
  if (
    bvid(raw.bvid) !== requested.bvid ||
    numericText(raw.cid) !== requested.cid ||
    numericText(raw.page) !== requested.page
  )
    fail();
  const url = text(raw.url, MAX_MEDIA_URL);
  const deadline = raw.deadline;
  if (
    typeof deadline !== 'number' ||
    !Number.isSafeInteger(deadline) ||
    deadline - Date.now() <= 30_000 ||
    deadline - Date.now() > 24 * 60 * 60 * 1000
  )
    fail();
  try {
    const parsed = new URL(url);
    if (
      parsed.protocol !== 'https:' ||
      (!parsed.hostname.endsWith('.bilivideo.com') &&
        parsed.hostname !== 'bilivideo.com') ||
      parsed.username ||
      parsed.password ||
      parsed.hash
    )
      fail();
  } catch {
    fail();
  }
  const headers = object(raw.headers);
  keys(headers, ['Referer']);
  if (headers.Referer !== 'https://www.bilibili.com/') fail();
  return {
    ...requested,
    url,
    deadline: deadline as number,
    headers: { Referer: 'https://www.bilibili.com/' },
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
  videoDetail: (id: string, _options?: { signal?: AbortSignal }) =>
    call('videoDetail', { bvid: bvid(id) }).then(detail),
  resolveAudio: (request: BilibiliAudioRequest) => {
    const exact = {
      bvid: bvid(request.bvid),
      cid: numericText(request.cid),
      page: numericText(request.page),
    };
    return call('resolveAudio', exact).then(value => handoff(value, exact));
  },
};
