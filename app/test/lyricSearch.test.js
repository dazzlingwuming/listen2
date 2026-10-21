const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  search,
  classify,
} = require("../listen1_chrome_extension/js/lyric_search");
const { validateUrl, requestLyric } = require("../lyricTransport");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
function providerFixture(extra = {}) {
  const context = vm.createContext({
    atob,
    TextDecoder,
    DOMParser: class {
      parseFromString(value) {
        return { body: { textContent: value } };
      }
    },
    ...extra,
  });
  vm.runInContext(
    `${fs.readFileSync(
      path.join(
        __dirname,
        "../listen1_chrome_extension/js/provider/bilibili.js"
      ),
      "utf8"
    )}\nthis.provider = bilibili;`,
    context
  );
  return context.provider;
}
test("manual candidates survive low scores caused by video metadata", async () => {
  const provider = providerFixture();
  provider.fetch_qq_lyric_search = async () => [
    { mid: "song", name: "Correct song", singer: [{ name: "Artist" }] },
  ];
  provider.score_qq_candidate = () => ({ score: 0.1 });
  provider.fetch_qq_lyric = async () => ({ lyric: "[00:01]Hello", tlyric: "" });
  assert.equal(
    (
      await provider.search_qq_lyric_candidates({
        query: "Correct song",
        manual: true,
      })
    ).length,
    1
  );
  assert.equal(
    (await provider.search_qq_lyric_candidates({ query: "Correct song" }))
      .length,
    0
  );
});
test("Kugou decodes UTF-8 synced LRC with bounded token-only requests", async () => {
  const controller = new AbortController();
  const lyric = "\ufeff[ar:测试]\n[00:01.50]测试歌词\n[00:02.00]第二行";
  const provider = providerFixture({
    Listen2LyricHttp: {
      async get(value, options) {
        const url = new URL(value);
        assert.equal(options.signal, controller.signal);
        assert.equal(options.timeout, 8000);
        assert.equal(url.origin, "https://lyrics.kugou.com");
        assert.equal(url.searchParams.get("fmt"), "lrc");
        return {
          data: JSON.stringify({
            status: 200,
            content: Buffer.from(lyric).toString("base64"),
          }),
        };
      },
    },
  });
  assert.equal(
    await provider.fetch_kugou_lyric(
      { id: "123", accesskey: "publicToken" },
      { signal: controller.signal }
    ),
    lyric.slice(1)
  );
  await assert.rejects(
    provider.fetch_kugou_lyric({ id: "../123", accesskey: "token" }),
    /Invalid/
  );
});
test("Kugou malformed base64, UTF-8 and oversized payloads fail explicitly", async () => {
  for (const content of ["bad!", "/w==", "a".repeat(512 * 1024 + 1)]) {
    const provider = providerFixture({
      Listen2LyricHttp: {
        get: async () => ({ data: { status: 200, content } }),
      },
    });
    await assert.rejects(
      provider.fetch_kugou_lyric({ id: "123", accesskey: "publicToken" }),
      /Invalid Kugou/
    );
  }
  const provider = providerFixture({
    Listen2LyricHttp: {
      get: async () => ({
        data: {
          status: 200,
          content: Buffer.from("[ar:Artist]\nPlain text").toString("base64"),
        },
      }),
    },
  });
  assert.equal(
    await provider.fetch_kugou_lyric({ id: "123", accesskey: "publicToken" }),
    ""
  );
});
const catalogSong = (id, title = "折风渡夜") => ({
  FileHash: id.toString(16).padStart(32, "0"),
  SongName: title,
  SingerName: `Catalog Singer ${id}`,
  Duration: 208,
});
test("every manual provider preserves edited title, singer and version text", async () => {
  const provider = providerFixture();
  const query = "歌手 - 《歌名》 (Official Video Live 版本)";
  const received = [];
  for (const method of [
    "fetch_qq_lyric_search",
    "fetch_netease_lyric_search",
    "fetch_lrclib_search",
    "fetch_kugou_song_search",
  ]) {
    provider[method] = async (value) => {
      received.push(value);
      return [];
    };
  }
  provider.fetch_kuwo_search = async (url) => {
    received.push(new URL(url).searchParams.get("all"));
    return { data: { abslist: [] } };
  };
  for (const method of [
    "search_qq_lyric_candidates",
    "search_netease_lyric_candidates",
    "search_lrclib_lyric_candidates",
    "search_kugou_lyric_candidates",
    "search_kuwo_lyric_candidates",
  ]) {
    await provider[method]({
      query: `  ${query}  `,
      manual: true,
      title: "Wrong title",
      artist: "Wrong singer",
    });
    await provider[method]({
      query: "  ",
      manual: true,
      title: "Must not replace input",
    });
  }
  assert.deepEqual(received, Array(5).fill(query));
  await provider.search_qq_lyric_candidates({ query, manual: false });
  assert.equal(received.at(-1), provider.clean_music_title(query));
});
test("Kugou lyric lookup sends catalog hash and explicit millisecond duration", async () => {
  const calls = [];
  const provider = providerFixture({
    Listen2LyricHttp: {
      get: async (value) => {
        calls.push(new URL(value));
        return { data: { status: 200, candidates: [] } };
      },
    },
  });
  await provider.fetch_kugou_lyric_search("Catalog title", {
    hash: catalogSong(1).FileHash,
    duration: 208,
  });
  assert.equal(calls[0].searchParams.get("hash"), catalogSong(1).FileHash);
  assert.equal(calls[0].searchParams.get("duration"), "208000");
  await provider.fetch_kugou_lyric_search("Catalog title", {
    hash: "bad",
    duration: Infinity,
  });
  assert.equal(calls[1].searchParams.has("hash"), false);
  assert.equal(calls[1].searchParams.get("duration"), "0");
});
test("pure title resolves catalog hashes without using the Bilibili uploader", async () => {
  const queries = [];
  const lookups = [];
  const controller = new AbortController();
  const provider = providerFixture();
  provider.fetch_kugou_song_search = async (query, options) => {
    queries.push(query);
    assert.equal(options.signal, controller.signal);
    return [catalogSong(1), catalogSong(1), catalogSong(2), catalogSong(3)];
  };
  provider.fetch_kugou_lyric_search = async (query, options) => {
    lookups.push({ query, hash: options.hash, duration: options.duration });
    assert.equal(options.signal, controller.signal);
    return [
      {
        id: options.hash.endsWith("1") ? "1" : "2",
        song: query,
        singer: "Catalog Singer",
        duration: 208000,
      },
    ];
  };
  provider.fetch_kugou_lyric = async ({ id }) => {
    if (id === "2") throw new Error("Download unavailable");
    return "[00:01.00]Hello";
  };
  const result = await provider.search_kugou_lyric_candidates({
    query: "折风渡夜",
    artist: "Wrong Bilibili uploader",
    signal: controller.signal,
  });
  assert.deepEqual(queries, ["折风渡夜"]);
  assert.equal(lookups.length, 2);
  assert(
    lookups.every(
      (value) => value.duration === 208 && /^[a-f0-9]{32}$/.test(value.hash)
    )
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].provider, "KUGOU");
  assert.equal(result[0].duration, 208);
  const record = provider.build_manual_lyric_record(result[0]);
  assert.equal(record.matchedProvider, "KUGOU");
  assert.equal(record.candidateId, "kugou_1");
});
test("catalog transport preserves exact edited query and validates catalog rows", async () => {
  const controller = new AbortController();
  const query = "歌手 - 《歌名》 (Live 版本)";
  const provider = providerFixture({
    Listen2LyricHttp: {
      get: async (value, options) => {
        const url = new URL(value);
        assert.equal(
          url.origin + url.pathname,
          "https://songsearch.kugou.com/song_search_v2"
        );
        assert.equal(url.searchParams.get("keyword"), query);
        assert.equal(url.searchParams.get("pagesize"), "5");
        assert.equal(options.timeout, 8000);
        assert.equal(options.signal, controller.signal);
        return {
          data: {
            status: 1,
            error_code: 0,
            data: {
              lists: [
                catalogSong(1),
                { ...catalogSong(2), FileHash: "bad" },
                { ...catalogSong(3), Duration: Infinity },
                { ...catalogSong(4), SongName: "" },
              ],
            },
          },
        };
      },
    },
  });
  assert.equal(
    (
      await provider.fetch_kugou_song_search(query, {
        signal: controller.signal,
      })
    ).length,
    1
  );
  const queries = [];
  provider.fetch_kugou_song_search = async (value) => {
    queries.push(value);
    return [];
  };
  await provider.search_kugou_lyric_candidates({
    query: `  ${query}  `,
    artist: "Never append this",
  });
  assert.deepEqual(queries, [query]);
});
test("catalog malformed/failing responses stay distinct from valid empty results", async () => {
  for (const data of [
    { status: 1, error_code: 0 },
    { status: 0, error_code: 1, data: { lists: [] } },
    "not-json",
  ]) {
    const provider = providerFixture({
      Listen2LyricHttp: { get: async () => ({ data }) },
    });
    await assert.rejects(
      provider.fetch_kugou_song_search("折风渡夜"),
      /Invalid|unavailable/
    );
  }
  const provider = providerFixture();
  provider.fetch_kugou_song_search = async () => [];
  assert.equal(
    (await provider.search_kugou_lyric_candidates({ query: "折风渡夜" }))
      .length,
    0
  );
  provider.fetch_kugou_song_search = async () => [catalogSong(1)];
  provider.fetch_kugou_lyric_search = async () => {
    throw new Error("Lookup unavailable");
  };
  await assert.rejects(
    provider.search_kugou_lyric_candidates({ query: "折风渡夜" }),
    /Lookup unavailable/
  );
});
test("catalog cancellation stops before lyric lookups and other sources survive failures", async () => {
  const controller = new AbortController();
  const provider = providerFixture();
  let lookups = 0;
  provider.fetch_kugou_song_search = async () => {
    controller.abort();
    return [catalogSong(1)];
  };
  provider.fetch_kugou_lyric_search = async () => {
    lookups++;
    return [];
  };
  await assert.rejects(
    provider.search_kugou_lyric_candidates({
      query: "折风渡夜",
      signal: controller.signal,
    }),
    { name: "AbortError" }
  );
  assert.equal(lookups, 0);
  provider.fetch_kugou_song_search = async () => {
    throw new Error("Catalog unavailable");
  };
  const result = await search(
    [
      {
        id: "KUGOU-catalog-failure",
        load: () =>
          provider.search_kugou_lyric_candidates({ query: "折风渡夜" }),
      },
      {
        id: "LRCLIB-catalog-survivor",
        load: async () => [candidate("survivor")],
      },
    ],
    "catalog-failure"
  ).promise;
  assert.equal(result.sources[0].status, "unavailable");
  assert.equal(result.candidates[0].id, "survivor");
});
test("artist-dependent provider cache is isolated and forced retry bypasses it", async () => {
  let calls = 0;
  const provider = (artist) => [
    {
      id: "KUGOU-context",
      cacheKey: artist,
      load: async () => {
        calls++;
        return artist ? [candidate(artist)] : [];
      },
    },
  ];
  await search(provider(""), "context-song").promise;
  const first = await search(provider("singer-a"), "context-song").promise;
  const second = await search(provider("singer-b"), "context-song").promise;
  await search(provider("singer-a"), "context-song").promise;
  assert.equal(calls, 3);
  assert.equal(first.candidates[0].id, "singer-a");
  assert.equal(second.candidates[0].id, "singer-b");
  await search(provider("singer-a"), "context-song", { force: true }).promise;
  assert.equal(calls, 4);
});
test("manual registry uses entered query only, independently of track artist", async () => {
  const calls = [];
  const provider = new Proxy(
    {},
    {
      get: (target, method) => async (hints) => {
        calls.push({ method, hints });
        return [];
      },
    }
  );
  const context = vm.createContext({
    netease: provider,
    xiami: provider,
    qq: provider,
    kugou: provider,
    kuwo: provider,
    bilibili: provider,
    migu: provider,
    taihe: provider,
    localmusic: provider,
    myplaylist: provider,
    LRUCache: class {},
    setPrototypeOfLocalStorage() {},
    Listen2LyricSearch: {
      search: (providers) => {
        if (providers.length)
          assert.deepEqual(
            Array.from(providers.slice(0, 3), (p) => p.id),
            ["QQ", "LRCLIB", "KUGOU"]
          );
        return Promise.all(
          providers.map((p) => p.load({ signal: "request-signal" }))
        );
      },
    },
  });
  vm.runInContext(
    `${fs.readFileSync(
      path.join(__dirname, "../listen1_chrome_extension/js/loweb.js"),
      "utf8"
    )}\nthis.service = MediaService;`,
    context
  );
  await context.service.searchLyrics(
    { id: "bitrack_1", source: "bilibili", artist: "Wrong uploader" },
    "Song"
  );
  await context.service.searchLyrics(
    { id: "bitrack_2", artist: "Different artist" },
    "Song"
  );
  const call = calls.find((c) => c.method === "search_kugou_lyric_candidates");
  assert.equal(call.hints.artist, "");
  assert.equal(call.hints.query, "Song");
  assert(
    calls.every(
      (value) => value.hints.artist === "" && value.hints.query === "Song"
    )
  );
  assert.equal(call.hints.signal, "request-signal");
  for (const title of ["折风渡夜", "青花瓷"]) {
    for (const artist of ["", "周杰伦"]) {
      calls.length = 0;
      await context.service.searchLyrics(
        { artist: "Wrong uploader", duration: 123 },
        { title: `  ${title}  `, artist: `  ${artist}  ` }
      );
      assert.equal(calls.length, 5);
      assert(
        calls.every(
          ({ hints }) =>
            hints.title === title &&
            hints.artist === artist &&
            hints.query === [title, artist].filter(Boolean).join(" ") &&
            hints.duration === 0 &&
            hints.manual
        )
      );
    }
  }
  calls.length = 0;
  await context.service.searchLyrics(
    { artist: "Uploader" },
    { title: "  ", artist: "Singer" }
  );
  assert.equal(calls.length, 0);
});
test("failed lyric downloads cannot become a valid empty result", async () => {
  const provider = providerFixture();
  provider.fetch_netease_lyric_search = async () => [
    { id: 1, name: "Song" },
    { id: 2, name: "Song" },
  ];
  provider.score_netease_candidate = () => ({ score: 1 });
  provider.fetch_netease_lyric = async (id) => {
    if (id === 1) throw new Error("Network unavailable");
    return null;
  };
  await assert.rejects(
    provider.search_netease_lyric_candidates({ query: "Song", manual: true }),
    /Network unavailable/
  );
});
const candidate = (id) => ({ id, title: "Song", lyric: "[00:01]Hello" });
test("partial failures do not erase successful candidates and stream before completion", async () => {
  const updates = [];
  const result = await search(
    [
      { id: "a", load: async () => [candidate("one")] },
      {
        id: "b",
        load: async () => {
          throw new Error("Network");
        },
      },
      { id: "c", load: async () => [] },
      {
        id: "d",
        load: async () => {
          throw new Error("Invalid payload");
        },
      },
    ],
    "partial",
    { onUpdate: (value) => updates.push(value) }
  ).promise;
  assert.deepEqual(
    result.candidates.map((c) => c.id),
    ["one"]
  );
  assert.deepEqual(
    result.sources.map((s) => s.status),
    ["success", "unavailable", "empty", "invalid-response"]
  );
  assert(updates.some((u) => u.pending && u.candidates.length === 1));
});
test("deadline completes stalled searches; late results cannot publish", async () => {
  let resolve;
  let updates = 0;
  const result = await search(
    [
      {
        id: "stall",
        load: () =>
          new Promise((r) => {
            resolve = r;
          }),
      },
    ],
    "stall",
    { timeoutMs: 15, onUpdate: () => updates++ }
  ).promise;
  assert.equal(result.sources[0].status, "timeout");
  const count = updates;
  resolve([candidate("late")]);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(updates, count);
});
test("cancellation aborts work and suppresses UI updates", async () => {
  let signal;
  let updates = 0;
  const operation = search(
    [
      {
        id: "cancel",
        load: (options) => {
          signal = options.signal;
          return new Promise(() => {});
        },
      },
    ],
    "cancel",
    { onUpdate: () => updates++ }
  );
  await Promise.resolve();
  operation.cancel();
  const result = await operation.promise;
  assert(signal.aborted);
  assert.equal(updates, 0);
  assert.equal(result.sources[0].status, "cancelled");
});
test("valid empty results are cached; forced retry bypasses cache; errors are not cached", async () => {
  let calls = 0;
  const sources = [
    {
      id: "cache",
      load: async () => {
        calls++;
        return [];
      },
    },
  ];
  await search(sources, "cache").promise;
  await search(sources, "cache").promise;
  assert.equal(calls, 1);
  await search(sources, "cache", { force: true }).promise;
  assert.equal(calls, 2);
  const failure = [
    {
      id: "failure",
      load: async () => {
        calls++;
        throw new Error("offline");
      },
    },
  ];
  await search(failure, "cache").promise;
  await search(failure, "cache").promise;
  assert.equal(calls, 4);
});
test("at most three provider operations run concurrently", async () => {
  let active = 0;
  let peak = 0;
  await search(
    Array.from({ length: 8 }, (_, i) => ({
      id: `parallel-${i}`,
      load: async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 3));
        active--;
        return [];
      },
    })),
    "parallel"
  ).promise;
  assert.equal(peak, 3);
});
test("desktop transport permits only exact public lyric endpoints", () => {
  assert.equal(
    validateUrl("https://lrclib.net/api/search?q=test").referer,
    "https://lrclib.net/"
  );
  assert.equal(
    validateUrl("https://songsearch.kugou.com/song_search_v2?keyword=test")
      .referer,
    "https://www.kugou.com/"
  );
  for (const route of ["search", "download"]) {
    assert.equal(
      validateUrl(`https://lyrics.kugou.com/${route}?id=123`).referer,
      "https://www.kugou.com/"
    );
  }
  assert.equal(
    validateUrl("https://search.kuwo.cn/r.s?all=test&ft=music").referer,
    "https://www.kuwo.cn/"
  );
  for (const url of [
    "https://search.kuwo.cn/private",
    "https://search.kuwo.cn.evil.test/r.s",
    "http://search.kuwo.cn/r.s",
    "https://lyrics.kugou.com/other",
    "https://songsearch.kugou.com/private",
    "https://songsearch.kugou.com.evil.test/song_search_v2",
    "https://lyrics.kugou.com.evil.test/download",
    "http://lyrics.kugou.com/search",
    "http://lrclib.net/api/search",
    "https://lrclib.net.evil.test/api/search",
    "https://lrclib.net/api/../private",
    "file:///etc/passwd",
    "https://user:pass@lrclib.net/api/search",
    "http://127.0.0.1/",
  ])
    assert.throws(() => validateUrl(url));
});
test("transport returns bounded response and does not follow redirects or send cookies", async () => {
  const result = await requestLyric(async (url, options) => {
    assert.equal(options.redirect, "error");
    assert.equal(options.credentials, "omit");
    return new Response('{"ok":true}');
  }, "https://lrclib.net/api/search?q=test");
  assert.equal(result.data, '{"ok":true}');
  const big = await requestLyric(
    async () => new Response("x".repeat(2 * 1024 * 1024 + 1)),
    "https://lrclib.net/api/search?q=test"
  );
  assert.equal(big.status, "invalid-response");
});
test("transport respects cancellation", async () => {
  const controller = new AbortController();
  controller.abort();
  const result = await requestLyric(
    async (url, options) => {
      options.signal.throwIfAborted();
    },
    "https://lrclib.net/api/search?q=test",
    controller.signal
  );
  assert.equal(result.status, "timeout");
});

test("structured cache identity separates title and singer boundaries and preserves stages", async () => {
  let calls = 0;
  const providers = [
    {
      id: "structured-boundaries",
      load: async ({ onProgress }) => {
        calls++;
        onProgress({ stage: "lyrics", rawMessage: "must never publish" });
        return [];
      },
    },
  ];
  const first = await search(providers, { title: "A B", artist: "C" }).promise;
  await search(providers, { title: "A", artist: "B C" }).promise;
  const cached = await search(providers, { title: "A B", artist: "C" }).promise;
  assert.equal(calls, 2);
  assert.equal(first.sources[0].status, "no-synced-lyrics");
  assert.equal(cached.sources[0].stage, "lyrics");
  assert.equal(cached.sources[0].status, "no-synced-lyrics");
  assert.equal(JSON.stringify(first).includes("must never publish"), false);
});

test("progress and result observers cannot interrupt search completion", async () => {
  const result = await search(
    [
      {
        id: "throwing-observer",
        load: async ({ onStage }) => {
          onStage("lyrics");
          return [candidate("observer-survivor")];
        },
      },
    ],
    "observers",
    {
      onUpdate() {
        throw new Error("UI failed");
      },
    }
  ).promise;
  assert.equal(result.sources[0].status, "success");
  assert.equal(result.sources[0].stage, "lyrics");
  const provider = providerFixture();
  provider.fetch_lrclib_search = async () => [];
  assert.equal(
    (
      await provider.search_lrclib_lyric_candidates({
        query: "Song",
        manual: true,
        onProgress() {
          throw new Error("View failed");
        },
      })
    ).length,
    0
  );
});

test("manual title and artist score same-title recordings without filtering misspelled singers", async () => {
  const provider = providerFixture();
  provider.fetch_qq_lyric_search = async () => [
    { mid: "first", name: "青花瓷", singer: [{ name: "Other Singer" }] },
    { mid: "second", name: "青花瓷", singer: [{ name: "周杰伦" }] },
  ];
  provider.fetch_qq_lyric = async () => ({ lyric: "[00:01]歌词" });
  const input = {
    title: "青花瓷",
    artist: "周杰伦",
    query: "青花瓷 周杰伦",
    manual: true,
    duration: 9999,
  };
  const hints = provider.build_lyric_scoring_hints(input);
  assert.equal(hints.artist, "周杰伦");
  assert.equal(hints.rawTitle, "青花瓷");
  assert.equal(hints.duration, 0);
  assert.equal(
    (await provider.search_qq_lyric_candidates(input))[0].id,
    "qq_second"
  );
  assert.equal(
    (
      await provider.search_qq_lyric_candidates({
        ...input,
        artist: "错写歌手",
      })
    ).length,
    2
  );
  assert.equal(
    (
      await provider.search_qq_lyric_candidates({
        ...input,
        artist: "",
        query: "青花瓷",
      })
    ).length,
    2
  );
});

function stagedProvider(scenario) {
  const fail = () => {
    throw Object.assign(
      new Error("Unavailable https://private.test/token"),
      scenario === "timeout" ? { code: "ETIMEDOUT" } : {}
    );
  };
  const lyricResult = () => {
    if (["failure", "timeout"].includes(scenario)) return fail();
    return scenario === "no-sync"
      ? { lyric: "plain text" }
      : { lyric: "[00:01]歌词" };
  };
  const provider = providerFixture({
    axios: {
      get: async () => {
        lyricResult();
        return {
          data: {
            status: 200,
            data: {
              lrclist:
                scenario === "no-sync"
                  ? []
                  : [{ time: "1", lineLyric: "歌词" }],
            },
          },
        };
      },
    },
  });
  const catalog = (items) =>
    scenario === "catalog-failure" ? fail() : scenario === "empty" ? [] : items;
  provider.fetch_qq_lyric_search = async () =>
    catalog([{ mid: "1", name: "Song" }]);
  provider.fetch_qq_lyric = async () => lyricResult();
  provider.fetch_netease_lyric_search = async () =>
    catalog([{ id: 1, name: "Song" }]);
  provider.fetch_netease_lyric = async () => lyricResult();
  provider.fetch_lrclib_search = async () =>
    catalog([
      {
        id: 1,
        trackName: "Song",
        plainLyrics: "plain text",
        syncedLyrics: scenario === "no-sync" ? "" : "[00:01]歌词",
      },
    ]);
  provider.fetch_kugou_song_search = async () => catalog([catalogSong(1)]);
  provider.fetch_kugou_lyric_search = async () => {
    if (["failure", "timeout"].includes(scenario)) return fail();
    return [{ id: 1, song: "Song" }];
  };
  provider.fetch_kugou_lyric = async () =>
    scenario === "no-sync" ? "" : "[00:01]歌词";
  provider.fetch_kuwo_search = async () => ({
    data: { abslist: catalog([{ NAME: "Song", MUSICRID: "MUSIC_1" }]) },
  });
  return provider;
}

test("each real provider reports catalog empty, missing synchronized lyrics and lyric failures", async () => {
  for (const source of ["qq", "netease", "lrclib", "kugou", "kuwo"]) {
    for (const scenario of [
      "empty",
      "no-sync",
      "success",
      "catalog-failure",
      "failure",
      "timeout",
    ]) {
      if (source === "lrclib" && ["failure", "timeout"].includes(scenario))
        continue;
      const provider = stagedProvider(scenario);
      const updates = [];
      const result = await search(
        [
          {
            id: `${source}-${scenario}`,
            load: (request) =>
              provider[`search_${source}_lyric_candidates`]({
                title: "Song",
                query: "Song",
                manual: true,
                ...request,
              }),
          },
        ],
        "stages",
        { force: true, onUpdate: (value) => updates.push(value) }
      ).promise;
      const state = result.sources[0];
      const expected = {
        empty: "empty",
        "no-sync": "no-synced-lyrics",
        success: "success",
        "catalog-failure": "unavailable",
        failure: "unavailable",
        timeout: "timeout",
      };
      assert.equal(state.status, expected[scenario], `${source}/${scenario}`);
      assert.equal(
        state.stage,
        ["empty", "catalog-failure"].includes(scenario) ? "catalog" : "lyrics",
        `${source}/${scenario}`
      );
      if (state.stage === "lyrics")
        assert(
          updates.some((u) => u.sources[0].stage === "lyrics" && u.pending)
        );
      assert.equal(JSON.stringify(result).includes("private.test"), false);
    }
  }
});

test("stable failure codes win over ambiguous error text", () => {
  assert.equal(
    classify({ code: "ETIMEDOUT", message: "Invalid timeout payload" }),
    "timeout"
  );
  assert.equal(classify({ code: "timeout" }), "timeout");
  assert.equal(
    classify({ code: "verification-required", message: "Invalid payload" }),
    "verification-required"
  );
  assert.equal(classify({ code: "invalid-response" }), "invalid-response");
});

test("late provider progress cannot rewrite a completed source", async () => {
  let report;
  let updates = 0;
  const result = await search(
    [
      {
        id: "late-progress",
        load: async ({ onProgress }) => {
          report = onProgress;
          return [];
        },
      },
    ],
    "late-progress",
    { onUpdate: () => updates++ }
  ).promise;
  const count = updates;
  report({ stage: "lyrics" });
  assert.equal(updates, count);
  assert.equal(result.sources[0].stage, "catalog");
});

test("NetEase abroad string result is explicit invalid-response without claiming login or geography", async () => {
  const provider = providerFixture({
    axios: {
      get: async () => ({
        data: { code: 200, abroad: true, result: "opaque platform response" },
      }),
    },
  });
  await assert.rejects(
    provider.fetch_netease_lyric_search("Public representative"),
    (error) =>
      error.code === "invalid-response" &&
      error.reason === "netease-unexpected-result"
  );
  const result = await search(
    [
      {
        id: "netease-unexpected",
        load: () =>
          provider.fetch_netease_lyric_search("Public representative"),
      },
    ],
    "Public",
    { force: true }
  ).promise;
  assert.equal(result.sources[0].status, "invalid-response");
  assert.equal(result.sources[0].reason, "netease-unexpected-result");
});
test("aggregator copies verified diagnostics only and does not cache failure", async () => {
  let calls = 0;
  const provider = {
    id: "safe-diagnostic",
    load: async () => {
      calls++;
      throw Object.assign(new Error("private upstream URL and body"), {
        code: "unavailable",
        reason: "service-busy",
        httpStatus: 503,
        retryAfterMs: 1000,
        networkStage: "response",
        networkCode: "ECONNRESET",
        attempts: 2,
        headers: { Cookie: "secret" },
        url: "private",
        data: "private",
      });
    },
  };
  const first = await search([provider], "public").promise;
  assert.equal(first.sources[0].reason, "service-busy");
  assert.equal(first.sources[0].networkCode, "ECONNRESET");
  assert.equal(first.sources[0].attempts, 2);
  for (const field of ["message", "headers", "url", "data", "code"])
    assert.equal(field in first.sources[0], false);
  await search([provider], "public").promise;
  assert.equal(calls, 2);
  const {
    failureDetails,
  } = require("../listen1_chrome_extension/js/lyric_search");
  assert.deepEqual(
    failureDetails({
      reason: "private",
      networkStage: "private",
      networkCode: "private",
      attempts: 99,
      httpStatus: NaN,
      retryAfterMs: -1,
    }),
    {}
  );
});
test("normal NetEase zero-count and -462 keep existing classifications", async () => {
  const provider = providerFixture({
    axios: {
      get: async () => ({ data: { code: 200, result: { songCount: 0 } } }),
    },
  });
  assert.equal(
    (await provider.fetch_netease_lyric_search("public zero result")).length,
    0
  );
  const verified = providerFixture({
    axios: {
      get: async () => ({
        data: { code: -462, abroad: true, result: "unusual" },
      }),
    },
  });
  await assert.rejects(
    verified.fetch_netease_lyric_search("public challenge"),
    (error) => error.code === "verification-required" && !error.reason
  );
});
