/* global module globalThis */
/* eslint-disable no-use-before-define */
(function registerMobileProviderRegistry(root) {
  const CAPABILITY_FIELDS = [
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
  const OPERATIONS = ['search', 'directory', 'media', 'lyric', 'login'];
  const SAFE_CODES = [
    'OPERATION_UNAVAILABLE',
    'CANCELLED',
    'DEADLINE_EXCEEDED',
    'INVALID_REQUEST',
    'INVALID_RESPONSE',
    'PROVIDER_ERROR',
  ];
  const PREFIXES = {
    netease: /^netrack_[1-9][0-9]{0,17}$/,
    kugou: /^kgtrack_[A-Za-z0-9_-]{1,256}$/,
    kuwo: /^kwtrack_[1-9][0-9]{0,17}$/,
    qq: /^qqtrack_[A-Za-z0-9_-]{1,256}$/,
    bilibili:
      /^(?:bitrack_[1-9][0-9]{0,17}|bitrack_v_BV[0-9A-Za-z]{10}-[1-9][0-9]{0,18})$/,
  };

  function freezeSource(source) {
    return Object.freeze({
      ...source,
      identityVariants: Object.freeze(source.identityVariants.slice()),
    });
  }

  const REGISTRY_SOURCES = Object.freeze([
    freezeSource({
      id: 'netease',
      displayName: '网易云音乐',
      displayId: '_NETEASE_MUSIC',
      primary: true,
      identityVariants: ['audio'],
    }),
    freezeSource({
      id: 'kugou',
      displayName: '酷狗音乐',
      displayId: '_KUGOU_MUSIC',
      primary: true,
      identityVariants: ['audio'],
    }),
    freezeSource({
      id: 'kuwo',
      displayName: '酷我音乐',
      displayId: '_KUWO_MUSIC',
      primary: true,
      identityVariants: ['audio'],
    }),
    freezeSource({
      id: 'qq',
      displayName: 'QQ 音乐',
      displayId: '_QQ_MUSIC',
      primary: true,
      identityVariants: ['audio'],
    }),
    freezeSource({
      id: 'bilibili',
      displayName: '哔哩哔哩',
      displayId: '_BILIBILI_MUSIC',
      primary: true,
      identityVariants: ['audio', 'video-part'],
    }),
    freezeSource({
      id: 'migu',
      displayName: '咪咕音乐',
      displayId: '_MIGU_MUSIC',
      primary: false,
      identityVariants: [],
    }),
    freezeSource({
      id: 'taihe',
      displayName: '千千音乐',
      displayId: '_TAIHE_MUSIC',
      primary: false,
      identityVariants: [],
    }),
  ]);
  const PRIMARY_SOURCES = Object.freeze(
    REGISTRY_SOURCES.filter((source) => source.primary)
  );
  const DESKTOP_SOURCE_ORDER = Object.freeze([
    'netease',
    'qq',
    'kugou',
    'kuwo',
    'bilibili',
    'migu',
    'taihe',
  ]);
  const SOURCE_BY_ID = Object.freeze(
    REGISTRY_SOURCES.reduce(
      (result, source) => ({ ...result, [source.id]: source }),
      {}
    )
  );
  const DESKTOP_SOURCES = Object.freeze(
    DESKTOP_SOURCE_ORDER.map((sourceId) => SOURCE_BY_ID[sourceId])
  );

  function descriptorFor(sourceId) {
    return SOURCE_BY_ID[sourceId] || null;
  }

  function sourceForItemId(itemId) {
    if (
      typeof itemId !== 'string' ||
      itemId.length === 0 ||
      itemId.length > 512
    )
      return null;
    return PRIMARY_SOURCES.reduce(
      (matched, source) =>
        matched || (PREFIXES[source.id].test(itemId) ? source.id : null),
      null
    );
  }

  function toTrackIdentity(sourceId, itemId, variant) {
    const source = descriptorFor(sourceId);
    if (!source || !source.primary || sourceForItemId(itemId) !== sourceId)
      return null;
    const identityVariant = typeof variant === 'string' ? variant : 'audio';
    if (!source.identityVariants.includes(identityVariant)) return null;
    if (sourceId === 'bilibili') {
      const videoPart = itemId.indexOf('bitrack_v_') === 0;
      if (
        (videoPart && identityVariant !== 'video-part') ||
        (!videoPart && identityVariant !== 'audio')
      )
        return null;
    }
    return Object.freeze({ sourceId, itemId, variant: identityVariant });
  }

  function safeReason(source, capabilityValues) {
    if (!source || !source.primary) return '此音乐来源暂不可用。';
    if (!CAPABILITY_FIELDS.some((field) => capabilityValues[field] === true))
      return '此音乐来源尚未在此 Android 设备上启用。';
    return '';
  }

  function projectCapabilities(sourceId, nativeMatrix, capabilityEpoch) {
    const source = descriptorFor(sourceId);
    const nativeValue =
      nativeMatrix &&
      typeof nativeMatrix === 'object' &&
      !Array.isArray(nativeMatrix)
        ? nativeMatrix[sourceId]
        : null;
    const nativeCapabilities =
      nativeValue &&
      typeof nativeValue === 'object' &&
      !Array.isArray(nativeValue)
        ? nativeValue
        : {};
    const values = CAPABILITY_FIELDS.reduce(
      (result, field) => ({
        ...result,
        [field]: Boolean(
          source && source.primary && nativeCapabilities[field] === true
        ),
      }),
      {}
    );
    const available = Boolean(
      source &&
        source.primary &&
        CAPABILITY_FIELDS.some((field) => values[field])
    );
    return Object.freeze({
      sourceId: source ? source.id : String(sourceId || ''),
      displayName: source ? source.displayName : '未知音乐来源',
      primary: Boolean(source && source.primary),
      availability: available ? 'available' : 'unavailable',
      accountRequired: false,
      accountState: 'unknown',
      retryable: false,
      safeReason: safeReason(source, values),
      identityVariants: Object.freeze(
        source ? source.identityVariants.slice() : []
      ),
      capabilityEpoch:
        Number.isSafeInteger(capabilityEpoch) && capabilityEpoch >= 0
          ? capabilityEpoch
          : 0,
      ...values,
    });
  }

  function projectCapabilityMatrix(nativeMatrix, capabilityEpoch) {
    return Object.freeze(
      REGISTRY_SOURCES.reduce(
        (result, source) => ({
          ...result,
          [source.id]: projectCapabilities(
            source.id,
            nativeMatrix,
            capabilityEpoch
          ),
        }),
        {}
      )
    );
  }

  function byteLength(value) {
    return typeof TextEncoder !== 'undefined'
      ? new TextEncoder().encode(value).length
      : unescape(encodeURIComponent(value)).length;
  }

  function isPlainObject(value) {
    return (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype
    );
  }

  function hasExactKeys(value, allowed) {
    return (
      isPlainObject(value) &&
      Object.keys(value).every((key) => allowed.includes(key))
    );
  }

  function validText(value, maximum) {
    return (
      typeof value === 'string' &&
      value.length <= maximum &&
      value.indexOf('\0') === -1
    );
  }

  function validPayload(operation, payload) {
    let allowed = [];
    if (operation === 'search') allowed = ['keyword', 'page'];
    if (operation === 'directory') allowed = ['id', 'page'];
    if (operation === 'media') allowed = ['itemId', 'variant'];
    if (operation === 'lyric') allowed = ['itemId'];
    if (!hasExactKeys(payload, allowed)) return false;
    if (operation === 'search')
      return (
        validText(payload.keyword, 512) &&
        byteLength(payload.keyword) <= 256 &&
        Number.isInteger(payload.page) &&
        payload.page >= 1 &&
        payload.page <= 1000
      );
    if (operation === 'directory')
      return (
        (!Object.prototype.hasOwnProperty.call(payload, 'id') ||
          validText(payload.id, 512)) &&
        (!Object.prototype.hasOwnProperty.call(payload, 'page') ||
          (Number.isInteger(payload.page) &&
            payload.page >= 1 &&
            payload.page <= 1000))
      );
    if (operation === 'media')
      return (
        validText(payload.itemId, 512) &&
        (!Object.prototype.hasOwnProperty.call(payload, 'variant') ||
          validText(payload.variant, 64))
      );
    if (operation === 'lyric') return validText(payload.itemId, 512);
    return true;
  }

  function validResult(operation, result) {
    if (!isPlainObject(result)) return false;
    if (operation === 'search') {
      return (
        hasExactKeys(result, ['rows']) &&
        Array.isArray(result.rows) &&
        result.rows.length <= 50 &&
        result.rows.every(
          (row) =>
            hasExactKeys(row, ['sourceId', 'itemId', 'title', 'artist']) &&
            validText(row.sourceId, 64) &&
            validText(row.itemId, 512) &&
            validText(row.title, 512) &&
            validText(row.artist, 512)
        )
      );
    }
    if (operation === 'lyric')
      return (
        hasExactKeys(result, ['content']) &&
        validText(result.content, 262144) &&
        byteLength(result.content) <= 262144
      );
    return hasExactKeys(result, []);
  }

  function createTerminal(request, terminal, code, result) {
    return Object.freeze({
      operation: request.operation,
      sourceId: request.sourceId,
      requestId: request.requestId,
      pageEpoch: request.pageEpoch,
      terminal,
      status: terminal === 'ok' ? 'ok' : terminal,
      code: terminal === 'ok' ? null : code,
      result: terminal === 'ok' ? result : null,
    });
  }

  function createSemanticOperationLifecycle(options) {
    const settings = options || {};
    const now =
      typeof settings.now === 'function' ? settings.now : () => Date.now();
    const setTimer =
      typeof settings.setTimeout === 'function'
        ? settings.setTimeout
        : setTimeout;
    const clearTimer =
      typeof settings.clearTimeout === 'function'
        ? settings.clearTimeout
        : clearTimeout;
    let generatedId = 0;
    const createRequestId =
      typeof settings.createRequestId === 'function'
        ? settings.createRequestId
        : () => {
            generatedId += 1;
            return `semantic-${generatedId}-${now().toString(36)}`;
          };
    const active = new Set();

    function start(input) {
      const value = input || {};
      const { operation } = value;
      const { sourceId } = value;
      const { pageEpoch } = value;
      const { deadlineMs } = value;
      const { payload } = value;
      const valid =
        OPERATIONS.includes(operation) &&
        descriptorFor(sourceId) &&
        Number.isSafeInteger(pageEpoch) &&
        pageEpoch >= 0 &&
        pageEpoch <= 2147483647 &&
        Number.isSafeInteger(deadlineMs) &&
        deadlineMs >= 1 &&
        deadlineMs <= 30000 &&
        validPayload(operation, payload);
      const request = Object.freeze({
        operation: valid ? operation : 'search',
        sourceId: valid ? sourceId : '',
        requestId: String(createRequestId()).slice(0, 128),
        pageEpoch: valid ? pageEpoch : 0,
        deadlineAt: now() + (valid ? deadlineMs : 1),
        payload: valid ? Object.freeze({ ...payload }) : Object.freeze({}),
      });
      let resolve;
      const promise = new Promise((done) => {
        resolve = done;
      });
      const handle = {
        request,
        promise,
        terminal: null,
        ignoredReplies: 0,
        cancel: null,
      };
      let timer = null;
      const settle = (terminal) => {
        if (handle.terminal) {
          handle.ignoredReplies += 1;
          return false;
        }
        handle.terminal = terminal;
        active.delete(handle);
        if (timer) clearTimer(timer);
        resolve(terminal);
        return true;
      };
      const unavailable =
        !valid ||
        !value.capabilities ||
        value.capabilities[operation] !== true ||
        typeof value.executor !== 'function';
      if (unavailable) {
        settle(
          createTerminal(request, 'unavailable', 'OPERATION_UNAVAILABLE', null)
        );
        return handle;
      }
      active.add(handle);
      handle.cancel = () =>
        settle(createTerminal(request, 'cancelled', 'CANCELLED', null));
      timer = setTimer(
        () =>
          settle(createTerminal(request, 'timeout', 'DEADLINE_EXCEEDED', null)),
        deadlineMs
      );
      const accept = (reply) => {
        if (
          !isPlainObject(reply) ||
          reply.operation !== request.operation ||
          reply.sourceId !== request.sourceId ||
          reply.requestId !== request.requestId ||
          reply.pageEpoch !== request.pageEpoch
        ) {
          handle.ignoredReplies += 1;
          return false;
        }
        if (
          reply.terminal === 'ok' &&
          reply.status === 'ok' &&
          reply.code === null &&
          validResult(operation, reply.result)
        )
          return settle(
            createTerminal(
              request,
              'ok',
              null,
              Object.freeze({ ...reply.result })
            )
          );
        if (
          ['cancelled', 'timeout', 'error', 'unavailable'].includes(
            reply.terminal
          ) &&
          reply.result === null &&
          SAFE_CODES.includes(reply.code)
        )
          return settle(
            createTerminal(request, reply.terminal, reply.code, null)
          );
        return settle(
          createTerminal(request, 'error', 'INVALID_RESPONSE', null)
        );
      };
      try {
        const cancellation = value.executor(request, accept);
        if (typeof cancellation === 'function') {
          const { cancel } = handle;
          handle.cancel = () => {
            try {
              cancellation();
            } catch (error) {
              // Cancellation is best-effort; the lifecycle still owns settlement.
            }
            return cancel();
          };
        }
      } catch (error) {
        settle(createTerminal(request, 'error', 'PROVIDER_ERROR', null));
      }
      return handle;
    }

    function destroy(pageEpoch) {
      active.forEach((handle) => {
        if (handle.request.pageEpoch === pageEpoch) handle.cancel();
      });
    }

    return Object.freeze({ start, destroy });
  }

  const registry = Object.freeze({
    registrySources: REGISTRY_SOURCES,
    primarySources: PRIMARY_SOURCES,
    desktopSources: DESKTOP_SOURCES,
    desktopSourceOrder: DESKTOP_SOURCE_ORDER,
    descriptorFor,
    sourceForItemId,
    toTrackIdentity,
    projectCapabilities,
    projectCapabilityMatrix,
    createSemanticOperationLifecycle,
  });
  const host = root;
  host.MobileProviderRegistry = registry;
  if (typeof module !== 'undefined' && module.exports)
    module.exports = registry;
})(typeof window !== 'undefined' ? window : globalThis);
