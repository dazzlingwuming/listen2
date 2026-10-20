const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createDesktopNetworkPolicy } = require("../desktopNetworkPolicy");

function fixture(options = {}) {
  const resolver = [];
  const persisted = [];
  const checks = [];
  const nativeCalls = [];
  const entries = ["default", "electron-updater"].map((name) => {
    const selected = {
      async setProxy(config) {
        nativeCalls.push([name, "proxy", config]);
        if (options.setProxy) await options.setProxy(name, config);
        selected.proxy = config;
      },
      async clearHostResolverCache() {
        nativeCalls.push([name, "dns"]);
      },
      async closeAllConnections() {
        nativeCalls.push([name, "connections"]);
      },
    };
    return { name, session: selected };
  });
  const policy = createDesktopNetworkPolicy({
    platform: options.platform || "darwin",
    getManagedSessions: () => options.entries || entries,
    configureHostResolver: async (config) => {
      resolver.push(config);
      if (options.configure) await options.configure(config);
    },
    persist: async (config) => {
      persisted.push(config);
      if (options.persist) await options.persist(config, persisted.length);
    },
    resolveHost: async (session, hostname) => {
      checks.push({ session, hostname });
      return options.resolve
        ? options.resolve(hostname)
        : { endpoints: [{ address: "1.2.3.4", family: "ipv4" }] };
    },
    validationTimeoutMs: options.timeout || 100,
  });
  return { policy, entries, resolver, persisted, checks, nativeCalls };
}

test("overlay covers both sessions, keeps custom base, and never touches lyric session", async () => {
  const f = fixture();
  const custom = { proxyRules: "socks5://127.0.0.1:7890" };
  assert.equal((await f.policy.initialize({ proxyConfig: custom })).ok, true);
  assert.equal(f.checks.length, 0);
  assert.equal(f.persisted.length, 0);
  const enabled = await f.policy.applyConfig({
    mode: "enhanced-direct",
    secureDnsServers: ["https://untrusted.invalid/dns-query"],
  });
  assert.equal(enabled.ok, true);
  assert.deepEqual(enabled.baseProxyConfig, custom);
  assert.deepEqual(enabled.config, { mode: "enhanced-direct" });
  assert.deepEqual(f.resolver.at(-1), {
    enableBuiltInResolver: true,
    secureDnsMode: "secure",
    secureDnsServers: [
      "https://dns.google/dns-query",
      "https://dns.alidns.com/dns-query",
      "https://cloudflare-dns.com/dns-query",
    ],
  });
  assert.deepEqual(f.checks.map((check) => check.hostname).sort(), [
    "music.163.com",
    "songsearch.kugou.com",
  ]);
  for (const { session } of f.entries) {
    assert.deepEqual(session.proxy, { mode: "direct" });
  }
  for (const name of ["default", "electron-updater"]) {
    assert.equal(
      f.nativeCalls.filter((call) => call[0] === name && call[1] === "dns")
        .length,
      2
    );
    assert.equal(
      f.nativeCalls.filter(
        (call) => call[0] === name && call[1] === "connections"
      ).length,
      2
    );
  }
  assert.deepEqual(f.persisted[0], {
    proxyConfig: custom,
    networkPolicy: { version: 1, enhancedDirect: true },
  });
  const disabled = await f.policy.applyConfig(custom);
  assert.equal(disabled.enhancedDirect, false);
  assert.deepEqual(disabled.config, custom);
  assert.equal(f.resolver.at(-1).secureDnsMode, "automatic");
  assert.deepEqual(f.resolver.at(-1).secureDnsServers, []);
  for (const { session } of f.entries) assert.deepEqual(session.proxy, custom);
});

test("legacy raw proxy IPC shapes disable overlay and update the base", async () => {
  const f = fixture();
  await f.policy.initialize({
    networkPolicy: { version: 1, enhancedDirect: true },
  });
  for (const config of [
    { mode: "system" },
    { mode: "direct" },
    { proxyRules: "http://127.0.0.1:8080" },
  ]) {
    const state = await f.policy.applyConfig(config);
    assert.equal(state.ok, true);
    assert.equal(state.enhancedDirect, false);
    assert.deepEqual(state.config, config);
    assert.deepEqual(f.persisted.at(-1).proxyConfig, config);
  }
});

test("saved enhanced startup applies policy offline without DNS checks or persistence", async () => {
  const f = fixture({
    resolve: () => {
      throw new Error("Must not reach the network");
    },
  });
  const state = await f.policy.initialize({
    networkPolicy: { version: 1, enhancedDirect: true },
  });
  assert.equal(state.ok, true);
  assert.equal(state.enhancedDirect, true);
  assert.equal(f.checks.length, 0);
  assert.equal(f.persisted.length, 0);
  assert.equal(f.resolver[0].secureDnsMode, "secure");
});

test("damaged legacy base cannot silently disable a saved enhanced overlay", async () => {
  const f = fixture();
  const state = await f.policy.initialize({
    proxyConfig: { mode: "unsupported" },
    networkPolicy: { version: 1, enhancedDirect: true },
  });
  assert.equal(state.ok, false);
  assert.equal(state.errorCode, "invalid-config");
  assert.equal(state.enhancedDirect, true);
  assert.deepEqual(state.config, { mode: "enhanced-direct" });
  assert.equal(f.persisted.length, 0);
  for (const { session } of f.entries) {
    assert.deepEqual(session.proxy, { mode: "direct" });
  }
  assert.equal((await f.policy.applyConfig({ mode: "direct" })).ok, true);
});

for (const platform of ["darwin", "win32", "linux"]) {
  test(`normal mode restores documented ${platform} builtin resolver default`, async () => {
    const f = fixture({ platform });
    await f.policy.initialize({});
    assert.equal(f.resolver[0].enableBuiltInResolver, platform === "darwin");
  });
}

test("concurrent changes are serialized across validation and persistence", async () => {
  let release;
  const barrier = new Promise((resolve) => {
    release = resolve;
  });
  const f = fixture({
    resolve: async () => {
      await barrier;
      return { endpoints: [{ address: "1.2.3.4" }] };
    },
  });
  await f.policy.initialize({});
  const first = f.policy.applyConfig({ mode: "enhanced-direct" });
  const second = f.policy.applyConfig({ mode: "direct" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.resolver.length, 2);
  assert.equal(f.policy.getState().status, "applying");
  release();
  assert.equal((await first).enhancedDirect, true);
  assert.equal((await second).enhancedDirect, false);
  assert.deepEqual(
    f.persisted.map((value) => value.networkPolicy.enhancedDirect),
    [true, false]
  );
});

for (const address of [
  "198.18.1.2",
  "10.0.0.1",
  "127.0.0.1",
  "::1",
  "not-an-address",
]) {
  test(`unsafe DNS answer ${address} rejects enable and restores old policy`, async () => {
    const f = fixture({ resolve: () => ({ endpoints: [{ address }] }) });
    await f.policy.initialize({ proxyConfig: { mode: "system" } });
    const state = await f.policy.applyConfig({ mode: "enhanced-direct" });
    assert.equal(state.ok, false);
    assert.equal(state.errorCode, "resolver-check-failed");
    assert.equal(state.enhancedDirect, false);
    assert.deepEqual(state.config, { mode: "system" });
    assert.equal(f.persisted.length, 0);
    for (const { session } of f.entries)
      assert.deepEqual(session.proxy, { mode: "system" });
  });
}

test("unresponsive resolver has a shared bounded deadline and does not persist", async () => {
  const f = fixture({ timeout: 10, resolve: () => new Promise(() => {}) });
  await f.policy.initialize({});
  const state = await f.policy.applyConfig({ mode: "enhanced-direct" });
  assert.equal(state.errorCode, "resolver-check-timeout");
  assert.equal(f.persisted.length, 0);
  assert.equal(f.resolver.at(-1).secureDnsMode, "automatic");
});

test("one native session failure restores every session and hides raw errors", async () => {
  let fail = true;
  const f = fixture({
    setProxy: (name, config) => {
      if (fail && name === "electron-updater" && config.mode === "direct") {
        fail = false;
        throw new Error("sensitive-native-error");
      }
    },
  });
  await f.policy.initialize({});
  const state = await f.policy.applyConfig({ mode: "enhanced-direct" });
  assert.equal(state.errorCode, "policy-apply-failed");
  assert.equal(JSON.stringify(state).includes("sensitive-native-error"), false);
  for (const { session } of f.entries)
    assert.deepEqual(session.proxy, { mode: "system" });
});

test("persistence failure restores both native and stored previous snapshot", async () => {
  const f = fixture({
    persist: (_value, count) => {
      if (count === 1) throw new Error("disk failure");
    },
  });
  await f.policy.initialize({});
  const state = await f.policy.applyConfig({ mode: "enhanced-direct" });
  assert.equal(state.errorCode, "persist-failed");
  assert.deepEqual(f.persisted.at(-1), {
    proxyConfig: { mode: "system" },
    networkPolicy: { version: 1, enhancedDirect: false },
  });
  for (const { session } of f.entries)
    assert.deepEqual(session.proxy, { mode: "system" });
});

test("rollback failure reports unknown native state without claiming success", async () => {
  const f = fixture({
    persist: () => {
      throw new Error("always fails");
    },
  });
  await f.policy.initialize({});
  const state = await f.policy.applyConfig({ mode: "enhanced-direct" });
  assert.equal(state.ok, false);
  assert.equal(state.errorCode, "rollback-failed");
  assert.equal(state.config, null);
  assert.equal(state.nativeState, "unknown");
});

test("saved enhanced native startup failure stays direct instead of restoring system", async () => {
  const f = fixture({
    configure: () => {
      throw new Error("native resolver unavailable");
    },
  });
  const state = await f.policy.initialize({
    proxyConfig: { mode: "system" },
    networkPolicy: { version: 1, enhancedDirect: true },
  });
  assert.equal(state.ok, false);
  assert.equal(state.errorCode, "startup-policy-failed");
  assert.equal(state.enhancedDirect, false);
  assert.deepEqual(state.config, { mode: "direct" });
  assert.equal(state.nativeState, "direct-only");
  assert.equal(f.persisted.length, 0);
  assert.equal(f.checks.length, 0);
  for (const { session } of f.entries)
    assert.deepEqual(session.proxy, { mode: "direct" });
});

test("the same apply action recovers a failed startup without restarting", async () => {
  let nativeAvailable = false;
  const f = fixture({
    configure: () => {
      if (!nativeAvailable) throw new Error("temporarily unavailable");
    },
  });
  const startup = await f.policy.initialize({
    proxyConfig: { proxyRules: "socks5://127.0.0.1:7890" },
    networkPolicy: { version: 1, enhancedDirect: true },
  });
  assert.equal(startup.errorCode, "startup-policy-failed");
  nativeAvailable = true;
  const recovered = await f.policy.applyConfig({ mode: "enhanced-direct" });
  assert.equal(recovered.ok, true);
  assert.equal(recovered.status, "ready");
  assert.equal(recovered.enhancedDirect, true);
  assert.equal(recovered.errorCode, null);
  assert.equal(f.checks.length, 2);
  assert.deepEqual(f.persisted.at(-1), {
    proxyConfig: { proxyRules: "socks5://127.0.0.1:7890" },
    networkPolicy: { version: 1, enhancedDirect: true },
  });
});

test("failed explicit recovery stays direct and can be retried again", async () => {
  let nativeAvailable = false;
  const f = fixture({
    configure: () => {
      if (!nativeAvailable) throw new Error("temporarily unavailable");
    },
  });
  await f.policy.initialize({
    networkPolicy: { version: 1, enhancedDirect: true },
  });
  const failed = await f.policy.applyConfig({ mode: "system" });
  assert.equal(failed.ok, false);
  assert.equal(failed.errorCode, "policy-apply-failed");
  assert.equal(failed.nativeState, "direct-only");
  assert.deepEqual(failed.config, { mode: "direct" });
  assert.equal(f.persisted.length, 0);
  for (const { session } of f.entries)
    assert.deepEqual(session.proxy, { mode: "direct" });
  nativeAvailable = true;
  const recovered = await f.policy.applyConfig({ mode: "direct" });
  assert.equal(recovered.ok, true);
  assert.equal(recovered.enhancedDirect, false);
  assert.deepEqual(f.persisted.at(-1).proxyConfig, { mode: "direct" });
});

test("a managed list including isolated lyrics is rejected before touching it", async () => {
  let touched = false;
  const f = fixture({
    entries: [
      { name: "default", session: {} },
      {
        name: "persist:netease-lyrics-v1",
        session: {
          setProxy() {
            touched = true;
          },
        },
      },
    ],
  });
  assert.equal((await f.policy.initialize({})).ok, false);
  assert.equal(touched, false);
});

test("caller mutation cannot rewrite effective config or persisted policy", async () => {
  const f = fixture();
  const custom = { proxyRules: "socks5://127.0.0.1:7890" };
  await f.policy.initialize({ proxyConfig: custom });
  custom.proxyRules = "changed";
  const state = f.policy.getState();
  state.baseProxyConfig.proxyRules = "changed-again";
  assert.equal(
    f.policy.getState().baseProxyConfig.proxyRules,
    "socks5://127.0.0.1:7890"
  );
});
