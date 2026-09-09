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

  const status = adapter.deepSeek.status({ pageEpoch: 2 });
  const statusRequest = nativeBridge.posted[0];
  assert.strictEqual(statusRequest.operation, 'deepseek.translation.status');
  assert.deepStrictEqual(statusRequest.payload, {});
  nativeBridge.emit({
    version: 2,
    terminal: 'ok',
    requestId: statusRequest.requestId,
    pageEpoch: 2,
    status: 200,
    result: {
      ok: true,
      status: 'ok',
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      targetLanguage: 'zh-CN',
      secureStorageAvailable: true,
      hasApiKey: false,
      nativeClientAvailable: true,
      errorCode: null,
    },
  });
  assert.strictEqual((await status.promise).nativeClientAvailable, true);

  const configure = adapter.deepSeek.configure('fixture-secret', {
    pageEpoch: 2,
  });
  const configureRequest = nativeBridge.posted[1];
  assert.strictEqual(
    configureRequest.operation,
    'deepseek.translation.configure'
  );
  assert.deepStrictEqual(configureRequest.payload, {
    apiKey: 'fixture-secret',
  });
  nativeBridge.emit({
    version: 2,
    terminal: 'ok',
    requestId: configureRequest.requestId,
    pageEpoch: 2,
    status: 200,
    result: {
      ok: true,
      status: 'ok',
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      targetLanguage: 'zh-CN',
      secureStorageAvailable: true,
      hasApiKey: true,
      nativeClientAvailable: true,
      errorCode: null,
    },
  });
  const configured = await configure.promise;
  assert.strictEqual(configured.hasApiKey, true);
  assert.ok(!JSON.stringify(configured).includes('fixture-secret'));

  const consent = {
    lyrics: true,
    title: true,
    artist: true,
    possibleCost: true,
    cancellation: true,
    failureImpact: true,
    acceptedAtEpochMs: 1725000000000,
  };
  const translate = adapter.deepSeek.translate(
    {
      lyric: '[00:01.00]One\n[00:02.00]Two',
      title: 'Title',
      artist: 'Artist',
      styleHint: '',
      consent,
    },
    { pageEpoch: 3 }
  );
  const translateRequest = nativeBridge.posted[2];
  assert.strictEqual(
    translateRequest.operation,
    'deepseek.translation.translate'
  );
  assert.deepStrictEqual(Object.keys(translateRequest.payload).sort(), [
    'artist',
    'consent',
    'lyric',
    'styleHint',
    'title',
  ]);
  nativeBridge.emit({
    version: 2,
    terminal: 'ok',
    requestId: translateRequest.requestId,
    pageEpoch: 3,
    status: 200,
    result: {
      ok: true,
      status: 'ok',
      httpStatus: 200,
      retryable: false,
      tlyric: '[00:01.00]一\n[00:02.00]二',
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      promptVersion: 'deepseek-lyrics-v2',
      promptFingerprint: 'a'.repeat(64),
      targetLanguage: 'zh-CN',
      lineCount: 2,
      promptTokens: 1,
      completionTokens: 2,
      totalTokens: 3,
    },
  });
  const translated = await translate.promise;
  assert.strictEqual(translated.tlyric, '[00:01.00]一\n[00:02.00]二');
  assert.ok(!JSON.stringify(translated).includes('One'));

  await assert.rejects(
    adapter.deepSeek.translate(
      {
        lyric: '[00:01.00]One',
        title: 'Title',
        artist: 'Artist',
        styleHint: '',
        consent: { ...consent, possibleCost: false },
      },
      { pageEpoch: 4 }
    ).promise,
    (error) => error.code === 'android-rpc-invalid-payload'
  );

  const cancellable = adapter.deepSeek.translate(
    {
      lyric: '[00:01.00]One',
      title: 'Title',
      artist: 'Artist',
      styleHint: '',
      consent,
    },
    { pageEpoch: 5 }
  );
  const cancellableRequest = nativeBridge.posted[3];
  cancellable.cancel();
  await assert.rejects(
    cancellable.promise,
    (error) => error.code === 'android-rpc-cancelled'
  );
  assert.strictEqual(nativeBridge.posted[4].operation, 'rpc.cancel');
  assert.strictEqual(
    nativeBridge.posted[4].payload.targetRequestId,
    cancellableRequest.requestId
  );

  console.log('Android DeepSeek RPC contract tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
