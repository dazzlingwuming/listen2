/* eslint-disable no-param-reassign */
(function appearanceModule(root) {
  const themes = [
    {
      id: 'white2',
      label: '_THEME_MODERN_WHITE',
      base: 'light',
      layout: 'classic',
    },
    {
      id: 'black2',
      label: '_THEME_MODERN_BLACK',
      base: 'dark',
      layout: 'classic',
    },
    {
      id: 'sakura',
      label: '_THEME_SAKURA',
      base: 'light',
      layout: 'letter',
      assets: 'sakura',
    },
    {
      id: 'mint',
      label: '_THEME_MINT',
      base: 'light',
      layout: 'wide',
      assets: 'mint',
    },
    {
      id: 'night',
      label: '_THEME_NIGHT',
      base: 'dark',
      layout: 'radio',
      assets: 'night',
    },
  ];
  function read(key, fallback) {
    try {
      const value = JSON.parse(root.localStorage.getItem(key));
      return value === null ? fallback : value;
    } catch (_) {
      return fallback;
    }
  }
  const defaultMode = /Mac/i.test(root.navigator.platform)
    ? 'quality'
    : 'balanced';
  let mode = read('performanceMode', defaultMode);
  if (!['balanced', 'quality', 'reduced'].includes(mode)) mode = defaultMode;
  const query = root.matchMedia('(prefers-reduced-motion: reduce)');
  const api = {
    themes,
    get mode() {
      return mode;
    },
    get budget() {
      const reduced = query.matches || mode === 'reduced';
      return {
        reduced,
        fps: reduced ? 15 : { quality: 60, balanced: 30 }[mode] || 30,
        dpr: mode === 'quality' ? 2 : 1.5,
      };
    },
    setMode(value) {
      if (!['balanced', 'quality', 'reduced'].includes(value)) return;
      mode = value;
      try {
        root.localStorage.setItem('performanceMode', JSON.stringify(mode));
      } catch (_) {
        /* Session preference still applies. */
      }
      api.publish();
    },
    publish() {
      root.document.documentElement.dataset.performance = api.budget.reduced
        ? 'reduced'
        : mode;
      root.dispatchEvent(new Event('listen2-appearance'));
    },
  };
  root.Listen2Appearance = api;
  query.addEventListener('change', () => api.publish());
  root.document.addEventListener('visibilitychange', () => {
    root.document.documentElement.classList.toggle(
      'app-hidden',
      root.document.hidden
    );
  });
  api.publish();
})(window);
