const assert = require("assert");
const os = require("os");
const path = require("path");
const { mkdtemp, rm } = require("fs/promises");
const test = require("node:test");
const { LyricCacheStore } = require("../lyricCacheStore");

const hash = (value) =>
  require("crypto").createHash("sha256").update(value).digest("hex");

test("manual lyric is authoritative and revisions prevent stale auto writes", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "listen2-lyric-cache-"));
  const store = new LyricCacheStore({ rootDir, now: () => 1000 });
  try {
    const manual = await store.put({
      trackId: "bitrack_v_BV1ab411c7mD-1",
      expectedRevision: 0,
      mode: "manual",
      record: { lyric: "[00:00.00]manual", source: "manual" },
    });
    assert.strictEqual(manual.ok, true);
    assert.strictEqual(manual.record.manualLocked, true);
    const auto = await store.put({
      trackId: manual.record.trackId,
      expectedRevision: manual.revision,
      mode: "auto",
      record: { lyric: "[00:00.00]auto", source: "remote" },
    });
    assert.strictEqual(auto.status, "manual-locked");
    const stale = await store.attachTranslation({
      trackId: manual.record.trackId,
      expectedRevision: 0,
      translation: {
        lyricHash: hash("[00:00.00]manual"),
        tlyric: "译文",
        provider: "deepseek",
      },
    });
    assert.strictEqual(stale.status, "stale-revision");
    const attached = await store.attachTranslation({
      trackId: manual.record.trackId,
      expectedRevision: manual.revision,
      translation: {
        lyricHash: hash("[00:00.00]manual"),
        tlyric: "译文",
        provider: "deepseek",
      },
    });
    assert.strictEqual(attached.ok, true);
    assert.strictEqual(
      attached.record.translations[hash("[00:00.00]manual")].tlyric,
      "译文"
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("lyrics reject wrong translation hashes, clear stale translations, and migrate idempotently", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "listen2-lyric-cache-"));
  const store = new LyricCacheStore({ rootDir });
  const trackId = "bitrack_v_BV1ab411c7mD-1";
  try {
    const first = await store.put({
      trackId,
      expectedRevision: 0,
      mode: "auto",
      record: { lyric: "one", source: "a" },
    });
    const wrong = await store.attachTranslation({
      trackId,
      expectedRevision: first.revision,
      translation: {
        lyricHash: hash("other"),
        tlyric: "wrong",
        provider: "deepseek",
      },
    });
    assert.strictEqual(wrong.status, "lyric-hash-mismatch");
    const invalidCacheKey = await store.attachTranslation({
      trackId,
      expectedRevision: first.revision,
      translation: {
        lyricHash: hash("one"),
        tlyric: "wrong cache key",
        provider: "deepseek",
        cacheKey: "not-a-hash",
      },
    });
    assert.strictEqual(invalidCacheKey.status, "invalid-input");
    const attached = await store.attachTranslation({
      trackId,
      expectedRevision: first.revision,
      translation: {
        lyricHash: hash("one"),
        tlyric: "one zh",
        provider: "deepseek",
      },
    });
    const changed = await store.put({
      trackId,
      expectedRevision: attached.revision,
      mode: "manual",
      record: { lyric: "two", source: "manual" },
    });
    assert.deepStrictEqual(changed.record.translations, {});
    const records = Array.from({ length: 81 }, (_, index) => ({
      trackId: `bitrack_v_BV1ab411c7mD-${index + 100}`,
      record: { lyric: `l${index}`, source: "legacy" },
    }));
    const migrated = await store.migrateLegacyManual({ records });
    assert.strictEqual(migrated.migrated, 81);
    assert.strictEqual(
      (await store.migrateLegacyManual({ records })).migrated,
      0
    );
    assert.strictEqual(
      (await store.get({ trackId: records[80].trackId })).record.mode,
      "manual"
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("DeepSeek v2 translation fingerprints are validated and persisted", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "listen2-lyric-cache-"));
  const trackId = "bitrack_v_BV1ab411c7mD-2";
  const lyric = "source lyric";
  const promptFingerprint = "a".repeat(64);
  const cacheKey = "b".repeat(64);
  try {
    const store = new LyricCacheStore({ rootDir, now: () => 2000 });
    const first = await store.put({
      trackId,
      expectedRevision: 0,
      mode: "auto",
      record: {
        lyric,
        tlyric: "source translation",
        source: "remote",
        matchedTrack: {
          title: "source title",
          translationProvider: "netease",
          translationEnriched: true,
          machineTranslated: false,
        },
      },
    });

    const missingFingerprint = await store.attachTranslation({
      trackId,
      expectedRevision: first.revision,
      translation: {
        lyricHash: hash(lyric),
        tlyric: "machine translation",
        provider: "deepseek",
        promptVersion: "deepseek-lyrics-v2",
      },
    });
    assert.strictEqual(missingFingerprint.status, "invalid-input");

    const missingFingerprintWithMixedCaseProvider =
      await store.attachTranslation({
        trackId,
        expectedRevision: first.revision,
        translation: {
          lyricHash: hash(lyric),
          tlyric: "machine translation",
          provider: "DeepSeek",
          promptVersion: "deepseek-lyrics-v2",
        },
      });
    assert.strictEqual(
      missingFingerprintWithMixedCaseProvider.status,
      "invalid-input"
    );

    const malformedFingerprint = await store.attachTranslation({
      trackId,
      expectedRevision: first.revision,
      translation: {
        lyricHash: hash(lyric),
        tlyric: "machine translation",
        provider: "deepseek",
        promptVersion: "deepseek-lyrics-v2",
        promptFingerprint: "A".repeat(64),
      },
    });
    assert.strictEqual(malformedFingerprint.status, "invalid-input");

    const attached = await store.attachTranslation({
      trackId,
      expectedRevision: first.revision,
      translation: {
        lyricHash: hash(lyric),
        tlyric: "machine translation",
        provider: "deepseek",
        promptVersion: "deepseek-lyrics-v2",
        promptFingerprint,
        cacheKey,
      },
    });
    assert.strictEqual(attached.ok, true);
    assert.strictEqual(
      attached.record.translations[hash(lyric)].promptFingerprint,
      promptFingerprint
    );
    assert.strictEqual(
      attached.record.translations[hash(lyric)].cacheKey,
      cacheKey
    );

    const reopened = new LyricCacheStore({ rootDir });
    const persisted = await reopened.get({ trackId });
    assert.strictEqual(persisted.ok, true);
    assert.strictEqual(
      persisted.record.translations[hash(lyric)].promptFingerprint,
      promptFingerprint
    );
    assert.strictEqual(
      persisted.record.translations[hash(lyric)].cacheKey,
      cacheKey,
      "adding the prompt fingerprint must not discard the local-data cache key"
    );
    assert.strictEqual(
      persisted.record.matchedTrack.translationProvider,
      "netease"
    );
    assert.strictEqual(
      persisted.record.matchedTrack.translationEnriched,
      true,
      "source translation metadata must survive an application restart"
    );
    assert.strictEqual(persisted.record.matchedTrack.machineTranslated, false);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
