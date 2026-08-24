const assert = require("assert");
const os = require("os");
const path = require("path");
const { mkdtemp, mkdir, readdir, rm, writeFile } = require("fs/promises");
const test = require("node:test");
const {
  AudioCache,
  DEFAULT_CAPACITY_BYTES,
  parseSingleRange,
} = require("../audioCache");

const BVID = "BV1ab411c7mD";

async function createCache(responseFactory) {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "listen2-audio-cache-"));
  const cache = new AudioCache({
    rootDir,
    session: { fetch: responseFactory },
    resolveBilibiliAudio: async () => ({
      id: 30280,
      codecs: "mp4a.40.2",
      label: "192K",
      mimeType: "audio/mp4",
      urlCandidates: ["https://cdn.example.test/audio.m4s"],
    }),
  });
  await cache.initialize();
  return { cache, rootDir };
}

test("audio cache writes only complete files and serves a single byte range", async () => {
  const { cache, rootDir } = await createCache(
    async () =>
      new Response(Buffer.from("abcdef"), {
        status: 200,
        headers: { "content-type": "audio/mp4", "content-length": "6" },
      })
  );
  try {
    assert.strictEqual(cache.status().capacityBytes, DEFAULT_CAPACITY_BYTES);
    assert.deepStrictEqual(
      await cache.schedule({
        trackId: "bitrack_v_BV1ab411c7mD-1",
        bvid: BVID,
        cid: 1,
        audioId: 30280,
        codecs: "mp4a.40.2",
      }),
      { ok: true, status: "queued" }
    );
    await cache.writeChain;
    const found = await cache.lookup({
      trackId: "bitrack_v_BV1ab411c7mD-1",
      bvid: BVID,
      cid: 1,
      preferredAudioId: 30280,
    });
    assert.strictEqual(found.hit, true);
    const response = await cache.handleProtocolRequest({
      url: found.entry.url,
      headers: new Headers({ range: "bytes=1-3" }),
    });
    assert.strictEqual(response.status, 206);
    assert.strictEqual(response.headers.get("content-range"), "bytes 1-3/6");
    assert.strictEqual(await response.text(), "bcd");
    await cache.writeChain;
  } finally {
    await rm(rootDir, { recursive: true, force: true, maxRetries: 3 });
  }
});

test("audio cache rejects incomplete content and never exposes it as ready", async () => {
  const { cache, rootDir } = await createCache(
    async () =>
      new Response(Buffer.from("abc"), {
        status: 200,
        headers: { "content-type": "audio/mp4", "content-length": "6" },
      })
  );
  try {
    await cache.schedule({
      trackId: "bitrack_v_BV1ab411c7mD-1",
      bvid: BVID,
      cid: 1,
      audioId: 30280,
    });
    await cache.writeChain;
    const result = await cache.lookup({
      trackId: "bitrack_v_BV1ab411c7mD-1",
      bvid: BVID,
      cid: 1,
    });
    assert.deepStrictEqual(result, { ok: true, hit: false });
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("default-page lookup without CID requires the exact track id and legacy audio has its own key", async () => {
  const { cache, rootDir } = await createCache(
    async () =>
      new Response(Buffer.from("abcdef"), {
        status: 200,
        headers: { "content-type": "audio/mp4", "content-length": "6" },
      })
  );
  try {
    const defaultTrackId = "bitrack_v_BV1ab411c7mD";
    await cache.schedule({
      trackId: defaultTrackId,
      bvid: BVID,
      cid: 1,
      audioId: 30280,
      codecs: "mp4a.40.2",
    });
    await cache.writeChain;

    const defaultHit = await cache.lookup({
      trackId: defaultTrackId,
      bvid: BVID,
      cid: 0,
    });
    assert.strictEqual(defaultHit.hit, true);
    const unresolvedPartTwo = await cache.lookup({
      trackId: "bitrack_v_BV1ab411c7mD-2",
      bvid: BVID,
      cid: 0,
    });
    assert.strictEqual(
      unresolvedPartTwo.hit,
      false,
      "a p>=2 track without a resolved CID must not reuse default-page audio"
    );

    await cache.schedule({
      trackId: "bitrack_123456",
      kind: "audio",
      sid: "123456",
    });
    await cache.writeChain;
    const legacyHit = await cache.lookup({
      trackId: "bitrack_123456",
      kind: "audio",
      sid: "123456",
    });
    assert.strictEqual(legacyHit.hit, true);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("range parser refuses malformed and multi ranges", () => {
  assert.deepStrictEqual(parseSingleRange("bytes=4-", 10), {
    start: 4,
    end: 9,
  });
  assert.deepStrictEqual(parseSingleRange("bytes=-4", 10), {
    start: 6,
    end: 9,
  });
  assert.strictEqual(parseSingleRange("bytes=0-1,3-4", 10), undefined);
  assert.strictEqual(parseSingleRange("bytes=11-12", 10), undefined);
});

test("disable and clear abort an active download and never publish READY", async () => {
  let abortCount = 0;
  let startDownload;
  const started = new Promise((resolve) => {
    startDownload = resolve;
  });
  const { cache, rootDir } = await createCache(async (url, options) => {
    let controller;
    const body = new ReadableStream({
      start(value) {
        controller = value;
        startDownload();
      },
    });
    options.signal.addEventListener("abort", () => {
      abortCount += 1;
      controller.error(
        Object.assign(new Error("aborted"), { name: "AbortError" })
      );
    });
    return new Response(body, {
      status: 200,
      headers: { "content-type": "audio/mp4" },
    });
  });
  const input = {
    trackId: "bitrack_v_BV1ab411c7mD-1",
    bvid: BVID,
    cid: 1,
    audioId: 30280,
  };
  try {
    await cache.schedule(input);
    await started;
    const disabled = await cache.configure({ enabled: false });
    assert.strictEqual(disabled.enabled, false);
    await cache.writeChain;
    assert.ok(abortCount >= 1);
    assert.strictEqual(
      (await cache.lookup({ trackId: input.trackId, bvid: BVID, cid: 1 })).hit,
      false
    );
    await cache.configure({ enabled: true });
    await cache.schedule(input);
    await started;
    await cache.clear();
    await cache.writeChain;
    assert.strictEqual(cache.status().readyEntries, 0);
  } finally {
    await rm(rootDir, { recursive: true, force: true, maxRetries: 3 });
  }
});

test("startup removes stale partial files and LRU never evicts a pinned entry", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "listen2-audio-cache-"));
  await mkdir(path.join(rootDir, "assets"));
  await writeFile(
    path.join(rootDir, "assets", `${"f".repeat(64)}.0011223344556677.part`),
    "partial"
  );
  const cache = new AudioCache({
    rootDir,
    session: { fetch() {} },
    resolveBilibiliAudio: async () => ({}),
  });
  try {
    await cache.initialize();
    assert.deepStrictEqual(await readdir(path.join(rootDir, "assets")), []);
    const oldKey = "a".repeat(64);
    const pinnedKey = "b".repeat(64);
    cache.index.settings.capacityBytes = 1024 * 1024 * 1024;
    cache.index.entries[oldKey] = {
      byteLength: 700 * 1024 * 1024,
      lastAccessedAt: 1,
    };
    cache.index.entries[pinnedKey] = {
      byteLength: 700 * 1024 * 1024,
      lastAccessedAt: 2,
    };
    cache.readers.set(pinnedKey, 1);
    await cache.evictToCapacity(128 * 1024 * 1024);
    assert.strictEqual(cache.index.entries[oldKey], undefined);
    assert.ok(cache.index.entries[pinnedKey]);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("bad MIME and oversized content are never cached", async () => {
  const cases = [
    () =>
      new Response("<html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    () =>
      new Response("", {
        status: 200,
        headers: {
          "content-type": "audio/mp4",
          "content-length": String(128 * 1024 * 1024 + 1),
        },
      }),
  ];
  for (const responseFactory of cases) {
    const { cache, rootDir } = await createCache(async () => responseFactory());
    try {
      await cache.schedule({
        trackId: "bitrack_v_BV1ab411c7mD-1",
        bvid: BVID,
        cid: 1,
        audioId: 30280,
      });
      await cache.writeChain;
      assert.strictEqual(cache.status().readyEntries, 0);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  }
});
