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
  path.join(extensionRoot, 'js', 'provider', 'localmusic.js'),
  'utf8'
);

function createBridge() {
  const listeners = [];
  return {
    posted: [],
    addEventListener(type, listener) {
      assert.strictEqual(type, 'message');
      listeners.push(listener);
    },
    postMessage(value) {
      this.posted.push(JSON.parse(value));
    },
    emit(value) {
      listeners.forEach((listener) =>
        listener({ data: JSON.stringify(value) })
      );
    },
  };
}

function createProvider(bridge) {
  const context = {
    URL,
    clearTimeout,
    console,
    setTimeout,
    window: { Listen2AndroidHttp: bridge },
    getParameterByName(name, url) {
      return new URL(url, 'https://listen2.test').searchParams.get(name);
    },
    localStorage: {
      getObject() {
        return { tracks: [] };
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(adapterSource, context, { filename: 'lowebutil.js' });
  vm.runInContext(
    `${providerSource}\nthis.LocalMusicProviderForTest = localmusic;`,
    context,
    { filename: 'localmusic.js' }
  );
  return { provider: context.LocalMusicProviderForTest, context };
}

async function run() {
  const bridge = createBridge();
  const { provider, context } = createProvider(bridge);
  const localTrackId =
    'local.track.0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const facade = provider.lyric(`/lyric?track_id=${localTrackId}`, {
    pageEpoch: 6,
  });
  assert.strictEqual(bridge.posted.length, 1);
  assert.strictEqual(bridge.posted[0].operation, 'local.lyric.primary');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(bridge.posted[0].payload)), {
    localTrackId,
  });
  const resultPromise = new Promise((resolve) => facade.success(resolve));
  bridge.emit({
    version: 2,
    terminal: 'ok',
    requestId: bridge.posted[0].requestId,
    pageEpoch: 6,
    status: 200,
    result: { status: 'found', lyric: '[00:00.00]Native LRC', tlyric: '' },
  });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(await resultPromise)), {
    lyric: '[00:00.00]Native LRC',
    tlyric: '',
    source: 'localmusic',
    status: 'found',
  });

  const noLyric = provider.lyric(`/lyric?track_id=${localTrackId}`, {
    pageEpoch: 7,
  });
  const noLyricResult = new Promise((resolve) => noLyric.success(resolve));
  bridge.emit({
    version: 2,
    terminal: 'ok',
    requestId: bridge.posted[1].requestId,
    pageEpoch: 7,
    status: 200,
    result: { status: 'no-lyric', lyric: '', tlyric: '' },
  });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(await noLyricResult)), {
    lyric: '',
    tlyric: '',
    source: 'localmusic',
    status: 'no-lyric',
  });

  const unavailable = provider.lyric(`/lyric?track_id=${localTrackId}`, {
    pageEpoch: 8,
  });
  const unavailableResult = new Promise((resolve) =>
    unavailable.success(resolve)
  );
  bridge.emit({
    version: 2,
    terminal: 'error',
    requestId: bridge.posted[2].requestId,
    pageEpoch: 8,
    status: 0,
    error: 'LOCAL_LYRIC_UNAVAILABLE',
  });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(await unavailableResult)), {
    lyric: '',
    tlyric: '',
    error: {
      status: 'android-rpc-local-lyric-unavailable',
      message: 'Local lyrics are unavailable on this Android device.',
    },
  });

  const rejected = context.window.Listen2AndroidHttpAdapter.request(
    'local.lyric.primary',
    { localTrackId: 'content://unsafe' },
    { pageEpoch: 9 }
  );
  await assert.rejects(
    rejected.promise,
    (error) => error.code === 'android-rpc-invalid-payload'
  );
  assert.strictEqual(bridge.posted.length, 3);
  console.log('Android local LRC RPC contract tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
