import { NativeModules } from 'react-native';
import type {
  BilibiliMvPublicState,
  BilibiliMvQualityId,
  BilibiliMvRequest,
  BilibiliMvVariant,
} from './types';

const native = NativeModules.Listen2Bilibili as
  | Record<string, unknown>
  | undefined;
const qualities = new Set<BilibiliMvQualityId>([
  'auto',
  '16',
  '32',
  '64',
  '74',
  '80',
  '112',
  '116',
  '120',
  '125',
  '126',
  '127',
]);
const codecs = new Set(['avc1', 'hev1', 'hvc1', 'av01']);
const states = new Set<BilibiliMvPublicState['state']>([
  'idle',
  'resolving',
  'ready',
  'playing',
  'paused',
  'refreshing',
  'error',
  'closed',
]);
let activeHandle: string | null = null;

export class BilibiliMvClientError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'BilibiliMvClientError';
  }
}

const fail = (code = 'INVALID_RESPONSE'): never => {
  throw new BilibiliMvClientError(code);
};
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : fail();
const exactKeys = (
  value: Record<string, unknown>,
  allowed: readonly string[],
) => {
  if (Object.keys(value).some(key => !allowed.includes(key))) fail();
};
const text = (value: unknown, limit: number): string =>
  typeof value === 'string' &&
  value.trim() &&
  value.length <= limit &&
  !/[\u0000-\u001f]/.test(value)
    ? value.trim()
    : fail();
const bvid = (value: unknown) =>
  /^BV[0-9A-Za-z]{6,32}$/.test(text(value, 40))
    ? text(value, 40)
    : fail('INVALID_REQUEST');
const cid = (value: unknown) =>
  typeof value === 'string' &&
  /^[1-9][0-9]{0,17}$/.test(value) &&
  Number.isSafeInteger(Number(value))
    ? value
    : fail('INVALID_REQUEST');
const handle = (value: unknown) =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{16,96}$/.test(value)
    ? value
    : fail('INVALID_RESPONSE');
const quality = (value: unknown): BilibiliMvQualityId =>
  typeof value === 'string' && qualities.has(value as BilibiliMvQualityId)
    ? (value as BilibiliMvQualityId)
    : fail('INVALID_REQUEST');
const number = (value: unknown, max: number) =>
  typeof value === 'number' &&
  Number.isSafeInteger(value) &&
  value >= 0 &&
  value <= max
    ? value
    : fail();
function call(method: string, arg: Record<string, unknown>): Promise<unknown> {
  const fn = native?.[method];
  if (typeof fn !== 'function')
    return Promise.reject(new BilibiliMvClientError('UNAVAILABLE'));
  return (fn as (request: Record<string, unknown>) => Promise<unknown>)(arg);
}
function nativeError(raw: Record<string, unknown>): void {
  if (
    Object.keys(raw).length === 1 &&
    typeof raw.errorCode === 'string' &&
    /^[A-Z_]{3,64}$/.test(raw.errorCode)
  )
    fail(raw.errorCode);
}
function variant(value: unknown): BilibiliMvVariant {
  const raw = object(value);
  exactKeys(raw, ['id', 'label', 'codec', 'width', 'height']);
  const id = quality(raw.id);
  if (id === 'auto') fail();
  const codec = text(raw.codec, 8);
  if (!codecs.has(codec)) fail();
  return {
    id: id as BilibiliMvVariant['id'],
    label: text(raw.label, 80),
    codec: codec as BilibiliMvVariant['codec'],
    width: number(raw.width, 7680),
    height: number(raw.height, 7680),
  };
}
function state(value: unknown): BilibiliMvPublicState {
  const raw = object(value);
  nativeError(raw);
  exactKeys(raw, [
    'state',
    'handle',
    'bvid',
    'cid',
    'qualityId',
    'variants',
    'positionMs',
    'playIntent',
    'refreshing',
    'errorCode',
  ]);
  const current = text(raw.state, 16) as BilibiliMvPublicState['state'];
  const variants = raw.variants;
  const playIntent = raw.playIntent;
  const refreshing = raw.refreshing;
  if (!states.has(current)) fail();
  const safeVariants =
    Array.isArray(variants) && variants.length <= 4 ? variants : fail();
  const safePlayIntent = typeof playIntent === 'boolean' ? playIntent : fail();
  const safeRefreshing = typeof refreshing === 'boolean' ? refreshing : fail();
  const errorCode = raw.errorCode;
  const safeErrorCode =
    errorCode === undefined
      ? undefined
      : typeof errorCode === 'string' && /^[A-Z_]{3,64}$/.test(errorCode)
      ? errorCode
      : fail();
  const result: {
    state: BilibiliMvPublicState['state'];
    handle?: string;
    bvid?: string;
    cid?: string;
    qualityId: BilibiliMvQualityId;
    variants: readonly BilibiliMvVariant[];
    positionMs: number;
    playIntent: boolean;
    refreshing: boolean;
    errorCode?: string;
  } = {
    state: current,
    qualityId: quality(raw.qualityId),
    variants: safeVariants.map(variant),
    positionMs: number(raw.positionMs, 24 * 60 * 60 * 1000),
    playIntent: safePlayIntent,
    refreshing: safeRefreshing,
    ...(safeErrorCode === undefined ? {} : { errorCode: safeErrorCode }),
  };
  if (raw.handle !== undefined) result.handle = handle(raw.handle);
  if (raw.bvid !== undefined) result.bvid = bvid(raw.bvid);
  if (raw.cid !== undefined) result.cid = cid(raw.cid);
  if (result.handle && (!result.bvid || !result.cid)) fail();
  return result;
}
function request(value: BilibiliMvRequest): Record<string, unknown> {
  const preferredCodecs = value.preferredCodecs ?? [];
  if (
    preferredCodecs.length > 4 ||
    new Set(preferredCodecs).size !== preferredCodecs.length ||
    preferredCodecs.some(codec => !codecs.has(codec))
  )
    fail('INVALID_REQUEST');
  return {
    bvid: bvid(value.bvid),
    cid: cid(value.cid),
    qualityId: quality(value.qualityId ?? 'auto'),
    preferredCodecs: [...preferredCodecs],
    forceRefresh: Boolean(value.forceRefresh),
  };
}
function successfulState(value: unknown): BilibiliMvPublicState {
  const result = state(value);
  if (result.state === 'error' || result.errorCode)
    fail(result.errorCode || 'VIDEO_UNAVAILABLE');
  return result;
}

export const bilibiliMvClient = {
  restore: (bvidValue: string, cidValue: string) =>
    call('mvRestore', { bvid: bvid(bvidValue), cid: cid(cidValue) }).then(
      reply => {
        const result = successfulState(reply);
        activeHandle = result.handle || null;
        return result;
      },
    ),
  open: (value: BilibiliMvRequest) =>
    call('mvOpen', request(value)).then(reply => {
      const result = successfulState(reply);
      activeHandle = result.handle ?? null;
      return result;
    }),
  selectQuality: (opaqueHandle: string, qualityId: BilibiliMvQualityId) =>
    call('mvSelectQuality', {
      handle: handle(opaqueHandle),
      qualityId: quality(qualityId),
    }).then(reply => {
      const result = successfulState(reply);
      activeHandle = result.handle || null;
      return result;
    }),
  sync: (opaqueHandle: string, positionMs: number, playIntent: boolean) =>
    call('mvSync', {
      handle: handle(opaqueHandle),
      positionMs: number(positionMs, 24 * 60 * 60 * 1000),
      playIntent: Boolean(playIntent),
    }).then(successfulState),
  refresh: (opaqueHandle: string) =>
    call('mvRefresh', { handle: handle(opaqueHandle) }).then(successfulState),
  close: (opaqueHandle: string) =>
    call('mvClose', { handle: handle(opaqueHandle) }).then(value => {
      const result = successfulState(value);
      if (activeHandle === opaqueHandle) activeHandle = null;
      return result;
    }),
  syncActive: (positionMs: number, playIntent: boolean) =>
    activeHandle
      ? call('mvSync', {
          handle: activeHandle,
          positionMs: number(positionMs, 24 * 60 * 60 * 1000),
          playIntent: Boolean(playIntent),
        }).then(successfulState)
      : Promise.resolve(null),
  enterFullscreen: (opaqueHandle: string) =>
    call('mvEnterFullscreen', { handle: handle(opaqueHandle) }).then(value =>
      booleanReply(value),
    ),
  exitFullscreen: (opaqueHandle: string) =>
    call('mvExitFullscreen', { handle: handle(opaqueHandle) }).then(value =>
      booleanReply(value),
    ),
  requestPip: (opaqueHandle: string) =>
    call('mvRequestPip', { handle: handle(opaqueHandle) }).then(value =>
      booleanReply(value),
    ),
};

function booleanReply(value: unknown): boolean {
  const raw = object(value);
  nativeError(raw);
  exactKeys(raw, ['ok']);
  return raw.ok === true ? true : fail();
}
