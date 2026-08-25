const { createHash, randomBytes } = require("crypto");
const fsp = require("fs/promises");
const { parseBuffer } = require("music-metadata");
const path = require("path");
const { pathToFileURL } = require("url");
const {
  ANALYZER_VERSION,
  MAX_CHANNELS,
  MAX_DECODED_SAMPLE_VALUES,
  MAX_DURATION_SECONDS,
} = require("./loudnessAnalyzerRenderer");

const READ_CHANNEL = "loudness-analyzer:read-input";
const RESULT_CHANNEL = "loudness-analyzer:result";
const MAX_ANALYZER_FILE_BYTES = 96 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 120 * 1000;
const DEFAULT_IDLE_DELAY_MS = 1500;

function analyzerError(code, message) {
  return Object.assign(new Error(message || code), { code });
}

function safeAnalyzerErrorCode(error) {
  const code = String((error && error.code) || "analysis-input-failed");
  return /^[a-z0-9-]{1,80}$/.test(code) ? code : "analysis-input-failed";
}

function invalidIsoBmff(message) {
  return analyzerError("invalid-isobmff", message || "Invalid ISO-BMFF data.");
}

function parseSidxBoxDuration(bytes, boxStart, headerSize, boxSize) {
  const boxEnd = boxStart + boxSize;
  let cursor = boxStart + headerSize;
  if (cursor + 12 > boxEnd) throw invalidIsoBmff("Truncated sidx header.");
  const version = bytes[cursor];
  if (version !== 0 && version !== 1) {
    throw invalidIsoBmff("Unsupported sidx version.");
  }
  cursor += 4; // version and flags
  cursor += 4; // reference_ID
  const timescale = bytes.readUInt32BE(cursor);
  cursor += 4;
  if (!timescale) throw invalidIsoBmff("Invalid sidx timescale.");
  const timeFieldBytes = version === 0 ? 8 : 16;
  if (cursor + timeFieldBytes + 4 > boxEnd) {
    throw invalidIsoBmff("Truncated sidx timing fields.");
  }
  cursor += timeFieldBytes; // earliest_presentation_time and first_offset
  cursor += 2; // reserved
  const referenceCount = bytes.readUInt16BE(cursor);
  cursor += 2;
  if (!referenceCount || cursor + referenceCount * 12 !== boxEnd) {
    throw invalidIsoBmff("Invalid sidx reference table bounds.");
  }
  let durationUnits = 0n;
  for (let index = 0; index < referenceCount; index += 1) {
    const reference = bytes.readUInt32BE(cursor);
    const hierarchical = (reference & 0x80000000) !== 0;
    const referencedSize = reference & 0x7fffffff;
    const subsegmentDuration = bytes.readUInt32BE(cursor + 4);
    if (hierarchical) {
      throw analyzerError(
        "unsupported-sidx-reference",
        "Hierarchical sidx references are unsupported."
      );
    }
    if (!referencedSize || !subsegmentDuration) {
      throw invalidIsoBmff("Invalid sidx media reference.");
    }
    durationUnits += BigInt(subsegmentDuration);
    if (durationUnits > BigInt(MAX_DURATION_SECONDS) * BigInt(timescale)) {
      throw analyzerError(
        "audio-too-long",
        "Cached audio exceeds the analysis duration limit."
      );
    }
    cursor += 12;
  }
  return Number(durationUnits) / timescale;
}

function parseTopLevelSidxDuration(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value || []);
  let offset = 0;
  let duration = null;
  while (offset < bytes.length) {
    if (bytes.length - offset < 8) {
      throw invalidIsoBmff("Truncated top-level box header.");
    }
    const size32 = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    let headerSize = 8;
    let boxSize;
    if (size32 === 1) {
      if (bytes.length - offset < 16) {
        throw invalidIsoBmff("Truncated extended box size.");
      }
      const extendedSize = bytes.readBigUInt64BE(offset + 8);
      if (extendedSize > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw invalidIsoBmff("Top-level box is too large.");
      }
      boxSize = Number(extendedSize);
      headerSize = 16;
    } else if (size32 === 0) {
      boxSize = bytes.length - offset;
    } else {
      boxSize = size32;
    }
    if (
      boxSize < headerSize ||
      boxSize > bytes.length - offset ||
      !Number.isSafeInteger(boxSize)
    ) {
      throw invalidIsoBmff("Invalid top-level box bounds.");
    }
    if (type === "sidx") {
      if (duration !== null) {
        throw invalidIsoBmff("Multiple top-level sidx boxes are unsupported.");
      }
      duration = parseSidxBoxDuration(bytes, offset, headerSize, boxSize);
    }
    offset += boxSize;
  }
  return duration;
}

class LoudnessAnalyzer {
  constructor({
    BrowserWindow,
    ipcMain,
    pagePath = path.join(__dirname, "loudnessAnalyzer.html"),
    preloadPath = path.join(__dirname, "loudnessAnalyzerPreload.js"),
    maxFileBytes = MAX_ANALYZER_FILE_BYTES,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    idleDelayMs = DEFAULT_IDLE_DELAY_MS,
    parseAudioMetadata = parseBuffer,
    openFile = (filePath, flags) => fsp.open(filePath, flags),
  }) {
    if (!BrowserWindow || !ipcMain) {
      throw analyzerError(
        "invalid-electron-runtime",
        "Electron analyzer dependencies are missing."
      );
    }
    this.BrowserWindow = BrowserWindow;
    this.ipcMain = ipcMain;
    this.pagePath = pagePath;
    this.preloadPath = preloadPath;
    this.maxFileBytes = maxFileBytes;
    this.timeoutMs = timeoutMs;
    this.idleDelayMs = idleDelayMs;
    this.parseAudioMetadata = parseAudioMetadata;
    this.openFile = openFile;
    this.version = ANALYZER_VERSION;
    this.queue = [];
    this.current = null;
    this.pumpTimer = null;
    this.closed = false;

    this.readHandler = this.handleReadInput.bind(this);
    this.resultHandler = this.handleResult.bind(this);
    this.ipcMain.handle(READ_CHANNEL, this.readHandler);
    this.ipcMain.on(RESULT_CHANNEL, this.resultHandler);
  }

  analyze(input = {}) {
    if (this.closed) {
      return Promise.reject(
        analyzerError("analyzer-shutdown", "Analyzer is shut down.")
      );
    }
    const cacheKey = String(input.cacheKey || "");
    const contentSha256 = String(input.contentSha256 || "");
    const filePath = typeof input.filePath === "string" ? input.filePath : "";
    if (
      !/^[a-f0-9]{64}$/.test(cacheKey) ||
      !/^[a-f0-9]{64}$/.test(contentSha256) ||
      !path.isAbsolute(filePath)
    ) {
      return Promise.reject(
        analyzerError("invalid-input", "Invalid analyzer input.")
      );
    }
    return new Promise((resolve, reject) => {
      this.queue.push({ cacheKey, contentSha256, filePath, resolve, reject });
      this.schedulePump();
    });
  }

  schedulePump() {
    if (this.closed || this.current || this.pumpTimer || !this.queue.length)
      return;
    this.pumpTimer = setTimeout(() => {
      this.pumpTimer = null;
      this.pump();
    }, this.idleDelayMs);
    if (typeof this.pumpTimer.unref === "function") this.pumpTimer.unref();
  }

  async pump() {
    if (this.closed || this.current || !this.queue.length) return;
    const job = this.queue.shift();
    this.current = job;
    try {
      await this.startJob(job);
    } catch (error) {
      this.finishCurrent(job, error);
    }
  }

  async startJob(job) {
    const stat = await fsp.stat(job.filePath);
    if (!stat.isFile() || stat.size <= 0) {
      throw analyzerError(
        "analysis-file-missing",
        "Cached audio file is missing."
      );
    }
    if (stat.size > this.maxFileBytes) {
      throw analyzerError(
        "analysis-file-too-large",
        "Cached audio exceeds analysis limits."
      );
    }
    if (this.current !== job || this.closed) {
      throw analyzerError("analysis-cancelled", "Analysis was cancelled.");
    }
    const token = randomBytes(24).toString("hex");
    job.token = token;
    job.byteLength = stat.size;
    const window = new this.BrowserWindow({
      show: false,
      width: 1,
      height: 1,
      skipTaskbar: true,
      webPreferences: {
        preload: this.preloadPath,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        backgroundThrottling: false,
      },
    });
    job.window = window;
    window.setMenu(null);
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    const trustedPageUrl = pathToFileURL(this.pagePath).toString();
    window.webContents.on("will-navigate", (event, targetUrl) => {
      if (targetUrl.split("?", 1)[0] !== trustedPageUrl) event.preventDefault();
    });
    window.webContents.once("did-fail-load", () => {
      this.finishCurrent(
        job,
        analyzerError("analyzer-page-failed", "Analyzer page failed to load.")
      );
    });
    window.webContents.once("render-process-gone", () => {
      this.finishCurrent(
        job,
        analyzerError("analyzer-renderer-gone", "Analyzer renderer stopped.")
      );
    });
    window.once("closed", () => {
      if (this.current === job && !job.settled) {
        this.finishCurrent(
          job,
          analyzerError("analysis-cancelled", "Analyzer window closed.")
        );
      }
    });
    job.timeout = setTimeout(() => {
      this.finishCurrent(
        job,
        analyzerError("analysis-timeout", "Loudness analysis timed out.")
      );
    }, this.timeoutMs);
    await window.loadFile(this.pagePath, { query: { token } });
  }

  async handleReadInput(event, token) {
    try {
      const input = await this.readApprovedInput(event, token);
      return { ok: true, ...input };
    } catch (error) {
      return { ok: false, errorCode: safeAnalyzerErrorCode(error) };
    }
  }

  async readApprovedInput(event, token) {
    const job = this.current;
    if (
      !job ||
      job.settled ||
      token !== job.token ||
      !job.window ||
      job.window.isDestroyed() ||
      event.sender !== job.window.webContents
    ) {
      throw analyzerError(
        "untrusted-analyzer-request",
        "Analyzer request was rejected."
      );
    }
    const bytes = await this.readBoundedFile(job);
    if (
      createHash("sha256").update(bytes).digest("hex") !== job.contentSha256
    ) {
      throw analyzerError(
        "analysis-content-mismatch",
        "Cached audio hash does not match its index entry."
      );
    }
    let metadata;
    try {
      metadata = await this.parseAudioMetadata(
        bytes,
        { mimeType: "audio/mp4", size: bytes.length },
        { duration: true, skipCovers: true }
      );
    } catch (error) {
      throw analyzerError(
        "audio-metadata-failed",
        "Cached audio metadata could not be read."
      );
    }
    const format = metadata && metadata.format;
    const metadataDuration = Number(format && format.duration);
    const durationSeconds =
      Number.isFinite(metadataDuration) && metadataDuration > 0
        ? metadataDuration
        : parseTopLevelSidxDuration(bytes);
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      throw analyzerError(
        "invalid-audio-duration",
        "Cached audio duration is unavailable or invalid."
      );
    }
    if (durationSeconds > MAX_DURATION_SECONDS) {
      throw analyzerError(
        "audio-too-long",
        "Cached audio exceeds the analysis duration limit."
      );
    }
    const channelCount = Number(format && format.numberOfChannels);
    if (
      !Number.isSafeInteger(channelCount) ||
      channelCount <= 0 ||
      channelCount > MAX_CHANNELS
    ) {
      throw analyzerError(
        "unsupported-channel-layout",
        "Cached audio has an unsupported channel layout."
      );
    }
    const sourceSampleRate = Number(format && format.sampleRate);
    if (sourceSampleRate !== 48000) {
      throw analyzerError(
        "unsupported-sample-rate",
        "This analyzer version supports 48 kHz source audio only."
      );
    }
    if (
      durationSeconds * sourceSampleRate * channelCount >
      MAX_DECODED_SAMPLE_VALUES
    ) {
      throw analyzerError(
        "decoded-audio-too-large",
        "Decoded audio would exceed the analysis memory limit."
      );
    }
    return { bytes, sourceSampleRate };
  }

  async readBoundedFile(job) {
    let handle;
    try {
      handle = await this.openFile(job.filePath, "r");
      const before = await handle.stat();
      if (
        !before.isFile() ||
        !Number.isSafeInteger(before.size) ||
        before.size <= 0 ||
        before.size !== job.byteLength ||
        before.size > this.maxFileBytes
      ) {
        throw analyzerError(
          "analysis-file-changed",
          "Cached audio changed before analysis."
        );
      }
      const bytes = Buffer.alloc(before.size);
      let offset = 0;
      while (offset < bytes.length) {
        const { bytesRead } = await handle.read(
          bytes,
          offset,
          bytes.length - offset,
          offset
        );
        if (!bytesRead) {
          throw analyzerError(
            "analysis-file-changed",
            "Cached audio changed while being read."
          );
        }
        offset += bytesRead;
      }
      const after = await handle.stat();
      if (!after.isFile() || after.size !== before.size) {
        throw analyzerError(
          "analysis-file-changed",
          "Cached audio changed while being read."
        );
      }
      return bytes;
    } finally {
      if (handle) await handle.close();
    }
  }

  handleResult(event, token, payload) {
    const job = this.current;
    if (
      !job ||
      job.settled ||
      token !== job.token ||
      !job.window ||
      job.window.isDestroyed() ||
      event.sender !== job.window.webContents
    ) {
      return;
    }
    if (!payload || payload.ok !== true || !payload.result) {
      const code = String(
        (payload && payload.errorCode) || "decode-or-analysis-failed"
      );
      this.finishCurrent(job, analyzerError(code, "Loudness analysis failed."));
      return;
    }
    this.finishCurrent(job, null, payload.result);
  }

  finishCurrent(job, error, result) {
    if (!job || this.current !== job || job.settled) return;
    job.settled = true;
    this.current = null;
    clearTimeout(job.timeout);
    if (job.window && !job.window.isDestroyed()) job.window.destroy();
    if (error) job.reject(error);
    else job.resolve(result);
    this.schedulePump();
  }

  cancel(cacheKey) {
    const key = String(cacheKey || "");
    const kept = [];
    for (const job of this.queue) {
      if (job.cacheKey === key) {
        job.reject(
          analyzerError("analysis-cancelled", "Analysis was cancelled.")
        );
      } else {
        kept.push(job);
      }
    }
    this.queue = kept;
    if (this.current && this.current.cacheKey === key) {
      this.finishCurrent(
        this.current,
        analyzerError("analysis-cancelled", "Analysis was cancelled.")
      );
    }
  }

  cancelAll() {
    for (const job of this.queue.splice(0)) {
      job.reject(
        analyzerError("analysis-cancelled", "Analysis was cancelled.")
      );
    }
    if (this.current) {
      this.finishCurrent(
        this.current,
        analyzerError("analysis-cancelled", "Analysis was cancelled.")
      );
    }
    if (this.pumpTimer) clearTimeout(this.pumpTimer);
    this.pumpTimer = null;
  }

  shutdown() {
    if (this.closed) return;
    this.closed = true;
    this.cancelAll();
    this.ipcMain.removeHandler(READ_CHANNEL);
    this.ipcMain.removeListener(RESULT_CHANNEL, this.resultHandler);
  }
}

module.exports = {
  ANALYZER_VERSION,
  DEFAULT_IDLE_DELAY_MS,
  DEFAULT_TIMEOUT_MS,
  LoudnessAnalyzer,
  MAX_ANALYZER_FILE_BYTES,
  READ_CHANNEL,
  RESULT_CHANNEL,
  parseTopLevelSidxDuration,
};
