/* global isElectron require */
/* eslint-disable no-param-reassign, global-require, import/no-extraneous-dependencies */
/* eslint-disable no-use-before-define, no-loop-func, no-continue */
// The queue and its completion callback intentionally share the active count.
(function lyricHttpModule(root) {
  function failureDetails(value) {
    const safe = {};
    if (!value || typeof value !== 'object') return safe;
    if (
      [
        'rate-limited',
        'service-busy',
        'connection-failed',
        'netease-unexpected-result',
      ].includes(value.reason)
    )
      safe.reason = value.reason;
    if (
      Number.isInteger(value.httpStatus) &&
      value.httpStatus >= 200 &&
      value.httpStatus <= 599
    )
      safe.httpStatus = value.httpStatus;
    if (Number.isSafeInteger(value.retryAfterMs) && value.retryAfterMs >= 0)
      safe.retryAfterMs = value.retryAfterMs;
    if (['dns', 'connect', 'tls', 'response'].includes(value.networkStage))
      safe.networkStage = value.networkStage;
    if (
      [
        'ECONNRESET',
        'ECONNREFUSED',
        'EHOSTUNREACH',
        'ENETUNREACH',
        'ETIMEDOUT',
        'ENOTFOUND',
        'EAI_AGAIN',
        'EPIPE',
        'ERR_STREAM_PREMATURE_CLOSE',
        'ERR_TLS_CERT_ALTNAME_INVALID',
        'CERT_HAS_EXPIRED',
        'CERT_NOT_YET_VALID',
        'DEPTH_ZERO_SELF_SIGNED_CERT',
        'SELF_SIGNED_CERT_IN_CHAIN',
        'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
        'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
        'ERR_SSL_WRONG_VERSION_NUMBER',
        'ERR_SSL_TLSV1_ALERT_PROTOCOL_VERSION',
      ].includes(value.networkCode)
    )
      safe.networkCode = value.networkCode;
    if (value.attempts === 1 || value.attempts === 2)
      safe.attempts = value.attempts;
    return safe;
  }
  let sequence = 0;
  const pending = [];
  let active = 0;
  function pump() {
    while (active < 3 && pending.length) {
      const job = pending.shift();
      if (job.options.signal && job.options.signal.aborted) {
        job.reject(
          Object.assign(new Error('Cancelled'), { name: 'AbortError' })
        );
        continue;
      }
      if (job.options.signal)
        job.options.signal.removeEventListener('abort', job.cancelQueued);
      active += 1;
      send(job.url, job.options)
        .then(job.resolve, job.reject)
        .finally(() => {
          active -= 1;
          pump();
        });
    }
  }
  root.Listen2LyricHttp = {
    get(url, options = {}) {
      return new Promise((resolve, reject) => {
        const job = { url, options, resolve, reject };
        job.cancelQueued = () => {
          const index = pending.indexOf(job);
          if (index !== -1) pending.splice(index, 1);
          if (options.signal)
            options.signal.removeEventListener('abort', job.cancelQueued);
          reject(Object.assign(new Error('Cancelled'), { name: 'AbortError' }));
        };
        if (options.signal && options.signal.aborted) {
          job.cancelQueued();
          return;
        }
        pending.push(job);
        if (options.signal)
          options.signal.addEventListener('abort', job.cancelQueued, {
            once: true,
          });
        pump();
      });
    },
  };
  function send(url, options) {
    if (typeof isElectron !== 'function' || !isElectron())
      return axios.get(url, options);
    const { ipcRenderer } = require('electron');
    sequence += 1;
    const id = `lyric-${Date.now()}-${sequence}`;
    if (options.signal && options.signal.aborted)
      return Promise.reject(
        Object.assign(new Error('Cancelled'), { name: 'AbortError' })
      );
    let cancel;
    const promise = new Promise((resolve, reject) => {
      cancel = () => {
        ipcRenderer.send('lyrics:cancel', id);
        reject(Object.assign(new Error('Cancelled'), { name: 'AbortError' }));
      };
      if (options.signal)
        options.signal.addEventListener('abort', cancel, { once: true });
      Promise.resolve(ipcRenderer.invoke('lyrics:request', { id, url })).then(
        resolve,
        reject
      );
      if (options.signal && options.signal.aborted) cancel();
    });
    return promise
      .then((result) => {
        if (options.signal && options.signal.aborted)
          throw Object.assign(new Error('Cancelled'), { name: 'AbortError' });
        if (!result.ok)
          throw Object.assign(new Error(result.status), {
            code: result.status === 'timeout' ? 'ETIMEDOUT' : result.status,
            ...failureDetails(result),
          });
        return { data: result.data };
      })
      .finally(() => {
        if (options.signal) options.signal.removeEventListener('abort', cancel);
      });
  }
})(window);
