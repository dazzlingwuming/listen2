const http = require("node:http");
const net = require("node:net");
const {
  createPublicDnsResolver,
  isPublicAddress,
} = require("./lyricDirectTransport");
const { validateUrl } = require("./lyricTransport");

const PARTITION = "persist:netease-lyrics-v1";
const PAGE_HOSTS = new Set(["music.163.com", "st.music.163.com"]);
// Exact NetEase origins only. The EasyShield SDK's public load.min.js lists
// these API origins. A future dependency must be reviewed, never wildcarded.
// Full live challenge dependencies still require an interactive acceptance.
const RESOURCE_HOSTS = new Set([
  ...PAGE_HOSTS,
  "cstaticdun.126.net",
  "c.dun.163.com",
  "c.dun.163yun.com",
  "c-v6.dun.163.com",
  "ac.dun.163.com",
  "ac.dun.163yun.com",
  "ac-v6.dun.163yun.com",
  "da.dun.163.com",
]);
const API_PATHS = new Set([
  "/api/search/get/web",
  "/api/search/pc",
  "/api/song/lyric",
]);
const CHALLENGE_LIFETIME_MS = 5 * 60 * 1000;

function unavailableError() {
  return Object.assign(new Error("NetEase session unavailable"), {
    code: "LYRIC_UNAVAILABLE",
  });
}

function abortError() {
  return Object.assign(new Error("NetEase request cancelled"), {
    name: "AbortError",
  });
}

function allowedHttpsUrl(value, hosts) {
  if (typeof value !== "string" || value.length > 4096) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      hosts.has(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.port
    );
  } catch (_) {
    return false;
  }
}

function isNeteaseVerificationUrl(value) {
  return allowedHttpsUrl(value, PAGE_HOSTS);
}

function isNeteaseResourceUrl(value) {
  return allowedHttpsUrl(value, RESOURCE_HOSTS);
}

function validateNeteaseApiUrl(value) {
  const validated = validateUrl(value);
  const url = new URL(validated.url);
  if (url.hostname !== "music.163.com" || !API_PATHS.has(url.pathname)) {
    throw unavailableError();
  }
  return validated.url;
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
    Promise.resolve(promise).then((value) => finish(null, value), finish);
    if (signal.aborted) abort();
  });
}

// This is an HTTP CONNECT router, not a TLS proxy. Chromium performs the TLS
// handshake and certificate verification all the way to the official server.
// Both the official window and its API session use this exact direct route.
async function createNeteaseTunnelProxy({
  resolve,
  connect = (options) => net.connect(options),
  maxTunnels = 8,
  maxConnections = 32,
  connectTimeoutMs = 5000,
  idleTimeoutMs = 30000,
  lifetimeMs = 120000,
  maxTunnelBytes = 32 * 1024 * 1024,
} = {}) {
  if (typeof resolve !== "function") throw unavailableError();
  const tunnels = new Set();
  const sockets = new Set();
  let disposed = false;
  const server = http.createServer(
    { maxHeaderSize: 16384 },
    (_request, reply) => {
      reply.writeHead(405, { Connection: "close" });
      reply.end();
    }
  );
  server.headersTimeout = 10000;
  server.requestTimeout = 10000;
  server.keepAliveTimeout = 1000;
  server.maxConnections = maxConnections;
  server.on("connection", (socket) => {
    if (disposed || sockets.size >= maxConnections) {
      socket.destroy();
      return;
    }
    sockets.add(socket);
    socket.on("error", () => {});
    socket.once("close", () => sockets.delete(socket));
    socket.setTimeout(idleTimeoutMs, () => socket.destroy());
  });
  server.on("clientError", (_error, socket) => socket.destroy());
  server.on("connect", (request, client, head) => {
    const match = /^([a-z0-9.-]+):443$/.exec(request.url || "");
    if (
      disposed ||
      !match ||
      !RESOURCE_HOSTS.has(match[1]) ||
      head.length > Math.min(16384, maxTunnelBytes) ||
      tunnels.size >= maxTunnels
    ) {
      client.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    const controller = new AbortController();
    // Retain any early TLS bytes while DNS/TCP setup is still asynchronous.
    client.pause();
    let upstream;
    let closed = false;
    let bytes = head.length;
    const close = () => {
      if (closed) return;
      closed = true;
      clearTimeout(deadline);
      controller.abort();
      tunnels.delete(close);
      client.destroy();
      if (upstream) upstream.destroy();
    };
    const deadline = setTimeout(close, lifetimeMs);
    deadline.unref?.();
    tunnels.add(close);
    client.once("error", close);
    client.once("close", close);
    client.setTimeout(idleTimeoutMs, close);
    const countBytes = (chunk) => {
      bytes += chunk.length;
      if (bytes > maxTunnelBytes) close();
    };
    client.on("data", countBytes);

    const establish = async () => {
      const addresses = [
        ...new Set(
          await withAbort(
            resolve(match[1], controller.signal),
            controller.signal
          )
        ),
      ]
        .filter(isPublicAddress)
        .slice(0, 2);
      for (const address of addresses) {
        if (closed || controller.signal.aborted) return;
        try {
          upstream = await new Promise((resolveSocket, reject) => {
            const socket = connect({ host: address, port: 443 });
            const timer = setTimeout(() => {
              socket.destroy();
              reject(unavailableError());
            }, connectTimeoutMs);
            const stop = () => {
              clearTimeout(timer);
              socket.destroy();
              reject(abortError());
            };
            const failed = () => {
              clearTimeout(timer);
              controller.signal.removeEventListener("abort", stop);
              reject(unavailableError());
            };
            socket.once("error", failed);
            controller.signal.addEventListener("abort", stop, { once: true });
            socket.once("connect", () => {
              clearTimeout(timer);
              controller.signal.removeEventListener("abort", stop);
              socket.removeListener("error", failed);
              socket.on("error", close);
              resolveSocket(socket);
            });
            if (controller.signal.aborted) stop();
          });
          if (closed) {
            upstream.destroy();
            return;
          }
          upstream.once("close", close);
          upstream.setTimeout(idleTimeoutMs, close);
          upstream.on("data", countBytes);
          upstream.pipe(client);
          client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
          if (head.length) upstream.write(head);
          client.pipe(upstream);
          return;
        } catch (_) {
          // Only a pre-connect failure can select the second public address.
        }
      }
      close();
    };
    void establish().catch(close);
  });
  await new Promise((resolveListening, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolveListening();
    });
  });
  server.on("error", () => {
    for (const close of tunnels) close();
  });
  let disposePromise;
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    dispose() {
      if (!disposePromise) {
        disposed = true;
        for (const close of tunnels) close();
        for (const socket of sockets) socket.destroy();
        disposePromise = new Promise((resolveClosed) =>
          server.close(resolveClosed)
        );
      }
      return disposePromise;
    },
  };
}

function createNeteaseVerificationSession({
  session,
  BrowserWindow,
  dnsFetch = globalThis.fetch,
  now = Date.now,
  createProxy = createNeteaseTunnelProxy,
} = {}) {
  let selectedSession;
  let initialization;
  let proxy;
  let disposed = false;
  let challenge;
  let verification;
  let disposal;
  let userAgent;
  let sessionHandlersReady = false;
  const requests = new Set();
  const denyDownload = (event) => event.preventDefault();
  const resolve = createPublicDnsResolver({
    fetchImpl: dnsFetch,
    isAllowedHostname: (host) => RESOURCE_HOSTS.has(host),
    // The 2026-10-12 strict-TLS probes reached NetEase through Google's public
    // answer, while the AliDNS answers reset during TLS. Other lyric sources
    // keep their existing order. This is a bounded route choice, no uptime claim.
    dnsEndpoints: [
      "https://dns.google/resolve",
      "https://dns.alidns.com/resolve",
      "https://cloudflare-dns.com/dns-query",
    ],
  });

  // Lazy: this factory may be called before Electron app.ready.
  async function ensureSession() {
    if (disposed) throw unavailableError();
    if (!initialization) {
      initialization = (async () => {
        selectedSession = session.fromPartition(PARTITION);
        if (!sessionHandlersReady) {
          userAgent = selectedSession.getUserAgent();
          selectedSession.setUserAgent(userAgent);
          selectedSession.setPermissionRequestHandler(
            (_contents, _permission, callback) => callback(false)
          );
          selectedSession.setPermissionCheckHandler(() => false);
          selectedSession.on("will-download", denyDownload);
          selectedSession.webRequest.onBeforeRequest(
            { urls: ["<all_urls>"] },
            (details, callback) => {
              callback({ cancel: !isNeteaseResourceUrl(details.url) });
            }
          );
          sessionHandlersReady = true;
        }
        proxy = await createProxy({ resolve });
        if (disposed) {
          await proxy.dispose();
          throw unavailableError();
        }
        await selectedSession.setProxy({
          mode: "fixed_servers",
          proxyRules: proxy.url,
          proxyBypassRules: "<-loopback>",
        });
        await selectedSession.closeAllConnections();
        if (disposed) throw unavailableError();
        return selectedSession;
      })().catch(async () => {
        if (proxy) await proxy.dispose();
        proxy = null;
        initialization = null;
        throw unavailableError();
      });
    }
    return initialization;
  }

  async function fetch(value, options = {}) {
    const url = validateNeteaseApiUrl(value);
    // PC is a renderer URL envelope only. The trusted session owns the fixed
    // method/body and never accepts arbitrary renderer request options.
    const parsed = new URL(url);
    const pcSearch = parsed.pathname === "/api/search/pc";
    const requestUrl = pcSearch ? `${parsed.origin}${parsed.pathname}` : url;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    requests.add(controller);
    const abort = () => controller.abort();
    if (options.signal) {
      options.signal.addEventListener("abort", abort, { once: true });
      if (options.signal.aborted) abort();
    }
    try {
      const current = await withAbort(ensureSession(), controller.signal);
      if (controller.signal.aborted) throw abortError();
      const response = await withAbort(
        Promise.resolve(
          current.fetch(requestUrl, {
            method: pcSearch ? "POST" : "GET",
            ...(pcSearch ? { body: parsed.searchParams.toString() } : {}),
            credentials: "include",
            redirect: "error",
            cache: "no-store",
            signal: controller.signal,
            headers: {
              Referer: "https://music.163.com/",
              Accept: "application/json,text/plain",
              "User-Agent": userAgent,
              ...(pcSearch
                ? {
                    "Content-Type":
                      "application/x-www-form-urlencoded;charset=UTF-8",
                  }
                : {}),
            },
          })
        ).then((response) => {
          if (controller.signal.aborted) {
            if (response && response.body)
              Promise.resolve()
                .then(() => response.body.cancel())
                .catch(() => {});
            throw abortError();
          }
          return response;
        }),
        controller.signal
      );
      const reader = response.body && response.body.getReader();
      const chunks = [];
      let size = 0;
      try {
        if (Number(response.headers.get("content-length")) > 2 * 1024 * 1024) {
          throw Object.assign(unavailableError(), {
            code: "LYRIC_INVALID_RESPONSE",
          });
        }
        if (reader) {
          for (;;) {
            const { done, value: chunk } = await withAbort(
              reader.read(),
              controller.signal
            );
            if (done) break;
            size += chunk.byteLength;
            if (size > 2 * 1024 * 1024) {
              throw Object.assign(unavailableError(), {
                code: "LYRIC_INVALID_RESPONSE",
              });
            }
            chunks.push(Buffer.from(chunk));
          }
        }
      } catch (error) {
        if (reader) reader.cancel().catch(() => {});
        throw error;
      }
      return new Response(
        response.status === 204 || response.status === 205
          ? null
          : Buffer.concat(chunks),
        { status: response.status }
      );
    } finally {
      clearTimeout(timer);
      requests.delete(controller);
      if (options.signal) options.signal.removeEventListener("abort", abort);
    }
  }

  function observeResult(result, value) {
    validateNeteaseApiUrl(value);
    if (!result || !result.ok || typeof result.data !== "string") return result;
    let payload;
    try {
      payload = JSON.parse(result.data);
    } catch (_) {
      return result;
    }
    if (payload && Number(payload.code) === -462) {
      const raw = payload.data && payload.data.verifyUrl;
      challenge = isNeteaseVerificationUrl(raw)
        ? { url: raw, expiresAt: now() + CHALLENGE_LIFETIME_MS }
        : null;
      // Never allow challenge tokens or the raw verification URL to cross IPC.
      return {
        ok: false,
        status: "verification-required",
        canVerify: Boolean(challenge),
      };
    }
    if (
      payload &&
      Number(payload.code) === 200 &&
      payload.result &&
      typeof payload.result === "object"
    ) {
      challenge = null;
    }
    return result;
  }

  function openVerification(parent) {
    if (disposed)
      return Promise.resolve({ ok: false, status: "verification-unavailable" });
    if (verification) {
      if (verification.window && !verification.window.isDestroyed()) {
        verification.window.show();
        verification.window.focus();
      }
      return verification.promise;
    }
    if (!challenge || challenge.expiresAt <= now()) {
      challenge = null;
      return Promise.resolve({ ok: false, status: "verification-unavailable" });
    }
    const currentChallenge = challenge;
    const state = {};
    state.promise = new Promise((resolveResult) => {
      state.finish = (result) => {
        if (state.finished) return;
        state.finished = true;
        if (verification === state) verification = null;
        resolveResult(result);
      };
    });
    verification = state;
    void (async () => {
      try {
        const current = await ensureSession();
        if (disposed || currentChallenge.expiresAt <= now()) {
          state.finish({ ok: false, status: "verification-unavailable" });
          return;
        }
        const window = new BrowserWindow({
          parent,
          width: 820,
          height: 700,
          autoHideMenuBar: true,
          title: "网易云官方验证",
          webPreferences: {
            session: current,
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            webSecurity: true,
            allowRunningInsecureContent: false,
            webviewTag: false,
          },
        });
        state.window = window;
        window.setMenu(null);
        window.webContents.setUserAgent(userAgent);
        window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
        const restrictNavigation = (
          event,
          legacyUrl,
          _isInPlace,
          legacyIsMainFrame
        ) => {
          const target = typeof legacyUrl === "string" ? legacyUrl : event.url;
          const isMainFrame =
            typeof legacyIsMainFrame === "boolean"
              ? legacyIsMainFrame
              : event.isMainFrame;
          const allowed =
            isMainFrame === false
              ? isNeteaseResourceUrl(target)
              : isNeteaseVerificationUrl(target);
          if (!allowed) event.preventDefault();
        };
        window.webContents.on("will-navigate", restrictNavigation);
        window.webContents.on("will-frame-navigate", restrictNavigation);
        window.webContents.on("will-redirect", restrictNavigation);
        window.webContents.on("will-attach-webview", (event) =>
          event.preventDefault()
        );
        window.on("closed", () => {
          if (challenge === currentChallenge) challenge = null;
          // Disk flushing does not make session-only cookies permanent and does
          // not prove that the platform accepted verification. Retry is proof.
          Promise.resolve()
            .then(() => current.cookies.flushStore())
            .then(
              () => state.finish({ ok: true, status: "retry-ready" }),
              () =>
                state.finish({ ok: false, status: "verification-unavailable" })
            );
        });
        await window.loadURL(currentChallenge.url, { userAgent });
        if (!window.isDestroyed()) {
          window.show();
          window.focus();
        }
      } catch (_) {
        state.finish({ ok: false, status: "verification-unavailable" });
        if (state.window && !state.window.isDestroyed()) state.window.destroy();
      }
    })();
    return state.promise;
  }

  async function dispose() {
    if (disposed) return disposal;
    disposed = true;
    challenge = null;
    for (const controller of requests) controller.abort();
    if (verification) {
      const state = verification;
      state.finish({ ok: false, status: "verification-unavailable" });
      if (state.window && !state.window.isDestroyed()) state.window.destroy();
    }
    disposal = (async () => {
      if (initialization) await initialization.catch(() => {});
      if (proxy) await proxy.dispose();
      if (selectedSession) {
        selectedSession.removeListener("will-download", denyDownload);
        await Promise.resolve()
          .then(() => selectedSession.closeAllConnections())
          .catch(() => {});
        await Promise.resolve()
          .then(() => selectedSession.cookies.flushStore())
          .catch(() => {});
      }
    })();
    return disposal;
  }

  return { fetch, observeResult, openVerification, dispose };
}

module.exports = {
  createNeteaseVerificationSession,
  createNeteaseTunnelProxy,
  isNeteaseVerificationUrl,
  isNeteaseResourceUrl,
  PARTITION,
};
