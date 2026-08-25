const assert = require("assert");
const { createHash } = require("crypto");
const os = require("os");
const path = require("path");
const { mkdtemp, mkdir, readFile, rm, writeFile } = require("fs/promises");
const test = require("node:test");
const {
  AudioCache,
  DEFAULT_CAPACITY_BYTES,
  stableAudioKey,
} = require("../audioCache");
const { ANALYZER_VERSION } = require("../loudnessAnalyzerRenderer");

const BVID = "BV1ab411c7mD";
const TRACK_ID = "bitrack_v_BV1ab411c7mD-1";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function successfulResult() {
  return {
    integratedLufs: -18,
    truePeakDbtp: -2,
    targetLufs: -14,
    truePeakCeilingDbtp: -1,
    gainDb: 1,
    sampleRate: 48000,
    channelCount: 2,
    durationSeconds: 120,
  };
}

class DeferredAnalyzer {
  constructor() {
    this.version = ANALYZER_VERSION;
    this.calls = [];
    this.pending = [];
  }

  analyze(input) {
    this.calls.push(input);
    return new Promise((resolve, reject) => {
      this.pending.push({ input, resolve, reject });
    });
  }

  cancel(cacheKey) {
    const kept = [];
    for (const item of this.pending) {
      if (item.input.cacheKey === cacheKey) {
        item.reject(
          Object.assign(new Error("cancelled"), { code: "analysis-cancelled" })
        );
      } else {
        kept.push(item);
      }
    }
    this.pending = kept;
  }

  cancelAll() {
    for (const item of this.pending.splice(0)) {
      item.reject(
        Object.assign(new Error("cancelled"), { code: "analysis-cancelled" })
      );
    }
  }

  resolveNext(result = successfulResult()) {
    const item = this.pending.shift();
    assert.ok(item, "expected a queued loudness analysis");
    item.resolve(result);
  }

  rejectNext(code = "decode-or-analysis-failed") {
    const item = this.pending.shift();
    assert.ok(item, "expected a queued loudness analysis");
    item.reject(Object.assign(new Error(code), { code }));
  }
}

async function nextTurn() {
  await new Promise((resolve) => setImmediate(resolve));
}

async function createCache(analyzer) {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "listen2-loudness-cache-")
  );
  const cache = new AudioCache({
    rootDir,
    session: {
      fetch: async () =>
        new Response(Buffer.from("complete-audio"), {
          status: 200,
          headers: {
            "content-type": "audio/mp4",
            "content-length": "14",
          },
        }),
    },
    resolveBilibiliAudio: async () => ({
      id: 30280,
      codecs: "mp4a.40.2",
      label: "192K",
      mimeType: "audio/mp4",
      urlCandidates: ["https://cdn.example.test/audio.m4s"],
    }),
    loudnessAnalyzer: analyzer,
  });
  await cache.initialize();
  return { cache, rootDir };
}

function scheduleInput() {
  return {
    trackId: TRACK_ID,
    bvid: BVID,
    cid: 1,
    audioId: 30280,
    codecs: "mp4a.40.2",
  };
}

async function lookup(cache) {
  return cache.lookup({ trackId: TRACK_ID, bvid: BVID, cid: 1 });
}

test("download becomes READY before background analysis and later exposes bound loudness", async () => {
  const analyzer = new DeferredAnalyzer();
  const { cache, rootDir } = await createCache(analyzer);
  try {
    await cache.schedule(scheduleInput());
    await cache.writeChain;
    await nextTurn();
    const readyBeforeAnalysis = await lookup(cache);
    assert.strictEqual(readyBeforeAnalysis.hit, true);
    assert.strictEqual(readyBeforeAnalysis.entry.loudness, null);
    assert.strictEqual(cache.status().loudnessPendingEntries, 1);
    assert.strictEqual(analyzer.calls.length, 1);

    analyzer.resolveNext();
    await cache.waitForLoudnessIdle();
    const analyzed = await lookup(cache);
    assert.strictEqual(analyzed.hit, true);
    assert.strictEqual(analyzed.entry.loudness.status, "ready");
    assert.strictEqual(
      analyzed.entry.loudness.cacheKey,
      analyzed.entry.cacheKey
    );
    assert.strictEqual(
      analyzed.entry.loudness.contentSha256,
      sha256(Buffer.from("complete-audio"))
    );
    assert.strictEqual(
      analyzed.entry.loudness.analyzerVersion,
      ANALYZER_VERSION
    );
    assert.strictEqual(analyzed.entry.loudness.gainDb, 1);
    assert.strictEqual(cache.status().loudnessReadyEntries, 1);

    await cache.configure({ loudnessNormalizationEnabled: false });
    assert.strictEqual((await lookup(cache)).entry.loudness, null);
    await cache.configure({ loudnessNormalizationEnabled: true });
    assert.strictEqual((await lookup(cache)).entry.loudness.status, "ready");
    assert.strictEqual(
      analyzer.calls.length,
      1,
      "re-enabling must reuse the persisted current-version result"
    );
  } finally {
    analyzer.cancelAll();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("disable prevents new analysis and re-enable scans missing READY entries", async () => {
  const analyzer = new DeferredAnalyzer();
  const { cache, rootDir } = await createCache(analyzer);
  try {
    const disabled = await cache.configure({
      loudnessNormalizationEnabled: false,
    });
    assert.strictEqual(disabled.loudnessNormalizationEnabled, false);
    await cache.schedule(scheduleInput());
    await cache.writeChain;
    await nextTurn();
    assert.strictEqual(analyzer.calls.length, 0);
    assert.strictEqual((await lookup(cache)).hit, true);

    const enabled = await cache.configure({
      loudnessNormalizationEnabled: true,
    });
    assert.strictEqual(enabled.loudnessNormalizationEnabled, true);
    assert.strictEqual(enabled.loudnessPendingEntries, 1);
    await nextTurn();
    assert.strictEqual(analyzer.calls.length, 1);
    analyzer.resolveNext();
    await cache.waitForLoudnessIdle();
    assert.strictEqual((await lookup(cache)).entry.loudness.status, "ready");
  } finally {
    analyzer.cancelAll();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("analysis failure is persisted but never removes cache READY", async () => {
  const analyzer = new DeferredAnalyzer();
  const { cache, rootDir } = await createCache(analyzer);
  try {
    await cache.schedule(scheduleInput());
    await cache.writeChain;
    await nextTurn();
    analyzer.rejectNext("decode-or-analysis-failed");
    await cache.waitForLoudnessIdle();
    const found = await lookup(cache);
    assert.strictEqual(found.hit, true);
    assert.strictEqual(found.entry.loudness.status, "failed");
    assert.strictEqual(
      found.entry.loudness.errorCode,
      "decode-or-analysis-failed"
    );
    assert.strictEqual(cache.status().readyEntries, 1);
    assert.strictEqual(cache.status().loudnessFailedEntries, 1);
  } finally {
    analyzer.cancelAll();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("delete and clear remove the entry-bound loudness result", async () => {
  const analyzer = new DeferredAnalyzer();
  const { cache, rootDir } = await createCache(analyzer);
  try {
    await cache.schedule(scheduleInput());
    await cache.writeChain;
    await nextTurn();
    analyzer.resolveNext();
    await cache.waitForLoudnessIdle();
    const found = await lookup(cache);
    assert.strictEqual(found.entry.loudness.status, "ready");
    assert.strictEqual(
      (await cache.delete(found.entry.cacheKey)).removed,
      true
    );
    assert.strictEqual((await lookup(cache)).hit, false);

    await cache.schedule(scheduleInput());
    await cache.writeChain;
    await nextTurn();
    analyzer.resolveNext();
    await cache.waitForLoudnessIdle();
    assert.strictEqual((await cache.clear()).removedEntries, 1);
    assert.strictEqual(cache.status().readyEntries, 0);
    assert.strictEqual(cache.status().loudnessReadyEntries, 0);
  } finally {
    analyzer.cancelAll();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("v1 cache index migrates missing loudness settings and backfills in place", async () => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), "listen2-loudness-migration-")
  );
  const assetsDir = path.join(rootDir, "assets");
  await mkdir(assetsDir);
  const stableKey = stableAudioKey(scheduleInput());
  const cacheKey = sha256(stableKey);
  const bytes = Buffer.from("legacy-ready-audio");
  await writeFile(path.join(assetsDir, `${cacheKey}.m4s`), bytes);
  await writeFile(
    path.join(rootDir, "index-v1.json"),
    JSON.stringify({
      version: 1,
      settings: { enabled: true, capacityBytes: DEFAULT_CAPACITY_BYTES },
      entries: {
        [cacheKey]: {
          stableKey,
          kind: "video",
          bvid: BVID,
          cid: 1,
          sid: "",
          audioId: 30280,
          codecs: "mp4a.40.2",
          mimeType: "audio/mp4",
          bitrate: "192K",
          byteLength: bytes.length,
          sha256: sha256(bytes),
          cachedAt: 1,
          lastAccessedAt: 1,
          trackIds: [TRACK_ID],
        },
      },
    })
  );
  const analyzer = new DeferredAnalyzer();
  const cache = new AudioCache({
    rootDir,
    session: { fetch() {} },
    resolveBilibiliAudio: async () => ({}),
    loudnessAnalyzer: analyzer,
  });
  try {
    await cache.initialize();
    assert.strictEqual(cache.status().loudnessNormalizationEnabled, true);
    assert.strictEqual(cache.status().loudnessPendingEntries, 1);
    await nextTurn();
    analyzer.resolveNext();
    await cache.waitForLoudnessIdle();
    const persisted = JSON.parse(
      await readFile(path.join(rootDir, "index-v1.json"), "utf8")
    );
    assert.strictEqual(persisted.settings.loudnessNormalizationEnabled, true);
    assert.strictEqual(persisted.entries[cacheKey].loudness.status, "ready");
    assert.strictEqual(
      persisted.entries[cacheKey].loudness.contentSha256,
      sha256(bytes)
    );
  } finally {
    analyzer.cancelAll();
    await rm(rootDir, { recursive: true, force: true });
  }
});
