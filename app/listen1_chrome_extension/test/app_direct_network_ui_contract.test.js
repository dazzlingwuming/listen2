/* eslint-env node */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const extensionRoot = path.resolve(__dirname, '..');
const controllerSource = fs.readFileSync(
  path.join(extensionRoot, 'js/controller/profile.js'),
  'utf8'
);
const html = fs.readFileSync(path.join(extensionRoot, 'listen1.html'), 'utf8');
const zh = JSON.parse(
  fs.readFileSync(path.join(extensionRoot, 'i18n/zh-CN.json'), 'utf8')
);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createController({ electron = true, invoke } = {}) {
  let controller;
  const calls = [];
  const host = { value: '' };
  const port = { value: '' };
  const elements = {
    'proxy-rules-host': host,
    'proxy-rules-port': port,
    'theme-css': {},
    'common-css': {},
  };
  const ipcRenderer = {
    invoke(channel, ...args) {
      calls.push({ channel, args });
      return invoke ? invoke(channel, ...args) : Promise.resolve(null);
    },
  };
  const scope = {
    $applyAsync(callback) {
      callback();
    },
    $evalAsync(callback) {
      callback();
    },
    closeDialog() {
      scope.dialogClosed = true;
    },
  };
  const localValues = { theme: 'sakura' };
  const localStorage = {
    getObject(key) {
      return localValues[key] ?? null;
    },
    setObject(key, value) {
      localValues[key] = value;
    },
  };
  const axios = {
    get(url) {
      if (url === 'i18n/zh-CN.json') {
        return Promise.resolve({
          data: Object.fromEntries(Object.keys(zh).map((key) => [key, ''])),
        });
      }
      if (url === 'images/feather-sprite.svg')
        return Promise.resolve({ data: '' });
      return Promise.resolve({ data: { tag_name: 'test' } });
    },
  };
  const appearance = {
    themes: [
      { id: 'sakura', base: 'dark' },
      { id: 'black2', base: 'dark' },
    ],
    mode: 'balanced',
    setMode() {},
    publish() {},
  };
  const context = {
    angular: {
      module() {
        return {
          controller(name, definition) {
            controller = definition[1];
          },
        };
      },
    },
    navigator: { language: 'zh-CN' },
    localStorage,
    document: {
      getElementById(id) {
        return elements[id] || null;
      },
    },
    window: {
      Listen2Appearance: appearance,
      requestAnimationFrame(callback) {
        callback();
      },
    },
    isElectron() {
      return electron;
    },
    i18next: {
      changeLanguage() {
        return Promise.resolve((key) => key);
      },
    },
    axios,
    sourceList: [],
    platformSourceList: [],
    require(name) {
      assert.equal(name, 'electron');
      return { ipcRenderer };
    },
  };
  vm.runInNewContext(controllerSource, context, { filename: 'profile.js' });
  controller(scope);
  return { scope, calls, host, port };
}

function state(config, extra = {}) {
  return {
    ok: true,
    status: 'active',
    scope: 'application',
    enhancedDirect: config.mode === 'enhanced-direct',
    config,
    baseProxyConfig: { mode: 'system' },
    ...extra,
  };
}

test('enhanced direct remains pending until authoritative ack, then updates mode', async () => {
  let apply = deferred();
  const fixture = createController({
    invoke(channel) {
      if (channel === 'network:getState')
        return Promise.resolve(state({ mode: 'system' }));
      return apply.promise;
    },
  });
  await fixture.scope.getProxyConfig();
  assert.equal(fixture.scope.proxyMode.name, 'system');
  const request = fixture.scope.applyEnhancedDirect();
  assert.equal(fixture.scope.proxyApplyPending, true);
  assert.equal(fixture.scope.proxyMode.name, 'system');
  assert.equal(fixture.calls.at(-1).channel, 'network:applyConfig');
  assert.equal(fixture.calls.at(-1).args[0].mode, 'enhanced-direct');
  assert.equal(await fixture.scope.applyEnhancedDirect(), false);
  assert.equal(
    fixture.calls.filter((call) => call.channel === 'network:applyConfig')
      .length,
    1
  );
  apply.resolve(state({ mode: 'enhanced-direct' }));
  assert.equal(await request, true);
  assert.equal(fixture.scope.proxyMode.name, 'enhanced-direct');
  assert.equal(fixture.scope.proxyApplyPending, false);
});

test('failed apply preserves known mode and reports restored or uncertain outcome', async () => {
  const fixture = createController({
    invoke(channel) {
      return Promise.resolve(
        channel === 'network:getState'
          ? state({ mode: 'system' })
          : {
              ...state({ mode: 'system' }),
              ok: false,
              errorCode: 'resolver-check-failed',
            }
      );
    },
  });
  await fixture.scope.getProxyConfig();
  assert.equal(await fixture.scope.applyEnhancedDirect(), false);
  assert.equal(fixture.scope.proxyMode.name, 'system');
  assert.equal(fixture.scope.proxyFeedbackKey, '_PROXY_ERROR_RESTORED');

  const rejected = createController({
    invoke(channel) {
      return channel === 'network:getState'
        ? Promise.resolve(state({ mode: 'direct' }))
        : Promise.reject(new Error('native detail must not reach UI'));
    },
  });
  await rejected.scope.getProxyConfig();
  assert.equal(await rejected.scope.applyEnhancedDirect(), false);
  assert.equal(rejected.scope.proxyMode, null);
  assert.equal(rejected.scope.proxyStateKnown, false);
  assert.equal(rejected.scope.proxyFeedbackKey, '_PROXY_ERROR_UNCONFIRMED');
  assert.equal(rejected.scope.proxyFeedbackText(), '_PROXY_ERROR_UNCONFIRMED');

  const rollbackFailed = createController({
    invoke(channel) {
      return Promise.resolve(
        channel === 'network:getState'
          ? state({ mode: 'system' })
          : {
              ok: false,
              status: 'error',
              scope: 'application',
              config: null,
              errorCode: 'rollback-failed',
            }
      );
    },
  });
  await rollbackFailed.scope.getProxyConfig();
  assert.equal(await rollbackFailed.scope.applyEnhancedDirect(), false);
  assert.equal(rollbackFailed.scope.proxyMode, null);
  assert.equal(rollbackFailed.scope.proxyStateKnown, false);
  assert.equal(
    rollbackFailed.scope.proxyFeedbackKey,
    '_PROXY_ERROR_UNCONFIRMED'
  );

  const startupUnknown = createController({
    invoke(channel) {
      return Promise.resolve(
        channel === 'network:getState'
          ? state({ mode: 'direct' })
          : {
              ok: false,
              status: 'error',
              scope: 'application',
              config: null,
              nativeState: 'unknown',
              errorCode: 'startup-policy-failed',
            }
      );
    },
  });
  await startupUnknown.scope.getProxyConfig();
  assert.equal(await startupUnknown.scope.applyEnhancedDirect(), false);
  assert.equal(startupUnknown.scope.proxyMode, null);
  assert.equal(startupUnknown.scope.proxyStateKnown, false);
  assert.equal(
    startupUnknown.scope.proxyFeedbackKey,
    '_PROXY_ERROR_UNCONFIRMED'
  );

  const effectiveState = createController({
    invoke(channel) {
      return Promise.resolve(
        channel === 'network:getState'
          ? state({ mode: 'enhanced-direct' })
          : {
              ...state({ mode: 'direct' }),
              ok: false,
              status: 'error',
              errorCode: 'startup-policy-failed',
              nativeState: 'direct-only',
            }
      );
    },
  });
  await effectiveState.scope.getProxyConfig();
  assert.equal(await effectiveState.scope.applyEnhancedDirect(), false);
  assert.equal(effectiveState.scope.proxyStateKnown, true);
  assert.equal(effectiveState.scope.proxyMode.name, 'direct');
  assert.equal(
    effectiveState.scope.proxyFeedbackKey,
    '_PROXY_ERROR_APPLIED_WITH_WARNING'
  );
  assert.notEqual(
    effectiveState.scope.proxyFeedbackKey,
    '_PROXY_ERROR_RESTORED'
  );
});

test('unknown initial state is not presented as system and can be retried', async () => {
  let attempt = 0;
  const fixture = createController({
    invoke() {
      attempt += 1;
      return Promise.resolve(
        attempt === 1
          ? {
              ok: false,
              status: 'error',
              scope: 'application',
              config: null,
              nativeState: 'unknown',
            }
          : state({ mode: 'direct' })
      );
    },
  });
  assert.equal(await fixture.scope.getProxyConfig(), false);
  assert.equal(fixture.scope.proxyMode, null);
  assert.equal(fixture.scope.proxyStateKnown, false);
  assert.equal(fixture.scope.proxyFeedbackKey, '_PROXY_STATE_UNKNOWN');
  assert.equal(await fixture.scope.retryProxyState(), true);
  assert.equal(fixture.scope.proxyMode.name, 'direct');
});

test('restore action sends one system config; non-Electron path never invokes IPC', async () => {
  const fixture = createController({
    invoke(channel) {
      return Promise.resolve(
        channel === 'network:getState'
          ? state({ mode: 'enhanced-direct' })
          : state({ mode: 'system' })
      );
    },
  });
  await fixture.scope.getProxyConfig();
  assert.equal(await fixture.scope.restoreSystemProxy(), true);
  assert.equal(fixture.calls.at(-1).channel, 'network:applyConfig');
  assert.equal(fixture.calls.at(-1).args[0].mode, 'system');
  assert.equal(fixture.scope.proxyMode.name, 'system');

  const browser = createController({
    electron: false,
    invoke() {
      throw new Error('IPC must not be called outside Electron');
    },
  });
  assert.equal(browser.scope.proxyNetworkAvailable, false);
  assert.equal(await browser.scope.applyEnhancedDirect(), false);
  assert.equal(await browser.scope.getProxyConfig(), false);
  assert.equal(browser.calls.length, 0);
  assert.equal(browser.scope.proxyFeedbackKey, '_PROXY_STATE_DESKTOP_ONLY');
});

test('a late initial state response cannot overwrite a newer apply acknowledgement', async () => {
  const initial = deferred();
  const fixture = createController({
    invoke(channel) {
      return channel === 'network:getState'
        ? initial.promise
        : Promise.resolve(state({ mode: 'enhanced-direct' }));
    },
  });
  const initialRequest = fixture.scope.getProxyConfig();
  assert.equal(fixture.scope.proxyStatePending, true);
  assert.equal(await fixture.scope.applyEnhancedDirect(), true);
  assert.equal(fixture.scope.proxyStatePending, false);
  initial.resolve(state({ mode: 'system' }));
  assert.equal(await initialRequest, false);
  assert.equal(fixture.scope.proxyMode.name, 'enhanced-direct');
});

test('proxy dialog saves its draft and closes only after successful acknowledgement', async () => {
  let apply = deferred();
  const fixture = createController({
    invoke(channel) {
      return channel === 'network:getState'
        ? Promise.resolve(state({ mode: 'system' }))
        : apply.promise;
    },
  });
  await fixture.scope.getProxyConfig();
  fixture.scope.proxyModeInput = fixture.scope.proxyModes.find(
    (mode) => mode.name === 'custom'
  );
  fixture.host.value = '127.0.0.1';
  fixture.port.value = '8080';
  const request = fixture.scope.setProxyConfig();
  assert.equal(fixture.scope.proxyMode.name, 'system');
  assert.equal(fixture.scope.proxyRules, '');
  assert.equal(fixture.scope.dialogClosed, undefined);
  assert.equal(fixture.calls.at(-1).channel, 'network:applyConfig');
  assert.equal(
    fixture.calls.at(-1).args[0].proxyRules,
    'http://127.0.0.1:8080'
  );
  apply.resolve(state({ proxyRules: 'http://127.0.0.1:8080' }));
  assert.equal(await request, true);
  assert.equal(fixture.scope.proxyMode.name, 'custom');
  assert.equal(fixture.scope.proxyRules, 'http://127.0.0.1:8080');
  assert.equal(fixture.scope.dialogClosed, true);
});

test('unknown state still offers app-only enable and system restore recovery actions', async () => {
  let applyMode;
  const fixture = createController({
    invoke(channel, config) {
      if (channel === 'network:getState') {
        return Promise.resolve({
          ok: false,
          status: 'error',
          scope: 'application',
          config: null,
          nativeState: 'unknown',
          errorCode: 'startup-policy-failed',
        });
      }
      applyMode = config.mode;
      return Promise.resolve(state({ mode: config.mode }));
    },
  });
  assert.equal(await fixture.scope.getProxyConfig(), false);
  assert.equal(fixture.scope.proxyMode, null);
  assert.equal(await fixture.scope.applyEnhancedDirect(), true);
  assert.equal(applyMode, 'enhanced-direct');
  assert.equal(await fixture.scope.restoreSystemProxy(), true);
  assert.equal(applyMode, 'system');
});

test('both proxy dialogs and settings layouts expose async feedback and app-only controls', () => {
  assert.equal((html.match(/class="dialog-proxy"/g) || []).length, 2);
  assert.equal((html.match(/class="proxy-feedback"/g) || []).length, 4);
  assert.equal((html.match(/applyEnhancedDirect\(\)/g) || []).length, 2);
  assert.equal((html.match(/restoreSystemProxy\(\)/g) || []).length, 2);
  assert.equal(
    (
      html.match(
        /ng-if="!proxyStateKnown \|\| proxyMode\.name !== 'enhanced-direct'"/g
      ) || []
    ).length,
    2
  );
  assert.equal(
    (
      html.match(
        /ng-if="!proxyStateKnown \|\| proxyMode\.name === 'enhanced-direct'"/g
      ) || []
    ).length,
    2
  );
  assert.equal(
    (html.match(/\{\{_PROXY_APP_DIRECT_HELP\}\}/g) || []).length,
    4
  );
  assert.match(
    html,
    /ng-disabled="proxyApplyPending \|\| !proxyNetworkAvailable \|\| !proxyModeInput"/
  );
  for (const key of [
    '_PROXY_ENHANCED_DIRECT',
    '_PROXY_STATE_UNKNOWN',
    '_PROXY_STATE_APPLYING',
    '_PROXY_ERROR_RESTORED',
    '_PROXY_ERROR_UNCONFIRMED',
    '_PROXY_ERROR_APPLIED_WITH_WARNING',
    '_PROXY_ENABLE_APP_DIRECT',
    '_PROXY_RESTORE_SYSTEM',
    '_PROXY_RETRY',
    '_PROXY_APP_DIRECT_HELP',
  ])
    assert.ok(zh[key], `missing zh-CN translation ${key}`);
});
