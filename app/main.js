const electron = require("electron");
const {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Menu,
  safeStorage,
  session,
  protocol,
  screen,
  Tray,
} = electron;
const Store = require("electron-store");
const { autoUpdater } = require("electron-updater");
const remoteMain = require("@electron/remote/main");
const { createHash } = require("crypto");
const { join } = require("path");
const {
  DEEPSEEK_MODEL,
  DEEPSEEK_PROMPT_VERSION,
  DEEPSEEK_PROVIDER,
  testDeepSeekApiKey,
  translateWholeLyricWithDeepSeek,
} = require("./machineTranslation");
const { createBilibiliFailure } = require("./bilibiliFailure");
const { BilibiliService } = require("./bilibiliService");
const { AudioCache, CACHE_SCHEME } = require(`${__dirname}/audioCache`);
const { LoudnessAnalyzer } = require(`${__dirname}/loudnessAnalyzer`);
const { LyricCacheStore } = require(`${__dirname}/lyricCacheStore`);
const { ListeningHistoryStore } = require(`${__dirname}/listeningHistoryStore`);

const store = new Store();
const iconPath = join(__dirname, "/listen1_chrome_extension/images/logo.png");
if (protocol && typeof protocol.registerSchemesAsPrivileged === "function") {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: CACHE_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        stream: true,
        supportFetchAPI: true,
      },
    },
  ]);
}

autoUpdater.checkForUpdatesAndNotify();

let floatingWindowCssKey = undefined,
  appIcon = null,
  willQuitApp = false,
  transparent = false,
  trayIconPath;
let bilibiliService;
let audioCache;
let loudnessAnalyzer;
let lyricCacheStore;
let listeningHistoryStore;
let audioCacheStartupError;
let audioCacheProtocolReady = false;
let playerIsPlaying = false;
/** @type {electron.BrowserWindow} */
let mainWindow;
/** @type {electron.BrowserWindow} */
let floatingWindow;
/** @type {electron.Tray} */
let appTray;
//platform-specific
switch (process.platform) {
  case "darwin":
    trayIconPath = join(__dirname, "/resources/logo_16.png");
    transparent = true;
    break;
  case "linux":
    trayIconPath = join(__dirname, "/resources/logo_32.png");
    // fix transparent window not working in linux bug
    app.disableHardwareAcceleration();
    break;
  case "win32":
    trayIconPath = join(__dirname, "/resources/logo_32.png");
    break;
  default:
    break;
}
// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
/** @type {{ width: number; height: number; maximized: boolean; zoomLevel: number}} */
const windowState = store.get("windowState") || {
  width: 1000,
  height: 670,
  maximized: false,
  zoomLevel: 0,
};
/** @type {electron.Config} */
let proxyConfig = store.get("proxyConfig") || {
  mode: "system",
};

function getStoredMachineTranslationConfig() {
  const config = store.get("machineTranslation") || {};
  const isDeepSeekConfig = config.provider === DEEPSEEK_PROVIDER;
  return {
    provider: DEEPSEEK_PROVIDER,
    model: DEEPSEEK_MODEL,
    encryptedApiKey:
      isDeepSeekConfig && typeof config.encryptedApiKey === "string"
        ? config.encryptedApiKey
        : "",
  };
}

function getPublicMachineTranslationConfig() {
  const config = getStoredMachineTranslationConfig();
  return {
    provider: config.provider,
    model: config.model,
    hasApiKey: Boolean(config.encryptedApiKey),
    secureStorageAvailable: safeStorage.isEncryptionAvailable(),
  };
}

function encryptMachineTranslationApiKey(apiKey) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw Object.assign(
      new Error("Secure credential storage is unavailable."),
      { code: "secure-storage-unavailable" }
    );
  }
  return safeStorage
    .encryptString(String(apiKey || "").trim())
    .toString("base64");
}

function decryptMachineTranslationApiKey(encryptedApiKey) {
  if (!encryptedApiKey) {
    return "";
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw Object.assign(
      new Error("Secure credential storage is unavailable."),
      { code: "secure-storage-unavailable" }
    );
  }
  return safeStorage.decryptString(
    Buffer.from(encryptedApiKey, "base64")
  );
}

function getMachineTranslationFetch() {
  const targetSession =
    mainWindow && !mainWindow.isDestroyed()
      ? mainWindow.webContents.session
      : session.defaultSession;
  return targetSession.fetch.bind(targetSession);
}

function getBilibiliService() {
  if (!bilibiliService) {
    bilibiliService = new BilibiliService({
      electronSession: session.defaultSession,
      store,
      safeStorage,
    });
  }
  return bilibiliService;
}

function getAudioCache() {
  if (!audioCache) {
    if (!loudnessAnalyzer) {
      loudnessAnalyzer = new LoudnessAnalyzer({ BrowserWindow, ipcMain });
    }
    audioCache = new AudioCache({
      rootDir: join(app.getPath("userData"), "audio-cache-v1"),
      session: session.defaultSession,
      resolveBilibiliAudio: (options) =>
        options.kind === "audio"
          ? getBilibiliService().getLegacyAudioVariant(options)
          : getBilibiliService().getAudioVariant(options),
      loudnessAnalyzer,
    });
  }
  return audioCache;
}

function ensureAudioCacheAvailable() {
  if (audioCacheStartupError || !audioCacheProtocolReady) {
    throw Object.assign(new Error("Audio cache protocol is unavailable."), {
      code: "audio-cache-unavailable",
    });
  }
  return getAudioCache();
}

function getLyricCacheStore() {
  if (!lyricCacheStore) {
    lyricCacheStore = new LyricCacheStore({
      rootDir: join(app.getPath("userData"), "lyric-cache-v3"),
    });
  }
  return lyricCacheStore;
}

function getListeningHistoryStore() {
  if (!listeningHistoryStore) {
    listeningHistoryStore = new ListeningHistoryStore({ store });
  }
  return listeningHistoryStore;
}

async function withMachineTranslationTimeout(operation) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    return await operation(controller.signal);
  } catch (error) {
    if (error && error.name === "AbortError") {
      throw Object.assign(new Error("Translation request timed out."), {
        code: "request-timeout",
      });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function getMachineTranslationCacheKey(lyric, title, artist) {
  return createHash("sha256")
    .update(DEEPSEEK_PROVIDER)
    .update("\0")
    .update(DEEPSEEK_MODEL)
    .update("\0")
    .update(DEEPSEEK_PROMPT_VERSION)
    .update("\0")
    .update("zh-CN")
    .update("\0")
    .update(String(lyric || ""))
    .update("\0")
    .update(String(title || ""))
    .update("\0")
    .update(String(artist || ""))
    .digest("hex");
}

function getMachineTranslationCacheEntry(cacheKey) {
  const cache = store.get("machineTranslationCache") || {};
  const entry = cache[cacheKey];
  return entry && typeof entry === "object" ? entry : null;
}

function saveMachineTranslationCacheEntry(cacheKey, entry) {
  const cache = store.get("machineTranslationCache") || {};
  cache[cacheKey] = {
    ...entry,
    translatedAt: Date.now(),
  };
  store.set("machineTranslationCache", cache);
}

function isMachineTranslationCacheKey(value) {
  return /^[a-f0-9]{64}$/.test(String(value || ""));
}

function collectMachineTranslationCacheKeys(record) {
  if (!record || !record.translations || typeof record.translations !== "object") {
    return [];
  }
  return [
    ...new Set(
      Object.values(record.translations)
        .map((translation) => translation && translation.cacheKey)
        .filter(isMachineTranslationCacheKey)
    ),
  ];
}

function deleteMachineTranslationCacheEntries(cacheKeys) {
  const keys = Array.isArray(cacheKeys)
    ? [...new Set(cacheKeys.filter(isMachineTranslationCacheKey))]
    : [];
  if (!keys.length) return { ok: true, removed: 0 };
  try {
    const cache = store.get("machineTranslationCache");
    if (!cache || typeof cache !== "object" || Array.isArray(cache)) {
      return { ok: true, removed: 0 };
    }
    const next = { ...cache };
    let removed = 0;
    keys.forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(next, key)) {
        delete next[key];
        removed += 1;
      }
    });
    if (removed) store.set("machineTranslationCache", next);
    return { ok: true, removed };
  } catch (error) {
    return {
      ok: false,
      status:
        (error && typeof error.code === "string" && error.code) ||
        "translation-cache-write-failed",
      removed: 0,
    };
  }
}

function machineTranslationFailure(error) {
  return {
    ok: false,
    status:
      error && typeof error.code === "string"
        ? error.code
        : "request-failed",
    httpStatus: Number((error && error.status) || 0),
  };
}

function ensureTrustedMachineTranslationSender(event) {
  const senderUrl =
    (event &&
      event.senderFrame &&
      typeof event.senderFrame.url === "string" &&
      event.senderFrame.url) ||
    "";
  try {
    const parsed = new URL(senderUrl);
    if (
      parsed.protocol === "file:" &&
      parsed.pathname.endsWith(
        "/listen1_chrome_extension/listen1.html"
      )
    ) {
      return;
    }
  } catch (error) {
    // Fall through to the denied response.
  }
  throw Object.assign(new Error("Untrusted translation request."), {
    code: "ipc-forbidden",
  });
}

function bilibiliFailure(error, stage = "bilibili") {
  return createBilibiliFailure(error, stage);
}

function ensureTrustedBilibiliSender(event) {
  ensureTrustedMachineTranslationSender(event);
}

function localDataFailure(error) {
  return {
    ok: false,
    status: error && typeof error.code === "string" ? error.code : "request-failed",
  };
}

async function attachMachineTranslationToLyricCache(
  payload,
  lyric,
  result,
  cacheKey
) {
  if (!payload || typeof payload !== "object" || !payload.trackId) return;
  const expectedRevision = Number(payload.expectedRevision);
  if (
    !Number.isSafeInteger(expectedRevision) ||
    expectedRevision < 0 ||
    !isMachineTranslationCacheKey(cacheKey)
  )
    return;
  try {
    await getLyricCacheStore().attachTranslation({
      trackId: payload.trackId,
      expectedRevision,
      translation: {
        lyricHash: createHash("sha256").update(String(lyric || "")).digest("hex"),
        tlyric: result.tlyric,
        provider: result.provider || DEEPSEEK_PROVIDER,
        model: result.model || DEEPSEEK_MODEL,
        promptVersion: DEEPSEEK_PROMPT_VERSION,
        translatedAt: Date.now(),
        cacheKey,
      },
    });
  } catch (error) {
    // A stale lyric record must not turn a successful translation into failure.
  }
}

function safeIpcPayload(payload) {
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload
    : {};
}

function registerLocalDataHandler(channel, handler) {
  ipcMain.handle(channel, async (event, payload = {}) => {
    try {
      ensureTrustedMachineTranslationSender(event);
      return await handler(safeIpcPayload(payload));
    } catch (error) {
      return localDataFailure(error);
    }
  });
}

registerLocalDataHandler("audio-cache:lookup", (payload) =>
  ensureAudioCacheAvailable().lookup(payload)
);
registerLocalDataHandler("audio-cache:schedule-bilibili", (payload) =>
  ensureAudioCacheAvailable().schedule(payload)
);
registerLocalDataHandler("audio-cache:invalidate", (payload) =>
  ensureAudioCacheAvailable().delete(payload.cacheKey)
);
registerLocalDataHandler("audio-cache:delete", (payload) =>
  ensureAudioCacheAvailable().delete(payload.cacheKey)
);
registerLocalDataHandler("audio-cache:configure", (payload) =>
  ensureAudioCacheAvailable().configure(payload)
);
registerLocalDataHandler("audio-cache:clear", () =>
  ensureAudioCacheAvailable().clear()
);
ipcMain.handle("audio-cache:status", async (event) => {
  try {
    ensureTrustedMachineTranslationSender(event);
    await ensureAudioCacheAvailable().initialize();
    return ensureAudioCacheAvailable().status();
  } catch (error) {
    return {
      ...localDataFailure(error),
      supported: false,
      enabled: false,
      capacityBytes: 0,
      usedBytes: 0,
      readyEntries: 0,
      queuedEntries: 0,
      loudnessNormalizationEnabled: false,
      loudnessPendingEntries: 0,
      loudnessReadyEntries: 0,
      loudnessFailedEntries: 0,
      lastError: (error && error.code) || "audio-cache-unavailable",
    };
  }
});

registerLocalDataHandler("lyric-cache:get", (payload) =>
  getLyricCacheStore().get(payload)
);
registerLocalDataHandler("lyric-cache:put", (payload) =>
  getLyricCacheStore().put(payload)
);
registerLocalDataHandler("lyric-cache:attach-translation", (payload) =>
  getLyricCacheStore().attachTranslation(payload)
);
registerLocalDataHandler("lyric-cache:clear", (payload) =>
  getLyricCacheStore().clear(payload)
);
registerLocalDataHandler("lyric-cache:migrate-legacy-bilibili-manual", (payload) =>
  getLyricCacheStore().migrateLegacyManual(payload)
);
registerLocalDataHandler("listening-history:ingest", (payload) =>
  getListeningHistoryStore().ingest(payload)
);
registerLocalDataHandler("listening-history:status", () =>
  getListeningHistoryStore().status()
);
registerLocalDataHandler("listening-history:configure", (payload) =>
  getListeningHistoryStore().setEnabled(payload.enabled)
);
registerLocalDataHandler("listening-history:annual-summary", (payload) =>
  getListeningHistoryStore().annualSummary(payload.year)
);
registerLocalDataHandler("listening-history:export", () =>
  getListeningHistoryStore().export()
);
registerLocalDataHandler("listening-history:clear", () =>
  getListeningHistoryStore().clear()
);
registerLocalDataHandler("local-data:delete-track", async (payload) => {
  let lyricRecord;
  let translations = { ok: true, removed: 0 };
  try {
    lyricRecord = await getLyricCacheStore().get({ trackId: payload.trackId });
    translations = deleteMachineTranslationCacheEntries(
      collectMachineTranslationCacheKeys(lyricRecord && lyricRecord.record)
    );
  } catch (error) {
    translations = {
      ok: false,
      status: (error && error.code) || "translation-cache-read-failed",
      removed: 0,
    };
  }
  // Keep the V3 record when its linked legacy translation cache could not be
  // removed. The cacheKey is the only safe, per-track retry index.
  const lyrics = translations.ok
    ? await getLyricCacheStore().clear({ trackId: payload.trackId })
    : {
        ok: false,
        status: "retained-for-translation-cache-retry",
        retained: true,
      };
  let audio;
  try {
    audio = await ensureAudioCacheAvailable().deleteTrack(payload.trackId);
  } catch (error) {
    audio = { ok: false, status: (error && error.code) || "audio-cache-unavailable" };
  }
  if (!lyrics.ok && translations.ok) {
    return {
      ok: false,
      status: lyrics.status || "invalid-input",
      audio,
      lyrics,
      translations,
    };
  }
  return {
    ok: true,
    partial: !audio.ok || !translations.ok,
    audio,
    lyrics,
    translations,
  };
});

ipcMain.handle("machine-translation:get-config", (event) => {
  try {
    ensureTrustedMachineTranslationSender(event);
    return {
      ok: true,
      config: getPublicMachineTranslationConfig(),
    };
  } catch (error) {
    return machineTranslationFailure(error);
  }
});

ipcMain.handle("machine-translation:set-config", (event, payload = {}) => {
  try {
    ensureTrustedMachineTranslationSender(event);
    payload = payload && typeof payload === "object" ? payload : {};
    const current = getStoredMachineTranslationConfig();
    let { encryptedApiKey } = current;
    if (payload.clearApiKey === true) {
      encryptedApiKey = "";
    } else if (String(payload.apiKey || "").trim()) {
      encryptedApiKey = encryptMachineTranslationApiKey(payload.apiKey);
    }
    store.set("machineTranslation", {
      provider: DEEPSEEK_PROVIDER,
      model: DEEPSEEK_MODEL,
      encryptedApiKey,
    });
    return {
      ok: true,
      config: getPublicMachineTranslationConfig(),
    };
  } catch (error) {
    return machineTranslationFailure(error);
  }
});

ipcMain.handle("machine-translation:test", async (event) => {
  try {
    ensureTrustedMachineTranslationSender(event);
    const config = getStoredMachineTranslationConfig();
    const apiKey = decryptMachineTranslationApiKey(
      config.encryptedApiKey
    );
    if (!apiKey) {
      throw Object.assign(new Error("A DeepSeek API key is required."), {
        code: "missing-api-key",
      });
    }
    const usage = await withMachineTranslationTimeout((signal) =>
      testDeepSeekApiKey({
        fetchImpl: getMachineTranslationFetch(),
        apiKey,
        signal,
      })
    );
    return {
      ok: true,
      status: "ready",
      provider: DEEPSEEK_PROVIDER,
      model: DEEPSEEK_MODEL,
      ...usage,
    };
  } catch (error) {
    return machineTranslationFailure(error);
  }
});

ipcMain.handle(
  "machine-translation:translate-lyrics",
  async (event, payload = {}) => {
    try {
      ensureTrustedMachineTranslationSender(event);
      payload = payload && typeof payload === "object" ? payload : {};
      const lyric = String(payload.lyric || "");
      if (!lyric) {
        return { ok: false, status: "empty-lyric" };
      }
      const targetLanguage = "zh-CN";
      const cacheKey = getMachineTranslationCacheKey(
        lyric,
        payload.title,
        payload.artist
      );
      const cached = getMachineTranslationCacheEntry(cacheKey);
      if (cached) {
        await attachMachineTranslationToLyricCache(
          payload,
          lyric,
          cached,
          cacheKey
        );
        return {
          ok: true,
          status: "translated",
          tlyric: cached.tlyric,
          provider: cached.provider,
          model: cached.model,
          targetLanguage: cached.targetLanguage,
          lineCount: cached.lineCount,
          cached: true,
        };
      }
      if (payload.allowNetwork !== true) {
        return { ok: false, status: "not-cached" };
      }
      const config = getStoredMachineTranslationConfig();
      const apiKey = decryptMachineTranslationApiKey(
        config.encryptedApiKey
      );
      if (!apiKey) {
        return { ok: false, status: "missing-api-key" };
      }

      const result = await withMachineTranslationTimeout((signal) =>
        translateWholeLyricWithDeepSeek({
          fetchImpl: getMachineTranslationFetch(),
          apiKey,
          lyric,
          targetLanguage,
          title: payload.title,
          artist: payload.artist,
          signal,
        })
      );
      saveMachineTranslationCacheEntry(cacheKey, result);
      await attachMachineTranslationToLyricCache(
        payload,
        lyric,
        result,
        cacheKey
      );
      return {
        ok: true,
        status: "translated",
        tlyric: result.tlyric,
        provider: result.provider,
        model: result.model,
        targetLanguage: result.targetLanguage,
        lineCount: result.lineCount,
        cached: false,
      };
    } catch (error) {
      return machineTranslationFailure(error);
    }
  }
);

ipcMain.handle("bilibili-auth:get-state", async (event) => {
  try {
    ensureTrustedBilibiliSender(event);
    return {
      ok: true,
      state: await getBilibiliService().getPublicAuthState(),
    };
  } catch (error) {
    return bilibiliFailure(error, "auth");
  }
});

ipcMain.handle("bilibili-auth:begin-qr", async (event) => {
  try {
    ensureTrustedBilibiliSender(event);
    const sender = event.sender;
    const state = await getBilibiliService().startQrLogin((update) => {
      if (sender && !sender.isDestroyed()) {
        sender.send("bilibili-auth:qr-state", update);
      }
    });
    return { ok: true, state };
  } catch (error) {
    return bilibiliFailure(error);
  }
});

ipcMain.handle("bilibili-auth:cancel-qr", (event, payload = {}) => {
  try {
    ensureTrustedBilibiliSender(event);
    getBilibiliService().cancelQrLogin(String(payload.sessionId || ""));
    return { ok: true };
  } catch (error) {
    return bilibiliFailure(error);
  }
});

ipcMain.handle("bilibili-auth:logout", async (event) => {
  try {
    ensureTrustedBilibiliSender(event);
    const result = await getBilibiliService().logout();
    return { ok: true, ...result };
  } catch (error) {
    return bilibiliFailure(error);
  }
});

ipcMain.handle("bilibili-media:get-manifest", async (event, payload = {}) => {
  try {
    ensureTrustedBilibiliSender(event);
    const manifest = await getBilibiliService().getManifest({
      bvid: String(payload.bvid || ""),
      cid: Number(payload.cid || 0),
      forceRefresh: payload.forceRefresh === true,
    });
    return { ok: true, manifest };
  } catch (error) {
    return bilibiliFailure(error, "manifest");
  }
});

ipcMain.handle("bilibili-media:clear-manifest", (event, payload = {}) => {
  try {
    ensureTrustedBilibiliSender(event);
    getBilibiliService().clearManifest({
      bvid: payload.bvid ? String(payload.bvid) : "",
      cid: payload.cid ? Number(payload.cid) : 0,
    });
    return { ok: true };
  } catch (error) {
    return bilibiliFailure(error);
  }
});

const globalShortcutMapping = {
  "CmdOrCtrl+Alt+Left": "left",
  "CmdOrCtrl+Alt+Right": "right",
  "CmdOrCtrl+Alt+Space": "space",
  MediaNextTrack: "right",
  MediaPreviousTrack: "left",
  MediaPlayPause: "space",
};
/**
 * @param {electron.BrowserWindow} mainWindow
 * @param {{ title: string; artist: string; }} [track]
 */
function initialTray(mainWindow, track) {
  track ||= {
    title: "暂无歌曲",
    artist: "  ",
  };

  let nowPlayingTitle = `${track.title}`;
  let nowPlayingArtist = `歌手: ${track.artist}`;

  function toggleVisiable() {
    mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
  }
  const menuTemplate = [
    {
      label: nowPlayingTitle,
      click() {
        mainWindow.show();
      },
    },
    {
      label: nowPlayingArtist,
      click() {
        mainWindow.show();
      },
    },
    { type: "separator" },
    {
      label: "播放/暂停",
      click() {
        mainWindow.webContents.send("globalShortcut", "space");
      },
    },
    {
      label: "上一首",
      click() {
        mainWindow.webContents.send("globalShortcut", "left");
      },
    },
    {
      label: "下一首",
      click() {
        mainWindow.webContents.send("globalShortcut", "right");
      },
    },
    {
      label: "显示/隐藏窗口",
      click() {
        toggleVisiable();
      },
    },
    {
      label: "退出",
      click() {
        app.quit();
      },
    },
  ];

  const contextMenu = Menu.buildFromTemplate(menuTemplate);

  if (appTray?.destroy != undefined) {
    // appTray had create, just refresh tray menu here
    appTray?.setContextMenu(contextMenu);
    return;
  }

  appTray = new Tray(trayIconPath);
  appTray.setContextMenu(contextMenu);
  appTray.on("click", () => {
    toggleVisiable();
  });
}

/**
 * @param {string | electron.Accelerator} key
 * @param {string} message
 */
function setKeyMapping(key, message) {
  globalShortcut.register(key, () => {
    mainWindow.webContents.send("globalShortcut", message);
  });
}

function enableGlobalShortcuts() {
  // initial global shortcuts
  for (const [key, value] of Object.entries(globalShortcutMapping)) {
    setKeyMapping(key, value);
  }
}

function disableGlobalShortcuts() {
  globalShortcut.unregisterAll();
}
/**
 * @param {string} cssStyle
 */
async function updateFloatingWindow(cssStyle) {
  if (cssStyle === undefined) {
    return;
  }
  try {
    const newCssKey = await floatingWindow.webContents.insertCSS(cssStyle, {
      cssOrigin: "author",
    });
    if (floatingWindowCssKey !== undefined) {
      await floatingWindow.webContents.removeInsertedCSS(floatingWindowCssKey);
    }
    floatingWindowCssKey = newCssKey;
  } catch (err) {
    console.log(err);
  }
}
/**
 * @param {electron.Config} params
 */
async function updateProxyConfig(params) {
  proxyConfig = params;

  await mainWindow.webContents.session.setProxy(params);
  await mainWindow.webContents.session.forceReloadProxyConfig();
}

function destroyFloatingWindow() {
  if (!floatingWindow) {
    return;
  }
  if (!floatingWindow.isDestroyed()) {
    store.set("floatingWindowBounds", floatingWindow.getBounds());
    floatingWindow.setIgnoreMouseEvents(false);
    floatingWindow.destroy();
  }
  floatingWindow = null;
  floatingWindowCssKey = undefined;
}

function keepFloatingWindowAboveOtherWindows() {
  if (!floatingWindow || floatingWindow.isDestroyed()) {
    return;
  }
  floatingWindow.setAlwaysOnTop(
    true,
    process.platform === "darwin" ? "screen-saver" : "floating"
  );
}

function configureFloatingWindowSpaces() {
  if (!floatingWindow || floatingWindow.isDestroyed()) {
    return;
  }
  if (process.platform === "darwin") {
    floatingWindow.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
    });
  } else {
    floatingWindow.setVisibleOnAllWorkspaces(true);
  }
  keepFloatingWindowAboveOtherWindows();
}

function sendFloatingWindowPlaybackState() {
  if (
    !floatingWindow ||
    floatingWindow.isDestroyed() ||
    floatingWindow.webContents.isDestroyed()
  ) {
    return;
  }
  floatingWindow.webContents.send("playbackState", {
    isPlaying: playerIsPlaying,
  });
}

/**
 * @param {string} cssStyle
 */
function createFloatingWindow(cssStyle) {
  const display = screen.getPrimaryDisplay();
  if (process.platform === "linux") {
    // fix transparent window not working in linux bug
    destroyFloatingWindow();
  }
  if (!floatingWindow) {
    /** @type {Electron.Rectangle} */
    const winBounds = store.get("floatingWindowBounds");

    floatingWindow = new BrowserWindow({
      width: 1000,
      minWidth: 640,
      maxWidth: 1920,
      height: 70,
      transparent: true,
      frame: false,
      resizable: true,
      hasShadow: false,
      alwaysOnTop: true,
      fullscreenable: false,
      minimizable: false,
      maximizable: false,
      backgroundColor: "#00000000",
      ...(process.platform === "darwin" ? { type: "panel" } : {}),
      webPreferences: {
        sandbox: true,
        preload: join(__dirname, "preload.js"),
      },
      ...winBounds,
    });

    if (winBounds === undefined) {
      floatingWindow.setPosition(
        floatingWindow.getPosition()[0],
        display.bounds.height - 150
      );
    }
    // A macOS fullscreen app is its own Space. The panel window type plus this
    // collection behavior keeps lyrics above normal windows and fullscreen
    // Spaces without moving them between physical displays.
    configureFloatingWindowSpaces();
    floatingWindow.setSkipTaskbar(true);
    if (
      process.platform === "darwin" &&
      typeof floatingWindow.setWindowButtonVisibility === "function"
    ) {
      floatingWindow.setWindowButtonVisibility(false);
    }
    floatingWindow.loadURL(`file://${__dirname}/floatingWindow.html`);
    floatingWindow.setIgnoreMouseEvents(false);
    // NOTICE: setResizable should be set, otherwise mouseleave event won't trigger in windows environment
    floatingWindow.webContents.on("did-finish-load", async () => {
      await updateFloatingWindow(cssStyle);
      sendFloatingWindowPlaybackState();
    });
    floatingWindow.on("closed", () => {
      floatingWindow = null;
      floatingWindowCssKey = undefined;
    });
    // floatingWindow.webContents.openDevTools();
  }
  floatingWindow.showInactive();
  keepFloatingWindowAboveOtherWindows();
}

const previousButton = {
  tooltip: "Previous",
  icon: join(__dirname, "/resources/prev-song.png"),
  click() {
    mainWindow.webContents.send("globalShortcut", "left");
  },
};
const nextButton = {
  tooltip: "Next",
  icon: join(__dirname, "/resources/next-song.png"),
  click() {
    mainWindow.webContents.send("globalShortcut", "right");
  },
};
const playButton = {
  tooltip: "Play",
  icon: join(__dirname, "/resources/play-song.png"),
  click() {
    mainWindow.webContents.send("globalShortcut", "space");
  },
};
const pauseButton = {
  tooltip: "Pause",
  icon: join(__dirname, "/resources/pause-song.png"),
  click() {
    mainWindow.webContents.send("globalShortcut", "space");
  },
};
const setThumbarPause = () => {
  mainWindow?.setThumbarButtons([previousButton, playButton, nextButton]);
};
const setThumbbarPlay = () => {
  mainWindow?.setThumbarButtons([previousButton, pauseButton, nextButton]);
};

function createWindow() {
  const filter = {
    urls: [
      "*://*.music.163.com/*",
      "*://music.163.com/*",
      "*://*.xiami.com/*",
      "*://i.y.qq.com/*",
      "*://c.y.qq.com/*",
      "*://*.kugou.com/*",
      "*://*.kuwo.cn/*",
      "*://*.bilibili.com/*",
      "*://*.bilivideo.com/*",
      "*://*.bilivideo.cn/*",
      "*://*.migu.cn/*",
      "*://*.githubusercontent.com/*",
      "https://listen1.github.io/listen1/callback.html?code=*",
    ],
  };

  session.defaultSession.webRequest.onBeforeSendHeaders(
    filter,
    (details, callback) => {
      if (
        details.url.startsWith(
          "https://listen1.github.io/listen1/callback.html?code="
        )
      ) {
        const { url } = details;
        const code = url.split("=")[1];
        mainWindow.webContents.executeJavaScript(
          'GithubClient.github.handleCallback("' + code + '");'
        );
      } else {
        hack_referer_header(details);
      }
      callback({ cancel: false, requestHeaders: details.requestHeaders });
    }
  );
  // The player intentionally streams through HTMLMediaElement so long tracks do
  // not have to be downloaded into memory. The visualizer taps that same media
  // element through Web Audio in the desktop client. Remote music CDNs are
  // therefore made CORS-readable for media responses only; API, page and script
  // responses keep their original security policy.
  session.defaultSession.webRequest.onHeadersReceived(
    { urls: ["*://*/*"] },
    (details, callback) => {
      const responseHeaders = details.responseHeaders || {};
      if (details.resourceType === "media") {
        Object.keys(responseHeaders).forEach((headerName) => {
          const normalizedName = headerName.toLowerCase();
          if (
            normalizedName === "access-control-allow-origin" ||
            normalizedName === "cross-origin-resource-policy"
          ) {
            delete responseHeaders[headerName];
          }
        });
        responseHeaders["Access-Control-Allow-Origin"] = ["*"];
        responseHeaders["Cross-Origin-Resource-Policy"] = ["cross-origin"];
      }
      callback({ responseHeaders });
    }
  );
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: windowState.width,
    height: windowState.height,
    minHeight: 300,
    minWidth: 600,
    webPreferences: {
      nodeIntegration: true,
      enableRemoteModule: true,
      contextIsolation: false,
    },
    icon: iconPath,
    titleBarStyle: "hiddenInset",
    transparent: transparent,
    vibrancy: "light",
    frame: false,
    hasShadow: true,
  });

  mainWindow.on("ready-to-show", () => {
    if (windowState.maximized) {
      mainWindow.maximize();
    }
    mainWindow.webContents.send("setZoomLevel", windowState.zoomLevel);
  });

  mainWindow.on("resized", () => {
    if (!mainWindow.isMaximized() && !mainWindow.isFullScreen()) {
      const [width, height] = mainWindow.getSize();
      windowState.width = width;
      windowState.height = height;
    }
  });
  mainWindow.on("close", (e) => {
    if (willQuitApp) {
      /* the user tried to quit the app */
      mainWindow = null;
    } else {
      /* the user only tried to close the window */
      //if (process.platform != 'linux') {
      e.preventDefault();
      mainWindow.hide();
      //mainWindow.minimize();
      //}
    }
  });

  // and load the index.html of the app.
  const ua =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/72.0.3626.119 Safari/537.36";

  mainWindow.webContents.session.setProxy(proxyConfig).then(() => {
    mainWindow.loadURL(
      `file://${__dirname}/listen1_chrome_extension/listen1.html`,
      { userAgent: ua }
    );
  });

  setThumbarPause();
  // Emitted when the window is closed.
  mainWindow.on("closed", () => {
    // Dereference the window object, usually you would store windows
    // in an array if your app supports multi windows, this is the time
    // when you should delete the corresponding element.
    mainWindow = null;
  });

  // define global menu content, also add support for cmd+c and cmd+v shortcuts
  const template = [
    {
      label: "Application",
      submenu: [
        {
          label: "Zoom Out",
          accelerator: "CmdOrCtrl+=",
          click() {
            if (windowState.zoomLevel <= 2.5) {
              windowState.zoomLevel += 0.5;
              mainWindow.webContents.send(
                "setZoomLevel",
                windowState.zoomLevel
              );
            }
          },
        },
        {
          label: "Zoom in",
          accelerator: "CmdOrCtrl+-",
          click() {
            if (windowState.zoomLevel >= -1) {
              windowState.zoomLevel -= 0.5;
              mainWindow.webContents.send(
                "setZoomLevel",
                windowState.zoomLevel
              );
            }
          },
        },
        {
          label: "Toggle Developer Tools",
          accelerator: "F12",
          click() {
            mainWindow.webContents.toggleDevTools();
          },
        },
        {
          label: "About Application",
          selector: "orderFrontStandardAboutPanel:",
        },
        { type: "separator" },
        {
          label: "Close Window",
          accelerator: "CmdOrCtrl+W",
          click() {
            mainWindow.close();
          },
        },
        {
          label: "Quit",
          accelerator: "Command+Q",
          click() {
            app.quit();
          },
        },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { label: "Undo", accelerator: "CmdOrCtrl+Z", selector: "undo:" },
        { label: "Redo", accelerator: "Shift+CmdOrCtrl+Z", selector: "redo:" },
        { type: "separator" },
        { label: "Cut", accelerator: "CmdOrCtrl+X", selector: "cut:" },
        { label: "Copy", accelerator: "CmdOrCtrl+C", selector: "copy:" },
        { label: "Paste", accelerator: "CmdOrCtrl+V", selector: "paste:" },
        {
          label: "Select All",
          accelerator: "CmdOrCtrl+A",
          selector: "selectAll:",
        },
      ],
    },
  ];

  mainWindow.setMenu(null);

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));

  initialTray(mainWindow);
}

const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 14_3 like Mac OS X) AppleWebKit/534.30 (KHTML, like Gecko) Version/4.0 Mobile Safari/534.30";

/**
 * @param {electron.OnBeforeSendHeadersListenerDetails} details
 */
function hack_referer_header(details) {
  let replace_referer = true;
  let replace_origin = true;
  let add_referer = true;
  let add_origin = true;
  let referer_value = "";
  let origin_value = "";
  let ua_value = "";

  if (details.url.includes("://music.163.com/")) {
    referer_value = "http://music.163.com/";
  }
  if (details.url.includes("://interface3.music.163.com/")) {
    referer_value = "http://music.163.com/";
  }
  if (details.url.includes("://gist.githubusercontent.com/")) {
    referer_value = "https://gist.githubusercontent.com/";
  }

  if (details.url.includes(".xiami.com/")) {
    add_origin = false;
    referer_value = "https://www.xiami.com/";
  }
  if (details.url.includes("www.xiami.com/api/search/searchSongs")) {
    const key = /key%22:%22(.*?)%22/.exec(details.url)[1];
    add_origin = false;
    referer_value = `https://www.xiami.com/search?key=${key}`;
  }
  if (details.url.includes("c.y.qq.com/")) {
    referer_value = "https://y.qq.com/";
    origin_value = "https://y.qq.com";
  }
  if (
    details.url.includes("y.qq.com/") ||
    details.url.includes("qqmusic.qq.com/") ||
    details.url.includes("music.qq.com/") ||
    details.url.includes("imgcache.qq.com/")
  ) {
    referer_value = "http://y.qq.com/";
  }
  if (details.url.includes(".kugou.com/")) {
    referer_value = "https://www.kugou.com/";
    ua_value = MOBILE_UA;
  }
  if (details.url.includes("m.kugou.com/")) {
    ua_value = MOBILE_UA;
  }
  if (details.url.includes(".kuwo.cn/")) {
    referer_value = "http://www.kuwo.cn/";
  }
  if (
    details.url.includes(".bilibili.com/") ||
    details.url.includes(".bilivideo.com/")
  ) {
    referer_value = "https://www.bilibili.com/";
    replace_origin = false;
    add_origin = false;
  }
  if (details.url.includes('.bilivideo.cn')) {
    referer_value = 'https://www.bilibili.com/';
    origin_value = 'https://www.bilibili.com/';
    add_referer = true;
    add_origin = true;
  }
  if (details.url.includes(".migu.cn")) {
    referer_value = "http://music.migu.cn/v3/music/player/audio?from=migu";
  }
  if (details.url.includes("m.music.migu.cn")) {
    referer_value = "https://m.music.migu.cn/";
  }
  if (origin_value == "") {
    origin_value = referer_value;
  }
  let isRefererSet = false;
  let isOriginSet = false;
  let isUASet = false;
  let headers = details.requestHeaders;

  for (let i = 0, l = headers.length; i < l; ++i) {
    if (
      replace_referer &&
      headers[i].name == "Referer" &&
      referer_value != ""
    ) {
      headers[i].value = referer_value;
      isRefererSet = true;
    }
    if (replace_origin && headers[i].name == "Origin" && referer_value != "") {
      headers[i].value = origin_value;
      isOriginSet = true;
    }
    if (headers[i].name === "User-Agent" && ua_value !== "") {
      headers[i].value = ua_value;
      isUASet = true;
    }
  }

  if (add_referer && !isRefererSet && referer_value != "") {
    headers["Referer"] = referer_value;
  }

  if (add_origin && !isOriginSet && referer_value != "") {
    headers["Origin"] = origin_value;
  }

  if (!isUASet && ua_value !== "") {
    headers["User-Agent"] = ua_value;
  }

  details.requestHeaders = headers;
}

ipcMain.on("currentLyric", (event, arg) => {
  if (floatingWindow && floatingWindow !== null) {
    if (typeof arg === "string") {
      floatingWindow.webContents.send("currentLyric", arg);
      floatingWindow.webContents.send("currentLyricTrans", "");
    } else {
      floatingWindow.webContents.send("currentLyric", arg.lyric);
      floatingWindow.webContents.send("currentLyricTrans", arg.tlyric);
    }
  }
});

ipcMain.on("trackPlayingNow", (event, track) => {
  if (mainWindow != null) {
    initialTray(mainWindow, track);
  }
});

ipcMain.on("isPlaying", (event, isPlaying) => {
  playerIsPlaying = isPlaying === true;
  playerIsPlaying ? setThumbbarPlay() : setThumbarPause();
  sendFloatingWindowPlaybackState();
});

ipcMain.on("control", async (event, arg, params) => {
  switch (arg) {
    case "enable_global_shortcut":
      enableGlobalShortcuts();
      break;

    case "disable_global_shortcut":
      disableGlobalShortcuts();
      break;

    case "enable_lyric_floating_window":
      createFloatingWindow(params);
      break;

    case "disable_lyric_floating_window":
      destroyFloatingWindow();
      break;

    case "window_min":
      mainWindow.minimize();
      break;

    case "window_max":
      windowState.maximized ? mainWindow.unmaximize() : mainWindow.maximize();
      windowState.maximized = !windowState.maximized;
      break;

    case "window_close":
      mainWindow.close();
      break;

    case "float_window_accept_mouse_event":
      floatingWindow?.setIgnoreMouseEvents(false);
      keepFloatingWindowAboveOtherWindows();
      break;

    case "float_window_ignore_mouse_event":
      // Keep the locked lyric strip click-through. Forward only mouse movement
      // so the renderer can expose its small unlock button without allowing the
      // rest of the toolbar or lyric surface to intercept clicks.
      floatingWindow?.setIgnoreMouseEvents(true, { forward: true });
      keepFloatingWindowAboveOtherWindows();
      break;

    case "float_window_previous":
      mainWindow?.webContents.send("globalShortcut", "left");
      break;

    case "float_window_toggle_playback":
      mainWindow?.webContents.send("globalShortcut", "space");
      break;

    case "float_window_next":
      mainWindow?.webContents.send("globalShortcut", "right");
      break;

    case "float_window_close":
    case "float_window_font_small":
    case "float_window_font_large":
    case "float_window_background_light":
    case "float_window_background_dark":
    case "float_window_font_change_color":
      mainWindow.webContents.send("lyricWindow", arg);
      break;

    case "update_lyric_floating_window_css":
      await updateFloatingWindow(params);
      break;

    case "get_proxy_config":
      mainWindow.webContents.send("proxyConfig", proxyConfig);
      break;

    case "update_proxy_config":
      await updateProxyConfig(params);
      break;

    default:
      break;
  }
  // event.sender.send('asynchronous-reply', 'pong')
});

ipcMain.on("openUrl", (event, arg, params) => {
  const bWindow = new BrowserWindow({
    parent: mainWindow,
    height: 700,
    resizable: true,
    width: 985,
    frame: true,
    fullscreen: false,
    maximizable: true,
    minimizable: true,
    autoHideMenuBar: true,
    webPreferences: {
      // sandbox is necessary for website js to work
      // thanks to https://github.com/sunzongzheng/music
      sandbox: true,
    },
  });
  bWindow.loadURL(arg);
  bWindow.setMenu(null);
});

ipcMain.on("floatWindowMoving", (e, { mouseX, mouseY }) => {
  const { x, y } = screen.getCursorScreenPoint();
  floatingWindow?.setPosition(x - mouseX, y - mouseY);
});

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", (event, commandLine, workingDirectory) => {
    // Someone tried to run a second instance, we should focus our window.
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      // When start a new instance, show the main window and active in taskbar.
      mainWindow.show();
      mainWindow.setSkipTaskbar(false);
    }
  });

  // Create myWindow, load the rest of the app, etc...
  app.on("ready", async () => {
    try {
      await getAudioCache().initialize();
      if (
        session.defaultSession.protocol &&
        typeof session.defaultSession.protocol.handle === "function"
      ) {
        await session.defaultSession.protocol.handle(CACHE_SCHEME, (request) =>
          getAudioCache().handleProtocolRequest(request)
        );
        audioCacheProtocolReady = true;
      } else {
        throw Object.assign(new Error("Electron protocol handler is unavailable."), {
          code: "audio-cache-unavailable",
        });
      }
    } catch (error) {
      audioCacheStartupError = error;
    }
    createWindow();
    remoteMain.initialize();
    remoteMain.enable(mainWindow.webContents);
  });
}

// Quit when all windows are closed.
app.on("window-all-closed", () => {
  // On OS X it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (process.platform !== "darwin") {
    app.quit();
  }
});

/* 'activate' is emitted when the user clicks the Dock icon (OS X) */
app.on("activate", () => mainWindow.show());

/* 'before-quit' is emitted when Electron receives
 * the signal to exit and wants to start closing windows */
app.on("before-quit", () => {
  if (audioCache) audioCache.shutdown();
  if (
    mainWindow &&
    !mainWindow.isDestroyed() &&
    mainWindow.webContents.isDevToolsOpened()
  ) {
    mainWindow.webContents.closeDevTools();
  }
  if (floatingWindow) {
    store.set("floatingWindowBounds", floatingWindow.getBounds());
  }
  store.set("windowState", windowState);
  store.set("proxyConfig", proxyConfig);

  willQuitApp = true;
});

app.on("will-quit", () => {
  if (bilibiliService) {
    bilibiliService.shutdown();
  }
  disableGlobalShortcuts();
});
