/* eslint-env node */
/* eslint-disable no-console */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const fixtures = require('./fixtures/android_bilibili');

const extensionRoot = path.join(__dirname, '..');
const adapterSource = fs.readFileSync(
  path.join(extensionRoot, 'js', 'lowebutil.js'),
  'utf8'
);
const providerSource = fs.readFileSync(
  path.join(extensionRoot, 'js', 'provider', 'bilibili.js'),
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

function createProviderContext(bridge) {
  const context = {
    URL,
    clearTimeout,
    console,
    setTimeout,
    window: { Listen2AndroidHttp: bridge },
    DOMParser: class {
      // eslint-disable-next-line class-methods-use-this
      parseFromString(value) {
        return { body: { textContent: String(value).replace(/<[^>]+>/g, '') } };
      }
    },
    axios: {
      get() {
        throw new Error('Android typed provider must not call axios.');
      },
    },
    cookieSet() {
      throw new Error('Android typed provider must not write cookies.');
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
  };
  vm.createContext(context);
  vm.runInContext(adapterSource, context, { filename: 'lowebutil.js' });
  vm.runInContext(
    `${providerSource}\nthis.BilibiliProviderForTest = bilibili;`,
    context,
    { filename: 'bilibili.js' }
  );
  return context.BilibiliProviderForTest;
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
  const provider = createProviderContext(bridge);

  const search = provider.search('/search?keywords=fixture&curpage=2', {
    pageEpoch: 4,
  });
  assert.strictEqual(search.requestId, bridge.posted[0].requestId);
  assert.strictEqual(search.pageEpoch, 4);
  assert.strictEqual(typeof search.cancel, 'function');
  assert.deepStrictEqual(toPlain(bridge.posted[0].payload), {
    keyword: 'fixture',
    page: 2,
  });
  const searched = new Promise((resolve) => search.success(resolve));
  terminal(bridge, bridge.posted[0], fixtures.SEARCH_SUCCESS);
  const searchResult = await searched;
  assert.strictEqual(searchResult.total, 1);
  assert.deepStrictEqual(toPlain(searchResult.result[0]), {
    artist: 'Fixture artist',
    artist_id: 'biartist_v_7',
    capability: 'part-selection-required',
    duration: 201,
    id: `bitrack_v_${fixtures.BVID}`,
    img_url: 'https://i0.hdslb.com/fixture-cover.jpg',
    provider: 'bilibili',
    resultType: 'video',
    source: 'bilibili',
    source_url: `https://www.bilibili.com/${fixtures.BVID}`,
    title: 'Android fixture song',
  });

  const defaultDetail = provider.get_video_context(
    `bitrack_v_${fixtures.BVID}`,
    { pageEpoch: 5 }
  );
  assert.strictEqual(bridge.posted[1].operation, 'bilibili.video.detail');
  terminal(bridge, bridge.posted[1], fixtures.DETAIL_MULTIPART);
  const defaultContext = await defaultDetail;
  assert.strictEqual(defaultContext.cid, 101);
  assert.strictEqual(
    defaultContext.resolvedTrackId,
    `bitrack_v_${fixtures.BVID}-101`
  );

  let bootSuccess = 0;
  const booted = new Promise((resolve, reject) => {
    provider.bootstrap_track(
      { id: `bitrack_v_${fixtures.BVID}-202`, source: 'bilibili' },
      (value) => {
        bootSuccess += 1;
        resolve(value);
      },
      reject,
      { pageEpoch: 6 }
    );
  });
  assert.strictEqual(bridge.posted[2].operation, 'bilibili.video.detail');
  terminal(bridge, bridge.posted[2], fixtures.DETAIL_MULTIPART);
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(bridge.posted[3].operation, 'bilibili.audio.manifest');
  assert.deepStrictEqual(toPlain(bridge.posted[3].payload), {
    bvid: fixtures.BVID,
    selectionMode: 'explicit',
    cid: 202,
  });
  terminal(bridge, bridge.posted[3], fixtures.MANIFEST_SUCCESS);
  const descriptor = await booted;
  assert.strictEqual(bootSuccess, 1);
  assert.deepStrictEqual(
    toPlain(descriptor.urlCandidates),
    fixtures.MANIFEST_SUCCESS.candidates
  );
  assert.strictEqual(descriptor.url, fixtures.MANIFEST_SUCCESS.candidates[0]);
  assert.strictEqual(descriptor.mimeType, 'audio/mp4');
  assert.strictEqual(descriptor.codecs, 'mp4a.40.2');
  assert.strictEqual(descriptor.expiry, 2147483647);

  let failures = 0;
  const invalidPart = new Promise((resolve) => {
    provider.bootstrap_track(
      { id: `bitrack_v_${fixtures.BVID}-999`, source: 'bilibili' },
      () => resolve({ unexpected: true }),
      (error) => {
        failures += 1;
        resolve(error);
      },
      { pageEpoch: 7 }
    );
  });
  assert.strictEqual(bridge.posted[4].operation, 'bilibili.video.detail');
  terminal(bridge, bridge.posted[4], fixtures.DETAIL_MULTIPART);
  const invalidPartError = await invalidPart;
  assert.strictEqual(failures, 1);
  assert.strictEqual(invalidPartError.kind, 'invalid-part');
  assert.strictEqual(
    bridge.posted.length,
    5,
    'wrong explicit CID cannot request a fallback manifest'
  );
  assert.strictEqual(invalidPartError.message.includes('999'), false);

  const safeFailure = new Promise((resolve) => {
    provider.search('/search?keywords=network&curpage=1').success(resolve);
  });
  bridge.emit({
    version: 2,
    terminal: 'error',
    requestId: bridge.posted[5].requestId,
    pageEpoch: bridge.posted[5].pageEpoch,
    status: 0,
    error: fixtures.ERROR_FIXTURES.NETWORK,
  });
  assert.deepStrictEqual(toPlain(await safeFailure), {
    result: [],
    total: 0,
    error: {
      status: 'android-rpc-network',
      message: 'Bilibili is unavailable while this device is offline.',
    },
  });

  console.log('Android typed Bilibili provider tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
