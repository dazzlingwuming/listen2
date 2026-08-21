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

function cacheKey(lyric, title, artist) {
  return createHash('sha256')
    .update(DEEPSEEK_PROVIDER)
    .update('\0')
    .update(DEEPSEEK_MODEL)
    .update('\0')
    .update(DEEPSEEK_PROMPT_VERSION)
    .update('\0')
    .update('zh-CN')
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
  const translate = handlers.get('machine-translation:translate-lyrics');
  const event = trustedEvent();

  const config = await getConfig(event);
  assert.strictEqual(config.ok, true);
  assert.strictEqual(config.config.provider, 'deepseek');
  assert.strictEqual(config.config.model, DEEPSEEK_MODEL);
  assert.strictEqual(config.config.hasApiKey, false);
  assert.strictEqual(config.config.secureStorageAvailable, true);

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
    },
  };
  const cached = await translate(event, {
    lyric,
    targetLanguage: 'en-US',
  });
  assert.strictEqual(cached.ok, true);
  assert.strictEqual(cached.cached, true);
  assert.strictEqual(cached.tlyric, '[00:01.00]第一行');
  assert.strictEqual(cached.targetLanguage, 'zh-CN');
  assert.strictEqual(getFetchCount(), 0);

  // eslint-disable-next-line no-console
  console.log('DeepSeek machine translation IPC tests passed');
}

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exitCode = 1;
});
