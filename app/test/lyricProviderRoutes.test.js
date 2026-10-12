const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { classify } = require("../listen1_chrome_extension/js/lyric_search");

function fixture(get) {
  const context = vm.createContext({
    Listen2LyricHttp: { get },
    DOMParser: class {
      parseFromString(value) {
        return { body: { textContent: value } };
      }
    },
  });
  vm.runInContext(
    fs.readFileSync(
      path.join(
        __dirname,
        "../listen1_chrome_extension/js/provider/bilibili.js"
      ),
      "utf8"
    ) + "\nthis.provider = bilibili;",
    context
  );
  return context.provider;
}

test("Kuwo manual search uses the working catalog and retrieves synced lyrics", async () => {
  const calls = [];
  const query = "歌手 - 《折风渡夜》 (Live)";
  const provider = fixture(async (value) => {
    const url = new URL(value);
    calls.push(url);
    if (url.hostname === "search.kuwo.cn") {
      assert.equal(url.pathname, "/r.s");
      assert.equal(url.searchParams.get("all"), query);
      return {
        data: {
          abslist: [
            { MUSICRID: "MUSIC_123", NAME: "折风渡夜", ARTIST: "歌手" },
          ],
        },
      };
    }
    assert.equal(url.hostname, "m.kuwo.cn");
    assert.equal(url.searchParams.get("musicId"), "123");
    return {
      data: {
        status: 200,
        data: { lrclist: [{ time: "1.25", lineLyric: "Sample" }] },
      },
    };
  });
  const items = await provider.search_kuwo_lyric_candidates({
    query,
    manual: true,
    artist: "Wrong uploader",
  });
  assert.equal(calls.length, 2);
  assert.equal(items.length, 1);
  assert.equal(items[0].provider, "KUWO");
  assert.match(items[0].lyric, /\[00:01\.25\]/);
});

test("NetEase verification stays distinct from an empty search", async () => {
  const provider = fixture(async () => ({
    data: { code: -462, message: "verify" },
  }));
  await assert.rejects(
    provider.fetch_netease_lyric_search("青花瓷", { force: true }),
    (error) => classify(error) === "verification-required"
  );
});

test("opaque NetEase response cannot become a successful zero-result search", async () => {
  const provider = fixture(async () => ({
    data: { code: 200, result: "abcdef123456" },
  }));
  await assert.rejects(
    provider.fetch_netease_lyric_search("折风渡夜", { force: true }),
    (error) => classify(error) === "invalid-response"
  );
});

test("Kuwo tries later recordings after service failures and stops after two usable lyrics", async () => {
  const downloads = [];
  const provider = fixture(async (value) => {
    const url = new URL(value);
    if (url.hostname === "search.kuwo.cn")
      return {
        data: {
          abslist: Array.from({ length: 20 }, (_, i) => ({
            MUSICRID: `MUSIC_${i + 1}`,
            NAME: "折风渡夜",
            ARTIST: "歌手",
          })),
        },
      };
    const id = Number(url.searchParams.get("musicId"));
    downloads.push(id);
    return {
      data:
        id <= 2
          ? { status: 301 }
          : {
              status: 200,
              data: { lrclist: [{ time: "1.25", lineLyric: "Sample" }] },
            },
    };
  });
  const items = await provider.search_kuwo_lyric_candidates({
    query: "折风渡夜",
    manual: true,
  });
  assert.equal(items.length, 2);
  assert.deepEqual(downloads, [1, 2, 3, 4]);
});

test("Kuwo caps unsuccessful recording probes and reports service failure instead of empty", async () => {
  let downloads = 0;
  const provider = fixture(async (value) => {
    if (new URL(value).hostname === "search.kuwo.cn")
      return {
        data: {
          abslist: Array.from({ length: 20 }, (_, i) => ({
            MUSICRID: `MUSIC_${i + 1}`,
            NAME: "折风渡夜",
            ARTIST: "歌手",
          })),
        },
      };
    downloads++;
    return { data: { status: 301 } };
  });
  await assert.rejects(
    provider.search_kuwo_lyric_candidates({ query: "折风渡夜", manual: true }),
    (error) => classify(error) === "unavailable"
  );
  assert.equal(downloads, 5);
});

test("QQ uses the bounded desktop search contract and downloads the selected lyric", async () => {
  const { validateUrl } = require("../lyricTransport");
  const provider = fixture(async (value) => {
    const url = new URL(value);
    validateUrl(value);
    if (url.hostname === "u.y.qq.com") {
      const request = JSON.parse(url.searchParams.get("data"));
      assert.equal(request.req.param.query, "青花瓷");
      return {
        data: {
          code: 0,
          req: {
            code: 0,
            data: {
              body: {
                song: {
                  list: [
                    {
                      mid: "publicMid",
                      name: "青花瓷",
                      singer: [{ name: "歌手" }],
                      album: { name: "专辑" },
                      interval: 180,
                    },
                  ],
                },
              },
            },
          },
        },
      };
    }
    assert.equal(url.hostname, "i.y.qq.com");
    return { data: { retcode: 0, lyric: "[00:01.25]Sample", trans: "" } };
  });
  const items = await provider.search_qq_lyric_candidates({
    query: "青花瓷",
    manual: true,
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].provider, "QQ");
  assert.match(items[0].lyric, /\[00:01\.25\]/);
});

test("QQ endpoint cannot invoke other musicu methods or oversized searches", () => {
  const { validateUrl } = require("../lyricTransport");
  const request = {
    comm: { ct: "19", cv: "1859", uin: "0" },
    req: {
      method: "DoSearchForQQMusicDesktop",
      module: "music.search.SearchCgiService",
      param: {
        grp: 1,
        num_per_page: 20,
        page_num: 1,
        query: "青花瓷",
        search_type: 0,
      },
    },
  };
  const url = () =>
    `https://u.y.qq.com/cgi-bin/musicu.fcg?data=${encodeURIComponent(
      JSON.stringify(request)
    )}`;
  assert.doesNotThrow(() => validateUrl(url()));
  request.req.method = "OtherOperation";
  assert.throws(() => validateUrl(url()));
  request.req.method = "DoSearchForQQMusicDesktop";
  request.req.param.num_per_page = 1000;
  assert.throws(() => validateUrl(url()));
  request.req.param.num_per_page = 20;
  request.req.param.query = "a".repeat(257);
  assert.throws(() => validateUrl(url()));
});
