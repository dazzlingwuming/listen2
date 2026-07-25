const assert = require("assert");
const test = require("node:test");
const {
  BilibiliService,
  createCookieRefreshCorrespondPath,
  createWbiQuery,
  extractCookieRefreshCsrf,
  selectCompatibleVariant,
} = require("../bilibiliService");

function createStore() {
  const values = new Map();
  return {
    delete(key) {
      values.delete(key);
    },
    get(key) {
      return values.get(key);
    },
    set(key, value) {
      values.set(key, value);
    },
    values,
  };
}

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
  };
}

function createSession(fetchImpl) {
  return {
    cookies: {
      flushStore: async () => {},
      get: async () => [],
      remove: async () => {},
    },
    fetch: fetchImpl,
  };
}

test("WBI query is sorted, filters reserved characters, and signs deterministically", () => {
  const query = createWbiQuery(
    { cid: 2, keyword: "a!'()*b", bvid: "BV1y7411Q7Eq" },
    "0123456789abcdef0123456789abcdef",
    123
  );

  assert.match(
    query,
    /^bvid=BV1y7411Q7Eq&cid=2&keyword=ab&wts=123&w_rid=[a-f0-9]{32}$/
  );
});

test("compatible stream selection falls back only when needed", () => {
  const variants = [
    { id: 30280, mimeType: "audio/unsupported", codecs: "mp4a.40.2" },
    { id: 30232, mimeType: "audio/mp4", codecs: "mp4a.40.2" },
  ];
  const selected = selectCompatibleVariant(
    variants,
    (kind, mime) =>
      kind === "audio" && mime.includes("unsupported") ? "" : "probably",
    "audio"
  );

  assert.strictEqual(selected.id, 30232);
  assert.strictEqual(
    selectCompatibleVariant(variants, () => "", "audio").id,
    30280
  );
});

test("anonymous nav is not treated as an API failure and a DASH manifest prefers normal high-quality audio", async () => {
  const requests = [];
  const session = createSession(async (url) => {
    requests.push(url);
    if (url.includes("/x/web-interface/nav")) {
      return jsonResponse({
        code: -101,
        data: {
          isLogin: false,
          wbi_img: {
            img_url: "https://i0.hdslb.com/bfs/wbi/1234567890abcdef.png",
            sub_url: "https://i0.hdslb.com/bfs/wbi/fedcba0987654321.png",
          },
        },
      });
    }
    if (url.includes("/x/web-interface/view")) {
      return jsonResponse({
        code: 0,
        data: {
          duration: 180,
          pages: [{ cid: 123, duration: 180, part: "Part 1" }],
        },
      });
    }
    if (url.includes("/x/player/wbi/playurl")) {
      return jsonResponse({
        code: 0,
        data: {
          timelength: 180000,
          dash: {
            video: [
              {
                id: 32,
                baseUrl: "https://example.test/video-avc.m4s",
                mimeType: "video/mp4",
                codecs: "avc1.64001F",
                width: 854,
                height: 480,
              },
            ],
            audio: [
              {
                id: 30216,
                baseUrl: "https://example.test/audio-low.m4s",
                mimeType: "audio/mp4",
                codecs: "mp4a.40.2",
              },
              {
                id: 30280,
                baseUrl: "https://example.test/audio-high.m4s",
                mimeType: "audio/mp4",
                codecs: "mp4a.40.2",
              },
            ],
            flac: {
              audio: {
                id: 30251,
                baseUrl: "https://example.test/audio-flac.m4s",
                mimeType: "audio/flac",
                codecs: "flac",
              },
            },
          },
        },
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  const service = new BilibiliService({
    electronSession: session,
    safeStorage: { isEncryptionAvailable: () => false },
    store: createStore(),
    now: () => 100000,
  });

  const [state, manifest] = await Promise.all([
    service.getPublicAuthState(),
    service.getManifest({ bvid: "BV1y7411Q7Eq", cid: 123 }),
  ]);

  assert.strictEqual(state.loggedIn, false);
  assert.strictEqual(manifest.defaultAudioId, 30280);
  assert.strictEqual(manifest.defaultVideoId, 32);
  assert.deepStrictEqual(
    manifest.audioVariants.map((variant) => variant.id),
    [30251, 30280, 30216]
  );
  assert.ok(requests.some((url) => url.includes("/x/player/wbi/playurl")));
});

test("refresh tokens never fall back to plaintext storage", async () => {
  const store = createStore();
  const service = new BilibiliService({
    electronSession: createSession(async () => jsonResponse({ code: 0 })),
    safeStorage: { isEncryptionAvailable: () => false },
    store,
  });

  assert.strictEqual(
    service.saveRefreshToken("very-secret-refresh-token"),
    false
  );
  assert.strictEqual(service.getStoredRefreshToken(), "");
  assert.ok(
    !JSON.stringify(store.get("bilibiliAuth")).includes(
      "very-secret-refresh-token"
    )
  );
});

test("cookie refresh rotates the encrypted token and confirms the old one", async () => {
  const store = createStore();
  const secureStorage = {
    decryptString: (value) =>
      Buffer.from(value).toString("utf8").replace(/^encrypted:/, ""),
    encryptString: (value) => Buffer.from(`encrypted:${value}`, "utf8"),
    isEncryptionAvailable: () => true,
  };
  store.set("bilibiliAuth", {
    encryptedRefreshToken: secureStorage
      .encryptString("old-refresh-token")
      .toString("base64"),
  });
  let csrf = "old-csrf";
  const requests = [];
  const session = {
    cookies: {
      flushStore: async () => {},
      get: async () => [
        {
          domain: ".bilibili.com",
          name: "bili_jct",
          path: "/",
          secure: true,
          value: csrf,
        },
        {
          domain: ".bilibili.com",
          name: "SESSDATA",
          path: "/",
          secure: true,
          value: "session-value-not-exposed",
        },
      ],
      remove: async () => {},
    },
    fetch: async (url, options = {}) => {
      requests.push({ url, body: String(options.body || "") });
      if (url.includes("/x/web-interface/nav")) {
        return jsonResponse({
          code: 0,
          data: { isLogin: true, mid: 1, uname: "tester" },
        });
      }
      if (url.includes("/web/cookie/info")) {
        assert.match(url, /csrf=old-csrf/);
        return jsonResponse({
          code: 0,
          data: { refresh: true, timestamp: 1720000000000 },
        });
      }
      if (url.includes("/correspond/1/")) {
        return {
          ok: true,
          status: 200,
          text: async () => '<div class="token" id="1-name">refresh-csrf</div>',
        };
      }
      if (url.includes("/web/cookie/refresh")) {
        assert.match(options.body, /csrf=old-csrf/);
        assert.match(options.body, /refresh_csrf=refresh-csrf/);
        assert.match(options.body, /refresh_token=old-refresh-token/);
        csrf = "new-csrf";
        return jsonResponse({
          code: 0,
          data: { refresh_token: "new-refresh-token" },
        });
      }
      if (url.includes("/web/confirm/refresh")) {
        assert.match(options.body, /csrf=new-csrf/);
        assert.match(options.body, /refresh_token=old-refresh-token/);
        return jsonResponse({ code: 0, data: {} });
      }
      throw new Error(`Unexpected request: ${url}`);
    },
  };
  const service = new BilibiliService({
    electronSession: session,
    safeStorage: secureStorage,
    store,
    now: () => 1720000001000,
  });

  const state = await service.getPublicAuthState();

  assert.strictEqual(state.loggedIn, true);
  assert.strictEqual(service.getStoredRefreshToken(), "new-refresh-token");
  assert.strictEqual(
    store.get("bilibiliAuth").lastCookieRefreshError,
    ""
  );
  assert.ok(requests.some((request) => request.url.includes("/correspond/1/")));
  assert.ok(
    requests.some((request) => request.url.includes("/web/confirm/refresh"))
  );
});

test("cookie refresh correspondence values are local RSA output and HTML-only", () => {
  assert.match(
    createCookieRefreshCorrespondPath(1720000000000),
    /^[a-f0-9]{256}$/
  );
  assert.strictEqual(
    extractCookieRefreshCsrf('<div data-x="1" id="1-name">abc123</div>'),
    "abc123"
  );
  assert.strictEqual(extractCookieRefreshCsrf("<div>missing</div>"), "");
});

test("QR sessions expose only a short-lived public URL and can be cancelled", async () => {
  const session = createSession(async (url) => {
    if (url.includes("/qrcode/generate")) {
      return jsonResponse({
        code: 0,
        data: {
          qrcode_key: "private-key-stays-in-main-process",
          url: "https://passport.bilibili.com/h5-app/passport/sso/scan?auth_code=test",
        },
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  const service = new BilibiliService({
    electronSession: session,
    safeStorage: { isEncryptionAvailable: () => false },
    store: createStore(),
    now: () => 5000,
  });

  const state = await service.startQrLogin(() => {});

  assert.strictEqual(state.status, "waiting");
  assert.match(state.sessionId, /^[a-f0-9]{32}$/);
  assert.strictEqual(state.expiresAt, 185000);
  assert.ok(!Object.prototype.hasOwnProperty.call(state, "qrcodeKey"));
  service.cancelQrLogin(state.sessionId);
});
