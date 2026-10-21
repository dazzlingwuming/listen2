const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createLyricRequester } = require("../lyricTransport");
const URL = "https://lrclib.net/api/search?q=public-test";
const flush = async () => {
  for (let i = 0; i < 24; i++) await Promise.resolve();
};
test("LRCLIB retries a non-JSON 503 once after Retry-After using one deadline", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 10000 });
  const request = createLyricRequester();
  const starts = [];
  const result = request(async (_url, options) => {
    starts.push(Date.now());
    assert.equal(
      options.headers["User-Agent"],
      `Listen2/${
        require("../package.json").version
      } (https://github.com/dazzlingwuming/listen2)`
    );
    assert.equal(
      options.headers["Lrclib-Client"],
      options.headers["User-Agent"]
    );
    return starts.length === 1
      ? new Response("busy", { status: 503, headers: { "Retry-After": "1" } })
      : new Response("[]");
  }, URL);
  await flush();
  t.mock.timers.tick(999);
  await flush();
  assert.equal(starts.length, 1);
  t.mock.timers.tick(1);
  await flush();
  assert.equal((await result).ok, true);
  assert.deepEqual(starts, [10000, 11000]);
});
test("LRCLIB Retry-After outside budget returns safe metadata without retry", async () => {
  const request = createLyricRequester();
  let calls = 0;
  const result = await request(async () => {
    calls++;
    return new Response("private body", {
      status: 429,
      headers: { "Retry-After": "60", "Set-Cookie": "secret" },
    });
  }, URL);
  assert.deepEqual(result, {
    ok: false,
    status: "unavailable",
    reason: "rate-limited",
    httpStatus: 429,
    retryAfterMs: 60000,
    networkStage: "response",
    attempts: 1,
  });
  assert.equal(calls, 1);
});

test("Retry-After parses seconds and strict HTTP dates, rejecting malformed values", () => {
  const { parseRetryAfter } = require("../lyricRequestPolicy");
  assert.equal(parseRetryAfter("2", 0), 2000);
  assert.equal(parseRetryAfter("Thu, 01 Jan 1970 00:00:03 GMT", 1000), 2000);
  assert.equal(parseRetryAfter("Thu, 01 Jan 1970 00:00:00 GMT", 1000), 0);
  for (const input of [
    "-1",
    "1.5",
    "Infinity",
    "tomorrow",
    "99999999999999999999",
    "2026-10-21",
    "secret\r\nCookie: value",
  ])
    assert.equal(parseRetryAfter(input, 0), undefined);
});
test("429 HTTP-date retries once and a second 503 preserves only safe metadata", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const request = createLyricRequester();
  let calls = 0;
  const pending = request(
    async () =>
      ++calls === 1
        ? new Response("<html>limited</html>", {
            status: 429,
            headers: { "Retry-After": "Thu, 01 Jan 1970 00:00:02 GMT" },
          })
        : new Response("not JSON", {
            status: 503,
            headers: { "Retry-After": "3" },
          }),
    URL
  );
  await flush();
  t.mock.timers.tick(1999);
  await flush();
  assert.equal(calls, 1);
  t.mock.timers.tick(1);
  await flush();
  assert.deepEqual(await pending, {
    ok: false,
    status: "unavailable",
    httpStatus: 503,
    reason: "service-busy",
    retryAfterMs: 3000,
    networkStage: "response",
    attempts: 2,
  });
  t.mock.timers.tick(20000);
  await flush();
  assert.equal(calls, 2);
});
test("missing Retry-After uses a bounded fallback and other sources never queue behind LRCLIB", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const request = createLyricRequester();
  let calls = 0;
  const pending = request(async () => {
    calls++;
    return calls === 1 ? new Response("", { status: 503 }) : new Response("[]");
  }, URL);
  await flush();
  assert.equal(
    (
      await request(
        async () => new Response("{}"),
        "https://search.kuwo.cn/r.s?all=public"
      )
    ).ok,
    true
  );
  t.mock.timers.tick(999);
  await flush();
  assert.equal(calls, 1);
  t.mock.timers.tick(1);
  await flush();
  assert.equal((await pending).ok, true);
  assert.equal(calls, 2);
});
test("concurrent LRCLIB requests serialize with a 400ms start interval", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const request = createLyricRequester();
  const starts = [];
  let deliver;
  const fetch = async () => {
    starts.push(Date.now());
    if (starts.length === 1)
      return new Promise((resolve) => {
        deliver = resolve;
      });
    return new Response("[]");
  };
  const first = request(fetch, URL);
  const second = request(fetch, URL);
  await flush();
  assert.equal(starts.length, 1);
  deliver(new Response("[]"));
  await flush();
  t.mock.timers.tick(399);
  await flush();
  assert.equal(starts.length, 1);
  t.mock.timers.tick(1);
  await flush();
  assert.equal((await first).ok, true);
  assert.equal((await second).ok, true);
  assert.deepEqual(starts, [0, 400]);
});
test("cancellation while queued or in Retry-After wait prevents new attempts", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const request = createLyricRequester();
  let calls = 0;
  const a = new AbortController();
  const b = new AbortController();
  const fetch = async () => {
    calls++;
    return new Response("busy", {
      status: 503,
      headers: { "Retry-After": "2" },
    });
  };
  const first = request(fetch, URL, a.signal);
  const second = request(fetch, URL, b.signal);
  await flush();
  b.abort();
  assert.equal((await second).status, "timeout");
  a.abort();
  assert.equal((await first).status, "timeout");
  t.mock.timers.tick(3000);
  await flush();
  assert.equal(calls, 1);
});
test("retry never restarts the eight-second budget; late headers are cancelled", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const request = createLyricRequester();
  let calls = 0;
  let deliver;
  let cancelled = false;
  const pending = request(
    async () =>
      ++calls === 1
        ? new Response("busy", { status: 503, headers: { "Retry-After": "7" } })
        : new Promise((resolve) => {
            deliver = resolve;
          }),
    URL
  );
  await flush();
  t.mock.timers.tick(7000);
  await flush();
  assert.equal(calls, 2);
  t.mock.timers.tick(1000);
  await flush();
  assert.equal((await pending).status, "timeout");
  deliver({
    body: {
      cancel() {
        cancelled = true;
      },
    },
  });
  await flush();
  assert.equal(cancelled, true);
});
test("body read that ignores cancellation is bounded and cancelled", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const request = createLyricRequester();
  let cancelled = false;
  const pending = request(
    async () => ({
      ok: true,
      body: {
        getReader: () => ({
          read: () => new Promise(() => {}),
          cancel() {
            cancelled = true;
            return Promise.resolve();
          },
        }),
      },
    }),
    URL
  );
  await flush();
  t.mock.timers.tick(8000);
  await flush();
  assert.equal((await pending).status, "timeout");
  assert.equal(cancelled, true);
});
test("a long server cooldown also bounds subsequent searches without timer overflow or a socket", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const request = createLyricRequester();
  let calls = 0;
  const fetch = async () => {
    calls++;
    return new Response("busy", {
      status: 503,
      headers: { "Retry-After": "999999999" },
    });
  };
  const first = await request(fetch, URL);
  assert.equal(first.attempts, 1);
  const second = await request(fetch, URL);
  assert.equal(second.reason, "service-busy");
  assert.equal(second.retryAfterMs, 999999999000);
  assert.equal(second.attempts, undefined);
  assert.equal(calls, 1);
});
test("LRCLIB leaves 400ms after a slow response body finishes before the next request", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const request = createLyricRequester();
  const starts = [];
  let finishBody;
  const fetch = async () => {
    starts.push(Date.now());
    if (starts.length !== 1) return new Response("[]");
    return {
      ok: true,
      body: {
        getReader: () => ({
          read: () =>
            new Promise((resolve) => {
              finishBody = () => resolve({ done: true });
            }),
          cancel: async () => {},
        }),
      },
    };
  };
  const first = request(fetch, URL);
  const second = request(fetch, URL);
  await flush();
  t.mock.timers.tick(1000);
  finishBody();
  await flush();
  assert.equal((await first).ok, true);
  assert.equal(starts.length, 1);
  t.mock.timers.tick(399);
  await flush();
  assert.equal(starts.length, 1);
  t.mock.timers.tick(1);
  await flush();
  assert.equal((await second).ok, true);
  assert.deepEqual(starts, [0, 1400]);
});
test("cancelling an unstarted queued request does not extend the completed-attempt interval", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const request = createLyricRequester();
  const starts = [];
  const fetch = async () => {
    starts.push(Date.now());
    return new Response("[]");
  };
  await request(fetch, URL);
  const controller = new AbortController();
  const cancelled = request(fetch, URL, controller.signal);
  const next = request(fetch, URL);
  await flush();
  t.mock.timers.tick(100);
  controller.abort();
  assert.equal((await cancelled).status, "timeout");
  await flush();
  t.mock.timers.tick(299);
  await flush();
  assert.equal(starts.length, 1);
  t.mock.timers.tick(1);
  await flush();
  assert.equal((await next).ok, true);
  assert.deepEqual(starts, [0, 400]);
});
