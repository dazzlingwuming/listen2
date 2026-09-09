/* eslint-env node */
/* eslint-disable no-console */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const extensionRoot = path.join(__dirname, '..');
const read = (relativePath) =>
  fs.readFileSync(path.join(extensionRoot, relativePath), 'utf8');

const playSource = read('js/controller/play.js');
const navigationSource = read('js/controller/navigation.js');
const lowebSource = read('js/loweb.js');

function extractNamedFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notStrictEqual(start, -1, `${name} must exist`);
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Unable to parse ${name}`);
}

function extractAssignedArrow(source, name) {
  const marker = `$scope.${name} =`;
  const start = source.indexOf(marker);
  assert.notStrictEqual(start, -1, `${name} assignment must exist`);
  const expressionStart = source.indexOf('(', start);
  const bodyStart = source.indexOf('{', expressionStart);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(expressionStart, index + 1);
  }
  throw new Error(`Unable to parse ${name}`);
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function testNativeBackStack() {
  const handlerExpression = extractAssignedArrow(
    playSource,
    'handleAndroidPlayerBack'
  );
  const calls = [];
  const scope = {
    androidPlaybackEnabled: true,
    androidQueueConfirmation: { open: true },
    androidQueueSheetOpen: true,
    androidPlaybackDetailOpen: true,
    closeAndroidQueueConfirmation() {
      calls.push('queue-confirmation');
      this.androidQueueConfirmation.open = false;
    },
    closeAndroidQueueSheet() {
      calls.push('queue-sheet');
      this.androidQueueSheetOpen = false;
    },
    closeAndroidPlayerDetail() {
      calls.push('player-detail');
      this.androidPlaybackDetailOpen = false;
    },
  };
  const handler = vm.runInNewContext(`(${handlerExpression})`, {
    $scope: scope,
  });
  let prevented = 0;
  const event = {
    preventDefault: () => {
      prevented += 1;
    },
  };

  assert.strictEqual(handler(event), true);
  assert.strictEqual(handler(event), true);
  assert.strictEqual(handler(event), true);
  assert.strictEqual(handler(event), false);
  assert.deepStrictEqual(calls, [
    'queue-confirmation',
    'queue-sheet',
    'player-detail',
  ]);
  assert.strictEqual(prevented, 3);

  assert.ok(
    playSource.includes("$scope.$on('android:playback-back'") &&
      playSource.includes(
        'playbackBack.handled = $scope.handleAndroidPlayerBack'
      ),
    'PlayController must answer the native back broadcast synchronously'
  );
  assert.ok(
    navigationSource.includes(
      "$rootScope.$broadcast('android:playback-back', playbackBack)"
    ) && navigationSource.includes('if (playbackBack.handled)'),
    'NavigationController must let PlayController consume transient player UI'
  );
}

function testDeepSeekConfigSync() {
  const configScope = {
    machineTranslationConfig: {
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      hasApiKey: false,
    },
    events: [],
    $emit(event, payload) {
      this.events.push({ event, payload });
    },
  };
  const response = {
    ok: true,
    config: {
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      targetLanguage: 'zh-CN',
      hasApiKey: true,
      secureStorageAvailable: true,
      nativeClientAvailable: true,
      styleHint: 'natural',
    },
  };

  // Evaluate the pure response projector with a real scope object so this
  // test exercises the same event payload the controller emits.
  const scopedApply = vm.runInNewContext(
    `(${extractNamedFunction(
      playSource,
      'applyMachineTranslationConfigResponse'
    )})`,
    {
      isAndroidTranslationSurface: () => true,
      $scope: configScope,
    }
  );
  assert.strictEqual(scopedApply(response), true);
  assert.strictEqual(configScope.machineTranslationConfig.hasApiKey, true);
  assert.strictEqual(configScope.machineTranslationConfig.styleHint, 'natural');
  assert.deepStrictEqual(plain(configScope.events), [
    {
      event: 'android:deepseek-config-changed',
      payload: plain(configScope.machineTranslationConfig),
    },
  ]);
  assert.ok(
    navigationSource.includes("$scope.$on('android:deepseek-config-changed'") &&
      navigationSource.includes(
        '$scope.mobileDeepSeekStatus = {\n        ...$scope.mobileDeepSeekStatus,'
      ),
    'NavigationController must merge the synchronized Android DeepSeek status'
  );
}

function createLowebHarness() {
  const calls = [];
  const deepSeekCalls = [];
  const status = {
    ok: true,
    status: 'ok',
    provider: 'deepseek',
    model: 'deepseek-v4-flash',
    targetLanguage: 'zh-CN',
    secureStorageAvailable: true,
    hasApiKey: false,
    nativeClientAvailable: true,
    errorCode: null,
  };
  const adapter = {
    isAvailable: () => true,
    request(operation, payload, options = {}) {
      calls.push({ operation, payload, options });
      if (operation === 'lyric.content.get') {
        return {
          requestId: `read-${calls.length}`,
          pageEpoch: options.pageEpoch,
          cancel() {},
          promise: Promise.resolve({
            result: {
              status: 'found',
              revision: 7,
              originalText: '[00:01.00]Original',
              translationText: '[00:01.00]已有译文',
            },
          }),
        };
      }
      if (operation === 'lyric.content.put') {
        return {
          requestId: `write-${calls.length}`,
          pageEpoch: options.pageEpoch,
          cancel() {},
          promise: Promise.resolve({
            result: { status: 'saved', revision: 8 },
          }),
        };
      }
      throw new Error(`unexpected Android operation: ${operation}`);
    },
    deepSeek: {
      status: () => ({ promise: Promise.resolve(status) }),
      configure(apiKey) {
        deepSeekCalls.push(apiKey);
        return {
          promise: Promise.resolve({ ...status, hasApiKey: true }),
        };
      },
    },
  };
  const context = {
    URL,
    URLSearchParams,
    Promise,
    console,
    async: { parallel() {} },
    LRUCache: class {},
    setPrototypeOfLocalStorage() {},
    getLocalStorageValue() {
      return null;
    },
    isElectron: () => false,
    localStorage: {
      getObject: () => null,
      setObject() {},
    },
    window: { Listen2AndroidHttpAdapter: adapter },
  };
  [
    'netease',
    'xiami',
    'qq',
    'kugou',
    'kuwo',
    'bilibili',
    'migu',
    'taihe',
    'localmusic',
    'myplaylist',
  ].forEach((name) => {
    context[name] = {};
  });
  vm.createContext(context);
  vm.runInContext(
    `${lowebSource}\nthis.MediaServiceForTest = MediaService;`,
    context,
    { filename: 'loweb.js' }
  );
  return {
    calls,
    deepSeekCalls,
    mediaService: context.MediaServiceForTest,
  };
}

async function testPersistentLyricAndDeepSeekContracts() {
  const { calls, deepSeekCalls, mediaService } = createLowebHarness();
  const track = { id: 'netrack_42', source: 'netease', pageEpoch: 7 };
  const cached = await mediaService.getPersistentLyric(track);
  assert.deepStrictEqual(plain(cached.result), {
    lyric: '[00:01.00]Original',
    tlyric: '[00:01.00]已有译文',
    source: 'netease',
    machineTranslated: true,
    machineTranslationProvider: 'deepseek',
    lyricCacheRevision: 7,
  });
  assert.strictEqual(calls[0].operation, 'lyric.content.get');
  assert.deepStrictEqual(plain(calls[0].payload), {
    source: 'netease',
    providerTrackId: '42',
    providerPartId: 0,
    lyricRevision: 'content.v1',
    expectedRevision: 0,
    transitionToken: 'read.v1',
  });

  const saved = await mediaService.putPersistentLyric(
    track,
    { lyric: '[00:01.00]Original', tlyric: '[00:01.00]新译文' },
    'auto',
    cached.record.revision
  );
  assert.strictEqual(saved.ok, true);
  assert.strictEqual(calls[1].operation, 'lyric.content.get');
  assert.strictEqual(calls[2].operation, 'lyric.content.put');
  assert.deepStrictEqual(plain(calls[2].payload), {
    source: 'netease',
    providerTrackId: '42',
    providerPartId: 0,
    lyricRevision: 'content.v1',
    expectedRevision: 7,
    transitionToken: calls[2].payload.transitionToken,
    originalText: '[00:01.00]Original',
    translationText: '[00:01.00]新译文',
  });
  assert.match(calls[2].payload.transitionToken, /^put\./);

  const config = await mediaService.getMachineTranslationConfig();
  assert.strictEqual(config.ok, true);
  assert.strictEqual(config.config.secureStorageAvailable, true);
  const configured = await mediaService.setMachineTranslationConfig({
    apiKey: 'fixture-secret',
  });
  assert.deepStrictEqual(deepSeekCalls, ['fixture-secret']);
  assert.strictEqual(configured.config.hasApiKey, true);
  assert.ok(!JSON.stringify(configured).includes('fixture-secret'));

  const requestStart = playSource.indexOf('function requestTrackLyric(track)');
  const requestEnd = playSource.indexOf('$scope.openLyricPicker', requestStart);
  const requestSlice = playSource.slice(requestStart, requestEnd);
  assert.ok(
    requestSlice.indexOf('MediaService.getPersistentLyric') >= 0 &&
      requestSlice.indexOf('MediaService.getPersistentLyric') <
        requestSlice.indexOf('getProviderLyric(track)'),
    'Android lyric loading must consult persistent cache before provider fetch'
  );
  const translationStart = playSource.indexOf(
    'function applyAutomaticLyricTranslation'
  );
  const translationEnd = playSource.indexOf(
    'function persistAutomaticLyric',
    translationStart
  );
  const translationSlice = playSource.slice(translationStart, translationEnd);
  assert.ok(
    translationSlice.indexOf('applyLyricResult') >= 0 &&
      translationSlice.indexOf('applyLyricResult') <
        translationSlice.indexOf('MediaService.putPersistentLyric'),
    'successful Android lyric translation must persist after applying result'
  );
}

function testAndroidExternalNavigation() {
  const expression = extractAssignedArrow(playSource, 'openDeepSeekApiPage');
  const window = {
    location: { href: '' },
    open() {
      throw new Error('Android must use location navigation');
    },
  };
  const openApiPage = vm.runInNewContext(`(${expression})`, {
    isElectron: () => false,
    isAndroidTranslationSurface: () => true,
    window,
  });
  openApiPage();
  assert.strictEqual(
    window.location.href,
    'https://platform.deepseek.com/api_keys'
  );
  const androidBranch = playSource.slice(
    playSource.indexOf('$scope.openDeepSeekApiPage'),
    playSource.indexOf('$scope.clearMachineTranslationApiKey')
  );
  assert.ok(
    androidBranch.includes('window.location.href = url') &&
      androidBranch.indexOf('isAndroidTranslationSurface()') <
        androidBranch.indexOf('window.location.href = url'),
    'Android external links must use location navigation for NavigationPolicy'
  );
}

async function run() {
  testNativeBackStack();
  testDeepSeekConfigSync();
  await testPersistentLyricAndDeepSeekContracts();
  testAndroidExternalNavigation();
  process.stdout.write('android mobile behavior contract tests passed\n');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
