const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { search } = require("../listen1_chrome_extension/js/lyric_search");
const source = (file) =>
  fs.readFileSync(
    path.join(__dirname, "../listen1_chrome_extension/js", file),
    "utf8"
  );
function neteaseFixture(get) {
  const context = vm.createContext({
    URLSearchParams,
    axios: { get },
    isElectron: () => false,
    getParameterByName: (key, url) =>
      new URL(url, "https://local.test").searchParams.get(key),
  });
  vm.runInContext(
    source("provider/netease.js") + "\nthis.provider = netease;",
    context
  );
  return (keyword, type = 0) =>
    new Promise((resolve) =>
      context.provider
        .search(
          `/search?keywords=${encodeURIComponent(
            keyword
          )}&curpage=2&type=${type}`
        )
        .success(resolve)
    );
}
test("NetEase sends the exact Unicode query to the working route and keeps actual artists", async () => {
  const run = neteaseFixture(async (value) => {
    const url = new URL(value);
    assert.equal(url.pathname, "/api/search/get/web");
    assert.equal(url.searchParams.get("s"), "西海情歌 & 刀郎");
    assert.equal(url.searchParams.get("offset"), "20");
    return {
      data: JSON.stringify({
        code: 200,
        result: {
          songCount: 1,
          songs: [
            {
              id: 77098,
              name: "西海情歌",
              ar: [
                { id: 1, name: "刀郎" },
                { id: 2, name: "合唱" },
              ],
              al: { id: 3, name: "专辑" },
              dt: 300000,
            },
          ],
        },
      }),
    };
  });
  const result = await run("西海情歌 & 刀郎");
  assert.equal(result.result[0].title, "西海情歌");
  assert.equal(result.result[0].artist, "刀郎/合唱");
  assert.equal(result.result[0].duration, 300);
});
test("NetEase distinguishes empty, verification, malformed payload and network failure", async () => {
  for (const [data, status] of [
    [{ code: 200, result: { songCount: 0 } }, "empty"],
    [{ code: -462 }, "verification-required"],
    [{ code: 200, result: "opaque" }, "invalid-response"],
    [{ code: 200, result: { songs: [{ name: {} }] } }, "invalid-response"],
  ]) {
    const result = await neteaseFixture(async () => ({ data }))("青花瓷");
    assert.equal(result.status, status);
    assert.equal(result.result.length, 0);
  }
  assert.equal(
    (
      await neteaseFixture(async () => {
        throw new Error("offline");
      })("西海情歌")
    ).status,
    "unavailable"
  );
});
function instantFixture() {
  const requests = [];
  const timers = new Set();
  const scope = {
    $watch: (_key, fn) => {
      scope.changed = fn;
    },
    $on: (_event, fn) => {
      scope.destroy = fn;
    },
    $evalAsync: (fn) => fn(),
  };
  const timeout = (fn, ms) => {
    const item = { fn, ms };
    timers.add(item);
    return item;
  };
  timeout.cancel = (item) => timers.delete(item);
  const context = vm.createContext({
    angular: {
      module: () => ({
        controller: (_name, args) =>
          args.at(-1)(scope, timeout, { $broadcast() {} }),
      }),
    },
    sourceList: [{ name: "netease" }, { name: "qq" }],
    i18next: { t: (value) => value },
    document: { querySelector: () => ({ scrollTo() {} }) },
    MediaService: {
      search: (platform, options) => ({
        success: (reply) => requests.push({ platform, options, reply }),
      }),
    },
  });
  vm.runInContext(source("controller/instant_search.js"), context);
  return {
    scope,
    requests,
    flush: (ms = 250) => {
      for (const item of [...timers])
        if (item.ms === ms) {
          timers.delete(item);
          item.fn();
        }
    },
  };
}
const tracks = (title) => ({
  result: [{ title, source: "netease" }],
  total: 30,
});
test("out-of-order responses, source switches and clearing input cannot restore stale songs", () => {
  const { scope, requests, flush } = instantFixture();
  scope.keywords = "青花瓷";
  scope.changed();
  flush();
  scope.keywords = "西海情歌";
  scope.changed();
  flush();
  requests[1].reply(tracks("西海情歌"));
  requests[0].reply(tracks("青花瓷"));
  assert.equal(scope.result[0].title, "西海情歌");
  scope.changeSourceTab("qq");
  requests[1].reply(tracks("旧网易云结果"));
  assert.equal(scope.result.length, 0);
  scope.keywords = "";
  scope.changed();
  requests[2].reply(tracks("旧 QQ 结果"));
  assert.equal(scope.result.length, 0);
  assert.equal(scope.loading, false);
});
test("input debounce and request deadlines finish predictably without late result overwrites", () => {
  const { scope, requests, flush } = instantFixture();
  for (const value of ["西", "西海", "西海情歌"]) {
    scope.keywords = value;
    scope.changed();
  }
  flush();
  assert.equal(requests.length, 1);
  flush(15000);
  assert.equal(scope.searchStatus, "unavailable");
  requests[0].reply(tracks("迟到结果"));
  assert.equal(scope.result.length, 0);
});
test("usable lyrics stream while a later candidate stalls and survive the deadline", async () => {
  const updates = [];
  const result = await search(
    [
      {
        id: "partial-stream",
        load: ({ onCandidates }) => {
          onCandidates([{ id: "ready", lyric: "[00:01]Ready" }]);
          return new Promise(() => {});
        },
      },
    ],
    "stream-check",
    { timeoutMs: 15, onUpdate: (value) => updates.push(value) }
  ).promise;
  assert(
    updates.some((value) => value.pending && value.candidates.length === 1)
  );
  assert.equal(result.candidates[0].id, "ready");
  assert.equal(result.sources[0].status, "timeout");
});
test("manual lyric search continues beyond recordings with no synced lyrics and streams each match", async () => {
  const context = vm.createContext({
    DOMParser: class {
      parseFromString(value) {
        return { body: { textContent: value } };
      }
    },
  });
  vm.runInContext(
    source("provider/bilibili.js") + "\nthis.provider=bilibili;",
    context
  );
  const provider = context.provider;
  provider.fetch_netease_lyric_search = async () =>
    Array.from({ length: 12 }, (_, i) => ({ id: i + 1, name: "西海情歌" }));
  provider.score_netease_candidate = () => ({ score: 1 });
  provider.fetch_netease_lyric = async (id) =>
    id <= 6 ? null : { lyric: "[00:01]Valid", tlyric: "" };
  const streamed = [];
  const items = await provider.search_netease_lyric_candidates({
    query: "西海情歌",
    manual: true,
    onCandidates: (values) => streamed.push(...values),
  });
  assert.equal(items.length, 6);
  assert.equal(streamed.length, 6);
  assert.equal(items[0].id, "netease_7");
});
