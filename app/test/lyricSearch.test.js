const { test } = require("node:test");
const assert = require("node:assert/strict");
const { search } = require("../listen1_chrome_extension/js/lyric_search");
const { validateUrl, requestLyric } = require("../lyricTransport");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
function providerFixture() {
  const context = vm.createContext({
    DOMParser: class {
      parseFromString(value) {
        return { body: { textContent: value } };
      }
    },
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
  for (const url of [
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
