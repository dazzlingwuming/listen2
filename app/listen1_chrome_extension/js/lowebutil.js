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
  const MAX_LYRIC_OFFSET_MS = 30000;
  const MAX_PAGE_EPOCH = 2147483647;
  const MAX_PLAYBACK_TEXT_LENGTH = 256;
  const MAX_PLAYBACK_DURATION_MS = 28800000;
  const PLAYBACK_SNAPSHOT_VERSION = 1;
  const pending = new Map();
  let requestSequence = 0;
  let responseBridge = null;
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
      PROVIDER_STATUS: 'android-rpc-provider-status',
      NETEASE_ROUTE_UNAVAILABLE: 'android-rpc-unavailable-route',
      LYRIC_PERSISTENCE_UNAVAILABLE:
        'android-rpc-lyric-persistence-unavailable',
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
        'bilibili.video.detail',
        'bilibili.audio.manifest',
        'netease.search',
        'netease.directory.detail',
        'netease.rendition.default',
        'netease.lyric.primary',
        'netease.lyric.search',
        'lyric.selection.get',
        'lyric.selection.set',
        'lyric.selection.clear',
        'lyric.offset.set',
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
    if (operation === 'playback.command') {
      // eslint-disable-next-line no-use-before-define
      return validatePlaybackEnvelope(payload)
        ? null
        : 'android-rpc-invalid-payload';
    }
    const keys = Object.keys(payload).sort();
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
    const explicit = payload.selectionMode === 'explicit';
    const expected = explicit
      ? ['bvid', 'cid', 'selectionMode']
      : ['bvid', 'selectionMode'];
    if (
      keys.length !== expected.length ||
      keys.some((key, index) => key !== expected[index]) ||
      !isSafeBvid(payload.bvid) ||
      !['default-first', 'explicit'].includes(payload.selectionMode) ||
      (explicit && (!Number.isSafeInteger(payload.cid) || payload.cid <= 0))
    ) {
      return 'android-rpc-invalid-payload';
    }
    return null;
  }

  function normalizedTypedPayload(operation, payload) {
    if (operation === 'playback.command') {
      return {
        expectedRevision: payload.expectedRevision,
        command: payload.command,
        payload: { ...payload.payload },
      };
    }
    if (operation === 'bilibili.search' || operation === 'netease.search') {
      return { keyword: payload.keyword.trim(), page: payload.page };
    }
    if (operation === 'bilibili.video.detail') {
      return { bvid: payload.bvid };
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
    return payload.selectionMode === 'explicit'
      ? { bvid: payload.bvid, selectionMode: 'explicit', cid: payload.cid }
      : { bvid: payload.bvid, selectionMode: 'default-first' };
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
          payload.source === 'bilibili' &&
          isSafeBvid(payload.providerTrackId) &&
          isPositiveSafeInteger(payload.providerPartId) &&
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
    const expected = [
      'artist',
      'bvid',
      'cid',
      'durationMs',
      'mediaKind',
      'source',
      'title',
    ];
    if (
      !selection ||
      typeof selection !== 'object' ||
      Array.isArray(selection) ||
      Object.keys(selection).length !== expected.length ||
      !expected.every((key) =>
        Object.prototype.hasOwnProperty.call(selection, key)
      )
    )
      return null;
    const payload = {
      source: selection.source,
      providerTrackId: selection.bvid,
      providerPartId: selection.cid,
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
