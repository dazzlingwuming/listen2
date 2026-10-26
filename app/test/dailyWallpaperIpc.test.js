const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { registerDailyWallpaperIpc } = require("../dailyWallpaper");

function harness() {
  const handlers = new Map();
  const listeners = new Map();
  const mainUrl = "file:///app/listen1_chrome_extension/listen1.html";
  const mainFrame = { url: mainUrl };
  const window = { webContents: { mainFrame }, isDestroyed: () => false };
  const event = { sender: window.webContents, senderFrame: mainFrame };
  const gets = [];
  let cancellations = 0;
  let serviceAccess = 0;
  let currentWindow = window;
  registerDailyWallpaperIpc({
    ipcMain: {
      handle: (key, handler) => handlers.set(key, handler),
      on: (key, handler) => listeners.set(key, handler),
    },
    mainUrl,
    getMainWindow: () => currentWindow,
    getService: () => {
      serviceAccess += 1;
      return {
        get: async (payload) => {
          gets.push(payload);
          return { ok: true, status: "cached" };
        },
        cancel: () => {
          cancellations += 1;
        },
      };
    },
  });
  return {
    handlers,
    listeners,
    event,
    window,
    gets,
    serviceAccess: () => serviceAccess,
    cancellations: () => cancellations,
    setWindow: (value) => {
      currentWindow = value;
    },
  };
}

test("only the actual main player main frame can get or cancel wallpapers", async () => {
  const f = harness();
  for (const event of [
    null,
    {},
    { ...f.event, sender: {} },
    { ...f.event, senderFrame: { url: f.event.senderFrame.url } },
  ]) {
    assert.equal(
      (await f.handlers.get("daily-wallpaper:get")(event, { refresh: true }))
        .errorCode,
      "untrusted-sender"
    );
    f.listeners.get("daily-wallpaper:cancel")(event);
  }
  assert.equal(f.serviceAccess(), 0);
  f.event.senderFrame.url = "https://example.test/";
  assert.equal(
    (await f.handlers.get("daily-wallpaper:get")(f.event, { refresh: true }))
      .ok,
    false
  );
  f.listeners.get("daily-wallpaper:cancel")(f.event);
  assert.equal(f.serviceAccess(), 0);
  f.event.senderFrame.url =
    "file:///app/listen1_chrome_extension/listen1.html#theme";
  assert.equal(
    (await f.handlers.get("daily-wallpaper:get")(f.event, { refresh: true }))
      .ok,
    true
  );
  f.gets.length = 0;
  for (const url of [
    "file:///app/listen1_chrome_extension/listen1.html?foreign=1#theme",
    "file:///app/listen1_chrome_extension/other.html#theme",
    "file://foreign/app/listen1_chrome_extension/listen1.html#theme",
    "not a URL",
  ]) {
    f.event.senderFrame.url = url;
    assert.equal(
      (await f.handlers.get("daily-wallpaper:get")(f.event, { refresh: true }))
        .errorCode,
      "untrusted-sender"
    );
  }
  f.event.senderFrame.url = "file:///app/listen1_chrome_extension/listen1.html";
  assert.equal(
    (await f.handlers.get("daily-wallpaper:get")(f.event, { refresh: false }))
      .ok,
    true
  );
  assert.deepEqual(f.gets, [{ refresh: false }]);
  assert.equal(
    (await f.handlers.get("daily-wallpaper:get")(f.event, { refresh: true }))
      .ok,
    true
  );
  f.listeners.get("daily-wallpaper:cancel")(f.event);
  assert.equal(f.cancellations(), 1);
});

test("invalid payloads and closed windows cannot start service access", async () => {
  const f = harness();
  for (const payload of [
    undefined,
    null,
    [],
    true,
    {},
    { refresh: "true" },
    { refresh: 1 },
    { refresh: true, url: "https://evil.test/" },
    { refresh: true, path: "/tmp/cache" },
  ]) {
    assert.equal(
      (await f.handlers.get("daily-wallpaper:get")(f.event, payload)).errorCode,
      "invalid-request"
    );
  }
  assert.equal(f.serviceAccess(), 0);
  f.window.isDestroyed = () => true;
  assert.equal(
    (await f.handlers.get("daily-wallpaper:get")(f.event, { refresh: true }))
      .errorCode,
    "untrusted-sender"
  );
  f.listeners.get("daily-wallpaper:cancel")(f.event);
  f.setWindow(null);
  assert.equal(
    (await f.handlers.get("daily-wallpaper:get")(f.event, { refresh: true }))
      .errorCode,
    "untrusted-sender"
  );
  assert.equal(f.serviceAccess(), 0);
});

test("desktop wiring keeps network policy and native decode in the main process", () => {
  const main = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
  assert.match(
    main,
    /fetch: \(url, options\) => session\.defaultSession\.fetch\(url, options\)/
  );
  assert.match(
    main,
    /cacheDirectory: join\(app\.getPath\("userData"\), "appearance"\)/
  );
  assert.match(
    main,
    /decodeImage: \(bytes\) => electron\.nativeImage\.createFromBuffer\(bytes\)/
  );
  assert.match(
    main,
    /registerDailyWallpaperIpc\(\{[\s\S]*?mainUrl: mainPlayerUrl/
  );
  assert.match(
    main,
    /mainWindow\.on\("close", \(e\) => \{\s*if \(dailyWallpaperService\) dailyWallpaperService\.cancel\(\)/
  );
  assert.match(
    main,
    /app\.on\("before-quit", \(event\) => \{\s*if \(dailyWallpaperService\) dailyWallpaperService\.cancel\(\)/
  );
});
