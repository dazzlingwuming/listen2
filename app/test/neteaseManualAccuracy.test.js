const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  vm = require("node:vm");
const { search } = require("../listen1_chrome_extension/js/lyric_search");
const badTitles = ["43", "流产歌曲", "小王日记"];
const row = (name, id, artist = "刀郎") => ({
  id,
  name,
  artists: [{ name: artist }],
  album: { name: "Public fixture album" },
  duration: 200000,
});
const badRows = badTitles.map((title, index) => row(title, 4300 + index));
function fixture(rows) {
  const calls = [];
  const context = vm.createContext({
    isElectron: () => true,
    DOMParser: class {
      parseFromString(text) {
        return { body: { textContent: text } };
      }
    },
    Listen2LyricHttp: {
      get: async (value, options) => {
        const url = new URL(value);
        calls.push({
          path: url.pathname,
          s: url.searchParams.get("s"),
          signal: options.signal,
        });
        if (url.pathname === "/api/search/get/web")
          return {
            data: {
              code: 200,
              abroad: true,
              result: "synthetic unsupported response",
            },
          };
        if (url.pathname === "/api/search/pc")
          return {
            data: {
              code: 200,
              result: { songCount: rows.length, songs: rows },
            },
          };
        return {
          data: { code: 200, lrc: { lyric: "[00:01]Synthetic fixture text" } },
        };
      },
    },
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
const hints = {
  query: "西海情歌",
  title: "西海情歌",
  artist: "",
  manual: true,
  force: true,
};
test("manual 西海情歌 rejects unrelated 43/流产歌曲/小王日记 even with artist score; source remains catalog empty", async () => {
  const f = fixture(badRows);
  const result = await search(
    [
      {
        id: "网易云-accuracy-empty",
        load: (options) =>
          f.provider.search_netease_lyric_candidates({ ...hints, ...options }),
      },
    ],
    { title: hints.title, artist: "" },
    { force: true }
  ).promise;
  assert.equal(result.candidates.length, 0);
  assert.equal(result.sources[0].status, "empty");
  assert.equal(result.sources[0].stage, "catalog");
  assert.deepEqual(
    f.calls.map((call) => call.path),
    ["/api/search/get/web", "/api/search/pc"]
  );
  assert(f.calls.every((call) => call.s === "西海情歌"));
});
test("manual matching title/different singer/Live/Cover/punctuation survive NetEase relevance gate", async () => {
  const names = [
    "西海情歌",
    "西海情歌（Live）",
    "《西海情歌》 (Cover 刀郎)",
    "西海·情歌",
  ];
  const f = fixture([
    ...badRows,
    ...names.map((name, index) =>
      row(name, 10 + index, index === 0 ? "其他歌手" : "刀郎")
    ),
  ]);
  const items = await f.provider.search_netease_lyric_candidates(hints);
  assert.deepEqual(
    Array.from(items, (item) => item.title).sort(),
    [...names].sort()
  );
  assert.equal(
    f.calls.filter((call) => call.path === "/api/song/lyric").length,
    4
  );
});
test("single-character exact titles still survive when existing title variants are empty", async () => {
  const f = fixture([row("海", 1), row("43", 2)]);
  const items = await f.provider.search_netease_lyric_candidates({
    ...hints,
    title: "海",
    query: "海",
  });
  assert.deepEqual(
    Array.from(items, (item) => item.title),
    ["海"]
  );
});
test("cancelled stale NetEase catalog cannot fetch lyrics, publish or cache irrelevant candidates", async () => {
  let deliver;
  let phase = "old";
  let requests = 0;
  const f = fixture([]);
  f.provider.fetch_netease_lyric_search = () => {
    requests++;
    return phase === "old"
      ? new Promise((resolve) => {
          deliver = resolve;
        })
      : Promise.resolve([row("西海情歌", 7)]);
  };
  let lyricCalls = 0;
  f.provider.fetch_netease_lyric = async () => {
    lyricCalls++;
    return { lyric: "[00:01]Synthetic fixture text" };
  };
  const providers = [
    {
      id: "网易云-accuracy-cancel",
      load: (options) =>
        f.provider.search_netease_lyric_candidates({ ...hints, ...options }),
    },
  ];
  const old = search(
    providers,
    { title: hints.title, artist: "" },
    { force: true }
  );
  for (let i = 0; i < 8; i++) await Promise.resolve();
  old.cancel();
  assert.equal((await old.promise).sources[0].status, "cancelled");
  phase = "new";
  deliver(badRows);
  for (let i = 0; i < 16; i++) await Promise.resolve();
  assert.equal(lyricCalls, 0);
  const fresh = await search(
    providers,
    { title: hints.title, artist: "" },
    { force: true }
  ).promise;
  assert.equal(fresh.sources[0].status, "success");
  assert.equal(fresh.candidates[0].title, "西海情歌");
  assert.equal(requests, 2);
  const cached = await search(providers, { title: hints.title, artist: "" })
    .promise;
  assert.equal(cached.candidates[0].title, "西海情歌");
  assert.equal(requests, 2);
});
