const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { validateUrl } = require("../lyricTransport");
const { requestNetease } = require("../neteaseRequest");

const SEARCH =
  "https://music.163.com/api/search/get/web?s=test&type=1&offset=0&limit=20";
const LYRIC = "https://music.163.com/api/song/lyric?id=123&lv=-1&kv=-1&tv=-1";

test("credentialed NetEase endpoints accept only bounded lyric/search queries", () => {
  for (const value of [SEARCH, LYRIC])
    assert.doesNotThrow(() => validateUrl(value));
  for (const value of [
    SEARCH + "&s=other",
    SEARCH + "&cookie=secret",
    SEARCH.replace("limit=20", "limit=200"),
    SEARCH.replace("s=test", "s=" + "a".repeat(257)),
    LYRIC.replace("id=123", "id=bad"),
    LYRIC + "&csrf_token=test",
  ])
    assert.throws(() => validateUrl(value));
});

function harness() {
  const mainWindow = { webContents: { mainFrame: {} } };
  const handlers = new Map();
  const calls = [];
  const neteaseLyricSession = {
    fetch() {},
    observeResult(result, url) {
      calls.push({ type: "observe", url });
      return { ok: false, status: "verification-required" };
    },
    openVerification(parent) {
      calls.push({ type: "open", parent });
      return Promise.resolve({ ok: true, status: "retry-ready" });
    },
  };
  const directLyricFetch = () => {};
  const context = {
    URL,
    AbortController,
    mainWindow,
    neteaseLyricSession,
    directLyricFetch,
    validateUrl,
    requestNetease,
    lyricRequests: new Map(),
    ipcMain: { handle: (name, callback) => handlers.set(name, callback) },
    requestLyric: async (fetch, url) => {
      calls.push({ type: "request", fetch, url });
      return { ok: true, data: "private-challenge-fixture" };
    },
  };
  const source = fs.readFileSync(require.resolve("../main"), "utf8");
  const start = source.indexOf('ipcMain.handle("lyrics:request",');
  const end = source.indexOf('ipcMain.on("lyrics:cancel",', start);
  const verify = source.indexOf('ipcMain.handle("lyrics:verify-netease",');
  assert.ok(start >= 0 && end > start && verify >= 0);
  vm.runInNewContext(
    source.slice(start, end) +
      source.slice(
        verify,
        source.indexOf("const store = new Store();", verify)
      ),
    context
  );
  return {
    handlers,
    calls,
    mainWindow,
    directLyricFetch,
    event: {
      sender: mainWindow.webContents,
      senderFrame: mainWindow.webContents.mainFrame,
    },
  };
}

test("verification IPC rejects remote senders and subframes without opening a window", async () => {
  const h = harness();
  for (const event of [
    { sender: {}, senderFrame: {} },
    { sender: h.event.sender, senderFrame: {} },
  ]) {
    const result = await h.handlers.get("lyrics:verify-netease")(event, {
      url: "https://evil.example",
    });
    assert.equal(result.ok, false);
  }
  assert.equal(h.calls.length, 0);
  const result = await h.handlers.get("lyrics:verify-netease")(h.event, {
    url: "https://evil.example",
    cookie: "ignored",
  });
  assert.equal(result.status, "retry-ready");
  assert.equal(h.calls[0].parent, h.mainWindow);
  assert.deepEqual(Object.keys(h.calls[0]), ["type", "parent"]);
});

test("only NetEase uses its credentialed session and challenge sanitizer", async () => {
  const h = harness();
  const request = h.handlers.get("lyrics:request");
  const result = await request(h.event, { id: "lyric-1-1", url: SEARCH });
  assert.equal(result.status, "verification-required");
  assert.equal(result.data, undefined);
  assert.deepEqual(
    h.calls.map((call) => call.type),
    ["request", "observe"]
  );
  assert.notEqual(h.calls[0].fetch, h.directLyricFetch);
  const other = await request(h.event, {
    id: "lyric-1-2",
    url: "https://lyrics.kugou.com/search?keyword=test",
  });
  assert.equal(other.ok, true);
  assert.equal(h.calls[2].fetch, h.directLyricFetch);
  assert.equal(h.calls.length, 3);
});
