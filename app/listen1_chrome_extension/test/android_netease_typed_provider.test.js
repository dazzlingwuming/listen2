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

  const booted = new Promise((resolve) => {
    provider.bootstrap_track(
      { id: 'netrack_42', source: 'netease' },
      (value) => resolve({ success: value }),
      (error) => resolve({ error }),
      { pageEpoch: 10, selectionRevision: 3 }
    );
  });
  assert.strictEqual(bridge.posted[4].operation, 'netease.rendition.default');
  assert.deepStrictEqual(toPlain(bridge.posted[4].payload), {
    trackId: '42',
    selectionRevision: 3,
  });
  bridge.emit({
    version: 2,
    terminal: 'error',
    requestId: bridge.posted[4].requestId,
    pageEpoch: 10,
    status: 0,
    error: 'NETEASE_ROUTE_UNAVAILABLE',
  });
  assert.deepStrictEqual(toPlain(await booted), {
    error: {
      status: 'android-rpc-unavailable-route',
      message: 'NetEase is unavailable on this Android device.',
    },
  });

  const lyric = provider.lyric('/lyric?track_id=netrack_42', {
    pageEpoch: 11,
    trackInfo: {
      id: 'netrack_42',
      nativeLyricIdentity: {
        selectionIdentity: 'occurrence-42',
        selectionRevision: 3,
        selectionToken: 'selection-42',
      },
    },
  });
  const lyricResult = new Promise((resolve) => lyric.success(resolve));
  assert.strictEqual(bridge.posted[5].operation, 'netease.lyric.primary');
  assert.deepStrictEqual(toPlain(bridge.posted[5].payload), {
    trackId: '42',
    selectionIdentity: 'occurrence-42',
    selectionRevision: 3,
    selectionToken: 'selection-42',
  });
  bridge.emit({
    version: 2,
    terminal: 'ok',
    requestId: bridge.posted[5].requestId,
    pageEpoch: 11,
    status: 200,
    result: { lyric: '[00:00.00]typed lyric', tlyric: '[00:00.00]翻译' },
  });
  assert.deepStrictEqual(toPlain(await lyricResult), {
    lyric: '[00:00.00]typed lyric',
    tlyric: '[00:00.00]翻译',
    source: 'netease',
  });

  const selection = provider.save_manual_lyric(
    'netrack_42',
    { id: 'manual-42' },
    {
      pageEpoch: 12,
      nativeLyricIdentity: {
        selectionIdentity: 'occurrence-42',
        selectionRevision: 3,
        selectionToken: 'selection-42',
      },
    }
  );
  assert.strictEqual(bridge.posted[6].operation, 'lyric.selection.set');
  assert.deepStrictEqual(toPlain(bridge.posted[6].payload), {
    trackId: '42',
    selectionIdentity: 'occurrence-42',
    selectionRevision: 3,
    selectionToken: 'selection-42',
    lyricId: 'manual-42',
  });
  bridge.emit({
    version: 2,
    terminal: 'ok',
    requestId: bridge.posted[6].requestId,
    pageEpoch: 12,
    status: 200,
    result: { saved: true },
  });
  assert.deepStrictEqual(toPlain(await selection.promise), {
    ok: true,
    status: 'saved',
  });

  const directory = provider.get_playlist('/playlist?list_id=neplaylist_42', {
    pageEpoch: 13,
  });
  const directoryResult = new Promise((resolve) => directory.success(resolve));
  assert.strictEqual(bridge.posted[7].operation, 'netease.directory.detail');
  assert.deepStrictEqual(toPlain(bridge.posted[7].payload), { trackId: '42' });
  bridge.emit({
    version: 2,
    terminal: 'ok',
    requestId: bridge.posted[7].requestId,
    pageEpoch: 13,
    status: 200,
    result: { tracks: [], info: { id: 'neplaylist_42', title: 'Typed list' } },
  });
  assert.deepStrictEqual(toPlain(await directoryResult), {
    tracks: [],
    info: { id: 'neplaylist_42', title: 'Typed list' },
  });

  const candidates = provider.search_lyric_candidates({
    id: 'netrack_42',
    query: 'typed lyric',
    pageEpoch: 14,
    nativeLyricIdentity: {
      selectionIdentity: 'occurrence-42',
      selectionRevision: 3,
      selectionToken: 'selection-42',
    },
  });
  assert.strictEqual(bridge.posted[8].operation, 'netease.lyric.search');
  assert.deepStrictEqual(toPlain(bridge.posted[8].payload), {
    trackId: '42',
    selectionIdentity: 'occurrence-42',
    selectionRevision: 3,
    selectionToken: 'selection-42',
    keyword: 'typed lyric',
  });
  bridge.emit({
    version: 2,
    terminal: 'ok',
    requestId: bridge.posted[8].requestId,
    pageEpoch: 14,
    status: 200,
    result: {
      rows: [
        {
          id: 'manual-42',
          lyric: '[00:00.00]manual',
          tlyric: '[00:00.00]手动',
          title: 'Typed song',
          artist: 'Typed artist',
        },
      ],
    },
  });
  assert.deepStrictEqual(toPlain(await candidates.promise), [
    {
      id: 'manual-42',
      lyric: '[00:00.00]manual',
      tlyric: '[00:00.00]手动',
      title: 'Typed song',
      artist: 'Typed artist',
      source: 'netease',
    },
  ]);

  const cleared = provider.clear_manual_lyric('netrack_42', {
    pageEpoch: 15,
    nativeLyricIdentity: {
      selectionIdentity: 'occurrence-42',
      selectionRevision: 3,
      selectionToken: 'selection-42',
    },
  });
  assert.strictEqual(bridge.posted[9].operation, 'lyric.selection.clear');
  cleared.cancel();
  await assert.rejects(
    cleared.promise,
    (error) => error.status === 'android-rpc-cancelled'
  );

  const offset = provider.set_lyric_offset('netrack_42', 250, {
    pageEpoch: 16,
    nativeLyricIdentity: {
      selectionIdentity: 'occurrence-42',
      selectionRevision: 3,
      selectionToken: 'selection-42',
    },
  });
  assert.strictEqual(bridge.posted[11].operation, 'lyric.offset.set');
  assert.deepStrictEqual(toPlain(bridge.posted[11].payload), {
    trackId: '42',
    selectionIdentity: 'occurrence-42',
    selectionRevision: 3,
    selectionToken: 'selection-42',
    offsetMs: 250,
  });
  bridge.emit({
    version: 2,
    terminal: 'ok',
    requestId: bridge.posted[11].requestId,
    pageEpoch: 16,
    status: 200,
    result: { saved: true },
  });
  assert.deepStrictEqual(toPlain(await offset.promise), {
    ok: true,
    status: 'saved',
  });

  console.log('Android typed NetEase provider tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
