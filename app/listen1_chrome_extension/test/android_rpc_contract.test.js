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
  const manifestRequest = nativeBridge.posted[3];
  assert.deepStrictEqual(JSON.parse(JSON.stringify(manifestRequest.payload)), {
    bvid: 'BV1xx411c7mD',
    selectionMode: 'explicit',
    cid: 42,
  });
  nativeBridge.emit({
    version: 2,
    terminal: 'error',
    requestId: manifestRequest.requestId,
    pageEpoch: 10,
    status: 0,
    error: 'UNSUPPORTED_CODEC',
  });
  await assert.rejects(
    manifest.promise,
    (error) =>
      error.code === 'android-rpc-unsupported-codec' &&
      error.kind === 'unsupported-codec' &&
      error.message.indexOf('UNSUPPORTED_CODEC') === -1
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

  console.log('Android RPC v2 contract tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
