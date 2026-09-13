import type {
  ProviderOperation,
  ProviderRequestOptions,
  SourceId,
} from '../types';
import { ProviderClientError } from './errors';

const MAX_RESPONSE_BYTES = 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;
const BILIBILI_SEARCH_MAX_ATTEMPTS = 2;

function utf8ByteLength(value: string): number {
  // Works in JavaScriptCore/Hermes without assuming TextEncoder typings.
  return encodeURIComponent(value).replace(/%[0-9a-f]{2}/gi, 'x').length;
}

export interface FixedRequest {
  readonly url: string;
  readonly method?: 'GET' | 'POST';
  readonly body?: string;
  /** Selects headers owned by this module; callers can never supply values. */
  readonly profile?: 'bilibili' | 'qq';
}

const BILIBILI_HEADERS = Object.freeze({
  Referer: 'https://www.bilibili.com/',
  'User-Agent':
    'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/124 Mobile Safari/537.36',
});

// QQ's public lyric route rejects requests without its first-party origin.
// This is an adapter-owned constant, never a header accepted from UI code.
const QQ_HEADERS = Object.freeze({
  Referer: 'https://y.qq.com/',
});

function providerErrorForStatus(
  status: number,
  source: SourceId,
  operation: ProviderOperation,
): ProviderClientError {
  const code =
    status === 401
      ? 'LOGIN_REQUIRED'
      : status === 402
      ? 'MEMBERSHIP_REQUIRED'
      : status === 403
      ? 'DRM_RESTRICTED'
      : status === 451
      ? 'REGION_RESTRICTED'
      : 'PROVIDER_ERROR';
  return new ProviderClientError(code, source, operation, {
    retryable: status === 412 || status === 429 || status >= 500,
  });
}

function maxAttemptsFor(
  source: SourceId,
  operation: ProviderOperation,
): number {
  return source === 'bilibili' && operation === 'search'
    ? BILIBILI_SEARCH_MAX_ATTEMPTS
    : 1;
}

/**
 * Fetches only a provider adapter's already-built fixed endpoint. The public
 * client never accepts a URL, headers, credentials, or an arbitrary body.
 */
export async function requestJson(
  request: FixedRequest,
  source: SourceId,
  operation: ProviderOperation,
  options: ProviderRequestOptions = {},
): Promise<unknown> {
  const timeoutMs = Math.min(
    Math.max(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 1),
    DEFAULT_TIMEOUT_MS,
  );
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const cancel = () => controller.abort();
  options.signal?.addEventListener('abort', cancel, { once: true });

  try {
    const maxAttempts = maxAttemptsFor(source, operation);
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        const response = await fetch(request.url, {
          method: request.method ?? 'GET',
          body: request.body,
          headers: {
            ...(request.profile === 'bilibili' ? BILIBILI_HEADERS : {}),
            ...(request.profile === 'qq' ? QQ_HEADERS : {}),
            ...(request.body ? { 'content-type': 'application/json' } : {}),
          },
          signal: controller.signal,
        });
        if (!response.ok) {
          throw providerErrorForStatus(response.status, source, operation);
        }
        const declaredLength = Number(
          response.headers.get('content-length') ?? 0,
        );
        if (
          Number.isFinite(declaredLength) &&
          declaredLength > MAX_RESPONSE_BYTES
        ) {
          throw new ProviderClientError('INVALID_RESPONSE', source, operation);
        }
        const text = await response.text();
        if (utf8ByteLength(text) > MAX_RESPONSE_BYTES) {
          throw new ProviderClientError('INVALID_RESPONSE', source, operation);
        }
        try {
          return JSON.parse(text) as unknown;
        } catch {
          throw new ProviderClientError('INVALID_RESPONSE', source, operation);
        }
      } catch (error) {
        if (
          !(error instanceof ProviderClientError) ||
          !error.retryable ||
          attempt + 1 === maxAttempts
        ) {
          throw error;
        }
      }
    }
    throw new ProviderClientError('PROVIDER_ERROR', source, operation);
  } catch (error) {
    if (error instanceof ProviderClientError) throw error;
    if (timedOut)
      throw new ProviderClientError('REQUEST_TIMEOUT', source, operation, {
        retryable: true,
      });
    if (options.signal?.aborted)
      throw new ProviderClientError('CANCELLED', source, operation, {
        retryable: false,
      });
    throw new ProviderClientError('NETWORK_ERROR', source, operation, {
      retryable: true,
    });
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', cancel);
  }
}

/**
 * Confirms a provider-minted media route without accepting caller headers or
 * exposing its final redirected location. The player receives the original
 * fixed route, so signed CDN locations never become persisted app state.
 */
export async function requestMediaAvailability(
  url: string,
  source: SourceId,
  operation: ProviderOperation,
  options: ProviderRequestOptions = {},
): Promise<void> {
  const timeoutMs = Math.min(
    Math.max(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 1),
    DEFAULT_TIMEOUT_MS,
  );
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const cancel = () => controller.abort();
  options.signal?.addEventListener('abort', cancel, { once: true });

  try {
    const response = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
    });
    if (!response.ok)
      throw providerErrorForStatus(response.status, source, operation);
  } catch (error) {
    if (error instanceof ProviderClientError) throw error;
    if (timedOut)
      throw new ProviderClientError('REQUEST_TIMEOUT', source, operation, {
        retryable: true,
      });
    if (options.signal?.aborted)
      throw new ProviderClientError('CANCELLED', source, operation, {
        retryable: false,
      });
    throw new ProviderClientError('NETWORK_ERROR', source, operation, {
      retryable: true,
    });
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', cancel);
  }
}
