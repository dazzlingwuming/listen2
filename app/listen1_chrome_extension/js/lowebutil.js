/* eslint-disable consistent-return */
/* eslint-disable no-param-reassign */
/* eslint-disable no-unused-vars */

function getParameterByName(name, url) {
  if (!url) url = window.location.href;
  name = name.replace(/[[\]]/g, '\\$&');
  const regex = new RegExp(`[?&]${name}(=([^&#]*)|&|#|$)`);

  const results = regex.exec(url);
  if (!results) return null;
  if (!results[2]) return '';
  return decodeURIComponent(results[2].replace(/\+/g, ' '));
}

function isElectron() {
  return window && window.process && window.process.type;
}

function getExtensionCookieApi() {
  if (typeof chrome !== 'undefined' && chrome.cookies) {
    return chrome.cookies;
  }
  if (typeof browser !== 'undefined' && browser.cookies) {
    return browser.cookies;
  }
  return null;
}

function cookieGet(cookieRequest, callback) {
  if (!isElectron()) {
    const cookieApi = getExtensionCookieApi();
    if (!cookieApi) {
      return callback(null);
    }
    return cookieApi.get(cookieRequest, (cookie) => {
      callback(cookie);
    });
  }
  const remote = require('@electron/remote'); // eslint-disable-line
  remote.session.defaultSession.cookies
    .get(cookieRequest)
    .then((cookieArray) => {
      let cookie = null;
      if (cookieArray.length > 0) {
        [cookie] = cookieArray;
      }
      callback(cookie);
    });
}

function cookieSet(cookie, callback) {
  if (!isElectron()) {
    const cookieApi = getExtensionCookieApi();
    if (!cookieApi) {
      return callback(null, null);
    }
    return cookieApi.set(cookie, (arg1, arg2) => {
      callback(arg1, arg2);
    });
  }
  const remote = require('@electron/remote'); // eslint-disable-line
  remote.session.defaultSession.cookies.set(cookie).then((arg1, arg2) => {
    callback(null, arg1, arg2);
  });
}
function cookieRemove(cookie, callback) {
  if (!isElectron()) {
    const cookieApi = getExtensionCookieApi();
    if (!cookieApi) {
      return callback(null, null);
    }
    return cookieApi.remove(cookie, (arg1, arg2) => {
      callback(arg1, arg2);
    });
  }
  const remote = require('@electron/remote'); // eslint-disable-line
  remote.session.defaultSession.cookies
    .remove(cookie.url, cookie.name)
    .then((arg1, arg2) => {
      callback(null, arg1, arg2);
    });
}

function setPrototypeOfLocalStorage() {
  const proto = Object.getPrototypeOf(localStorage);
  proto.getObject = function getObject(key) {
    const value = this.getItem(key);
    try {
      return value && JSON.parse(value);
    } catch (error) {
      return {};
    }
  };
  proto.setObject = function setObject(key, value) {
    this.setItem(key, JSON.stringify(value));
  };
  Object.setPrototypeOf(localStorage, proto);
}

function getLocalStorageValue(key, defaultValue) {
  const keyString = localStorage.getItem(key);
  let result = keyString && JSON.parse(keyString);
  if (result === null) {
    result = defaultValue;
  }
  return result;
}

function easeInOutQuad(t, b, c, d) {
  // t = current time
  // b = start value
  // c = change in value
  // d = duration
  t /= d / 2;
  if (t < 1) return (c / 2) * t * t + b;
  t -= 1;
  return (-c / 2) * (t * (t - 2) - 1) + b;
}

function smoothScrollTo(element, to, duration) {
  const start = element.scrollTop;
  const change = to - start;
  const startTime = performance.now();

  const animateScroll = (currentTime) => {
    const timeElapsed = currentTime - startTime;
    const val = easeInOutQuad(timeElapsed, start, change, duration);
    element.scrollTop = val;
    if (timeElapsed < duration) {
      requestAnimationFrame(animateScroll);
    } else {
      element.scrollTop = to; // Ensure it ends exactly at 'to'
    }
  };
  requestAnimationFrame(animateScroll);
}

// Android's WebMessageListener injects this one object into the page. Keep the
// adapter deliberately narrow: it is not a replacement for axios and only
// accepts the versioned GET envelope implemented by the Android shell.
const Listen2AndroidHttpAdapter = (() => {
  const PROTOCOL_VERSION = 1;
  const TYPED_PROTOCOL_VERSION = 2;
  const DEFAULT_TIMEOUT_MS = 12000;
  const MAX_TIMEOUT_MS = 30000;
  const MAX_URL_LENGTH = 4096;
  // A JSON envelope may escape every body character, so it needs room beyond
  // the native 2 MiB response-body cap while retaining that cap after parse.
  const MAX_RESPONSE_MESSAGE_LENGTH = 4 * 1024 * 1024 + 4096;
  const MAX_RESPONSE_BODY_LENGTH = 2 * 1024 * 1024;
  const MAX_ERROR_LENGTH = 1024;
  const MAX_TYPED_KEYWORD_BYTES = 256;
  const MAX_DEEPSEEK_LYRIC_BYTES = 64 * 1024;
  const MAX_DEEPSEEK_METADATA_BYTES = 256;
  const MAX_DEEPSEEK_STYLE_BYTES = 1200;
  const MAX_DEEPSEEK_KEY_BYTES = 512;
  const MAX_PERSISTENT_LYRIC_BYTES = 256 * 1024;
  const MAX_LYRIC_OFFSET_MS = 30000;
  const MAX_PAGE_EPOCH = 2147483647;
  const MAX_PLAYBACK_TEXT_LENGTH = 256;
  const MAX_PLAYBACK_DURATION_MS = 28800000;
  const MAX_MEDIA_DOWNLOAD_OPERATION_ID_LENGTH = 96;
  const PLAYBACK_SNAPSHOT_VERSION = 1;
  const PROVIDER_CAPABILITY_VERSION = 1;
  const PROVIDER_CAPABILITY_FIELDS = [
    'search',
    'directory',
    'detail',
    'media',
    'lyric',
    'manualLyric',
    'fallback',
    'login',
    'permission',
  ];
  const ACCOUNT_STATUSES = new Set([
    'idle',
    'waiting',
    'scanned',
    'authenticated',
    'expired',
    'cancelled',
    'error',
    'unavailable',
  ]);
  const MAX_ACCOUNT_QR_URL_LENGTH = 2048;
  const pending = new Map();
  let requestSequence = 0;
  let responseBridge = null;
  let verifiedProviderCapabilities = null;
  let providerCapabilityRefresh = null;
  const providerCapabilityListeners = new Set();
  const playback = {
    pageEpoch: null,
    revision: 0,
    snapshot: null,
    onSnapshot: null,
    detached: true,
    pendingCommands: new Map(),
    issuedPrepared: new WeakSet(),
  };

  function createError(code, message, details = {}) {
    const error = new Error(message);
    error.code = code;
    Object.assign(error, details);
    return error;
  }

  function getBridge() {
    if (typeof window === 'undefined') return null;
    const bridge = window.Listen2AndroidHttp;
    return bridge && typeof bridge.postMessage === 'function' ? bridge : null;
  }

  function supportsResponseEvents(bridge) {
    return Boolean(
      bridge &&
        (typeof bridge.addEventListener === 'function' || 'onmessage' in bridge)
    );
  }

  function normalizeEventData(event) {
    if (!event || typeof event.data !== 'string') return null;
    if (event.data.length > MAX_RESPONSE_MESSAGE_LENGTH) return null;
    try {
      return JSON.parse(event.data);
    } catch (error) {
      return null;
    }
  }

  function isValidLegacyResponse(response) {
    return Boolean(
      response &&
        typeof response === 'object' &&
        !Array.isArray(response) &&
        response.version === PROTOCOL_VERSION &&
        typeof response.requestId === 'string' &&
        response.requestId.length > 0 &&
        response.requestId.length <= 128 &&
        typeof response.ok === 'boolean' &&
        Number.isInteger(response.status) &&
        response.status >= 0 &&
        response.status <= 599 &&
        typeof response.body === 'string' &&
        response.body.length <= MAX_RESPONSE_BODY_LENGTH &&
        (response.error === undefined ||
          (typeof response.error === 'string' &&
            response.error.length <= MAX_ERROR_LENGTH))
    );
  }

  function isValidTypedResponse(response) {
    if (
      !response ||
      typeof response !== 'object' ||
      Array.isArray(response) ||
      response.version !== TYPED_PROTOCOL_VERSION ||
      typeof response.requestId !== 'string' ||
      response.requestId.length === 0 ||
      response.requestId.length > 128 ||
      !Number.isInteger(response.pageEpoch) ||
      response.pageEpoch < 0 ||
      response.pageEpoch > MAX_PAGE_EPOCH ||
      !['ok', 'cancelled', 'error'].includes(response.terminal) ||
      !Number.isInteger(response.status) ||
      response.status < 0 ||
      response.status > 599
    ) {
      return false;
    }
    if (response.terminal === 'ok') {
      return (
        response.error === undefined &&
        response.result &&
        typeof response.result === 'object' &&
        !Array.isArray(response.result)
      );
    }
    return (
      typeof response.error === 'string' &&
      response.error.length > 0 &&
      response.error.length <= MAX_ERROR_LENGTH
    );
  }

  function mapTypedError(response, fallbackCode) {
    const safeCode = String((response && response.error) || '')
      .trim()
      .toUpperCase();
    const providerRejectedHttp =
      safeCode === 'HTTP_STATUS' &&
      Number.isInteger(Number(response && response.status)) &&
      Number(response.status) >= 400 &&
      Number(response.status) < 500;
    const codeByNativeCode = {
      CANCELLED: 'android-rpc-cancelled',
      TIMEOUT: 'android-rpc-timeout',
      NETWORK_TIMEOUT: 'android-rpc-timeout',
      TIMEOUT_ERROR: 'android-rpc-timeout',
      NETWORK_IO_ERROR: 'android-rpc-network',
      TLS_ERROR: 'android-rpc-tls',
      PERMISSION_DENIED: 'android-rpc-permission',
      LOGIN_REQUIRED: 'android-rpc-permission',
      INVALID_PART: 'android-rpc-invalid-part',
      NO_STREAM: 'android-rpc-unavailable-stream',
      INVALID_STREAM: 'android-rpc-unavailable-stream',
      EXPIRED_STREAM: 'android-rpc-unavailable-stream',
      UNSUPPORTED_CODEC: 'android-rpc-unsupported-codec',
      MALFORMED_PROVIDER_RESPONSE: 'android-rpc-malformed-response',
      RESPONSE_TOO_LARGE: 'android-rpc-malformed-response',
      PROVIDER_STATUS: 'android-rpc-provider-status',
      NETEASE_ROUTE_UNAVAILABLE: 'android-rpc-unavailable-route',
      ROUTE_NOT_ALLOWED: 'android-rpc-unavailable-route',
      REDIRECT_NOT_ALLOWED: 'android-rpc-unavailable-route',
      LYRIC_PERSISTENCE_UNAVAILABLE:
        'android-rpc-lyric-persistence-unavailable',
      LOCAL_DATA_UNAVAILABLE: 'android-rpc-local-data-unavailable',
      UNSUPPORTED_LOCAL_ACTION: 'android-rpc-local-data-unavailable',
      LOCAL_DATA_CORRUPT: 'android-rpc-local-data-unavailable',
      PLATFORM_ACTION_UNAVAILABLE: 'android-rpc-local-data-unavailable',
      LOCAL_LYRIC_UNAVAILABLE: 'android-rpc-local-lyric-unavailable',
      MEDIA_DOWNLOAD_UNAVAILABLE: 'android-rpc-media-download-unavailable',
      MEDIA_DOWNLOAD_FAILED: 'android-rpc-media-download-unavailable',
      MEMBERSHIP_REQUIRED: 'android-rpc-permission',
      ENTITLEMENT_REQUIRED: 'android-rpc-permission',
      DRM_RESTRICTED: 'android-rpc-permission',
      REGION_RESTRICTED: 'android-rpc-permission',
      RATE_LIMIT: 'android-rpc-provider-status',
      IDENTITY_MISMATCH: 'android-rpc-malformed-response',
    };
    const code = providerRejectedHttp
      ? 'android-rpc-provider-status'
      : codeByNativeCode[safeCode] || fallbackCode;
    const kind = code.replace(/^android-rpc-/, '');
    return createError(code, 'Android typed request could not be completed.', {
      kind,
      retryable: ![
        'cancelled',
        'invalid-part',
        'permission',
        'unsupported-codec',
        'malformed-response',
        'unavailable-route',
        'lyric-persistence-unavailable',
        'local-data-unavailable',
        'local-lyric-unavailable',
      ].includes(kind),
      safeCode: safeCode || 'UNKNOWN',
      status:
        response && Number.isInteger(response.status) ? response.status : 0,
    });
  }

  function scheduleAngularDigest() {
    if (typeof window === 'undefined' || !window.angular) return;
    try {
      const rootElement = window.document && window.document.documentElement;
      if (!rootElement || typeof window.angular.element !== 'function') return;
      const element = window.angular.element(rootElement);
      const injector =
        element && typeof element.injector === 'function'
          ? element.injector()
          : null;
      const rootScope =
        injector && typeof injector.get === 'function'
          ? injector.get('$rootScope')
          : null;
      if (rootScope && typeof rootScope.$evalAsync === 'function') {
        rootScope.$evalAsync(() => {});
      } else if (rootScope && typeof rootScope.$applyAsync === 'function') {
        rootScope.$applyAsync(() => {});
      }
    } catch (error) {
      // A missing or torn-down Angular injector must not affect the HTTP result.
    }
  }

  function scheduleAngularDigestAfterSettlement() {
    // Resolving a Promise first queues its consumer callbacks. Queue this work
    // behind them so their scope mutations precede the Angular digest.
    Promise.resolve().then(scheduleAngularDigest);
  }

  function resolvePending(entry, value) {
    entry.resolve(value);
    scheduleAngularDigestAfterSettlement();
  }

  function rejectPending(entry, error) {
    entry.reject(error);
    scheduleAngularDigestAfterSettlement();
  }

  function settleTypedEntry(entry, value, error) {
    if (!entry || entry.settled) return;
    entry.settled = true;
    clearTimeout(entry.timeoutId);
    if (error) rejectPending(entry, error);
    else resolvePending(entry, value);
  }

  function handleResponse(event) {
    const response = normalizeEventData(event);
    // The playback snapshot parser is kept beside the playback client so its
    // state and transport filtering cannot drift apart.
    // eslint-disable-next-line no-use-before-define
    if (isPlaybackSnapshotEvent(response)) {
      // eslint-disable-next-line no-use-before-define
      acceptPlaybackSnapshot(response);
      return;
    }
    if (!isValidLegacyResponse(response) && !isValidTypedResponse(response))
      return;
    const entry = pending.get(response.requestId);
    if (!entry) return;

    if (entry.version === TYPED_PROTOCOL_VERSION) {
      if (
        response.version !== TYPED_PROTOCOL_VERSION ||
        response.pageEpoch !== entry.pageEpoch
      ) {
        return;
      }
      pending.delete(response.requestId);
      if (response.terminal !== 'ok') {
        settleTypedEntry(
          entry,
          null,
          mapTypedError(
            response,
            response.terminal === 'cancelled'
              ? 'android-rpc-cancelled'
              : 'android-rpc-failed'
          )
        );
        return;
      }
      settleTypedEntry(entry, {
        status: response.status,
        result: response.result,
      });
      return;
    }
    if (response.version !== PROTOCOL_VERSION) return;

    pending.delete(response.requestId);
    clearTimeout(entry.timeoutId);
    if (!response.ok) {
      rejectPending(
        entry,
        createError('android-http-failed', 'Android HTTP request failed.', {
          status: response.status,
        })
      );
      return;
    }
    if (response.status < 200 || response.status >= 300) {
      rejectPending(
        entry,
        createError(
          'android-http-status',
          'Android HTTP request returned an error status.',
          {
            status: response.status,
          }
        )
      );
      return;
    }
    resolvePending(entry, { status: response.status, body: response.body });
  }

  function ensureResponseListener(bridge) {
    if (responseBridge === bridge) return true;
    if (!supportsResponseEvents(bridge)) return false;

    try {
      if (typeof bridge.addEventListener === 'function') {
        bridge.addEventListener('message', handleResponse);
      } else {
        const previousOnMessage = bridge.onmessage;
        bridge.onmessage = (event) => {
          handleResponse(event);
          if (typeof previousOnMessage === 'function') {
            previousOnMessage.call(bridge, event);
          }
        };
      }
    } catch (error) {
      return false;
    }
    responseBridge = bridge;
    return true;
  }

  function createRequestId() {
    requestSequence += 1;
    return `listen2-${Date.now().toString(36)}-${requestSequence.toString(
      36
    )}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function validateUrl(url) {
    if (typeof url !== 'string' || !url || url.length > MAX_URL_LENGTH) {
      return false;
    }
    try {
      return new URL(url).protocol === 'https:';
    } catch (error) {
      return false;
    }
  }

  function byteLength(value) {
    try {
      return new TextEncoder().encode(value).length;
    } catch (error) {
      return unescape(encodeURIComponent(value)).length;
    }
  }

  function isSafeBvid(value) {
    return typeof value === 'string' && /^BV[0-9A-Za-z]{6,32}$/.test(value);
  }

  function isSafeProviderTrackId(value) {
    return typeof value === 'string' && /^[1-9][0-9]{0,17}$/.test(value);
  }

  function isSafeMediaDownloadOperationId(value) {
    return (
      typeof value === 'string' &&
      value.length > 0 &&
      value.length <= MAX_MEDIA_DOWNLOAD_OPERATION_ID_LENGTH &&
      /^[A-Za-z0-9._-]+$/.test(value)
    );
  }

  function isSafeMediaDownloadRetention(value) {
    return ['temporary', 'playlist', 'download'].includes(value);
  }

  function isSafeMediaDownloadText(value) {
    return (
      typeof value === 'string' &&
      value.length > 0 &&
      value.length <= MAX_PLAYBACK_TEXT_LENGTH &&
      // eslint-disable-next-line no-control-regex
      !/[\u0000<>]/.test(value)
    );
  }

  function isSafeMediaDownloadDescriptor(value) {
    if (
      // This exact-shape helper is declared with response normalizers below.
      // eslint-disable-next-line no-use-before-define
      !isExactObject(value, [
        'artist',
        'durationMs',
        'mediaKind',
        'providerPartId',
        'providerTrackId',
        'source',
        'title',
      ])
    )
      return false;
    return (
      ((value.source === 'bilibili' && isSafeBvid(value.providerTrackId)) ||
        (value.source === 'netease' &&
          isSafeProviderTrackId(value.providerTrackId))) &&
      Number.isSafeInteger(value.providerPartId) &&
      value.providerPartId > 0 &&
      isSafeMediaDownloadText(value.title) &&
      isSafeMediaDownloadText(value.artist) &&
      Number.isSafeInteger(value.durationMs) &&
      value.durationMs >= 0 &&
      value.durationMs <= MAX_PLAYBACK_DURATION_MS &&
      value.mediaKind === 'audio'
    );
  }

  function isSafeShortId(value) {
    return (
      typeof value === 'string' &&
      value.length > 0 &&
      value.length <= 128 &&
      /^[A-Za-z0-9:._-]+$/.test(value)
    );
  }

  function isBoundedRevision(value) {
    return Number.isSafeInteger(value) && value >= 0 && value <= MAX_PAGE_EPOCH;
  }

  function hasSafeLyricIdentity(payload) {
    return (
      isSafeProviderTrackId(payload.trackId) &&
      isSafeShortId(payload.selectionIdentity) &&
      isBoundedRevision(payload.selectionRevision) &&
      isSafeShortId(payload.selectionToken)
    );
  }

  function hasExactlyKeys(payload, expected) {
    const keys = Object.keys(payload).sort();
    return (
      keys.length === expected.length &&
      keys.every((key, index) => key === expected[index])
    );
  }

  function validateTypedRequest(operation, payload, pageEpoch) {
    if (
      ![
        'bilibili.search',
        'bilibili.directory.page',
        'bilibili.directory.detail',
        'bilibili.video.detail',
        'bilibili.lyric.primary',
        'bilibili.account.status',
        'bilibili.account.qr.begin',
        'bilibili.account.qr.poll',
        'bilibili.account.qr.cancel',
        'bilibili.account.logout',
        'provider.capabilities',
        'media.download.start',
        'media.download.status',
        'media.download.cancel',
        'media.download.delete',
        'media.download.cleanup',
        'local.data.query',
        'local.data.command',
        'local.lyric.primary',
        'netease.search',
        'netease.directory.detail',
        'netease.rendition.default',
        'netease.lyric.primary',
        'netease.lyric.search',
        'lyric.selection.get',
        'lyric.selection.set',
        'lyric.selection.clear',
        'lyric.offset.set',
        'lyric.content.get',
        'lyric.content.put',
        'deepseek.translation.status',
        'deepseek.translation.configure',
        'deepseek.translation.test',
        'deepseek.translation.delete',
        'deepseek.translation.translate',
        'playback.command',
      ].includes(operation)
    ) {
      return 'android-rpc-invalid-operation';
    }
    if (
      !Number.isInteger(pageEpoch) ||
      pageEpoch < 0 ||
      pageEpoch > MAX_PAGE_EPOCH
    ) {
      return 'android-rpc-invalid-epoch';
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return 'android-rpc-invalid-payload';
    }
    const keys = Object.keys(payload).sort();
    if (operation === 'playback.command') {
      // eslint-disable-next-line no-use-before-define
      return validatePlaybackEnvelope(payload)
        ? null
        : 'android-rpc-invalid-payload';
    }
    if (
      [
        'deepseek.translation.status',
        'deepseek.translation.test',
        'deepseek.translation.delete',
      ].includes(operation)
    ) {
      return keys.length === 0 ? null : 'android-rpc-invalid-payload';
    }
    if (operation === 'deepseek.translation.configure') {
      return keys.length === 1 &&
        keys[0] === 'apiKey' &&
        typeof payload.apiKey === 'string' &&
        payload.apiKey.trim() &&
        byteLength(payload.apiKey.trim()) <= MAX_DEEPSEEK_KEY_BYTES &&
        // eslint-disable-next-line no-control-regex
        !/[\u0000-\u001f\u007f]/.test(payload.apiKey)
        ? null
        : 'android-rpc-invalid-payload';
    }
    if (operation === 'deepseek.translation.translate') {
      const consentKeys = [
        'acceptedAtEpochMs',
        'artist',
        'cancellation',
        'failureImpact',
        'lyrics',
        'possibleCost',
        'title',
      ];
      const { consent } = payload;
      if (
        keys.length !== 5 ||
        !['artist', 'consent', 'lyric', 'styleHint', 'title'].every((key) =>
          keys.includes(key)
        ) ||
        typeof payload.lyric !== 'string' ||
        typeof payload.title !== 'string' ||
        typeof payload.artist !== 'string' ||
        typeof payload.styleHint !== 'string' ||
        byteLength(payload.lyric) > MAX_DEEPSEEK_LYRIC_BYTES ||
        byteLength(payload.title) > MAX_DEEPSEEK_METADATA_BYTES ||
        byteLength(payload.artist) > MAX_DEEPSEEK_METADATA_BYTES ||
        byteLength(payload.styleHint) > MAX_DEEPSEEK_STYLE_BYTES ||
        !consent ||
        typeof consent !== 'object' ||
        Array.isArray(consent) ||
        !hasExactlyKeys(consent, consentKeys) ||
        ![
          'lyrics',
          'title',
          'artist',
          'possibleCost',
          'cancellation',
          'failureImpact',
        ].every(
          (key) => typeof consent[key] === 'boolean' && consent[key] === true
        ) ||
        !Number.isSafeInteger(consent.acceptedAtEpochMs) ||
        consent.acceptedAtEpochMs <= 0
      ) {
        return 'android-rpc-invalid-payload';
      }
      return null;
    }
    if (['local.data.query', 'local.data.command'].includes(operation)) {
      // eslint-disable-next-line no-use-before-define
      return validateLocalDataRequest(operation, payload)
        ? null
        : 'android-rpc-invalid-payload';
    }
    if (operation === 'local.lyric.primary') {
      return hasExactlyKeys(payload, ['localTrackId']) &&
        /^local\.track\.[a-f0-9]{64}$/.test(payload.localTrackId)
        ? null
        : 'android-rpc-invalid-payload';
    }
    if (['lyric.content.get', 'lyric.content.put'].includes(operation)) {
      const identityKeys = [
        'expectedRevision',
        'lyricRevision',
        'providerPartId',
        'providerTrackId',
        'source',
        'transitionToken',
      ];
      const expectedKeys =
        operation === 'lyric.content.put'
          ? [...identityKeys, 'originalText', 'translationText'].sort()
          : identityKeys;
      const safeTrackId =
        (payload.source === 'bilibili' &&
          (/^BV[0-9A-Za-z]{10}$/.test(payload.providerTrackId) ||
            /^[1-9][0-9]{0,17}$/.test(payload.providerTrackId))) ||
        (payload.source === 'netease' &&
          /^[1-9][0-9]{0,17}$/.test(payload.providerTrackId)) ||
        (payload.source === 'local' &&
          /^local\.track\.[a-f0-9]{64}$/.test(payload.providerTrackId));
      if (
        !hasExactlyKeys(payload, expectedKeys) ||
        !safeTrackId ||
        !Number.isSafeInteger(payload.providerPartId) ||
        payload.providerPartId < 0 ||
        !isSafeShortId(payload.lyricRevision) ||
        !isBoundedRevision(payload.expectedRevision) ||
        !isSafeShortId(payload.transitionToken)
      ) {
        return 'android-rpc-invalid-payload';
      }
      if (operation === 'lyric.content.put') {
        if (
          typeof payload.originalText !== 'string' ||
          !payload.originalText.trim() ||
          typeof payload.translationText !== 'string' ||
          !payload.translationText.trim() ||
          byteLength(payload.originalText) > MAX_PERSISTENT_LYRIC_BYTES ||
          byteLength(payload.translationText) > MAX_PERSISTENT_LYRIC_BYTES ||
          // eslint-disable-next-line no-control-regex
          /\u0000/.test(payload.originalText) ||
          // eslint-disable-next-line no-control-regex
          /\u0000/.test(payload.translationText)
        ) {
          return 'android-rpc-invalid-payload';
        }
      }
      return null;
    }
    if (operation === 'media.download.start') {
      return hasExactlyKeys(payload, [
        'descriptor',
        'operationId',
        'retention',
      ]) &&
        isSafeMediaDownloadOperationId(payload.operationId) &&
        isSafeMediaDownloadRetention(payload.retention) &&
        isSafeMediaDownloadDescriptor(payload.descriptor)
        ? null
        : 'android-rpc-invalid-payload';
    }
    if (
      ['media.download.status', 'media.download.cancel'].includes(operation)
    ) {
      return hasExactlyKeys(payload, ['operationId']) &&
        isSafeMediaDownloadOperationId(payload.operationId)
        ? null
        : 'android-rpc-invalid-payload';
    }
    if (operation === 'media.download.delete') {
      return hasExactlyKeys(payload, ['descriptor']) &&
        isSafeMediaDownloadDescriptor(payload.descriptor)
        ? null
        : 'android-rpc-invalid-payload';
    }
    if (operation === 'media.download.cleanup') {
      return keys.length === 0 ? null : 'android-rpc-invalid-payload';
    }
    if (
      [
        'provider.capabilities',
        'bilibili.account.status',
        'bilibili.account.qr.begin',
        'bilibili.account.logout',
      ].includes(operation)
    ) {
      return keys.length === 0 ? null : 'android-rpc-invalid-payload';
    }
    if (
      ['bilibili.account.qr.poll', 'bilibili.account.qr.cancel'].includes(
        operation
      )
    ) {
      return hasExactlyKeys(payload, ['sessionId']) &&
        isSafeShortId(payload.sessionId)
        ? null
        : 'android-rpc-invalid-payload';
    }
    if (operation === 'bilibili.search' || operation === 'netease.search') {
      if (keys.length !== 2 || keys[0] !== 'keyword' || keys[1] !== 'page') {
        return 'android-rpc-invalid-payload';
      }
      if (
        typeof payload.keyword !== 'string' ||
        !payload.keyword.trim() ||
        byteLength(payload.keyword.trim()) > MAX_TYPED_KEYWORD_BYTES ||
        !Number.isInteger(payload.page) ||
        payload.page < 1 ||
        payload.page > 1000
      ) {
        return 'android-rpc-invalid-payload';
      }
      return null;
    }
    if (operation === 'bilibili.video.detail') {
      return keys.length === 1 && keys[0] === 'bvid' && isSafeBvid(payload.bvid)
        ? null
        : 'android-rpc-invalid-payload';
    }
    if (operation === 'bilibili.directory.page') {
      return hasExactlyKeys(payload, ['page']) &&
        Number.isInteger(payload.page) &&
        payload.page >= 1 &&
        payload.page <= 1000
        ? null
        : 'android-rpc-invalid-payload';
    }
    if (operation === 'bilibili.directory.detail') {
      return hasExactlyKeys(payload, ['playlistId']) &&
        typeof payload.playlistId === 'string' &&
        /^[1-9][0-9]{0,17}$/.test(payload.playlistId)
        ? null
        : 'android-rpc-invalid-payload';
    }
    if (operation === 'bilibili.lyric.primary') {
      const semanticText = (value) =>
        typeof value === 'string' &&
        value.trim() === value &&
        value.length > 0 &&
        byteLength(value) <= MAX_TYPED_KEYWORD_BYTES &&
        !/[\r\n<>]/.test(value);
      return hasExactlyKeys(payload, [
        'artist',
        'bvid',
        'cid',
        'durationSeconds',
        'selectionIdentity',
        'selectionRevision',
        'selectionToken',
        'title',
      ]) &&
        isSafeBvid(payload.bvid) &&
        Number.isSafeInteger(payload.cid) &&
        payload.cid > 0 &&
        semanticText(payload.title) &&
        semanticText(payload.artist) &&
        Number.isSafeInteger(payload.durationSeconds) &&
        payload.durationSeconds > 0 &&
        payload.durationSeconds <= MAX_PLAYBACK_DURATION_MS / 1000 &&
        isSafeShortId(payload.selectionIdentity) &&
        isBoundedRevision(payload.selectionRevision) &&
        isSafeShortId(payload.selectionToken)
        ? null
        : 'android-rpc-invalid-payload';
    }
    if (operation === 'netease.directory.detail') {
      return hasExactlyKeys(payload, ['trackId']) &&
        isSafeProviderTrackId(payload.trackId)
        ? null
        : 'android-rpc-invalid-payload';
    }
    if (operation === 'netease.rendition.default') {
      return hasExactlyKeys(payload, ['selectionRevision', 'trackId']) &&
        isSafeProviderTrackId(payload.trackId) &&
        isBoundedRevision(payload.selectionRevision)
        ? null
        : 'android-rpc-invalid-payload';
    }
    const lyricIdentityKeys = [
      'selectionIdentity',
      'selectionRevision',
      'selectionToken',
      'trackId',
    ];
    if (
      [
        'netease.lyric.primary',
        'lyric.selection.get',
        'lyric.selection.clear',
      ].includes(operation)
    ) {
      return hasExactlyKeys(payload, lyricIdentityKeys) &&
        hasSafeLyricIdentity(payload)
        ? null
        : 'android-rpc-invalid-payload';
    }
    if (operation === 'netease.lyric.search') {
      return hasExactlyKeys(
        payload,
        [...lyricIdentityKeys, 'keyword'].sort()
      ) &&
        hasSafeLyricIdentity(payload) &&
        typeof payload.keyword === 'string' &&
        payload.keyword.trim() &&
        byteLength(payload.keyword.trim()) <= MAX_TYPED_KEYWORD_BYTES
        ? null
        : 'android-rpc-invalid-payload';
    }
    if (operation === 'lyric.selection.set') {
      return hasExactlyKeys(
        payload,
        [...lyricIdentityKeys, 'lyricId'].sort()
      ) &&
        hasSafeLyricIdentity(payload) &&
        isSafeShortId(payload.lyricId)
        ? null
        : 'android-rpc-invalid-payload';
    }
    if (operation === 'lyric.offset.set') {
      return hasExactlyKeys(
        payload,
        [...lyricIdentityKeys, 'offsetMs'].sort()
      ) &&
        hasSafeLyricIdentity(payload) &&
        Number.isSafeInteger(payload.offsetMs) &&
        payload.offsetMs >= -MAX_LYRIC_OFFSET_MS &&
        payload.offsetMs <= MAX_LYRIC_OFFSET_MS
        ? null
        : 'android-rpc-invalid-payload';
    }
    return 'android-rpc-invalid-operation';
  }

  function normalizedTypedPayload(operation, payload) {
    if (operation === 'playback.command') {
      return {
        expectedRevision: payload.expectedRevision,
        command: payload.command,
        payload: { ...payload.payload },
      };
    }
    if (
      [
        'deepseek.translation.status',
        'deepseek.translation.test',
        'deepseek.translation.delete',
      ].includes(operation)
    ) {
      return {};
    }
    if (operation === 'deepseek.translation.configure') {
      return { apiKey: payload.apiKey.trim() };
    }
    if (operation === 'deepseek.translation.translate') {
      return {
        lyric: payload.lyric,
        title: payload.title,
        artist: payload.artist,
        styleHint: payload.styleHint,
        consent: { ...payload.consent },
      };
    }
    if (
      [
        'provider.capabilities',
        'bilibili.account.status',
        'bilibili.account.qr.begin',
        'bilibili.account.logout',
      ].includes(operation)
    ) {
      return {};
    }
    if (
      ['bilibili.account.qr.poll', 'bilibili.account.qr.cancel'].includes(
        operation
      )
    ) {
      return { sessionId: payload.sessionId };
    }
    if (['local.data.query', 'local.data.command'].includes(operation)) {
      return {
        action: payload.action,
        // The recursive clone helper is declared with payload normalizers below.
        // eslint-disable-next-line no-use-before-define
        payload: cloneLocalDataPayload(payload.payload),
      };
    }
    if (operation === 'local.lyric.primary') {
      return { localTrackId: payload.localTrackId };
    }
    if (['lyric.content.get', 'lyric.content.put'].includes(operation)) {
      return {
        source: payload.source,
        providerTrackId: payload.providerTrackId,
        providerPartId: payload.providerPartId,
        lyricRevision: payload.lyricRevision,
        expectedRevision: payload.expectedRevision,
        transitionToken: payload.transitionToken,
        ...(operation === 'lyric.content.put'
          ? {
              originalText: payload.originalText,
              translationText: payload.translationText,
            }
          : {}),
      };
    }
    if (operation === 'media.download.start') {
      return {
        operationId: payload.operationId,
        retention: payload.retention,
        descriptor: { ...payload.descriptor },
      };
    }
    if (
      ['media.download.status', 'media.download.cancel'].includes(operation)
    ) {
      return { operationId: payload.operationId };
    }
    if (operation === 'media.download.delete') {
      return { descriptor: { ...payload.descriptor } };
    }
    if (operation === 'media.download.cleanup') return {};
    if (operation === 'bilibili.search' || operation === 'netease.search') {
      return { keyword: payload.keyword.trim(), page: payload.page };
    }
    if (operation === 'bilibili.video.detail') {
      return { bvid: payload.bvid };
    }
    if (operation === 'bilibili.directory.page') {
      return { page: payload.page };
    }
    if (operation === 'bilibili.directory.detail') {
      return { playlistId: payload.playlistId };
    }
    if (operation === 'bilibili.lyric.primary') {
      return {
        bvid: payload.bvid,
        cid: payload.cid,
        title: payload.title,
        artist: payload.artist,
        durationSeconds: payload.durationSeconds,
        selectionIdentity: payload.selectionIdentity,
        selectionRevision: payload.selectionRevision,
        selectionToken: payload.selectionToken,
      };
    }
    if (operation === 'netease.directory.detail') {
      return { trackId: payload.trackId };
    }
    if (operation === 'netease.rendition.default') {
      return {
        trackId: payload.trackId,
        selectionRevision: payload.selectionRevision,
      };
    }
    const lyricIdentity = {
      trackId: payload.trackId,
      selectionIdentity: payload.selectionIdentity,
      selectionRevision: payload.selectionRevision,
      selectionToken: payload.selectionToken,
    };
    if (
      [
        'netease.lyric.primary',
        'lyric.selection.get',
        'lyric.selection.clear',
      ].includes(operation)
    ) {
      return lyricIdentity;
    }
    if (operation === 'netease.lyric.search') {
      return { ...lyricIdentity, keyword: payload.keyword.trim() };
    }
    if (operation === 'lyric.selection.set') {
      return { ...lyricIdentity, lyricId: payload.lyricId };
    }
    if (operation === 'lyric.offset.set') {
      return { ...lyricIdentity, offsetMs: payload.offsetMs };
    }
    return {};
  }

  function postCancellation(bridge, requestId, pageEpoch) {
    try {
      bridge.postMessage(
        JSON.stringify({
          version: TYPED_PROTOCOL_VERSION,
          operation: 'rpc.cancel',
          requestId: createRequestId(),
          pageEpoch,
          payload: { targetRequestId: requestId, targetPageEpoch: pageEpoch },
        })
      );
    } catch (error) {
      // Cancellation is best effort after dispatch; local settlement still wins.
    }
  }

  function rejectedRequestHandle(error, pageEpoch) {
    const promise = Promise.reject(error);
    return {
      requestId: '',
      pageEpoch: Number.isInteger(pageEpoch) ? pageEpoch : 0,
      promise,
      cancel() {},
      then: promise.then.bind(promise),
      catch: promise.catch.bind(promise),
    };
  }

  function request(operation, payload, options = {}) {
    const bridge = getBridge();
    if (!bridge || !ensureResponseListener(bridge)) {
      return rejectedRequestHandle(
        createError(
          'android-rpc-unavailable',
          'Android typed requests are not supported in this environment.'
        ),
        options.pageEpoch
      );
    }
    const { pageEpoch } = options;
    const validationError = validateTypedRequest(operation, payload, pageEpoch);
    if (validationError) {
      return rejectedRequestHandle(
        createError(
          validationError,
          'Android typed request was rejected before dispatch.'
        ),
        pageEpoch
      );
    }
    const timeoutMs = Math.min(
      MAX_TIMEOUT_MS,
      Math.max(
        1,
        Number.isFinite(options.timeoutMs)
          ? Math.floor(options.timeoutMs)
          : DEFAULT_TIMEOUT_MS
      )
    );
    const requestId = createRequestId();
    const envelope = JSON.stringify({
      version: TYPED_PROTOCOL_VERSION,
      operation,
      requestId,
      pageEpoch,
      payload: normalizedTypedPayload(operation, payload),
    });
    let entry;
    const promise = new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        const timedOutEntry = pending.get(requestId);
        if (!timedOutEntry) return;
        pending.delete(requestId);
        postCancellation(bridge, requestId, pageEpoch);
        settleTypedEntry(
          timedOutEntry,
          null,
          createError(
            'android-rpc-timeout',
            'Android typed request timed out.',
            {
              kind: 'timeout',
              retryable: true,
              safeCode: 'TIMEOUT',
              status: 0,
            }
          )
        );
      }, timeoutMs);
      entry = {
        resolve,
        reject,
        timeoutId,
        version: TYPED_PROTOCOL_VERSION,
        pageEpoch,
        settled: false,
      };
      pending.set(requestId, entry);
      try {
        bridge.postMessage(envelope);
      } catch (error) {
        pending.delete(requestId);
        settleTypedEntry(
          entry,
          null,
          createError(
            'android-rpc-post-failed',
            'Android typed request could not be sent.',
            {
              kind: 'post-failed',
              retryable: true,
              safeCode: 'POST_FAILED',
              status: 0,
            }
          )
        );
      }
    });
    const cancel = () => {
      const current = pending.get(requestId);
      if (!current) return;
      // Native sees the matching request identity before local consumers see
      // cancellation, so a late terminal cannot become visible state.
      postCancellation(bridge, requestId, pageEpoch);
      pending.delete(requestId);
      settleTypedEntry(
        current,
        null,
        createError(
          'android-rpc-cancelled',
          'Android typed request was cancelled.',
          {
            kind: 'cancelled',
            retryable: false,
            safeCode: 'CANCELLED',
            status: 0,
          }
        )
      );
    };
    return {
      requestId,
      pageEpoch,
      promise,
      cancel,
      // Promise-like methods retain compatibility for the narrow Phase-1
      // consumer while new callers use the explicit handle fields above.
      then: promise.then.bind(promise),
      catch: promise.catch.bind(promise),
    };
  }

  function typedRequestOptions(options = {}) {
    return {
      pageEpoch: Number.isInteger(options.pageEpoch) ? options.pageEpoch : 0,
      ...(Number.isFinite(options.timeoutMs)
        ? { timeoutMs: options.timeoutMs }
        : {}),
    };
  }

  function isExactObject(value, expectedKeys) {
    return (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      hasExactlyKeys(value, [...expectedKeys].sort())
    );
  }

  function normalizeProviderCapabilities(result) {
    const topLevelKeys =
      result && typeof result === 'object' && !Array.isArray(result)
        ? Object.keys(result).sort()
        : [];
    const requiredTopLevelKeys = ['bilibili', 'netease', 'version'];
    const hasValidTopLevel =
      topLevelKeys.length === requiredTopLevelKeys.length ||
      (topLevelKeys.length === requiredTopLevelKeys.length + 1 &&
        topLevelKeys.includes('deepSeekTranslation'));
    if (
      !hasValidTopLevel ||
      !requiredTopLevelKeys.every((key) => topLevelKeys.includes(key)) ||
      result.version !== PROVIDER_CAPABILITY_VERSION ||
      (topLevelKeys.includes('deepSeekTranslation') &&
        typeof result.deepSeekTranslation !== 'boolean')
    ) {
      return null;
    }
    const normalizeProvider = (value) => {
      if (!isExactObject(value, PROVIDER_CAPABILITY_FIELDS)) return null;
      if (
        !PROVIDER_CAPABILITY_FIELDS.every(
          (field) => typeof value[field] === 'boolean'
        )
      )
        return null;
      const normalized = PROVIDER_CAPABILITY_FIELDS.reduce(
        (projected, field) => ({
          ...projected,
          [field]: value[field] === true,
        }),
        {}
      );
      return Object.freeze(normalized);
    };
    const bilibili = normalizeProvider(result.bilibili);
    const netease = normalizeProvider(result.netease);
    return bilibili && netease
      ? Object.freeze({
          version: PROVIDER_CAPABILITY_VERSION,
          bilibili,
          netease,
          deepSeekTranslation: result.deepSeekTranslation === true,
        })
      : null;
  }

  function notifyProviderCapabilityListeners() {
    providerCapabilityListeners.forEach((listener) => {
      try {
        listener(verifiedProviderCapabilities);
      } catch (error) {
        // Capability observers are optional UI consumers and cannot affect RPC.
      }
    });
    scheduleAngularDigest();
  }

  function getProviderCapabilities() {
    // This is deliberately synchronous and cache-only. A caller must use the
    // explicit start/refresh methods before treating an Android capability true.
    return verifiedProviderCapabilities;
  }

  function getDeepSeekTranslationCapability() {
    return Boolean(
      verifiedProviderCapabilities &&
        verifiedProviderCapabilities.deepSeekTranslation === true
    );
  }

  function refreshProviderCapabilities(options = {}) {
    if (providerCapabilityRefresh) return providerCapabilityRefresh;
    // A failed revalidation must not leave an old true capability actionable.
    verifiedProviderCapabilities = null;
    const handle = request(
      'provider.capabilities',
      {},
      typedRequestOptions(options)
    );
    const refresh = handle.promise
      .then(({ result }) => {
        const normalized = normalizeProviderCapabilities(result);
        if (!normalized) {
          throw createError(
            'android-rpc-malformed-response',
            'Android provider capabilities were malformed.'
          );
        }
        verifiedProviderCapabilities = normalized;
        notifyProviderCapabilityListeners();
        return normalized;
      })
      .catch((error) => {
        // Remain unavailable; a native failure can never become a capability.
        verifiedProviderCapabilities = null;
        notifyProviderCapabilityListeners();
        throw error;
      })
      .finally(() => {
        if (providerCapabilityRefresh === refresh) {
          providerCapabilityRefresh = null;
        }
      });
    providerCapabilityRefresh = refresh;
    notifyProviderCapabilityListeners();
    return refresh;
  }

  function startProviderCapabilities(options = {}) {
    return verifiedProviderCapabilities
      ? Promise.resolve(verifiedProviderCapabilities)
      : refreshProviderCapabilities(options);
  }

  function onProviderCapabilities(listener) {
    if (typeof listener !== 'function') return () => {};
    providerCapabilityListeners.add(listener);
    return () => providerCapabilityListeners.delete(listener);
  }

  function isSafeQrUrl(value) {
    if (typeof value !== 'string' || value.length > MAX_ACCOUNT_QR_URL_LENGTH) {
      return false;
    }
    try {
      const url = new URL(value);
      const queryKeys = Array.from(url.searchParams.keys());
      const qrKeys = url.searchParams.getAll('qrcode_key');
      const navhide = url.searchParams.getAll('navhide');
      return (
        url.protocol === 'https:' &&
        url.hostname === 'passport.bilibili.com' &&
        !url.port &&
        !url.username &&
        !url.password &&
        !url.hash &&
        url.pathname === '/h5-app/passport/login/scan' &&
        queryKeys.length === qrKeys.length + navhide.length &&
        qrKeys.length === 1 &&
        /^[A-Za-z0-9_-]{1,256}$/.test(qrKeys[0]) &&
        navhide.length <= 1 &&
        (navhide.length === 0 || ['0', '1'].includes(navhide[0]))
      );
    } catch (error) {
      return false;
    }
  }

  function normalizeAccountPublicState(result) {
    if (
      !isExactObject(result, [
        'expiresAtEpochMs',
        'qrUrl',
        'sessionId',
        'status',
      ]) ||
      !ACCOUNT_STATUSES.has(result.status) ||
      typeof result.sessionId !== 'string' ||
      !Number.isSafeInteger(result.expiresAtEpochMs) ||
      result.expiresAtEpochMs < 0 ||
      typeof result.qrUrl !== 'string'
    ) {
      throw createError(
        'android-rpc-malformed-response',
        'Android account state was malformed.'
      );
    }
    const pendingQr = ['waiting', 'scanned'].includes(result.status);
    if (
      (result.sessionId !== '' && !isSafeShortId(result.sessionId)) ||
      (pendingQr && !result.sessionId) ||
      (pendingQr && !isSafeQrUrl(result.qrUrl)) ||
      (!pendingQr && result.qrUrl !== '')
    ) {
      throw createError(
        'android-rpc-malformed-response',
        'Android account state was malformed.'
      );
    }
    return Object.freeze({
      sessionId: pendingQr ? result.sessionId : '',
      status: result.status,
      expiresAtEpochMs: pendingQr ? result.expiresAtEpochMs : 0,
      qrUrl: pendingQr ? result.qrUrl : '',
    });
  }

  function projectTypedHandle(handle, project) {
    const promise = handle.promise.then(({ result }) => project(result));
    return {
      requestId: handle.requestId,
      pageEpoch: handle.pageEpoch,
      cancel: handle.cancel,
      promise,
      then: promise.then.bind(promise),
      catch: promise.catch.bind(promise),
    };
  }

  const DEEPSEEK_STATUS_FIELDS = [
    'errorCode',
    'hasApiKey',
    'model',
    'nativeClientAvailable',
    'provider',
    'secureStorageAvailable',
    'status',
    'targetLanguage',
  ];

  function normalizeDeepSeekStatus(result) {
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      throw createError(
        'android-rpc-deepseek-unavailable',
        'Android DeepSeek status was malformed.'
      );
    }
    if (result.ok !== false && result.ok !== true) {
      throw createError(
        'android-rpc-deepseek-unavailable',
        'Android DeepSeek status was malformed.'
      );
    }
    const hasMetadata = DEEPSEEK_STATUS_FIELDS.every((key) =>
      Object.prototype.hasOwnProperty.call(result, key)
    );
    if (!hasMetadata) {
      return Object.freeze({
        ok: false,
        status:
          typeof result.status === 'string' ? result.status : 'unavailable',
        provider: 'deepseek',
        model: 'deepseek-v4-flash',
        targetLanguage: 'zh-CN',
        secureStorageAvailable: false,
        hasApiKey: false,
        nativeClientAvailable: false,
        errorCode: result.status || 'native-capability-unavailable',
      });
    }
    if (
      typeof result.status !== 'string' ||
      typeof result.provider !== 'string' ||
      typeof result.model !== 'string' ||
      typeof result.targetLanguage !== 'string' ||
      typeof result.secureStorageAvailable !== 'boolean' ||
      typeof result.hasApiKey !== 'boolean' ||
      typeof result.nativeClientAvailable !== 'boolean' ||
      (result.errorCode !== null && typeof result.errorCode !== 'string')
    ) {
      throw createError(
        'android-rpc-deepseek-unavailable',
        'Android DeepSeek status was malformed.'
      );
    }
    return Object.freeze({
      ok: result.ok === true,
      status: result.status,
      provider: result.provider,
      model: result.model,
      targetLanguage: result.targetLanguage,
      secureStorageAvailable: result.secureStorageAvailable,
      hasApiKey: result.hasApiKey,
      nativeClientAvailable: result.nativeClientAvailable,
      errorCode: result.errorCode,
    });
  }

  function normalizeDeepSeekTest(result) {
    if (
      !result ||
      typeof result !== 'object' ||
      Array.isArray(result) ||
      typeof result.ok !== 'boolean' ||
      typeof result.status !== 'string' ||
      !Number.isSafeInteger(result.httpStatus) ||
      result.httpStatus < 0 ||
      result.httpStatus > 999 ||
      typeof result.retryable !== 'boolean'
    ) {
      throw createError(
        'android-rpc-deepseek-unavailable',
        'Android DeepSeek test result was malformed.'
      );
    }
    return Object.freeze({
      ok: result.ok,
      status: result.status,
      httpStatus: result.httpStatus,
      retryable: result.retryable,
    });
  }

  function normalizeDeepSeekTranslation(result) {
    if (
      !result ||
      typeof result !== 'object' ||
      Array.isArray(result) ||
      typeof result.ok !== 'boolean' ||
      typeof result.status !== 'string' ||
      !Number.isSafeInteger(result.httpStatus) ||
      result.httpStatus < 0 ||
      result.httpStatus > 999 ||
      typeof result.retryable !== 'boolean'
    ) {
      throw createError(
        'android-rpc-deepseek-unavailable',
        'Android DeepSeek translation result was malformed.'
      );
    }
    if (!result.ok) {
      return Object.freeze({
        ok: false,
        status: result.status,
        httpStatus: result.httpStatus,
        retryable: result.retryable,
      });
    }
    const expected = [
      'completionTokens',
      'lineCount',
      'model',
      'promptFingerprint',
      'promptTokens',
      'promptVersion',
      'provider',
      'targetLanguage',
      'tlyric',
      'totalTokens',
    ];
    if (
      !expected.every((key) =>
        Object.prototype.hasOwnProperty.call(result, key)
      ) ||
      typeof result.tlyric !== 'string' ||
      !result.tlyric.trim() ||
      typeof result.provider !== 'string' ||
      typeof result.model !== 'string' ||
      typeof result.promptVersion !== 'string' ||
      typeof result.promptFingerprint !== 'string' ||
      typeof result.targetLanguage !== 'string' ||
      !Number.isSafeInteger(result.lineCount) ||
      result.lineCount <= 0 ||
      !Number.isSafeInteger(result.promptTokens) ||
      !Number.isSafeInteger(result.completionTokens) ||
      !Number.isSafeInteger(result.totalTokens)
    ) {
      throw createError(
        'android-rpc-deepseek-unavailable',
        'Android DeepSeek translation result was malformed.'
      );
    }
    return Object.freeze({
      ok: true,
      status: result.status,
      httpStatus: result.httpStatus,
      retryable: result.retryable,
      tlyric: result.tlyric,
      provider: result.provider,
      model: result.model,
      promptVersion: result.promptVersion,
      promptFingerprint: result.promptFingerprint,
      targetLanguage: result.targetLanguage,
      lineCount: result.lineCount,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      totalTokens: result.totalTokens,
    });
  }

  function requestDeepSeek(operation, payload, project, options) {
    return projectTypedHandle(
      request(operation, payload, typedRequestOptions(options)),
      project
    );
  }

  const deepSeek = Object.freeze({
    status(options) {
      return requestDeepSeek(
        'deepseek.translation.status',
        {},
        normalizeDeepSeekStatus,
        options
      );
    },
    configure(apiKey, options) {
      return requestDeepSeek(
        'deepseek.translation.configure',
        { apiKey },
        normalizeDeepSeekStatus,
        options
      );
    },
    test(options) {
      return requestDeepSeek(
        'deepseek.translation.test',
        {},
        normalizeDeepSeekTest,
        options
      );
    },
    delete(options) {
      return requestDeepSeek(
        'deepseek.translation.delete',
        {},
        normalizeDeepSeekStatus,
        options
      );
    },
    translate(payload, options) {
      return requestDeepSeek(
        'deepseek.translation.translate',
        payload,
        normalizeDeepSeekTranslation,
        options
      );
    },
  });

  function requestAccountState(operation, payload, options) {
    return projectTypedHandle(
      request(operation, payload, typedRequestOptions(options)),
      normalizeAccountPublicState
    );
  }

  const account = Object.freeze({
    status(options) {
      return requestAccountState('bilibili.account.status', {}, options);
    },
    qrBegin(options) {
      return requestAccountState('bilibili.account.qr.begin', {}, options);
    },
    begin(options) {
      return requestAccountState('bilibili.account.qr.begin', {}, options);
    },
    poll(sessionId, options) {
      return requestAccountState(
        'bilibili.account.qr.poll',
        { sessionId },
        options
      );
    },
    cancel(sessionId, options) {
      return requestAccountState(
        'bilibili.account.qr.cancel',
        { sessionId },
        options
      );
    },
    logout(options) {
      return requestAccountState('bilibili.account.logout', {}, options);
    },
  });

  const LOCAL_DATA_QUERY_ACTIONS = new Set([
    'capabilities',
    'playlists',
    'favorites',
    'saf',
    'localTracks',
    'historyAnnual',
    'cache',
    'settings',
    'backup.fileStatus',
    'backup.preview',
  ]);
  const LOCAL_DATA_COMMAND_ACTIONS = new Set([
    'playlist.create',
    'playlist.replace',
    'playlist.delete',
    'playlist.reorder',
    'favorite.set',
    'history.enable',
    'history.ingest',
    'history.clear',
    'localTracks.refresh',
    'localTracks.repair',
    'cache.refresh',
    'cache.capacity',
    'cache.directory',
    'settings.update',
    'backup.import',
    'backup.export',
    'backup.import.pick',
    'saf.pickAudio',
    'saf.pickTree',
  ]);
  const LOCAL_DATA_STATUSES = new Set([
    'OK',
    'DUPLICATE',
    'REPAIRED',
    'INVALID_INPUT',
    'NOT_FOUND',
    'STALE_REVISION',
    'CONFIRMATION_REQUIRED',
    'GRANT_INVALID',
    'NEEDS_REPAIR',
    'CORRUPT',
    'IO_UNAVAILABLE',
    'INTEGRITY_FAILED',
    'DISABLED',
    'PARTIAL',
  ]);
  const MAX_LOCAL_ROWS = 500;
  const MAX_LOCAL_TRACKS = 5000;
  const MAX_LOCAL_TEXT_LENGTH = 320;
  const MAX_LOCAL_RESPONSE_DEPTH = 6;

  function isSafeLocalId(value) {
    return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,160}$/.test(value);
  }

  function isSafeLocalText(value) {
    return (
      typeof value === 'string' &&
      value.trim() === value &&
      value.length > 0 &&
      value.length <= MAX_LOCAL_TEXT_LENGTH &&
      value.indexOf('\u0000') === -1 &&
      !value.includes('<') &&
      !value.includes('>') &&
      !value.includes('://')
    );
  }

  function isBoundedLocalInteger(value, minimum, maximum) {
    return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
  }

  function isSafeLocalTrack(value) {
    return (
      isExactObject(value, [
        'artist',
        'durationMs',
        'providerTrackId',
        'source',
        'title',
      ]) &&
      isSafeLocalId(value.source) &&
      isSafeLocalId(value.providerTrackId) &&
      isSafeLocalText(value.title) &&
      isSafeLocalText(value.artist) &&
      isBoundedLocalInteger(value.durationMs, 0, MAX_PLAYBACK_DURATION_MS)
    );
  }

  function isSafeLocalTracks(value) {
    return (
      Array.isArray(value) &&
      value.length <= MAX_LOCAL_TRACKS &&
      value.every(isSafeLocalTrack)
    );
  }

  function isSafeLocalMediaTrack(value) {
    return (
      isExactObject(value, [
        'artist',
        'availability',
        'cover',
        'displayName',
        'durationMs',
        'grantReferenceId',
        'localTrackId',
        'lrc',
        'mime',
        'source',
        'title',
      ]) &&
      value.source === 'local' &&
      /^local\.track\.[a-f0-9]{64}$/.test(value.localTrackId) &&
      isSafeLocalId(value.grantReferenceId) &&
      isSafeLocalText(value.displayName) &&
      isSafeLocalText(value.title) &&
      isSafeLocalText(value.artist) &&
      /^[A-Za-z0-9.+-]+\/[A-Za-z0-9.+-]+$/.test(value.mime) &&
      typeof value.cover === 'boolean' &&
      typeof value.lrc === 'boolean' &&
      ['available', 'needs-repair', 'revoked'].includes(value.availability) &&
      isBoundedLocalInteger(value.durationMs, 0, MAX_PLAYBACK_DURATION_MS)
    );
  }

  function isSafeLocalPlaylist(value) {
    return (
      isExactObject(value, [
        'name',
        'ordinal',
        'playlistId',
        'revision',
        'tracks',
      ]) &&
      isSafeLocalId(value.playlistId) &&
      isSafeLocalText(value.name) &&
      isBoundedLocalInteger(value.ordinal, 0, MAX_LOCAL_ROWS) &&
      isBoundedLocalInteger(value.revision, 0, MAX_PAGE_EPOCH) &&
      isSafeLocalTracks(value.tracks)
    );
  }

  function isSafeLocalFavorite(value) {
    return (
      isExactObject(value, [
        'addedAtMs',
        'artist',
        'providerTrackId',
        'source',
        'title',
      ]) &&
      isSafeLocalId(value.source) &&
      isSafeLocalId(value.providerTrackId) &&
      isSafeLocalText(value.title) &&
      isSafeLocalText(value.artist) &&
      isBoundedLocalInteger(value.addedAtMs, 0, Number.MAX_SAFE_INTEGER)
    );
  }

  function isSafeLocalBackup(value) {
    return (
      isExactObject(value, ['favorites', 'playlists', 'version']) &&
      value.version === 1 &&
      Array.isArray(value.playlists) &&
      value.playlists.length <= MAX_LOCAL_ROWS &&
      value.playlists.every(isSafeLocalPlaylist) &&
      Array.isArray(value.favorites) &&
      value.favorites.length <= MAX_LOCAL_ROWS &&
      value.favorites.every(isSafeLocalFavorite)
    );
  }

  function validateLocalDataRequest(operation, envelope) {
    if (!isExactObject(envelope, ['action', 'payload'])) return false;
    const { action, payload } = envelope;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return false;
    }
    if (operation === 'local.data.query') {
      if (!LOCAL_DATA_QUERY_ACTIONS.has(action)) return false;
      if (['historyAnnual'].includes(action)) {
        return (
          isExactObject(payload, ['year']) &&
          isBoundedLocalInteger(payload.year, 1970, 3000)
        );
      }
      if (action === 'localTracks') return isExactObject(payload, []);
      return isExactObject(payload, []);
    }
    if (
      operation !== 'local.data.command' ||
      !LOCAL_DATA_COMMAND_ACTIONS.has(action)
    ) {
      return false;
    }
    if (action === 'playlist.create') {
      return (
        isExactObject(payload, ['name', 'playlistId', 'tracks']) &&
        isSafeLocalId(payload.playlistId) &&
        isSafeLocalText(payload.name) &&
        isSafeLocalTracks(payload.tracks)
      );
    }
    if (action === 'playlist.replace') {
      return (
        isExactObject(payload, [
          'expectedRevision',
          'name',
          'playlistId',
          'tracks',
        ]) &&
        isSafeLocalId(payload.playlistId) &&
        isBoundedLocalInteger(payload.expectedRevision, 0, MAX_PAGE_EPOCH) &&
        isSafeLocalText(payload.name) &&
        isSafeLocalTracks(payload.tracks)
      );
    }
    if (action === 'playlist.delete') {
      return (
        isExactObject(payload, ['expectedRevision', 'playlistId']) &&
        isSafeLocalId(payload.playlistId) &&
        isBoundedLocalInteger(payload.expectedRevision, 0, MAX_PAGE_EPOCH)
      );
    }
    if (action === 'playlist.reorder') {
      return (
        isExactObject(payload, ['playlistIds']) &&
        Array.isArray(payload.playlistIds) &&
        payload.playlistIds.length <= MAX_LOCAL_ROWS &&
        payload.playlistIds.every(isSafeLocalId) &&
        new Set(payload.playlistIds).size === payload.playlistIds.length
      );
    }
    if (action === 'favorite.set') {
      return (
        isExactObject(payload, ['track', 'wanted']) &&
        isSafeLocalTrack(payload.track) &&
        typeof payload.wanted === 'boolean'
      );
    }
    if (action === 'history.enable') {
      return (
        isExactObject(payload, ['enabled']) &&
        typeof payload.enabled === 'boolean'
      );
    }
    if (action === 'history.ingest') {
      return (
        isExactObject(payload, [
          'cumulativePlayedMs',
          'durationMs',
          'occurredAtMs',
          'sessionId',
          'track',
        ]) &&
        isSafeLocalId(payload.sessionId) &&
        isSafeLocalTrack(payload.track) &&
        isBoundedLocalInteger(
          payload.cumulativePlayedMs,
          0,
          MAX_PLAYBACK_DURATION_MS
        ) &&
        isBoundedLocalInteger(
          payload.durationMs,
          1,
          MAX_PLAYBACK_DURATION_MS
        ) &&
        isBoundedLocalInteger(payload.occurredAtMs, 0, Number.MAX_SAFE_INTEGER)
      );
    }
    if (
      [
        'history.clear',
        'localTracks.refresh',
        'cache.refresh',
        'saf.pickAudio',
        'saf.pickTree',
        'backup.export',
        'backup.import.pick',
      ].includes(action)
    ) {
      return isExactObject(payload, []);
    }
    if (action === 'cache.capacity') {
      return (
        isExactObject(payload, ['capacityBytes']) &&
        isBoundedLocalInteger(
          payload.capacityBytes,
          32 * 1024 * 1024,
          8 * 1024 * 1024 * 1024
        )
      );
    }
    if (action === 'localTracks.repair') {
      return (
        isExactObject(payload, ['grantReferenceId']) &&
        isSafeLocalId(payload.grantReferenceId)
      );
    }
    if (action === 'cache.directory') {
      return (
        isExactObject(payload, ['state']) &&
        ['ready', 'unavailable', 'read-only'].includes(payload.state)
      );
    }
    if (action === 'settings.update') {
      return (
        isExactObject(payload, ['language', 'theme']) &&
        /^[A-Za-z0-9._-]{1,32}$/.test(payload.theme) &&
        /^[A-Za-z0-9._-]{1,32}$/.test(payload.language)
      );
    }
    return (
      action === 'backup.import' &&
      isExactObject(payload, ['confirmed', 'mode']) &&
      ['merge', 'overwrite'].includes(payload.mode) &&
      typeof payload.confirmed === 'boolean'
    );
  }

  function cloneLocalDataPayload(value) {
    if (Array.isArray(value)) return value.map(cloneLocalDataPayload);
    if (value && typeof value === 'object') {
      return Object.keys(value).reduce(
        (copy, key) => ({ ...copy, [key]: cloneLocalDataPayload(value[key]) }),
        {}
      );
    }
    return value;
  }

  function safeLocalResponseValue(value, depth = 0) {
    if (depth > MAX_LOCAL_RESPONSE_DEPTH) return null;
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
      return Number.isSafeInteger(value) ? value : null;
    }
    if (typeof value === 'string') {
      const normalized = value.toLowerCase();
      return value.length <= MAX_LOCAL_TEXT_LENGTH &&
        !value.includes('://') &&
        !normalized.startsWith('file:') &&
        !normalized.startsWith('content:') &&
        !normalized.includes('cookie=') &&
        !normalized.includes('authorization:')
        ? value
        : null;
    }
    if (Array.isArray(value)) {
      if (value.length > MAX_LOCAL_TRACKS) return null;
      const rows = value.map((item) => safeLocalResponseValue(item, depth + 1));
      return rows.some((item) => item === null) ? null : rows;
    }
    if (!value || typeof value !== 'object') return null;
    const keys = Object.keys(value);
    if (
      keys.length > MAX_LOCAL_ROWS ||
      keys.some((key) => {
        const normalized = key.toLowerCase();
        return (
          key.length > 64 ||
          [
            'path',
            'uri',
            'url',
            'cookie',
            'header',
            'token',
            'credential',
            'contentkey',
          ].some((forbidden) => normalized.includes(forbidden))
        );
      })
    )
      return null;
    return keys.reduce((projected, key) => {
      if (projected === null) return null;
      const child = safeLocalResponseValue(value[key], depth + 1);
      return child === null && value[key] !== null
        ? null
        : { ...projected, [key]: child };
    }, {});
  }

  function normalizeSafPickerReply(result) {
    if (!isExactObject(result, ['accepted', 'status'])) {
      throw createError(
        'android-rpc-local-data-unavailable',
        'Android SAF picker is unavailable.'
      );
    }
    if (
      typeof result.accepted !== 'boolean' ||
      !['pending', 'rejected'].includes(result.status)
    ) {
      throw createError(
        'android-rpc-local-data-unavailable',
        'Android SAF picker is unavailable.'
      );
    }
    return Object.freeze({ accepted: result.accepted, status: result.status });
  }

  function normalizeLocalDataReply(result, action) {
    if (['saf.pickAudio', 'saf.pickTree'].includes(action)) {
      return normalizeSafPickerReply(result);
    }
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      throw createError(
        'android-rpc-local-data-unavailable',
        'Android local data is unavailable.'
      );
    }
    const keys = Object.keys(result).sort();
    if (
      !['data', 'ok', 'revision', 'status'].every((key) =>
        keys.includes(key)
      ) &&
      !(keys.includes('ok') && keys.includes('status'))
    ) {
      throw createError(
        'android-rpc-local-data-unavailable',
        'Android local data is unavailable.'
      );
    }
    if (
      keys.some((key) => !['ok', 'status', 'revision', 'data'].includes(key)) ||
      typeof result.ok !== 'boolean' ||
      !LOCAL_DATA_STATUSES.has(result.status) ||
      (result.revision !== undefined &&
        !isBoundedLocalInteger(result.revision, 0, MAX_PAGE_EPOCH))
    ) {
      throw createError(
        'android-rpc-local-data-unavailable',
        'Android local data is unavailable.'
      );
    }
    const data =
      result.data === undefined
        ? undefined
        : safeLocalResponseValue(result.data);
    if (result.data !== undefined && data === null && result.data !== null) {
      throw createError(
        'android-rpc-local-data-unavailable',
        'Android local data is unavailable.'
      );
    }
    if (
      action === 'localTracks' &&
      (!data ||
        !isExactObject(data, ['items']) ||
        !Array.isArray(data.items) ||
        data.items.length > MAX_LOCAL_TRACKS ||
        !data.items.every(isSafeLocalMediaTrack))
    ) {
      throw createError(
        'android-rpc-local-data-unavailable',
        'Android local data is unavailable.'
      );
    }
    return Object.freeze({
      ok: result.ok,
      status: result.status,
      ...(result.revision === undefined ? {} : { revision: result.revision }),
      ...(data === undefined ? {} : { data }),
    });
  }

  function requestLocalData(operation, action, payload, options) {
    const bridge = getBridge();
    if (!bridge || !supportsResponseEvents(bridge)) {
      return rejectedRequestHandle(
        createError(
          'android-rpc-local-data-unavailable',
          'Android local data is unavailable.'
        ),
        options && options.pageEpoch
      );
    }
    return projectTypedHandle(
      request(operation, { action, payload }, typedRequestOptions(options)),
      (result) => normalizeLocalDataReply(result, action)
    );
  }

  const localData = Object.freeze({
    query(action, payload = {}, options) {
      return requestLocalData('local.data.query', action, payload, options);
    },
    command(action, payload = {}, options) {
      return requestLocalData('local.data.command', action, payload, options);
    },
  });

  function normalizeMediaDownloadReply(result) {
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      throw createError(
        'android-rpc-media-download-unavailable',
        'Android download is unavailable.'
      );
    }
    const allowed = [
      'operationId',
      'status',
      'source',
      'providerTrackId',
      'byteCount',
      'retention',
    ];
    if (
      Object.keys(result).some((key) => !allowed.includes(key)) ||
      typeof result.status !== 'string' ||
      ![
        'queued',
        'downloading',
        'completed',
        'cancelled',
        'failed',
        'deleted',
        'cleaned',
        'not-found',
        'invalid-input',
        'storage-unavailable',
      ].includes(result.status)
    ) {
      throw createError(
        'android-rpc-media-download-unavailable',
        'Android download is unavailable.'
      );
    }
    if (
      result.operationId !== undefined &&
      !isSafeMediaDownloadOperationId(result.operationId)
    ) {
      throw createError(
        'android-rpc-media-download-unavailable',
        'Android download is unavailable.'
      );
    }
    if (
      result.source !== undefined &&
      !['bilibili', 'netease'].includes(result.source)
    ) {
      throw createError(
        'android-rpc-media-download-unavailable',
        'Android download is unavailable.'
      );
    }
    if (
      result.providerTrackId !== undefined &&
      !isSafeBvid(result.providerTrackId) &&
      !isSafeProviderTrackId(result.providerTrackId)
    ) {
      throw createError(
        'android-rpc-media-download-unavailable',
        'Android download is unavailable.'
      );
    }
    if (
      result.byteCount !== undefined &&
      (!Number.isSafeInteger(result.byteCount) || result.byteCount < 0)
    ) {
      throw createError(
        'android-rpc-media-download-unavailable',
        'Android download is unavailable.'
      );
    }
    if (
      result.retention !== undefined &&
      !isSafeMediaDownloadRetention(result.retention)
    ) {
      throw createError(
        'android-rpc-media-download-unavailable',
        'Android download is unavailable.'
      );
    }
    return Object.freeze({
      ...(result.operationId ? { operationId: result.operationId } : {}),
      status: result.status,
      ...(result.source ? { source: result.source } : {}),
      ...(result.providerTrackId
        ? { providerTrackId: result.providerTrackId }
        : {}),
      ...(result.byteCount === undefined
        ? {}
        : { byteCount: result.byteCount }),
      ...(result.retention ? { retention: result.retention } : {}),
    });
  }

  function requestMediaDownload(operation, payload, options) {
    return projectTypedHandle(
      request(operation, payload, typedRequestOptions(options)),
      normalizeMediaDownloadReply
    );
  }

  const mediaDownload = Object.freeze({
    start(operationId, descriptor, retention, options) {
      return requestMediaDownload(
        'media.download.start',
        {
          operationId,
          descriptor,
          retention,
        },
        options
      );
    },
    status(operationId, options) {
      return requestMediaDownload(
        'media.download.status',
        { operationId },
        options
      );
    },
    cancel(operationId, options) {
      return requestMediaDownload(
        'media.download.cancel',
        { operationId },
        options
      );
    },
    delete(descriptor, options) {
      return requestMediaDownload(
        'media.download.delete',
        { descriptor },
        options
      );
    },
    cleanup(options) {
      return requestMediaDownload('media.download.cleanup', {}, options);
    },
  });

  function cancelPageEpoch(pageEpoch) {
    pending.forEach((entry, requestId) => {
      if (
        entry.version === TYPED_PROTOCOL_VERSION &&
        entry.pageEpoch === pageEpoch
      ) {
        postCancellation(responseBridge, requestId, pageEpoch);
        pending.delete(requestId);
        settleTypedEntry(
          entry,
          null,
          createError(
            'android-rpc-cancelled',
            'Android typed request was cancelled.',
            {
              kind: 'cancelled',
              retryable: false,
              safeCode: 'CANCELLED',
              status: 0,
            }
          )
        );
      }
    });
  }

  function teardown() {
    Array.from(pending.entries()).forEach(([requestId, entry]) => {
      pending.delete(requestId);
      if (entry.version === TYPED_PROTOCOL_VERSION) {
        postCancellation(responseBridge, requestId, entry.pageEpoch);
        settleTypedEntry(
          entry,
          null,
          createError(
            'android-rpc-cancelled',
            'Android typed request was cancelled.',
            {
              kind: 'cancelled',
              retryable: false,
              safeCode: 'CANCELLED',
              status: 0,
            }
          )
        );
      } else {
        clearTimeout(entry.timeoutId);
        rejectPending(
          entry,
          createError(
            'android-http-cancelled',
            'Android HTTP request was cancelled.'
          )
        );
      }
    });
  }

  function isPlainPlaybackText(value) {
    return (
      typeof value === 'string' &&
      value.length <= MAX_PLAYBACK_TEXT_LENGTH &&
      !Array.from(value).some(
        (character) =>
          character === '<' ||
          character === '>' ||
          character.charCodeAt(0) < 0x20
      )
    );
  }

  function isPositiveSafeInteger(value) {
    return Number.isSafeInteger(value) && value > 0;
  }

  function isSafePlaybackHandle(value, prefix) {
    return (
      typeof value === 'string' &&
      value.length > prefix.length &&
      value.length <= 128 &&
      value.startsWith(prefix) &&
      /^[A-Za-z0-9-]+$/.test(value)
    );
  }

  function isSafePlaybackIdentity(source, providerTrackId, providerPartId) {
    if (source === 'bilibili') {
      return (
        isSafeBvid(providerTrackId) && isPositiveSafeInteger(providerPartId)
      );
    }
    if (source === 'netease') {
      return (
        isSafeProviderTrackId(providerTrackId) &&
        isPositiveSafeInteger(providerPartId)
      );
    }
    return (
      source === 'local' &&
      /^local\.track\.[a-f0-9]{64}$/.test(providerTrackId) &&
      providerPartId === 1
    );
  }

  function validatePlaybackEnvelope(envelope) {
    const expected = ['command', 'expectedRevision', 'payload'];
    if (
      !envelope ||
      typeof envelope !== 'object' ||
      Array.isArray(envelope) ||
      Object.keys(envelope).length !== expected.length ||
      !expected.every((key) =>
        Object.prototype.hasOwnProperty.call(envelope, key)
      ) ||
      !Number.isSafeInteger(envelope.expectedRevision) ||
      envelope.expectedRevision < 0 ||
      typeof envelope.command !== 'string' ||
      !envelope.payload ||
      typeof envelope.payload !== 'object' ||
      Array.isArray(envelope.payload)
    )
      return false;
    const { payload } = envelope;
    const keys = Object.keys(payload).sort();
    const exact = (values) =>
      keys.length === values.length &&
      values.every((value, index) => keys[index] === value);
    switch (envelope.command) {
      case 'prepareSelection':
        return (
          exact([
            'artist',
            'durationMs',
            'mediaKind',
            'providerPartId',
            'providerTrackId',
            'source',
            'title',
          ]) &&
          ['bilibili', 'netease', 'local'].includes(payload.source) &&
          isSafePlaybackIdentity(
            payload.source,
            payload.providerTrackId,
            payload.providerPartId
          ) &&
          isPlainPlaybackText(payload.title) &&
          isPlainPlaybackText(payload.artist) &&
          Number.isSafeInteger(payload.durationMs) &&
          payload.durationMs >= 0 &&
          payload.durationMs <= MAX_PLAYBACK_DURATION_MS &&
          payload.mediaKind === 'audio'
        );
      case 'selectPrepared':
        return (
          exact([
            'occurrenceId',
            'playWhenReady',
            'selectionAction',
            'trackHandle',
          ]) &&
          isSafePlaybackHandle(payload.trackHandle, 'track-') &&
          isSafePlaybackHandle(payload.occurrenceId, 'occ-') &&
          ['replace-current', 'enqueue-next'].includes(
            payload.selectionAction
          ) &&
          typeof payload.playWhenReady === 'boolean'
        );
      case 'seek':
        return (
          exact(['positionMs']) &&
          Number.isSafeInteger(payload.positionMs) &&
          payload.positionMs >= 0 &&
          payload.positionMs <= MAX_PLAYBACK_DURATION_MS
        );
      case 'volume':
        return (
          exact(['volumePercent']) &&
          Number.isSafeInteger(payload.volumePercent) &&
          payload.volumePercent >= 0 &&
          payload.volumePercent <= 100
        );
      case 'mute':
        return exact(['muted']) && typeof payload.muted === 'boolean';
      case 'mode':
        return (
          exact(['mode']) &&
          ['sequential', 'shuffle', 'repeat-one', 'repeat-all'].includes(
            payload.mode
          )
        );
      case 'reorder':
        return (
          exact(['occurrenceId', 'targetIndex']) &&
          isSafePlaybackHandle(payload.occurrenceId, 'occ-') &&
          Number.isSafeInteger(payload.targetIndex) &&
          payload.targetIndex >= 0
        );
      case 'remove':
      case 'retry':
        return (
          exact(['occurrenceId']) &&
          isSafePlaybackHandle(payload.occurrenceId, 'occ-')
        );
      case 'play':
      case 'pause':
      case 'previous':
      case 'next':
      case 'clear':
      case 'subscribe':
      case 'detach':
        return exact([]);
      default:
        return false;
    }
  }

  function isPlaybackSnapshotEvent(event) {
    return Boolean(
      event &&
        typeof event === 'object' &&
        !Array.isArray(event) &&
        event.version === TYPED_PROTOCOL_VERSION &&
        event.operation === 'playback.snapshot' &&
        Number.isInteger(event.pageEpoch) &&
        event.snapshot &&
        typeof event.snapshot === 'object' &&
        !Array.isArray(event.snapshot)
    );
  }

  function isSafePlaybackIdentityText(value, maxLength) {
    return (
      typeof value === 'string' &&
      value.length <= maxLength &&
      !value.includes('://') &&
      !value.toLowerCase().includes('cookie=') &&
      !value.toLowerCase().includes('authorization:') &&
      isPlainPlaybackText(value)
    );
  }

  function isSafePlaybackLyric(value) {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      !isSafePlaybackIdentityText(value.source, 32) ||
      !isSafePlaybackIdentityText(value.providerTrackId, 128) ||
      !Number.isSafeInteger(value.providerPartId) ||
      value.providerPartId < 0 ||
      !isSafePlaybackIdentityText(value.trackHandle, 128) ||
      !isSafePlaybackIdentityText(value.occurrenceId, 128) ||
      !Number.isSafeInteger(value.selectionGeneration) ||
      value.selectionGeneration < 0 ||
      !Number.isSafeInteger(value.playbackRevision) ||
      value.playbackRevision < 0 ||
      !isSafePlaybackIdentityText(value.capability, 64) ||
      !isSafePlaybackIdentityText(value.state, 32)
    ) {
      return false;
    }
    const unavailable =
      value.capability === 'unavailable' &&
      value.source === '' &&
      value.providerTrackId === '' &&
      value.providerPartId === 0 &&
      value.trackHandle === '' &&
      value.occurrenceId === '';
    if (unavailable) return true;
    return (
      ['bilibili', 'netease', 'local'].includes(value.source) &&
      isSafePlaybackIdentity(
        value.source,
        value.providerTrackId,
        value.providerPartId
      ) &&
      isSafePlaybackHandle(value.trackHandle, 'track-') &&
      isSafePlaybackHandle(value.occurrenceId, 'occ-')
    );
  }

  function isSafeAdvancedPlayback(value) {
    const fields = [
      'qualitySelection',
      'partSelection',
      'defaultRendition',
      'mv',
      'pictureInPicture',
      'audioEffects',
      'visualization',
      'loudness',
      'deepSeekTranslation',
    ];
    return (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.keys(value).sort().join('|') === fields.slice().sort().join('|') &&
      fields.every((field) => typeof value[field] === 'boolean')
    );
  }

  function isSafePlaybackSnapshot(snapshot, pageEpoch, lastRevision) {
    if (
      snapshot.version !== PLAYBACK_SNAPSHOT_VERSION ||
      snapshot.pageEpoch !== pageEpoch ||
      !Number.isSafeInteger(snapshot.revision) ||
      snapshot.revision <= lastRevision ||
      !['idle', 'resolving', 'playing', 'paused', 'error'].includes(
        snapshot.state
      ) ||
      !snapshot.metadata ||
      typeof snapshot.metadata !== 'object' ||
      !isPlainPlaybackText(snapshot.metadata.title) ||
      !isPlainPlaybackText(snapshot.metadata.artist) ||
      !Number.isSafeInteger(snapshot.durationMs) ||
      snapshot.durationMs < 0 ||
      snapshot.durationMs > MAX_PLAYBACK_DURATION_MS ||
      !Number.isSafeInteger(snapshot.positionMs) ||
      snapshot.positionMs < 0 ||
      snapshot.positionMs > MAX_PLAYBACK_DURATION_MS ||
      !Number.isSafeInteger(snapshot.volumePercent) ||
      snapshot.volumePercent < 0 ||
      snapshot.volumePercent > 100 ||
      typeof snapshot.muted !== 'boolean' ||
      !['sequential', 'shuffle', 'repeat-one', 'repeat-all'].includes(
        snapshot.mode
      ) ||
      !Array.isArray(snapshot.queue) ||
      snapshot.queue.length > 100 ||
      !snapshot.recovery ||
      typeof snapshot.recovery !== 'object'
    )
      return false;
    if (snapshot.prepared !== undefined) {
      const { prepared } = snapshot;
      if (
        !prepared ||
        typeof prepared !== 'object' ||
        Array.isArray(prepared) ||
        !isSafePlaybackHandle(prepared.trackHandle, 'track-') ||
        !isSafePlaybackHandle(prepared.occurrenceId, 'occ-')
      )
        return false;
    }
    if (snapshot.lyric !== undefined && !isSafePlaybackLyric(snapshot.lyric)) {
      return false;
    }
    if (
      snapshot.advancedPlayback !== undefined &&
      !isSafeAdvancedPlayback(snapshot.advancedPlayback)
    ) {
      return false;
    }
    return true;
  }

  function safePlaybackSnapshot(snapshot) {
    const result = {
      version: snapshot.version,
      pageEpoch: snapshot.pageEpoch,
      revision: snapshot.revision,
      state: snapshot.state,
      metadata: {
        title: snapshot.metadata.title,
        artist: snapshot.metadata.artist,
        durationMs: snapshot.durationMs,
      },
      positionMs: snapshot.positionMs,
      durationMs: snapshot.durationMs,
      volumePercent: snapshot.volumePercent,
      muted: snapshot.muted,
      mode: snapshot.mode,
      actions:
        snapshot.actions && typeof snapshot.actions === 'object'
          ? { ...snapshot.actions }
          : {},
      queue: snapshot.queue.map((entry) => ({
        occurrenceId: entry && entry.occurrenceId,
        title: entry && entry.title,
        artist: entry && entry.artist,
        durationMs: entry && entry.durationMs,
      })),
      recovery: {
        status:
          typeof snapshot.recovery.status === 'string'
            ? snapshot.recovery.status
            : 'unknown',
        retryable: snapshot.recovery.retryable === true,
      },
    };
    if (snapshot.prepared) {
      result.prepared = {
        trackHandle: snapshot.prepared.trackHandle,
        occurrenceId: snapshot.prepared.occurrenceId,
      };
    }
    if (snapshot.lyric !== undefined) {
      result.lyric = { ...snapshot.lyric };
    }
    if (snapshot.advancedPlayback !== undefined) {
      result.advancedPlayback = { ...snapshot.advancedPlayback };
    }
    return Object.freeze(result);
  }

  function acceptPlaybackSnapshot(event) {
    if (
      playback.detached ||
      event.pageEpoch !== playback.pageEpoch ||
      !isSafePlaybackSnapshot(
        event.snapshot,
        playback.pageEpoch,
        playback.revision
      )
    )
      return;
    playback.revision = event.snapshot.revision;
    playback.snapshot = safePlaybackSnapshot(event.snapshot);
    if (typeof playback.onSnapshot === 'function') {
      playback.onSnapshot(playback.snapshot);
      scheduleAngularDigest();
    }
  }

  function playbackError(code) {
    return createError(
      code,
      'Android playback command could not be completed.'
    );
  }

  function requestPlayback(command, payload, options = {}) {
    if (playback.detached || !Number.isInteger(playback.pageEpoch)) {
      return Promise.reject(playbackError('android-playback-unavailable'));
    }
    if (playback.pendingCommands.has(command)) {
      return Promise.reject(playbackError('android-playback-pending'));
    }
    const expectedRevision = playback.revision;
    const envelope = { expectedRevision, command, payload };
    if (!validatePlaybackEnvelope(envelope)) {
      return Promise.reject(playbackError('android-playback-invalid-command'));
    }
    const requestHandle = request('playback.command', envelope, {
      pageEpoch: playback.pageEpoch,
      timeoutMs: options.timeoutMs,
    });
    const promise = requestHandle.promise
      .then(({ result }) => {
        const targetRevision = result && result.revision;
        if (
          !Number.isSafeInteger(targetRevision) ||
          targetRevision <= expectedRevision
        ) {
          throw playbackError('android-playback-rejected');
        }
        return new Promise((resolve, reject) => {
          const awaitSnapshot = () => {
            if (playback.detached) {
              reject(playbackError('android-playback-cancelled'));
            } else if (playback.revision >= targetRevision) {
              resolve(playback.snapshot);
            } else {
              setTimeout(awaitSnapshot, 0);
            }
          };
          awaitSnapshot();
        });
      })
      .catch((error) => {
        if (error && error.code === 'android-rpc-cancelled') {
          throw playbackError('android-playback-cancelled');
        }
        throw playbackError('android-playback-rejected');
      })
      .finally(() => playback.pendingCommands.delete(command));
    playback.pendingCommands.set(command, requestHandle);
    return promise;
  }

  function detachPlayback() {
    playback.pendingCommands.forEach((handle) => handle.cancel());
    playback.pendingCommands.clear();
    playback.issuedPrepared = new WeakSet();
    playback.detached = true;
    playback.pageEpoch = null;
    playback.revision = 0;
    playback.snapshot = null;
    playback.onSnapshot = null;
  }

  function connectPlayback(options = {}) {
    if (
      !Number.isInteger(options.pageEpoch) ||
      options.pageEpoch < 0 ||
      options.pageEpoch > MAX_PAGE_EPOCH
    ) {
      return {
        promise: Promise.reject(
          playbackError('android-playback-invalid-epoch')
        ),
        cancel() {},
      };
    }
    const bridge = getBridge();
    if (!bridge || !ensureResponseListener(bridge)) {
      return {
        promise: Promise.reject(playbackError('android-playback-unavailable')),
        cancel() {},
      };
    }
    if (!playback.detached && playback.pageEpoch === options.pageEpoch) {
      return { promise: Promise.resolve(playback.snapshot), cancel() {} };
    }
    detachPlayback();
    playback.pageEpoch = options.pageEpoch;
    playback.revision = 0;
    playback.snapshot = null;
    playback.onSnapshot =
      typeof options.onSnapshot === 'function' ? options.onSnapshot : null;
    playback.detached = false;
    return {
      promise: requestPlayback('subscribe', {}, options),
      cancel: detachPlayback,
    };
  }

  function normalizeSelection(selection) {
    const semanticFields = [
      'artist',
      'durationMs',
      'mediaKind',
      'providerPartId',
      'providerTrackId',
      'source',
      'title',
    ];
    const legacyBilibiliFields = [
      'artist',
      'bvid',
      'cid',
      'durationMs',
      'mediaKind',
      'source',
      'title',
    ];
    const fields = selection && Object.keys(selection).sort();
    const hasExactFields = (expected) =>
      fields &&
      fields.length === expected.length &&
      expected.every((key) => fields.includes(key));
    if (
      !selection ||
      typeof selection !== 'object' ||
      Array.isArray(selection) ||
      (!hasExactFields(semanticFields) && !hasExactFields(legacyBilibiliFields))
    )
      return null;
    const payload = {
      source: selection.source,
      providerTrackId: selection.providerTrackId || selection.bvid,
      providerPartId: selection.providerPartId || selection.cid,
      title:
        typeof selection.title === 'string'
          ? selection.title.trim()
          : selection.title,
      artist:
        typeof selection.artist === 'string'
          ? selection.artist.trim()
          : selection.artist,
      durationMs: selection.durationMs,
      mediaKind: selection.mediaKind,
    };
    return validatePlaybackEnvelope({
      expectedRevision: 0,
      command: 'prepareSelection',
      payload,
    })
      ? payload
      : null;
  }

  function preparePlaybackSelection(selection, options) {
    const payload = normalizeSelection(selection);
    if (!payload)
      return Promise.reject(
        playbackError('android-playback-invalid-selection')
      );
    return requestPlayback('prepareSelection', payload, options).then(
      (snapshot) => {
        const prepared = snapshot && snapshot.prepared;
        if (!prepared) throw playbackError('android-playback-rejected');
        const trusted = Object.freeze({
          trackHandle: prepared.trackHandle,
          occurrenceId: prepared.occurrenceId,
          expectedRevision: snapshot.revision,
        });
        playback.issuedPrepared.add(trusted);
        return trusted;
      }
    );
  }

  function selectPlaybackPrepared(prepared, options = {}) {
    if (
      !prepared ||
      typeof prepared !== 'object' ||
      !playback.issuedPrepared.has(prepared)
    ) {
      return Promise.reject(playbackError('android-playback-invalid-prepared'));
    }
    playback.issuedPrepared.delete(prepared);
    return requestPlayback(
      'selectPrepared',
      {
        trackHandle: prepared.trackHandle,
        occurrenceId: prepared.occurrenceId,
        selectionAction: options.action || 'replace-current',
        playWhenReady: options.playWhenReady === true,
      },
      options
    );
  }

  function get(url, options = {}) {
    const bridge = getBridge();
    if (!bridge || !ensureResponseListener(bridge)) {
      return Promise.reject(
        createError(
          'android-http-unavailable',
          'Android HTTP is not supported in this environment.'
        )
      );
    }
    if (!validateUrl(url)) {
      return Promise.reject(
        createError(
          'android-http-invalid-url',
          'Android HTTP requires a valid HTTPS URL.'
        )
      );
    }
    const timeoutMs = Math.min(
      MAX_TIMEOUT_MS,
      Math.max(
        1,
        Number.isFinite(options.timeoutMs)
          ? Math.floor(options.timeoutMs)
          : DEFAULT_TIMEOUT_MS
      )
    );
    const requestId = createRequestId();
    const envelope = JSON.stringify({
      version: PROTOCOL_VERSION,
      requestId,
      method: 'GET',
      url,
    });

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        if (!pending.has(requestId)) return;
        pending.delete(requestId);
        rejectPending(
          { reject },
          createError('android-http-timeout', 'Android HTTP request timed out.')
        );
      }, timeoutMs);
      pending.set(requestId, { resolve, reject, timeoutId });
      try {
        bridge.postMessage(envelope);
      } catch (error) {
        pending.delete(requestId);
        clearTimeout(timeoutId);
        rejectPending(
          { reject },
          createError(
            'android-http-post-failed',
            'Android HTTP request could not be sent.'
          )
        );
      }
    });
  }

  return {
    isAvailable() {
      const bridge = getBridge();
      return Boolean(bridge && supportsResponseEvents(bridge));
    },
    get,
    request,
    getProviderCapabilities,
    getDeepSeekTranslationCapability,
    startProviderCapabilities,
    refreshProviderCapabilities,
    onProviderCapabilities,
    account,
    localData,
    mediaDownload,
    deepSeek,
    cancelPageEpoch,
    teardown,
    connect: connectPlayback,
    subscribe: connectPlayback,
    prepareSelection: preparePlaybackSelection,
    selectPrepared: selectPlaybackPrepared,
    command(command, payload, options) {
      return requestPlayback(command, payload || {}, options);
    },
    detach: detachPlayback,
    isPlaybackReady() {
      return !playback.detached && playback.snapshot !== null;
    },
    getPlaybackSnapshot() {
      return playback.snapshot;
    },
  };
})();

if (typeof window !== 'undefined') {
  window.Listen2AndroidHttpAdapter = Listen2AndroidHttpAdapter;
}
