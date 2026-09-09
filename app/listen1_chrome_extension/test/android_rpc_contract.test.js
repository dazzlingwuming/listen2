/* eslint-env node */
/* eslint-disable no-console */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'js', 'lowebutil.js'),
  'utf8'
);

function bridge() {
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

async function run() {
  const nativeBridge = bridge();
  const context = {
    URL,
    clearTimeout,
    console,
    setTimeout,
    window: { Listen2AndroidHttp: nativeBridge },
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'lowebutil.js' });
  const adapter = context.window.Listen2AndroidHttpAdapter;

  const current = adapter.request(
    'bilibili.search',
    { keyword: '  Android Song  ', page: 3 },
    { pageEpoch: 8 }
  );
  assert.strictEqual(typeof current.cancel, 'function');
  assert.strictEqual(typeof current.promise.then, 'function');
  assert.strictEqual(current.pageEpoch, 8);
  assert.strictEqual(nativeBridge.posted.length, 1);
  const request = nativeBridge.posted[0];
  assert.deepStrictEqual(Object.keys(request).sort(), [
    'operation',
    'pageEpoch',
    'payload',
    'requestId',
    'version',
  ]);
  assert.strictEqual(request.version, 2);
  assert.strictEqual(request.operation, 'bilibili.search');
  assert.strictEqual(request.pageEpoch, 8);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(request.payload)), {
    keyword: 'Android Song',
    page: 3,
  });

  nativeBridge.emit({
    version: 2,
    terminal: 'ok',
    requestId: request.requestId,
    pageEpoch: 7,
    status: 200,
    result: { source: 'bilibili', total: 1, rows: [] },
  });
  nativeBridge.emit({
    version: 2,
    terminal: 'ok',
    requestId: request.requestId,
    pageEpoch: 8,
    status: 200,
    result: { source: 'bilibili', total: 1, rows: [] },
  });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(await current.promise)), {
    status: 200,
    result: { source: 'bilibili', total: 1, rows: [] },
  });

  const cancelled = adapter.request(
    'bilibili.video.detail',
    { bvid: 'BV1xx411c7mD' },
    { pageEpoch: 9 }
  );
  const cancelledRequest = nativeBridge.posted[1];
  cancelled.cancel();
  cancelled.cancel();
  assert.strictEqual(nativeBridge.posted.length, 3);
  assert.deepStrictEqual(nativeBridge.posted[2], {
    version: 2,
    operation: 'rpc.cancel',
    requestId: nativeBridge.posted[2].requestId,
    pageEpoch: 9,
    payload: {
      targetRequestId: cancelledRequest.requestId,
      targetPageEpoch: 9,
    },
  });
  await assert.rejects(
    cancelled.promise,
    (error) =>
      error.code === 'android-rpc-cancelled' && error.retryable === false
  );
  nativeBridge.emit({
    version: 2,
    terminal: 'ok',
    requestId: cancelledRequest.requestId,
    pageEpoch: 9,
    status: 200,
    result: { bvid: 'BV1xx411c7mD', pages: [] },
  });

  const manifest = adapter.request(
    'bilibili.audio.manifest',
    { bvid: 'BV1xx411c7mD', selectionMode: 'explicit', cid: 42 },
    { pageEpoch: 10 }
  );
  await assert.rejects(
    manifest.promise,
    (error) =>
      error.code === 'android-rpc-invalid-operation' &&
      nativeBridge.posted.length === 3
  );

  const rejected = adapter.request(
    'bilibili.search',
    { keyword: 'Music', page: 1 },
    { pageEpoch: 11 }
  );
  const rejectedRequest = nativeBridge.posted[3];
  nativeBridge.emit({
    version: 2,
    terminal: 'error',
    requestId: rejectedRequest.requestId,
    pageEpoch: 11,
    status: 412,
    error: 'HTTP_STATUS',
  });
  await assert.rejects(
    rejected.promise,
    (error) =>
      error.code === 'android-rpc-provider-status' &&
      error.kind === 'provider-status' &&
      error.retryable === true
  );

  const timedOut = adapter.request(
    'bilibili.search',
    { keyword: 'timeout', page: 1 },
    { pageEpoch: 11, timeoutMs: 1 }
  );
  await assert.rejects(
    timedOut.promise,
    (error) => error.code === 'android-rpc-timeout' && error.kind === 'timeout'
  );
  assert.strictEqual(nativeBridge.posted[5].operation, 'rpc.cancel');

  const teardown = adapter.request(
    'bilibili.video.detail',
    { bvid: 'BV1xx411c7mD' },
    { pageEpoch: 12 }
  );
  adapter.teardown();
  await assert.rejects(
    teardown.promise,
    (error) => error.code === 'android-rpc-cancelled'
  );

  const sameEpochFirst = adapter.request(
    'bilibili.search',
    { keyword: 'first', page: 1 },
    { pageEpoch: 13 }
  );
  const sameEpochSecond = adapter.request(
    'bilibili.search',
    { keyword: 'second', page: 1 },
    { pageEpoch: 13 }
  );
  adapter.cancelPageEpoch(13);
  await Promise.all([
    assert.rejects(
      sameEpochFirst.promise,
      (error) => error.code === 'android-rpc-cancelled'
    ),
    assert.rejects(
      sameEpochSecond.promise,
      (error) => error.code === 'android-rpc-cancelled'
    ),
  ]);

  const queueRejected = adapter.request(
    'bilibili.search',
    { keyword: 'queue', page: 1 },
    { pageEpoch: 14 }
  );
  const queueRequest = nativeBridge.posted[nativeBridge.posted.length - 1];
  nativeBridge.emit({
    version: 2,
    terminal: 'error',
    requestId: queueRequest.requestId,
    pageEpoch: 14,
    status: 0,
    error: 'QUEUE_FULL',
  });
  await assert.rejects(
    queueRejected.promise,
    (error) =>
      error.code === 'android-rpc-failed' && error.safeCode === 'QUEUE_FULL'
  );

  await assert.rejects(
    adapter.request(
      'bilibili.search',
      { keyword: '', page: 1 },
      { pageEpoch: 9 }
    ),
    (error) => error.code === 'android-rpc-invalid-payload'
  );
  await assert.rejects(
    adapter.request(
      'bilibili.search',
      { keyword: 'x', page: 1, url: 'https://evil.test' },
      { pageEpoch: 9 }
    ),
    (error) => error.code === 'android-rpc-invalid-payload'
  );
  await assert.rejects(
    adapter.request(
      'unknown.operation',
      { keyword: 'x', page: 1 },
      { pageEpoch: 9 }
    ),
    (error) => error.code === 'android-rpc-invalid-operation'
  );

  assert.strictEqual(adapter.getProviderCapabilities(), null);
  const capabilityEvents = [];
  const unsubscribe = adapter.onProviderCapabilities((capabilities) => {
    capabilityEvents.push(capabilities);
  });
  const capabilitiesPromise = adapter.startProviderCapabilities({
    pageEpoch: 15,
  });
  const capabilityRequest = nativeBridge.posted[nativeBridge.posted.length - 1];
  assert.strictEqual(capabilityRequest.operation, 'provider.capabilities');
  assert.deepStrictEqual(capabilityRequest.payload, {});
  nativeBridge.emit({
    version: 2,
    terminal: 'ok',
    requestId: capabilityRequest.requestId,
    pageEpoch: 15,
    status: 200,
    result: {
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
    },
  });
  const capabilities = await capabilitiesPromise;
  assert.strictEqual(capabilities.bilibili.media, true);
  assert.strictEqual(adapter.getProviderCapabilities(), capabilities);
  assert.ok(capabilityEvents.some((value) => value === capabilities));

  const accountBegin = adapter.account.qrBegin({ pageEpoch: 16 });
  const accountBeginRequest =
    nativeBridge.posted[nativeBridge.posted.length - 1];
  assert.strictEqual(
    accountBeginRequest.operation,
    'bilibili.account.qr.begin'
  );
  assert.deepStrictEqual(accountBeginRequest.payload, {});
  nativeBridge.emit({
    version: 2,
    terminal: 'ok',
    requestId: accountBeginRequest.requestId,
    pageEpoch: 16,
    status: 200,
    result: {
      sessionId: 'qr-session-1',
      status: 'waiting',
      expiresAtEpochMs: 1893456000000,
      qrUrl:
        'https://passport.bilibili.com/h5-app/passport/login/scan?qrcode_key=qr_session_1&navhide=1',
    },
  });
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(await accountBegin.promise)),
    {
      sessionId: 'qr-session-1',
      status: 'waiting',
      expiresAtEpochMs: 1893456000000,
      qrUrl:
        'https://passport.bilibili.com/h5-app/passport/login/scan?qrcode_key=qr_session_1&navhide=1',
    }
  );

  const accountPoll = adapter.account.poll('qr-session-1', { pageEpoch: 17 });
  const accountPollRequest =
    nativeBridge.posted[nativeBridge.posted.length - 1];
  assert.strictEqual(accountPollRequest.operation, 'bilibili.account.qr.poll');
  nativeBridge.emit({
    version: 2,
    terminal: 'ok',
    requestId: accountPollRequest.requestId,
    pageEpoch: 17,
    status: 200,
    result: {
      sessionId: 'qr-session-1',
      status: 'waiting',
      expiresAtEpochMs: 1893456000000,
      qrUrl:
        'https://passport.bilibili.com/h5-app/passport/login/scan?qrcode_key=qr_session_1&token=must-not-pass',
    },
  });
  await assert.rejects(
    accountPoll.promise,
    (error) => error.code === 'android-rpc-malformed-response'
  );

  const failedRefresh = adapter.refreshProviderCapabilities({ pageEpoch: 18 });
  const failedCapabilityRequest =
    nativeBridge.posted[nativeBridge.posted.length - 1];
  nativeBridge.emit({
    version: 2,
    terminal: 'ok',
    requestId: failedCapabilityRequest.requestId,
    pageEpoch: 18,
    status: 200,
    result: { version: 1, bilibili: {}, netease: {} },
  });
  await assert.rejects(
    failedRefresh,
    (error) => error.code === 'android-rpc-malformed-response'
  );
  assert.strictEqual(adapter.getProviderCapabilities(), null);

  const localCapabilities = adapter.localData.query(
    'capabilities',
    {},
    {
      pageEpoch: 19,
    }
  );
  const localCapabilitiesRequest =
    nativeBridge.posted[nativeBridge.posted.length - 1];
  assert.strictEqual(localCapabilitiesRequest.operation, 'local.data.query');
  assert.deepStrictEqual(localCapabilitiesRequest.payload, {
    action: 'capabilities',
    payload: {},
  });
  nativeBridge.emit({
    version: 2,
    terminal: 'ok',
    requestId: localCapabilitiesRequest.requestId,
    pageEpoch: 19,
    status: 200,
    result: {
      ok: true,
      status: 'OK',
      data: { playlists: true, favorites: true },
    },
  });
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(await localCapabilities.promise)),
    {
      ok: true,
      status: 'OK',
      data: { playlists: true, favorites: true },
    }
  );

  const localTracks = adapter.localData.query(
    'localTracks',
    {},
    {
      pageEpoch: 19,
    }
  );
  const localTracksRequest =
    nativeBridge.posted[nativeBridge.posted.length - 1];
  assert.deepStrictEqual(localTracksRequest.payload, {
    action: 'localTracks',
    payload: {},
  });
  nativeBridge.emit({
    version: 2,
    terminal: 'ok',
    requestId: localTracksRequest.requestId,
    pageEpoch: 19,
    status: 200,
    result: {
      ok: true,
      status: 'OK',
      data: {
        items: [
          {
            localTrackId:
              'local.track.0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
            source: 'local',
            title: 'Local song',
            artist: 'Local artist',
            durationMs: 120000,
            displayName: 'local-song.mp3',
            mime: 'audio/mpeg',
            cover: false,
            lrc: false,
            availability: 'available',
            grantReferenceId: 'saf.tree.1',
          },
        ],
      },
    },
  });
  const localTrackReply = await localTracks.promise;
  assert.strictEqual(localTrackReply.data.items[0].source, 'local');
  assert.ok(!JSON.stringify(localTrackReply).includes('content://'));
  assert.ok(
    !Object.prototype.hasOwnProperty.call(localTrackReply.data.items[0], 'uri')
  );

  const localRepair = adapter.localData.command(
    'localTracks.repair',
    {
      grantReferenceId: 'saf.tree.1',
    },
    { pageEpoch: 19 }
  );
  const localRepairRequest =
    nativeBridge.posted[nativeBridge.posted.length - 1];
  assert.deepStrictEqual(localRepairRequest.payload, {
    action: 'localTracks.repair',
    payload: { grantReferenceId: 'saf.tree.1' },
  });
  nativeBridge.emit({
    version: 2,
    terminal: 'ok',
    requestId: localRepairRequest.requestId,
    pageEpoch: 19,
    status: 200,
    result: { ok: false, status: 'GRANT_INVALID' },
  });
  const localRepairReply = await localRepair.promise;
  assert.strictEqual(localRepairReply.status, 'GRANT_INVALID');

  const safPicker = adapter.localData.command(
    'saf.pickAudio',
    {},
    {
      pageEpoch: 20,
    }
  );
  const safPickerRequest = nativeBridge.posted[nativeBridge.posted.length - 1];
  assert.strictEqual(safPickerRequest.operation, 'local.data.command');
  assert.deepStrictEqual(safPickerRequest.payload, {
    action: 'saf.pickAudio',
    payload: {},
  });
  nativeBridge.emit({
    version: 2,
    terminal: 'ok',
    requestId: safPickerRequest.requestId,
    pageEpoch: 20,
    status: 200,
    result: { accepted: true, status: 'pending' },
  });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(await safPicker.promise)), {
    accepted: true,
    status: 'pending',
  });

  const unavailableSafPicker = adapter.localData.command(
    'saf.pickTree',
    {},
    {
      pageEpoch: 21,
    }
  );
  const unavailableSafPickerRequest =
    nativeBridge.posted[nativeBridge.posted.length - 1];
  nativeBridge.emit({
    version: 2,
    terminal: 'error',
    requestId: unavailableSafPickerRequest.requestId,
    pageEpoch: 21,
    status: 0,
    error: 'PLATFORM_ACTION_UNAVAILABLE',
  });
  await assert.rejects(
    unavailableSafPicker.promise,
    (error) =>
      error.code === 'android-rpc-local-data-unavailable' &&
      error.retryable === false
  );

  await assert.rejects(
    adapter.localData.command(
      'cache.capacity',
      { capacityBytes: 1 },
      { pageEpoch: 22 }
    ),
    (error) => error.code === 'android-rpc-invalid-payload'
  );

  const unsafeLocalReply = adapter.localData.query(
    'settings',
    {},
    {
      pageEpoch: 23,
    }
  );
  const unsafeLocalReplyRequest =
    nativeBridge.posted[nativeBridge.posted.length - 1];
  nativeBridge.emit({
    version: 2,
    terminal: 'ok',
    requestId: unsafeLocalReplyRequest.requestId,
    pageEpoch: 23,
    status: 200,
    result: {
      ok: true,
      status: 'OK',
      data: { cachePath: '/private/data' },
    },
  });
  await assert.rejects(
    unsafeLocalReply.promise,
    (error) => error.code === 'android-rpc-local-data-unavailable'
  );
  context.window.Listen2AndroidHttp = null;
  await assert.rejects(
    adapter.localData.query('settings', {}, { pageEpoch: 24 }),
    (error) => error.code === 'android-rpc-local-data-unavailable'
  );
  unsubscribe();

  console.log('Android RPC v2 contract tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
