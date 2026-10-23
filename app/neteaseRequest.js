const { requestLyric } = require("./lyricTransport");

// A malformed successful search response is not a verification challenge.
// Retry that public read once without cookies; keep the user's session intact.
async function requestNetease({
  url,
  signal,
  neteaseSession,
  publicFetch,
  request = requestLyric,
}) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal) {
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  }
  const timer = setTimeout(abort, 8000);
  try {
    const result = await neteaseSession.observeResult(
      await request(
        neteaseSession.fetch.bind(neteaseSession),
        url,
        controller.signal
      ),
      url
    );
    if (controller.signal.aborted) return { ok: false, status: "timeout" };
    if (!result.ok || new URL(url).pathname !== "/api/search/get/web")
      return result;
    let payload;
    try {
      payload = JSON.parse(result.data);
    } catch (_) {
      return result;
    }
    if (Number(payload.code) !== 200 || typeof payload.result !== "string")
      return result;
    const retry = await neteaseSession.observeResult(
      await request(publicFetch, url, controller.signal),
      url
    );
    if (controller.signal.aborted) return { ok: false, status: "timeout" };
    if (!retry.ok)
      return retry.status === "verification-required" ? retry : result;
    try {
      const data = JSON.parse(retry.data);
      if (
        Number(data.code) === 200 &&
        data.result &&
        typeof data.result === "object" &&
        !Array.isArray(data.result)
      )
        return retry;
    } catch (_) {
      /* Preserve the original invalid response for the caller. */
    }
    return result;
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", abort);
  }
}
module.exports = { requestNetease };
