const { test } = require("node:test");
const assert = require("node:assert/strict");
const { search } = require("../listen1_chrome_extension/js/lyric_search");
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
test("Kugou uses singer hints after empty search, deduplicates and preserves partial downloads", async () => {
  const provider = providerFixture();
  const queries = [];
  const item = (id) => ({
    id,
    song: "Song",
    singer: "Singer",
    duration: 208000,
    accesskey: "publicToken",
  });
  provider.fetch_kugou_lyric_search = async (query) => {
    queries.push(query);
    return query === "Singer Song"
      ? [item("1"), item("1"), item("2"), item("3")]
      : [];
  };
  let downloads = 0;
  provider.fetch_kugou_lyric = async ({ id }) => {
    downloads++;
    if (id === "2") throw new Error("Unavailable");
    return "[00:01.00]Hello";
  };
  const result = await provider.search_kugou_lyric_candidates({
    query: "Song",
    artist: "Singer",
    manual: true,
  });
  assert.deepEqual(queries, ["Song", "Singer Song"]);
  assert.equal(downloads, 2);
  assert.equal(result.length, 1);
  assert.equal(result[0].provider, "KUGOU");
  assert.equal(result[0].duration, 208);
  assert.equal(result[0].accesskey, undefined);
  const record = provider.build_manual_lyric_record(result[0]);
  assert.equal(record.matchedProvider, "KUGOU");
  assert.equal(record.candidateId, "kugou_1");
  assert.equal(JSON.stringify(record).includes("publicToken"), false);
});
test("Kugou search rejects malformed payloads and propagates cancellation", async () => {
  const controller = new AbortController();
  const provider = providerFixture({
    Listen2LyricHttp: {
      get: async (url, options) => {
        assert.equal(options.signal, controller.signal);
        options.signal.throwIfAborted();
        return { data: { status: 200 } };
      },
    },
  });
  await assert.rejects(
    provider.fetch_kugou_lyric_search("Song", { signal: controller.signal }),
    /Invalid/
  );
  controller.abort();
  await assert.rejects(
    provider.search_kugou_lyric_candidates({
      query: "Song",
      signal: controller.signal,
    }),
    { name: "AbortError" }
  );
  provider.fetch_kugou_lyric_search = async () => [{ id: "1" }];
  provider.fetch_kugou_lyric = async () => {
    throw new Error("Download unavailable");
  };
  await assert.rejects(
    provider.search_kugou_lyric_candidates({ query: "Song" }),
    /Download unavailable/
  );
});
test("Kugou retries the hyphen variant and never repeats a supplied combined query", async () => {
  for (const query of ["Song", "Singer Song"]) {
    const provider = providerFixture();
    const queries = [];
    provider.fetch_kugou_lyric_search = async (value) => {
      queries.push(value);
      return value === "Singer - Song"
        ? [{ id: "1", song: "Song", singer: "Singer" }]
        : [];
    };
    provider.fetch_kugou_lyric = async () => "[00:01]Hello";
    const result = await provider.search_kugou_lyric_candidates({
      query,
      artist: "Singer",
    });
    assert.equal(result.length, 1);
    assert.equal(new Set(queries).size, queries.length);
    assert.equal(queries.at(-1), "Singer - Song");
    assert(queries.length <= 3);
  }
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
test("manual registry schedules Kugou immediately and supplies track artist", async () => {
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
  await context.service.searchLyrics({ artist: "Singer" }, "Song");
  const call = calls.find((c) => c.method === "search_kugou_lyric_candidates");
  assert.equal(call.hints.artist, "Singer");
  assert.equal(call.hints.signal, "request-signal");
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
  for (const route of ["search", "download"]) {
    assert.equal(
      validateUrl(`https://lyrics.kugou.com/${route}?id=123`).referer,
      "https://www.kugou.com/"
    );
  }
  for (const url of [
    "https://lyrics.kugou.com/other",
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
