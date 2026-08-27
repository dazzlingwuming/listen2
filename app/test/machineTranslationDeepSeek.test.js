/* eslint-env node */

const assert = require('assert');
const { createHash } = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const {
  DEEPSEEK_MODEL,
  DEEPSEEK_PROMPT_VERSION,
  DEEPSEEK_PROVIDER,
  DEEPSEEK_TARGET_LANGUAGE,
  getDeepSeekPromptFingerprint,
} = require('../machineTranslation');

class Store {
  constructor() {
    this.data = Store.data;
  }

  get(key) {
    return this.data[key];
  }

  set(key, value) {
    this.data[key] = value;
  }
}
Store.data = {};

function loadTranslationHandlers() {
  const handlers = new Map();
  let fetchCount = 0;
  const electron = {
    app: {
      disableHardwareAcceleration() {},
      on() {},
      requestSingleInstanceLock() { return true; },
    },
    BrowserWindow: class {},
    globalShortcut: { register() {}, unregisterAll() {} },
    ipcMain: {
      handle(name, handler) { handlers.set(name, handler); },
      on() {},
    },
    Menu: { buildFromTemplate() {} },
    safeStorage: {
      isEncryptionAvailable() { return true; },
      encryptString(value) { return Buffer.from(value); },
      decryptString(value) { return Buffer.from(value).toString(); },
    },
    session: {
      defaultSession: {
        fetch() {
          fetchCount += 1;
          throw new Error('network must not be used for a cache-only request');
        },
      },
    },
    screen: {},
    Tray: class {},
  };
  const filename = path.join(__dirname, '..', 'main.js');
  const source = fs.readFileSync(filename, 'utf8');
  const context = {
    AbortController,
    Buffer,
    URL,
    __dirname: path.dirname(filename),
    console,
    module: { exports: {} },
    process,
    require(id) {
      if (id === 'electron') return electron;
      if (id === 'electron-store') return Store;
      if (id === 'electron-updater') {
        return { autoUpdater: { checkForUpdatesAndNotify() {} } };
      }
      if (id === '@electron/remote/main') return {};
      if (id === './bilibiliFailure') {
        return { createBilibiliFailure() { return {}; } };
      }
      if (id === './bilibiliService') {
        return { BilibiliService: class {} };
      }
      if (id === './machineTranslation') return require('../machineTranslation');
      return require(id);
    },
    setTimeout,
    clearTimeout,
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename });
  return { handlers, getFetchCount: () => fetchCount };
}

function trustedEvent() {
  return {
    senderFrame: {
      url: 'file:///tmp/listen1_chrome_extension/listen1.html',
    },
  };
}

function cacheKey(lyric, title, artist, styleHint = '') {
  const promptFingerprint = getDeepSeekPromptFingerprint({
    targetLanguage: DEEPSEEK_TARGET_LANGUAGE,
    styleHint,
  });
  return createHash('sha256')
    .update(DEEPSEEK_PROVIDER)
    .update('\0')
    .update(DEEPSEEK_MODEL)
    .update('\0')
    .update(promptFingerprint)
    .update('\0')
    .update(DEEPSEEK_TARGET_LANGUAGE)
    .update('\0')
    .update(lyric)
    .update('\0')
    .update(title)
    .update('\0')
    .update(artist)
    .digest('hex');
}

async function run() {
  Store.data = {
    machineTranslation: {
      provider: 'deepl',
      encryptedApiKey: 'legacy-deepl-key-must-not-be-used',
    },
  };
  const { handlers, getFetchCount } = loadTranslationHandlers();
  const getConfig = handlers.get('machine-translation:get-config');
  const setConfig = handlers.get('machine-translation:set-config');
  const translate = handlers.get('machine-translation:translate-lyrics');
  const event = trustedEvent();

  const config = await getConfig(event);
  assert.strictEqual(config.ok, true);
  assert.strictEqual(config.config.provider, 'deepseek');
  assert.strictEqual(config.config.model, DEEPSEEK_MODEL);
  assert.strictEqual(config.config.hasApiKey, false);
  assert.strictEqual(config.config.secureStorageAvailable, true);
  assert.strictEqual(config.config.targetLanguage, 'zh-CN');
  assert.strictEqual(config.config.maxStyleHintChars, 1200);
  assert.ok(config.config.defaultStyleHint);
  assert.ok(config.config.immutableSystemPrompt.includes('untrusted data'));
  assert.ok(
    config.config.promptTemplatePreview.includes('<placeholder lyric line>') &&
      config.config.promptTemplatePreview.includes('"E0001"'),
    'the preview must use placeholder song data and the same fixed few-shot contract'
  );
  assert.ok(
    !config.config.promptTemplatePreview.includes('legacy-deepl-key-must-not-be-used'),
    'a public prompt preview must never expose a stored credential'
  );

  const lyric = '[00:01.00]First line';
  const uncached = await translate(event, { lyric });
  assert.strictEqual(uncached.ok, false);
  assert.strictEqual(uncached.status, 'not-cached');
  assert.strictEqual(getFetchCount(), 0);

  const legacyKeyAttempt = await translate(event, {
    lyric,
    allowNetwork: true,
  });
  assert.strictEqual(legacyKeyAttempt.ok, false);
  assert.strictEqual(legacyKeyAttempt.status, 'missing-api-key');
  assert.strictEqual(getFetchCount(), 0);

  Store.data.machineTranslationCache = {
    [cacheKey(lyric, '', '')]: {
      tlyric: '[00:01.00]第一行',
      provider: 'deepseek',
      model: DEEPSEEK_MODEL,
      targetLanguage: 'zh-CN',
      lineCount: 1,
      promptVersion: DEEPSEEK_PROMPT_VERSION,
      promptFingerprint: getDeepSeekPromptFingerprint({
        targetLanguage: 'zh-CN',
      }),
    },
  };
  const cached = await translate(event, {
    lyric,
  });
  assert.strictEqual(cached.ok, true);
  assert.strictEqual(cached.cached, true);
  assert.strictEqual(cached.tlyric, '[00:01.00]第一行');
  assert.strictEqual(cached.targetLanguage, 'zh-CN');
  assert.strictEqual(getFetchCount(), 0);

  const unsupportedTarget = await translate(event, {
    lyric,
    targetLanguage: 'en-US',
  });
  assert.strictEqual(unsupportedTarget.ok, false);
  assert.strictEqual(unsupportedTarget.status, 'unsupported-target-language');

  const forceWithoutNetwork = await translate(event, {
    lyric,
    forceRefresh: true,
  });
  assert.strictEqual(forceWithoutNetwork.ok, false);
  assert.strictEqual(
    forceWithoutNetwork.status,
    'force-refresh-requires-network'
  );

  const configuredForForce = await setConfig(event, { apiKey: 'test-key' });
  assert.strictEqual(configuredForForce.ok, true);
  const forcedCacheBypass = await translate(event, {
    lyric,
    allowNetwork: true,
    forceRefresh: true,
  });
  assert.strictEqual(forcedCacheBypass.ok, false);
  assert.strictEqual(forcedCacheBypass.status, 'request-failed');
  assert.strictEqual(
    getFetchCount(),
    1,
    'an explicit network-confirmed force refresh must bypass an otherwise valid cache entry'
  );

  const changedStyle = await setConfig(event, { styleHint: '更口语化一些' });
  assert.strictEqual(changedStyle.ok, true);
  assert.strictEqual(changedStyle.config.styleHint, '更口语化一些');
  assert.ok(
    changedStyle.config.promptTemplatePreview.includes('更口语化一些') &&
      changedStyle.config.promptTemplatePreview.includes(
        changedStyle.config.immutableSystemPrompt
      ) &&
      !changedStyle.config.promptTemplatePreview.includes('test-key'),
    'the preview uses the effective persisted style and never leaks an API key'
  );
  assert.notStrictEqual(
    changedStyle.config.promptFingerprint,
    config.config.promptFingerprint,
    'a style preference must isolate translation cache entries'
  );
  const styleCacheMiss = await translate(event, { lyric });
  assert.strictEqual(styleCacheMiss.ok, false);
  assert.strictEqual(styleCacheMiss.status, 'not-cached');
  assert.strictEqual(getFetchCount(), 1);

  const invalidStyle = await setConfig(event, {
    styleHint: 'x'.repeat(1201),
  });
  assert.strictEqual(invalidStyle.ok, false);
  assert.strictEqual(invalidStyle.status, 'invalid-style-hint');

  // eslint-disable-next-line no-console
  console.log('DeepSeek machine translation IPC tests passed');
}

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exitCode = 1;
});
