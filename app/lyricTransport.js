const ENDPOINTS = new Map([
  ["https://u.y.qq.com/cgi-bin/musicu.fcg", "https://y.qq.com/"],
  ["https://c.y.qq.com/soso/fcgi-bin/client_search_cp", "https://y.qq.com/"],
  [
    "https://i.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg",
    "https://y.qq.com/",
  ],
  ["https://music.163.com/api/search/get/web", "https://music.163.com/"],
  ["https://music.163.com/api/song/lyric", "https://music.163.com/"],
  ["https://lrclib.net/api/search", "https://lrclib.net/"],
  ["https://lyrics.kugou.com/search", "https://www.kugou.com/"],
  ["https://lyrics.kugou.com/download", "https://www.kugou.com/"],
  ["https://songsearch.kugou.com/song_search_v2", "https://www.kugou.com/"],
  ["https://www.kuwo.cn/search/searchMusicBykeyWord", "https://www.kuwo.cn/"],
  ["https://search.kuwo.cn/r.s", "https://www.kuwo.cn/"],
  ["https://m.kuwo.cn/newh5/singles/songinfoandlrc", "https://www.kuwo.cn/"],
]);
const LYRIC_HOSTS = new Set(
  Array.from(ENDPOINTS.keys(), (value) => new URL(value).hostname)
);
function isLyricHostname(value) {
  return typeof value === "string" && LYRIC_HOSTS.has(value);
}
function validateUrl(value) {
  if (typeof value !== "string" || value.length > 4096)
    throw new Error("Invalid lyric URL");
  const url = new URL(value);
  const key = `${url.origin}${url.pathname}`;
  if (!ENDPOINTS.has(key) || url.username || url.password || url.hash)
    throw new Error("Invalid lyric endpoint");
  if (url.hostname === "music.163.com") {
    const query = url.searchParams;
    const keys = [...query.keys()];
    const exactKeys = (expected) =>
      keys.length === expected.length &&
      expected.every((name) => query.has(name));
    const valid =
      url.pathname === "/api/search/get/web"
        ? exactKeys(["s", "type", "offset", "limit"]) &&
          query.get("s").trim().length > 0 &&
          query.get("s").length <= 256 &&
          query.get("type") === "1" &&
          query.get("offset") === "0" &&
          query.get("limit") === "20"
        : exactKeys(["id", "lv", "kv", "tv"]) &&
          /^\d{1,20}$/.test(query.get("id")) &&
          ["lv", "kv", "tv"].every((name) => query.get(name) === "-1");
    if (!valid) throw new Error("Invalid NetEase lyric request contract");
  }
  if (url.hostname === "u.y.qq.com") {
    let data;
    try {
      data = JSON.parse(url.searchParams.get("data"));
    } catch (_) {
      throw new Error("Invalid QQ search data");
    }
    const req = data && data.req;
    const param = req && req.param;
    const hasKeys = (value, keys) =>
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).length === keys.length &&
      keys.every((name) => Object.hasOwn(value, name));
    if (
      [...url.searchParams.keys()].length !== 1 ||
      !hasKeys(data, ["comm", "req"]) ||
      !hasKeys(data.comm, ["ct", "cv", "uin"]) ||
      data.comm.ct !== "19" ||
      data.comm.cv !== "1859" ||
      data.comm.uin !== "0" ||
      !hasKeys(req, ["method", "module", "param"]) ||
      req.method !== "DoSearchForQQMusicDesktop" ||
      req.module !== "music.search.SearchCgiService" ||
      !hasKeys(param, [
        "grp",
        "num_per_page",
        "page_num",
        "query",
        "search_type",
      ]) ||
      param.grp !== 1 ||
      param.num_per_page !== 20 ||
      param.page_num !== 1 ||
      param.search_type !== 0 ||
      typeof param.query !== "string" ||
      !param.query.trim() ||
      param.query.length > 256
    ) {
      throw new Error("Invalid QQ lyric search contract");
    }
  }
  return { url: url.href, referer: ENDPOINTS.get(key) };
}
const {
  networkDetails,
  lyricHeaders,
  parseRetryAfter,
} = require("./lyricRequestPolicy");
function aborted() {
  return Object.assign(new Error("Lyric request cancelled"), {
    name: "AbortError",
  });
}
function raceAbort(promise, signal) {
  return new Promise((resolve, reject) => {
    const finish = (error, value) => {
      signal.removeEventListener("abort", cancel);
      if (error) reject(error);
      else resolve(value);
    };
    const cancel = () => finish(aborted());
    signal.addEventListener("abort", cancel, { once: true });
    Promise.resolve(promise).then((value) => finish(null, value), finish);
    if (signal.aborted) cancel();
  });
}
function cancelBody(response) {
  if (response && response.body)
    Promise.resolve()
      .then(() => response.body.cancel())
      .catch(() => {});
}
function createLyricRequester({ now = Date.now } = {}) {
  // This queue belongs only to LRCLIB. Other sources retain their concurrency.
  let tail = Promise.resolve();
  let nextStart = 0;
  let cooldownFailure;
  return async function requestLyric(fetchImpl, value, signal) {
    const { url, referer } = validateUrl(value);
    const hostname = new URL(url).hostname;
    const lrclib = hostname === "lrclib.net";
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal) {
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    }
    const deadline = now() + 8000;
    const timer = setTimeout(abort, 8000);
    let attempts = 0;
    let requestStage;
    let lastFailure;
    const wait = async (ms) => {
      let timeout;
      try {
        await raceAbort(
          new Promise((resolve) => {
            timeout = setTimeout(resolve, ms);
          }),
          controller.signal
        );
      } finally {
        clearTimeout(timeout);
      }
    };
    const execute = async () => {
      for (;;) {
        if (now() >= deadline) abort();
        if (controller.signal.aborted) throw aborted();
        if (lrclib) {
          const delay = Math.max(0, nextStart - now());
          if (delay >= deadline - now()) {
            if (lastFailure) return lastFailure;
            if (cooldownFailure) {
              // A prior server cooldown also applies to a new search. No socket
              // was attempted for this caller, so omit its attempt count.
              const failure = { ...cooldownFailure };
              delete failure.attempts;
              return { ...failure, retryAfterMs: delay };
            }
          }
          if (delay) await wait(Math.min(delay, 8000));
          if (controller.signal.aborted) throw aborted();
        }
        let attempted = false;
        try {
          const response = await raceAbort(
            Promise.resolve()
              .then(() => {
                if (controller.signal.aborted) throw aborted();
                attempted = true;
                attempts += 1;
                return fetchImpl(url, {
                  signal: controller.signal,
                  onNetworkStage: (stage) => {
                    if (["dns", "connect", "tls", "response"].includes(stage))
                      requestStage = stage;
                  },
                  redirect: "error",
                  credentials: "omit",
                  headers: {
                    Referer: referer,
                    Accept: "application/json,text/plain",
                    ...lyricHeaders(hostname),
                  },
                });
              })
              .then((response) => {
                // Ignore and close an implementation's late headers after cancellation.
                if (controller.signal.aborted) {
                  cancelBody(response);
                  throw aborted();
                }
                return response;
              }),
            controller.signal
          );
          requestStage = "response";
          if (!response.ok) {
            const retryAfterMs = parseRetryAfter(
              response.headers && response.headers.get("retry-after"),
              now()
            );
            const retryable =
              lrclib && (response.status === 429 || response.status === 503);
            lastFailure = {
              ok: false,
              status: "unavailable",
              httpStatus: response.status,
              ...(retryable
                ? {
                    reason:
                      response.status === 429 ? "rate-limited" : "service-busy",
                  }
                : {}),
              ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
              networkStage: "response",
              attempts,
            };
            cancelBody(response);
            if (!retryable) return lastFailure;
            // Missing/malformed Retry-After uses one conservative, bounded second.
            nextStart = Math.max(
              nextStart,
              now() + (retryAfterMs === undefined ? 1000 : retryAfterMs)
            );
            cooldownFailure = lastFailure;
            if (attempts >= 2 || nextStart >= deadline) return lastFailure;
            continue;
          }
          if (!response.body) return { ok: true, data: "" };
          const reader = response.body.getReader();
          const chunks = [];
          let size = 0;
          try {
            for (;;) {
              const { done, value: chunk } = await raceAbort(
                reader.read(),
                controller.signal
              );
              if (controller.signal.aborted) throw aborted();
              if (done) break;
              size += chunk.byteLength;
              if (size > 2 * 1024 * 1024) {
                Promise.resolve()
                  .then(() => reader.cancel())
                  .catch(() => {});
                return {
                  ok: false,
                  status: "invalid-response",
                  networkStage: "response",
                  attempts,
                };
              }
              chunks.push(Buffer.from(chunk));
            }
          } catch (error) {
            Promise.resolve()
              .then(() => reader.cancel())
              .catch(() => {});
            throw error;
          }
          return { ok: true, data: Buffer.concat(chunks).toString("utf8") };
        } finally {
          // Leave room after the completed attempt (including body reading),
          // while preserving any longer server-specified cooldown. A queued
          // cancellation that never called fetch must not extend this clock.
          if (lrclib && attempted) nextStart = Math.max(nextStart, now() + 400);
        }
      }
    };
    try {
      const work = lrclib ? tail.then(execute) : execute();
      if (lrclib) tail = work.catch(() => {});
      return await raceAbort(work, controller.signal);
    } catch (error) {
      const details = networkDetails(error, requestStage);
      return {
        ok: false,
        status: controller.signal.aborted
          ? "timeout"
          : error && error.code === "LYRIC_INVALID_RESPONSE"
          ? "invalid-response"
          : "unavailable",
        ...(!controller.signal.aborted &&
        error &&
        error.code !== "LYRIC_INVALID_RESPONSE"
          ? { reason: "connection-failed" }
          : {}),
        ...details,
        ...(attempts ? { attempts } : {}),
      };
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", abort);
    }
  };
}
const requestLyric = createLyricRequester();
module.exports = {
  requestLyric,
  createLyricRequester,
  validateUrl,
  isLyricHostname,
};
