const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
function fixture(invoke) {
  const sent = [];
  const window = {};
  const context = vm.createContext({
    window,
    AbortController,
    Date,
    isElectron: () => true,
    require: () => ({
      ipcRenderer: { invoke, send: (...args) => sent.push(args) },
    }),
  });
  vm.runInContext(
    fs.readFileSync(
      require.resolve("../listen1_chrome_extension/js/lyric_http.js"),
      "utf8"
    ),
    context
  );
  return { http: window.Listen2LyricHttp, sent };
}
const flush = async () => {
  for (let i = 0; i < 24; i++) await Promise.resolve();
};
test("renderer never forwards headers and only accepts validated failure metadata", async () => {
  const { http } = fixture(async (channel, payload) => {
    assert.equal(channel, "lyrics:request");
    assert.deepEqual(Object.keys(payload).sort(), ["id", "url"]);
    return {
      ok: false,
      status: "unavailable",
      reason: "service-busy",
      httpStatus: 503,
      retryAfterMs: 1000,
      networkStage: "response",
      networkCode: "ECONNRESET",
      attempts: 2,
      headers: { Cookie: "private" },
      message: "private",
      url: "private",
    };
  });
  await assert.rejects(
    http.get("https://lrclib.net/api/search?q=public", {
      headers: { Cookie: "private" },
    }),
    (error) => {
      assert.equal(error.code, "unavailable");
      assert.equal(error.reason, "service-busy");
      assert.equal(error.httpStatus, 503);
      assert.equal(error.retryAfterMs, 1000);
      assert.equal(error.networkStage, "response");
      assert.equal(error.networkCode, "ECONNRESET");
      assert.equal(error.attempts, 2);
      assert.equal(error.headers, undefined);
      assert.equal(error.url, undefined);
      assert.equal(error.message.includes("private"), false);
      return true;
    }
  );
});
test("renderer queued cancellation is prompt and does not invoke IPC", async () => {
  let calls = 0;
  const deliveries = [];
  const { http } = fixture(() => {
    calls++;
    return new Promise((resolve) => deliveries.push(resolve));
  });
  const active = [1, 2, 3].map(() => http.get("public"));
  const controller = new AbortController();
  const queued = http.get("public", { signal: controller.signal });
  controller.abort();
  await assert.rejects(queued, (error) => error.name === "AbortError");
  assert.equal(calls, 3);
  deliveries.forEach((resolve) => resolve({ ok: true, data: "[]" }));
  await Promise.all(active);
  await flush();
  assert.equal(calls, 3);
});
test("renderer cancellation aborts active IPC and ignores late success", async () => {
  let deliver;
  const controller = new AbortController();
  const { http, sent } = fixture(
    () =>
      new Promise((resolve) => {
        deliver = resolve;
      })
  );
  const pending = http.get("public", { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, (error) => error.name === "AbortError");
  assert.equal(sent[0][0], "lyrics:cancel");
  deliver({ ok: true, data: "private late data" });
  await flush();
});
