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
  assert.strictEqual(defaultContext.parts.length, 2);
  assert.strictEqual(defaultContext.parts[0].capability, 'playable');
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
  const descriptor = await booted;
  assert.strictEqual(bootSuccess, 1);
  assert.deepStrictEqual(toPlain(descriptor), {
    nativePlayback: true,
    bvid: fixtures.BVID,
    cid: 202,
    duration: 140,
    platform: 'bilibili',
  });
  assert.strictEqual(
    JSON.stringify(descriptor).includes('bilivideo'),
    false,
    'Android bootstrap must never receive a CDN candidate'
  );

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
  assert.strictEqual(bridge.posted[3].operation, 'bilibili.video.detail');
  terminal(bridge, bridge.posted[3], fixtures.DETAIL_MULTIPART);
  const invalidPartError = await invalidPart;
  assert.strictEqual(failures, 1);
  assert.strictEqual(invalidPartError.kind, 'invalid-part');
  assert.strictEqual(
    bridge.posted.length,
    4,
    'wrong explicit CID cannot cause a native stream request from the page'
  );
  assert.strictEqual(invalidPartError.message.includes('999'), false);

  const safeFailure = new Promise((resolve) => {
    provider.search('/search?keywords=network&curpage=1').success(resolve);
  });
  bridge.emit({
    version: 2,
    terminal: 'error',
    requestId: bridge.posted[4].requestId,
    pageEpoch: bridge.posted[4].pageEpoch,
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

  const directory = provider.show_playlist('/show_playlist?offset=0');
  assert.strictEqual(bridge.posted[5].operation, 'bilibili.directory.page');
  assert.deepStrictEqual(toPlain(bridge.posted[5].payload), { page: 1 });
  const directoryResult = new Promise((resolve) => directory.success(resolve));
  terminal(bridge, bridge.posted[5], {
    source: 'bilibili',
    provider: 'bilibili',
    rows: [
      {
        id: 'biplaylist_42',
        providerPlaylistId: 42,
        source: 'bilibili',
        provider: 'bilibili',
        title: 'Fixture chart',
        cover: 'https://i0.hdslb.com/chart.jpg',
      },
    ],
  });
  assert.deepStrictEqual(toPlain(await directoryResult), {
    result: [
      {
        cover_img_url: 'https://i0.hdslb.com/chart.jpg',
        title: 'Fixture chart',
        id: 'biplaylist_42',
        source_url: 'https://www.bilibili.com/audio/am42',
      },
    ],
  });

  const detail = provider.bi_get_playlist('/playlist?list_id=biplaylist_42');
  assert.strictEqual(bridge.posted[6].operation, 'bilibili.directory.detail');
  assert.deepStrictEqual(toPlain(bridge.posted[6].payload), {
    playlistId: '42',
  });
  const detailResult = new Promise((resolve) => detail.success(resolve));
  terminal(bridge, bridge.posted[6], {
    source: 'bilibili',
    provider: 'bilibili',
    info: {
      id: 'biplaylist_42',
      providerPlaylistId: 42,
      source: 'bilibili',
      provider: 'bilibili',
      title: 'Fixture chart',
      cover: 'https://i0.hdslb.com/chart.jpg',
    },
    tracks: [
      {
        id: 'bitrack_9001',
        providerTrackId: 9001,
        source: 'bilibili',
        provider: 'bilibili',
        title: 'Fixture audio',
        artist: 'Fixture singer',
        artistId: 'biartist_7',
        duration: 185,
        capability: 'playable',
        cover: 'https://i0.hdslb.com/audio.jpg',
      },
    ],
  });
  const detailValue = await detailResult;
  assert.strictEqual(detailValue.info.id, 'biplaylist_42');
  assert.strictEqual(detailValue.tracks[0].id, 'bitrack_9001');
  assert.strictEqual(detailValue.tracks[0].capability, 'playable');

  const lyricPromise = provider.resolve_lyric({
    trackId: `bitrack_v_${fixtures.BVID}-101`,
    title: 'Android fixture song',
    artist: 'Fixture artist',
    duration: 201,
    pageEpoch: 8,
  });
  assert.strictEqual(bridge.posted[7].operation, 'bilibili.video.detail');
  terminal(bridge, bridge.posted[7], fixtures.DETAIL_MULTIPART);
  await Promise.resolve();
  await Promise.resolve();
  assert.strictEqual(bridge.posted[8].operation, 'bilibili.lyric.primary');
  const lyricPayload = bridge.posted[8].payload;
  assert.strictEqual(lyricPayload.bvid, fixtures.BVID);
  assert.strictEqual(lyricPayload.cid, 101);
  assert.strictEqual(lyricPayload.selectionRevision, 0);
  terminal(bridge, bridge.posted[8], {
    lyric: '[00:01.00]Fixture line',
    tlyric: '[00:01.00]示例歌词',
    source: 'netease-match',
    matchedTitle: 'Android fixture song',
    matchedArtist: 'Fixture artist',
    matchedDurationSeconds: 201,
    matchScorePercent: 98,
    selectionIdentity: lyricPayload.selectionIdentity,
    selectionRevision: lyricPayload.selectionRevision,
    selectionToken: lyricPayload.selectionToken,
  });
  assert.deepStrictEqual(toPlain(await lyricPromise), {
    lyric: '[00:01.00]Fixture line',
    tlyric: '[00:01.00]示例歌词',
    source: 'netease-match',
    matchedTitle: 'Android fixture song',
    matchedArtist: 'Fixture artist',
    matchedDuration: 201,
    matchScore: 98,
  });

  console.log('Android typed Bilibili provider tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
