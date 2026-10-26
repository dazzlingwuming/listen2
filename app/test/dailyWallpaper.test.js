const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");
const { createDailyWallpaperService } = require("../dailyWallpaper");
const ROOT = path.join(
  __dirname,
  "../..",
  ".task-workspaces/macos-daily-theme-20261025/scratch/daily-backend"
);
const META =
  "https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=8&mkt=zh-CN";
const JPEG = Buffer.from([255, 216, 255, 224, 0, 1, 2, 3]);
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]);
const entry = (overrides = {}) => ({
  startdate: "20261025",
  wp: true,
  url: "/th?id=OHR.Test_1920x1080.jpg",
  title: "A landscape",
  copyright: "Photographer ©",
  copyrightlink: "https://www.bing.com/search?q=landscape",
  ...overrides,
});
const response = (bytes, mime, init = {}) =>
  new Response(bytes, {
    status: 200,
    headers: { "content-type": mime },
    ...init,
  });
const metadata = (entries = [entry()]) =>
  response(
    JSON.stringify({ images: entries }),
    "application/json; charset=utf-8"
  );
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function setup(t, options = {}) {
  await fs.mkdir(ROOT, { recursive: true });
  const cacheDirectory = await fs.mkdtemp(path.join(ROOT, "case-"));
  t.after(() => fs.rm(cacheDirectory, { recursive: true, force: true }));
  const calls = [];
  let time = new Date(2026, 9, 25, 12);
  const fetch = async (url, fetchOptions) => {
    calls.push({ url, options: fetchOptions });
    return url === META ? metadata() : response(JPEG, "image/jpeg");
  };
  const config = {
    cacheDirectory,
    fetch,
    decodeImage: () => ({ width: 1920, height: 1080 }),
    now: () => time,
    ...options,
  };
  return {
    calls,
    cacheDirectory,
    config,
    service: createDailyWallpaperService(config),
    setTime: (value) => {
      time = value;
    },
  };
}

test("fixed-source download, local-day selection, disk restart and same-day network suppression", async (t) => {
  const f = await setup(t);
  const fresh = await f.service.get({ refresh: true });
  assert.equal(fresh.status, "fresh");
  assert.equal(fresh.requestedDate, "2026-10-25");
  assert.equal(fresh.wallpaper.sourceDate, "2026-10-25");
  assert.equal(
    fresh.wallpaper.image,
    `data:image/jpeg;base64,${JPEG.toString("base64")}`
  );
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[0].url, META);
  for (const call of f.calls) {
    assert.equal(call.options.redirect, "error");
    assert.equal(call.options.credentials, "omit");
  }
  assert.equal((await f.service.get()).status, "cached");
  const restarted = createDailyWallpaperService({
    ...f.config,
    fetch: () => {
      throw Error("must not fetch");
    },
  });
  assert.equal((await restarted.get()).status, "cached");
  assert.deepEqual(await fs.readdir(f.cacheDirectory), [
    "daily-wallpaper.json",
  ]);
});

test("cache-only hydration never fetches, including absent, stale and corrupt caches", async (t) => {
  const f = await setup(t);
  assert.equal((await f.service.get({ refresh: false })).status, "unavailable");
  assert.equal(f.calls.length, 0);
  await f.service.get();
  f.setTime(new Date(2026, 9, 26));
  const stale = await f.service.get({ refresh: false });
  assert.equal(stale.status, "stale");
  assert.equal(stale.wallpaper.date, "2026-10-25");
  assert.equal(f.calls.length, 2);
  await fs.writeFile(
    path.join(f.cacheDirectory, "daily-wallpaper.json"),
    "broken"
  );
  const restarted = createDailyWallpaperService(f.config);
  const unavailable = await restarted.get({ refresh: false });
  assert.equal(unavailable.status, "unavailable");
  assert.equal(unavailable.errorCode, "invalid-cache");
  assert.equal(f.calls.length, 2);
});

test("local date wins over UTC/market future record and permission must be explicit", async (t) => {
  const selected = [];
  const f = await setup(t, {
    fetch: async (url) => {
      selected.push(url);
      return url === META
        ? metadata([
            entry({ startdate: "20261026", url: "/th?id=future" }),
            entry(),
          ])
        : response(JPEG, "image/jpeg");
    },
  });
  // Local constructor deliberately follows the runtime timezone rather than UTC.
  f.setTime(new Date(2026, 9, 25, 23, 59));
  assert.equal((await f.service.get()).status, "fresh");
  assert.equal(
    selected[1],
    "https://www.bing.com/th?id=OHR.Test_1920x1080.jpg"
  );
  for (const wp of [false, undefined, "true", 1]) {
    const f2 = await setup(t, { fetch: async () => metadata([entry({ wp })]) });
    const result = await f2.service.get();
    assert.equal(result.errorCode, "no-eligible-image");
    assert.equal(result.ok, false);
  }
});

test("failure preserves last-good bytes, applies backoff and retries after thirty minutes", async (t) => {
  const f = await setup(t);
  await f.service.get();
  const original = await fs.readFile(
    path.join(f.cacheDirectory, "daily-wallpaper.json"),
    "utf8"
  );
  f.setTime(new Date(2026, 9, 26));
  assert.equal((await f.service.get()).errorCode, "no-eligible-image");
  const count = f.calls.length;
  assert.equal((await f.service.get()).status, "stale");
  assert.equal(f.calls.length, count);
  assert.equal(
    await fs.readFile(
      path.join(f.cacheDirectory, "daily-wallpaper.json"),
      "utf8"
    ),
    original
  );
  f.setTime(new Date(2026, 9, 26, 0, 31));
  await f.service.get();
  assert.equal(f.calls.length, count + 1);
});

test("deduplicates refresh and cancels an ignored abort without late publication", async (t) => {
  let resolveImage;
  let startedImage;
  const imageStarted = new Promise((resolve) => {
    startedImage = resolve;
  });
  let calls = 0;
  const f = await setup(t, {
    fetch: (url) => {
      calls += 1;
      if (url === META) return metadata();
      startedImage();
      return new Promise((resolve) => {
        resolveImage = resolve;
      });
    },
  });
  const first = f.service.get();
  const second = f.service.get();
  await imageStarted;
  f.service.cancel();
  assert.equal((await first).errorCode, "cancelled");
  assert.equal((await second).errorCode, "cancelled");
  assert.equal(calls, 2);
  resolveImage(response(JPEG, "image/jpeg"));
  await wait(15);
  assert.deepEqual(await fs.readdir(f.cacheDirectory), []);
});

test("cancellation during asynchronous cache read prevents a new refresh", async (t) => {
  const f = await setup(t);
  const pending = f.service.get();
  f.service.cancel();
  assert.equal((await pending).errorCode, "cancelled");
  assert.equal(f.calls.length, 0);
});

test("metadata and total deadlines finish even if injected fetch ignores abort", async (t) => {
  const f = await setup(t, {
    fetch: () => new Promise(() => {}),
    metadataTimeoutMs: 15,
    totalTimeoutMs: 200,
  });
  assert.equal((await f.service.get()).errorCode, "timeout");
  const f2 = await setup(t, {
    fetch: (url) => (url === META ? metadata() : new Promise(() => {})),
    metadataTimeoutMs: 200,
    totalTimeoutMs: 15,
  });
  assert.equal((await f2.service.get()).errorCode, "timeout");
});

test("enforces streamed size limits without trusting content length", async (t) => {
  for (const stage of ["metadata", "image"]) {
    const bytes = Buffer.alloc(
      stage === "metadata" ? 65537 : 6 * 1024 * 1024 + 1
    );
    const f = await setup(t, {
      fetch: (url) =>
        stage === "metadata" || url !== META
          ? response(
              bytes,
              stage === "metadata" ? "application/json" : "image/jpeg"
            )
          : metadata(),
    });
    assert.equal((await f.service.get()).errorCode, "response-too-large");
    assert.deepEqual(await fs.readdir(f.cacheDirectory), []);
  }
  const f = await setup(t, {
    fetch: () =>
      response("{}", "application/json", {
        headers: { "content-length": "70000" },
      }),
  });
  assert.equal((await f.service.get()).errorCode, "response-too-large");
});

test("rejects redirects, off-host URLs, credentials, ports, fragments and unsafe attribution", async (t) => {
  for (const url of [
    "//evil.test/th?id=x",
    "https://www.bing.com/th?id=x",
    "/th/../other?id=x",
    "/th?id=x#fragment",
    "/th?id=x\\evil",
  ]) {
    const f = await setup(t, { fetch: () => metadata([entry({ url })]) });
    assert.equal((await f.service.get()).ok, false, url);
  }
  for (const copyrightlink of [
    "http://www.bing.com/search?q=x",
    "https://www.bing.com:8443/search?q=x",
    "https://www.bing.com:443/search?q=x",
    "https://user@www.bing.com/search?q=x",
    "https://www.bing.com/other?q=x",
    "https://evil.test/search?q=x",
  ]) {
    const f = await setup(t, {
      fetch: () => metadata([entry({ copyrightlink })]),
    });
    assert.equal((await f.service.get()).ok, false, copyrightlink);
  }
  const f = await setup(t, {
    fetch: async () => ({
      ok: true,
      redirected: true,
      url: "https://evil.test/",
      headers: new Headers(),
    }),
  });
  assert.equal((await f.service.get()).errorCode, "http-error");
  const f2 = await setup(t, {
    fetch: async () => ({
      ok: true,
      redirected: false,
      url: "https://evil.test/",
      headers: new Headers(),
    }),
  });
  assert.equal((await f2.service.get()).errorCode, "http-error");
});

test("requires raster MIME, matching magic bytes, native decoding and bounded dimensions", async (t) => {
  const cases = [
    { bytes: JPEG, mime: "image/svg+xml" },
    { bytes: Buffer.from("<html>not a photo</html>"), mime: "image/jpeg" },
    { bytes: PNG, mime: "image/jpeg" },
    {
      bytes: JPEG,
      mime: "image/jpeg",
      decodeImage: () => ({ isEmpty: () => true }),
    },
    {
      bytes: JPEG,
      mime: "image/jpeg",
      decodeImage: () => ({ width: 10000, height: 5000 }),
    },
    {
      bytes: JPEG,
      mime: "image/jpeg",
      decodeImage: () => ({ width: 0, height: 1080 }),
    },
    {
      bytes: JPEG,
      mime: "image/jpeg",
      decodeImage: () => {
        throw Error("decode failed");
      },
    },
  ];
  for (const item of cases) {
    const f = await setup(t, {
      fetch: (url) =>
        url === META ? metadata() : response(item.bytes, item.mime),
      ...(item.decodeImage ? { decodeImage: item.decodeImage } : {}),
    });
    assert.equal((await f.service.get()).ok, false);
    assert.deepEqual(await fs.readdir(f.cacheDirectory), []);
  }
  for (const [bytes, mime] of [
    [PNG, "image/png"],
    [Buffer.from("RIFFxxxxWEBPdata"), "image/webp"],
  ]) {
    const f = await setup(t, {
      fetch: (url) => (url === META ? metadata() : response(bytes, mime)),
    });
    assert.equal((await f.service.get()).ok, true);
  }
});

test("cache schema and actual native decode are revalidated after restart", async (t) => {
  const f = await setup(t);
  await f.service.get();
  const cachePath = path.join(f.cacheDirectory, "daily-wallpaper.json");
  const valid = JSON.parse(await fs.readFile(cachePath, "utf8"));
  for (const patch of [
    { version: 2 },
    { date: "2026-02-30" },
    { sourceDate: "2026-10-24" },
    { base64: "!!!=" },
    { mime: "image/png" },
    { attributionUrl: "https://evil.test/search" },
  ]) {
    await fs.writeFile(cachePath, JSON.stringify({ ...valid, ...patch }));
    const result = await createDailyWallpaperService(f.config).get({
      refresh: false,
    });
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "invalid-cache");
  }
  await fs.writeFile(cachePath, JSON.stringify(valid));
  const result = await createDailyWallpaperService({
    ...f.config,
    decodeImage: () => ({ width: 0, height: 0 }),
  }).get({ refresh: false });
  assert.equal(result.ok, false);
  await fs.writeFile(cachePath, " ".repeat(8 * 1024 * 1024 + 8193));
  assert.equal(
    (await createDailyWallpaperService(f.config).get({ refresh: false }))
      .errorCode,
    "invalid-cache"
  );
});

test("bounded plain text metadata is returned without executable markup", async (t) => {
  const f = await setup(t, {
    fetch: (url) =>
      url === META
        ? metadata([
            entry({
              title: `<b>${"x".repeat(500)}</b>`,
              copyright: "<script>text</script>\ncredit",
            }),
          ])
        : response(JPEG, "image/jpeg"),
  });
  const result = await f.service.get();
  assert.equal(result.wallpaper.title.length, 240);
  assert.equal(result.wallpaper.copyright, "text credit");
});

test("cancellation while decoding cannot publish late native results", async (t) => {
  let releaseDecode;
  let signalStarted;
  const started = new Promise((resolve) => {
    signalStarted = resolve;
  });
  const f = await setup(t, {
    decodeImage: () => {
      signalStarted();
      return new Promise((resolve) => {
        releaseDecode = resolve;
      });
    },
  });
  const pending = f.service.get();
  await started;
  f.service.cancel();
  assert.equal((await pending).errorCode, "cancelled");
  releaseDecode({ width: 1920, height: 1080 });
  await wait(10);
  assert.deepEqual(await fs.readdir(f.cacheDirectory), []);
});

test("stalled stream and ignored stream cancellation still obey total deadline", async (t) => {
  const f = await setup(t, {
    totalTimeoutMs: 20,
    fetch: (url) =>
      url === META
        ? metadata()
        : {
            ok: true,
            headers: new Headers({ "content-type": "image/jpeg" }),
            body: {
              getReader: () => ({
                read: () => new Promise(() => {}),
                cancel: () => new Promise(() => {}),
              }),
            },
          },
  });
  assert.equal((await f.service.get()).errorCode, "timeout");
  assert.deepEqual(await fs.readdir(f.cacheDirectory), []);
});
