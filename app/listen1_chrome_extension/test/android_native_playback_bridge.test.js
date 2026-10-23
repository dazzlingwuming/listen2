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

function snapshot(pageEpoch, revision, prepared) {
  return {
    version: 2,
    operation: 'playback.snapshot',
    pageEpoch,
    snapshot: {
      version: 1,
      pageEpoch,
      revision,
      state: 'paused',
      metadata: {
        title: 'Song',
        artist: 'Artist',
        durationMs: 120000,
        artworkState: 'bundled-placeholder',
      },
      positionMs: 0,
      durationMs: 120000,
      volumePercent: 100,
      muted: false,
      mode: 'sequential',
      actions: {
        play: true,
        pause: true,
        previous: true,
        next: true,
        seek: true,
        retry: true,
      },
      queue: [],
      recovery: { status: 'ready', retryable: false },
      ...(prepared ? { prepared } : {}),
    },
  };
}

async function run() {
  const nativeBridge = createBridge();
  const context = {
    URL,
    clearTimeout,
    console,
    setTimeout,
    TextEncoder,
    window: { Listen2AndroidHttp: nativeBridge },
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'lowebutil.js' });
  const adapter = context.window.Listen2AndroidHttpAdapter;
  assert.strictEqual(typeof adapter.connect, 'function');
  assert.strictEqual(typeof adapter.prepareSelection, 'function');
  assert.strictEqual(typeof adapter.selectPrepared, 'function');
  assert.strictEqual(typeof adapter.command, 'function');
  assert.strictEqual(typeof adapter.subscribe, 'function');
  assert.strictEqual(typeof adapter.detach, 'function');

  const states = [];
  const connected = adapter.connect({
    pageEpoch: 7,
    onSnapshot: (value) => states.push(value),
  });
  assert.strictEqual(nativeBridge.posted.length, 1);
  assert.deepStrictEqual(nativeBridge.posted[0].payload, {
    expectedRevision: 0,
    command: 'subscribe',
    payload: {},
  });
  nativeBridge.emit({
    version: 2,
    terminal: 'ok',
    requestId: nativeBridge.posted[0].requestId,
    pageEpoch: 7,
    status: 0,
    result: { accepted: true, revision: 1 },
  });
  nativeBridge.emit(snapshot(7, 1));
  await connected.promise;
  assert.strictEqual(states.length, 1);

  const preparedPromise = adapter.prepareSelection({
    source: 'bilibili',
    bvid: 'BV1xx411c7mD',
    cid: 42,
    title: ' Song ',
    artist: ' Artist ',
    durationMs: 120000,
    mediaKind: 'audio',
  });
  const prepareRequest = nativeBridge.posted[1];
  assert.deepStrictEqual(prepareRequest.payload, {
    expectedRevision: 1,
    command: 'prepareSelection',
    payload: {
      source: 'bilibili',
      providerTrackId: 'BV1xx411c7mD',
      providerPartId: 42,
      title: 'Song',
      artist: 'Artist',
      durationMs: 120000,
      mediaKind: 'audio',
    },
  });
  nativeBridge.emit({
    version: 2,
    terminal: 'ok',
    requestId: prepareRequest.requestId,
    pageEpoch: 7,
    status: 0,
    result: { accepted: true, revision: 2 },
  });
  nativeBridge.emit(
    snapshot(7, 1, {
      trackHandle: 'caller-handle',
      occurrenceId: 'caller-occurrence',
      metadata: {},
    })
  );
  nativeBridge.emit(
    snapshot(8, 2, {
      trackHandle: 'wrong-epoch',
      occurrenceId: 'wrong-occurrence',
      metadata: {},
    })
  );
  nativeBridge.emit(
    snapshot(7, 2, {
      trackHandle: 'track-native',
      occurrenceId: 'occ-native',
      metadata: {},
    })
  );
  const prepared = await preparedPromise;
  assert.deepStrictEqual(JSON.parse(JSON.stringify(prepared)), {
    trackHandle: 'track-native',
    occurrenceId: 'occ-native',
    expectedRevision: 2,
  });
  assert.strictEqual(states.length, 2, 'stale snapshots never digest');

  const selected = adapter.selectPrepared(prepared, {
    action: 'replace-current',
    playWhenReady: true,
  });
  const selectRequest = nativeBridge.posted[2];
  assert.deepStrictEqual(selectRequest.payload, {
    expectedRevision: 2,
    command: 'selectPrepared',
    payload: {
      trackHandle: 'track-native',
      occurrenceId: 'occ-native',
      selectionAction: 'replace-current',
      playWhenReady: true,
    },
  });
  nativeBridge.emit({
    version: 2,
    terminal: 'ok',
    requestId: selectRequest.requestId,
    pageEpoch: 7,
    status: 0,
    result: { accepted: true, revision: 3 },
  });
  nativeBridge.emit(snapshot(7, 3));
  await selected;
  await assert.rejects(
    adapter.selectPrepared(prepared, {
      action: 'replace-current',
      playWhenReady: true,
    }),
    (error) => error.code === 'android-playback-invalid-prepared'
  );
  await assert.rejects(
    adapter.prepareSelection({
      source: 'bilibili',
      bvid: 'BV1xx411c7mD',
      cid: 42,
      title: 'Song',
      artist: 'Artist',
      durationMs: 1,
      mediaKind: 'audio',
      url: 'https://forbidden.example/media',
      headers: { Cookie: 'no' },
    }),
    (error) => error.code === 'android-playback-invalid-selection'
  );

  const first = adapter.command('play', {});
  const duplicate = adapter.command('play', {});
  await assert.rejects(
    duplicate,
    (error) => error.code === 'android-playback-pending'
  );
  const playRequest = nativeBridge.posted[3];
  nativeBridge.emit({
    version: 2,
    terminal: 'ok',
    requestId: playRequest.requestId,
    pageEpoch: 7,
    status: 0,
    result: { accepted: true, revision: 4 },
  });
  nativeBridge.emit(snapshot(7, 4));
  await first;
  const detached = adapter.command('pause', {});
  adapter.detach();
  await assert.rejects(
    detached,
    (error) => error.code === 'android-playback-cancelled'
  );
  assert.strictEqual(states.length, 4);
  console.log('android native playback bridge tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
