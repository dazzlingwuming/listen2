const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const { mkdtemp, rm } = require("fs/promises");
const test = require("node:test");

class Store {
  constructor() {
    this.data = Store.data;
  }

  get(key) {
    return this.data[key];
  }

  set(key, value) {
    if (key === "machineTranslationCache" && Store.failMachineTranslationSet) {
      throw Object.assign(new Error("simulated write failure"), {
        code: "translation-cache-write-failed",
      });
    }
    this.data[key] = value;
  }
}

Store.data = {};
Store.failMachineTranslationSet = false;

function sha256(value) {
  return require("crypto").createHash("sha256").update(value).digest("hex");
}

function createMainHarness(rootDir) {
  const handlers = new Map();
  const filename = path.join(__dirname, "..", "main.js");
  const electron = {
    app: {
      on() {},
      getPath() {
        return rootDir;
      },
      requestSingleInstanceLock() {
        return true;
      },
    },
    BrowserWindow: class {},
    globalShortcut: { register() {}, unregisterAll() {} },
    ipcMain: {
      handle(name, handler) {
        handlers.set(name, handler);
      },
      on() {},
    },
    Menu: { buildFromTemplate() {} },
    protocol: undefined,
    safeStorage: {
      isEncryptionAvailable() {
        return true;
      },
      encryptString(value) {
        return Buffer.from(value);
      },
      decryptString(value) {
        return Buffer.from(value).toString();
      },
    },
    session: { defaultSession: { fetch() {} } },
    screen: {},
    Tray: class {},
  };
  const context = {
    AbortController,
    Buffer,
    URL,
    __dirname: path.dirname(filename),
    console,
    module: { exports: {} },
    process,
    require(id) {
      if (id === "electron") return electron;
      if (id === "electron-store") return Store;
      if (id === "electron-updater")
        return { autoUpdater: { checkForUpdatesAndNotify() {} } };
      if (id === "@electron/remote/main") return {};
      if (id === "./bilibiliFailure")
        return {
          createBilibiliFailure() {
            return {};
          },
        };
      if (id === "./bilibiliService") return { BilibiliService: class {} };
      if (id === "./machineTranslation")
        return require("../machineTranslation");
      return require(id);
    },
    setTimeout,
    clearTimeout,
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(filename, "utf8"), context, { filename });
  return {
    handlers,
    event: {
      senderFrame: { url: "file:///tmp/listen1_chrome_extension/listen1.html" },
    },
  };
}

test("local-data delete still clears lyrics when the audio protocol is unavailable", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "listen2-main-local-data-")
  );
  try {
    Store.data = {};
    const { handlers, event } = createMainHarness(rootDir);
    const put = await handlers.get("lyric-cache:put")(event, {
      trackId: "bitrack_v_BV1ab411c7mD-1",
      expectedRevision: 0,
      mode: "manual",
      record: { lyric: "line", source: "manual" },
    });
    assert.strictEqual(put.ok, true);
    const result = await handlers.get("local-data:delete-track")(event, {
      trackId: put.record.trackId,
    });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.partial, true);
    assert.strictEqual(result.lyrics.removed, true);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("local-data delete removes only DeepSeek cache keys linked from this lyric", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "listen2-main-local-data-")
  );
  const trackId = "bitrack_v_BV1ab411c7mD-2";
  const lyric = "[00:00.00]line";
  const targetCacheKey = sha256("target");
  const otherCacheKey = sha256("other");
  try {
    Store.data = {
      machineTranslationCache: {
        [targetCacheKey]: { tlyric: "目标翻译" },
        [otherCacheKey]: { tlyric: "其他歌曲翻译" },
      },
    };
    const { handlers, event } = createMainHarness(rootDir);
    const put = await handlers.get("lyric-cache:put")(event, {
      trackId,
      expectedRevision: 0,
      mode: "manual",
      record: { lyric, source: "manual" },
    });
    const attached = await handlers.get("lyric-cache:attach-translation")(
      event,
      {
        trackId,
        expectedRevision: put.revision,
        translation: {
          lyricHash: sha256(lyric),
          tlyric: "目标翻译",
          provider: "deepseek",
          cacheKey: targetCacheKey,
        },
      }
    );
    assert.strictEqual(attached.ok, true);
    const result = await handlers.get("local-data:delete-track")(event, {
      trackId,
    });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(
      result.partial,
      true,
      "audio protocol remains unavailable in this harness"
    );
    assert.strictEqual(result.translations.ok, true);
    assert.strictEqual(result.translations.removed, 1);
    assert.strictEqual(
      Store.data.machineTranslationCache[targetCacheKey],
      undefined
    );
    assert.deepStrictEqual(Store.data.machineTranslationCache[otherCacheKey], {
      tlyric: "其他歌曲翻译",
    });
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("translation cache failure retains the V3 retry index until deletion succeeds", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "listen2-main-local-data-")
  );
  const trackId = "bitrack_v_BV1ab411c7mD-3";
  const lyric = "[00:00.00]retry";
  const targetCacheKey = sha256("retry-target");
  const otherCacheKey = sha256("retry-other");
  try {
    Store.data = {
      machineTranslationCache: {
        [targetCacheKey]: { tlyric: "待删翻译" },
        [otherCacheKey]: { tlyric: "其他歌曲翻译" },
      },
    };
    Store.failMachineTranslationSet = false;
    const { handlers, event } = createMainHarness(rootDir);
    const put = await handlers.get("lyric-cache:put")(event, {
      trackId,
      expectedRevision: 0,
      mode: "manual",
      record: { lyric, source: "manual" },
    });
    await handlers.get("lyric-cache:attach-translation")(event, {
      trackId,
      expectedRevision: put.revision,
      translation: {
        lyricHash: sha256(lyric),
        tlyric: "待删翻译",
        provider: "deepseek",
        cacheKey: targetCacheKey,
      },
    });

    Store.failMachineTranslationSet = true;
    const first = await handlers.get("local-data:delete-track")(event, {
      trackId,
    });
    assert.strictEqual(first.ok, true);
    assert.strictEqual(first.partial, true);
    assert.strictEqual(first.translations.ok, false);
    assert.strictEqual(
      first.lyrics.status,
      "retained-for-translation-cache-retry"
    );
    assert.strictEqual(
      (await handlers.get("lyric-cache:get")(event, { trackId })).record.lyric,
      lyric,
      "V3 cacheKey must remain available for a safe retry"
    );
    assert.ok(Store.data.machineTranslationCache[targetCacheKey]);

    Store.failMachineTranslationSet = false;
    const second = await handlers.get("local-data:delete-track")(event, {
      trackId,
    });
    assert.strictEqual(second.ok, true);
    assert.strictEqual(second.translations.removed, 1);
    assert.strictEqual(second.lyrics.removed, true);
    assert.strictEqual(
      (await handlers.get("lyric-cache:get")(event, { trackId })).record,
      null
    );
    assert.strictEqual(
      Store.data.machineTranslationCache[targetCacheKey],
      undefined
    );
    assert.deepStrictEqual(Store.data.machineTranslationCache[otherCacheKey], {
      tlyric: "其他歌曲翻译",
    });
  } finally {
    Store.failMachineTranslationSet = false;
    await rm(rootDir, { recursive: true, force: true });
  }
});
