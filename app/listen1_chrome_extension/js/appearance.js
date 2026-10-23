/* eslint-disable no-param-reassign */
(function appearanceModule(root) {
  const themes = [
    {
      id: 'vinyl',
      label: '_THEME_VINYL',
      base: 'dark',
      layout: 'turntable',
      collection: 'objects',
      edition: '01',
      headline: 'Side A.',
      object: 'vinyl',
      colors: ['#201b17', '#e6b978', '#f4ead9'],
    },
    {
      id: 'studio',
      label: '_THEME_STUDIO',
      base: 'light',
      layout: 'equipment',
      collection: 'objects',
      edition: '02',
      headline: 'STUDIO.02',
      object: 'studio',
      colors: ['#deded8', '#d04424', '#262924'],
    },
    {
      id: 'poolside',
      label: '_THEME_POOLSIDE',
      base: 'light',
      layout: 'desktop',
      collection: 'graphic',
      edition: '03',
      headline: 'OFFLINE\nPARADISE.',
      object: 'poolside',
      colors: ['#f6edda', '#266a5d', '#f3a887'],
    },
    {
      id: 'acid',
      label: '_THEME_ACID',
      base: 'dark',
      layout: 'poster',
      collection: 'graphic',
      edition: '04',
      headline: 'STAY\nLOUD.',
      object: 'acid',
      colors: ['#141510', '#d5fc54', '#f3f5e9'],
    },
    {
      id: 'terminal',
      label: '_THEME_TERMINAL',
      base: 'dark',
      layout: 'console',
      collection: 'graphic',
      edition: '05',
      headline: 'HELLO,\nLISTENER_',
      object: 'terminal',
      colors: ['#071611', '#78eba6', '#2e5241'],
    },
    {
      id: 'dune',
      label: '_THEME_DUNE',
      base: 'light',
      layout: 'cinema',
      collection: 'scenery',
      edition: '06',
      headline: 'Dune.',
      scene: 'dune',
      colors: ['#f5ecdf', '#a04428', '#d79b68'],
    },
    {
      id: 'ocean',
      label: '_THEME_OCEAN',
      base: 'dark',
      layout: 'cinema',
      collection: 'scenery',
      edition: '07',
      headline: 'Deep blue.',
      scene: 'ocean',
      colors: ['#071d2b', '#82d9e4', '#e3f3f6'],
    },
    {
      id: 'aurora',
      label: '_THEME_AURORA',
      base: 'dark',
      layout: 'cinema',
      collection: 'scenery',
      edition: '08',
      headline: 'Violet hour.',
      scene: 'aurora',
      colors: ['#211b30', '#edb9d2', '#a293c0'],
    },
    {
      id: 'custom',
      label: '_THEME_CUSTOM',
      base: 'dark',
      layout: 'cinema',
      collection: 'scenery',
      edition: 'YOU',
      headline: 'Your scenery.',
      scene: 'custom',
      colors: ['#14212b', '#b6d9df', '#edf5f7'],
    },
    {
      id: 'white2',
      label: '_THEME_MODERN_WHITE',
      base: 'light',
      layout: 'classic',
      collection: 'essentials',
      colors: ['#f4f5f8', '#7665e8', '#171923'],
    },
    {
      id: 'black2',
      label: '_THEME_MODERN_BLACK',
      base: 'dark',
      layout: 'classic',
      collection: 'essentials',
      colors: ['#10131d', '#8b7cf6', '#f5f7fb'],
    },
    {
      id: 'sakura',
      label: '_THEME_SAKURA',
      base: 'light',
      layout: 'letter',
      assets: 'sakura',
      collection: 'illustrated',
      colors: ['#fff8f5', '#ad3b65', '#ead7d9'],
    },
    {
      id: 'mint',
      label: '_THEME_MINT',
      base: 'light',
      layout: 'wide',
      assets: 'mint',
      collection: 'illustrated',
      colors: ['#f3faf6', '#287d68', '#b8d2c1'],
    },
    {
      id: 'night',
      label: '_THEME_NIGHT',
      base: 'dark',
      layout: 'radio',
      assets: 'night',
      collection: 'illustrated',
      colors: ['#151a2b', '#b5a1f2', '#525576'],
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
    filters: [
      'all',
      'objects',
      'graphic',
      'scenery',
      'illustrated',
      'light',
      'dark',
    ],
    isModernTheme(id) {
      return themes.some((theme) => theme.id === id);
    },
    matchesFilter(theme, filter) {
      return (
        filter === 'all' || theme.base === filter || theme.collection === filter
      );
    },
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
