/* eslint-env node */
/* eslint-disable no-console */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const extensionRoot = path.join(__dirname, '..');
const instantSearchSource = fs.readFileSync(
  path.join(extensionRoot, 'js', 'controller', 'instant_search.js'),
  'utf8'
);
const playlistSource = fs.readFileSync(
  path.join(extensionRoot, 'js', 'controller', 'playlist.js'),
  'utf8'
);
const authSource = fs.readFileSync(
  path.join(extensionRoot, 'js', 'controller', 'auth.js'),
  'utf8'
);
const markup = fs.readFileSync(
  path.join(extensionRoot, 'listen1.html'),
  'utf8'
);
const styles = fs.readFileSync(
  path.join(extensionRoot, 'css', 'redesign.css'),
  'utf8'
);

function loadController(source, name, extras = {}) {
  let factory;
  const context = {
    angular: {
      module() {
        return {
          controller(controllerName, definition) {
            if (controllerName === name) {
              factory = definition[definition.length - 1];
            }
          },
        };
      },
    },
    clearTimeout,
    console,
    document: { querySelector: () => ({ scrollTo() {} }) },
    setTimeout,
    window: {},
    ...extras,
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: `${name}.js` });
  assert.strictEqual(typeof factory, 'function');
  return factory;
}

function createScope() {
  const listeners = {};
  return {
    $on(event, callback) {
      listeners[event] = callback;
      return () => delete listeners[event];
    },
    $watch() {},
    emit(event) {
      if (listeners[event]) {
        listeners[event]();
      }
    },
  };
}

function createHandle() {
  let successCallback;
  let errorCallback;
  return {
    cancelled: false,
    cancel() {
      this.cancelled = true;
    },
    success(callback) {
      successCallback = callback;
      return this;
    },
    error(callback) {
      errorCallback = callback;
      return this;
    },
    resolve(value) {
      successCallback(value);
    },
    reject(value) {
      errorCallback(value);
    },
  };
}

function run() {
  const searchHandles = [];
  const detailHandles = [];
  const searchFactory = loadController(
    instantSearchSource,
    'InstantSearchController',
    {
      i18next: { t: (value) => value },
      MediaService: {
        getVideoContext() {
          const handle = createHandle();
          detailHandles.push(handle);
          return handle;
        },
        search() {
          const handle = createHandle();
          searchHandles.push(handle);
          return handle;
        },
      },
      sourceList: [
        { name: 'allmusic', searchable: true },
        { name: 'bilibili', searchable: true },
      ],
      window: { Listen2AndroidHttpAdapter: { isAvailable: () => true } },
    }
  );
  const searchScope = createScope();
  searchFactory(searchScope, () => {}, { $broadcast() {} });
  assert.strictEqual(searchScope.bilibiliSearch.state, 'idle');
  searchScope.submitBilibiliSearch();
  assert.strictEqual(searchHandles.length, 0, 'empty input stays local');
  searchScope.keywords = 'first';
  searchScope.submitBilibiliSearch();
  assert.strictEqual(searchHandles.length, 1);
  const firstEpoch = searchScope.bilibiliSearch.epoch;
  searchScope.keywords = 'second';
  searchScope.submitBilibiliSearch();
  assert.strictEqual(searchHandles[0].cancelled, true);
  assert.ok(searchScope.bilibiliSearch.epoch > firstEpoch);
  searchHandles[0].resolve({ result: [{ id: 'stale' }], total: 1 });
  assert.strictEqual(searchScope.result.length, 0, 'stale results are ignored');
  searchHandles[1].resolve({
    result: [
      { id: 'bitrack_v_BV1xx411c7mD', title: '<unsafe>', source: 'bilibili' },
    ],
    total: 1,
  });
  assert.strictEqual(searchScope.bilibiliSearch.state, 'content');
  assert.strictEqual(searchScope.result[0].title, '<unsafe>');
  searchScope.keywords = 'unavailable';
  searchScope.submitBilibiliSearch();
  searchHandles[2].resolve({
    result: [],
    total: 0,
    error: { status: 'android-rpc-provider-status' },
  });
  assert.strictEqual(
    searchScope.bilibiliSearch.state,
    'error',
    'provider failures must remain retryable errors rather than empty results'
  );
  assert.strictEqual(
    searchScope.result.length,
    1,
    'prior rows remain available after a failed retry'
  );
  assert.strictEqual(
    searchScope.bilibiliSearch.message,
    '匿名请求暂时被来源拒绝'
  );
  searchScope.openBilibiliDetail(searchScope.result[0]);
  assert.strictEqual(searchScope.bilibiliDetail.state, 'loading');
  detailHandles[0].resolve({
    bvid: 'BV1xx411c7mD',
    parts: [
      { cid: 11, title: 'Part one', duration: 60, capability: 'playable' },
      {
        cid: 22,
        title: 'Part two',
        duration: 61,
        capability: 'login-required',
      },
    ],
  });
  assert.strictEqual(searchScope.bilibiliDetail.selectedCid, 11);
  searchScope.selectBilibiliPart(22);
  assert.strictEqual(searchScope.bilibiliDetail.selectedCid, 22);
  assert.strictEqual(searchScope.canPlaySelectedBilibiliPart(), false);
  searchScope.selectBilibiliPart(999);
  assert.strictEqual(searchScope.bilibiliDetail.state, 'invalid-part');
  assert.strictEqual(searchScope.bilibiliDetail.message, '所选分P不可用');

  const playlistFactory = loadController(playlistSource, 'PlayListController', {
    MediaService: {
      showPlaylistArray: () => createHandle(),
      getPlaylistFilters: () => createHandle(),
    },
    sourceList: [{ name: 'netease' }],
  });
  const playlistScope = createScope();
  playlistFactory(playlistScope);
  assert.strictEqual(playlistScope.remoteHome.state, 'idle');
  assert.strictEqual(typeof playlistScope.retryRemoteHome, 'function');

  let authCalls = 0;
  const authFactory = loadController(authSource, 'AuthController', {
    MediaService: {
      getLoginProviders: () => [{ name: 'bilibili' }],
      getUser() {
        authCalls += 1;
        return createHandle();
      },
    },
    isElectron: () => false,
    window: { Listen2AndroidHttpAdapter: { isAvailable: () => true } },
  });
  const authScope = createScope();
  authFactory(authScope, () => {});
  authScope.refreshAuthStatus();
  assert.strictEqual(
    authScope.androidAccountState.message,
    '登录功能将在后续版本提供'
  );
  assert.strictEqual(authCalls, 0);

  [
    'bilibili-mobile-search',
    '正在搜索哔哩哔哩…',
    '取消本次搜索',
    '重新搜索哔哩哔哩',
    '播放此分P',
    'aria-live="polite"',
    '登录功能将在后续版本提供',
  ].forEach((needle) =>
    assert.ok(markup.includes(needle), `missing ${needle}`)
  );
  [
    '100svh',
    'safe-area-inset-bottom',
    'min-height: 48px',
    'prefers-reduced-motion: reduce',
    '.bilibili-mobile-search',
  ].forEach((needle) =>
    assert.ok(styles.includes(needle), `missing ${needle}`)
  );
  assert.strictEqual(markup.includes('ng-bind-html="song.title"'), false);
  console.log('Android mobile Bilibili UI tests passed');
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
