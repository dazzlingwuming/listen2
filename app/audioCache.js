const { createHash, randomBytes } = require("crypto");
const { once } = require("events");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { Readable } = require("stream");

const GIB = 1024 * 1024 * 1024;
const DEFAULT_CAPACITY_BYTES = 2 * GIB;
const ALLOWED_CAPACITIES = new Set([GIB, 2 * GIB, 5 * GIB, 10 * GIB]);
const MAX_ENTRY_BYTES = 128 * 1024 * 1024;
const MAX_TRACK_ID_LENGTH = 256;
const CACHE_SCHEME = "listen2-cache";
const INDEX_VERSION = 1;

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

class AudioCache {
  constructor({
    rootDir,
    session,
    resolveBilibiliAudio,
    now = () => Date.now(),
  }) {
    this.rootDir = rootDir;
    this.assetsDir = path.join(rootDir, "assets");
    this.indexPath = path.join(rootDir, "index-v1.json");
    this.session = session;
    this.resolveBilibiliAudio = resolveBilibiliAudio;
    this.now = now;
    this.index = this.emptyIndex();
    this.jobs = new Map();
    this.readers = new Map();
    this.writeChain = Promise.resolve();
    this.lastError = "";
    this.initialized = false;
  }

  emptyIndex() {
    return {
      version: INDEX_VERSION,
      settings: { enabled: true, capacityBytes: DEFAULT_CAPACITY_BYTES },
      entries: Object.create(null),
    };
  }

  async initialize() {
    if (this.initialized) return;
    await fsp.mkdir(this.assetsDir, { recursive: true, mode: 0o700 });
    this.index = await this.readIndex();
    await this.cleanupDisk();
    this.initialized = true;
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
    return {
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
    const handle = await fsp.open(temporary, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fsp.rename(temporary, this.indexPath);
  }

  serialize(operation) {
    const next = this.writeChain.then(operation, operation);
    this.writeChain = next.catch(() => {});
    return next;
  }

  status() {
    const entries = Object.values(this.index.entries);
    return {
      ok: true,
      supported: true,
      enabled: this.index.settings.enabled,
      capacityBytes: this.index.settings.capacityBytes,
      usedBytes: entries.reduce((total, entry) => total + entry.byteLength, 0),
      readyEntries: entries.length,
      queuedEntries: this.jobs.size,
      lastError: this.lastError || "",
    };
  }

  async configure({ enabled, capacityBytes } = {}) {
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
    if (enabled === false) this.jobs.forEach((job) => job.controller.abort());
    return this.serialize(async () => {
      if (typeof enabled === "boolean") this.index.settings.enabled = enabled;
      if (typeof capacityBytes !== "undefined")
        this.index.settings.capacityBytes = capacityBytes;
      await this.evictToCapacity(0);
      await this.persist();
      return this.status();
    });
  }

  entryResponse(cacheKey, entry) {
    return {
      cacheKey,
      url: `${CACHE_SCHEME}://audio/${cacheKey}`,
      bitrate: entry.bitrate,
      mimeType: entry.mimeType,
      audioId: entry.audioId,
    };
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
    const trackId = safeString(input.trackId, MAX_TRACK_ID_LENGTH);
    const stableKey = stableAudioKey(input);
    if (!trackId || !stableKey) return { ok: false, status: "invalid-input" };
    if (!this.index.settings.enabled) return { ok: true, status: "disabled" };
    const cacheKey = sha256(stableKey);
    const existing = this.index.entries[cacheKey];
    if (existing) {
      if (!existing.trackIds.includes(trackId)) {
        existing.trackIds.push(trackId);
        this.serialize(() => this.persist()).catch(() => {});
      }
      return { ok: true, status: "already-ready" };
    }
    if (this.jobs.has(cacheKey)) return { ok: true, status: "downloading" };
    const job = {
      ...input,
      trackId,
      stableKey,
      cacheKey,
      controller: new AbortController(),
    };
    this.jobs.set(cacheKey, job);
    this.serialize(() => this.runJob(job)).catch((error) => {
      this.lastError = error && error.code ? error.code : "download-failed";
    });
    return { ok: true, status: "queued" };
  }

  async runJob(job) {
    try {
      if (
        job.controller.signal.aborted ||
        !this.index.settings.enabled ||
        this.index.entries[job.cacheKey]
      )
        return;
      let audio = await this.resolveBilibiliAudio({
        ...job,
        forceRefresh: false,
      });
      try {
        await this.downloadAudio(job, audio);
      } catch (firstError) {
        if (job.controller.signal.aborted) throw firstError;
        audio = await this.resolveBilibiliAudio({ ...job, forceRefresh: true });
        await this.downloadAudio(job, audio);
      }
      this.lastError = "";
    } finally {
      this.jobs.delete(job.cacheKey);
    }
  }

  async evictToCapacity(requiredBytes) {
    const capacity = this.index.settings.capacityBytes;
    if (capacity === null) return;
    let used = this.status().usedBytes;
    const candidates = Object.entries(this.index.entries)
      .filter(([key]) => !this.readers.has(key) && !this.jobs.has(key))
      .sort(
        ([, left], [, right]) => left.lastAccessedAt - right.lastAccessedAt
      );
    for (const [key, entry] of candidates) {
      if (used + requiredBytes <= capacity) break;
      await fsp.unlink(this.filePath(key)).catch(() => {});
      delete this.index.entries[key];
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
    await this.evictToCapacity(contentLength || MAX_ENTRY_BYTES);
    const partPath = path.join(
      this.assetsDir,
      `${job.cacheKey}.${randomBytes(8).toString("hex")}.part`
    );
    const output = fs.createWriteStream(partPath, { flags: "wx", mode: 0o600 });
    const digest = createHash("sha256");
    let byteLength = 0;
    try {
      const readable = Readable.fromWeb(response.body);
      for await (const chunk of readable) {
        const buffer = Buffer.from(chunk);
        byteLength += buffer.length;
        if (byteLength > MAX_ENTRY_BYTES) {
          throw Object.assign(new Error("Audio file exceeded limit."), {
            code: "entry-too-large",
          });
        }
        digest.update(buffer);
        if (!output.write(buffer)) await once(output, "drain");
      }
      output.end();
      await once(output, "finish");
      if (!byteLength || (contentLength && byteLength !== contentLength)) {
        throw Object.assign(new Error("Incomplete audio download."), {
          code: "incomplete-download",
        });
      }
      const handle = await fsp.open(partPath, "r");
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
      const finalPath = this.filePath(job.cacheKey);
      await fsp.rename(partPath, finalPath);
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
        trackIds: [job.trackId],
      };
      await this.persist();
    } catch (error) {
      output.destroy();
      await fsp.unlink(partPath).catch(() => {});
      throw error;
    }
  }

  async delete(cacheKey) {
    await this.initialize();
    const key = safeCacheKey(cacheKey);
    const activeJob = this.jobs.get(key);
    if (activeJob) activeJob.controller.abort();
    if (!key || !this.index.entries[key]) return { ok: true, removed: false };
    return this.serialize(async () => {
      const entry = this.index.entries[key];
      if (!entry) return { ok: true, removed: false };
      delete this.index.entries[key];
      await fsp.unlink(this.filePath(key)).catch(() => {});
      await this.persist();
      return { ok: true, removed: true, removedBytes: entry.byteLength };
    });
  }

  async clear() {
    await this.initialize();
    this.jobs.forEach((job) => job.controller.abort());
    return this.serialize(async () => {
      const entries = Object.entries(this.index.entries);
      let removedBytes = 0;
      for (const [key, entry] of entries) {
        removedBytes += entry.byteLength;
        await fsp.unlink(this.filePath(key)).catch(() => {});
      }
      this.index.entries = Object.create(null);
      await this.persist();
      return { ok: true, removedEntries: entries.length, removedBytes };
    });
  }

  async deleteTrack(trackId) {
    await this.initialize();
    const safeTrackId = safeString(trackId, MAX_TRACK_ID_LENGTH);
    if (!safeTrackId) return { ok: false, status: "invalid-input" };
    const keys = Object.entries(this.index.entries)
      .filter(([, entry]) => entry.trackIds.includes(safeTrackId))
      .map(([key]) => key);
    let removedEntries = 0;
    let removedBytes = 0;
    for (const key of keys) {
      const result = await this.delete(key);
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
    const entry = this.index.entries[cacheKey];
    if (!entry) return new Response("Not found", { status: 404 });
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
          headers: { "Content-Range": `bytes */${stat.size}` },
        });
      }
      const start = range ? range.start : 0;
      const end = range ? range.end : stat.size - 1;
      const length = end - start + 1;
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
      return new Response("Not found", { status: 404 });
    }
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
};
