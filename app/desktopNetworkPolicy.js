const { isPublicAddress } = require("./lyricDirectTransport");

const DNS_SERVERS = Object.freeze([
  "https://dns.google/dns-query",
  "https://dns.alidns.com/dns-query",
  "https://cloudflare-dns.com/dns-query",
]);
const CHECK_HOSTS = Object.freeze(["music.163.com", "songsearch.kugou.com"]);
const MANAGED_NAMES = new Set(["default", "electron-updater"]);
const copy = (value) => JSON.parse(JSON.stringify(value));
const failure = (code) => Object.assign(new Error(code), { policyCode: code });

function normalizeProxy(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw failure("invalid-config");
  }
  if (value.mode === "system" || value.mode === "direct") {
    return { mode: value.mode };
  }
  if (
    (value.mode === undefined ||
      value.mode === "custom" ||
      value.mode === "fixed_servers") &&
    typeof value.proxyRules === "string" &&
    value.proxyRules.length > 0 &&
    value.proxyRules.length <= 4096 &&
    !/[\r\n\0]/.test(value.proxyRules)
  ) {
    const result = { proxyRules: value.proxyRules };
    if (value.proxyBypassRules !== undefined) {
      if (
        typeof value.proxyBypassRules !== "string" ||
        value.proxyBypassRules.length > 4096 ||
        /[\r\n\0]/.test(value.proxyBypassRules)
      ) {
        throw failure("invalid-config");
      }
      result.proxyBypassRules = value.proxyBypassRules;
    }
    return result;
  }
  throw failure("invalid-config");
}

// No Electron import: all native operations are injected and testable.
function createDesktopNetworkPolicy({
  configureHostResolver,
  getManagedSessions,
  persist = () => {},
  platform = process.platform,
  resolveHost = (selectedSession, hostname) =>
    selectedSession.resolveHost(hostname, {
      queryType: "A",
      cacheUsage: "disallowed",
    }),
  validationTimeoutMs = 6000,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
} = {}) {
  if (
    typeof configureHostResolver !== "function" ||
    typeof getManagedSessions !== "function" ||
    typeof persist !== "function" ||
    typeof resolveHost !== "function"
  ) {
    throw new TypeError("Network policy adapters are required");
  }
  const checkTimeout = Math.max(
    1,
    Math.min(8000, Number(validationTimeoutMs) || 6000)
  );
  let baseProxyConfig = { mode: "system" };
  let enhancedDirect = false;
  let state = {
    ok: false,
    status: "uninitialized",
    scope: "application",
    enhancedDirect: false,
    config: { mode: "system" },
    baseProxyConfig,
    error: null,
    errorCode: null,
  };
  let initialized = false;
  let initializationAttempted = false;
  let savedSnapshot;
  let queue = Promise.resolve();

  const snapshot = () => ({
    proxyConfig: copy(baseProxyConfig),
    networkPolicy: { version: 1, enhancedDirect },
  });
  const resolverConfig = (enabled) => ({
    enableBuiltInResolver: enabled || platform === "darwin",
    secureDnsMode: enabled ? "secure" : "automatic",
    secureDnsServers: enabled ? [...DNS_SERVERS] : [],
  });
  function sessions() {
    const selected = getManagedSessions();
    if (
      !Array.isArray(selected) ||
      selected.length !== MANAGED_NAMES.size ||
      new Set(selected.map((entry) => entry && entry.name)).size !==
        MANAGED_NAMES.size ||
      !selected.every(
        (entry) =>
          entry &&
          MANAGED_NAMES.has(entry.name) &&
          entry.session &&
          ["setProxy", "clearHostResolverCache", "closeAllConnections"].every(
            (method) => typeof entry.session[method] === "function"
          )
      )
    ) {
      throw failure("policy-apply-failed");
    }
    return selected;
  }
  function publish(ok, status, errorCode = null, extra = {}) {
    state = {
      ok,
      status,
      scope: "application",
      enhancedDirect,
      config: enhancedDirect
        ? { mode: "enhanced-direct" }
        : copy(baseProxyConfig),
      baseProxyConfig: copy(baseProxyConfig),
      error: errorCode,
      errorCode,
      ...extra,
    };
    return copy(state);
  }
  async function applyNative(entries, enabled, proxy) {
    // Apply every session even if one fails, particularly during rollback.
    const resolverResult = await Promise.allSettled([
      Promise.resolve().then(() =>
        configureHostResolver(resolverConfig(enabled))
      ),
    ]);
    const results = await Promise.allSettled(
      entries.map(async ({ session: selected }) => {
        await selected.setProxy(enabled ? { mode: "direct" } : copy(proxy));
        const cleanup = await Promise.allSettled([
          Promise.resolve().then(() => selected.clearHostResolverCache()),
          Promise.resolve().then(() => selected.closeAllConnections()),
        ]);
        if (cleanup.some((result) => result.status === "rejected")) {
          throw failure("policy-apply-failed");
        }
      })
    );
    if (
      [...resolverResult, ...results].some(
        (result) => result.status === "rejected"
      )
    ) {
      throw failure("policy-apply-failed");
    }
  }
  async function validate(entries) {
    const selected = entries.find((entry) => entry.name === "default").session;
    let timer;
    try {
      await Promise.race([
        Promise.all(
          CHECK_HOSTS.map(async (hostname) => {
            const result = await resolveHost(selected, hostname);
            if (
              !result ||
              !Array.isArray(result.endpoints) ||
              result.endpoints.length === 0 ||
              !result.endpoints.every(
                (endpoint) => endpoint && isPublicAddress(endpoint.address)
              )
            ) {
              throw failure("resolver-check-failed");
            }
          })
        ),
        new Promise((_, reject) => {
          timer = setTimeoutImpl(
            () => reject(failure("resolver-check-timeout")),
            checkTimeout
          );
        }),
      ]);
    } catch (error) {
      throw failure(
        error && error.policyCode === "resolver-check-timeout"
          ? "resolver-check-timeout"
          : "resolver-check-failed"
      );
    } finally {
      clearTimeoutImpl(timer);
    }
  }
  function serialize(operation) {
    const result = queue.then(operation, operation);
    queue = result.catch(() => {});
    return result;
  }
  async function failClosed(entries, errorCode) {
    initialized = false;
    enhancedDirect = false;
    const results = await Promise.allSettled(
      (entries || []).map(async ({ session: selected }) => {
        await selected.setProxy({ mode: "direct" });
        await selected.clearHostResolverCache();
        await selected.closeAllConnections();
      })
    );
    const directOnly =
      entries &&
      results.length === MANAGED_NAMES.size &&
      results.every((result) => result.status === "fulfilled");
    return publish(false, "error", errorCode, {
      config: directOnly ? { mode: "direct" } : null,
      nativeState: directOnly ? "direct-only" : "unknown",
    });
  }

  function initialize(input = {}) {
    return serialize(async () => {
      if (initialized) return copy(state);
      initializationAttempted = true;
      const savedEnhanced = Boolean(
        input.networkPolicy &&
          input.networkPolicy.version === 1 &&
          input.networkPolicy.enhancedDirect === true
      );
      let invalidBase = false;
      try {
        baseProxyConfig = normalizeProxy(
          input.proxyConfig || { mode: "system" }
        );
      } catch (_) {
        if (!savedEnhanced) return publish(false, "error", "invalid-config");
        // A damaged old preference must never disable a saved direct overlay.
        // The original stored value is left untouched until an explicit save.
        baseProxyConfig = { mode: "system" };
        invalidBase = true;
      }
      savedSnapshot = {
        proxyConfig: copy(baseProxyConfig),
        networkPolicy: { version: 1, enhancedDirect: savedEnhanced },
      };
      let entries;
      try {
        entries = sessions();
        await applyNative(entries, savedEnhanced, baseProxyConfig);
        enhancedDirect = savedEnhanced;
        initialized = true;
        // Startup deliberately has no Internet probe or persistence write.
        return invalidBase
          ? publish(false, "error", "invalid-config")
          : publish(true, "ready");
      } catch (_) {
        if (!savedEnhanced) {
          return publish(false, "error", "startup-policy-failed", {
            config: null,
            nativeState: "unknown",
          });
        }
        return failClosed(entries, "startup-policy-failed");
      }
    });
  }

  function applyConfig(uiConfig) {
    return serialize(async () => {
      if (!initializationAttempted)
        return publish(false, "error", "not-initialized");
      const recovering = !initialized;
      let nextBase;
      const nextEnhanced = Boolean(
        uiConfig && uiConfig.mode === "enhanced-direct"
      );
      try {
        nextBase = nextEnhanced
          ? copy(baseProxyConfig)
          : normalizeProxy(uiConfig);
      } catch (_) {
        return publish(false, "error", "invalid-config");
      }
      const previous = {
        base: copy(baseProxyConfig),
        enhanced: enhancedDirect,
        snapshot: snapshot(),
      };
      let entries;
      let persistAttempted = false;
      publish(true, "applying");
      try {
        entries = sessions();
        await applyNative(entries, nextEnhanced, nextBase);
        if (nextEnhanced) await validate(entries);
        persistAttempted = true;
        try {
          await persist({
            proxyConfig: copy(nextBase),
            networkPolicy: { version: 1, enhancedDirect: nextEnhanced },
          });
        } catch (_) {
          throw failure("persist-failed");
        }
        baseProxyConfig = nextBase;
        enhancedDirect = nextEnhanced;
        initialized = true;
        savedSnapshot = snapshot();
        return publish(true, "ready");
      } catch (error) {
        if (recovering) {
          let errorCode = (error && error.policyCode) || "policy-apply-failed";
          if (persistAttempted && savedSnapshot) {
            try {
              await persist(copy(savedSnapshot));
            } catch (_) {
              errorCode = "rollback-failed";
            }
          }
          return failClosed(entries, errorCode);
        }
        try {
          if (!entries) throw failure("rollback-failed");
          await applyNative(entries, previous.enhanced, previous.base);
          if (persistAttempted) await persist(previous.snapshot);
        } catch (_) {
          initialized = false;
          return publish(false, "error", "rollback-failed", {
            config: null,
            nativeState: "unknown",
          });
        }
        return publish(
          false,
          "error",
          (error && error.policyCode) || "policy-apply-failed"
        );
      }
    });
  }

  return { initialize, applyConfig, getState: () => copy(state) };
}

module.exports = { createDesktopNetworkPolicy };
