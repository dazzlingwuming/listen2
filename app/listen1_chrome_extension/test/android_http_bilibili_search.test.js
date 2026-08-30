/* eslint-env node */
/* eslint-disable no-console */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const extensionRoot = path.join(__dirname, '..');
const lowebutilSource = fs.readFileSync(
  path.join(extensionRoot, 'js', 'lowebutil.js'),
  'utf8'
);
const bilibiliSource = fs.readFileSync(
  path.join(extensionRoot, 'js', 'provider', 'bilibili.js'),
  'utf8'
);

function createBridge() {
  const listeners = [];
  const posted = [];
  return {
    posted,
    addEventListener(type, listener) {
      assert.strictEqual(type, 'message');
      listeners.push(listener);
    },
    emit(payload) {
      listeners.forEach((listener) =>
        listener({ data: JSON.stringify(payload) })
      );
    },
    postMessage(envelope) {
      posted.push(JSON.parse(envelope));
    },
  };
}

function toPlain(value) {
  return JSON.parse(JSON.stringify(value));
}

function createAdapterContext(windowValue) {
  const context = {
    URL,
    clearTimeout,
    console,
    setTimeout,
    window: windowValue,
  };
  vm.createContext(context);
  vm.runInContext(lowebutilSource, context, {
    filename: path.join(extensionRoot, 'js', 'lowebutil.js'),
  });
  return context;
}

function createBilibiliContext(options = {}) {
  const { bridge } = options;
  const windowValue = bridge ? { Listen2AndroidHttp: bridge } : {};
  const context = createAdapterContext(windowValue);
  const axiosCalls = [];
  let cookieSetCalls = 0;
  Object.assign(context, {
    DOMParser: class {
      // eslint-disable-next-line class-methods-use-this
      parseFromString(value) {
        return { body: { textContent: value.replace(/<[^>]+>/g, '') } };
      }
    },
    axios: {
      get(url, config) {
        axiosCalls.push({ url, config });
        return Promise.resolve({
          data: {
            data: {
              numResults: 1,
              result: [
                {
                  author: 'Desktop Artist',
                  bvid: 'BV_DESKTOP',
                  duration: '03:00',
                  mid: 8,
                  pic: '//desktop.example/cover.jpg',
                  title: 'Desktop Song',
                },
              ],
            },
          },
        });
      },
    },
    cookieSet(_cookie, callback) {
      cookieSetCalls += 1;
      callback();
    },
    getParameterByName(name, url) {
      return new URL(url, 'https://listen2.test').searchParams.get(name);
    },
    kuwo: {},
    localStorage: {
      getItem() {
        return null;
      },
      setItem() {},
    },
  });
  vm.runInContext(
    `${bilibiliSource}\nthis.BilibiliProviderForTest = bilibili;`,
    context,
    { filename: path.join(extensionRoot, 'js', 'provider', 'bilibili.js') }
  );
  return {
    axiosCalls,
    cookieSetCalls() {
      return cookieSetCalls;
    },
    context,
    provider: context.BilibiliProviderForTest,
  };
}

async function run() {
  {
    const bridge = createBridge();
    const context = createAdapterContext({ Listen2AndroidHttp: bridge });
    const adapter = context.window.Listen2AndroidHttpAdapter;
    assert.strictEqual(adapter.isAvailable(), true);

    const first = adapter.get('https://api.bilibili.com/first');
    const second = adapter.get('https://api.bilibili.com/second');
    assert.strictEqual(bridge.posted.length, 2);
    assert.notStrictEqual(
      bridge.posted[0].requestId,
      bridge.posted[1].requestId
    );
    bridge.posted.forEach((request) => {
      assert.deepStrictEqual(Object.keys(request).sort(), [
        'method',
        'requestId',
        'url',
        'version',
      ]);
      assert.strictEqual(request.method, 'GET');
      assert.strictEqual(request.version, 1);
    });

    bridge.emit({
      body: '{}',
      ok: true,
      requestId: 'unknown-request',
      status: 200,
      version: 1,
    });
    bridge.emit({
      body: '{"second":true}',
      ok: true,
      requestId: bridge.posted[1].requestId,
      status: 200,
      version: 1,
    });
    bridge.emit({
      body: '{"first":true}',
      ok: true,
      requestId: bridge.posted[0].requestId,
      status: 200,
      version: 1,
    });
    assert.deepStrictEqual(toPlain(await first), {
      body: '{"first":true}',
      status: 200,
    });
    assert.deepStrictEqual(toPlain(await second), {
      body: '{"second":true}',
      status: 200,
    });

    bridge.emit({
      body: '{}',
      ok: true,
      requestId: bridge.posted[0].requestId,
      status: 200,
      version: 1,
    });
  }

  {
    const bridge = createBridge();
    const rootElement = {};
    let evalAsyncCalls = 0;
    const rootScope = {
      $evalAsync(callback) {
        evalAsyncCalls += 1;
        assert.strictEqual(typeof callback, 'function');
      },
    };
    const context = createAdapterContext({
      Listen2AndroidHttp: bridge,
      angular: {
        element(element) {
          assert.strictEqual(element, rootElement);
          return {
            injector() {
              return {
                get(name) {
                  assert.strictEqual(name, '$rootScope');
                  return rootScope;
                },
              };
            },
          };
        },
      },
      document: { documentElement: rootElement },
    });
    const adapter = context.window.Listen2AndroidHttpAdapter;
    let evalAsyncCallsWhenThenRuns = -1;
    const request = adapter
      .get('https://api.bilibili.com/angular-digest')
      .then(() => {
        evalAsyncCallsWhenThenRuns = evalAsyncCalls;
      });
    bridge.emit({
      body: '{}',
      ok: true,
      requestId: bridge.posted[0].requestId,
      status: 200,
      version: 1,
    });
    await request;
    assert.strictEqual(
      evalAsyncCallsWhenThenRuns,
      0,
      'the consumer callback must run before its digest is scheduled'
    );
    assert.strictEqual(evalAsyncCalls, 1);
  }

  {
    const bridge = createBridge();
    const context = createAdapterContext({ Listen2AndroidHttp: bridge });
    const adapter = context.window.Listen2AndroidHttpAdapter;
    const urlPrefix = 'https://api.bilibili.com/';
    const acceptedUrl = `${urlPrefix}${'a'.repeat(4096 - urlPrefix.length)}`;
    const accepted = adapter.get(acceptedUrl);
    assert.strictEqual(bridge.posted[0].url.length, 4096);
    bridge.emit({
      body: '{}',
      ok: true,
      requestId: bridge.posted[0].requestId,
      status: 200,
      version: 1,
    });
    await accepted;
    await assert.rejects(
      adapter.get(`${acceptedUrl}a`),
      (error) => error.code === 'android-http-invalid-url'
    );
    assert.strictEqual(bridge.posted.length, 1);
  }

  {
    let previousHandlerCalls = 0;
    const posted = [];
    const bridge = {
      onmessage() {
        previousHandlerCalls += 1;
      },
      postMessage(envelope) {
        posted.push(JSON.parse(envelope));
      },
    };
    const context = createAdapterContext({ Listen2AndroidHttp: bridge });
    const adapter = context.window.Listen2AndroidHttpAdapter;
    const request = adapter.get('https://api.bilibili.com/onmessage');
    bridge.onmessage({
      data: JSON.stringify({
        body: '{"onmessage":true}',
        ok: true,
        requestId: posted[0].requestId,
        status: 200,
        version: 1,
      }),
    });
    assert.deepStrictEqual(toPlain(await request), {
      body: '{"onmessage":true}',
      status: 200,
    });
    assert.strictEqual(previousHandlerCalls, 1);
  }

  {
    const bridge = createBridge();
    const context = createAdapterContext({ Listen2AndroidHttp: bridge });
    const adapter = context.window.Listen2AndroidHttpAdapter;
    const failed = adapter.get('https://api.bilibili.com/failure');
    bridge.emit({
      body: '',
      error: 'network unavailable',
      ok: false,
      requestId: bridge.posted[0].requestId,
      status: 0,
      version: 1,
    });
    await assert.rejects(
      failed,
      (error) => error.code === 'android-http-failed'
    );

    await assert.rejects(
      adapter.get('https://api.bilibili.com/timeout', { timeoutMs: 5 }),
      (error) => error.code === 'android-http-timeout'
    );
  }

  {
    const context = createAdapterContext({});
    const adapter = context.window.Listen2AndroidHttpAdapter;
    assert.strictEqual(adapter.isAvailable(), false);
    await assert.rejects(
      adapter.get('https://api.bilibili.com/not-android'),
      (error) => error.code === 'android-http-unavailable'
    );
  }

  {
    const bridge = createBridge();
    const { axiosCalls, provider } = createBilibiliContext({ bridge });
    const resultPromise = new Promise((resolve) => {
      provider
        .search('/search?keywords=Android%20Song&curpage=3')
        .success(resolve);
    });
    assert.strictEqual(bridge.posted.length, 1);
    assert.strictEqual(bridge.posted[0].operation, 'bilibili.search');
    assert.deepStrictEqual(toPlain(bridge.posted[0].payload), {
      keyword: 'Android Song',
      page: 3,
    });
    bridge.emit({
      terminal: 'ok',
      result: {
        source: 'bilibili',
        total: 7,
        rows: [
          {
            author: 'Android Artist',
            authorId: 9,
            bvid: 'BV1xx411c7mD',
            capability: 'part-selection-required',
            cover: 'https://android.example/cover.jpg',
            duration: '03:21',
            id: 'bitrack_v_BV1xx411c7mD',
            provider: 'bilibili',
            source: 'bilibili',
            title: 'Android Song',
            type: 'video',
          },
        ],
      },
      requestId: bridge.posted[0].requestId,
      pageEpoch: 0,
      status: 200,
      version: 2,
    });
    const result = await resultPromise;
    assert.strictEqual(axiosCalls.length, 0);
    assert.strictEqual(result.total, 7);
    assert.deepStrictEqual(toPlain(result.result[0]), {
      artist: 'Android Artist',
      artist_id: 'biartist_v_9',
      capability: 'part-selection-required',
      duration: 201,
      id: 'bitrack_v_BV1xx411c7mD',
      img_url: 'https://android.example/cover.jpg',
      provider: 'bilibili',
      resultType: 'video',
      source: 'bilibili',
      source_url: 'https://www.bilibili.com/BV1xx411c7mD',
      title: 'Android Song',
    });
  }

  {
    const bridge = createBridge();
    const { axiosCalls, provider } = createBilibiliContext({ bridge });
    const resultPromise = new Promise((resolve) => {
      provider.search('/search?keywords=Failure&curpage=1').success(resolve);
    });
    bridge.emit({
      error: 'NETWORK_IO_ERROR',
      terminal: 'error',
      requestId: bridge.posted[0].requestId,
      pageEpoch: 0,
      status: 0,
      version: 2,
    });
    const result = await resultPromise;
    assert.strictEqual(axiosCalls.length, 0);
    assert.deepStrictEqual(toPlain(result), {
      error: {
        message: 'Bilibili is unavailable while this device is offline.',
        status: 'android-rpc-network',
      },
      result: [],
      total: 0,
    });
  }

  {
    const { axiosCalls, cookieSetCalls, provider } = createBilibiliContext();
    const result = await new Promise((resolve) => {
      provider.search('/search?keywords=Desktop&curpage=1').success(resolve);
    });
    assert.strictEqual(cookieSetCalls(), 1);
    assert.strictEqual(axiosCalls.length, 1);
    assert.strictEqual(result.result[0].title, 'Desktop Song');
  }

  console.log('android HTTP Bilibili search tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
