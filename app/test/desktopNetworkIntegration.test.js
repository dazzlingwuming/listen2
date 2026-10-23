const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createDesktopNetworkPolicy } = require("../desktopNetworkPolicy");
const { createDesktopNetworkBridge } = require("../desktopNetworkBridge");

const main = fs.readFileSync(path.join(__dirname, "../main.js"), "utf8");
const mainUrl = "file:///application/listen1_chrome_extension/listen1.html";
const tick = () => new Promise((resolve) => setImmediate(resolve));
function fixture(options = {}) {
  const calls = [];
  const saved = [];
  const handlers = new Map();
  const frame = { url: mainUrl };
  const contents = {
    mainFrame: frame,
    send: (...args) => calls.push(["reply", ...args]),
  };
  const window = { webContents: contents, isDestroyed: () => false };
  const event = { sender: contents, senderFrame: frame };
  const native = ["default", "electron-updater"].map((name) => ({
    name,
    session: {
      async setProxy(config) {
        calls.push([name, config]);
      },
      async clearHostResolverCache() {},
      async closeAllConnections() {},
    },
  }));
  const policy = createDesktopNetworkPolicy({
    configureHostResolver: async (config) => {
      calls.push(["resolver", config]);
      if (options.configure) await options.configure();
    },
    getManagedSessions: () => native,
    resolveHost: async () => ({ endpoints: [{ address: "1.2.3.4" }] }),
    persist: (snapshot) => saved.push(snapshot),
  });
  let updaterStarts = 0;
  const bridge = createDesktopNetworkBridge({
    policy,
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    getMainWindow: () => window,
    mainUrl,
    startUpdater: () => {
      updaterStarts += 1;
      if (options.updaterFails) throw new Error("optional updater unavailable");
    },
  });
  bridge.register();
  return {
    bridge,
    policy,
    handlers,
    calls,
    saved,
    event,
    frame,
    window,
    get updaterStarts() {
      return updaterStarts;
    },
  };
}

test("main initializes both application sessions before loading player or updater", () => {
  const ready = main.slice(main.indexOf('app.on("ready", async () => {'));
  assert.ok(ready.indexOf("desktopNetworkPolicy.initialize(") >= 0);
  assert.ok(
    ready.indexOf("desktopNetworkPolicy.initialize(") <
      ready.indexOf("createWindow();")
  );
  assert.ok(
    ready.indexOf("createWindow();") < ready.indexOf("createDesktopUpdater({")
  );
  assert.match(ready, /maybeStartUpdater\(networkStartupState\)/);
  assert.match(main, /name: "default", session: session\.defaultSession/);
  assert.match(
    main,
    /session\.fromPartition\("electron-updater", \{ cache: false \}\)/
  );
  assert.match(
    main,
    /store\.set\(snapshot\);\s+proxyConfig = snapshot\.proxyConfig/
  );
  assert.match(main, /networkPolicy: store\.get\("networkPolicy"\)/);
  assert.doesNotMatch(main, /\.setProxy\(/);
  assert.doesNotMatch(main, /store\.set\("proxyConfig", proxyConfig\)/);
  assert.match(
    main,
    /mainWindow\.loadURL\(mainPlayerUrl, \{ userAgent: ua \}\)/
  );
  assert.match(
    main,
    /case "get_proxy_config":\s+case "update_proxy_config":\s+await desktopNetworkBridge\.handleLegacy\(event, arg, params\)/
  );
});

test("both new invoke handlers require the local player's exact main frame", async () => {
  const f = fixture();
  await f.policy.initialize({});
  const get = f.handlers.get("network:getState");
  const apply = f.handlers.get("network:applyConfig");
  assert.equal(get(f.event).ok, true);
  const invalid = [
    {},
    { ...f.event, sender: { ...f.event.sender } },
    { ...f.event, senderFrame: { url: mainUrl } },
  ];
  for (const event of invalid) {
    assert.equal(get(event).errorCode, "untrusted-source");
    assert.equal(
      (await apply(event, { mode: "enhanced-direct" })).errorCode,
      "untrusted-source"
    );
  }
  for (const url of [
    "https://music.163.com/",
    "file:///unrelated/listen1.html",
    `${mainUrl}?untrusted=1`,
    "file://remote/application/listen1_chrome_extension/listen1.html",
  ]) {
    f.frame.url = url;
    assert.equal(get(f.event).errorCode, "untrusted-source");
    assert.equal(
      (await apply(f.event, { mode: "direct" })).errorCode,
      "untrusted-source"
    );
  }
  f.frame.url = `${mainUrl}#settings`;
  assert.equal(get(f.event).ok, true);
  assert.equal(f.saved.length, 0);
  assert.equal(f.updaterStarts, 0);
});

test("legacy get/update share overlay state and cannot send enhanced mode to Electron", async () => {
  const f = fixture();
  await f.policy.initialize({
    proxyConfig: { proxyRules: "http://127.0.0.1:7890" },
  });
  const enabled = await f.bridge.handleLegacy(f.event, "update_proxy_config", {
    mode: "enhanced-direct",
  });
  assert.equal(enabled.enhancedDirect, true);
  await f.bridge.handleLegacy(f.event, "get_proxy_config");
  assert.deepEqual(f.calls.at(-1), [
    "reply",
    "proxyConfig",
    { mode: "enhanced-direct" },
  ]);
  const modes = f.calls.filter(
    ([name]) => name === "default" || name === "electron-updater"
  );
  assert.ok(modes.every(([, config]) => config.mode !== "enhanced-direct"));
  const result = await f.bridge.handleLegacy(f.event, "update_proxy_config", {
    mode: "direct",
  });
  assert.equal(result.enhancedDirect, false);
  assert.deepEqual(f.saved.at(-1).proxyConfig, { mode: "direct" });
  const before = f.calls.length;
  await f.bridge.handleLegacy(
    { ...f.event, senderFrame: {} },
    "update_proxy_config",
    { mode: "system" }
  );
  assert.equal(f.calls.length, before);
});

test("failed startup suppresses updater and successful explicit recovery starts it once", async () => {
  let available = false;
  const f = fixture({
    configure: () => {
      if (!available) throw new Error("unavailable");
    },
  });
  const initial = await f.policy.initialize({
    networkPolicy: { version: 1, enhancedDirect: true },
  });
  f.bridge.maybeStartUpdater(initial);
  await tick();
  assert.equal(f.updaterStarts, 0);
  available = true;
  assert.equal(
    (
      await f.handlers.get("network:applyConfig")(f.event, {
        mode: "enhanced-direct",
      })
    ).ok,
    true
  );
  await tick();
  assert.equal(f.updaterStarts, 1);
  await f.bridge.applyConfig(f.event, { mode: "direct" });
  f.bridge.maybeStartUpdater(f.policy.getState());
  await tick();
  assert.equal(f.updaterStarts, 1);
});

test("optional updater failure does not reject a successful policy change or retry discovery", async () => {
  const f = fixture({ updaterFails: true });
  const initial = await f.policy.initialize({});
  f.bridge.maybeStartUpdater(initial);
  await tick();
  assert.equal(
    (await f.bridge.applyConfig(f.event, { mode: "direct" })).ok,
    true
  );
  await tick();
  assert.equal(f.updaterStarts, 1);
});
