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
    const resultPromise = new Promise((resolve) => {
      provider
        .search('/search?keywords=Android%20Song&curpage=2&type=0')
        .success(resolve);
    });
    assert.strictEqual(bridge.posted.length, 1);
    const request = bridge.posted[0];
    assert.strictEqual(request.method, 'GET');
    assert.strictEqual(Object.hasOwn(request, 'body'), false);
    const searchUrl = new URL(request.url);
    assert.strictEqual(searchUrl.origin, 'https://music.163.com');
    assert.strictEqual(searchUrl.pathname, '/api/search/get/web');
    assert.strictEqual(searchUrl.searchParams.get('s'), 'Android Song');
    assert.strictEqual(searchUrl.searchParams.get('offset'), '20');
    assert.strictEqual(searchUrl.searchParams.get('limit'), '20');
    assert.strictEqual(searchUrl.searchParams.get('type'), '1');
    bridge.emit({
      body: JSON.stringify({
        code: 200,
        result: {
          songCount: 7,
          songs: [
            {
              album: { id: 32, name: 'Android Album', picUrl: 'android.jpg' },
              artists: [{ id: 22, name: 'Android Artist' }],
              fee: 0,
              id: 12,
              name: 'Android Song',
            },
          ],
        },
      }),
      ok: true,
      requestId: request.requestId,
      status: 200,
      version: 1,
    });
    assert.strictEqual(axiosCalls.length, 0);
    assert.strictEqual(cookieSetCalls(), 0);
    assert.deepStrictEqual(toPlain(await resultPromise), {
      result: [
        {
          album: 'Android Album',
          album_id: 'nealbum_32',
          artist: 'Android Artist',
          artist_id: 'neartist_22',
          id: 'netrack_12',
          img_url: 'android.jpg',
          source: 'netease',
          source_url: 'https://music.163.com/#/song?id=12',
          title: 'Android Song',
        },
      ],
      total: 7,
      type: '0',
    });
  }

  {
    const bridge = createBridge();
    const { axiosCalls, provider } = createProviderContext({ bridge });
    const resultPromise = new Promise((resolve) => {
      provider
        .search('/search?keywords=Failure&curpage=1&type=0')
        .success(resolve);
    });
    bridge.emit({
      body: JSON.stringify({ code: -462, verifyType: 50 }),
      ok: true,
      requestId: bridge.posted[0].requestId,
      status: 200,
      version: 1,
    });
    assert.deepStrictEqual(toPlain(await resultPromise), {
      result: [],
      total: 0,
      type: '0',
    });
    assert.strictEqual(axiosCalls.length, 0);
  }

  {
    const bridge = createBridge();
    const { axiosCalls, provider } = createProviderContext({ bridge });
    const resultPromise = new Promise((resolve) => {
      provider
        .search('/search?keywords=Android&curpage=1&type=1')
        .success(resolve);
    });
    const request = bridge.posted[0];
    const searchUrl = new URL(request.url);
    assert.strictEqual(searchUrl.searchParams.get('type'), '1000');
    bridge.emit({
      body: JSON.stringify({
        code: 200,
        result: {
          playlistCount: 9,
          playlists: [
            {
              coverImgUrl: 'playlist.jpg',
              creator: { nickname: 'Playlist Author' },
              id: 51,
              name: 'Android Playlist',
              trackCount: 12,
            },
          ],
        },
      }),
      ok: true,
      requestId: request.requestId,
      status: 200,
      version: 1,
    });
    assert.deepStrictEqual(toPlain(await resultPromise), {
      result: [
        {
          author: 'Playlist Author',
          count: 12,
          id: 'neplaylist_51',
          img_url: 'playlist.jpg',
          source: 'netease',
          source_url: 'https://music.163.com/#/playlist?id=51',
          title: 'Android Playlist',
          url: 'neplaylist_51',
        },
      ],
      total: 9,
      type: '1',
    });
    assert.strictEqual(axiosCalls.length, 0);
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
