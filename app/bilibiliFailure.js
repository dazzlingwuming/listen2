const BILIBILI_PERMANENT_ERROR_CODES = new Set([
  "invalid-bvid",
  "invalid-cid",
  "missing-cid",
  "no-audio-stream",
  "no-compatible-audio-stream",
  "not-found",
  "private-video",
  "auth-required",
]);

const BILIBILI_NETWORK_ERROR_CODES = new Set([
  "ECONNABORTED",
  "ECONNRESET",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ENETDOWN",
  "ENETUNREACH",
  "ENOTFOUND",
  "ETIMEDOUT",
]);

function getSafeBilibiliStatus(error) {
  const status = String((error && (error.code || error.status)) || "");
  return /^[a-z0-9-]{1,64}$/i.test(status)
    ? status.toLowerCase()
    : "request-failed";
}

function getSafeBilibiliNumber(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : 0;
}

function classifyBilibiliFailure(error, status, httpStatus, bilibiliCode) {
  const errorCode = String((error && error.code) || "");
  if (BILIBILI_PERMANENT_ERROR_CODES.has(status)) {
    return { kind: status, retryable: false };
  }
  if (httpStatus === 404 || httpStatus === 410 || bilibiliCode === -404) {
    return { kind: "not-found", retryable: false };
  }
  if (bilibiliCode === -101) {
    return { kind: "auth-required", retryable: false };
  }
  if (status === "request-timeout" || errorCode === "ETIMEDOUT") {
    return { kind: "timeout", retryable: true };
  }
  if (
    BILIBILI_NETWORK_ERROR_CODES.has(errorCode) ||
    (error && error.name === "TypeError")
  ) {
    return { kind: "network", retryable: true };
  }
  if (httpStatus === 429) {
    return { kind: "rate-limited", retryable: true };
  }
  if (httpStatus >= 500 && httpStatus <= 599) {
    return { kind: "server", retryable: true };
  }
  // -412 is Bilibili's anti-bot/WBI verification response. The service already
  // retries it with a fresh WBI key once; callers may safely make one bounded
  // retry if that refresh still fails. -403 is treated the same because it can
  // be returned while a signed media request is being refreshed.
  if (bilibiliCode === -412 || bilibiliCode === -403) {
    return { kind: "request-rejected", retryable: true };
  }
  return { kind: "unavailable", retryable: true };
}

function getBilibiliFailureMessage(kind) {
  const messages = {
    "auth-required": "This Bilibili resource requires account access.",
    "no-audio-stream": "No playable Bilibili audio stream is available.",
    "no-compatible-audio-stream":
      "No compatible Bilibili audio stream is available.",
    "not-found": "This Bilibili resource is no longer available.",
    "private-video": "This Bilibili resource is private.",
    "rate-limited": "Bilibili is temporarily rate limiting requests.",
    "request-rejected": "Bilibili temporarily rejected this request.",
    server: "Bilibili is temporarily unavailable.",
    timeout: "The Bilibili request timed out.",
    network: "The network request to Bilibili failed.",
    unavailable: "The Bilibili media request failed.",
  };
  return messages[kind] || messages.unavailable;
}

function createBilibiliFailure(error, stage = "bilibili") {
  const status = getSafeBilibiliStatus(error);
  const httpStatus = getSafeBilibiliNumber(error && error.httpStatus);
  const bilibiliCode = getSafeBilibiliNumber(error && error.bilibiliCode);
  const classification = classifyBilibiliFailure(
    error,
    status,
    httpStatus,
    bilibiliCode
  );
  return {
    ok: false,
    stage,
    kind: classification.kind,
    status,
    httpStatus,
    bilibiliCode,
    retryable: classification.retryable,
    // Do not forward error.message: request URLs can include signed media
    // parameters and cookies must never cross the IPC boundary.
    message: getBilibiliFailureMessage(classification.kind),
  };
}

module.exports = {
  createBilibiliFailure,
};
