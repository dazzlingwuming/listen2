const { createHash, randomBytes } = require("crypto");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { Readable, Transform } = require("stream");
const { pipeline } = require("stream/promises");

const GIB = 1024 * 1024 * 1024;
const DEFAULT_CAPACITY_BYTES = 2 * GIB;
const ALLOWED_CAPACITIES = new Set([GIB, 2 * GIB, 5 * GIB, 10 * GIB]);
const MAX_ENTRY_BYTES = 128 * 1024 * 1024;
const MAX_TRACK_ID_LENGTH = 256;
const MAX_TITLE_LENGTH = 500;
const MAX_ARTIST_LENGTH = 500;
const MAX_COVER_URL_LENGTH = 2000;
const CACHE_SCHEME = "listen2-cache";
const INDEX_VERSION = 1;
const MAX_ANALYZER_VERSION_LENGTH = 96;
const MAX_LOUDNESS_ERROR_LENGTH = 80;
const CACHE_RETENTIONS = new Set(["temporary", "playlist", "download"]);
const NORMALIZATION_TARGET_LUFS = -14;
const TRUE_PEAK_CEILING_DBTP = -1;
const MIN_NORMALIZATION_GAIN_DB = -24;
const MAX_NORMALIZATION_GAIN_DB = 12;
const MAX_LOUDNESS_ATTEMPTS = 3;
const LOUDNESS_RETRY_DELAY_MS = 30 * 1000;
const TRANSIENT_LOUDNESS_ERRORS = new Set([
  "analysis-timeout",
  "analyzer-page-failed",
  "analyzer-renderer-gone",
  "analyzer-ipc-failed",
  "decode-or-analysis-failed",
  "analysis-failed",
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeString(value, maxLength) {
  const result = typeof value === "string" ? value.trim() : "";
  return result && result.length <= maxLength ? result : "";
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}

function safeCacheKey(value) {
  return /^[a-f0-9]{64}$/.test(String(value || "")) ? String(value) : "";
}

function safeRetention(value, fallback = "playlist") {
  return CACHE_RETENTIONS.has(value) ? value : fallback;
}

function safeRemoteUrl(value) {
  const text = safeString(value, MAX_COVER_URL_LENGTH);
  if (!text) return "";
  try {
    const url = new URL(text);
    return url.protocol === "https:" || url.protocol === "http:" ? text : "";
  } catch (error) {
    return "";
  }
}

function displayMetadata(value = {}) {
  return {
    title: safeString(value.title, MAX_TITLE_LENGTH),
    artist: safeString(value.artist, MAX_ARTIST_LENGTH),
    coverUrl: safeRemoteUrl(
      value.coverUrl || value.imgUrl || value.img_url || ""
    ),
    duration: finiteNumber(value.duration, 0, 24 * 60 * 60) || 0,
  };
}

function stableAudioKey({ bvid, cid, audioId, codecs, kind, sid }) {
  if (kind === "audio") {
    const safeSid = safeString(sid, 32);
    return /^\d+$/.test(safeSid) ? `bilibili:audio:${safeSid}` : "";
  }
  const safeBvid = safeString(bvid, 64);
  const safeCid = positiveInteger(cid);
  const safeAudioId = positiveInteger(audioId);
  const safeCodecs = safeString(codecs || "", 160);
  if (!/^BV[0-9A-Za-z]{10}$/.test(safeBvid) || !safeCid || !safeAudioId) {
    return "";
  }
  return `bilibili:video:${safeBvid}:${safeCid}:audio:${safeAudioId}:${safeCodecs}`;
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function mimeTypeAllowed(value) {
  const mime = String(value || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  return (
    mime.startsWith("audio/") ||
    mime.startsWith("video/") ||
    mime === "application/octet-stream" ||
    mime === "application/mp4"
  );
}

function parseSingleRange(value, size) {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(String(value).trim());
  if (!match || (!match[1] && !match[2])) return undefined;
  let start;
  let end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return undefined;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
  }
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start >= size ||
    end < start
  ) {
    return undefined;
  }
  return { start, end: Math.min(end, size - 1) };
}

function finiteNumber(value, minimum, maximum) {
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum && number <= maximum
    ? number
    : null;
}

function sanitizeLoudness(value, cacheKey, contentSha256) {
  if (!isPlainObject(value)) return null;
  const analyzerVersion = safeString(
    value.analyzerVersion,
    MAX_ANALYZER_VERSION_LENGTH
  );
  if (
    value.cacheKey !== cacheKey ||
    value.contentSha256 !== contentSha256 ||
    !analyzerVersion
  ) {
    return null;
  }
  const analyzedAt = Number(value.analyzedAt);
  if (!Number.isFinite(analyzedAt) || analyzedAt <= 0) return null;
  if (value.status === "failed") {
    const errorCode = safeString(value.errorCode, MAX_LOUDNESS_ERROR_LENGTH);
    if (!errorCode) return null;
    const retryable = TRANSIENT_LOUDNESS_ERRORS.has(errorCode);
    const retryAttempts = Math.min(
      MAX_LOUDNESS_ATTEMPTS,
      positiveInteger(value.retryAttempts) || 1
    );
    return {
      status: "failed",
      cacheKey,
      contentSha256,
      analyzerVersion,
      errorCode,
      analyzedAt,
      retryable,
      retryAttempts,
      retryExhausted: retryable && retryAttempts >= MAX_LOUDNESS_ATTEMPTS,
      retryAfter:
        retryable && retryAttempts < MAX_LOUDNESS_ATTEMPTS
          ? Math.max(
              analyzedAt + LOUDNESS_RETRY_DELAY_MS,
              Number.isFinite(value.retryAfter) ? value.retryAfter : 0
            )
          : null,
    };
  }
  if (value.status !== "ready") return null;
  const integratedLufs = finiteNumber(value.integratedLufs, -100, 24);
  const truePeakDbtp = finiteNumber(value.truePeakDbtp, -200, 24);
  const targetLufs = finiteNumber(value.targetLufs, -40, 0);
  const truePeakCeilingDbtp = finiteNumber(value.truePeakCeilingDbtp, -20, 0);
  const gainDb = finiteNumber(
    value.gainDb,
    MIN_NORMALIZATION_GAIN_DB,
    MAX_NORMALIZATION_GAIN_DB
  );
  const sampleRate = positiveInteger(value.sampleRate);
  const channelCount = positiveInteger(value.channelCount);
  const durationSeconds = finiteNumber(value.durationSeconds, 0, 24 * 60 * 60);
  if (
    integratedLufs === null ||
    truePeakDbtp === null ||
    targetLufs === null ||
    truePeakCeilingDbtp === null ||
    gainDb === null ||
    !sampleRate ||
    !channelCount ||
    durationSeconds === null
  ) {
    return null;
  }
  const expectedGainDb =
    Math.round(
      Math.max(
        MIN_NORMALIZATION_GAIN_DB,
        Math.min(
          MAX_NORMALIZATION_GAIN_DB,
          NORMALIZATION_TARGET_LUFS - integratedLufs,
          TRUE_PEAK_CEILING_DBTP - truePeakDbtp
        )
      ) * 100
    ) / 100;
  if (
    targetLufs !== NORMALIZATION_TARGET_LUFS ||
    truePeakCeilingDbtp !== TRUE_PEAK_CEILING_DBTP ||
    Math.abs(gainDb - expectedGainDb) > 0.011
  ) {
    return null;
  }
  return {
    status: "ready",
    cacheKey,
    contentSha256,
    analyzerVersion,
    integratedLufs,
    truePeakDbtp,
    targetLufs,
    truePeakCeilingDbtp,
    gainDb,
    sampleRate,
    channelCount,
    durationSeconds,
    analyzedAt,
  };
}

class AudioCache {
  constructor({
    rootDir,
    session,
    resolveBilibiliAudio,
    loudnessAnalyzer = null,
    now = () => Date.now(),
  }) {
    this.rootDir = rootDir;
    this.assetsDir = path.join(rootDir, "assets");
    this.indexPath = path.join(rootDir, "index-v1.json");
    this.session = session;
    this.resolveBilibiliAudio = resolveBilibiliAudio;
    this.loudnessAnalyzer = loudnessAnalyzer;
    this.now = now;
    this.index = this.emptyIndex();
    this.jobs = new Map();
    this.failedJobs = new Map();
    this.downloadChain = Promise.resolve();
    this.loudnessJobs = new Map();
    this.readers = new Map();
    this.indexWriteChain = Promise.resolve();
    this.lastError = "";
    this.initialized = false;
  }

  emptyIndex() {
    return {
      version: INDEX_VERSION,
      settings: {
        enabled: true,
        capacityBytes: DEFAULT_CAPACITY_BYTES,
        loudnessNormalizationEnabled: true,
      },
      entries: Object.create(null),
      loudnessArchive: Object.create(null),
    };
  }

  async initialize() {
    if (this.initialized) return;
    if (!this.initializing) {
      this.initializing = (async () => {
        await fsp.mkdir(this.assetsDir, { recursive: true, mode: 0o700 });
        this.index = await this.readIndex();
        await this.cleanupDisk();
        this.initialized = true;
        await this.cleanupTemporary();
        this.scheduleMissingLoudness();
      })().finally(() => {
        this.initializing = null;
      });
    }
    await this.initializing;
  }

  async readIndex() {
    try {
      const parsed = JSON.parse(await fsp.readFile(this.indexPath, "utf8"));
      if (!isPlainObject(parsed) || Number(parsed.version) !== INDEX_VERSION) {
        return this.emptyIndex();
      }
      const result = this.emptyIndex();
      if (isPlainObject(parsed.settings)) {
        result.settings.enabled = parsed.settings.enabled !== false;
        result.settings.loudnessNormalizationEnabled =
          parsed.settings.loudnessNormalizationEnabled !== false;
        result.settings.capacityBytes = this.validCapacity(
          parsed.settings.capacityBytes
        )
          ? parsed.settings.capacityBytes
          : DEFAULT_CAPACITY_BYTES;
      }
      if (!isPlainObject(parsed.entries)) return result;
      for (const key of Object.keys(parsed.entries)) {
        if (!safeCacheKey(key) || key === "__proto__" || key === "constructor")
          continue;
        const entry = this.sanitizeEntry(parsed.entries[key], key);
        if (entry) result.entries[key] = entry;
      }
      if (isPlainObject(parsed.loudnessArchive)) {
        for (const key of Object.keys(parsed.loudnessArchive)) {
          const archive = this.sanitizeLoudnessArchive(
            parsed.loudnessArchive[key],
            key
          );
          if (archive) result.loudnessArchive[key] = archive;
        }
      }
      return result;
    } catch (error) {
      return this.emptyIndex();
    }
  }

  sanitizeEntry(value, key) {
    if (!isPlainObject(value)) return null;
    const cacheKey = safeCacheKey(key);
    const stableKey = safeString(value.stableKey, 512);
    const byteLength = positiveInteger(value.byteLength);
    const fileHash = safeCacheKey(value.sha256);
    const bvid = safeString(value.bvid, 64);
    const cid = positiveInteger(value.cid);
    const audioId = positiveInteger(value.audioId);
    const legacy = value.kind === "audio";
    const sid = safeString(value.sid || "", 32);
    if (
      !cacheKey ||
      !stableKey ||
      !byteLength ||
      !fileHash ||
      (!legacy && (!bvid || !cid || !audioId)) ||
      (legacy && !/^\d+$/.test(sid))
    ) {
      return null;
    }
    const trackIds = Array.isArray(value.trackIds)
      ? [
          ...new Set(
            value.trackIds
              .map((id) => safeString(id, MAX_TRACK_ID_LENGTH))
              .filter(Boolean)
          ),
        ].slice(0, 20)
      : [];
    const result = {
      stableKey,
      kind: legacy ? "audio" : "video",
      bvid,
      cid,
      sid,
      audioId,
      codecs: safeString(value.codecs || "", 160),
      mimeType: mimeTypeAllowed(value.mimeType)
        ? String(value.mimeType)
        : "audio/mp4",
      bitrate: safeString(value.bitrate || "", 80),
      byteLength,
      contentLength: positiveInteger(value.contentLength) || undefined,
      sha256: fileHash,
      cachedAt: Number(value.cachedAt) || this.now(),
      lastAccessedAt: Number(value.lastAccessedAt) || this.now(),
      trackIds,
      retention: safeRetention(value.retention),
      ...displayMetadata(value),
    };
    const loudness = sanitizeLoudness(value.loudness, cacheKey, fileHash);
    if (loudness) result.loudness = loudness;
    return result;
  }

  sanitizeLoudnessArchive(value, key) {
    if (!isPlainObject(value)) return null;
    const cacheKey = safeCacheKey(key);
    const stableKey = safeString(value.stableKey, 512);
    const contentSha256 = safeCacheKey(value.contentSha256);
    const loudness = sanitizeLoudness(value.loudness, cacheKey, contentSha256);
    if (!cacheKey || sha256(stableKey) !== cacheKey || !loudness) return null;
    const trackIds = Array.isArray(value.trackIds)
      ? value.trackIds
          .map((trackId) => safeString(trackId, MAX_TRACK_ID_LENGTH))
          .filter(Boolean)
          .slice(0, 20)
      : [];
    return { stableKey, contentSha256, loudness, trackIds };
  }

  archiveLoudness(cacheKey, entry) {
    if (!entry || !this.loudnessIsCurrent(entry)) return;
    this.index.loudnessArchive[cacheKey] = {
      stableKey: entry.stableKey,
      contentSha256: entry.sha256,
      loudness: entry.loudness,
      trackIds: [...entry.trackIds],
    };
  }

  validCapacity(value) {
    return value === null || ALLOWED_CAPACITIES.has(Number(value));
  }

  filePath(cacheKey) {
    return path.join(this.assetsDir, `${safeCacheKey(cacheKey)}.m4s`);
  }

  async cleanupDisk() {
    let changed = false;
    for (const key of Object.keys(this.index.entries)) {
      const file = this.filePath(key);
      try {
        const stat = await fsp.stat(file);
        if (
          !stat.isFile() ||
          stat.size !== this.index.entries[key].byteLength
        ) {
          delete this.index.entries[key];
          changed = true;
        }
      } catch (error) {
        delete this.index.entries[key];
        changed = true;
      }
    }
    const names = await fsp.readdir(this.assetsDir).catch(() => []);
    for (const name of names) {
      const match = /^([a-f0-9]{64})(?:\.[a-f0-9]{16})?\.(m4s|part)$/.exec(
        name
      );
      if (!match) continue;
      if (match[2] === "part" || !this.index.entries[match[1]]) {
        await fsp.unlink(path.join(this.assetsDir, name)).catch(() => {});
        changed = true;
      }
    }
    if (changed) await this.persist();
  }

  async persist() {
    const temporary = `${this.indexPath}.${randomBytes(8).toString("hex")}.tmp`;
    await fsp.writeFile(temporary, JSON.stringify(this.index), { mode: 0o600 });
    const handle = await fsp.open(temporary, "r+");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fsp.rename(temporary, this.indexPath);
  }

  // Retain the public drain promise while keeping disk mutations independent
  // of network transfers. Never use this combined promise as the write lock.
  get writeChain() {
    return Promise.all([this.downloadChain, this.indexWriteChain]).then(
      () => this.indexWriteChain
    );
  }

  serialize(operation) {
    const next = this.indexWriteChain.then(operation, operation);
    this.indexWriteChain = next.catch(() => {});
    return next;
  }

  status() {
    const entries = Object.values(this.index.entries);
    let loudnessReadyEntries = 0;
    let loudnessFailedEntries = 0;
    for (const entry of entries) {
      if (!this.loudnessIsCurrent(entry)) continue;
      if (entry.loudness.status === "ready") loudnessReadyEntries += 1;
      if (entry.loudness.status === "failed") loudnessFailedEntries += 1;
    }
    for (const archive of Object.values(this.index.loudnessArchive)) {
      if (
        !archive.loudness ||
        !this.loudnessAnalyzer ||
        archive.loudness.analyzerVersion !== this.loudnessAnalyzer.version
      ) {
        continue;
      }
      if (archive.loudness.status === "ready") loudnessReadyEntries += 1;
      if (archive.loudness.status === "failed") loudnessFailedEntries += 1;
    }
    return {
      ok: true,
      supported: true,
      enabled: this.index.settings.enabled,
      capacityBytes: this.index.settings.capacityBytes,
      usedBytes: entries.reduce((total, entry) => total + entry.byteLength, 0),
      readyEntries: entries.length,
      queuedEntries: this.jobs.size,
      loudnessNormalizationEnabled:
        this.index.settings.loudnessNormalizationEnabled,
      loudnessPendingEntries: this.loudnessJobs.size,
      loudnessReadyEntries,
      loudnessFailedEntries,
      lastError: this.lastError || "",
    };
  }

  list(metadataByTrackId = {}) {
    const safeMetadata = isPlainObject(metadataByTrackId)
      ? metadataByTrackId
      : {};
    const entries = Object.entries(this.index.entries)
      .map(([cacheKey, entry]) => {
        const historyMetadata = entry.trackIds.reduce((found, trackId) => {
          if (found) return found;
          if (!Object.prototype.hasOwnProperty.call(safeMetadata, trackId)) {
            return null;
          }
          return displayMetadata(safeMetadata[trackId]);
        }, null);
        const metadata = {
          title:
            entry.title || (historyMetadata && historyMetadata.title) || "",
          artist:
            entry.artist || (historyMetadata && historyMetadata.artist) || "",
          coverUrl:
            entry.coverUrl ||
            (historyMetadata && historyMetadata.coverUrl) ||
            "",
          duration:
            entry.duration ||
            (historyMetadata && historyMetadata.duration) ||
            0,
        };
        const playableTrack = this.playableTrackForEntry(entry);
        return {
          cacheKey,
          trackIds: [...entry.trackIds],
          title:
            metadata.title ||
            (entry.kind === "audio"
              ? `Bilibili AU${entry.sid}`
              : `Bilibili ${entry.bvid}`),
          artist: metadata.artist,
          coverUrl: metadata.coverUrl,
          duration: metadata.duration,
          byteLength: entry.byteLength,
          cachedAt: entry.cachedAt,
          lastAccessedAt: entry.lastAccessedAt,
          bitrate: entry.bitrate,
          loudnessStatus: entry.loudness ? entry.loudness.status : "pending",
          retention: entry.retention,
          downloaded: entry.retention === "download",
          // This is deliberately an identity only. Cache inventory consumers
          // must rebuild display data locally and never receive cache paths,
          // protocol URLs, signed media URLs, or account material.
          playableTrack,
          playable: Boolean(playableTrack),
        };
      })
      .sort((left, right) => right.lastAccessedAt - left.lastAccessedAt);
    return {
      ok: true,
      entries,
      tasks: [...this.jobs.values(), ...this.failedJobs.values()].map(
        (job) => ({
          cacheKey: job.cacheKey,
          title: displayMetadata(job).title || job.trackId,
          state: job.state,
          retention: job.retention,
          receivedBytes: job.receivedBytes || 0,
          totalBytes: job.totalBytes || 0,
          error: job.error || "",
        })
      ),
      usedBytes: entries.reduce(
        (total, entry) => total + Number(entry.byteLength || 0),
        0
      ),
    };
  }

  playableTrackForEntry(entry) {
    if (!entry || entry.kind === "audio") {
      const sid = safeString(entry && entry.sid, 32);
      return /^\d+$/.test(sid)
        ? { id: `bitrack_${sid}`, source: "bilibili" }
        : null;
    }
    const bvid = safeString(entry.bvid, 64);
    const cid = positiveInteger(entry.cid);
    if (!/^BV[0-9A-Za-z]{10}$/.test(bvid) || !cid) return null;
    return { id: `bitrack_v_${bvid}-${cid}`, source: "bilibili" };
  }

  async configure({
    enabled,
    capacityBytes,
    loudnessNormalizationEnabled,
  } = {}) {
    await this.initialize();
    if (typeof enabled !== "undefined" && typeof enabled !== "boolean") {
      return { ok: false, status: "invalid-input" };
    }
    if (
      typeof capacityBytes !== "undefined" &&
      !this.validCapacity(capacityBytes)
    ) {
      return { ok: false, status: "invalid-capacity" };
    }
    if (
      typeof loudnessNormalizationEnabled !== "undefined" &&
      typeof loudnessNormalizationEnabled !== "boolean"
    ) {
      return { ok: false, status: "invalid-input" };
    }
    if (enabled === false) {
      this.jobs.forEach((job) => {
        if (job.retention !== "download") job.controller.abort();
      });
    }
    if (
      loudnessNormalizationEnabled === false &&
      this.loudnessAnalyzer &&
      typeof this.loudnessAnalyzer.cancelAll === "function"
    ) {
      this.loudnessAnalyzer.cancelAll();
    }
    const result = await this.serialize(async () => {
      if (typeof capacityBytes === "number") {
        const downloadedBytes = Object.values(this.index.entries)
          .filter((entry) => entry.retention === "download")
          .reduce((total, entry) => total + entry.byteLength, 0);
        if (downloadedBytes > capacityBytes) {
          return {
            ok: false,
            status: "downloaded-items-exceed-capacity",
            minimumCapacityBytes: downloadedBytes,
          };
        }
      }
      const previousSettings = { ...this.index.settings };
      if (typeof enabled === "boolean") this.index.settings.enabled = enabled;
      if (typeof capacityBytes !== "undefined")
        this.index.settings.capacityBytes = capacityBytes;
      if (typeof loudnessNormalizationEnabled === "boolean") {
        this.index.settings.loudnessNormalizationEnabled =
          loudnessNormalizationEnabled;
      }
      try {
        await this.evictToCapacity(0);
        await this.persist();
      } catch (error) {
        this.index.settings = previousSettings;
        await this.persist();
        return { ok: false, status: error.code || "configure-failed" };
      }
      return { ok: true };
    });
    if (!result.ok) return result;
    if (loudnessNormalizationEnabled === false && this.loudnessJobs.size) {
      await Promise.allSettled([...this.loudnessJobs.values()]);
    }
    if (loudnessNormalizationEnabled === true) this.scheduleMissingLoudness();
    return this.status();
  }

  entryResponse(cacheKey, entry) {
    return {
      cacheKey,
      url: `${CACHE_SCHEME}://audio/${cacheKey}`,
      bitrate: entry.bitrate,
      mimeType: entry.mimeType,
      audioId: entry.audioId,
      contentSha256: entry.sha256,
      analyzerVersion: this.loudnessAnalyzer
        ? this.loudnessAnalyzer.version
        : "",
      loudness:
        this.index.settings.loudnessNormalizationEnabled &&
        this.loudnessIsCurrent(entry)
          ? entry.loudness
          : null,
    };
  }

  loudnessIsCurrent(entry) {
    return Boolean(
      entry &&
        entry.loudness &&
        this.loudnessAnalyzer &&
        entry.loudness.cacheKey === sha256(entry.stableKey) &&
        entry.loudness.contentSha256 === entry.sha256 &&
        entry.loudness.analyzerVersion === this.loudnessAnalyzer.version
    );
  }

  scheduleMissingLoudness() {
    if (
      !this.initialized ||
      !this.index.settings.loudnessNormalizationEnabled ||
      !this.loudnessAnalyzer ||
      typeof this.loudnessAnalyzer.analyze !== "function"
    ) {
      return;
    }
    for (const cacheKey of Object.keys(this.index.entries)) {
      this.queueLoudnessAnalysis(cacheKey);
    }
  }

  // A failed measurement remains observable, but transient failures become
  // eligible at a later lookup/startup. Persisted attempts bound retries across
  // restarts; no timer or hot loop retries a failed decoder in the background.
  shouldAnalyzeLoudness(entry) {
    if (!this.loudnessIsCurrent(entry)) return true;
    const result = entry.loudness;
    return (
      result.status === "failed" &&
      result.retryable === true &&
      result.retryAttempts < MAX_LOUDNESS_ATTEMPTS &&
      this.now() >= result.retryAfter
    );
  }

  queueLoudnessAnalysis(cacheKey) {
    const key = safeCacheKey(cacheKey);
    const entry = this.index.entries[key];
    if (
      !key ||
      !entry ||
      this.loudnessJobs.has(key) ||
      !this.shouldAnalyzeLoudness(entry) ||
      !this.index.settings.loudnessNormalizationEnabled ||
      !this.loudnessAnalyzer ||
      typeof this.loudnessAnalyzer.analyze !== "function"
    ) {
      return;
    }
    const contentSha256 = entry.sha256;
    const retryAttempts = this.loudnessIsCurrent(entry)
      ? (entry.loudness.retryAttempts || 1) + 1
      : 1;
    const analyzerVersion = this.loudnessAnalyzer.version;
    const promise = Promise.resolve()
      .then(() =>
        this.loudnessAnalyzer.analyze({
          cacheKey: key,
          contentSha256,
          filePath: this.filePath(key),
        })
      )
      .then((result) =>
        this.storeLoudnessResult(key, contentSha256, {
          ...result,
          status: "ready",
          cacheKey: key,
          contentSha256,
          analyzerVersion,
          analyzedAt: this.now(),
        })
      )
      .catch((error) => {
        const code = safeString(
          error && error.code ? error.code : "analysis-failed",
          MAX_LOUDNESS_ERROR_LENGTH
        );
        if (
          code === "analysis-cancelled" ||
          code === "analyzer-shutdown" ||
          !this.index.settings.loudnessNormalizationEnabled
        ) {
          return;
        }
        return this.storeLoudnessResult(key, contentSha256, {
          status: "failed",
          cacheKey: key,
          contentSha256,
          analyzerVersion,
          errorCode: code || "analysis-failed",
          analyzedAt: this.now(),
          retryAttempts,
          retryAfter: this.now() + LOUDNESS_RETRY_DELAY_MS * retryAttempts,
        });
      })
      .finally(() => {
        this.loudnessJobs.delete(key);
      });
    this.loudnessJobs.set(key, promise);
  }

  async storeLoudnessResult(cacheKey, contentSha256, value) {
    return this.serialize(async () => {
      const entry = this.index.entries[cacheKey];
      if (
        !entry ||
        entry.sha256 !== contentSha256 ||
        !this.index.settings.loudnessNormalizationEnabled
      ) {
        return;
      }
      const loudness = sanitizeLoudness(value, cacheKey, contentSha256);
      if (!loudness) {
        throw Object.assign(new Error("Invalid loudness result."), {
          code: "invalid-analysis-result",
        });
      }
      entry.loudness = loudness;
      await this.persist();
    });
  }

  async waitForLoudnessIdle() {
    await this.downloadChain;
    while (this.loudnessJobs.size) {
      await Promise.allSettled([...this.loudnessJobs.values()]);
    }
    await this.writeChain;
  }

  async lookup({ trackId, bvid, cid, preferredAudioId, kind, sid } = {}) {
    await this.initialize();
    const safeTrackId = safeString(trackId, MAX_TRACK_ID_LENGTH);
    const safeBvid = safeString(bvid, 64);
    const safeCid = positiveInteger(cid);
    const legacySid = safeString(sid, 32);
    const legacy = kind === "audio";
    if (
      !safeTrackId ||
      (legacy && !/^\d+$/.test(legacySid)) ||
      (!legacy && (!/^BV[0-9A-Za-z]{10}$/.test(safeBvid) || Number(cid) < 0))
    ) {
      return { ok: false, status: "invalid-input" };
    }
    const preferred = positiveInteger(preferredAudioId);
    const candidates = Object.entries(this.index.entries)
      .filter(([, entry]) => {
        if (legacy) return entry.stableKey === `bilibili:audio:${legacySid}`;
        if (entry.bvid !== safeBvid) return false;
        if (entry.trackIds.includes(safeTrackId)) return true;
        return safeCid > 0 && entry.cid === safeCid;
      })
      .sort(([, left], [, right]) => {
        if (preferred) {
          const leftPreferred = left.audioId === preferred ? 1 : 0;
          const rightPreferred = right.audioId === preferred ? 1 : 0;
          if (leftPreferred !== rightPreferred)
            return rightPreferred - leftPreferred;
        }
        return right.audioId - left.audioId || right.cachedAt - left.cachedAt;
      });
    for (const [cacheKey, entry] of candidates) {
      try {
        const stat = await fsp.stat(this.filePath(cacheKey));
        if (!stat.isFile() || stat.size !== entry.byteLength)
          throw new Error("invalid cache file");
        entry.lastAccessedAt = this.now();
        this.serialize(() => this.persist()).catch(() => {});
        this.queueLoudnessAnalysis(cacheKey);
        return {
          ok: true,
          hit: true,
          entry: this.entryResponse(cacheKey, entry),
        };
      } catch (error) {
        await this.delete(cacheKey);
      }
    }
    return { ok: true, hit: false };
  }

  async schedule(input = {}) {
    await this.initialize();
    if (this.shuttingDown) return { ok: false, status: "shutting-down" };
    const trackId = safeString(input.trackId, MAX_TRACK_ID_LENGTH);
    const stableKey = stableAudioKey(input);
    if (!trackId || !stableKey) return { ok: false, status: "invalid-input" };
    const requestedRetention = safeRetention(input.retention, "playlist");
    if (!this.index.settings.enabled && requestedRetention !== "download") {
      return { ok: true, status: "disabled" };
    }
    const cacheKey = sha256(stableKey);
    const ready = await this.serialize(async () => {
      const existing = this.index.entries[cacheKey];
      if (!existing) return null;
      const metadata = displayMetadata(input);
      let changed = false;
      if (!existing.trackIds.includes(trackId)) {
        existing.trackIds.push(trackId);
        changed = true;
      }
      for (const field of ["title", "artist", "coverUrl", "duration"]) {
        if (!existing[field] && metadata[field]) {
          existing[field] = metadata[field];
          changed = true;
        }
      }
      if (
        requestedRetention === "download" ||
        (requestedRetention === "playlist" &&
          existing.retention === "temporary")
      ) {
        existing.retention = requestedRetention;
        changed = true;
      }
      if (changed) await this.persist();
      return { ok: true, status: "already-ready" };
    });
    if (ready) return ready;
    if (!this.index.settings.enabled && requestedRetention !== "download")
      return { ok: true, status: "disabled" };
    const pending = this.jobs.get(cacheKey);
    if (pending && !pending.controller.signal.aborted) {
      pending.trackIds = [...new Set([...pending.trackIds, trackId])];
      if (
        requestedRetention === "download" ||
        (requestedRetention === "playlist" && pending.retention === "temporary")
      ) {
        pending.retention = requestedRetention;
      }
      for (const [field, value] of Object.entries(displayMetadata(input))) {
        if (!pending[field] && value) pending[field] = value;
      }
      return { ok: true, status: "downloading" };
    }
    if (this.jobs.size >= 100 && !this.jobs.has(cacheKey))
      return { ok: false, status: "queue-full" };
    this.failedJobs.delete(cacheKey);
    const job = {
      ...input,
      trackId,
      stableKey,
      cacheKey,
      controller: new AbortController(),
      retention: requestedRetention,
      trackIds: [trackId],
      state: "queued",
      timedOut: false,
      error: "",
      receivedBytes: 0,
      totalBytes: 0,
    };
    this.jobs.set(cacheKey, job);
    this.downloadChain = this.downloadChain
      .then(() => this.runJob(job))
      .catch((error) => {
        if (job.controller.signal.aborted && !job.timedOut) return;
        job.state = "failed";
        const allowedErrors = new Set([
          "capacity-exhausted",
          "entry-too-large",
          "incomplete-download",
          "invalid-mime",
          "cdn-request-failed",
          "no-audio-stream",
          "ENOSPC",
          "EACCES",
          "EPERM",
        ]);
        job.error = job.timedOut
          ? "timeout"
          : allowedErrors.has(error && error.code)
          ? error.code
          : "download-failed";
        this.lastError = job.error;
        this.failedJobs.set(cacheKey, job);
        while (this.failedJobs.size > 100)
          this.failedJobs.delete(this.failedJobs.keys().next().value);
      });
    return { ok: true, status: "queued" };
  }

  async runJob(job) {
    let timer;
    try {
      if (
        job.controller.signal.aborted ||
        (!this.index.settings.enabled && job.retention !== "download") ||
        this.index.entries[job.cacheKey]
      )
        return;
      job.state = "downloading";
      timer = setTimeout(() => {
        job.timedOut = true;
        job.controller.abort();
      }, 120000);
      const resolveAudio = (forceRefresh) =>
        new Promise((resolve, reject) => {
          const signal = job.controller.signal;
          const abort = () => reject(signal.reason || new Error("Cancelled"));
          if (signal.aborted) {
            abort();
            return;
          }
          signal.addEventListener("abort", abort, { once: true });
          Promise.resolve()
            .then(() => this.resolveBilibiliAudio({ ...job, forceRefresh }))
            .then(resolve, reject)
            .finally(() => signal.removeEventListener("abort", abort));
        });
      let audio = await resolveAudio(false);
      try {
        await this.downloadAudio(job, audio);
      } catch (firstError) {
        if (
          job.controller.signal.aborted ||
          ["capacity-exhausted", "ENOSPC", "EACCES", "EPERM"].includes(
            firstError.code
          )
        )
          throw firstError;
        audio = await resolveAudio(true);
        await this.downloadAudio(job, audio);
      }
      this.lastError = "";
    } finally {
      clearTimeout(timer);
      if (this.jobs.get(job.cacheKey) === job) this.jobs.delete(job.cacheKey);
    }
  }

  async cancelTask(cacheKey) {
    await this.initialize();
    const key = safeCacheKey(cacheKey);
    if (!key) return { ok: false, status: "invalid-input" };
    const job = this.jobs.get(key);
    if (job) {
      if (job.state === "queued") this.jobs.delete(key);
      job.state = "cancelling";
      job.controller.abort();
      await this.delete(key, { preserveLoudness: true });
    }
    this.failedJobs.delete(key);
    if (!this.failedJobs.size) this.lastError = "";
    return { ok: true };
  }

  async retryTask(cacheKey) {
    await this.initialize();
    const job = this.failedJobs.get(safeCacheKey(cacheKey));
    if (!job) return { ok: false, status: "not-found" };
    return this.schedule(job);
  }

  async evictToCapacity(requiredBytes) {
    const capacity = this.index.settings.capacityBytes;
    if (capacity === null) return;
    let used = this.status().usedBytes;
    const candidates = Object.entries(this.index.entries)
      .filter(
        ([key, entry]) =>
          entry.retention !== "download" &&
          !this.readers.has(key) &&
          !this.jobs.has(key)
      )
      .sort(
        ([, left], [, right]) => left.lastAccessedAt - right.lastAccessedAt
      );
    for (const [key, entry] of candidates) {
      if (used + requiredBytes <= capacity) break;
      this.archiveLoudness(key, entry);
      try {
        await fsp.unlink(this.filePath(key));
      } catch (error) {
        if (error.code !== "ENOENT") continue;
      }
      delete this.index.entries[key];
      await this.persist();
      used -= entry.byteLength;
    }
    if (used + requiredBytes > capacity) {
      throw Object.assign(new Error("Audio cache capacity is exhausted."), {
        code: "capacity-exhausted",
      });
    }
  }

  async downloadAudio(job, audio) {
    if (
      !audio ||
      !Array.isArray(audio.urlCandidates) ||
      !audio.urlCandidates.length
    ) {
      throw Object.assign(new Error("No audio candidates."), {
        code: "no-audio-stream",
      });
    }
    let lastError;
    for (const url of audio.urlCandidates) {
      job.controller.signal.throwIfAborted();
      try {
        return await this.downloadCandidate(job, audio, url);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error("Audio cache download failed.");
  }

  async downloadCandidate(job, audio, url) {
    const response = await this.session.fetch(url, {
      method: "GET",
      credentials: "include",
      headers: { Referer: "https://www.bilibili.com/" },
      signal: job.controller.signal,
    });
    if (
      !response ||
      !response.ok ||
      Number(response.status) !== 200 ||
      !response.body
    ) {
      throw Object.assign(new Error("Audio CDN request failed."), {
        code: "cdn-request-failed",
      });
    }
    const mimeType = String(
      response.headers.get("content-type") || audio.mimeType || "audio/mp4"
    );
    if (!mimeTypeAllowed(mimeType)) {
      throw Object.assign(new Error("Unexpected audio MIME type."), {
        code: "invalid-mime",
      });
    }
    const contentLength = positiveInteger(
      response.headers.get("content-length")
    );
    if (contentLength && contentLength > MAX_ENTRY_BYTES) {
      throw Object.assign(new Error("Audio file is too large."), {
        code: "entry-too-large",
      });
    }
    job.totalBytes = contentLength;
    job.receivedBytes = 0;
    job.controller.signal.throwIfAborted();
    const partPath = path.join(
      this.assetsDir,
      `${job.cacheKey}.${randomBytes(8).toString("hex")}.part`
    );
    const output = fs.createWriteStream(partPath, { flags: "wx", mode: 0o600 });
    const digest = createHash("sha256");
    let byteLength = 0;
    try {
      const meter = new Transform({
        transform(chunk, encoding, callback) {
          const buffer = Buffer.from(chunk);
          byteLength += buffer.length;
          job.receivedBytes = byteLength;
          if (byteLength > MAX_ENTRY_BYTES) {
            callback(
              Object.assign(new Error("Audio file exceeded limit."), {
                code: "entry-too-large",
              })
            );
            return;
          }
          digest.update(buffer);
          callback(null, buffer);
        },
      });
      await pipeline(Readable.fromWeb(response.body), meter, output, {
        signal: job.controller.signal,
      });
      if (!byteLength || (contentLength && byteLength !== contentLength)) {
        throw Object.assign(new Error("Incomplete audio download."), {
          code: "incomplete-download",
        });
      }
      const handle = await fsp.open(partPath, "r+");
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
      await this.serialize(async () => {
        job.controller.signal.throwIfAborted();
        await this.evictToCapacity(byteLength);
        job.controller.signal.throwIfAborted();
        const finalPath = this.filePath(job.cacheKey);
        await fsp.rename(partPath, finalPath);
        if (job.controller.signal.aborted) {
          await fsp.unlink(finalPath);
          job.controller.signal.throwIfAborted();
        }
        this.index.entries[job.cacheKey] = {
          stableKey: job.stableKey,
          kind: job.kind === "audio" ? "audio" : "video",
          bvid: safeString(job.bvid, 64),
          cid: positiveInteger(job.cid),
          sid: safeString(job.sid || "", 32),
          audioId: positiveInteger(audio.id || job.audioId),
          codecs: safeString(audio.codecs || job.codecs || "", 160),
          mimeType,
          bitrate: safeString(audio.label || "", 80),
          byteLength,
          contentLength: contentLength || undefined,
          sha256: digest.digest("hex"),
          cachedAt: this.now(),
          lastAccessedAt: this.now(),
          trackIds: [...job.trackIds],
          retention: job.retention,
          ...displayMetadata(job),
        };
        const archived = this.index.loudnessArchive[job.cacheKey];
        if (
          archived &&
          archived.stableKey === job.stableKey &&
          archived.contentSha256 === this.index.entries[job.cacheKey].sha256
        ) {
          this.index.entries[job.cacheKey].loudness = archived.loudness;
          delete this.index.loudnessArchive[job.cacheKey];
        }
        try {
          await this.persist();
        } catch (error) {
          delete this.index.entries[job.cacheKey];
          await fsp.unlink(finalPath).catch(() => {});
          throw error;
        }
      });
      this.queueLoudnessAnalysis(job.cacheKey);
    } catch (error) {
      output.destroy();
      await fsp.unlink(partPath).catch(() => {});
      throw error;
    }
  }

  async delete(
    cacheKey,
    {
      preserveLoudness = false,
      preserveDownloads = false,
      temporaryOnly = false,
    } = {}
  ) {
    await this.initialize();
    const key = safeCacheKey(cacheKey);
    const activeJob = this.jobs.get(key);
    if (
      activeJob &&
      !(preserveDownloads && activeJob.retention === "download") &&
      !(temporaryOnly && activeJob.retention !== "temporary")
    ) {
      activeJob.controller.abort();
      if (activeJob.state === "queued") this.jobs.delete(key);
      activeJob.state = "cancelling";
    }
    if (
      this.loudnessAnalyzer &&
      typeof this.loudnessAnalyzer.cancel === "function"
    ) {
      this.loudnessAnalyzer.cancel(key);
    }
    this.failedJobs.delete(key);
    if (!key) return { ok: false, status: "invalid-input" };
    return this.serialize(async () => {
      const entry = this.index.entries[key];
      if (!entry) {
        if (!preserveLoudness && this.index.loudnessArchive[key]) {
          delete this.index.loudnessArchive[key];
          await this.persist();
        }
        return { ok: true, removed: false };
      }
      if (
        (preserveDownloads && entry.retention === "download") ||
        (temporaryOnly && entry.retention !== "temporary")
      )
        return { ok: true, removed: false };
      if (this.readers.has(key)) return { ok: false, status: "in-use" };
      try {
        await fsp.unlink(this.filePath(key));
      } catch (error) {
        if (error.code !== "ENOENT") return { ok: false, status: "file-busy" };
      }
      if (preserveLoudness) this.archiveLoudness(key, entry);
      else delete this.index.loudnessArchive[key];
      delete this.index.entries[key];
      await this.persist();
      return { ok: true, removed: true, removedBytes: entry.byteLength };
    });
  }

  async clear() {
    await this.initialize();
    this.jobs.forEach((job) => {
      if (job.retention !== "download") job.controller.abort();
    });
    this.failedJobs.forEach((job, key) => {
      if (job.retention !== "download") this.failedJobs.delete(key);
    });
    const keys = [
      ...new Set([
        ...Object.entries(this.index.entries)
          .filter(([, entry]) => entry.retention !== "download")
          .map(([key]) => key),
        ...[...this.jobs.values()]
          .filter((job) => job.retention !== "download")
          .map((job) => job.cacheKey),
      ]),
    ];
    let removedEntries = 0;
    let removedBytes = 0;
    let skippedEntries = 0;
    for (const key of keys) {
      const result = await this.delete(key, {
        preserveDownloads: true,
      });
      if (!result.ok) skippedEntries += 1;
      if (result.removed) {
        removedEntries += 1;
        removedBytes += result.removedBytes || 0;
      }
    }
    await this.serialize(async () => {
      this.index.loudnessArchive = Object.create(null);
      await this.persist();
    });
    return {
      ok: skippedEntries === 0,
      removedEntries,
      removedBytes,
      skippedEntries,
      status: skippedEntries ? "file-busy" : "cleared",
    };
  }

  async deleteTrack(trackId) {
    await this.initialize();
    const safeTrackId = safeString(trackId, MAX_TRACK_ID_LENGTH);
    if (!safeTrackId) return { ok: false, status: "invalid-input" };
    this.jobs.forEach((job) => {
      if (job.trackIds.includes(safeTrackId)) job.controller.abort();
    });
    this.failedJobs.forEach((job, key) => {
      if (job.trackIds.includes(safeTrackId)) this.failedJobs.delete(key);
    });
    const keys = [
      ...new Set([
        ...Object.entries(this.index.entries)
          .filter(([, entry]) => entry.trackIds.includes(safeTrackId))
          .map(([key]) => key),
        ...[...this.jobs.values()]
          .filter((job) => job.trackIds.includes(safeTrackId))
          .map((job) => job.cacheKey),
      ]),
    ];
    let skippedEntries = 0;
    let removedEntries = 0;
    let removedBytes = 0;
    for (const key of keys) {
      const result = await this.delete(key);
      if (!result.ok) skippedEntries += 1;
      if (result.removed) {
        removedEntries += 1;
        removedBytes += result.removedBytes || 0;
      }
    }
    let removedLoudnessProfiles = 0;
    for (const [key, archive] of Object.entries(this.index.loudnessArchive)) {
      if (archive.trackIds.includes(safeTrackId)) {
        delete this.index.loudnessArchive[key];
        removedLoudnessProfiles += 1;
      }
    }
    if (removedLoudnessProfiles) await this.serialize(() => this.persist());
    return {
      ok: skippedEntries === 0,
      status: skippedEntries ? "file-busy" : "deleted",
      skippedEntries,
      removedEntries,
      removedBytes,
      removedLoudnessProfiles,
    };
  }

  async syncPlaylistTrackIds(trackIds = []) {
    await this.initialize();
    const retained = new Set(
      (Array.isArray(trackIds) ? trackIds : [])
        .map((trackId) => safeString(trackId, MAX_TRACK_ID_LENGTH))
        .filter(Boolean)
        .slice(0, 50000)
    );
    this.jobs.forEach((job) => {
      if (job.retention !== "download")
        job.retention = job.trackIds.some((id) => retained.has(id))
          ? "playlist"
          : "temporary";
    });
    return this.serialize(async () => {
      let changedEntries = 0;
      for (const entry of Object.values(this.index.entries)) {
        if (entry.retention === "download") continue;
        const nextRetention = entry.trackIds.some((trackId) =>
          retained.has(trackId)
        )
          ? "playlist"
          : "temporary";
        if (entry.retention !== nextRetention) {
          entry.retention = nextRetention;
          changedEntries += 1;
        }
      }
      if (changedEntries) await this.persist();
      return { ok: true, changedEntries };
    });
  }

  async setRetention(cacheKey, retention) {
    await this.initialize();
    const key = safeCacheKey(cacheKey);
    const nextRetention = safeRetention(retention, "");
    if (!key || !nextRetention || !this.index.entries[key]) {
      return { ok: false, status: "invalid-input" };
    }
    return this.serialize(async () => {
      const entry = this.index.entries[key];
      if (!entry) return { ok: false, status: "not-found" };
      const previousRetention = entry.retention;
      entry.retention = nextRetention;
      try {
        await this.persist();
      } catch (error) {
        entry.retention = previousRetention;
        throw error;
      }
      return { ok: true, retention: nextRetention };
    });
  }

  async cleanupTemporary() {
    await this.initialize();
    const keys = Object.entries(this.index.entries)
      .filter(([, entry]) => entry.retention === "temporary")
      .map(([key]) => key);
    let removedEntries = 0;
    let removedBytes = 0;
    for (const key of keys) {
      const result = await this.delete(key, {
        preserveLoudness: true,
        temporaryOnly: true,
      });
      if (result.removed) {
        removedEntries += 1;
        removedBytes += result.removedBytes || 0;
      }
    }
    return { ok: true, removedEntries, removedBytes };
  }

  async handleProtocolRequest(request) {
    await this.initialize();
    let cacheKey = "";
    try {
      const parsed = new URL(request.url);
      if (parsed.protocol !== `${CACHE_SCHEME}:` || parsed.hostname !== "audio")
        throw new Error("bad url");
      cacheKey = safeCacheKey(parsed.pathname.replace(/^\//, ""));
    } catch (error) {
      return new Response("Bad cache URL", { status: 400 });
    }
    // The app is loaded from file:// (an opaque "null" origin). Make local
    // media origin-clean for Web Audio without exposing it to remote sites.
    const method = request.method || "GET";
    const origin = request.headers.get("origin");
    if (origin && origin !== "null" && origin !== "file://")
      return new Response("Forbidden", { status: 403 });
    const corsHeaders = {
      "Access-Control-Allow-Origin": origin === "file://" ? "file://" : "null",
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Headers": "Range",
      Vary: "Origin",
    };
    if (method === "OPTIONS")
      return new Response(null, { status: 204, headers: corsHeaders });
    if (method !== "GET" && method !== "HEAD")
      return new Response(null, { status: 405, headers: corsHeaders });
    const entry = this.index.entries[cacheKey];
    if (!entry)
      return new Response("Not found", { status: 404, headers: corsHeaders });
    const file = this.filePath(cacheKey);
    try {
      const realRoot = await fsp.realpath(this.assetsDir);
      const realFile = await fsp.realpath(file);
      if (!realFile.startsWith(`${realRoot}${path.sep}`))
        throw new Error("unsafe path");
      const stat = await fsp.stat(realFile);
      if (!stat.isFile() || stat.size !== entry.byteLength)
        throw new Error("corrupt file");
      const range = parseSingleRange(request.headers.get("range"), stat.size);
      if (typeof range === "undefined") {
        return new Response(null, {
          status: 416,
          headers: { ...corsHeaders, "Content-Range": `bytes */${stat.size}` },
        });
      }
      const start = range ? range.start : 0;
      const end = range ? range.end : stat.size - 1;
      const length = end - start + 1;
      if (method === "HEAD")
        return new Response(null, {
          status: range ? 206 : 200,
          headers: {
            ...corsHeaders,
            "Content-Type": entry.mimeType,
            "Content-Length": String(length),
            "Accept-Ranges": "bytes",
            ...(range
              ? { "Content-Range": `bytes ${start}-${end}/${stat.size}` }
              : {}),
          },
        });
      const stream = fs.createReadStream(realFile, { start, end });
      this.readers.set(cacheKey, (this.readers.get(cacheKey) || 0) + 1);
      const release = () => {
        const count = (this.readers.get(cacheKey) || 1) - 1;
        if (count <= 0) this.readers.delete(cacheKey);
        else this.readers.set(cacheKey, count);
      };
      stream.once("close", release);
      entry.lastAccessedAt = this.now();
      this.serialize(() => this.persist()).catch(() => {});
      const headers = {
        ...corsHeaders,
        "Content-Type": entry.mimeType,
        "Content-Length": String(length),
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store",
      };
      if (range)
        headers["Content-Range"] = `bytes ${start}-${end}/${stat.size}`;
      return new Response(Readable.toWeb(stream), {
        status: range ? 206 : 200,
        headers,
      });
    } catch (error) {
      await this.delete(cacheKey);
      return new Response("Not found", { status: 404, headers: corsHeaders });
    }
  }

  shutdown() {
    this.shuttingDown = true;
    this.jobs.forEach((job) => job.controller.abort());
    if (
      this.loudnessAnalyzer &&
      typeof this.loudnessAnalyzer.shutdown === "function"
    ) {
      this.loudnessAnalyzer.shutdown();
    }
  }

  async prepareForQuit() {
    this.shuttingDown = true;
    this.jobs.forEach((job) => job.controller.abort());
    await this.downloadChain;
    await this.writeChain;
    const result = await this.cleanupTemporary();
    this.shutdown();
    return result;
  }
}

module.exports = {
  ALLOWED_CAPACITIES,
  AudioCache,
  CACHE_SCHEME,
  DEFAULT_CAPACITY_BYTES,
  MAX_ENTRY_BYTES,
  parseSingleRange,
  stableAudioKey,
  sanitizeLoudness,
};
