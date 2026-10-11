/* global isElectron require */
/* eslint-disable no-param-reassign, global-require, import/no-extraneous-dependencies */
/* eslint-disable no-use-before-define, no-loop-func, no-continue */
// The queue and its completion callback intentionally share the active count.
(function lyricHttpModule(root) {
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
        pending.push({ url, options, resolve, reject });
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
    const cancel = () => ipcRenderer.send('lyrics:cancel', id);
    if (options.signal && options.signal.aborted)
      return Promise.reject(
        Object.assign(new Error('Cancelled'), { name: 'AbortError' })
      );
    const promise = ipcRenderer.invoke('lyrics:request', { id, url });
    if (options.signal)
      options.signal.addEventListener('abort', cancel, { once: true });
    return promise
      .then((result) => {
        if (!result.ok)
          throw Object.assign(new Error(result.status), {
            code: result.status === 'timeout' ? 'ETIMEDOUT' : result.status,
          });
        return { data: result.data };
      })
      .finally(() => {
        if (options.signal) options.signal.removeEventListener('abort', cancel);
      });
  }
})(window);
