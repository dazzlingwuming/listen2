const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  vm = require("node:vm");
const { search } = require("../listen1_chrome_extension/js/lyric_search");
function fixture(replies, { desktop = true } = {}) {
  const calls = [];
  const bridge = {
    get: async (url, options) => {
      calls.push({ url, options });
      const reply = replies.shift();
      if (reply instanceof Error) throw reply;
      return { data: reply };
    },
  };
  const context = vm.createContext({
    isElectron: () => desktop,
    Listen2LyricHttp: bridge,
  });
  vm.runInContext(
    fs.readFileSync(
      require.resolve("../listen1_chrome_extension/js/provider/bilibili"),
      "utf8"
    ) + "\nthis.provider=bilibili;",
    context
  );
  return { provider: context.provider, calls };
}
const unexpected = {
  code: 200,
  abroad: true,
  result: "opaque unsupported result",
};
test("precise GET anomaly falls back once to desktop PC envelope, preserving signal and real songs/empty", async () => {
  for (const result of [
    { songs: [{ id: 1 }], songCount: 1 },
    { songCount: 0 },
  ]) {
    const f = fixture([unexpected, { code: 200, result }]);
    const controller = new AbortController();
    const items = await f.provider.fetch_netease_lyric_search(
      "Public title artist",
      { signal: controller.signal }
    );
    assert.equal(items.length, result.songCount);
    assert.equal(f.calls.length, 2);
    const pc = new URL(f.calls[1].url);
    assert.equal(pc.pathname, "/api/search/pc");
    assert.equal(pc.searchParams.get("s"), "Public title artist");
    assert.equal(pc.searchParams.get("limit"), "20");
    assert.equal(f.calls[0].options.signal, controller.signal);
    assert.equal(f.calls[1].options.signal, controller.signal);
  }
});
test("fallback reflects PC verification or network failure, never old anomaly as verification", async () => {
  for (const [reply, status, reason] of [
    [{ code: -462 }, "verification-required", undefined],
    [
      Object.assign(new Error("safe failure"), {
        code: "unavailable",
        reason: "connection-failed",
      }),
      "unavailable",
      "connection-failed",
    ],
    [unexpected, "invalid-response", "netease-unexpected-result"],
  ]) {
    const f = fixture([unexpected, reply]);
    const result = await search(
      [
        {
          id: "ne",
          load: (options) =>
            f.provider.fetch_netease_lyric_search("public", options),
        },
      ],
      "public",
      { force: true }
    ).promise;
    assert.equal(result.sources[0].status, status);
    assert.equal(result.sources[0].reason, reason);
    assert.equal(f.calls.length, 2);
  }
});
test("ordinary GET empty, verification, other invalid, timeout and browser anomaly never fall back", async () => {
  for (const reply of [
    { code: 200, result: { songCount: 0 } },
    { code: -462 },
    { code: 200, result: "other" },
    { code: 500, abroad: true, result: "error" },
    Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }),
  ]) {
    const f = fixture([reply]);
    await f.provider.fetch_netease_lyric_search("public").catch(() => {});
    assert.equal(f.calls.length, 1);
  }
  const browser = fixture([unexpected], { desktop: false });
  await assert.rejects(
    browser.provider.fetch_netease_lyric_search("public"),
    (error) => error.reason === "netease-unexpected-result"
  );
  assert.equal(browser.calls.length, 1);
});
test("global cancellation between GET and fallback or before late PC response suppresses old results", async () => {
  for (const phase of ["GET", "PC"]) {
    const controller = new AbortController();
    let deliver;
    let calls = 0;
    const bridge = {
      get: async () => {
        calls++;
        if (phase === "GET" || calls === 2)
          return new Promise((resolve) => {
            deliver = resolve;
          });
        return { data: unexpected };
      },
    };
    const context = vm.createContext({
      isElectron: () => true,
      Listen2LyricHttp: bridge,
    });
    vm.runInContext(
      fs.readFileSync(
        require.resolve("../listen1_chrome_extension/js/provider/bilibili"),
        "utf8"
      ) + "\nthis.provider=bilibili;",
      context
    );
    const pending = context.provider.fetch_netease_lyric_search("public", {
      signal: controller.signal,
    });
    for (let i = 0; i < 8; i++) await Promise.resolve();
    controller.abort();
    deliver({
      data:
        phase === "GET"
          ? unexpected
          : { code: 200, result: { songs: [{ id: 1 }], songCount: 1 } },
    });
    await assert.rejects(pending, (error) => error.name === "AbortError");
    assert.equal(calls, phase === "GET" ? 1 : 2);
  }
});
test("global 12s deadline is shared across both requests rather than renewed by fallback", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  let calls = 0;
  const signals = [];
  let deliverGet, deliverPc;
  const bridge = {
    get: async (_url, options) => {
      signals.push(options.signal);
      calls++;
      return new Promise((resolve) => {
        if (calls === 1) deliverGet = resolve;
        else deliverPc = resolve;
      });
    },
  };
  const context = vm.createContext({
    isElectron: () => true,
    Listen2LyricHttp: bridge,
  });
  vm.runInContext(
    fs.readFileSync(
      require.resolve("../listen1_chrome_extension/js/provider/bilibili"),
      "utf8"
    ) + "\nthis.provider=bilibili;",
    context
  );
  const job = search(
    [
      {
        id: "ne-global-budget",
        load: (options) =>
          context.provider.fetch_netease_lyric_search("public", options),
      },
    ],
    "public",
    { force: true }
  );
  for (let i = 0; i < 8; i++) await Promise.resolve();
  t.mock.timers.tick(7000);
  deliverGet({ data: unexpected });
  for (let i = 0; i < 8; i++) await Promise.resolve();
  assert.equal(calls, 2);
  t.mock.timers.tick(5000);
  const result = await job.promise;
  assert.equal(result.sources[0].status, "timeout");
  assert.equal(signals[0], signals[1]);
  assert.equal(signals[1].aborted, true);
  deliverPc({
    data: { code: 200, result: { songs: [{ id: 1 }], songCount: 1 } },
  });
  for (let i = 0; i < 12; i++) await Promise.resolve();
  assert.equal(result.sources[0].status, "timeout");
});
