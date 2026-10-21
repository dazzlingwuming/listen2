const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const {
  createDirectLyricFetch,
  createPublicDnsResolver,
  isPublicAddress,
} = require("../lyricDirectTransport");
const { requestLyric } = require("../lyricTransport");
const URL_VALUE = "https://lyrics.kugou.com/search?keyword=test";
const PUBLIC_IPS = ["8.8.8.8", "1.1.1.1", "9.9.9.9"];
function dnsResponse(
  host = "lyrics.kugou.com",
  addresses = PUBLIC_IPS,
  ttl = 20
) {
  return new Response(
    JSON.stringify({
      Status: 0,
      Question: [{ name: `${host}.`, type: 1 }],
      Answer: addresses.map((data) => ({ type: 1, TTL: ttl, data })),
    })
  );
}
function httpsFixture(behaviors) {
  const calls = [];
  const requests = [];
  const responses = [];
  function request(options, onResponse) {
    calls.push(options);
    const req = new EventEmitter();
    requests.push(req);
    req.destroy = () => {
      req.destroyed = true;
      if (req.response) req.response.destroy();
    };
    req.end = () => {
      queueMicrotask(() => {
        if (req.destroyed) return;
        const behavior = behaviors[calls.length - 1] || {};
        if (behavior.error) {
          req.emit("error", new Error("network"));
          return;
        }
        const response = new PassThrough();
        responses.push(response);
        req.response = response;
        response.statusCode = behavior.status || 200;
        response.headers = behavior.headers || {};
        onResponse(response);
        if (behavior.afterHeaders) behavior.afterHeaders(response);
        else if (!behavior.pending && !response.destroyed)
          response.end(behavior.body || "{}");
      });
    };
    return req;
  }
  return { request, calls, requests, responses };
}
function directFixture(behaviors, resolve = async () => PUBLIC_IPS) {
  const fixture = httpsFixture(behaviors);
  return {
    ...fixture,
    fetch: createDirectLyricFetch({ request: fixture.request, resolve }),
  };
}
test("only public routable addresses pass; private, fake-IP and mapped scopes fail", () => {
  for (const value of [
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.1.1",
    "100.64.1.1",
    "198.18.0.1",
    "198.19.255.255",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "192.0.2.1",
    "198.51.100.1",
    "203.0.113.1",
    "::",
    "::1",
    "::ffff:8.8.8.8",
    "fc00::1",
    "fd00::1",
    "fe80::1",
    "ff02::1",
    "2001:db8::1",
    "fe80::1%en0",
    "example.com",
    "8.8.8.8.evil",
  ])
    assert.equal(isPublicAddress(value), false, value);
  for (const value of [
    ...PUBLIC_IPS,
    "2606:4700:4700::1111",
    "2001:4860:4860::8888",
  ])
    assert.equal(isPublicAddress(value), true, value);
});
test("DNS permits only registered hosts, fixed HTTPS resolvers and two addresses", async () => {
  const calls = [];
  const resolve = createPublicDnsResolver({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return dnsResponse("lyrics.kugou.com", ["198.18.1.1", ...PUBLIC_IPS]);
    },
  });
  await assert.rejects(resolve("evil.example"));
  assert.equal(calls.length, 0);
  assert.deepEqual(await resolve("lyrics.kugou.com"), PUBLIC_IPS.slice(0, 2));
  assert.equal(
    calls[0].url,
    "https://dns.alidns.com/resolve?name=lyrics.kugou.com&type=A"
  );
  assert.equal(calls[0].options.redirect, "error");
  assert.equal(calls[0].options.credentials, "omit");
  assert.deepEqual(Object.keys(calls[0].options.headers), ["Accept"]);
});
test("DNS TTL cache expires, caps long TTL and does not reuse zero TTL", async () => {
  let now = 0;
  let count = 0;
  const resolve = createPublicDnsResolver({
    now: () => now,
    fetchImpl: async () => {
      count += 1;
      return dnsResponse("lyrics.kugou.com", PUBLIC_IPS, count < 3 ? 10000 : 0);
    },
  });
  await resolve("lyrics.kugou.com");
  now = 299999;
  await resolve("lyrics.kugou.com");
  assert.equal(count, 1);
  now = 300000;
  await resolve("lyrics.kugou.com");
  assert.equal(count, 2);
  now = 600000;
  await resolve("lyrics.kugou.com");
  await resolve("lyrics.kugou.com");
  assert.equal(count, 4);
});
test("DNS wrong question or unsafe answer can only fall back to the fixed second resolver", async () => {
  for (const bad of [
    () => dnsResponse("other.example"),
    () => dnsResponse("lyrics.kugou.com", ["127.0.0.1"]),
  ]) {
    const calls = [];
    const resolve = createPublicDnsResolver({
      fetchImpl: async (url) => {
        calls.push(url);
        return calls.length === 1 ? bad() : dnsResponse();
      },
    });
    assert.deepEqual(await resolve("lyrics.kugou.com"), PUBLIC_IPS.slice(0, 2));
    assert.equal(calls.length, 2);
    assert.match(calls[1], /^https:\/\/dns\.google\/resolve\?/);
  }
});
test("oversized/malformed DNS bodies fail explicitly with at most three attempts", async () => {
  for (const body of ["x".repeat(64 * 1024 + 1), "{broken"]) {
    let calls = 0;
    const resolve = createPublicDnsResolver({
      fetchImpl: async () => {
        calls++;
        return new Response(body);
      },
    });
    await assert.rejects(resolve("lyrics.kugou.com"), {
      code: "LYRIC_INVALID_RESPONSE",
    });
    assert.equal(calls, 3);
  }
});
test("DNS cancellation stops promptly even if the injected fetch ignores cancellation", async () => {
  const controller = new AbortController();
  let calls = 0;
  const resolve = createPublicDnsResolver({
    fetchImpl: () => {
      calls++;
      return new Promise(() => {});
    },
  });
  const pending = resolve("lyrics.kugou.com", controller.signal);
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(calls, 1);
});
test("direct socket uses resolved IP with original TLS identity and fixed credential-free GET headers", async () => {
  const fixture = directFixture([{ body: '{"status":200}' }]);
  const response = await fixture.fetch(URL_VALUE, {
    headers: { Cookie: "ignored", Authorization: "ignored" },
  });
  assert.equal(await response.text(), '{"status":200}');
  const options = fixture.calls[0];
  assert.equal(options.hostname, PUBLIC_IPS[0]);
  assert.equal(options.servername, "lyrics.kugou.com");
  assert.equal(options.headers.Host, "lyrics.kugou.com");
  assert.equal(options.rejectUnauthorized, true);
  assert.equal(options.agent, false);
  assert.equal(options.method, "GET");
  assert.equal(options.path, "/search?keyword=test");
  assert.equal(options.headers["Accept-Encoding"], "identity");
  assert.equal(options.headers.Cookie, undefined);
  assert.equal(options.headers.Authorization, undefined);
  assert.equal(
    options.checkServerIdentity(PUBLIC_IPS[0], {
      subjectaltname: "DNS:lyrics.kugou.com",
    }),
    undefined
  );
  assert.equal(
    options.checkServerIdentity("evil.example", {
      subjectaltname: "DNS:evil.example",
    }).code,
    "ERR_TLS_CERT_ALTNAME_INVALID"
  );
});
test("unlisted paths/schemes/credentials are rejected before DNS or HTTPS", async () => {
  let dnsCalls = 0;
  const fixture = directFixture([], async () => {
    dnsCalls++;
    return PUBLIC_IPS;
  });
  for (const url of [
    "https://evil.example/search",
    "http://lyrics.kugou.com/search",
    "https://lyrics.kugou.com/private",
    "https://user:secret@lyrics.kugou.com/search",
    `${URL_VALUE}#fragment`,
  ])
    await assert.rejects(fixture.fetch(url));
  assert.equal(dnsCalls, 0);
  assert.equal(fixture.calls.length, 0);
});
test("unsafe resolver addresses never connect", async () => {
  const fixture = directFixture([], async () => [
    "127.0.0.1",
    "198.18.1.1",
    "fc00::1",
  ]);
  await assert.rejects(fixture.fetch(URL_VALUE));
  assert.equal(fixture.calls.length, 0);
});
test("connection fallback never reuses already failed public addresses", async () => {
  const fixture = directFixture(
    [{ error: true }, { error: true }, { body: "never" }],
    async () => PUBLIC_IPS.slice(0, 2)
  );
  const result = await requestLyric(fixture.fetch, URL_VALUE);
  assert.deepEqual(result, {
    ok: false,
    status: "unavailable",
    reason: "connection-failed",
    networkStage: "connect",
    attempts: 1,
  });
  assert.deepEqual(
    fixture.calls.map((x) => x.hostname),
    PUBLIC_IPS.slice(0, 2)
  );
});
test("HTTP redirect/error never follows or retries after receiving a response", async () => {
  for (const status of [301, 403, 503]) {
    const fixture = directFixture([
      { status, headers: { location: "https://evil.example/" } },
    ]);
    assert.deepEqual(await requestLyric(fixture.fetch, URL_VALUE), {
      ok: false,
      status: "unavailable",
      httpStatus: status,
      networkStage: "response",
      attempts: 1,
    });
    assert.equal(fixture.calls.length, 1);
  }
});
test("encoded, declared oversized and actual oversized lyric bodies are explicit failures", async () => {
  for (const behavior of [
    { headers: { "content-encoding": "gzip" } },
    { headers: { "content-length": String(2 * 1024 * 1024 + 1) } },
    { body: Buffer.alloc(2 * 1024 * 1024 + 1) },
    { afterHeaders: (res) => res.emit("error", new Error("body failed")) },
  ]) {
    const fixture = directFixture([behavior]);
    const result = await requestLyric(fixture.fetch, URL_VALUE);
    assert.equal(result.ok, false);
    assert.equal(
      result.status,
      behavior.afterHeaders ? "unavailable" : "invalid-response"
    );
    assert.equal(fixture.calls.length, 1);
  }
});
test("outer cancellation destroys in-flight HTTPS and does not retry", async () => {
  const controller = new AbortController();
  const fixture = directFixture([{ pending: true }]);
  const pending = requestLyric(fixture.fetch, URL_VALUE, controller.signal);
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  assert.deepEqual(await pending, {
    ok: false,
    status: "timeout",
    networkStage: "response",
    attempts: 1,
  });
  assert.equal(fixture.calls.length, 1);
  assert.equal(fixture.requests[0].destroyed, true);
});
test("already cancelled requests never create a socket", async () => {
  const controller = new AbortController();
  controller.abort();
  const fixture = directFixture([]);
  assert.equal(
    (await requestLyric(fixture.fetch, URL_VALUE, controller.signal)).status,
    "timeout"
  );
  assert.equal(fixture.calls.length, 0);
});
test("main wires the isolated transport only to the existing trusted lyric IPC", () => {
  const fs = require("node:fs");
  const source = fs.readFileSync(require.resolve("../main.js"), "utf8");
  assert.match(source, /const directLyricFetch = createDirectLyricFetch\(/);
  assert.match(
    source,
    /dnsFetch: \(url, options\) => electron\.net\.fetch\(url, options\)/
  );
  assert.match(source, /requestLyric\(\s*directLyricFetch,/);
  assert.doesNotMatch(
    source,
    /setGlobalDispatcher|NODE_TLS_REJECT_UNAUTHORIZED/
  );
});

test("204/205 null-body responses cannot throw from the asynchronous end event", async () => {
  for (const status of [204, 205]) {
    const fixture = directFixture([{ status }]);
    const response = await fixture.fetch(URL_VALUE);
    assert.equal(response.status, status);
    assert.equal(response.body, null);
  }
});

test("DNS and HTTPS share the original eight-second deadline", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let resolveDns;
  const fixture = directFixture(
    [{ pending: true }],
    () =>
      new Promise((resolve) => {
        resolveDns = resolve;
      })
  );
  const pending = requestLyric(fixture.fetch, URL_VALUE);
  await Promise.resolve();
  t.mock.timers.tick(4000);
  resolveDns(PUBLIC_IPS);
  for (let i = 0; i < 6; i++) await Promise.resolve();
  assert.equal(fixture.calls.length, 1);
  t.mock.timers.tick(3999);
  assert.notEqual(fixture.requests[0].destroyed, true);
  t.mock.timers.tick(1);
  assert.deepEqual(await pending, {
    ok: false,
    status: "timeout",
    networkStage: "response",
    attempts: 1,
  });
  assert.equal(fixture.requests[0].destroyed, true);
  assert.equal(fixture.calls.length, 1);
});

test("AliDNS object Question remains subject to exact name and type checks", async () => {
  for (const question of [
    { name: "lyrics.kugou.com.", type: 1 },
    { name: "evil.example.", type: 1 },
    { name: "lyrics.kugou.com.", type: 28 },
    null,
  ]) {
    let calls = 0;
    const resolve = createPublicDnsResolver({
      fetchImpl: async () => {
        calls++;
        return new Response(
          JSON.stringify({
            Status: 0,
            Question: question,
            Answer: [{ type: 1, TTL: 60, data: PUBLIC_IPS[0] }],
          })
        );
      },
    });
    if (
      question &&
      question.name === "lyrics.kugou.com." &&
      question.type === 1
    ) {
      assert.deepEqual(await resolve("lyrics.kugou.com"), [PUBLIC_IPS[0]]);
      assert.equal(calls, 1);
    } else {
      await assert.rejects(resolve("lyrics.kugou.com"), {
        code: "LYRIC_INVALID_RESPONSE",
      });
      assert.equal(calls, 3);
    }
  }
});
test("DoH resolver fallback is fixed, finite and never falls back to system DNS", async () => {
  const calls = [];
  const resolve = createPublicDnsResolver({
    fetchImpl: async (url) => {
      calls.push(new URL(url).origin + new URL(url).pathname);
      if (calls.length < 3) throw new Error("DNS unavailable");
      return dnsResponse();
    },
  });
  assert.deepEqual(await resolve("lyrics.kugou.com"), PUBLIC_IPS.slice(0, 2));
  assert.deepEqual(calls, [
    "https://dns.alidns.com/resolve",
    "https://dns.google/resolve",
    "https://cloudflare-dns.com/dns-query",
  ]);
});

test("unsuccessful DNS HTTP responses close their bodies before bounded fallback", async () => {
  let cancelled = false;
  let calls = 0;
  const resolve = createPublicDnsResolver({
    fetchImpl: async () => {
      calls++;
      if (calls === 1)
        return {
          ok: false,
          body: {
            cancel: () => {
              cancelled = true;
              return Promise.resolve();
            },
          },
        };
      assert.equal(cancelled, true);
      return dnsResponse();
    },
  });
  assert.deepEqual(await resolve("lyrics.kugou.com"), PUBLIC_IPS.slice(0, 2));
  assert.equal(calls, 2);
});

test("connection failure obtains fresh fixed-resolver addresses and caches the reachable route", async () => {
  const dnsCalls = [];
  const fixture = httpsFixture([
    { error: true },
    { error: true },
    { body: "fallback" },
    { body: "cached" },
  ]);
  const fetch = createDirectLyricFetch({
    request: fixture.request,
    dnsFetch: async (url) => {
      dnsCalls.push(url);
      return dnsResponse(
        "lyrics.kugou.com",
        dnsCalls.length === 1
          ? PUBLIC_IPS.slice(0, 2)
          : [PUBLIC_IPS[1], PUBLIC_IPS[2]]
      );
    },
  });
  assert.equal(await (await fetch(URL_VALUE)).text(), "fallback");
  assert.deepEqual(
    fixture.calls.map((call) => call.hostname),
    PUBLIC_IPS
  );
  assert.equal(dnsCalls.length, 2);
  assert.match(dnsCalls[1], /^https:\/\/dns\.google\/resolve/);
  assert.equal(await (await fetch(URL_VALUE)).text(), "cached");
  assert.equal(dnsCalls.length, 2);
  assert.equal(fixture.calls[3].hostname, PUBLIC_IPS[2]);
});

test("resolver fallback is at most four unique public sockets and three fixed DNS calls", async () => {
  const dnsCalls = [];
  const fourth = "4.2.2.2";
  const fixture = httpsFixture(
    Array.from({ length: 5 }, () => ({ error: true }))
  );
  const fetch = createDirectLyricFetch({
    request: fixture.request,
    dnsFetch: async (url) => {
      dnsCalls.push(url);
      return dnsResponse(
        "lyrics.kugou.com",
        dnsCalls.length < 3
          ? PUBLIC_IPS.slice(0, 2)
          : ["127.0.0.1", PUBLIC_IPS[0], PUBLIC_IPS[2], fourth]
      );
    },
  });
  assert.equal((await requestLyric(fetch, URL_VALUE)).status, "unavailable");
  assert.equal(dnsCalls.length, 3);
  assert.equal(new Set(dnsCalls).size, 3);
  assert.deepEqual(
    fixture.calls.map((call) => call.hostname),
    [...PUBLIC_IPS, fourth]
  );
});

test("HTTP 500 ends the request without a second resolver or socket", async () => {
  let dnsCalls = 0;
  const fixture = httpsFixture([{ status: 500 }]);
  const fetch = createDirectLyricFetch({
    request: fixture.request,
    dnsFetch: async () => {
      dnsCalls++;
      return dnsResponse();
    },
  });
  assert.deepEqual(await requestLyric(fetch, URL_VALUE), {
    ok: false,
    status: "unavailable",
    httpStatus: 500,
    networkStage: "response",
    attempts: 1,
  });
  assert.equal(dnsCalls, 1);
  assert.equal(fixture.calls.length, 1);
});

test("each DoH attempt has a two-second budget even when fetch ignores abort", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const signals = [];
  const resolve = createPublicDnsResolver({
    fetchImpl: (url, { signal }) => {
      signals.push(signal);
      return signals.length === 1
        ? new Promise(() => {})
        : Promise.resolve(dnsResponse());
    },
  });
  const pending = resolve("lyrics.kugou.com");
  t.mock.timers.tick(1999);
  assert.equal(signals.length, 1);
  t.mock.timers.tick(1);
  for (let i = 0; i < 12; i++) await Promise.resolve();
  assert.deepEqual(await pending, PUBLIC_IPS.slice(0, 2));
  assert.equal(signals[0].aborted, true);
  assert.equal(signals.length, 2);
  assert.equal(signals[1].aborted, false);
});

test("DoH body reading shares its resolver budget and cancels stalled readers", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let cancelled = false;
  let calls = 0;
  const resolve = createPublicDnsResolver({
    fetchImpl: async () => {
      calls++;
      return calls === 1
        ? new Response(
            new ReadableStream({
              cancel() {
                cancelled = true;
              },
            })
          )
        : dnsResponse();
    },
  });
  const pending = resolve("lyrics.kugou.com");
  for (let i = 0; i < 6; i++) await Promise.resolve();
  t.mock.timers.tick(2000);
  for (let i = 0; i < 12; i++) await Promise.resolve();
  await pending;
  assert.equal(cancelled, true);
  assert.equal(calls, 2);
});

test("outer cancellation during connection-triggered DNS fallback prevents later resolvers", async () => {
  const controller = new AbortController();
  const signals = [];
  const fixture = httpsFixture([{ error: true }, { error: true }]);
  const fetch = createDirectLyricFetch({
    request: fixture.request,
    dnsFetch: (url, { signal }) => {
      signals.push(signal);
      return signals.length === 1
        ? Promise.resolve(dnsResponse())
        : new Promise(() => {});
    },
  });
  const pending = requestLyric(fetch, URL_VALUE, controller.signal);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(signals.length, 2);
  controller.abort();
  assert.equal((await pending).status, "timeout");
  assert.equal(signals[1].aborted, true);
  assert.equal(signals.length, 2);
  assert.equal(fixture.calls.length, 2);
});

test("connection fallback keeps the original total deadline for its replacement socket", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  const fixture = httpsFixture([
    { error: true },
    { error: true },
    { pending: true },
  ]);
  const fetch = createDirectLyricFetch({
    request: fixture.request,
    dnsFetch: async () => {
      calls++;
      return dnsResponse(
        "lyrics.kugou.com",
        calls === 1 ? PUBLIC_IPS.slice(0, 2) : [PUBLIC_IPS[2]]
      );
    },
  });
  const pending = requestLyric(fetch, URL_VALUE);
  for (let i = 0; i < 40; i++) await Promise.resolve();
  assert.equal(fixture.calls.length, 3);
  t.mock.timers.tick(7999);
  assert.notEqual(fixture.requests[2].destroyed, true);
  t.mock.timers.tick(1);
  assert.equal((await pending).status, "timeout");
  assert.equal(fixture.requests[2].destroyed, true);
});

test("a DoH response arriving after its budget closes its unused body", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let deliverLate;
  let cancelled = false;
  let calls = 0;
  const resolve = createPublicDnsResolver({
    fetchImpl: () => {
      calls++;
      return calls === 1
        ? new Promise((deliver) => {
            deliverLate = deliver;
          })
        : Promise.resolve(dnsResponse());
    },
  });
  const pending = resolve("lyrics.kugou.com");
  t.mock.timers.tick(2000);
  for (let i = 0; i < 16; i++) await Promise.resolve();
  assert.deepEqual(await pending, PUBLIC_IPS.slice(0, 2));
  deliverLate({
    body: {
      cancel: async () => {
        cancelled = true;
      },
    },
  });
  for (let i = 0; i < 8; i++) await Promise.resolve();
  assert.equal(cancelled, true);
  assert.equal(calls, 2);
});

test("LRCLIB keeps only Retry-After and centrally generated identity, never caller headers", async () => {
  const fixture = directFixture([
    {
      status: 503,
      headers: {
        "retry-after": "2",
        "set-cookie": "secret",
        location: "https://evil.example/",
      },
    },
  ]);
  const response = await fixture.fetch(
    "https://lrclib.net/api/search?q=public",
    {
      headers: {
        Cookie: "secret",
        Authorization: "secret",
        "User-Agent": "forged",
      },
    }
  );
  assert.equal(response.headers.get("retry-after"), "2");
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(response.headers.get("location"), null);
  const headers = fixture.calls[0].headers;
  assert.equal(headers.Cookie, undefined);
  assert.equal(headers.Authorization, undefined);
  assert.equal(
    headers["User-Agent"],
    `Listen2/${
      require("../package.json").version
    } (https://github.com/dazzlingwuming/listen2)`
  );
  assert.equal(headers["Lrclib-Client"], headers["User-Agent"]);
});
test("network phase diagnostics preserve only safe native codes through independent fallback", async () => {
  for (const stage of ["connect", "tls", "response"]) {
    const fetch = createDirectLyricFetch({
      resolve: async () => [PUBLIC_IPS[0]],
      request(_options, onResponse) {
        const req = new EventEmitter();
        req.destroy = () => {};
        req.end = () =>
          queueMicrotask(() => {
            const socket = new EventEmitter();
            socket.connecting = true;
            req.emit("socket", socket);
            if (stage !== "connect") socket.emit("connect");
            if (stage === "response") socket.emit("secureConnect");
            req.emit(
              "error",
              Object.assign(new Error("private address and response"), {
                code: "ECONNRESET",
                url: "private",
              })
            );
          });
        return req;
      },
    });
    const result = await requestLyric(fetch, URL_VALUE);
    assert.equal(result.networkStage, stage);
    assert.equal(result.networkCode, "ECONNRESET");
    assert.equal(result.reason, "connection-failed");
    assert.equal(JSON.stringify(result).includes("private"), false);
  }
  const fetch = createDirectLyricFetch({
    resolve: async () => {
      throw Object.assign(new Error("private dns"), { code: "ENOTFOUND" });
    },
  });
  assert.deepEqual(await requestLyric(fetch, URL_VALUE), {
    ok: false,
    status: "unavailable",
    reason: "connection-failed",
    networkStage: "dns",
    networkCode: "ENOTFOUND",
    attempts: 1,
  });
});
