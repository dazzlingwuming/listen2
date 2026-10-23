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
  const watches = [];
  const scope = {
    $evalAsync(fn) { fn(); },
    $on(name, handler) {
      events[name] = handler;
    },
    $watch(expression, callback) {
      watches.push({ expression, callback, previous: undefined });
    },
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
  const digest = () => {
    for (let pass = 0; pass < 10; pass += 1) {
      let dirty = false;
      watches.forEach((watch) => {
        const next = watch.expression
          .split('.')
          .reduce((value, key) => value && value[key], scope);
        if (next !== watch.previous) {
          const previous = watch.previous;
          watch.previous = next;
          watch.callback(next, previous);
          dirty = true;
        }
      });
      if (!dirty) return;
    }
    assert.fail('search model watchers did not settle');
  };
  return { scope, events, timeouts, digest };
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

  const includes = gradle.replace(/\r\n/g, '\n').match(/^\s*include\s+'([^']+)'/gm) || [];
  assert.strictEqual(
    includes.filter(
      (line) => line === "        include 'js/mobile_provider_registry.js'"
    ).length,
    1
  );
  assert.strictEqual(gradle.includes("include 'js/**'"), false);
  assert.strictEqual(gradle.includes("include 'test/**'"), false);
  assert.strictEqual(gradle.includes("include 'package.json'"), false);
  const assetPatterns = includes.map((line) => {
    const value = line.match(/include\s+'([^']+)'/)[1];
    return new RegExp(`^${value.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
  });
  for (const script of html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)) {
    const asset = script[1].split(/[?#]/)[0];
    assert(assetPatterns.some((pattern) => pattern.test(asset)), `APK missing script: ${asset}`);
  }
  const controller = fs.readFileSync(controllerPath, 'utf8');
  assert(controller.includes('registry.createSemanticOperationLifecycle'));
  assert(controller.includes('$scope.providerSearch'));
  assert.strictEqual(controller.includes("['netease', 'bilibili']"), false);

  const { scope } = controllerScope();
  assert.strictEqual(scope.tab, 'bilibili');
  assert.deepStrictEqual(
    Array.from(scope.sourceList, (source) => source.name),
    ['bilibili']
  );
  assert.strictEqual(scope.providerSearch.sourceId, 'bilibili');
  assert.strictEqual(scope.providerSearch.state, 'pending');

  assert(html.includes('data-mobile-provider-search'));
  assert(html.includes('data-mobile-provider-selector'));
  assert(html.includes('role="tablist"'));
  assert(html.includes('aria-label="选择音乐来源"'));
  assert(html.includes('搜索歌曲、歌手或歌单'));
  assert(html.includes('providerSearch.skeletonRows'));
  assert(html.includes('搜索 B 站歌曲、歌手或视频，结果会显示在这里。'));
  const providerSurface = html.slice(
    html.indexOf('data-mobile-provider-search'),
    html.indexOf('<div ng-include="\'annual_recap.html\'"')
  );
  assert.match(
    providerSurface,
    /data-mobile-provider-search[\s\S]*?ng-if="isAndroidTyped\(\) && is_window_hidden==1 && current_tag==3"/,
    'the Android provider surface must not render in Electron'
  );
  assert.strictEqual(providerSurface.includes('bilibiliSearch'), false);
  assert.strictEqual(providerSurface.includes('migu'), false);
  assert.strictEqual(providerSurface.includes('taihe'), false);

  const matrix = {
    bilibili: {
      displayName: '哔哩哔哩',
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
        assert.strictEqual(sourceId, 'bilibili');
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
  assert.strictEqual(controlled.scope.tab, 'bilibili', 'Android stays on its enabled source');
  assert.strictEqual(controlled.scope.providerSearch.state, 'idle');
  assert.strictEqual(searchCalls, 0);
  controlled.scope.changeSourceTab('bilibili');
  assert.strictEqual(controlled.scope.providerSearch.state, 'idle');
  assert.strictEqual(controlled.scope.providerSearch.capability.search, true);
  controlled.scope.keywords = '安全关键词';
  controlled.scope.submitProviderSearch();
  assert.strictEqual(searchCalls, 1);
  controlled.scope.cancelProviderSearch();
  await Promise.resolve();
  assert.strictEqual(controlled.scope.providerSearch.state, 'cancelled');

  const requests = [];
  const nested = controllerScope({
    MediaService: {
      getAndroidProviderCapabilities: () => matrix,
      search(sourceId, options) {
        requests.push({ sourceId, ...options });
        return {
          success() {
            return this;
          },
          error() {
            return this;
          },
          cancel() {},
        };
      },
    },
  });
  // ng-if creates a prototypically inherited child scope. Run the real
  // template expressions against that child and the actual controller above.
  const child = Object.create(nested.scope);
  const input = html.match(/<input\s+id="mobile-provider-query"[\s\S]*?\/>/)[0];
  const model = input.match(/ng-model="([^"]+)"/)[1];
  const submit = html.match(
    /<button[^>]*ng-click="([^"]+)"[^>]*aria-label="搜索当前音乐来源"/
  )[1];
  child.typedValue = 'music';
  vm.runInNewContext(`${model} = typedValue`, child);
  const change = input.match(/ng-change="([^"]+)"/)[1];
  vm.runInNewContext(change, child);
  nested.digest();
  assert.strictEqual(requests.length, 0, 'typing must not submit a search');
  assert.strictEqual(nested.scope.keywords, 'music');
  vm.runInNewContext(submit, child);
  assert.strictEqual(
    requests.length,
    1,
    'ng-if input must reach the search controller'
  );
  assert.strictEqual(requests[0].keywords, 'music');
  nested.scope.nextPage();
  assert.strictEqual(requests[1].keywords, 'music');
  assert.strictEqual(requests[1].curpage, 2);
  nested.scope.previousPage();
  assert.strictEqual(requests[2].keywords, 'music');
  assert.strictEqual(requests[2].curpage, 1);
  nested.scope.clearProviderSearch();
  nested.digest();
  assert.strictEqual(vm.runInNewContext(model, child), '');
  nested.scope.keywords = 'header query';
  nested.digest();
  assert.strictEqual(vm.runInNewContext(model, child), 'header query');
  assert.strictEqual(requests.length, 3, 'clear/header changes must not search');
  child.typedValue = 'keyboard query';
  vm.runInNewContext(`${model} = typedValue`, child);
  vm.runInNewContext(change, child);
  nested.digest();
  child.$event = { which: 13, keyCode: 13 };
  vm.runInNewContext(input.match(/ng-keydown="([^"]+)"/)[1], child);
  assert.strictEqual(requests[3].keywords, 'keyboard query');
  assert.strictEqual(requests.length, 4, 'Enter submits exactly once');

  const desktopRequests = [];
  const desktop = controllerScope({
    window: {},
    MediaService: {
      search(sourceId, options) {
        desktopRequests.push({ sourceId, ...options });
        return { success(reply) { reply({ result: [], total: 40 }); } };
      },
    },
  });
  desktop.scope.keywords = 'desktop music';
  desktop.scope.enterEvent({ which: 13 });
  desktop.scope.nextPage();
  assert.strictEqual(desktopRequests.length, 2);
  assert.strictEqual(desktopRequests[0].keywords, 'desktop music');
  assert.strictEqual(desktopRequests[0].curpage, 1);
  assert.strictEqual(desktopRequests[1].keywords, 'desktop music');
  assert.strictEqual(desktopRequests[1].curpage, 2);
  console.log('Android mobile shell registry manifest contract passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
