/* eslint-env node */
/* eslint-disable no-console */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const frontendRoot = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(frontendRoot, 'listen1.html'), 'utf8');
const gradle = fs.readFileSync(
  path.join(frontendRoot, '../../android/app/build.gradle'),
  'utf8'
);
const controllerPath = path.join(
  frontendRoot,
  'js/controller/instant_search.js'
);

function controllerScope(overrides = {}) {
  let definition;
  const events = {};
  const timeouts = [];
  const scope = {
    $on(name, handler) {
      events[name] = handler;
    },
    $watch() {},
    $broadcast() {},
  };
  const sandbox = {
    angular: {
      module() {
        return {
          controller(_name, value) {
            definition = value;
          },
        };
      },
    },
    window: {
      Listen2AndroidHttpAdapter: {
        isAvailable: () => true,
      },
    },
    document: { querySelector: () => null },
    i18next: { t: (value) => value },
    MediaService: {
      search() {
        return { success() {}, error() {} };
      },
      startAndroidProviderCapabilities() {
        return new Promise(() => {});
      },
    },
    sourceList: [
      { name: 'netease', searchable: true },
      { name: 'kugou', searchable: true },
      { name: 'kuwo', searchable: true },
      { name: 'qq', searchable: true },
      { name: 'bilibili', searchable: true },
      { name: 'migu', searchable: true },
    ],
    setTimeout,
    clearTimeout,
    console,
    ...overrides,
  };
  // The controller is an intentionally classic global script, so this focused
  // contract uses Node's VM only to observe its public Angular scope.
  vm.runInNewContext(
    fs.readFileSync(
      path.join(frontendRoot, 'js/mobile_provider_registry.js'),
      'utf8'
    ),
    sandbox
  );
  sandbox.MobileProviderRegistry = sandbox.window.MobileProviderRegistry;
  vm.runInNewContext(fs.readFileSync(controllerPath, 'utf8'), sandbox);
  const timeout = (fn) => {
    timeouts.push(fn);
    return fn;
  };
  timeout.cancel = () => {};
  definition[definition.length - 1](scope, timeout, { $broadcast() {} });
  return { scope, events, timeouts };
}

function scriptIndex(filename) {
  const marker = `src="${filename}"`;
  const index = html.indexOf(marker);
  assert.notStrictEqual(index, -1, `missing ${filename}`);
  return index;
}

async function run() {
  const registry = scriptIndex('js/mobile_provider_registry.js');
  [
    'js/provider/netease.js',
    'js/provider/kugou.js',
    'js/provider/kuwo.js',
    'js/provider/qq.js',
    'js/provider/bilibili.js',
  ].forEach((provider) => assert(scriptIndex(provider) < registry));
  [
    'js/loweb.js',
    'js/app.js',
    'js/controller/navigation.js',
    'js/controller/instant_search.js',
  ].forEach((consumer) => assert(registry < scriptIndex(consumer)));

  const includes = gradle.match(/^\s*include\s+'([^']+)'/gm) || [];
  assert.strictEqual(
    includes.filter(
      (line) => line === "        include 'js/mobile_provider_registry.js'"
    ).length,
    1
  );
  assert.strictEqual(gradle.includes("include 'js/**'"), false);
  assert.strictEqual(gradle.includes("include 'test/**'"), false);
  assert.strictEqual(gradle.includes("include 'package.json'"), false);
  const controller = fs.readFileSync(controllerPath, 'utf8');
  assert(controller.includes('registry.createSemanticOperationLifecycle'));
  assert(controller.includes('$scope.providerSearch'));
  assert.strictEqual(controller.includes("['netease', 'bilibili']"), false);

  const { scope } = controllerScope();
  assert.strictEqual(scope.tab, 'netease');
  assert.deepStrictEqual(
    Array.from(scope.sourceList, (source) => source.name),
    ['netease', 'kugou', 'kuwo', 'qq', 'bilibili']
  );
  assert.strictEqual(scope.providerSearch.sourceId, 'netease');
  assert.strictEqual(scope.providerSearch.state, 'pending');

  assert(html.includes('data-mobile-provider-search'));
  assert(html.includes('data-mobile-provider-selector'));
  assert(html.includes('role="tablist"'));
  assert(html.includes('aria-label="选择音乐来源"'));
  assert(html.includes('搜索歌曲、歌手或歌单'));
  assert(html.includes('providerSearch.skeletonRows'));
  assert(html.includes('输入关键词后选择来源，结果会显示在这里。'));
  const providerSurface = html.slice(
    html.indexOf('data-mobile-provider-search'),
    html.indexOf('<div ng-include="\'annual_recap.html\'"')
  );
  assert.strictEqual(providerSurface.includes('bilibiliSearch'), false);
  assert.strictEqual(providerSurface.includes('migu'), false);
  assert.strictEqual(providerSurface.includes('taihe'), false);

  const matrix = {
    netease: {
      displayName: '网易云音乐',
      search: true,
      safeReason: '',
      capabilityEpoch: 4,
    },
    qq: {
      displayName: 'QQ 音乐',
      search: false,
      safeReason: 'QQ 音乐暂不支持搜索。',
      capabilityEpoch: 4,
    },
  };
  let searchCalls = 0;
  const controlled = controllerScope({
    MediaService: {
      getAndroidProviderCapabilities: () => matrix,
      startAndroidProviderCapabilities: () => Promise.resolve(matrix),
      search(sourceId, options) {
        searchCalls += 1;
        assert.strictEqual(sourceId, 'netease');
        assert.deepStrictEqual(Object.keys(options).sort(), [
          'curpage',
          'keywords',
          'pageEpoch',
          'type',
        ]);
        let success;
        let failure;
        return {
          success(handler) {
            success = handler;
            return this;
          },
          error(handler) {
            failure = handler;
            return this;
          },
          cancel() {},
          reply() {
            success({
              result: [
                { id: 'netrack_42', title: '安全标题', artist: '安全歌手' },
              ],
              total: 1,
            });
          },
          fail() {
            failure({ status: 'android-rpc-network' });
          },
        };
      },
    },
  });
  await Promise.resolve();
  assert.strictEqual(controlled.scope.providerSearch.state, 'idle');
  controlled.scope.changeSourceTab('qq');
  assert.strictEqual(controlled.scope.providerSearch.state, 'unavailable');
  controlled.scope.keywords = '不会派发';
  controlled.scope.submitProviderSearch();
  await Promise.resolve();
  assert.strictEqual(searchCalls, 0);
  assert.strictEqual(controlled.scope.providerSearch.action, '返回其他来源');
  controlled.scope.changeSourceTab('netease');
  assert.strictEqual(controlled.scope.providerSearch.state, 'idle');
  assert.strictEqual(controlled.scope.providerSearch.capability.search, true);
  controlled.scope.keywords = '安全关键词';
  controlled.scope.submitProviderSearch();
  assert.strictEqual(searchCalls, 1);
  controlled.scope.cancelProviderSearch();
  await Promise.resolve();
  assert.strictEqual(controlled.scope.providerSearch.state, 'cancelled');
  console.log('Android mobile shell registry manifest contract passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
