/* eslint-env node */
/* eslint-disable no-console, no-plusplus, no-restricted-syntax, no-await-in-loop, no-nested-ternary */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const MobileProviderRegistry = require('../js/mobile_provider_registry');

const PRIMARY = ['netease', 'kugou', 'kuwo', 'qq', 'bilibili'];
const IDENTITIES = [
  ['netease', 'netrack_42', 'audio'],
  ['kugou', 'kgtrack_HASH', 'audio'],
  ['kuwo', 'kwtrack_123', 'audio'],
  ['qq', 'qqtrack_abc', 'audio'],
  ['bilibili', 'bitrack_123', 'audio'],
  ['bilibili', 'bitrack_v_BV1xx411c7mD', 'audio'],
  ['bilibili', 'bitrack_v_BV1xx411c7mD-101', 'video-part'],
];

function assertExactKeys(value, keys) {
  assert.deepStrictEqual(Object.keys(value).sort(), keys.slice().sort());
}

function testRegistryAndIdentity() {
  assert.deepStrictEqual(
    MobileProviderRegistry.primarySources.map((source) => source.id),
    PRIMARY
  );
  assert.deepStrictEqual(
    MobileProviderRegistry.registrySources.slice(-2).map((source) => source.id),
    ['migu', 'taihe']
  );
  assert(
    MobileProviderRegistry.registrySources
      .slice(-2)
      .every((source) => source.primary === false)
  );
  assert(Object.isFrozen(MobileProviderRegistry.primarySources));

  IDENTITIES.forEach(([sourceId, itemId, variant]) => {
    const identity = MobileProviderRegistry.toTrackIdentity(
      sourceId,
      itemId,
      variant
    );
    assert.deepStrictEqual(identity, { sourceId, itemId, variant });
    assert.strictEqual(
      MobileProviderRegistry.sourceForItemId(itemId),
      sourceId
    );
  });
  assert.strictEqual(
    MobileProviderRegistry.toTrackIdentity('qq', 'netrack_42', 'audio'),
    null
  );
  assert.strictEqual(
    MobileProviderRegistry.sourceForItemId('https://unsafe.example'),
    null
  );
  ['__proto__', 'constructor'].forEach((sourceId) => {
    assert.strictEqual(MobileProviderRegistry.descriptorFor(sourceId), null);
  });
  ['migu', 'taihe'].forEach((sourceId) => {
    assert.strictEqual(
      MobileProviderRegistry.descriptorFor(sourceId).primary,
      false
    );
  });
  assert.strictEqual(
    MobileProviderRegistry.toTrackIdentity(
      'bilibili',
      'bitrack_v_BV123456',
      'audio'
    ).itemId,
    'bitrack_v_BV123456'
  );
  assert.strictEqual(
    MobileProviderRegistry.toTrackIdentity(
      'bilibili',
      `bitrack_v_BV${'a'.repeat(32)}`,
      'audio'
    ).sourceId,
    'bilibili'
  );

  const appSource = fs.readFileSync(
    path.join(__dirname, '../js/app.js'),
    'utf8'
  );
  const lowebSource = fs.readFileSync(
    path.join(__dirname, '../js/loweb.js'),
    'utf8'
  );
  assert(appSource.includes('MobileProviderRegistry.desktopSources'));
  assert(lowebSource.includes('registry.projectCapabilityMatrix'));
  assert.strictEqual(
    lowebSource.includes('ANDROID_UNVERIFIED_PROVIDERS'),
    false
  );
  assert(lowebSource.includes("name: 'xiami'"));
  assert(lowebSource.includes("name: 'localmusic'"));
}

function testCapabilityProjection() {
  const nativeMatrix = {
    netease: {
      search: true,
      lyric: true,
      url: 'https://unsafe.example',
      nested: { token: 'no' },
    },
  };
  const projection = MobileProviderRegistry.projectCapabilities(
    'netease',
    nativeMatrix,
    7
  );
  assert(Object.isFrozen(projection));
  assert.strictEqual(projection.search, true);
  assert.strictEqual(projection.lyric, true);
  assert.strictEqual(projection.media, false);
  assert.strictEqual(projection.capabilityEpoch, 7);
  assert.strictEqual(JSON.stringify(projection).includes('unsafe'), false);
  assert.strictEqual(JSON.stringify(projection).includes('nested'), false);
  assertExactKeys(projection, [
    'sourceId',
    'displayName',
    'primary',
    'availability',
    'accountRequired',
    'accountState',
    'retryable',
    'safeReason',
    'identityVariants',
    'capabilityEpoch',
    'search',
    'directory',
    'detail',
    'media',
    'lyric',
    'manualLyric',
    'fallback',
    'login',
    'permission',
  ]);
  const unknown = MobileProviderRegistry.projectCapabilities(
    'unknown',
    nativeMatrix,
    7
  );
  assert.strictEqual(unknown.availability, 'unavailable');
  assert.strictEqual(unknown.search, false);
}

async function testLifecycle() {
  const operations = ['search', 'directory', 'media', 'lyric', 'login'];
  let now = 1000;
  const timers = [];
  const lifecycle = MobileProviderRegistry.createSemanticOperationLifecycle({
    now: () => now,
    setTimeout: (fn) => {
      timers.push(fn);
      return fn;
    },
    clearTimeout: () => {},
    createRequestId: (() => {
      let value = 0;
      return () => `request-${++value}`;
    })(),
  });

  for (const operation of operations) {
    let callback;
    const handle = lifecycle.start({
      operation,
      sourceId: 'netease',
      pageEpoch: 3,
      deadlineMs: 20,
      payload:
        operation === 'search'
          ? { keyword: 'music', page: 1 }
          : operation === 'media'
          ? { itemId: 'netrack_42' }
          : operation === 'lyric'
          ? { itemId: 'netrack_42' }
          : {},
      capabilities: { [operation]: true },
      executor: (request, reply) => {
        callback = reply;
        assertExactKeys(request, [
          'operation',
          'sourceId',
          'requestId',
          'pageEpoch',
          'deadlineAt',
          'payload',
        ]);
      },
    });
    callback({
      operation,
      sourceId: 'netease',
      requestId: handle.request.requestId,
      pageEpoch: 3,
      terminal: 'ok',
      status: 'ok',
      code: null,
      result:
        operation === 'search'
          ? { rows: [] }
          : operation === 'lyric'
          ? { content: '' }
          : {},
    });
    const terminal = await handle.promise;
    assert.strictEqual(terminal.terminal, 'ok');
    callback({
      ...terminal,
      terminal: 'error',
      status: 'error',
      code: 'PROVIDER_ERROR',
      result: null,
    });
    assert.strictEqual(handle.ignoredReplies, 1);
  }

  let invoked = 0;
  const unavailable = lifecycle.start({
    operation: 'search',
    sourceId: 'qq',
    pageEpoch: 4,
    deadlineMs: 10,
    payload: { keyword: 'safe', page: 1 },
    capabilities: { search: false },
    executor: () => {
      invoked += 1;
    },
  });
  assert.strictEqual(invoked, 0);
  assert.strictEqual(unavailable.terminal.terminal, 'unavailable');
  assert.strictEqual((await unavailable.promise).code, 'OPERATION_UNAVAILABLE');

  const unexpectedExecutor = () => {
    invoked += 1;
  };
  for (const sourceId of ['migu', 'taihe', '__proto__', 'constructor']) {
    const blocked = lifecycle.start({
      operation: 'search',
      sourceId,
      pageEpoch: 4,
      deadlineMs: 10,
      payload: { keyword: 'safe', page: 1 },
      capabilities: { search: true },
      executor: unexpectedExecutor,
    });
    assert.strictEqual((await blocked.promise).code, 'OPERATION_UNAVAILABLE');
  }
  assert.strictEqual(
    invoked,
    0,
    'non-primary/prototype sources never dispatch'
  );

  const invalidIdentity = lifecycle.start({
    operation: 'media',
    sourceId: 'netease',
    pageEpoch: 4,
    deadlineMs: 10,
    payload: { itemId: 'https://unsafe.example' },
    capabilities: { media: true },
    executor: () => {
      invoked += 1;
    },
  });
  assert.strictEqual((await invalidIdentity.promise).code, 'INVALID_REQUEST');
  assert.strictEqual(invoked, 0, 'transport-shaped identities never dispatch');

  let timeoutReply;
  let abortCount = 0;
  const timeout = lifecycle.start({
    operation: 'lyric',
    sourceId: 'netease',
    pageEpoch: 5,
    deadlineMs: 10,
    payload: { itemId: 'netrack_42' },
    capabilities: { lyric: true },
    executor: (_request, reply) => {
      timeoutReply = reply;
      return () => {
        abortCount += 1;
      };
    },
  });
  timers.pop()();
  assert.strictEqual((await timeout.promise).code, 'DEADLINE_EXCEEDED');
  assert.strictEqual(
    abortCount,
    1,
    'deadline aborts the executor before settling'
  );
  timeoutReply({
    ...timeout.request,
    terminal: 'ok',
    status: 'ok',
    code: null,
    result: {},
  });
  assert.strictEqual(timeout.ignoredReplies, 1);

  let crossSourceReply;
  const crossSource = lifecycle.start({
    operation: 'search',
    sourceId: 'netease',
    pageEpoch: 5,
    deadlineMs: 10,
    payload: { keyword: 'safe', page: 1 },
    capabilities: { search: true },
    executor: (_request, reply) => {
      crossSourceReply = reply;
    },
  });
  crossSourceReply({
    ...crossSource.request,
    terminal: 'ok',
    status: 'ok',
    code: null,
    result: {
      rows: [
        {
          sourceId: 'qq',
          itemId: 'qqtrack_unsafe',
          title: 'wrong source',
          artist: 'wrong source',
        },
      ],
    },
  });
  assert.strictEqual((await crossSource.promise).code, 'INVALID_RESPONSE');

  let immutableReply;
  const immutable = lifecycle.start({
    operation: 'search',
    sourceId: 'netease',
    pageEpoch: 5,
    deadlineMs: 10,
    payload: { keyword: 'safe', page: 1 },
    capabilities: { search: true },
    executor: (_request, reply) => {
      immutableReply = reply;
    },
  });
  immutableReply({
    ...immutable.request,
    terminal: 'ok',
    status: 'ok',
    code: null,
    result: {
      rows: [
        {
          sourceId: 'netease',
          itemId: 'netrack_42',
          title: 'safe',
          artist: 'safe',
        },
      ],
    },
  });
  const immutableTerminal = await immutable.promise;
  assert(Object.isFrozen(immutableTerminal.result.rows));
  assert(Object.isFrozen(immutableTerminal.result.rows[0]));

  const cancelled = lifecycle.start({
    operation: 'media',
    sourceId: 'netease',
    pageEpoch: 6,
    deadlineMs: 10,
    payload: { itemId: 'netrack_42' },
    capabilities: { media: true },
    executor: () => {},
  });
  cancelled.cancel();
  assert.strictEqual((await cancelled.promise).code, 'CANCELLED');

  const destroyed = lifecycle.start({
    operation: 'login',
    sourceId: 'netease',
    pageEpoch: 7,
    deadlineMs: 10,
    payload: {},
    capabilities: { login: true },
    executor: () => {},
  });
  lifecycle.destroy(7);
  assert.strictEqual((await destroyed.promise).code, 'CANCELLED');

  now += 1;
}

async function main() {
  testRegistryAndIdentity();
  testCapabilityProjection();
  await testLifecycle();
  console.log('mobile provider registry contract passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
