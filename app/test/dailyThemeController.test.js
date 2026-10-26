const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {
  makePalette,
} = require("../listen1_chrome_extension/js/wallpaper_theme");
const frontend = path.join(__dirname, "../listen1_chrome_extension");
const tick = () => new Promise((resolve) => setImmediate(resolve));
const image = "data:image/jpeg;base64,YWJj";
const seed = {
  hue: 215,
  saturation: 0.5,
  accentHue: 215,
  accentSaturation: 0.5,
  brightness: 0.2,
};
const record = {
  version: 1,
  date: "2026-10-25",
  sourceDate: "2026-10-25",
  image,
  title: "Daily landscape",
  copyright: "Photo credit",
};
function fixture({ electron = true, savedTheme = "sakura", getDaily } = {}) {
  let controller;
  const calls = [];
  const properties = new Map();
  const events = new Map();
  const values = { theme: savedTheme };
  const elements = { "theme-css": {}, "common-css": {} };
  const scope = {
    $evalAsync: (fn) => fn(),
    $applyAsync: (fn) => fn(),
    $on: (key, fn) => events.set(key, fn),
  };
  const doc = {
    hidden: false,
    documentElement: {
      dataset: {},
      classList: { toggle() {} },
      style: {
        setProperty: (key, value) => properties.set(key, value),
        removeProperty: (key) => properties.delete(key),
      },
    },
    getElementById: (id) => elements[id] || null,
    addEventListener: (key, fn) => events.set(`doc:${key}`, fn),
    removeEventListener: (key) => events.delete(`doc:${key}`),
  };
  let saves = 0;
  const wallpaper = {
    load: async () => null,
    fromDataUrl: async () => ({ image, seed }),
    fromFile: async () => ({
      version: 1,
      image: "data:image/webp;base64,Y3VzdG9t",
      seed,
      mode: "auto",
    }),
    makePalette,
    save: async () => {
      saves += 1;
    },
    remove: async () => {},
  };
  const window = {
    document: doc,
    navigator: { platform: "MacIntel" },
    localStorage: { getItem: () => null, setItem() {} },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    dispatchEvent() {},
    requestAnimationFrame: (fn) => fn(),
    addEventListener: (key, fn) => events.set(`window:${key}`, fn),
    removeEventListener: (key) => events.delete(`window:${key}`),
    Listen2Wallpaper: wallpaper,
  };
  const context = vm.createContext({
    window,
    document: doc,
    navigator: { language: "zh-CN" },
    Event: class Event {},
    setTimeout: () => 1,
    clearTimeout() {},
    localStorage: {
      getObject: (key) => values[key] ?? null,
      setObject: (key, value) => {
        values[key] = value;
      },
    },
    angular: {
      module: () => ({
        controller: (_, definition) => {
          controller = definition[1];
        },
      }),
    },
    i18next: { changeLanguage: async () => (key) => key, getResourceBundle: () => ({}) },
    axios: { get: async () => ({ data: {} }) },
    sourceList: [],
    platformSourceList: [],
    isElectron: () => electron,
    require: () => ({
      ipcRenderer: {
        invoke: async (channel, payload) => {
          calls.push({ channel, payload });
          if (channel === "daily-wallpaper:get")
            return getDaily
              ? getDaily(payload)
              : {
                  ok: true,
                  status: "cached",
                  requestedDate: record.date,
                  wallpaper: record,
                };
          return { ok: false };
        },
        send: (channel) => {
          calls.push({ channel, transport: "send" });
        },
      },
    }),
  });
  for (const file of [
    "appearance.js",
    "daily_theme.js",
    "controller/profile.js",
  ])
    vm.runInContext(
      fs.readFileSync(path.join(frontend, "js", file), "utf8"),
      context,
      { filename: file }
    );
  controller(scope);
  return {
    scope,
    calls,
    properties,
    values,
    events,
    elements,
    get saves() {
      return saves;
    },
  };
}

test("gallery adds exactly one desktop daily option and does no daily IPC before selection", async () => {
  const f = fixture();
  await tick();
  assert.equal(f.scope.themeOptions.length, 14);
  assert.equal(
    f.scope.themeOptions.filter((item) => item.id === "daily").length,
    1
  );
  assert.equal(
    f.calls.filter((call) => call.channel.startsWith("daily-")).length,
    0
  );
  const browser = fixture({ electron: false, savedTheme: "daily" });
  await tick();
  assert.equal(browser.scope.themeOptions.length, 13);
  assert.equal(
    browser.scope.themeOptions.some((item) => item.id === "daily"),
    false
  );
  assert.equal(browser.scope.theme, "black2");
  assert.equal(browser.calls.length, 0);
  f.events.get("$destroy")();
});

test("saved daily initializes before restoration, applies palette and preserves personal storage", async () => {
  const f = fixture({ savedTheme: "daily" });
  await tick();
  assert.equal(f.scope.theme, "daily");
  assert.equal(f.scope.dailyWallpaper.title, record.title);
  assert.equal(f.scope.themeSceneUrl, image);
  assert.equal(f.scope.dailyThemeStatus, "_DAILY_THEME_CACHED");
  assert(f.properties.has("--daily-accent"));
  assert.equal(f.properties.has("--custom-accent"), false);
  assert.equal(f.saves, 0);
  assert.deepEqual(
    f.calls
      .filter((call) => call.channel === "daily-wallpaper:get")
      .map((call) => call.payload.refresh),
    [false, true]
  );
  f.scope.setTheme("white2");
  assert.equal(f.values.theme, "white2");
  assert.equal(
    f.calls.filter((call) => call.channel === "daily-wallpaper:cancel").at(-1)
      .transport,
    "send"
  );
  assert.equal(
    f.calls.filter((call) => call.channel === "daily-wallpaper:get").length,
    2
  );
  assert.equal(f.scope.themeClass["theme-daily"], undefined);
  assert.equal(f.elements["theme-css"].href, "css/iparanoid2.css");
  f.events.get("$destroy")();
});

test("custom import/remove retains one daily option and custom remains independent", async () => {
  const f = fixture();
  await tick();
  await f.scope.importWallpaper({});
  assert.equal(f.scope.theme, "custom");
  assert.equal(f.scope.themeOptions.length, 15);
  assert.equal(
    f.scope.themeOptions.filter((item) => item.id === "daily").length,
    1
  );
  const custom = f.scope.customWallpaper;
  const accent = f.properties.get("--custom-accent");
  f.scope.setTheme("daily");
  await tick();
  assert.equal(f.scope.customWallpaper, custom);
  assert.equal(f.properties.get("--custom-accent"), accent);
  await f.scope.removeWallpaper();
  assert.equal(f.scope.theme, "daily");
  assert.equal(f.scope.themeOptions.length, 14);
  assert.equal(
    f.scope.themeOptions.some((item) => item.id === "custom"),
    false
  );
  assert.equal(
    f.scope.themeOptions.filter((item) => item.id === "daily").length,
    1
  );
  f.events.get("$destroy")();
});

test("no cache/offline keeps daily selected on bundled background; late responses cannot change chosen theme", async () => {
  const f = fixture({
    savedTheme: "daily",
    getDaily: async () => ({ ok: false, status: "unavailable" }),
  });
  await tick();
  assert.equal(f.scope.theme, "daily");
  assert.equal(f.scope.themeSceneUrl, "images/themes/ocean-scene.webp");
  assert.equal(f.scope.dailyThemeStatus, "_DAILY_THEME_UNAVAILABLE");
  f.events.get("$destroy")();
  let resolve;
  const pending = new Promise((done) => {
    resolve = done;
  });
  const g = fixture({ getDaily: () => pending });
  g.scope.setTheme("daily");
  g.scope.setTheme("aurora");
  resolve({ ok: true, status: "fresh", wallpaper: record });
  await tick();
  assert.equal(g.scope.theme, "aurora");
  assert.equal(g.scope.dailyWallpaper, null);
  assert.equal(g.properties.has("--daily-accent"), false);
  g.events.get("$destroy")();
});

test("gallery preview stays local and source uses validated attribution with a Bing fallback", () => {
  const html = fs.readFileSync(path.join(frontend, "listen1.html"), "utf8");
  assert.match(
    html,
    /dailyWallpaper.image \|\| 'images\/themes\/ocean-preview.webp'/
  );
  const sourceBinding = html.match(
    /open-url="(dailyWallpaper\.attributionUrl[^"]+)"/
  );
  assert(
    sourceBinding,
    "daily source uses the backend-validated attribution URL"
  );
  const attributionUrl = "https://www.bing.com/search?q=landscape";
  assert.equal(
    vm.runInNewContext(sourceBinding[1], {
      dailyWallpaper: { attributionUrl },
    }),
    attributionUrl
  );
  assert.equal(
    vm.runInNewContext(sourceBinding[1], { dailyWallpaper: {} }),
    "https://www.bing.com/"
  );
  assert.match(html, /aria-live="polite" aria-atomic="true"/);
  for (const locale of fs.readdirSync(path.join(frontend, "i18n"))) {
    const strings = JSON.parse(
      fs.readFileSync(path.join(frontend, "i18n", locale), "utf8")
    );
    for (const key of [
      "_THEME_DAILY",
      "_THEME_DAILY_DESC",
      "_DAILY_THEME_STALE",
      "_DAILY_THEME_UNAVAILABLE",
      "_DAILY_THEME_SOURCE",
    ])
      assert.equal(typeof strings[key], "string", `${locale}: ${key}`);
  }
});
