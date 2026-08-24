const { createHash, randomBytes } = require("crypto");
const fsp = require("fs/promises");
const path = require("path");

const INDEX_VERSION = 3;
const MAX_TRACK_ID_LENGTH = 256;
const MAX_LYRIC_LENGTH = 512 * 1024;
const MAX_RECORDS_PER_MIGRATION = 200;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeString(value, maxLength) {
  const result = typeof value === "string" ? value : "";
  return result.length <= maxLength ? result : "";
}

function safeTrackId(value) {
  const id = safeString(value, MAX_TRACK_ID_LENGTH).trim();
  return id && !/^(?:__proto__|prototype|constructor)$/i.test(id) ? id : "";
}

function safeRevision(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function lyricHash(value) {
  return createHash("sha256")
    .update(String(value || ""))
    .digest("hex");
}

function sanitizeMatchedTrack(value) {
  if (!isPlainObject(value)) return undefined;
  const duration = Number(value.duration);
  const result = {
    title: safeString(value.title || "", 300),
    artist: safeString(value.artist || "", 300),
    album: safeString(value.album || "", 300),
    provider: safeString(value.provider || "", 80),
    candidateId: safeString(value.candidateId || value.id || "", 256),
  };
  if (Number.isFinite(duration) && duration >= 0 && duration <= 86400) {
    result.duration = duration;
  }
  return Object.values(result).some(Boolean) || result.duration !== undefined
    ? result
    : undefined;
}

class LyricCacheStore {
  constructor({ rootDir, now = () => Date.now() }) {
    this.rootDir = rootDir;
    this.indexPath = path.join(rootDir, "lyric-cache-v3.json");
    this.now = now;
    this.index = { version: INDEX_VERSION, records: Object.create(null) };
    this.writeChain = Promise.resolve();
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;
    await fsp.mkdir(this.rootDir, { recursive: true, mode: 0o700 });
    try {
      const parsed = JSON.parse(await fsp.readFile(this.indexPath, "utf8"));
      if (
        isPlainObject(parsed) &&
        Number(parsed.version) === INDEX_VERSION &&
        isPlainObject(parsed.records)
      ) {
        for (const trackId of Object.keys(parsed.records)) {
          const record = this.sanitizeRecord(trackId, parsed.records[trackId]);
          if (record) this.index.records[trackId] = record;
        }
      }
    } catch (error) {
      // An absent/corrupt cache is treated as empty; never partially recover it.
    }
    this.initialized = true;
  }

  serialize(operation) {
    const next = this.writeChain.then(operation, operation);
    this.writeChain = next.catch(() => {});
    return next;
  }

  async persist() {
    const temporary = `${this.indexPath}.${randomBytes(8).toString("hex")}.tmp`;
    await fsp.writeFile(temporary, JSON.stringify(this.index), { mode: 0o600 });
    const handle = await fsp.open(temporary, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fsp.rename(temporary, this.indexPath);
  }

  sanitizeTranslation(value) {
    if (!isPlainObject(value)) return null;
    const lyricHash = safeString(value.lyricHash, 128);
    const tlyric = safeString(value.tlyric, MAX_LYRIC_LENGTH);
    const provider = safeString(value.provider, 80);
    const hasCacheKey = Object.prototype.hasOwnProperty.call(value, "cacheKey");
    const cacheKey = hasCacheKey ? safeString(value.cacheKey, 64) : "";
    if (
      !lyricHash ||
      !tlyric ||
      !provider ||
      (hasCacheKey && !/^[a-f0-9]{64}$/.test(cacheKey))
    )
      return null;
    const translation = {
      lyricHash,
      tlyric,
      provider,
      model: safeString(value.model || "", 120),
      promptVersion: safeString(value.promptVersion || "", 120),
      translatedAt: Number(value.translatedAt) || this.now(),
    };
    if (cacheKey) translation.cacheKey = cacheKey;
    return translation;
  }

  sanitizeRecord(trackId, value) {
    const id = safeTrackId(trackId);
    if (!id || !isPlainObject(value)) return null;
    const mode =
      value.mode === "manual" ? "manual" : value.mode === "auto" ? "auto" : "";
    const lyric = safeString(value.lyric, MAX_LYRIC_LENGTH);
    if (!mode || !lyric) return null;
    const translations = Object.create(null);
    const expectedLyricHash = lyricHash(lyric);
    if (isPlainObject(value.translations)) {
      for (const key of Object.keys(value.translations)) {
        if (key !== expectedLyricHash) continue;
        const translation = this.sanitizeTranslation(value.translations[key]);
        if (translation) translations[key] = translation;
      }
    }
    return {
      trackId: id,
      canonicalKey: safeString(value.canonicalKey || "", MAX_TRACK_ID_LENGTH),
      revision: safeRevision(value.revision) || 1,
      mode,
      lyric,
      tlyric: safeString(value.tlyric || "", MAX_LYRIC_LENGTH),
      source: safeString(value.source || "", 160),
      matchedTrack: sanitizeMatchedTrack(value.matchedTrack),
      updatedAt: Number(value.updatedAt) || this.now(),
      expiresAt: Number(value.expiresAt) || undefined,
      manualLocked: mode === "manual",
      translations,
    };
  }

  async get({ trackId, canonicalKey } = {}) {
    await this.initialize();
    const ids = [safeTrackId(trackId), safeTrackId(canonicalKey)].filter(
      Boolean
    );
    if (!ids.length) return { ok: false, status: "invalid-input" };
    const record = ids.map((id) => this.index.records[id]).find(Boolean);
    return { ok: true, record: record ? clone(record) : null };
  }

  async put({ trackId, expectedRevision, mode, record } = {}) {
    await this.initialize();
    const id = safeTrackId(trackId);
    const expected = safeRevision(expectedRevision);
    if (
      !id ||
      expected === null ||
      (mode !== "auto" && mode !== "manual") ||
      !isPlainObject(record)
    ) {
      return { ok: false, status: "invalid-input" };
    }
    return this.serialize(async () => {
      const current = this.index.records[id];
      const currentRevision = current ? current.revision : 0;
      if (expected !== currentRevision) {
        return {
          ok: false,
          status: "stale-revision",
          currentRevision,
          record: current ? clone(current) : null,
        };
      }
      if (current && current.manualLocked && mode !== "manual") {
        return { ok: false, status: "manual-locked", record: clone(current) };
      }
      const incomingTranslations = isPlainObject(record.translations)
        ? record.translations
        : {};
      const preserveTranslations =
        current && lyricHash(current.lyric) === lyricHash(record.lyric)
          ? current.translations
          : {};
      const next = this.sanitizeRecord(id, {
        ...record,
        trackId: id,
        mode,
        revision: currentRevision + 1,
        updatedAt: this.now(),
        manualLocked: mode === "manual",
        translations: { ...preserveTranslations, ...incomingTranslations },
      });
      if (!next) return { ok: false, status: "invalid-record" };
      this.index.records[id] = next;
      await this.persist();
      return { ok: true, revision: next.revision, record: clone(next) };
    });
  }

  async attachTranslation({ trackId, expectedRevision, translation } = {}) {
    await this.initialize();
    const id = safeTrackId(trackId);
    const expected = safeRevision(expectedRevision);
    const cleanTranslation = this.sanitizeTranslation(translation);
    if (!id || expected === null || !cleanTranslation)
      return { ok: false, status: "invalid-input" };
    return this.serialize(async () => {
      const current = this.index.records[id];
      if (!current) return { ok: false, status: "not-found" };
      if (current.revision !== expected) {
        return {
          ok: false,
          status: "stale-revision",
          currentRevision: current.revision,
          record: clone(current),
        };
      }
      if (cleanTranslation.lyricHash !== lyricHash(current.lyric)) {
        return {
          ok: false,
          status: "lyric-hash-mismatch",
          record: clone(current),
        };
      }
      current.translations[cleanTranslation.lyricHash] = cleanTranslation;
      current.revision += 1;
      current.updatedAt = this.now();
      await this.persist();
      return { ok: true, revision: current.revision, record: clone(current) };
    });
  }

  async clear({ trackId, expectedRevision } = {}) {
    await this.initialize();
    const id = safeTrackId(trackId);
    const expected =
      typeof expectedRevision === "undefined"
        ? null
        : safeRevision(expectedRevision);
    if (!id || (typeof expectedRevision !== "undefined" && expected === null)) {
      return { ok: false, status: "invalid-input" };
    }
    return this.serialize(async () => {
      const current = this.index.records[id];
      if (!current) return { ok: true, removed: false };
      if (expected !== null && current.revision !== expected) {
        return {
          ok: false,
          status: "stale-revision",
          currentRevision: current.revision,
          record: clone(current),
        };
      }
      delete this.index.records[id];
      await this.persist();
      return { ok: true, removed: true };
    });
  }

  async migrateLegacyManual({ records } = {}) {
    await this.initialize();
    if (!Array.isArray(records) || records.length > MAX_RECORDS_PER_MIGRATION) {
      return { ok: false, status: "invalid-input" };
    }
    return this.serialize(async () => {
      let migrated = 0;
      let skipped = 0;
      for (const item of records) {
        const id = safeTrackId(item && item.trackId);
        if (!id || !isPlainObject(item.record)) {
          skipped += 1;
          continue;
        }
        const existing = this.index.records[id];
        if (existing) {
          skipped += 1;
          continue;
        }
        const record = this.sanitizeRecord(id, {
          ...item.record,
          mode: "manual",
          revision: 1,
          manualLocked: true,
          updatedAt: this.now(),
        });
        if (!record) {
          skipped += 1;
          continue;
        }
        this.index.records[id] = record;
        migrated += 1;
      }
      if (migrated) await this.persist();
      return { ok: true, migrated, skipped };
    });
  }
}

module.exports = { LyricCacheStore, MAX_RECORDS_PER_MIGRATION };
