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
const neteaseSource = fs.readFileSync(
  path.join(extensionRoot, 'js', 'provider', 'netease.js'),
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

function createAsync() {
  return {
    concat(items, iterator, done) {
      if (items.length === 0) {
        done(null, []);
        return;
      }
      const results = [];
      let remaining = items.length;
      items.forEach((item, index) => {
        iterator(item, (error, result) => {
          assert.ifError(error);
          results[index] = result;
          remaining -= 1;
          if (remaining === 0) done(null, results);
        });
      });
    },
  };
}

function createProviderContext(options = {}) {
  const { bridge } = options;
  const context = {
    URL,
    URLSearchParams,
    async: createAsync(),
    clearTimeout,
    console,
    setTimeout,
    window: bridge ? { Listen2AndroidHttp: bridge } : {},
  };
  const axiosCalls = [];
  let cookieSetCalls = 0;
  Object.assign(context, {
    axios: {
      post(url, body) {
        axiosCalls.push({ body: body.toString(), url });
        return Promise.resolve({
          data: {
            result: {
              songCount: 1,
              songs: [
                {
                  album: {
                    id: 31,
                    name: 'Desktop Album',
                    picUrl: 'desktop.jpg',
                  },
                  artists: [{ id: 21, name: 'Desktop Artist' }],
                  fee: 0,
                  id: 11,
                  name: 'Desktop Song',
                },
              ],
            },
          },
        });
      },
    },
    cookieGet(_item, callback) {
      callback(null);
    },
    cookieSet(_item, callback) {
      cookieSetCalls += 1;
      callback(null);
    },
    getParameterByName(name, url) {
      return new URL(url, 'https://listen2.test').searchParams.get(name);
    },
  });
  vm.createContext(context);
  vm.runInContext(lowebutilSource, context, {
    filename: path.join(extensionRoot, 'js', 'lowebutil.js'),
  });
  vm.runInContext(
    `${neteaseSource}\nthis.NeteaseProviderForTest = netease;`,
    context,
    {
      filename: path.join(extensionRoot, 'js', 'provider', 'netease.js'),
    }
  );
  return {
    axiosCalls,
    cookieSetCalls() {
      return cookieSetCalls;
    },
    provider: context.NeteaseProviderForTest,
  };
}

async function run() {
  {
    const bridge = createBridge();
    const { axiosCalls, cookieSetCalls, provider } = createProviderContext({
      bridge,
    });
    const search = provider.search(
      '/search?keywords=Android%20Song&curpage=2&type=0',
      { pageEpoch: 5 }
    );
    const resultPromise = new Promise((resolve) => search.success(resolve));
    assert.strictEqual(bridge.posted.length, 1);
    const request = bridge.posted[0];
    assert.strictEqual(request.version, 2);
    assert.strictEqual(request.operation, 'netease.search');
    assert.strictEqual(request.pageEpoch, 5);
    assert.deepStrictEqual(toPlain(request.payload), {
      keyword: 'Android Song',
      page: 2,
    });
    ['url', 'headers', 'cookie', 'body'].forEach((key) =>
      assert.strictEqual(Object.hasOwn(request.payload, key), false)
    );
    bridge.emit({
      version: 2,
      terminal: 'ok',
      requestId: request.requestId,
      pageEpoch: 5,
      status: 200,
      result: {
        source: 'netease',
        provider: 'netease',
        total: 7,
        rows: [
          {
            source: 'netease',
            provider: 'netease',
            id: 'netrack_12',
            providerTrackId: '12',
            title: 'Android Song',
            artist: 'Android Artist',
            durationMs: 245000,
            capability: 'route-unavailable',
          },
        ],
      },
    });
    assert.strictEqual(axiosCalls.length, 0);
    assert.strictEqual(cookieSetCalls(), 0);
    assert.deepStrictEqual(toPlain(await resultPromise), {
      result: [
        {
          artist: 'Android Artist',
          capability: 'route-unavailable',
          duration: 245,
          id: 'netrack_12',
          provider: 'netease',
          source: 'netease',
          title: 'Android Song',
        },
      ],
      total: 7,
      type: '0',
    });
  }

  {
    const { axiosCalls, cookieSetCalls, provider } = createProviderContext();
    const result = await new Promise((resolve) => {
      provider
        .search('/search?keywords=Desktop&curpage=1&type=0')
        .success(resolve);
    });
    assert.strictEqual(axiosCalls.length, 1);
    assert.strictEqual(
      axiosCalls[0].url,
      'https://music.163.com/api/search/pc'
    );
    assert.match(axiosCalls[0].body, /s=Desktop/);
    assert.strictEqual(cookieSetCalls(), 0);
    assert.strictEqual(result.result[0].title, 'Desktop Song');
  }

  console.log('android HTTP NetEase search tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
