// Only these public diagnostics may cross the trusted lyric IPC boundary.
const NETWORK_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EPIPE",
  "ERR_STREAM_PREMATURE_CLOSE",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "ERR_SSL_WRONG_VERSION_NUMBER",
  "ERR_SSL_TLSV1_ALERT_PROTOCOL_VERSION",
]);
const NETWORK_STAGES = new Set(["dns", "connect", "tls", "response"]);
function networkDetails(error, fallbackStage) {
  const result = {};
  const stage = error && error.networkStage;
  if (NETWORK_STAGES.has(stage || fallbackStage))
    result.networkStage = stage || fallbackStage;
  const code =
    error &&
    (error.networkCode || error.code || (error.cause && error.cause.code));
  if (NETWORK_CODES.has(code)) result.networkCode = code;
  return result;
}
function clientIdentity() {
  const version = require("./package.json").version;
  return `Listen2/${version} (https://github.com/dazzlingwuming/listen2)`;
}
function lyricHeaders(hostname) {
  const identity = clientIdentity();
  return {
    "User-Agent": identity,
    ...(hostname === "lrclib.net" ? { "Lrclib-Client": identity } : {}),
  };
}
function parseRetryAfter(value, now = Date.now()) {
  if (typeof value !== "string" || value.length > 128) return undefined;
  const text = value.trim();
  let ms;
  if (/^\d+$/.test(text)) ms = Number(text) * 1000;
  else if (
    /^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(text)
  ) {
    const date = Date.parse(text);
    if (Number.isFinite(date)) ms = Math.max(0, date - now);
  }
  return Number.isSafeInteger(ms) && ms >= 0 ? ms : undefined;
}
module.exports = { networkDetails, lyricHeaders, parseRetryAfter };
