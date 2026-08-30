/* eslint-env node */
/* eslint-disable no-console */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const extensionRoot = path.join(__dirname, '..');
const adapterSource = fs.readFileSync(
  path.join(extensionRoot, 'js', 'lowebutil.js'),
  'utf8'
);
const providerSource = fs.readFileSync(
  path.join(extensionRoot, 'js', 'provider', 'netease.js'),
  'utf8'
);

function toPlain(value) {
  return JSON.parse(JSON.stringify(value));
}

function createBridge() {
  const listeners = [];
  return {
    posted: [],
    addEventListener(type, listener) {
      assert.strictEqual(type, 'message');
      listeners.push(listener);
    },
    emit(value) {
      listeners.forEach((listener) =>
        listener({ data: JSON.stringify(value) })
      );
    },
    postMessage(value) {
      this.posted.push(JSON.parse(value));
    },
  };
}

function createProvider(bridge) {
  const context = {
    URL,
    URLSearchParams,
    async: { concat() {} },
    clearTimeout,
    console,
    setTimeout,
    window: { Listen2AndroidHttp: bridge },
    axios: {
      get() {
        throw new Error('Android typed NetEase provider must not call axios.');
      },
      post() {
        throw new Error('Android typed NetEase provider must not call axios.');
      },
    },
    cookieGet() {
      throw new Error('Android typed NetEase provider must not read cookies.');
    },
    cookieSet() {
      throw new Error('Android typed NetEase provider must not write cookies.');
    },
    getParameterByName(name, url) {
      return new URL(url, 'https://listen2.test').searchParams.get(name);
    },
  };
  vm.createContext(context);
  vm.runInContext(adapterSource, context, { filename: 'lowebutil.js' });
  vm.runInContext(
    `${providerSource}\nthis.NeteaseProviderForTest = netease;`,
    context,
    { filename: 'netease.js' }
  );
  return context.NeteaseProviderForTest;
}

function terminal(bridge, request, result) {
  bridge.emit({
    version: 2,
    terminal: 'ok',
    requestId: request.requestId,
    pageEpoch: request.pageEpoch,
    status: 200,
    result,
  });
}

async function run() {
  const bridge = createBridge();
  const provider = createProvider(bridge);
  const search = provider.search(
    '/search?keywords=%20typed%20&curpage=2&type=0',
    {
      pageEpoch: 7,
    }
  );
  assert.strictEqual(typeof search.cancel, 'function');
  assert.strictEqual(typeof search.then, 'function');
  assert.strictEqual(search.pageEpoch, 7);
  assert.strictEqual(bridge.posted.length, 1);
  assert.strictEqual(bridge.posted[0].operation, 'netease.search');
  assert.deepStrictEqual(toPlain(bridge.posted[0].payload), {
    keyword: 'typed',
    page: 2,
  });
  const resultPromise = new Promise((resolve) => search.success(resolve));
  terminal(bridge, bridge.posted[0], {
    source: 'netease',
    provider: 'netease',
    total: 1,
    rows: [
      {
        source: 'netease',
        provider: 'netease',
        id: 'netrack_42',
        providerTrackId: '42',
        title: 'Typed song',
        artist: 'Typed artist',
        durationMs: 123000,
        capability: 'route-unavailable',
      },
    ],
  });
  const searched = await resultPromise;
  assert.strictEqual(searched.total, 1);
  assert.strictEqual(searched.result[0].title, 'Typed song');
  assert.strictEqual(searched.result[0].capability, 'route-unavailable');
  ['url', 'headers', 'cookie', 'candidates', 'providerTrackId'].forEach(
    (key) => {
      assert.strictEqual(Object.hasOwn(searched.result[0], key), false);
    }
  );

  const cancelled = provider.search(
    '/search?keywords=cancel&curpage=1&type=0',
    {
      pageEpoch: 8,
    }
  );
  const cancelledResult = new Promise((resolve) => cancelled.success(resolve));
  cancelled.cancel();
  assert.strictEqual(bridge.posted[2].operation, 'rpc.cancel');
  assert.deepStrictEqual(toPlain(await cancelledResult), {
    result: [],
    total: 0,
    type: '0',
    error: {
      status: 'android-rpc-cancelled',
      message: 'NetEase request was cancelled.',
    },
  });

  const rejected = provider.search('/search?keywords=denied&curpage=1&type=0', {
    pageEpoch: 9,
  });
  const rejectedResult = new Promise((resolve) => rejected.success(resolve));
  bridge.emit({
    version: 2,
    terminal: 'error',
    requestId: bridge.posted[3].requestId,
    pageEpoch: 9,
    status: 0,
    error: 'NETEASE_ROUTE_UNAVAILABLE',
  });
  assert.deepStrictEqual(toPlain(await rejectedResult), {
    result: [],
    total: 0,
    type: '0',
    error: {
      status: 'android-rpc-unavailable-route',
      message: 'NetEase is unavailable on this Android device.',
    },
  });

  console.log('Android typed NetEase provider tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
