const https = require("node:https");
const net = require("node:net");
const tls = require("node:tls");
const { validateUrl, isLyricHostname } = require("./lyricTransport");
const { networkDetails, lyricHeaders } = require("./lyricRequestPolicy");

const DNS_ENDPOINTS = [
  "https://dns.alidns.com/resolve",
  "https://dns.google/resolve",
  "https://cloudflare-dns.com/dns-query",
];
const MAX_DNS_BYTES = 64 * 1024;
const DNS_ATTEMPT_TIMEOUT_MS = 2000;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
// Preserve the existing public Kugou client header formerly applied by
// Electron webRequest; independent sockets do not pass through that hook.
const KUGOU_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 14_3 like Mac OS X) AppleWebKit/534.30 (KHTML, like Gecko) Version/4.0 Mobile Safari/534.30";

function transportError(code = "LYRIC_UNAVAILABLE", stage, cause) {
  return Object.assign(new Error("Lyric transport failed"), {
    code,
    ...networkDetails(cause, stage),
  });
}
function responseHeaders(response) {
  const retryAfter = response.headers["retry-after"];
  return typeof retryAfter === "string" && retryAfter.length <= 128
    ? { "Retry-After": retryAfter }
    : {};
}
function abortError() {
  return Object.assign(new Error("Lyric request cancelled"), {
    name: "AbortError",
  });
}
function withAbort(promise, signal) {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const finish = (error, value) => {
      signal.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve(value);
    };
    const abort = () => finish(abortError());
    signal.addEventListener("abort", abort, { once: true });
    // Observe the underlying operation even when cancellation wins the race.
    Promise.resolve(promise).then((value) => finish(null, value), finish);
    if (signal.aborted) abort();
  });
}

// Reject local, special-purpose, documentation and proxy fake-IP ranges.
// IPv6 is limited to global unicast; mapped IPv4, zones and private scopes fail.
function isPublicAddress(value) {
  if (typeof value !== "string") return false;
  const family = net.isIP(value);
  if (family === 4) {
    const [a, b, c] = value.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 0 || b === 168 || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113)
    );
  }
  if (family !== 6 || value.includes("%")) return false;
  const normalized = new URL(`https://[${value}]/`).hostname.slice(1, -1);
  return (
    /^[23]/.test(normalized) && !/^2001:(?:db8|0|2|10|20):/i.test(normalized)
  );
}

async function readDnsJson(response, signal) {
  if (!response || !response.ok || !response.body) {
    if (response && response.body) response.body.cancel().catch(() => {});
    throw transportError();
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await withAbort(reader.read(), signal);
      if (done) break;
      size += value.byteLength;
      if (size > MAX_DNS_BYTES) throw transportError("LYRIC_INVALID_RESPONSE");
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    // Cancellation must not extend the shared request deadline.
    reader.cancel().catch(() => {});
    if (error.name === "AbortError" || error.code) throw error;
    throw transportError("LYRIC_INVALID_RESPONSE");
  }
}

function createPublicDnsResolver({
  fetchImpl,
  now = Date.now,
  isAllowedHostname = isLyricHostname,
  dnsEndpoints = DNS_ENDPOINTS,
}) {
  if (
    !Array.isArray(dnsEndpoints) ||
    dnsEndpoints.length !== DNS_ENDPOINTS.length ||
    new Set(dnsEndpoints).size !== DNS_ENDPOINTS.length ||
    !dnsEndpoints.every((endpoint) => DNS_ENDPOINTS.includes(endpoint))
  )
    throw transportError("LYRIC_INVALID_RESPONSE");
  const endpoints = [...dnsEndpoints];
  const cache = new Map();
  const resolveLyricHost = async function (hostname, signal, context = {}) {
    if (!isAllowedHostname(hostname))
      throw transportError("LYRIC_INVALID_RESPONSE");
    if (signal && signal.aborted) throw abortError();
    const excluded = context.excludeAddresses || new Set();
    const attempted = context.attemptedEndpoints || new Set();
    const cached = cache.get(hostname);
    if (cached && cached.expiresAt > now()) {
      const addresses = cached.addresses.filter(
        (address) => !excluded.has(address)
      );
      if (addresses.length) {
        attempted.add(cached.endpoint);
        return addresses;
      }
      cache.delete(hostname);
    }
    let failure;
    for (const endpoint of endpoints) {
      if (signal && signal.aborted) throw abortError();
      if (attempted.has(endpoint)) continue;
      attempted.add(endpoint);
      // Each resolver gets only part of the caller's shared total deadline.
      // The local abort race also bounds injected fetches that ignore signals.
      const attempt = new AbortController();
      const abort = () => attempt.abort();
      if (signal) signal.addEventListener("abort", abort, { once: true });
      const timeout = setTimeout(abort, DNS_ATTEMPT_TIMEOUT_MS);
      try {
        const response = await withAbort(
          Promise.resolve(
            fetchImpl(
              `${endpoint}?name=${encodeURIComponent(hostname)}&type=A`,
              {
                signal: attempt.signal,
                redirect: "error",
                credentials: "omit",
                cache: "no-store",
                headers: { Accept: "application/dns-json" },
              }
            )
          ).then((response) => {
            // A fetch implementation may ignore abort and deliver headers late.
            // Close its unused body instead of retaining a stranded response.
            if (attempt.signal.aborted) {
              if (response && response.body)
                Promise.resolve()
                  .then(() => response.body.cancel())
                  .catch(() => {});
              throw abortError();
            }
            return response;
          }),
          attempt.signal
        );
        const payload = await readDnsJson(response, attempt.signal);
        const questions =
          payload && Array.isArray(payload.Question)
            ? payload.Question
            : [payload && payload.Question];
        if (
          !payload ||
          Number(payload.Status) !== 0 ||
          !questions.some(
            (q) =>
              q &&
              String(q.name).replace(/\.$/, "") === hostname &&
              Number(q.type) === 1
          ) ||
          !Array.isArray(payload.Answer)
        )
          throw transportError("LYRIC_INVALID_RESPONSE");
        const answers = payload.Answer.slice(0, 64).filter(
          (answer) =>
            answer &&
            Number(answer.type) === 1 &&
            isPublicAddress(answer.data) &&
            !excluded.has(answer.data)
        );
        const addresses = [
          ...new Set(answers.map((answer) => answer.data)),
        ].slice(0, 2);
        if (!addresses.length) throw transportError();
        const ttl = Math.min(
          300,
          ...answers.map((answer) =>
            Number.isFinite(Number(answer.TTL))
              ? Math.max(0, Number(answer.TTL))
              : 0
          )
        );
        cache.set(hostname, {
          addresses,
          endpoint,
          expiresAt: now() + ttl * 1000,
        });
        while (cache.size > 24) cache.delete(cache.keys().next().value);
        return addresses;
      } catch (error) {
        if (signal && signal.aborted) throw abortError();
        failure = attempt.signal.aborted ? transportError() : error;
      } finally {
        clearTimeout(timeout);
        if (signal) signal.removeEventListener("abort", abort);
      }
    }
    throw transportError(failure && failure.code, "dns", failure);
  };
  resolveLyricHost.rejectAddresses = (hostname, failed) => {
    const cached = cache.get(hostname);
    if (!cached) return;
    cached.addresses = cached.addresses.filter(
      (address) => !failed.has(address)
    );
    if (!cached.addresses.length) cache.delete(hostname);
  };
  resolveLyricHost.rememberReachable = (hostname, address) => {
    const cached = cache.get(hostname);
    if (cached && cached.addresses.includes(address))
      cached.addresses = [
        address,
        ...cached.addresses.filter((item) => item !== address),
      ];
  };
  return resolveLyricHost;
}

function createDirectLyricFetch({
  request = https.request,
  dnsFetch = globalThis.fetch,
  resolve = createPublicDnsResolver({ fetchImpl: dnsFetch }),
} = {}) {
  return async function directLyricFetch(value, options = {}) {
    const validated = validateUrl(value);
    const url = new URL(validated.url);
    const { signal } = options;
    const reportStage = (stage) => {
      if (typeof options.onNetworkStage === "function")
        options.onNetworkStage(stage);
    };
    const context = {
      excludeAddresses: new Set(),
      attemptedEndpoints: new Set(),
    };
    let failure;
    // Two address batches only, with one connection-triggered resolver fallback.
    for (let batch = 0; batch < 2; batch += 1) {
      if (signal && signal.aborted) throw abortError();
      reportStage("dns");
      const addresses = [
        ...new Set(
          await withAbort(resolve(url.hostname, signal, context), signal).catch(
            (error) => {
              if (error.name === "AbortError") throw error;
              throw transportError(error.code, "dns", error);
            }
          )
        ),
      ]
        .filter(
          (address) =>
            isPublicAddress(address) && !context.excludeAddresses.has(address)
        )
        .slice(0, 2);
      if (!addresses.length) throw failure || transportError();
      for (const address of addresses) {
        if (signal && signal.aborted) throw abortError();
        let receivedResponse = false;
        try {
          return await new Promise((resolveResponse, reject) => {
            let settled = false;
            let req;
            let networkStage = "connect";
            const setStage = (stage) => {
              networkStage = stage;
              reportStage(stage);
            };
            setStage("connect");
            const cleanup = () => {
              if (signal) signal.removeEventListener("abort", abort);
            };
            const finish = (error, response) => {
              if (settled) return;
              settled = true;
              cleanup();
              if (error) reject(error);
              else resolveResponse(response);
            };
            const abort = () => {
              finish(abortError());
              if (req) req.destroy();
            };
            if (signal) signal.addEventListener("abort", abort, { once: true });
            // Connect to the resolved public address directly. Never use a proxy
            // agent, Electron session, cookies, caller headers or redirected URLs.
            try {
              req = request(
                {
                  protocol: "https:",
                  hostname: address,
                  port: 443,
                  servername: url.hostname,
                  rejectUnauthorized: true,
                  checkServerIdentity: (_host, cert) =>
                    tls.checkServerIdentity(url.hostname, cert),
                  method: "GET",
                  path: `${url.pathname}${url.search}`,
                  agent: false,
                  headers: {
                    Host: url.hostname,
                    Referer: validated.referer,
                    Accept: "application/json,text/plain",
                    "Accept-Encoding": "identity",
                    ...lyricHeaders(url.hostname),
                    ...(url.hostname.endsWith(".kugou.com")
                      ? { "User-Agent": KUGOU_USER_AGENT }
                      : {}),
                  },
                },
                (response) => {
                  if (settled || (signal && signal.aborted)) {
                    response.destroy();
                    return;
                  }
                  receivedResponse = true;
                  setStage("response");
                  if (typeof resolve.rememberReachable === "function")
                    resolve.rememberReachable(url.hostname, address);
                  const status = response.statusCode;
                  if (
                    !Number.isInteger(status) ||
                    status < 200 ||
                    status > 599
                  ) {
                    finish(
                      transportError("LYRIC_INVALID_RESPONSE", "response")
                    );
                    response.destroy();
                    return;
                  }
                  if (status >= 300) {
                    finish(
                      null,
                      new Response(null, {
                        status,
                        headers: responseHeaders(response),
                      })
                    );
                    response.destroy();
                    return;
                  }
                  const encoding = String(
                    response.headers["content-encoding"] || "identity"
                  ).toLowerCase();
                  if (
                    encoding !== "identity" ||
                    Number(response.headers["content-length"]) > MAX_BODY_BYTES
                  ) {
                    finish(
                      transportError("LYRIC_INVALID_RESPONSE", "response")
                    );
                    response.destroy();
                    return;
                  }
                  const chunks = [];
                  let size = 0;
                  response.on("data", (chunk) => {
                    size += chunk.length;
                    if (size > MAX_BODY_BYTES) {
                      finish(
                        transportError("LYRIC_INVALID_RESPONSE", "response")
                      );
                      response.destroy();
                    } else chunks.push(Buffer.from(chunk));
                  });
                  response.once("end", () => {
                    try {
                      finish(
                        null,
                        new Response(
                          status === 204 || status === 205
                            ? null
                            : Buffer.concat(chunks),
                          { status, headers: responseHeaders(response) }
                        )
                      );
                    } catch (_) {
                      finish(
                        transportError("LYRIC_INVALID_RESPONSE", "response")
                      );
                    }
                  });
                  response.once("error", (error) =>
                    finish(transportError(undefined, "response", error))
                  );
                  response.once("aborted", () =>
                    finish(transportError(undefined, "response"))
                  );
                }
              );
              req.once("socket", (socket) => {
                if (!socket.connecting) setStage("tls");
                socket.once("connect", () => {
                  setStage("tls");
                });
                socket.once("secureConnect", () => {
                  setStage("response");
                });
              });
              req.once("error", (error) =>
                finish(transportError(undefined, networkStage, error))
              );
              if (signal && signal.aborted) abort();
              else req.end();
            } catch (error) {
              finish(transportError(undefined, networkStage, error));
              if (req) req.destroy();
            }
          });
        } catch (error) {
          if (
            receivedResponse ||
            (signal && signal.aborted) ||
            error.name === "AbortError"
          )
            throw error;
          failure = error;
          context.excludeAddresses.add(address);
          if (typeof resolve.rejectAddresses === "function")
            resolve.rejectAddresses(url.hostname, context.excludeAddresses);
        }
      }
    }
    throw transportError(failure && failure.code, "dns", failure);
  };
}

module.exports = {
  createDirectLyricFetch,
  createPublicDnsResolver,
  isPublicAddress,
};
