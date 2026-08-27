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

test("cache inventory exposes safe metadata, backfills history, and deletes by cache key", async () => {
  const { cache, rootDir } = await createCache(
    async () =>
      new Response(Buffer.from("abcdef"), {
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
      title: "Cached title",
      artist: "Cached artist",
      coverUrl: "https://images.example.test/cover.jpg",
      duration: 201,
    });
    await cache.writeChain;
    await cache.schedule({
      trackId: "bitrack_v_BV1ab411c7mD-2",
      bvid: BVID,
      cid: 2,
      audioId: 30280,
      coverUrl: "file:///private/cover.jpg",
    });
    await cache.writeChain;

    const inventory = cache.list({
      "bitrack_v_BV1ab411c7mD-2": {
        title: "History title",
        artist: "History artist",
        imgUrl: "https://images.example.test/history.jpg",
        duration: 180,
      },
    });
    assert.strictEqual(inventory.ok, true);
    assert.strictEqual(inventory.entries.length, 2);
    const cached = inventory.entries.find(
      (entry) => entry.title === "Cached title"
    );
    assert.strictEqual(cached.artist, "Cached artist");
    assert.strictEqual(cached.duration, 201);
    assert.strictEqual(
      Object.prototype.hasOwnProperty.call(cached, "stableKey"),
      false
    );
    const backfilled = inventory.entries.find(
      (entry) => entry.title === "History title"
    );
    assert.strictEqual(backfilled.artist, "History artist");
    assert.strictEqual(
      backfilled.coverUrl,
      "https://images.example.test/history.jpg"
    );
    assert.strictEqual((await cache.delete(backfilled.cacheKey)).removed, true);
    assert.strictEqual(cache.list().entries.length, 1);
  } finally {
    await rm(rootDir, { recursive: true, force: true, maxRetries: 3 });
  }
});

test("temporary audio is removed at exit while playlist and downloaded audio remain", async () => {
  const { cache, rootDir } = await createCache(
    async () =>
      new Response(Buffer.from("abcdef"), {
        status: 200,
        headers: { "content-type": "audio/mp4", "content-length": "6" },
      })
  );
  try {
    const inputs = [
      { cid: 1, trackId: `bitrack_v_${BVID}-1`, retention: "temporary" },
      { cid: 2, trackId: `bitrack_v_${BVID}-2`, retention: "playlist" },
      { cid: 3, trackId: `bitrack_v_${BVID}-3`, retention: "download" },
    ];
    for (const input of inputs) {
      await cache.schedule({
        ...input,
        bvid: BVID,
        audioId: 30280,
      });
      await cache.writeChain;
    }
    assert.strictEqual(cache.list().entries.length, 3);
    const cleanup = await cache.prepareForQuit();
    assert.strictEqual(cleanup.removedEntries, 1);
    assert.deepStrictEqual(
      cache
        .list()
        .entries.map((entry) => entry.retention)
        .sort(),
      ["download", "playlist"]
    );
    await cache.syncPlaylistTrackIds([]);
    assert.strictEqual(
      cache.list().entries.find((entry) => entry.downloaded).retention,
      "download"
    );
    assert.strictEqual(
      cache.list().entries.find((entry) => !entry.downloaded).retention,
      "temporary"
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true, maxRetries: 3 });
  }
});

test("automatic cleanup preserves a verified loudness profile for identical bytes", async () => {
  const { cache, rootDir } = await createCache(
    async () =>
      new Response(Buffer.from("abcdef"), {
        status: 200,
        headers: { "content-type": "audio/mp4", "content-length": "6" },
      })
  );
  try {
    cache.loudnessAnalyzer = {
      version: "test-analyzer-v1",
      cancel() {},
      shutdown() {},
    };
    const input = {
      trackId: `bitrack_v_${BVID}-1`,
      bvid: BVID,
      cid: 1,
      audioId: 30280,
      retention: "temporary",
    };
    await cache.schedule(input);
    await cache.writeChain;
    const [entry] = Object.values(cache.index.entries);
    const [cacheKey] = Object.keys(cache.index.entries);
    entry.loudness = {
      status: "ready",
      cacheKey,
      contentSha256: entry.sha256,
      analyzerVersion: "test-analyzer-v1",
      integratedLufs: -20,
      truePeakDbtp: -10,
      targetLufs: -14,
      truePeakCeilingDbtp: -1,
      gainDb: 6,
      sampleRate: 48000,
      channelCount: 2,
      durationSeconds: 120,
      analyzedAt: 1,
    };
    await cache.cleanupTemporary();
    assert.strictEqual(cache.status().readyEntries, 0);
    assert.ok(cache.index.loudnessArchive[cacheKey]);
    await cache.schedule(input);
    await cache.writeChain;
    assert.strictEqual(
      cache.index.entries[cacheKey].loudness.gainDb,
      6,
      "the profile must be restored only after the downloaded bytes hash matches"
    );
    assert.strictEqual(cache.index.loudnessArchive[cacheKey], undefined);
  } finally {
    await rm(rootDir, { recursive: true, force: true, maxRetries: 3 });
  }
});

test("explicit downloads work when automatic caching is disabled", async () => {
  const { cache, rootDir } = await createCache(
    async () =>
      new Response(Buffer.from("abcdef"), {
        status: 200,
        headers: { "content-type": "audio/mp4", "content-length": "6" },
      })
  );
  try {
    await cache.configure({ enabled: false });
    const base = {
      bvid: BVID,
      audioId: 30280,
    };
    assert.deepStrictEqual(
      await cache.schedule({
        ...base,
        trackId: `bitrack_v_${BVID}-1`,
        cid: 1,
        retention: "temporary",
      }),
      { ok: true, status: "disabled" }
    );
    assert.strictEqual(
      (
        await cache.schedule({
          ...base,
          trackId: `bitrack_v_${BVID}-2`,
          cid: 2,
          retention: "download",
        })
      ).status,
      "queued"
    );
    await cache.writeChain;
    assert.strictEqual(cache.list().entries[0].retention, "download");
  } finally {
    await rm(rootDir, { recursive: true, force: true, maxRetries: 3 });
  }
});

test("capacity eviction never removes explicit downloads", async () => {
  const { cache, rootDir } = await createCache(
    async () =>
      new Response(Buffer.from("abcdef"), {
        status: 200,
        headers: { "content-type": "audio/mp4", "content-length": "6" },
      })
  );
  try {
    for (const input of [
      { cid: 1, trackId: `bitrack_v_${BVID}-1`, retention: "playlist" },
      { cid: 2, trackId: `bitrack_v_${BVID}-2`, retention: "download" },
    ]) {
      await cache.schedule({ ...input, bvid: BVID, audioId: 30280 });
      await cache.writeChain;
    }
    const [playlistEntry] = Object.entries(cache.index.entries).find(
      ([, entry]) => entry.retention === "playlist"
    );
    const [downloadEntry] = Object.entries(cache.index.entries).find(
      ([, entry]) => entry.retention === "download"
    );
    cache.index.entries[playlistEntry].byteLength = 700 * 1024 * 1024;
    cache.index.entries[downloadEntry].byteLength = 700 * 1024 * 1024;
    cache.index.settings.capacityBytes = 1024 * 1024 * 1024;
    await cache.evictToCapacity(128 * 1024 * 1024);
    assert.strictEqual(cache.index.entries[playlistEntry], undefined);
    assert.ok(cache.index.entries[downloadEntry]);
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
