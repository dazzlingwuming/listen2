const test = require("node:test");
const assert = require("node:assert/strict");
const { requestNetease } = require("../neteaseRequest");
const { validateUrl } = require("../lyricTransport");
const url =
  "https://music.163.com/api/search/get/web?s=test&type=1&offset=0&limit=20";
const reply = (result) => ({
  ok: true,
  data: JSON.stringify({ code: 200, result }),
});
test("opaque successful NetEase searches use one anonymous retry without changing the verification session", async () => {
  const calls = [];
  const publicFetch = () => {};
  const result = await requestNetease({
    url,
    publicFetch,
    neteaseSession: { fetch() {}, observeResult: (r) => r },
    request: async (fetch, target, signal) => {
      assert.equal(target, url);
      assert(signal instanceof AbortSignal);
      calls.push(fetch);
      return fetch === publicFetch
        ? reply({ songs: [{ id: 1, name: "西海情歌" }] })
        : reply("opaque");
    },
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[1], publicFetch);
  assert.equal(JSON.parse(result.data).result.songs[0].name, "西海情歌");
});
test("official verification and valid empty results never trigger an anonymous retry", async () => {
  for (const response of [
    { ok: false, status: "verification-required" },
    reply({ songCount: 0 }),
  ]) {
    let calls = 0;
    const result = await requestNetease({
      url,
      publicFetch() {},
      neteaseSession: { fetch() {}, observeResult: (r) => r },
      request: async () => {
        calls++;
        return response;
      },
    });
    assert.equal(calls, 1);
    assert.equal(result, response);
  }
});
test("cancellation suppresses fallback and a failed retry cannot produce false songs", async () => {
  const controller = new AbortController();
  let calls = 0;
  const session = { fetch() {}, observeResult: (r) => r };
  const aborted = await requestNetease({
    url,
    signal: controller.signal,
    neteaseSession: session,
    publicFetch() {},
    request: async () => {
      calls++;
      controller.abort();
      return reply("opaque");
    },
  });
  assert.equal(calls, 1);
  assert.equal(aborted.status, "timeout");
  const result = await requestNetease({
    url,
    neteaseSession: session,
    publicFetch() {},
    request: async () => reply("opaque"),
  });
  assert.equal(JSON.parse(result.data).result, "opaque");
});
test("shared NetEase transport allows bounded song and playlist pages, rejecting arbitrary parameters", () => {
  assert.doesNotThrow(() => validateUrl(url.replace("offset=0", "offset=20")));
  assert.doesNotThrow(() =>
    validateUrl(
      url.replace("type=1", "type=1000").replace("offset=0", "offset=1980")
    )
  );
  for (const value of [
    url.replace("offset=0", "offset=2000"),
    url.replace("offset=0", "offset=-20"),
    url.replace("offset=0", "offset=1"),
    url.replace("type=1", "type=100"),
    url + "&cookie=value",
  ])
    assert.throws(() => validateUrl(value));
});
