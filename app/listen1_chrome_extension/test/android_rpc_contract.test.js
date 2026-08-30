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
  assert.deepStrictEqual(JSON.parse(JSON.stringify(await current)), {
    status: 200,
    result: { source: 'bilibili', total: 1, rows: [] },
  });

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
