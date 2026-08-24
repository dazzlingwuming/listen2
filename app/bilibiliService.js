const {
  constants: cryptoConstants,
  createHash,
  publicEncrypt,
  randomBytes,
} = require("crypto");

const BILIBILI_API_BASE = "https://api.bilibili.com";
const BILIBILI_PASSPORT_BASE = "https://passport.bilibili.com";
const BILIBILI_WEB_REFERER = "https://www.bilibili.com/";
const REQUEST_TIMEOUT_MS = 20000;
const QR_EXPIRES_IN_MS = 180000;
const QR_POLL_INTERVAL_MS = 1200;
const MANIFEST_CACHE_MS = 90 * 60 * 1000;
const WBI_CACHE_MS = 30 * 60 * 1000;
const BILIBILI_REFRESH_TOKEN_STORE_KEY = "bilibiliAuth";
const COOKIE_REFRESH_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const COOKIE_REFRESH_RETRY_INTERVAL_MS = 15 * 60 * 1000;
const BILIBILI_COOKIE_REFRESH_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDLgd2OAkcGVtoE3ThUREbio0Eg
Uc/prcajMKXvkCKFCWhJYJcLkcM2DKKcSeFpD/j6Boy538YXnR6VhcuUJOhH2x71
nzPjfdTcqMz7djHum0qSZA0AyCBDABUqCrfNgCiJ00Ra7GmRj+YCK1NJEuewlb40
JNrRuoEUXpabUzGB8QIDAQAB
-----END PUBLIC KEY-----`;

const WBI_MIXIN_KEY_TABLE = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61,
  26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36,
  20, 34, 44, 52,
];

const VIDEO_QUALITY_LABELS = {
  16: "360P",
  32: "480P",
  64: "720P",
  74: "720P60",
  80: "1080P",
  112: "1080P+",
  116: "1080P60",
  120: "4K",
  125: "HDR",
  126: "杜比视界",
  127: "8K",
};

const AUDIO_QUALITY_LABELS = {
  30216: "64K",
  30232: "132K",
  30280: "192K",
  30250: "杜比音频",
  30251: "Hi-Res / FLAC",
};

function createBilibiliError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function isObject(value) {
  return Boolean(value) && typeof value === "object";
}

function toPositiveInteger(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

function sanitizeBvid(value) {
  const bvid = String(value || "").trim();
  if (!/^BV[0-9A-Za-z]{10}$/.test(bvid)) {
    throw createBilibiliError("invalid-bvid", "Invalid Bilibili video id.");
  }
  return bvid;
}

function sanitizeCid(value) {
  const cid = toPositiveInteger(value);
  if (!cid) {
    throw createBilibiliError("invalid-cid", "Invalid Bilibili content id.");
  }
  return cid;
}

function normalizeUrl(value) {
  const url = String(value || "").trim();
  return /^https:\/\//i.test(url) ? url : "";
}

function normalizeUrlList(values) {
  const input = Array.isArray(values) ? values : [];
  return [...new Set(input.map(normalizeUrl).filter(Boolean))];
}

function getStreamUrl(stream) {
  if (!isObject(stream)) {
    return "";
  }
  return normalizeUrl(stream.baseUrl || stream.base_url || stream.url);
}

function getStreamBackupUrls(stream) {
  if (!isObject(stream)) {
    return [];
  }
  return normalizeUrlList(stream.backupUrl || stream.backup_url || []);
}

function getCodecRank(codecs) {
  const value = String(codecs || "").toLowerCase();
  if (/^(avc|avc1)/.test(value)) {
    return 3;
  }
  if (/^(hev|hvc|hevc)/.test(value)) {
    return 2;
  }
  if (/^(av01|av1)/.test(value)) {
    return 1;
  }
  return 0;
}

function formatVideoLabel(stream) {
  const quality = VIDEO_QUALITY_LABELS[toPositiveInteger(stream.id)];
  const height = toPositiveInteger(stream.height);
  const frameRate = String(stream.frameRate || stream.frame_rate || "");
  const fallback = height ? `${height}P` : "视频";
  const label = quality || fallback;
  return frameRate && /(?:^|[^0-9])60(?:[^0-9]|$)/.test(frameRate)
    ? label.includes("60")
      ? label
      : `${label}60`
    : label;
}

function formatAudioLabel(stream, specialType) {
  if (specialType === "flac") {
    return "Hi-Res / FLAC";
  }
  if (specialType === "dolby") {
    return "杜比音频";
  }
  return AUDIO_QUALITY_LABELS[toPositiveInteger(stream.id)] || "音频";
}

function normalizeVideoVariant(stream) {
  const url = getStreamUrl(stream);
  if (!url) {
    return null;
  }
  const codecs = String(stream.codecs || "");
  return {
    id: toPositiveInteger(stream.id),
    kind: "video",
    label: formatVideoLabel(stream),
    mimeType: String(stream.mimeType || stream.mime_type || "video/mp4"),
    codecs,
    bandwidth: Number(stream.bandwidth || 0),
    width: toPositiveInteger(stream.width),
    height: toPositiveInteger(stream.height),
    frameRate: String(stream.frameRate || stream.frame_rate || ""),
    url,
    backupUrls: getStreamBackupUrls(stream),
  };
}

function normalizeAudioVariant(stream, specialType = "normal") {
  const url = getStreamUrl(stream);
  if (!url) {
    return null;
  }
  return {
    id: toPositiveInteger(stream.id),
    kind: "audio",
    label: formatAudioLabel(stream, specialType),
    specialType,
    mimeType: String(stream.mimeType || stream.mime_type || "audio/mp4"),
    codecs: String(stream.codecs || ""),
    bandwidth: Number(stream.bandwidth || 0),
    url,
    backupUrls: getStreamBackupUrls(stream),
  };
}

function uniqueVariants(variants) {
  const seen = new Set();
  return variants.filter((variant) => {
    if (!variant || !variant.url || seen.has(variant.url)) {
      return false;
    }
    seen.add(variant.url);
    return true;
  });
}

function sortVideoVariants(variants) {
  return [...variants].sort((left, right) => {
    const qualityDifference = Number(right.id || 0) - Number(left.id || 0);
    if (qualityDifference !== 0) {
      return qualityDifference;
    }
    const codecDifference =
      getCodecRank(right.codecs) - getCodecRank(left.codecs);
    if (codecDifference !== 0) {
      return codecDifference;
    }
    return Number(right.bandwidth || 0) - Number(left.bandwidth || 0);
  });
}

function getAudioTypeRank(variant) {
  if (variant.specialType === "flac") {
    return 3;
  }
  if (variant.specialType === "dolby") {
    return 2;
  }
  return 1;
}

function sortAudioVariants(variants) {
  return [...variants].sort((left, right) => {
    const typeDifference = getAudioTypeRank(right) - getAudioTypeRank(left);
    if (typeDifference !== 0) {
      return typeDifference;
    }
    const qualityDifference = Number(right.id || 0) - Number(left.id || 0);
    if (qualityDifference !== 0) {
      return qualityDifference;
    }
    return Number(right.bandwidth || 0) - Number(left.bandwidth || 0);
  });
}

function selectCompatibleVariant(variants, canPlayType, kind) {
  const list = Array.isArray(variants) ? variants : [];
  const elementType = kind === "video" ? "video" : "audio";
  const supported = list.filter((variant) => {
    if (typeof canPlayType !== "function") {
      return true;
    }
    const type = variant.codecs
      ? `${variant.mimeType}; codecs="${variant.codecs}"`
      : variant.mimeType;
    return canPlayType(elementType, type) !== "";
  });
  return (supported.length ? supported : list)[0] || null;
}

function getMixinKey(imgKey, subKey) {
  const source = `${imgKey || ""}${subKey || ""}`;
  return WBI_MIXIN_KEY_TABLE.map((index) => source[index] || "")
    .join("")
    .slice(0, 32);
}

function getPathKey(url) {
  const pathname = new URL(String(url || "")).pathname;
  const filename = pathname.slice(pathname.lastIndexOf("/") + 1);
  return filename.slice(0, filename.lastIndexOf("."));
}

function createCookieRefreshCorrespondPath(timestamp) {
  const value = toPositiveInteger(timestamp);
  if (!value) {
    throw createBilibiliError(
      "invalid-refresh-timestamp",
      "Invalid Bilibili cookie refresh timestamp."
    );
  }
  return publicEncrypt(
    {
      key: BILIBILI_COOKIE_REFRESH_PUBLIC_KEY,
      padding: cryptoConstants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256",
    },
    Buffer.from(`refresh_${value}`, "utf8")
  ).toString("hex");
}

function extractCookieRefreshCsrf(html) {
  const match = String(html || "").match(
    /<div\b[^>]*\bid=["']1-name["'][^>]*>\s*([^<\s]+)\s*<\/div>/i
  );
  return match ? String(match[1] || "").trim() : "";
}

function createWbiQuery(params, mixinKey, timestamp) {
  const cleaned = {};
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      cleaned[key] = String(value).replace(/[!'()*]/g, "");
    }
  });
  cleaned.wts = String(timestamp || Math.floor(Date.now() / 1000));
  const query = Object.keys(cleaned)
    .sort()
    .map(
      (key) => `${encodeURIComponent(key)}=${encodeURIComponent(cleaned[key])}`
    )
    .join("&");
  const signature = createHash("md5")
    .update(`${query}${mixinKey}`)
    .digest("hex");
  return `${query}&w_rid=${signature}`;
}

function isBilibiliCookie(cookie) {
  const domain = String((cookie && cookie.domain) || "")
    .toLowerCase()
    .replace(/^\./, "");
  return (
    domain === "bilibili.com" ||
    domain.endsWith(".bilibili.com") ||
    domain === "bilivideo.com" ||
    domain.endsWith(".bilivideo.com") ||
    domain === "bilivideo.cn" ||
    domain.endsWith(".bilivideo.cn")
  );
}

function getCookieUrl(cookie) {
  const domain = String(cookie.domain || "").replace(/^\./, "");
  const path = String(cookie.path || "/");
  const scheme = cookie.secure === false ? "http" : "https";
  return `${scheme}://${domain}${path.startsWith("/") ? path : `/${path}`}`;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

class BilibiliService {
  constructor({ electronSession, store, safeStorage, now = () => Date.now() }) {
    if (!electronSession || typeof electronSession.fetch !== "function") {
      throw new Error("An Electron session with fetch support is required.");
    }
    this.electronSession = electronSession;
    this.store = store;
    this.safeStorage = safeStorage;
    this.now = now;
    this.activeQrSession = null;
    this.wbiKey = null;
    this.manifestCache = new Map();
    this.refreshPromise = null;
  }

  async requestJson(url, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await this.electronSession.fetch(url, {
        method: options.method || "GET",
        credentials: "include",
        headers: {
          Referer: BILIBILI_WEB_REFERER,
          ...(options.headers || {}),
        },
        body: options.body,
        signal: controller.signal,
      });
      const text = await response.text();
      let payload;
      try {
        payload = JSON.parse(text);
      } catch (error) {
        throw createBilibiliError(
          "invalid-response",
          "Invalid Bilibili response.",
          {
            httpStatus: response.status,
          }
        );
      }
      if (!response.ok) {
        throw createBilibiliError(
          "request-failed",
          "Bilibili request failed.",
          {
            httpStatus: response.status,
            bilibiliCode: Number(payload && payload.code) || 0,
          }
        );
      }
      const apiCode = Number(payload && payload.code);
      const allowedApiCodes = Array.isArray(options.allowApiCodes)
        ? options.allowApiCodes
        : [];
      if (!payload || (apiCode !== 0 && !allowedApiCodes.includes(apiCode))) {
        throw createBilibiliError(
          "bilibili-api-error",
          "Bilibili API rejected the request.",
          {
            httpStatus: response.status,
            bilibiliCode: apiCode || 0,
            bilibiliMessage: String(
              (payload && (payload.message || payload.msg)) || ""
            ),
          }
        );
      }
      return payload;
    } catch (error) {
      if (error && error.name === "AbortError") {
        throw createBilibiliError(
          "request-timeout",
          "Bilibili request timed out."
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async requestText(url, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await this.electronSession.fetch(url, {
        method: options.method || "GET",
        credentials: "include",
        headers: {
          Referer: BILIBILI_WEB_REFERER,
          ...(options.headers || {}),
        },
        body: options.body,
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) {
        throw createBilibiliError(
          "request-failed",
          "Bilibili request failed.",
          { httpStatus: response.status }
        );
      }
      return text;
    } catch (error) {
      if (error && error.name === "AbortError") {
        throw createBilibiliError(
          "request-timeout",
          "Bilibili request timed out."
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async getNav() {
    const payload = await this.requestJson(
      `${BILIBILI_API_BASE}/x/web-interface/nav`,
      { allowApiCodes: [-101] }
    );
    return isObject(payload.data) ? payload.data : {};
  }

  isSecureStorageAvailable() {
    try {
      return Boolean(
        this.safeStorage && this.safeStorage.isEncryptionAvailable()
      );
    } catch (error) {
      return false;
    }
  }

  async getPublicAuthState({ refreshIfNeeded = true } = {}) {
    try {
      let data = await this.getNav();
      if (data.isLogin === true && refreshIfNeeded) {
        const refreshResult = await this.refreshCookiesIfNeeded(data);
        if (refreshResult.refreshed) {
          data = await this.getNav();
        }
      }
      if (data.isLogin !== true) {
        return {
          loggedIn: false,
          secureStorageAvailable: this.isSecureStorageAvailable(),
        };
      }
      return {
        loggedIn: true,
        mid: String(data.mid || ""),
        uname: String(data.uname || ""),
        face: normalizeUrl(data.face),
        vipType: Number(data.vipType || 0),
        vipStatus: Number(data.vipStatus || 0),
        vipDueDate: Number(data.vipDueDate || 0),
        secureStorageAvailable: this.isSecureStorageAvailable(),
      };
    } catch (error) {
      return {
        loggedIn: false,
        secureStorageAvailable: this.isSecureStorageAvailable(),
        lastError: error && error.code ? error.code : "request-failed",
      };
    }
  }

  getStoredRefreshToken() {
    const stored = this.store.get(BILIBILI_REFRESH_TOKEN_STORE_KEY) || {};
    const encrypted = String(stored.encryptedRefreshToken || "");
    if (
      !encrypted ||
      !this.isSecureStorageAvailable()
    ) {
      return "";
    }
    try {
      return this.safeStorage.decryptString(Buffer.from(encrypted, "base64"));
    } catch (error) {
      return "";
    }
  }

  saveRefreshToken(refreshToken) {
    const token = String(refreshToken || "").trim();
    const previous = this.store.get(BILIBILI_REFRESH_TOKEN_STORE_KEY) || {};
    if (!token) {
      this.store.delete(BILIBILI_REFRESH_TOKEN_STORE_KEY);
      return false;
    }
    if (!this.isSecureStorageAvailable()) {
      this.store.set(BILIBILI_REFRESH_TOKEN_STORE_KEY, {
        ...previous,
        encryptedRefreshToken: "",
        refreshTokenUnavailable: true,
        updatedAt: this.now(),
      });
      return false;
    }
    this.store.set(BILIBILI_REFRESH_TOKEN_STORE_KEY, {
      ...previous,
      encryptedRefreshToken: this.safeStorage
        .encryptString(token)
        .toString("base64"),
      refreshTokenUnavailable: false,
      updatedAt: this.now(),
    });
    return true;
  }

  getRefreshMetadata() {
    const stored = this.store.get(BILIBILI_REFRESH_TOKEN_STORE_KEY);
    return isObject(stored) ? stored : {};
  }

  updateRefreshMetadata(metadata) {
    const previous = this.getRefreshMetadata();
    this.store.set(BILIBILI_REFRESH_TOKEN_STORE_KEY, {
      ...previous,
      ...metadata,
    });
  }

  async getBilibiliCookies() {
    if (
      !this.electronSession.cookies ||
      typeof this.electronSession.cookies.get !== "function"
    ) {
      return [];
    }
    const cookies = await this.electronSession.cookies.get({});
    return (Array.isArray(cookies) ? cookies : []).filter(isBilibiliCookie);
  }

  async getBilibiliCookieValue(name) {
    const cookieName = String(name || "");
    if (!cookieName) {
      return "";
    }
    const cookies = await this.getBilibiliCookies();
    const cookie = cookies.find((item) => item.name === cookieName);
    return cookie ? String(cookie.value || "") : "";
  }

  shouldCheckCookieRefresh(metadata) {
    const lastCheckAt = Number(metadata.lastCookieRefreshCheckAt || 0);
    if (!lastCheckAt || lastCheckAt > this.now()) {
      return true;
    }
    const interval = metadata.lastCookieRefreshError
      ? COOKIE_REFRESH_RETRY_INTERVAL_MS
      : COOKIE_REFRESH_CHECK_INTERVAL_MS;
    return this.now() - lastCheckAt >= interval;
  }

  async getCookieRefreshInfo(csrf) {
    return this.requestJson(
      `${BILIBILI_PASSPORT_BASE}/x/passport-login/web/cookie/info?csrf=${encodeURIComponent(
        csrf
      )}`,
      { allowApiCodes: [-101] }
    );
  }

  async getCookieRefreshCsrf(timestamp) {
    const correspondPath = createCookieRefreshCorrespondPath(timestamp);
    const html = await this.requestText(
      `${BILIBILI_WEB_REFERER}correspond/1/${correspondPath}`
    );
    const refreshCsrf = extractCookieRefreshCsrf(html);
    if (!refreshCsrf) {
      throw createBilibiliError(
        "missing-refresh-csrf",
        "Bilibili cookie refresh token is unavailable."
      );
    }
    return refreshCsrf;
  }

  async refreshCookiesIfNeeded(knownNav) {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }
    const operation = this.refreshCookiesIfNeededImpl(knownNav).catch(
      (error) => {
        this.updateRefreshMetadata({
          lastCookieRefreshCheckAt: this.now(),
          lastCookieRefreshError:
            (error && error.code) || "cookie-refresh-failed",
        });
        return {
          checked: true,
          refreshed: false,
          error: (error && error.code) || "cookie-refresh-failed",
        };
      }
    );
    this.refreshPromise = operation;
    try {
      return await operation;
    } finally {
      if (this.refreshPromise === operation) {
        this.refreshPromise = null;
      }
    }
  }

  async refreshCookiesIfNeededImpl(knownNav) {
    const nav = knownNav || (await this.getNav());
    if (nav.isLogin !== true) {
      if (nav.isLogin === false) {
        this.store.delete(BILIBILI_REFRESH_TOKEN_STORE_KEY);
      }
      return { checked: false, refreshed: false, loggedIn: false };
    }
    const metadata = this.getRefreshMetadata();
    if (!this.shouldCheckCookieRefresh(metadata)) {
      return { checked: false, refreshed: false, loggedIn: true };
    }
    const checkedAt = this.now();
    const csrf = await this.getBilibiliCookieValue("bili_jct");
    if (!csrf) {
      throw createBilibiliError(
        "missing-csrf",
        "Bilibili session CSRF cookie is unavailable."
      );
    }
    const infoPayload = await this.getCookieRefreshInfo(csrf);
    if (Number(infoPayload.code) === -101) {
      this.store.delete(BILIBILI_REFRESH_TOKEN_STORE_KEY);
      return { checked: true, refreshed: false, loggedIn: false };
    }
    const info = isObject(infoPayload.data) ? infoPayload.data : {};
    if (info.refresh !== true) {
      this.updateRefreshMetadata({
        lastCookieRefreshCheckAt: checkedAt,
        lastCookieRefreshError: "",
      });
      return { checked: true, refreshed: false, loggedIn: true };
    }
    const oldRefreshToken = this.getStoredRefreshToken();
    if (!oldRefreshToken) {
      this.updateRefreshMetadata({
        lastCookieRefreshCheckAt: checkedAt,
        lastCookieRefreshError: "refresh-token-unavailable",
      });
      return {
        checked: true,
        refreshed: false,
        loggedIn: true,
        refreshTokenUnavailable: true,
      };
    }
    const refreshCsrf = await this.getCookieRefreshCsrf(
      toPositiveInteger(info.timestamp) || this.now()
    );
    const refreshPayload = await this.requestJson(
      `${BILIBILI_PASSPORT_BASE}/x/passport-login/web/cookie/refresh`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        },
        body: new URLSearchParams({
          csrf,
          refresh_csrf: refreshCsrf,
          source: "main_web",
          refresh_token: oldRefreshToken,
        }).toString(),
      }
    );
    const refreshData = isObject(refreshPayload.data)
      ? refreshPayload.data
      : {};
    const newRefreshToken = String(refreshData.refresh_token || "").trim();
    if (!newRefreshToken) {
      throw createBilibiliError(
        "missing-refresh-token",
        "Bilibili cookie refresh did not return a new token."
      );
    }
    if (
      this.electronSession.cookies &&
      typeof this.electronSession.cookies.flushStore === "function"
    ) {
      await this.electronSession.cookies.flushStore();
    }
    this.saveRefreshToken(newRefreshToken);
    const newCsrf = await this.getBilibiliCookieValue("bili_jct");
    if (!newCsrf) {
      throw createBilibiliError(
        "missing-refreshed-csrf",
        "Bilibili refreshed session cookie is unavailable."
      );
    }
    await this.requestJson(
      `${BILIBILI_PASSPORT_BASE}/x/passport-login/web/confirm/refresh`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        },
        body: new URLSearchParams({
          csrf: newCsrf,
          refresh_token: oldRefreshToken,
        }).toString(),
      }
    );
    this.updateRefreshMetadata({
      lastCookieRefreshCheckAt: checkedAt,
      lastCookieRefreshError: "",
    });
    this.wbiKey = null;
    this.manifestCache.clear();
    return { checked: true, refreshed: true, loggedIn: true };
  }

  emitQrState(qrSession, state) {
    if (
      !qrSession ||
      qrSession.cancelled ||
      typeof qrSession.onState !== "function"
    ) {
      return;
    }
    qrSession.onState({
      sessionId: qrSession.id,
      expiresAt: qrSession.expiresAt,
      ...state,
    });
  }

  stopQrSession(qrSession) {
    if (!qrSession) {
      return;
    }
    qrSession.cancelled = true;
    if (qrSession.timer) {
      clearTimeout(qrSession.timer);
      qrSession.timer = null;
    }
    if (this.activeQrSession === qrSession) {
      this.activeQrSession = null;
    }
  }

  scheduleQrPoll(qrSession, delayMs = QR_POLL_INTERVAL_MS) {
    if (!qrSession || qrSession.cancelled) {
      return;
    }
    qrSession.timer = setTimeout(() => {
      this.pollQrSession(qrSession).catch(() => undefined);
    }, delayMs);
  }

  async verifyLoginAfterQr() {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const state = await this.getPublicAuthState({ refreshIfNeeded: false });
      if (state.loggedIn) {
        return state;
      }
      if (attempt < 2) {
        await delay(250);
      }
    }
    return this.getPublicAuthState({ refreshIfNeeded: false });
  }

  async pollQrSession(qrSession) {
    if (
      !qrSession ||
      qrSession.cancelled ||
      this.activeQrSession !== qrSession
    ) {
      return;
    }
    if (this.now() >= qrSession.expiresAt) {
      this.emitQrState(qrSession, { status: "expired" });
      this.stopQrSession(qrSession);
      return;
    }
    try {
      const payload = await this.requestJson(
        `${BILIBILI_PASSPORT_BASE}/x/passport-login/web/qrcode/poll?qrcode_key=${encodeURIComponent(
          qrSession.qrcodeKey
        )}`
      );
      const data = isObject(payload.data) ? payload.data : {};
      const code = Number(data.code);
      if (code === 0) {
        this.saveRefreshToken(data.refresh_token);
        if (
          this.electronSession.cookies &&
          typeof this.electronSession.cookies.flushStore === "function"
        ) {
          await this.electronSession.cookies.flushStore();
        }
        const auth = await this.verifyLoginAfterQr();
        if (!auth.loggedIn) {
          this.emitQrState(qrSession, {
            status: "error",
            error: "cookie-not-committed",
          });
          this.stopQrSession(qrSession);
          return;
        }
        this.emitQrState(qrSession, { status: "success", auth });
        this.stopQrSession(qrSession);
        return;
      }
      if (code === 86101) {
        this.emitQrState(qrSession, { status: "waiting" });
      } else if (code === 86090) {
        this.emitQrState(qrSession, { status: "scanned" });
      } else if (code === 86038) {
        this.emitQrState(qrSession, { status: "expired" });
        this.stopQrSession(qrSession);
        return;
      } else {
        this.emitQrState(qrSession, {
          status: "error",
          error: "qr-poll-failed",
        });
        this.stopQrSession(qrSession);
        return;
      }
      this.scheduleQrPoll(qrSession);
    } catch (error) {
      if (qrSession.cancelled) {
        return;
      }
      this.emitQrState(qrSession, {
        status: "error",
        error: error && error.code ? error.code : "request-failed",
      });
      this.stopQrSession(qrSession);
    }
  }

  async startQrLogin(onState) {
    this.stopQrSession(this.activeQrSession);
    const payload = await this.requestJson(
      `${BILIBILI_PASSPORT_BASE}/x/passport-login/web/qrcode/generate`
    );
    const data = isObject(payload.data) ? payload.data : {};
    const qrcodeKey = String(data.qrcode_key || "");
    const qrUrl = String(data.url || "");
    if (!qrcodeKey || !/^https:\/\//i.test(qrUrl)) {
      throw createBilibiliError(
        "invalid-qr",
        "Bilibili returned an invalid QR code."
      );
    }
    const qrSession = {
      id: randomBytes(16).toString("hex"),
      qrcodeKey,
      qrUrl,
      expiresAt: this.now() + QR_EXPIRES_IN_MS,
      cancelled: false,
      timer: null,
      onState,
    };
    this.activeQrSession = qrSession;
    const state = {
      sessionId: qrSession.id,
      status: "waiting",
      qrUrl,
      expiresAt: qrSession.expiresAt,
    };
    this.emitQrState(qrSession, state);
    this.scheduleQrPoll(qrSession);
    return state;
  }

  cancelQrLogin(sessionId) {
    if (
      this.activeQrSession &&
      (!sessionId || sessionId === this.activeQrSession.id)
    ) {
      const active = this.activeQrSession;
      this.emitQrState(active, { status: "cancelled" });
      this.stopQrSession(active);
    }
  }

  async logout() {
    const allCookies =
      this.electronSession.cookies &&
      typeof this.electronSession.cookies.get === "function"
        ? await this.electronSession.cookies.get({})
        : [];
    const cookies = allCookies.filter(isBilibiliCookie);
    const csrfCookie = cookies.find((cookie) => cookie.name === "bili_jct");
    let serverLoggedOut = false;
    if (csrfCookie && csrfCookie.value) {
      try {
        await this.requestJson(`${BILIBILI_PASSPORT_BASE}/login/exit/v2`, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
          },
          body: new URLSearchParams({ biliCSRF: csrfCookie.value }).toString(),
        });
        serverLoggedOut = true;
      } catch (error) {
        // Local credential removal is still required even when the remote call fails.
      }
    }
    if (
      this.electronSession.cookies &&
      typeof this.electronSession.cookies.remove === "function"
    ) {
      await Promise.all(
        cookies.map((cookie) =>
          this.electronSession.cookies.remove(getCookieUrl(cookie), cookie.name)
        )
      );
    }
    if (
      this.electronSession.cookies &&
      typeof this.electronSession.cookies.flushStore === "function"
    ) {
      await this.electronSession.cookies.flushStore();
    }
    this.store.delete(BILIBILI_REFRESH_TOKEN_STORE_KEY);
    this.wbiKey = null;
    this.manifestCache.clear();
    this.cancelQrLogin();
    return { serverLoggedOut };
  }

  async getWbiKey(forceRefresh = false) {
    if (!forceRefresh && this.wbiKey && this.wbiKey.expiresAt > this.now()) {
      return this.wbiKey;
    }
    const nav = await this.getNav();
    const image = nav.wbi_img || {};
    let imgKey;
    let subKey;
    try {
      imgKey = getPathKey(image.img_url);
      subKey = getPathKey(image.sub_url);
    } catch (error) {
      throw createBilibiliError(
        "missing-wbi-key",
        "Bilibili WBI key is unavailable."
      );
    }
    if (!imgKey || !subKey) {
      throw createBilibiliError(
        "missing-wbi-key",
        "Bilibili WBI key is unavailable."
      );
    }
    this.wbiKey = {
      mixinKey: getMixinKey(imgKey, subKey),
      expiresAt: this.now() + WBI_CACHE_MS,
    };
    return this.wbiKey;
  }

  async resolveVideoContext(bvidValue, cidValue) {
    const bvid = sanitizeBvid(bvidValue);
    const requestedCid = toPositiveInteger(cidValue);
    const payload = await this.requestJson(
      `${BILIBILI_API_BASE}/x/web-interface/view?bvid=${encodeURIComponent(
        bvid
      )}`
    );
    const data = isObject(payload.data) ? payload.data : {};
    const pages = Array.isArray(data.pages) ? data.pages : [];
    const page =
      pages.find(
        (item) => toPositiveInteger(item && item.cid) === requestedCid
      ) ||
      pages[0] ||
      data;
    const cid = requestedCid || toPositiveInteger(page && page.cid);
    if (!cid) {
      throw createBilibiliError(
        "missing-cid",
        "Bilibili video has no playable part."
      );
    }
    return {
      bvid,
      cid,
      duration: Number((page && page.duration) || data.duration || 0),
      title: String((page && page.part) || data.title || ""),
    };
  }

  async requestPlayurl(context, forceWbiRefresh = false) {
    const wbi = await this.getWbiKey(forceWbiRefresh);
    const query = createWbiQuery(
      {
        bvid: context.bvid,
        cid: context.cid,
        qn: 127,
        fnver: 0,
        fnval: 4048,
        fourk: 1,
      },
      wbi.mixinKey,
      Math.floor(this.now() / 1000)
    );
    return this.requestJson(
      `${BILIBILI_API_BASE}/x/player/wbi/playurl?${query}`
    );
  }

  normalizeManifest(context, data) {
    const dash = isObject(data.dash) ? data.dash : {};
    const videoVariants = sortVideoVariants(
      uniqueVariants(
        (Array.isArray(dash.video) ? dash.video : [])
          .map(normalizeVideoVariant)
          .filter(Boolean)
      )
    );
    const normalAudio = (Array.isArray(dash.audio) ? dash.audio : [])
      .map((stream) => normalizeAudioVariant(stream, "normal"))
      .filter(Boolean);
    const dolbyAudio = (
      dash.dolby && Array.isArray(dash.dolby.audio) ? dash.dolby.audio : []
    )
      .map((stream) => normalizeAudioVariant(stream, "dolby"))
      .filter(Boolean);
    const flacAudio =
      dash.flac && dash.flac.audio
        ? [normalizeAudioVariant(dash.flac.audio, "flac")].filter(Boolean)
        : [];
    const audioVariants = sortAudioVariants(
      uniqueVariants([...flacAudio, ...dolbyAudio, ...normalAudio])
    );
    const durl = Array.isArray(data.durl) ? data.durl : [];
    if (!audioVariants.length && durl[0] && normalizeUrl(durl[0].url)) {
      audioVariants.push({
        id: 0,
        kind: "audio",
        label: "标准音频",
        specialType: "normal",
        mimeType: "audio/mp4",
        codecs: "",
        bandwidth: 0,
        url: normalizeUrl(durl[0].url),
        backupUrls: normalizeUrlList(durl[0].backup_url || []),
      });
    }
    const compatibilityAudio = audioVariants.filter(
      (variant) => variant.specialType === "normal"
    );
    const defaultAudio =
      (compatibilityAudio.length ? compatibilityAudio : audioVariants)[0] ||
      null;
    const defaultVideo =
      videoVariants.find((variant) => getCodecRank(variant.codecs) >= 3) ||
      videoVariants[0] ||
      null;
    return {
      bvid: context.bvid,
      cid: context.cid,
      duration: Number(data.timelength || 0) / 1000 || context.duration,
      expiresAt: this.now() + MANIFEST_CACHE_MS,
      hasDash: Boolean(videoVariants.length && audioVariants.length),
      videoVariants,
      audioVariants,
      defaultAudioId: defaultAudio ? defaultAudio.id : 0,
      defaultAudioUrl: defaultAudio ? defaultAudio.url : "",
      defaultVideoId: defaultVideo ? defaultVideo.id : 0,
      defaultVideoUrl: defaultVideo ? defaultVideo.url : "",
    };
  }

  async getManifest({ bvid, cid, forceRefresh = false }) {
    const context = await this.resolveVideoContext(bvid, cid);
    const cacheKey = `${context.bvid}:${context.cid}`;
    const cached = this.manifestCache.get(cacheKey);
    if (!forceRefresh && cached && cached.expiresAt > this.now()) {
      return cached;
    }
    // A refresh failure is intentionally non-fatal here: the current cookie
    // may still be valid, and media playback must retain its audio-only path.
    await this.refreshCookiesIfNeeded();
    let payload;
    try {
      payload = await this.requestPlayurl(context);
    } catch (error) {
      if (
        error &&
        (error.bilibiliCode === -403 || error.bilibiliCode === -412)
      ) {
        this.wbiKey = null;
        payload = await this.requestPlayurl(context, true);
      } else {
        throw error;
      }
    }
    const manifest = this.normalizeManifest(
      context,
      isObject(payload.data) ? payload.data : {}
    );
    if (!manifest.audioVariants.length) {
      throw createBilibiliError(
        "no-audio-stream",
        "No playable Bilibili audio stream is available."
      );
    }
    this.manifestCache.set(cacheKey, manifest);
    return manifest;
  }

  async getAudioVariant({ bvid, cid, audioId, codecs = "", forceRefresh = false }) {
    const requestedId = toPositiveInteger(audioId);
    if (!requestedId) throw createBilibiliError("invalid-audio-id", "Invalid Bilibili audio id.");
    const manifest = await this.getManifest({ bvid, cid, forceRefresh });
    const requestedCodecs = String(codecs || "").trim();
    const variant = manifest.audioVariants.find(
      (item) => item.id === requestedId && (!requestedCodecs || String(item.codecs || "") === requestedCodecs)
    );
    if (!variant) throw createBilibiliError("audio-variant-unavailable", "The selected Bilibili audio variant is unavailable.");
    return { ...variant, urlCandidates: [variant.url, ...(variant.backupUrls || [])].filter(Boolean) };
  }

  async getLegacyAudioVariant({ sid }) {
    const safeSid = String(sid || "").trim();
    if (!/^\d+$/.test(safeSid)) throw createBilibiliError("invalid-audio-id", "Invalid Bilibili audio id.");
    const payload = await this.requestJson(`https://www.bilibili.com/audio/music-service-c/web/url?sid=${encodeURIComponent(safeSid)}`);
    const data = isObject(payload.data) ? payload.data : {};
    const urlCandidates = normalizeUrlList(data.cdns || []);
    if (!urlCandidates.length) throw createBilibiliError("no-audio-stream", "No playable Bilibili audio stream is available.");
    return { id: safeSid, label: "音频", codecs: "", mimeType: "audio/mp4", urlCandidates };
  }

  clearManifest({ bvid, cid } = {}) {
    if (!bvid) {
      this.manifestCache.clear();
      return;
    }
    const safeBvid = sanitizeBvid(bvid);
    const safeCid = cid ? sanitizeCid(cid) : 0;
    [...this.manifestCache.keys()].forEach((key) => {
      if (
        key.startsWith(`${safeBvid}:`) &&
        (!safeCid || key === `${safeBvid}:${safeCid}`)
      ) {
        this.manifestCache.delete(key);
      }
    });
  }

  shutdown() {
    this.cancelQrLogin();
    this.manifestCache.clear();
  }
}

module.exports = {
  AUDIO_QUALITY_LABELS,
  BilibiliService,
  VIDEO_QUALITY_LABELS,
  createCookieRefreshCorrespondPath,
  createWbiQuery,
  extractCookieRefreshCsrf,
  getMixinKey,
  normalizeAudioVariant,
  normalizeVideoVariant,
  sanitizeBvid,
  sanitizeCid,
  selectCompatibleVariant,
  sortAudioVariants,
  sortVideoVariants,
};
