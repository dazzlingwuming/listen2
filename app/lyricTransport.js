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
          ["1", "1000"].includes(query.get("type")) &&
          /^(0|[1-9]\d{0,3})$/.test(query.get("offset")) &&
          Number(query.get("offset")) <= 1980 &&
          Number(query.get("offset")) % 20 === 0 &&
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
async function requestLyric(fetchImpl, value, signal) {
  const { url, referer } = validateUrl(value);
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal) {
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  }
  const timer = setTimeout(abort, 8000);
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      redirect: "error",
      credentials: "omit",
      headers: {
        Referer: referer,
        Accept: "application/json,text/plain",
        "User-Agent": "Listen2/2.35.1 (desktop lyrics)",
      },
    });
    if (!response.ok)
      return { ok: false, status: "unavailable", httpStatus: response.status };
    // Bound decoded body size as well as Content-Length.
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      size += chunk.byteLength;
      if (size > 2 * 1024 * 1024) {
        await reader.cancel();
        return { ok: false, status: "invalid-response" };
      }
      chunks.push(Buffer.from(chunk));
    }
    return { ok: true, data: Buffer.concat(chunks).toString("utf8") };
  } catch (error) {
    return {
      ok: false,
      status: controller.signal.aborted
        ? "timeout"
        : error && error.code === "LYRIC_INVALID_RESPONSE"
        ? "invalid-response"
        : "unavailable",
    };
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", abort);
  }
}
module.exports = { requestLyric, validateUrl, isLyricHostname };
