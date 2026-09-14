import { NativeModules } from 'react-native';
import { hasCompleteDeepSeekConsent } from './consent';
import type {
  DeepSeekConfigureStatus,
  DeepSeekErrorCode,
  DeepSeekStatus,
  DeepSeekTranslateRequest,
  DeepSeekTranslateResult,
  DeepSeekTestResult,
} from './types';

const MAX_LYRIC_BYTES = 64 * 1024;
const MAX_TIMED_LINES = 400;
const MAX_LINE_CHARS = 500;
const MAX_METADATA_CHARS = 256;
const MAX_STYLE_CHARS = 1200;
const HASH = /^[a-f0-9]{64}$/;
const OPERATION_ID = /^[A-Za-z0-9_-]{1,64}$/;
const SOURCE_TRACK_ID = /^[A-Za-z0-9_-]{1,128}$/;
const TIMED_LINE = /^(?:\[[0-9]{1,3}:[0-5][0-9](?:\.[0-9]{1,3})?\])+/;
const REQUEST_KEYS = new Set([
  'operationId',
  'provider',
  'sourceTrackId',
  'lyric',
  'title',
  'artist',
  'style',
  'lyricHash',
  'trackHash',
  'target',
  'consent',
  'allowNetwork',
  'forceRefresh',
]);
const RESULT_KEYS = new Set([
  'operation',
  'status',
  'errorCode',
  'translation',
  'lyricHash',
  'trackHash',
  'cacheHit',
]);
const STATUS_KEYS = new Set([
  'secureStorageAvailable',
  'hasApiKey',
  'errorCode',
]);

type NativeDeepSeek = {
  status(): Promise<unknown>;
  configure(): Promise<unknown>;
  test(): Promise<unknown>;
  delete(): Promise<unknown>;
  translate(request: DeepSeekTranslateRequest): Promise<unknown>;
  cancel(request: { operationId: string }): Promise<unknown>;
};

export class DeepSeekClientError extends Error {
  constructor(readonly code: DeepSeekErrorCode | 'NATIVE_UNAVAILABLE') {
    super(code);
  }
}

function nativeModule(): NativeDeepSeek {
  const candidate = NativeModules.Listen2DeepSeek as NativeDeepSeek | undefined;
  if (!candidate) throw new DeepSeekClientError('NATIVE_UNAVAILABLE');
  return candidate;
}

export const deepSeekClient = {
  async status(): Promise<DeepSeekStatus> {
    return parseStatus(await nativeModule().status());
  },
  async configure(): Promise<DeepSeekConfigureStatus> {
    const value = ensureRecord(
      await nativeModule().configure(),
      new Set(['status', 'secureStorageAvailable', 'hasApiKey', 'errorCode']),
    );
    if (value.status !== 'configured' && value.status !== 'cancelled')
      fail('INVALID_RESPONSE');
    const safeStatus = { ...value };
    delete safeStatus.status;
    return { ...parseStatus(safeStatus), status: value.status };
  },
  async test(): Promise<DeepSeekTestResult> {
    return parseTestResult(await nativeModule().test());
  },
  async delete(): Promise<DeepSeekStatus> {
    return parseStatus(await nativeModule().delete());
  },
  async cancel(operationId: string): Promise<DeepSeekTranslateResult> {
    if (!OPERATION_ID.test(operationId)) fail('INVALID_REQUEST');
    return parseResult(await nativeModule().cancel({ operationId }));
  },
  async translate(request: unknown): Promise<DeepSeekTranslateResult> {
    const checked = validateRequest(request);
    return parseResult(await nativeModule().translate(checked));
  },
};

export function hashLyric(lyric: string): string {
  return sha256(normalizeLyric(lyric));
}

export function hashTrack(
  provider: string,
  sourceTrackId: string,
  lyricHash: string,
): string {
  return sha256(`${provider}\n${sourceTrackId}\n${lyricHash}`);
}

function validateRequest(value: unknown): DeepSeekTranslateRequest {
  const request = ensureRecord(value, REQUEST_KEYS, 'INVALID_REQUEST');
  if (
    (request.provider !== 'netease' && request.provider !== 'qq') ||
    request.target !== 'zh-CN' ||
    typeof request.operationId !== 'string' ||
    !OPERATION_ID.test(request.operationId) ||
    typeof request.sourceTrackId !== 'string' ||
    !SOURCE_TRACK_ID.test(request.sourceTrackId) ||
    typeof request.lyric !== 'string' ||
    typeof request.title !== 'string' ||
    typeof request.artist !== 'string' ||
    typeof request.style !== 'string' ||
    typeof request.lyricHash !== 'string' ||
    typeof request.trackHash !== 'string' ||
    typeof request.allowNetwork !== 'boolean' ||
    typeof request.forceRefresh !== 'boolean'
  )
    fail('INVALID_REQUEST');
  const lyric = normalizeLyric(request.lyric);
  if (
    byteLength(lyric) > MAX_LYRIC_BYTES ||
    request.title.length > MAX_METADATA_CHARS ||
    request.artist.length > MAX_METADATA_CHARS ||
    request.style.length > MAX_STYLE_CHARS ||
    containsControl(request.title) ||
    containsControl(request.artist) ||
    containsControl(request.style)
  )
    fail('INVALID_REQUEST');
  const lines = lyric.split('\n').filter(line => TIMED_LINE.test(line));
  if (!lines.length) fail('NO_TIMED_LINES');
  if (lines.length > MAX_TIMED_LINES) fail('TOO_MANY_TIMED_LINES');
  if (lines.some(line => line.length > MAX_LINE_CHARS || containsControl(line)))
    fail('INVALID_REQUEST');
  if (!HASH.test(request.lyricHash) || !HASH.test(request.trackHash))
    fail('INVALID_REQUEST');
  if (
    hashLyric(lyric) !== request.lyricHash ||
    hashTrack(request.provider, request.sourceTrackId, request.lyricHash) !==
      request.trackHash
  )
    fail('STALE_IDENTITY');
  if (request.forceRefresh && !request.allowNetwork) fail('INVALID_REQUEST');
  if (request.allowNetwork && !hasCompleteDeepSeekConsent(request.consent))
    fail('CONSENT_REQUIRED');
  return { ...request, lyric } as DeepSeekTranslateRequest;
}

function parseStatus(value: unknown): DeepSeekStatus {
  const status = ensureRecord(value, STATUS_KEYS);
  if (
    typeof status.secureStorageAvailable !== 'boolean' ||
    typeof status.hasApiKey !== 'boolean'
  )
    fail('INVALID_RESPONSE');
  return {
    secureStorageAvailable: status.secureStorageAvailable,
    hasApiKey: status.hasApiKey,
    ...(error(status.errorCode) ? { errorCode: status.errorCode } : {}),
  };
}

function parseResult(value: unknown): DeepSeekTranslateResult {
  const result = ensureRecord(value, RESULT_KEYS);
  if (
    result.operation !== 'translate' ||
    !['ok', 'not-cached', 'error', 'cancelled'].includes(
      result.status as string,
    ) ||
    typeof result.cacheHit !== 'boolean'
  )
    fail('INVALID_RESPONSE');
  if (
    result.status === 'ok' &&
    (typeof result.translation !== 'string' ||
      typeof result.trackHash !== 'string' ||
      typeof result.lyricHash !== 'string' ||
      !HASH.test(result.trackHash) ||
      !HASH.test(result.lyricHash))
  )
    fail('INVALID_RESPONSE');
  if (
    typeof result.translation === 'string' &&
    (result.translation.length > 128 * 1024 ||
      containsControl(result.translation.replace(/\n/g, '')))
  )
    fail('INVALID_RESPONSE');
  return {
    status: result.status as DeepSeekTranslateResult['status'],
    cacheHit: result.cacheHit,
    ...(typeof result.translation === 'string'
      ? { translation: result.translation }
      : {}),
    ...(typeof result.trackHash === 'string'
      ? { trackHash: result.trackHash }
      : {}),
    ...(typeof result.lyricHash === 'string'
      ? { lyricHash: result.lyricHash }
      : {}),
    ...(error(result.errorCode) ? { errorCode: result.errorCode } : {}),
  };
}

function parseTestResult(value: unknown): DeepSeekTestResult {
  const result = ensureRecord(
    value,
    new Set(['operation', 'status', 'errorCode', 'cacheHit']),
  );
  if (
    result.operation !== 'test' ||
    !['ok', 'error', 'cancelled'].includes(result.status as string) ||
    typeof result.cacheHit !== 'boolean'
  )
    fail('INVALID_RESPONSE');
  return {
    status: result.status as DeepSeekTestResult['status'],
    ...(error(result.errorCode) ? { errorCode: result.errorCode } : {}),
  };
}

function error(value: unknown): value is DeepSeekErrorCode {
  return typeof value === 'string' && /^[A-Z_]+$/.test(value);
}
function ensureRecord(
  value: unknown,
  keys: Set<string>,
  errorCode: DeepSeekErrorCode = 'INVALID_RESPONSE',
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    fail(errorCode);
  const object = value as Record<string, unknown>;
  if (!Object.keys(object).every(key => keys.has(key))) fail(errorCode);
  return object;
}
function fail(code: DeepSeekErrorCode): never {
  throw new DeepSeekClientError(code);
}
function normalizeLyric(value: string): string {
  return value.normalize('NFC').replace(/\r\n/g, '\n').trim();
}
function containsControl(value: string): boolean {
  // eslint-disable-next-line no-control-regex -- explicit transport-boundary rejection.
  return /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value);
}
function byteLength(value: string): number {
  return utf8Bytes(value).length;
}

/* eslint-disable no-bitwise -- SHA-256 intentionally operates on 32-bit words. */
function sha256(value: string): string {
  const bytes = utf8Bytes(value);
  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while ((bytes.length + 8) % 64) bytes.push(0);
  for (let index = 7; index >= 0; index -= 1)
    bytes.push((bitLength / 2 ** (index * 8)) & 0xff);
  let [a, b, c, d, e, f, g, h] = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ];
  const constants = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
    0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const rotate = (word: number, bits: number) =>
    (word >>> bits) | (word << (32 - bits));
  for (let offset = 0; offset < bytes.length; offset += 64) {
    const words: number[] = Array<number>(64).fill(0);
    for (let index = 0; index < 16; index += 1)
      words[index] =
        (bytes[offset + index * 4] << 24) |
        (bytes[offset + index * 4 + 1] << 16) |
        (bytes[offset + index * 4 + 2] << 8) |
        bytes[offset + index * 4 + 3];
    for (let index = 16; index < 64; index += 1) {
      const s0 =
        rotate(words[index - 15], 7) ^
        rotate(words[index - 15], 18) ^
        (words[index - 15] >>> 3);
      const s1 =
        rotate(words[index - 2], 17) ^
        rotate(words[index - 2], 19) ^
        (words[index - 2] >>> 10);
      words[index] = (words[index - 16] + s0 + words[index - 7] + s1) | 0;
    }
    let [aa, bb, cc, dd, ee, ff, gg, hh] = [a, b, c, d, e, f, g, h];
    for (let index = 0; index < 64; index += 1) {
      const s1 = rotate(ee, 6) ^ rotate(ee, 11) ^ rotate(ee, 25);
      const choice = (ee & ff) ^ (~ee & gg);
      const temporary1 =
        (hh + s1 + choice + constants[index] + words[index]) | 0;
      const s0 = rotate(aa, 2) ^ rotate(aa, 13) ^ rotate(aa, 22);
      const majority = (aa & bb) ^ (aa & cc) ^ (bb & cc);
      const temporary2 = (s0 + majority) | 0;
      hh = gg;
      gg = ff;
      ff = ee;
      ee = (dd + temporary1) | 0;
      dd = cc;
      cc = bb;
      bb = aa;
      aa = (temporary1 + temporary2) | 0;
    }
    a = (a + aa) | 0;
    b = (b + bb) | 0;
    c = (c + cc) | 0;
    d = (d + dd) | 0;
    e = (e + ee) | 0;
    f = (f + ff) | 0;
    g = (g + gg) | 0;
    h = (h + hh) | 0;
  }
  return [a, b, c, d, e, f, g, h]
    .map(word => (word >>> 0).toString(16).padStart(8, '0'))
    .join('');
}

function utf8Bytes(value: string): number[] {
  const bytes: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    let code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const low = value.charCodeAt(index + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
        index += 1;
      }
    }
    if (code <= 0x7f) bytes.push(code);
    else if (code <= 0x7ff)
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else if (code <= 0xffff)
      bytes.push(
        0xe0 | (code >> 12),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    else
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
  }
  return bytes;
}
/* eslint-enable no-bitwise */
