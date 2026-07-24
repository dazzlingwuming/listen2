const electron = require("electron");
const {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Menu,
  safeStorage,
  session,
  screen,
  Tray,
} = electron;
const Store = require("electron-store");
const { autoUpdater } = require("electron-updater");
const remoteMain = require("@electron/remote/main");
const { createHash } = require("crypto");
const { join } = require("path");
const {
  mapDeepLTargetLanguage,
  testDeepLApiKey,
  translateWholeLyricWithDeepL,
} = require("./machineTranslation");

const store = new Store();
const iconPath = join(__dirname, "/listen1_chrome_extension/images/logo.png");
const MACHINE_TRANSLATION_CACHE_LIMIT = 80;

autoUpdater.checkForUpdatesAndNotify();

let floatingWindowCssKey = undefined,
  appIcon = null,
  willQuitApp = false,
  transparent = false,
  trayIconPath;
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
  return {
    enabled: config.enabled === true,
    provider: "deepl",
    encryptedApiKey:
      typeof config.encryptedApiKey === "string"
        ? config.encryptedApiKey
        : "",
  };
}

function getPublicMachineTranslationConfig() {
  const config = getStoredMachineTranslationConfig();
  return {
    enabled: config.enabled,
    provider: config.provider,
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

function getMachineTranslationCacheKey(lyric, targetLanguage) {
  return createHash("sha256")
    .update("deepl-whole-lyric-v1\0")
    .update(mapDeepLTargetLanguage(targetLanguage))
    .update("\0")
    .update(String(lyric || ""))
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
  const keys = Object.keys(cache).sort(
    (left, right) =>
      Number(cache[left].translatedAt || 0) -
      Number(cache[right].translatedAt || 0)
  );
  while (keys.length > MACHINE_TRANSLATION_CACHE_LIMIT) {
    delete cache[keys.shift()];
  }
  store.set("machineTranslationCache", cache);
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
    const current = getStoredMachineTranslationConfig();
    let { encryptedApiKey } = current;
    if (payload.clearApiKey === true) {
      encryptedApiKey = "";
    } else if (String(payload.apiKey || "").trim()) {
      encryptedApiKey = encryptMachineTranslationApiKey(payload.apiKey);
    }
    const enabled = payload.enabled === true;
    if (enabled && !encryptedApiKey) {
      throw Object.assign(new Error("A DeepL API key is required."), {
        code: "missing-api-key",
      });
    }
    store.set("machineTranslation", {
      enabled,
      provider: "deepl",
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
      throw Object.assign(new Error("A DeepL API key is required."), {
        code: "missing-api-key",
      });
    }
    const usage = await withMachineTranslationTimeout((signal) =>
      testDeepLApiKey({
        fetchImpl: getMachineTranslationFetch(),
        apiKey,
        signal,
      })
    );
    return {
      ok: true,
      status: "ready",
      provider: "DeepL",
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
      const config = getStoredMachineTranslationConfig();
      if (!config.enabled) {
        return { ok: false, status: "disabled" };
      }
      const apiKey = decryptMachineTranslationApiKey(
        config.encryptedApiKey
      );
      if (!apiKey) {
        return { ok: false, status: "missing-api-key" };
      }
      const lyric = String(payload.lyric || "");
      if (!lyric) {
        return { ok: false, status: "empty-lyric" };
      }
      const targetLanguage = String(
        payload.targetLanguage || "zh-CN"
      );
      const cacheKey = getMachineTranslationCacheKey(
        lyric,
        targetLanguage
      );
      const cached = getMachineTranslationCacheEntry(cacheKey);
      if (cached) {
        return cached.sameLanguage
          ? {
              ok: false,
              status: "same-language",
              provider: cached.provider,
              detectedSourceLanguage:
                cached.detectedSourceLanguage || "",
              cached: true,
            }
          : {
              ok: true,
              status: "translated",
              tlyric: cached.tlyric,
              provider: cached.provider,
              targetLanguage: cached.targetLanguage,
              detectedSourceLanguage:
                cached.detectedSourceLanguage || "",
              lineCount: cached.lineCount,
              cached: true,
            };
      }

      const result = await withMachineTranslationTimeout((signal) =>
        translateWholeLyricWithDeepL({
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
      if (result.sameLanguage) {
        return {
          ok: false,
          status: "same-language",
          provider: result.provider,
          detectedSourceLanguage: result.detectedSourceLanguage,
          billedCharacters: result.billedCharacters,
          cached: false,
        };
      }
      return {
        ok: true,
        status: "translated",
        tlyric: result.tlyric,
        provider: result.provider,
        targetLanguage: result.targetLanguage,
        detectedSourceLanguage: result.detectedSourceLanguage,
        billedCharacters: result.billedCharacters,
        lineCount: result.lineCount,
        cached: false,
      };
    } catch (error) {
      return machineTranslationFailure(error);
    }
  }
);

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
  isPlaying ? setThumbbarPlay() : setThumbarPause();
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
  app.on("ready", () => {
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
  if (mainWindow.webContents.isDevToolsOpened()) {
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
  disableGlobalShortcuts();
});
