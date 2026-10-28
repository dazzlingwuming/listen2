const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");
const { createDailyWallpaperService } = require("../dailyWallpaper");
const TASK_ID =
  process.env.LISTEN2_TASK_ID || "daily-wallpaper-refresh-20261028";
if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(TASK_ID)) {
  throw new Error("Invalid LISTEN2_TASK_ID");
}
const ROOT = path.join(
  __dirname,
  "../..",
  `.task-workspaces/${TASK_ID}/scratch/daily-backend`
);
const META =
  "https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=8&mkt=zh-CN";
const JPEG = Buffer.from([255, 216, 255, 224, 0, 1, 2, 3]);
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]);
const compactUtc = (date) =>
  date
    .toISOString()
    .replace(/[-:TZ.]/g, "")
    .slice(0, 12);
const entry = (overrides = {}) => {
  const localNoon = new Date(2026, 9, 25, 12);
  const fullstartdate = compactUtc(localNoon);
  const startdate = fullstartdate.slice(0, 8);
  const nextLocalDay = new Date(2026, 9, 26, 12);
  return {
    startdate,
    fullstartdate,
    enddate: nextLocalDay.toISOString().slice(0, 10).replace(/-/g, ""),
    wp: true,
    url: "/th?id=OHR.Test_1920x1080.jpg",
    title: "A landscape",
    copyright: "Photographer ©",
    copyrightlink: "https://www.bing.com/search?q=landscape",
    ...overrides,
  };
};
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
  const { fetch: fetchOverride, ...configOptions } = options;
  const fetch = async (url, fetchOptions) => {
    calls.push({ url, options: fetchOptions });
    return fetchOverride
      ? fetchOverride(url, fetchOptions)
      : url === META
      ? metadata()
      : response(JPEG, "image/jpeg");
  };
  const config = {
    cacheDirectory,
    fetch,
    decodeImage: () => ({ width: 1920, height: 1080 }),
    now: () => time,
    ...configOptions,
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
            entry({
              startdate: "20261026",
              fullstartdate: "202610261600",
              enddate: "20261027",
              url: "/th?id=future",
            }),
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

test("selects by Bing fullstartdate in the runtime local calendar and keeps a daily cache", async (t) => {
  await fs.mkdir(ROOT, { recursive: true });
  const scratchRoot = JSON.stringify(ROOT);
  const script = String.raw`
    const assert = require('node:assert/strict');
    const fs = require('node:fs/promises');
    const path = require('node:path');
    const { createDailyWallpaperService } = require(${JSON.stringify(
      require.resolve("../dailyWallpaper")
    )});
    const META = 'https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=8&mkt=zh-CN';
    const JPEG = Buffer.from([255,216,255,224,0,1]);
    const records = [
      { startdate: '20261027', fullstartdate: '202610271600', enddate: '20261028', wp: true, url: '/th?id=OHR.Shanghai.jpg', copyrightlink: 'https://www.bing.com/search?q=shanghai' },
      { startdate: '20261028', fullstartdate: '202610281600', enddate: '20261029', wp: true, url: '/th?id=OHR.NextDay.jpg', copyrightlink: 'https://www.bing.com/search?q=next' }
    ];
    let now = new Date('2026-10-28T01:37:00Z');
    const calls = [];
    const fetch = async (url, options) => {
      calls.push({url, options});
      return url === META
        ? new Response(JSON.stringify({images: records}), {status: 200, headers: {'content-type':'application/json'}})
        : new Response(JPEG, {status: 200, headers: {'content-type':'image/jpeg'}});
    };
    (async () => {
      const cacheDirectory = await fs.mkdtemp(path.join(${scratchRoot}, 'wallpaper-shanghai-'));
      try {
        const config = {cacheDirectory, fetch, decodeImage: () => ({width:1,height:1}), now: () => now};
        const service = createDailyWallpaperService(config);
        const fresh = await service.get();
        assert.equal(fresh.status, 'fresh');
        assert.equal(fresh.requestedDate, '2026-10-28');
        assert.equal(fresh.wallpaper.date, '2026-10-28');
        assert.equal(fresh.wallpaper.sourceDate, '2026-10-28');
        assert.equal(calls[1].url, 'https://www.bing.com/th?id=OHR.Shanghai.jpg');
        assert.equal((await service.get()).status, 'cached');
        assert.equal((await createDailyWallpaperService({...config, fetch: () => {throw Error('same-day restart fetched')}}).get()).status, 'cached');
        assert.equal(calls.length, 2);
        now = new Date('2026-10-28T16:01:00Z');
        const nextDay = await service.get();
        assert.equal(nextDay.status, 'fresh');
        assert.equal(nextDay.requestedDate, '2026-10-29');
        assert.equal(nextDay.wallpaper.sourceDate, '2026-10-29');
        assert.equal(calls[3].url, 'https://www.bing.com/th?id=OHR.NextDay.jpg');
      } finally { await fs.rm(cacheDirectory, {recursive:true, force:true}); }
    })().catch((error) => {console.error(error); process.exitCode = 1;});
  `;
  const child = require("node:child_process").spawnSync(
    process.execPath,
    ["-e", script],
    {
      encoding: "utf8",
      env: { ...process.env, TZ: "Asia/Shanghai" },
      timeout: 10000,
    }
  );
  assert.equal(child.status, 0, child.stderr);
  t.diagnostic("Shanghai timezone isolated in a child process");
});

test("UTC and Los Angeles derive eligibility from local date across calendar boundaries", async (t) => {
  await fs.mkdir(ROOT, { recursive: true });
  const scratchRoot = JSON.stringify(ROOT);
  const script = String.raw`
    const assert = require('node:assert/strict');
    const fs = require('node:fs/promises');
    const path = require('node:path');
    const { createDailyWallpaperService } = require(${JSON.stringify(
      require.resolve("../dailyWallpaper")
    )});
    const image = Buffer.from([255,216,255,224,0,1]);
    const fullstartdate = '202612312359';
    const entry = { startdate: '20261231', fullstartdate, enddate: '20270101', wp: true, url: '/th?id=OHR.Boundary.jpg', copyrightlink: 'https://www.bing.com/search?q=boundary' };
    const fetch = async (url) => url.includes('HPImageArchive')
      ? new Response(JSON.stringify({ images: [entry] }), { status: 200, headers: { 'content-type': 'application/json' } })
      : new Response(image, { status: 200, headers: { 'content-type': 'image/jpeg' } });
    (async () => {
      const cacheDirectory = await fs.mkdtemp(path.join(${scratchRoot}, 'wallpaper-tz-'));
      try {
        const service = createDailyWallpaperService({ cacheDirectory, fetch, decodeImage: () => ({width: 1, height: 1}), now: () => new Date('2027-01-01T00:30:00Z') });
        const result = await service.get();
        assert.equal(result.requestedDate, process.env.EXPECTED_DATE);
        if (process.env.EXPECTED_DATE === '2026-12-31') {
          assert.equal(result.status, 'fresh');
          assert.equal(result.wallpaper.sourceDate, '2026-12-31');
        } else {
          assert.equal(result.errorCode, 'no-eligible-image');
          assert.equal((await fs.readdir(cacheDirectory)).length, 0);
        }
      } finally { await fs.rm(cacheDirectory, {recursive: true, force: true}); }
    })().catch((error) => { console.error(error); process.exitCode = 1; });
  `;
  for (const [tz, expected] of [
    ["UTC", "2027-01-01"],
    ["America/Los_Angeles", "2026-12-31"],
  ]) {
    const child = require("node:child_process").spawnSync(
      process.execPath,
      ["-e", script],
      {
        encoding: "utf8",
        env: { ...process.env, TZ: tz, EXPECTED_DATE: expected },
        timeout: 10000,
      }
    );
    assert.equal(child.status, 0, `${tz}: ${child.stderr}`);
  }
  t.diagnostic(
    "TZ isolated in child processes; parent test process timezone unchanged"
  );
});

test("rejects malformed, impossible, future and unlicensed Bing records without downloading or caching", async (t) => {
  const invalid = [
    entry({ fullstartdate: undefined }),
    entry({ fullstartdate: "2026102512" }),
    entry({ fullstartdate: "202602300000" }),
    entry({ fullstartdate: "202610252460" }),
    entry({ fullstartdate: "202610261600", startdate: "20261026" }),
    entry({
      fullstartdate: "202610261600",
      startdate: "20261026",
      enddate: "20261027",
    }),
    entry({ fullstartdate: "202610251200", wp: false }),
  ];
  for (const candidate of invalid) {
    const f = await setup(t, {
      now: () => new Date("2026-10-25T12:00:00Z"),
      fetch: async (url) =>
        url === META ? metadata([candidate]) : response(JPEG, "image/jpeg"),
    });
    const result = await f.service.get();
    assert.equal(
      result.errorCode,
      "no-eligible-image",
      JSON.stringify(candidate)
    );
    assert.equal(f.calls.length, 1);
    assert.deepEqual(await fs.readdir(f.cacheDirectory), []);
  }
  const f = await setup(t, {
    now: () => new Date("2026-10-25T12:00:00Z"),
    fetch: async (url) =>
      url === META
        ? metadata([
            entry({ fullstartdate: "202610251200", wp: false }),
            entry({
              startdate: "20261024",
              fullstartdate: "202610241559",
              enddate: "20261025",
              url: "/th?id=historical",
            }),
          ])
        : response(JPEG, "image/jpeg"),
  });
  assert.equal((await f.service.get()).errorCode, "no-eligible-image");
  assert.equal(f.calls.length, 1);
  assert.deepEqual(await fs.readdir(f.cacheDirectory), []);
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
