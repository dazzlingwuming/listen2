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
  const MAX_PAGE_EPOCH = 2147483647;
  const pending = new Map();
  let requestSequence = 0;
  let responseBridge = null;

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

  function handleResponse(event) {
    const response = normalizeEventData(event);
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
      clearTimeout(entry.timeoutId);
      if (response.terminal !== 'ok') {
        rejectPending(
          entry,
          createError(
            response.terminal === 'cancelled'
              ? 'android-rpc-cancelled'
              : 'android-rpc-failed',
            'Android typed request could not be completed.',
            { status: response.status, safeCode: response.error }
          )
        );
        return;
      }
      resolvePending(entry, {
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

  function validateTypedRequest(operation, payload, pageEpoch) {
    if (operation !== 'bilibili.search') return 'android-rpc-invalid-operation';
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

  function request(operation, payload, options = {}) {
    const bridge = getBridge();
    if (!bridge || !ensureResponseListener(bridge)) {
      return Promise.reject(
        createError(
          'android-rpc-unavailable',
          'Android typed requests are not supported in this environment.'
        )
      );
    }
    const {pageEpoch} = options;
    const validationError = validateTypedRequest(operation, payload, pageEpoch);
    if (validationError) {
      return Promise.reject(
        createError(
          validationError,
          'Android typed request was rejected before dispatch.'
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
      version: TYPED_PROTOCOL_VERSION,
      operation,
      requestId,
      pageEpoch,
      payload: { keyword: payload.keyword.trim(), page: payload.page },
    });
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        const entry = pending.get(requestId);
        if (!entry) return;
        pending.delete(requestId);
        rejectPending(
          entry,
          createError('android-rpc-timeout', 'Android typed request timed out.')
        );
      }, timeoutMs);
      const entry = {
        resolve,
        reject,
        timeoutId,
        version: TYPED_PROTOCOL_VERSION,
        pageEpoch,
      };
      pending.set(requestId, entry);
      try {
        bridge.postMessage(envelope);
      } catch (error) {
        pending.delete(requestId);
        clearTimeout(timeoutId);
        rejectPending(
          entry,
          createError(
            'android-rpc-post-failed',
            'Android typed request could not be sent.'
          )
        );
      }
    });
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
  };
})();

if (typeof window !== 'undefined') {
  window.Listen2AndroidHttpAdapter = Listen2AndroidHttpAdapter;
}
