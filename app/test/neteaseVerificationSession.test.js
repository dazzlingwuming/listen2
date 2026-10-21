const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter, once } = require("node:events");
const { PassThrough } = require("node:stream");
const net = require("node:net");
const { createPublicDnsResolver } = require("../lyricDirectTransport");
const {
  createNeteaseVerificationSession,
  createNeteaseTunnelProxy,
  isNeteaseVerificationUrl,
  isNeteaseResourceUrl,
  PARTITION,
} = require("../neteaseVerificationSession");
const SEARCH =
  "https://music.163.com/api/search/get/web?s=test&type=1&offset=0&limit=20";
const LYRIC = "https://music.163.com/api/song/lyric?id=123&lv=-1&kv=-1&tv=-1";
const VERIFY =
  "https://st.music.163.com/official-verification?token=SYNTHETIC_TEST";
const tick = () => new Promise((resolve) => setImmediate(resolve));
function challenge(url = VERIFY) {
  return {
    ok: true,
    data: JSON.stringify({
      code: -462,
      data: { verifyUrl: url, token: "SYNTHETIC_TEST" },
    }),
  };
}
function fixture(options = {}) {
  const selected = new EventEmitter();
  const fetchCalls = [];
  const partitionCalls = [];
  const windows = [];
  const proxies = [];
  let flushCount = 0;
  let closeCount = 0;
  selected.getUserAgent = () => "Native Chromium Test UA";
  selected.setUserAgent = (value) => {
    selected.userAgent = value;
  };
  selected.setPermissionRequestHandler = (handler) => {
    selected.permissionRequest = handler;
  };
  selected.setPermissionCheckHandler = (handler) => {
    selected.permissionCheck = handler;
  };
  selected.webRequest = {
    onBeforeRequest(_filter, handler) {
      selected.resourceCheck = handler;
    },
  };
  selected.cookies = {
    async flushStore() {
      flushCount += 1;
    },
    get() {
      throw new Error("Cookies must remain native");
    },
    set() {
      throw new Error("Cookies must remain native");
    },
  };
  selected.setProxy = async (value) => {
    selected.proxyConfig = value;
  };
  selected.closeAllConnections = async () => {
    closeCount += 1;
  };
  selected.fetch = async (url, init) => {
    fetchCalls.push({ url, init });
    return options.response ? options.response() : new Response("{}");
  };
  class Window extends EventEmitter {
    constructor(config) {
      super();
      this.config = config;
      this.webContents = new EventEmitter();
      this.webContents.setUserAgent = (value) => {
        this.userAgent = value;
      };
      this.webContents.setWindowOpenHandler = (handler) => {
        this.windowOpenHandler = handler;
      };
      this.showCount = 0;
      this.focusCount = 0;
      windows.push(this);
    }
    setMenu(value) {
      this.menu = value;
    }
    async loadURL(url, init) {
      this.url = url;
      this.loadOptions = init;
    }
    isDestroyed() {
      return Boolean(this.destroyed);
    }
    show() {
      this.showCount += 1;
    }
    focus() {
      this.focusCount += 1;
    }
    destroy() {
      this.destroyed = true;
      this.emit("closed");
    }
  }
  const factoryOptions = {
    session: {
      fromPartition(value) {
        partitionCalls.push(value);
        return selected;
      },
    },
    BrowserWindow: Window,
    createProxy: async () => {
      const proxy = {
        url: "http://127.0.0.1:12345",
        async dispose() {
          this.disposed = true;
        },
      };
      proxies.push(proxy);
      return proxy;
    },
    now: options.now,
  };
  const service = createNeteaseVerificationSession(factoryOptions);
  return {
    service,
    selected,
    fetchCalls,
    partitionCalls,
    windows,
    proxies,
    factoryOptions,
    flushCount: () => flushCount,
    closeCount: () => closeCount,
  };
}

test("factory is lazy and only NetEase endpoints can create its persistent session", async () => {
  const f = fixture();
  assert.equal(f.partitionCalls.length, 0);
  for (const url of [
    "https://lrclib.net/api/search?q=test",
    "https://music.163.com/api/private",
    SEARCH + "&cookie=bad",
    SEARCH + "&s=other",
    SEARCH + "#fragment",
  ])
    await assert.rejects(f.service.fetch(url));
  assert.equal(f.partitionCalls.length, 0);
  await f.service.fetch(SEARCH, {
    headers: { Cookie: "SYNTHETIC_BAD" },
    credentials: "omit",
  });
  await f.service.fetch(LYRIC);
  assert.deepEqual(f.partitionCalls, [PARTITION]);
  assert.equal(f.proxies.length, 1);
  assert.equal(f.selected.proxyConfig.mode, "fixed_servers");
  assert.equal(f.selected.proxyConfig.proxyRules, f.proxies[0].url);
  for (const { init } of f.fetchCalls) {
    assert.equal(init.credentials, "include");
    assert.equal(init.method, "GET");
    assert.equal(init.redirect, "error");
    assert.equal(init.headers["User-Agent"], f.selected.userAgent);
    assert.equal(init.headers.Cookie, undefined);
  }
  await f.service.dispose();
  assert.equal(f.proxies[0].disposed, true);
  assert.ok(f.flushCount() > 0);
});

test("new service reuses the native persistent partition without exporting or rewriting cookies", async () => {
  const f = fixture();
  await f.service.fetch(SEARCH);
  await f.service.dispose();
  const second = createNeteaseVerificationSession(f.factoryOptions);
  await second.fetch(LYRIC);
  assert.deepEqual(f.partitionCalls, [PARTITION, PARTITION]);
  assert.equal(f.fetchCalls.length, 2);
  assert.deepEqual(Object.keys(second).sort(), [
    "dispose",
    "fetch",
    "observeResult",
    "openVerification",
  ]);
  await second.dispose();
});

test("official URL policy permits same-site SPA fragments and exact official resource hosts", () => {
  for (const url of [
    VERIFY,
    "https://music.163.com/#/verify",
    "https://st.music.163.com/path#step",
  ]) {
    assert.equal(isNeteaseVerificationUrl(url), true);
  }
  for (const url of [
    "http://music.163.com/",
    "https://music.163.com.evil.test/",
    "https://evil.test/",
    "https://user:password@music.163.com/",
    "https://music.163.com:8443/",
    "file:///tmp/test",
    "https://127.0.0.1/",
    "https://c.dun.163.com/",
  ])
    assert.equal(isNeteaseVerificationUrl(url), false);
  assert.equal(
    isNeteaseResourceUrl("https://c.dun.163.com/api/v2/getconf"),
    true
  );
  assert.equal(
    isNeteaseResourceUrl("https://cstaticdun.126.net/load.min.js"),
    true
  );
  assert.equal(isNeteaseResourceUrl("https://any.163.com/script.js"), false);
});

test("challenge response is sanitized in main; absent or untrusted verification URL has no fallback", async () => {
  const f = fixture();
  assert.deepEqual(await f.service.openVerification(), {
    ok: false,
    status: "verification-unavailable",
  });
  const result = f.service.observeResult(challenge(), SEARCH);
  assert.deepEqual(result, {
    ok: false,
    status: "verification-required",
    canVerify: true,
  });
  assert.equal(JSON.stringify(result).includes("SYNTHETIC_TEST"), false);
  assert.equal(JSON.stringify(result).includes("verifyUrl"), false);
  for (const url of [
    "https://evil.test/verify",
    "http://music.163.com/verify",
    "https://music.163.com:8443/",
  ]) {
    assert.deepEqual(f.service.observeResult(challenge(url), SEARCH), {
      ok: false,
      status: "verification-required",
      canVerify: false,
    });
    assert.deepEqual(await f.service.openVerification(), {
      ok: false,
      status: "verification-unavailable",
    });
  }
  assert.equal(f.partitionCalls.length, 0);
  assert.equal(f.windows.length, 0);
  await f.service.dispose();
});

test("verification window uses native session and UA, stays sandboxed and only returns retry-ready on close", async () => {
  const f = fixture();
  f.service.observeResult(challenge(), SEARCH);
  const result = f.service.openVerification({ testParent: true });
  await tick();
  const window = f.windows[0];
  assert.equal(f.service.openVerification(), result);
  assert.equal(window.config.webPreferences.session, f.selected);
  assert.equal(window.config.webPreferences.nodeIntegration, false);
  assert.equal(window.config.webPreferences.contextIsolation, true);
  assert.equal(window.config.webPreferences.sandbox, true);
  assert.equal(window.config.webPreferences.preload, undefined);
  assert.equal(window.userAgent, f.selected.userAgent);
  assert.equal(window.loadOptions.userAgent, f.selected.userAgent);
  assert.equal(window.url, VERIFY);
  assert.deepEqual(window.windowOpenHandler({ url: "https://evil.test/" }), {
    action: "deny",
  });
  assert.ok(window.focusCount >= 2);
  let permission;
  f.selected.permissionRequest(null, "camera", (value) => {
    permission = value;
  });
  assert.equal(permission, false);
  assert.equal(f.selected.permissionCheck(), false);
  let prevented = false;
  f.selected.emit("will-download", {
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
  window.destroy();
  assert.deepEqual(await result, { ok: true, status: "retry-ready" });
  assert.equal(f.flushCount(), 1);
  assert.deepEqual(await f.service.openVerification(), {
    ok: false,
    status: "verification-unavailable",
  });
  await f.service.dispose();
});

test("main frame and official CAPTCHA subframes have separate navigation limits", async () => {
  const f = fixture();
  f.service.observeResult(challenge(), SEARCH);
  const pending = f.service.openVerification();
  await tick();
  const contents = f.windows[0].webContents;
  for (const [url, isMainFrame, blocked] of [
    ["https://music.163.com/#/verify", true, false],
    ["https://c.dun.163.com/api/v2/getconf", false, false],
    ["https://c.dun.163.com/", true, true],
    ["https://evil.test/", false, true],
    ["file:///tmp/test", true, true],
  ]) {
    let prevented = false;
    contents.emit("will-frame-navigate", {
      url,
      isMainFrame,
      preventDefault() {
        prevented = true;
      },
    });
    assert.equal(prevented, blocked, url);
  }
  for (const [isMainFrame, blocked] of [
    [false, false],
    [true, true],
  ]) {
    let prevented = false;
    contents.emit(
      "will-redirect",
      {
        preventDefault() {
          prevented = true;
        },
      },
      "https://c.dun.163.com/verify",
      false,
      isMainFrame
    );
    assert.equal(prevented, blocked);
  }
  for (const [url, cancelled] of [
    ["https://music.163.com/", false],
    ["https://evil.test/", true],
    ["file:///tmp/test", true],
  ]) {
    f.selected.resourceCheck({ url }, (result) =>
      assert.equal(result.cancel, cancelled)
    );
  }
  await f.service.dispose();
  assert.deepEqual(await pending, {
    ok: false,
    status: "verification-unavailable",
  });
});

test("expired challenges never open a window and stale close preserves a newer challenge", async () => {
  let time = 0;
  const f = fixture({ now: () => time });
  f.service.observeResult(challenge(), SEARCH);
  time = 300001;
  assert.deepEqual(await f.service.openVerification(), {
    ok: false,
    status: "verification-unavailable",
  });
  f.service.observeResult(challenge(), SEARCH);
  const first = f.service.openVerification();
  await tick();
  f.service.observeResult(challenge(VERIFY + "&generation=2"), SEARCH);
  f.windows[0].destroy();
  await first;
  const second = f.service.openVerification();
  await tick();
  assert.equal(f.windows.length, 2);
  assert.ok(f.windows[1].url.endsWith("generation=2"));
  await f.service.dispose();
  assert.deepEqual(await second, {
    ok: false,
    status: "verification-unavailable",
  });
});

test("cancellation after response headers cancels body reading and dispose aborts active requests", async () => {
  let cancelled = 0;
  const f = fixture({
    response: () =>
      new Response(
        new ReadableStream({
          cancel() {
            cancelled += 1;
          },
        })
      ),
  });
  const controller = new AbortController();
  const pending = f.service.fetch(SEARCH, { signal: controller.signal });
  await tick();
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(cancelled, 1);
  const second = f.service.fetch(SEARCH);
  await tick();
  const rejected = assert.rejects(second, { name: "AbortError" });
  await f.service.dispose();
  await rejected;
  assert.equal(cancelled, 2);
});

test("decoded response bodies and advertised lengths are bounded", async () => {
  const f = fixture({
    response: () =>
      new Response("{}", { headers: { "content-length": "2097153" } }),
  });
  await assert.rejects(f.service.fetch(SEARCH), {
    code: "LYRIC_INVALID_RESPONSE",
  });
  await f.service.dispose();
  const g = fixture({ response: () => new Response(new Uint8Array(2097153)) });
  await assert.rejects(g.service.fetch(SEARCH), {
    code: "LYRIC_INVALID_RESPONSE",
  });
  await g.service.dispose();
});

test("a native fetch that ignores cancellation is bounded and late rejection is observed", async () => {
  let rejectNative;
  const f = fixture({
    response: () =>
      new Promise((_resolve, reject) => {
        rejectNative = reject;
      }),
  });
  const controller = new AbortController();
  const pending = f.service.fetch(SEARCH, { signal: controller.signal });
  await tick();
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  rejectNative(new Error("Synthetic late rejection"));
  await tick();
  await f.service.dispose();
});

test("NetEase alone prefers the observed reachable Google DNS route; resolver choices stay fixed", async () => {
  const endpoints = [];
  let resolver;
  const f = fixture();
  const service = createNeteaseVerificationSession({
    ...f.factoryOptions,
    dnsFetch: async (value) => {
      const url = new URL(value);
      endpoints.push(url.origin + url.pathname);
      const host = url.searchParams.get("name");
      return new Response(
        JSON.stringify({
          Status: 0,
          Question: [{ name: host + ".", type: 1 }],
          Answer: [{ type: 1, TTL: 20, data: "8.8.8.8" }],
        })
      );
    },
    createProxy: async ({ resolve }) => {
      resolver = resolve;
      return { url: "http://127.0.0.1:12345", async dispose() {} };
    },
  });
  await service.fetch(SEARCH);
  assert.deepEqual(await resolver("music.163.com"), ["8.8.8.8"]);
  assert.deepEqual(endpoints, ["https://dns.google/resolve"]);
  for (const dnsEndpoints of [
    ["https://evil.test/resolve"],
    [
      "https://dns.google/resolve",
      "https://dns.google/resolve",
      "https://dns.alidns.com/resolve",
    ],
  ])
    assert.throws(
      () =>
        createPublicDnsResolver({ fetchImpl: async () => {}, dnsEndpoints }),
      { code: "LYRIC_INVALID_RESPONSE" }
    );
  await service.dispose();
  await f.service.dispose();
});

function fakeConnect(calls) {
  return (options) => {
    calls.push(options);
    const upstream = new PassThrough();
    upstream.setTimeout = () => upstream;
    queueMicrotask(() => upstream.emit("connect"));
    return upstream;
  };
}
async function proxyRequest(
  proxy,
  request,
  until = (value) => value.includes("\r\n\r\n")
) {
  const url = new URL(proxy.url);
  const client = net.connect({ host: url.hostname, port: Number(url.port) });
  client.on("error", () => {});
  await once(client, "connect");
  let output = "";
  const result = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.destroy();
      reject(new Error("Proxy test deadline"));
    }, 1500);
    client.on("data", (data) => {
      output += data.toString();
      if (until(output)) {
        clearTimeout(timer);
        resolve({ client, output });
      }
    });
    client.once("close", () => {
      clearTimeout(timer);
      resolve({ client, output });
    });
  });
  client.write(request);
  return result;
}

test("CONNECT accepts only exact official hosts and 443; plain HTTP and other targets never reach DNS", async () => {
  const resolved = [];
  const connected = [];
  const proxy = await createNeteaseTunnelProxy({
    resolve: async (host) => {
      resolved.push(host);
      return ["8.8.8.8"];
    },
    connect: fakeConnect(connected),
  });
  try {
    for (const request of [
      "GET http://music.163.com/ HTTP/1.1\r\nHost: music.163.com\r\n\r\n",
      "CONNECT evil.test:443 HTTP/1.1\r\nHost: evil.test\r\n\r\n",
      "CONNECT music.163.com:80 HTTP/1.1\r\nHost: music.163.com\r\n\r\n",
      "CONNECT 127.0.0.1:443 HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n",
    ]) {
      const result = await proxyRequest(proxy, request);
      assert.match(result.output, /^HTTP\/1\.1 (403|405)/);
      result.client.destroy();
    }
    assert.equal(resolved.length, 0);
    assert.equal(connected.length, 0);
    const good = await proxyRequest(
      proxy,
      "CONNECT music.163.com:443 HTTP/1.1\r\nHost: music.163.com\r\n\r\nSYNTHETIC_TLS",
      (value) => value.includes("SYNTHETIC_TLS")
    );
    assert.match(good.output, /^HTTP\/1\.1 200/);
    assert.deepEqual(connected, [{ host: "8.8.8.8", port: 443 }]);
    good.client.destroy();
  } finally {
    await proxy.dispose();
  }
});

test("proxy rejects private/fake DNS addresses and cleans up a pending DNS lookup on disposal", async () => {
  const connected = [];
  const proxy = await createNeteaseTunnelProxy({
    resolve: async () => ["127.0.0.1", "198.18.1.1"],
    connect: fakeConnect(connected),
  });
  const result = await proxyRequest(
    proxy,
    "CONNECT music.163.com:443 HTTP/1.1\r\nHost: music.163.com\r\n\r\n"
  );
  assert.equal(result.output, "");
  assert.equal(connected.length, 0);
  await proxy.dispose();
  let signal;
  let dnsStarted;
  const started = new Promise((resolve) => {
    dnsStarted = resolve;
  });
  const pendingProxy = await createNeteaseTunnelProxy({
    resolve: (_host, currentSignal) => {
      signal = currentSignal;
      dnsStarted();
      return new Promise(() => {});
    },
  });
  const pending = proxyRequest(
    pendingProxy,
    "CONNECT music.163.com:443 HTTP/1.1\r\nHost: music.163.com\r\n\r\n"
  );
  await started;
  await pendingProxy.dispose();
  const closed = await pending;
  assert.equal(signal.aborted, true);
  assert.equal(closed.client.destroyed, true);
  await pendingProxy.dispose();
});

test("proxy caps concurrent tunnels and closes live opaque streams on disposal", async () => {
  const proxy = await createNeteaseTunnelProxy({
    maxTunnels: 1,
    resolve: async () => ["8.8.8.8"],
    connect: fakeConnect([]),
  });
  const first = await proxyRequest(
    proxy,
    "CONNECT music.163.com:443 HTTP/1.1\r\nHost: music.163.com\r\n\r\n"
  );
  assert.match(first.output, /^HTTP\/1\.1 200/);
  const second = await proxyRequest(
    proxy,
    "CONNECT st.music.163.com:443 HTTP/1.1\r\nHost: st.music.163.com\r\n\r\n"
  );
  assert.match(second.output, /^HTTP\/1\.1 403/);
  second.client.destroy();
  const closed = once(first.client, "close");
  await proxy.dispose();
  await closed;
  assert.equal(first.client.destroyed, true);
});

test("incoming sockets are bounded before CONNECT headers are received", async () => {
  const proxy = await createNeteaseTunnelProxy({
    maxConnections: 2,
    resolve: async () => ["8.8.8.8"],
    connect: fakeConnect([]),
  });
  const target = new URL(proxy.url);
  const clients = [];
  try {
    for (let index = 0; index < 2; index += 1) {
      const client = net.connect({
        host: target.hostname,
        port: Number(target.port),
      });
      client.on("error", () => {});
      clients.push(client);
      await once(client, "connect");
    }
    const third = net.connect({
      host: target.hostname,
      port: Number(target.port),
    });
    third.on("error", () => {});
    await once(third, "close");
    assert.equal(third.destroyed, true);
    assert.equal(
      clients.every((client) => !client.destroyed),
      true
    );
  } finally {
    const closed = clients.map((client) => once(client, "close"));
    await proxy.dispose();
    await Promise.all(closed);
  }
});

test("tunnel idle, lifetime, connection and ciphertext byte limits close sockets", async () => {
  for (const limits of [
    { idleTimeoutMs: 20 },
    { lifetimeMs: 20 },
    { maxTunnelBytes: 4 },
  ]) {
    const proxy = await createNeteaseTunnelProxy({
      ...limits,
      resolve: async () => ["8.8.8.8"],
      connect: fakeConnect([]),
    });
    try {
      const first = await proxyRequest(
        proxy,
        "CONNECT music.163.com:443 HTTP/1.1\r\nHost: music.163.com\r\n\r\n"
      );
      const closed = once(first.client, "close");
      if (limits.maxTunnelBytes) first.client.write("SYNTHETIC_TLS");
      await closed;
      assert.equal(first.client.destroyed, true);
    } finally {
      await proxy.dispose();
    }
  }
  const proxy = await createNeteaseTunnelProxy({
    connectTimeoutMs: 20,
    resolve: async () => ["8.8.8.8"],
    connect: () => {
      const socket = new PassThrough();
      socket.setTimeout = () => socket;
      return socket;
    },
  });
  try {
    const result = await proxyRequest(
      proxy,
      "CONNECT music.163.com:443 HTTP/1.1\r\nHost: music.163.com\r\n\r\n"
    );
    assert.equal(result.output, "");
    assert.equal(result.client.destroyed, true);
  } finally {
    await proxy.dispose();
  }
});

test("PC envelope becomes a fixed native POST without caller method/body/headers", async () => {
  const f = fixture();
  const pc = SEARCH.replace("/api/search/get/web", "/api/search/pc");
  await f.service.fetch(pc, {
    method: "DELETE",
    body: "private",
    headers: { Cookie: "private", Authorization: "private" },
  });
  const call = f.fetchCalls[0];
  assert.equal(call.url, "https://music.163.com/api/search/pc");
  assert.equal(call.init.method, "POST");
  assert.equal(call.init.body, "s=test&type=1&offset=0&limit=20");
  assert.equal(
    call.init.headers["Content-Type"],
    "application/x-www-form-urlencoded;charset=UTF-8"
  );
  assert.equal(call.init.headers.Cookie, undefined);
  assert.equal(call.init.headers.Authorization, undefined);
  assert.deepEqual(f.partitionCalls, [PARTITION]);
  assert.equal(
    f.service.observeResult(challenge(), pc).status,
    "verification-required"
  );
  await f.service.dispose();
});
test("PC wire URL passes existing resource guard, while an unvalidated envelope is rejected", async () => {
  const f = fixture();
  const pc = SEARCH.replace("/api/search/get/web", "/api/search/pc");
  await f.service.fetch(pc);
  let result;
  f.selected.resourceCheck({ url: f.fetchCalls[0].url }, (value) => {
    result = value;
  });
  assert.equal(result.cancel, false);
  for (const value of [
    pc.split("?")[0],
    pc + "&body=evil",
    pc + "&s=duplicate",
    pc.replace("limit=20", "limit=21"),
  ])
    await assert.rejects(f.service.fetch(value));
  assert.equal(f.fetchCalls.length, 1);
  await f.service.dispose();
});
test("PC -462 opens existing same-session verification and retry stays in that partition", async () => {
  const f = fixture({ response: () => new Response(challenge().data) });
  const pc = SEARCH.replace("/api/search/get/web", "/api/search/pc");
  const first = await f.service.fetch(pc);
  const status = f.service.observeResult(
    { ok: true, data: await first.text() },
    pc
  );
  assert.deepEqual(status, {
    ok: false,
    status: "verification-required",
    canVerify: true,
  });
  const verification = f.service.openVerification();
  await tick();
  assert.equal(f.windows[0].config.webPreferences.session, f.selected);
  f.windows[0].destroy();
  assert.equal((await verification).status, "retry-ready");
  f.selected.fetch = async (url, init) => {
    f.fetchCalls.push({ url, init });
    return new Response(
      JSON.stringify({ code: 200, result: { songCount: 0 } })
    );
  };
  const retry = await f.service.fetch(pc);
  const observed = f.service.observeResult(
    { ok: true, data: await retry.text() },
    pc
  );
  assert.equal(observed.ok, true);
  assert.deepEqual(f.partitionCalls, [PARTITION]);
  assert.deepEqual(
    f.fetchCalls.map((call) => call.init.method),
    ["POST", "POST"]
  );
  assert.equal(
    (await f.service.openVerification()).status,
    "verification-unavailable"
  );
  await f.service.dispose();
});
test("cancelled PC request closes ignored-abort late response and never creates a challenge", async () => {
  let deliver,
    cancelled = false;
  const f = fixture({
    response: () =>
      new Promise((resolve) => {
        deliver = resolve;
      }),
  });
  const controller = new AbortController();
  const pc = SEARCH.replace("/api/search/get/web", "/api/search/pc");
  const pending = f.service.fetch(pc, { signal: controller.signal });
  await tick();
  controller.abort();
  await assert.rejects(pending, (error) => error.name === "AbortError");
  deliver({
    body: {
      cancel() {
        cancelled = true;
        return Promise.resolve();
      },
    },
  });
  await tick();
  assert.equal(cancelled, true);
  assert.equal(
    (await f.service.openVerification()).status,
    "verification-unavailable"
  );
  await f.service.dispose();
});
