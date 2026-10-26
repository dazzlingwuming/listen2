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

async function run() {
  const bridge = createBridge();
  const context = {
    URL,
    clearTimeout,
    console,
    setTimeout,
    window: { Listen2AndroidHttp: bridge },
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'lowebutil.js' });
  const adapter = context.window.Listen2AndroidHttpAdapter;
  const descriptor = {
    source: 'bilibili',
    providerTrackId: 'BV1xx411c7mD',
    providerPartId: 7,
    title: 'Title',
    artist: 'Artist',
    durationMs: 120000,
    mediaKind: 'audio',
  };

  const started = adapter.mediaDownload.start(
    'download-1',
    descriptor,
    'download',
    { pageEpoch: 4 }
  );
  const request = bridge.posted[0];
  assert.strictEqual(request.operation, 'media.download.start');
  assert.deepStrictEqual(Object.keys(request.payload).sort(), [
    'descriptor',
    'operationId',
    'retention',
  ]);
  assert.ok(!JSON.stringify(request.payload).match(/url|cookie|header|path/i));
  bridge.emit({
    version: 2,
    terminal: 'ok',
    requestId: request.requestId,
    pageEpoch: 4,
    status: 0,
    result: {
      operationId: 'download-1',
      status: 'queued',
      source: 'bilibili',
      providerTrackId: 'BV1xx411c7mD',
      retention: 'download',
    },
  });
  assert.strictEqual((await started.promise).status, 'queued');

  const status = adapter.mediaDownload.status('download-1', { pageEpoch: 4 });
  assert.deepStrictEqual(bridge.posted[1].payload, {
    operationId: 'download-1',
  });
  bridge.emit({
    version: 2,
    terminal: 'ok',
    requestId: bridge.posted[1].requestId,
    pageEpoch: 4,
    status: 0,
    result: {
      operationId: 'download-1',
      status: 'completed',
      source: 'bilibili',
      providerTrackId: 'BV1xx411c7mD',
      retention: 'download',
      byteCount: 42,
    },
  });
  assert.strictEqual((await status.promise).byteCount, 42);

  await assert.rejects(
    adapter.mediaDownload.start(
      'download-2',
      { ...descriptor, url: 'https://evil.example' },
      'download'
    ).promise,
    (error) => error.code === 'android-rpc-invalid-payload'
  );
  console.log('Android media download RPC contract tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
