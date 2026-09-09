/* eslint-env node */
/* eslint-disable no-console */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'js', 'loweb.js'),
  'utf8'
);

function provider(name, calls) {
  return {
    search() {
      calls.push(name);
      throw new Error(`${name} must not be invoked on Android.`);
    },
  };
}

function createContext() {
  const calls = [];
  const androidAdapter = {
    capabilities: null,
    listeners: [],
    isAvailable() {
      return true;
    },
    getProviderCapabilities() {
      return this.capabilities;
    },
    startProviderCapabilities() {
      return Promise.resolve(this.capabilities);
    },
    refreshProviderCapabilities() {
      return Promise.resolve(this.capabilities);
    },
    onProviderCapabilities(listener) {
      this.listeners.push(listener);
      return () => {
        this.listeners = this.listeners.filter((item) => item !== listener);
      };
    },
    request() {
      throw new Error('An unavailable provider cannot post an Android RPC.');
    },
  };
  const context = {
    URL,
    URLSearchParams,
    Promise,
    console,
    async: { parallel() {} },
    LRUCache: class {},
    setPrototypeOfLocalStorage() {},
    getLocalStorageValue() {
      return null;
    },
    isElectron() {
      return false;
    },
    localStorage: {
      getObject() {
        return {};
      },
      setObject() {},
    },
    window: {
      Listen2AndroidHttpAdapter: androidAdapter,
    },
  };
  [
    'netease',
    'xiami',
    'qq',
    'kugou',
    'kuwo',
    'bilibili',
    'migu',
    'taihe',
    'localmusic',
    'myplaylist',
  ].forEach((name) => {
    context[name] = provider(name, calls);
  });
  vm.createContext(context);
  vm.runInContext(
    `${source}\nthis.MediaServiceForTest = MediaService;`,
    context,
    {
      filename: 'loweb.js',
    }
  );
  return { calls, androidAdapter, mediaService: context.MediaServiceForTest };
}

async function run() {
  const { calls, androidAdapter, mediaService } = createContext();
  const matrix = mediaService.getAndroidProviderCapabilities();
  assert.strictEqual(matrix.bilibili.search, false);
  assert.strictEqual(matrix.bilibili.media, false);
  assert.strictEqual(matrix.netease.search, false);
  ['qq', 'kugou', 'kuwo', 'migu', 'taihe'].forEach((name) => {
    [
      'search',
      'directory',
      'detail',
      'media',
      'lyric',
      'manualLyric',
      'fallback',
      'login',
      'permission',
    ].forEach((field) => assert.strictEqual(matrix[name][field], false));
  });

  const results = await Promise.all(
    ['qq', 'kugou', 'kuwo', 'migu', 'taihe'].map(
      (name) =>
        new Promise((resolve) => {
          mediaService
            .search(name, { keywords: 'no-route', curpage: 1, type: '0' })
            .success(resolve);
        })
    )
  );
  results.forEach((result) =>
    assert.deepStrictEqual(JSON.parse(JSON.stringify(result)), {
      result: [],
      total: 0,
      type: '0',
      error: {
        status: 'android-provider-unavailable',
        message: 'This music source is unavailable on this Android device.',
      },
    })
  );
  assert.deepStrictEqual(calls, []);

  androidAdapter.capabilities = {
    version: 1,
    bilibili: {
      search: true,
      directory: true,
      detail: true,
      media: true,
      lyric: false,
      manualLyric: false,
      fallback: false,
      login: false,
      permission: false,
    },
    netease: {
      search: false,
      directory: false,
      detail: false,
      media: false,
      lyric: false,
      manualLyric: false,
      fallback: false,
      login: false,
      permission: false,
    },
  };
  const refreshed = await mediaService.startAndroidProviderCapabilities();
  assert.strictEqual(refreshed.bilibili.search, true);
  assert.strictEqual(refreshed.bilibili.media, true);
  assert.strictEqual(refreshed.netease.media, false);

  console.log('Android provider capability matrix tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
