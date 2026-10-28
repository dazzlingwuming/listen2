const fs = require("fs");
const path = require("path");
const { randomBytes } = require("crypto");

const METADATA_URL =
  "https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=8&mkt=zh-CN";
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_CACHE_BYTES = 8 * 1024 * 1024 + 8192;
const MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const failure = (code) => Object.assign(new Error(code), { code });

function localDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(date.getDate()).padStart(2, "0")}`;
}
function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}
function sourceStartTime(value) {
  if (typeof value !== "string" || !/^\d{12}$/.test(value)) return null;
  const parsed = new Date(
    `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(
      6,
      8
    )}T${value.slice(8, 10)}:${value.slice(10, 12)}:00Z`
  );
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 16).replace(/[-T:]/g, "") !== value
  )
    return null;
  return parsed;
}
function plainText(value, maximum) {
  return typeof value === "string"
    ? value
        .replace(/<[^>]*>/g, "")
        .replace(/[\u0000-\u001f\u007f]/g, " ")
        .trim()
        .slice(0, maximum)
    : "";
}
function fixedUrl(value, pathname) {
  if (
    typeof value !== "string" ||
    value.length > 4096 ||
    !value.startsWith("https://www.bing.com/") ||
    /[\\\u0000-\u0020]/.test(value)
  )
    throw failure("invalid-source");
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "www.bing.com" ||
    url.port ||
    url.username ||
    url.password ||
    url.hash ||
    url.pathname !== pathname
  )
    throw failure("invalid-source");
  return url.href;
}
function imageUrl(value) {
  if (
    typeof value !== "string" ||
    !value.startsWith("/th?") ||
    value.startsWith("//")
  )
    throw failure("invalid-source");
  return fixedUrl(`https://www.bing.com${value}`, "/th");
}
function sniffMime(bytes) {
  if (
    bytes.length >= 3 &&
    bytes[0] === 255 &&
    bytes[1] === 216 &&
    bytes[2] === 255
  )
    return "image/jpeg";
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "image/png";
  if (
    bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  )
    return "image/webp";
  throw failure("invalid-image");
}

function createDailyWallpaperService({
  fetch,
  cacheDirectory,
  decodeImage,
  now = () => new Date(),
  totalTimeoutMs = 12000,
  metadataTimeoutMs = 4000,
  backoffMs = 30 * 60 * 1000,
}) {
  if (
    typeof fetch !== "function" ||
    typeof decodeImage !== "function" ||
    !cacheDirectory
  )
    throw new TypeError(
      "Daily wallpaper requires fetch, cacheDirectory and decodeImage"
    );
  const cachePath = path.join(cacheDirectory, "daily-wallpaper.json");
  let cached = null;
  let cacheLoad;
  let flight = null;
  let retryAfter = 0;
  let lastError = null;
  let cancellationGeneration = 0;
  const currentTime = () => new Date(now());
  const result = (requestedDate, status, errorCode) => {
    const record = cached && cached.date <= requestedDate ? cached : null;
    return {
      ok: Boolean(record),
      status: record ? status : "unavailable",
      requestedDate,
      wallpaper: record
        ? {
            version: 1,
            date: record.date,
            sourceDate: record.sourceDate,
            image: `data:${record.mime};base64,${record.base64}`,
            title: record.title,
            copyright: record.copyright,
            attributionUrl: record.attributionUrl,
          }
        : null,
      ...(errorCode ? { errorCode } : {}),
    };
  };
  async function validateImage(bytes, mime) {
    if (
      !MIME_TYPES.has(mime) ||
      !bytes.length ||
      bytes.length > MAX_IMAGE_BYTES ||
      sniffMime(bytes) !== mime
    )
      throw failure("invalid-image");
    const decoded = await decodeImage(bytes);
    if (
      !decoded ||
      (typeof decoded.isEmpty === "function" && decoded.isEmpty())
    )
      throw failure("invalid-image");
    const size =
      typeof decoded.getSize === "function" ? decoded.getSize() : decoded;
    if (
      !Number.isInteger(size.width) ||
      !Number.isInteger(size.height) ||
      size.width <= 0 ||
      size.height <= 0 ||
      size.width * size.height > 40000000
    )
      throw failure("invalid-image");
  }
  async function validateRecord(record) {
    if (
      !record ||
      record.version !== 1 ||
      !validDate(record.date) ||
      record.sourceDate !== record.date ||
      !MIME_TYPES.has(record.mime) ||
      typeof record.base64 !== "string" ||
      !record.base64.length ||
      record.base64.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 ||
      record.base64.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(record.base64)
    )
      throw failure("invalid-cache");
    if (
      typeof record.title !== "string" ||
      record.title !== plainText(record.title, 240) ||
      typeof record.copyright !== "string" ||
      record.copyright !== plainText(record.copyright, 600) ||
      fixedUrl(record.attributionUrl, "/search") !== record.attributionUrl
    )
      throw failure("invalid-cache");
    const bytes = Buffer.from(record.base64, "base64");
    if (bytes.toString("base64") !== record.base64)
      throw failure("invalid-cache");
    await validateImage(bytes, record.mime);
    return record;
  }
  async function loadCache() {
    if (!cacheLoad)
      cacheLoad = (async () => {
        let handle;
        try {
          handle = await fs.promises.open(cachePath, "r");
          const stat = await handle.stat();
          if (!stat.isFile() || stat.size > MAX_CACHE_BYTES)
            throw failure("invalid-cache");
          const bytes = Buffer.alloc(stat.size + 1);
          const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
          if (bytesRead !== stat.size) throw failure("invalid-cache");
          cached = await validateRecord(
            JSON.parse(bytes.subarray(0, bytesRead).toString("utf8"))
          );
        } catch (error) {
          if (error.code !== "ENOENT") lastError = "invalid-cache";
        } finally {
          if (handle) await handle.close();
        }
      })();
    await cacheLoad;
  }
  function ensureActive(operation) {
    if (operation.controller.signal.aborted)
      throw failure(operation.reason || "cancelled");
  }
  function bounded(operation, promise, timeoutMs) {
    let timer;
    let onAbort;
    const boundary = new Promise((resolve, reject) => {
      onAbort = () => reject(failure(operation.reason || "cancelled"));
      operation.controller.signal.addEventListener("abort", onAbort, {
        once: true,
      });
      if (timeoutMs)
        timer = setTimeout(() => reject(failure("timeout")), timeoutMs);
      if (operation.controller.signal.aborted) onAbort();
    });
    return Promise.race([promise, boundary]).finally(() => {
      clearTimeout(timer);
      operation.controller.signal.removeEventListener("abort", onAbort);
    });
  }
  async function requestBytes(url, maximum, operation) {
    ensureActive(operation);
    const response = await bounded(
      operation,
      Promise.resolve().then(() =>
        fetch(url, {
          signal: operation.controller.signal,
          redirect: "error",
          credentials: "omit",
          cache: "no-store",
        })
      )
    );
    ensureActive(operation);
    if (
      !response ||
      !response.ok ||
      response.redirected ||
      (response.url && response.url !== url)
    )
      throw failure("http-error");
    const length = response.headers.get("content-length");
    if (length && (!/^\d+$/.test(length) || Number(length) > maximum))
      throw failure("response-too-large");
    if (!response.body || typeof response.body.getReader !== "function")
      throw failure("invalid-response");
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      for (;;) {
        const next = await bounded(operation, reader.read());
        ensureActive(operation);
        if (next.done) break;
        const chunk = Buffer.from(next.value);
        size += chunk.length;
        if (size > maximum) throw failure("response-too-large");
        chunks.push(chunk);
      }
    } finally {
      // Never let an uncooperative stream delay timeout/cancellation.
      Promise.resolve()
        .then(() => reader.cancel())
        .catch(() => {});
    }
    return {
      bytes: Buffer.concat(chunks, size),
      mime: (response.headers.get("content-type") || "")
        .split(";")[0]
        .trim()
        .toLowerCase(),
    };
  }
  async function publish(record, operation) {
    ensureActive(operation);
    await fs.promises.mkdir(cacheDirectory, { recursive: true });
    ensureActive(operation);
    const temporaryPath = `${cachePath}.${randomBytes(8).toString("hex")}.tmp`;
    try {
      await fs.promises.writeFile(temporaryPath, JSON.stringify(record), {
        flag: "wx",
        mode: 0o600,
      });
      ensureActive(operation);
      // No async gap between the cancellation check and atomic publication.
      fs.renameSync(temporaryPath, cachePath);
      cached = record;
    } finally {
      await fs.promises.unlink(temporaryPath).catch(() => {});
    }
  }
  async function refresh(operation, requestedDate) {
    const timeout = setTimeout(() => {
      operation.reason = "timeout";
      operation.controller.abort();
    }, totalTimeoutMs);
    try {
      const metadata = await bounded(
        operation,
        requestBytes(METADATA_URL, 64 * 1024, operation),
        metadataTimeoutMs
      );
      if (metadata.mime !== "application/json")
        throw failure("invalid-metadata");
      let parsed;
      try {
        parsed = JSON.parse(metadata.bytes.toString("utf8"));
      } catch (_) {
        throw failure("invalid-metadata");
      }
      const availableAt = currentTime().getTime();
      const entry =
        Array.isArray(parsed.images) &&
        parsed.images.find((candidate) => {
          if (!candidate || candidate.wp !== true) return false;
          // Bing fullstartdate is the UTC activation time; startdate is a label.
          const startsAt = sourceStartTime(candidate.fullstartdate);
          return (
            startsAt &&
            startsAt.getTime() <= availableAt &&
            localDate(startsAt) === requestedDate
          );
        });
      if (!entry) throw failure("no-eligible-image");
      const sourceUrl = imageUrl(entry.url);
      const attributionUrl = fixedUrl(entry.copyrightlink, "/search");
      const image = await requestBytes(sourceUrl, MAX_IMAGE_BYTES, operation);
      await bounded(operation, validateImage(image.bytes, image.mime));
      ensureActive(operation);
      const record = {
        version: 1,
        date: requestedDate,
        // Keep both cache dates normalized to the local day for v1 compatibility.
        sourceDate: requestedDate,
        mime: image.mime,
        base64: image.bytes.toString("base64"),
        title: plainText(entry.title, 240),
        copyright: plainText(entry.copyright, 600),
        attributionUrl,
      };
      await publish(record, operation);
      retryAfter = 0;
      lastError = null;
      return result(requestedDate, "fresh");
    } catch (error) {
      // Abort the underlying transport when a stage deadline wins the race.
      if (!operation.controller.signal.aborted) {
        operation.reason = error.code === "timeout" ? "timeout" : "failed";
        operation.controller.abort();
      }
      const code = error.code || "fetch-failed";
      if (code !== "cancelled") {
        retryAfter = currentTime().getTime() + backoffMs;
        lastError = code;
      }
      return result(requestedDate, "stale", code);
    } finally {
      clearTimeout(timeout);
    }
  }
  async function get({ refresh: shouldRefresh = true } = {}) {
    const generation = cancellationGeneration;
    await loadCache();
    const requestedDate = localDate(currentTime());
    if (shouldRefresh && generation !== cancellationGeneration)
      return result(requestedDate, "stale", "cancelled");
    if (cached && cached.date === requestedDate)
      return result(requestedDate, "cached");
    if (!shouldRefresh)
      return result(requestedDate, "stale", lastError || undefined);
    if (flight) return flight.promise;
    if (currentTime().getTime() < retryAfter)
      return result(requestedDate, "stale", lastError || "backoff");
    const operation = { controller: new AbortController(), reason: null };
    flight = operation;
    operation.promise = refresh(operation, requestedDate).finally(() => {
      if (flight === operation) flight = null;
    });
    return operation.promise;
  }
  function cancel() {
    cancellationGeneration += 1;
    if (flight) {
      flight.reason = "cancelled";
      flight.controller.abort();
    }
  }
  return { get, cancel };
}

function registerDailyWallpaperIpc({
  ipcMain,
  getMainWindow,
  mainUrl,
  getService,
}) {
  const trusted = (event) => {
    const window = getMainWindow();
    if (
      !window ||
      window.isDestroyed() ||
      !event ||
      event.sender !== window.webContents ||
      !event.senderFrame ||
      event.senderFrame !== window.webContents.mainFrame
    )
      return false;
    try {
      const actual = new URL(event.senderFrame.url);
      const expected = new URL(mainUrl);
      // A fragment is an anchor within this same player document.
      actual.hash = "";
      expected.hash = "";
      return actual.protocol === "file:" && actual.href === expected.href;
    } catch (_) {
      return false;
    }
  };
  ipcMain.handle("daily-wallpaper:get", (event, payload) => {
    if (!trusted(event))
      return {
        ok: false,
        status: "unavailable",
        errorCode: "untrusted-sender",
      };
    if (
      !payload ||
      typeof payload !== "object" ||
      Array.isArray(payload) ||
      typeof payload.refresh !== "boolean" ||
      Object.keys(payload).some((key) => key !== "refresh")
    )
      return { ok: false, status: "unavailable", errorCode: "invalid-request" };
    return getService().get({ refresh: payload.refresh });
  });
  ipcMain.on("daily-wallpaper:cancel", (event) => {
    if (trusted(event)) getService().cancel();
  });
}
module.exports = { createDailyWallpaperService, registerDailyWallpaperIpc };
