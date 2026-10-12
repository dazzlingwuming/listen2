const ENDPOINTS = new Map([
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
  ["https://m.kuwo.cn/newh5/singles/songinfoandlrc", "https://www.kuwo.cn/"],
]);
function validateUrl(value) {
  if (typeof value !== "string" || value.length > 4096)
    throw new Error("Invalid lyric URL");
  const url = new URL(value);
  const key = `${url.origin}${url.pathname}`;
  if (!ENDPOINTS.has(key) || url.username || url.password || url.hash)
    throw new Error("Invalid lyric endpoint");
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
      status: controller.signal.aborted ? "timeout" : "unavailable",
    };
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", abort);
  }
}
module.exports = { requestLyric, validateUrl };
