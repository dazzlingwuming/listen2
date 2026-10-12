/* global module globalThis */
/* eslint-disable no-param-reassign, no-await-in-loop */
// Each worker awaits its own provider; the three workers run concurrently.
(function lyricSearchModule(root) {
  // Each consumer owns cancellation. Provider HTTP calls share this signal only
  // within that search; automatic lookup caches never hold cancelled requests.
  const cache = new Map();
  function classify(error) {
    if (
      error &&
      (error.name === 'AbortError' ||
        error.code === 'ETIMEDOUT' ||
        error.code === 'ECONNABORTED')
    )
      return 'timeout';
    if (error && /invalid|format|payload/i.test(error.message || ''))
      return 'invalid-response';
    return 'unavailable';
  }
  function search(providers, query, options = {}) {
    const controller = new AbortController();
    const states = providers.map((p) => ({
      source: p.id,
      status: 'loading',
      count: 0,
    }));
    const candidates = new Map();
    const started = Date.now();
    let next = 0;
    let finished = false;
    let resolveFinal;
    let timer;
    const snapshot = () => ({
      candidates: Array.from(candidates.values()),
      sources: states.map((s) => ({ ...s })),
      pending: states.some((s) => s.status === 'loading'),
    });
    function publish() {
      const value = snapshot();
      if (options.onUpdate) options.onUpdate(value);
      return value;
    }
    function finish(cancelled = false) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      states.forEach((s) => {
        if (s.status === 'loading') {
          s.status = cancelled ? 'cancelled' : 'timeout';
          s.elapsedMs = Date.now() - started;
        }
      });
      controller.abort();
      const value = cancelled ? snapshot() : publish();
      resolveFinal(value);
    }
    async function worker() {
      while (!finished && next < providers.length) {
        const index = next;
        next += 1;
        const provider = providers[index];
        const state = states[index];
        const key = `${provider.id}:${query.trim().toLocaleLowerCase()}:${
          provider.cacheKey || ''
        }`;
        const time = Date.now();
        try {
          const saved = cache.get(key);
          const items =
            !options.force && saved && saved.expires > time
              ? saved.items
              : await provider.load({
                  signal: controller.signal,
                  force: options.force,
                });
          if (finished) return;
          if (!Array.isArray(items)) throw new Error('Invalid lyric payload');
          items.forEach((item) => {
            if (item && item.id && item.lyric) candidates.set(item.id, item);
          });
          state.count = items.length;
          state.status = items.length ? 'success' : 'empty';
          cache.set(key, {
            items,
            expires: Date.now() + (items.length ? 600000 : 60000),
          });
          while (cache.size > 80) cache.delete(cache.keys().next().value);
        } catch (error) {
          if (finished) return;
          state.status = classify(error);
        }
        state.elapsedMs = Date.now() - time;
        publish();
      }
      if (!finished && states.every((s) => s.status !== 'loading')) finish();
    }
    const promise = new Promise((resolve) => {
      resolveFinal = resolve;
    });
    timer = setTimeout(() => finish(), options.timeoutMs || 12000);
    Promise.resolve().then(() => {
      if (!providers.length) finish();
      else for (let i = 0; i < Math.min(3, providers.length); i += 1) worker();
    });
    return { promise, cancel: () => finish(true) };
  }
  const api = { search, classify };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Listen2LyricSearch = api;
})(typeof window !== 'undefined' ? window : globalThis);
