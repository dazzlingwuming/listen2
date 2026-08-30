# Phase 1: Verified Bilibili Startup Slice - Pattern Map

**Mapped:** 2026-08-30  
**Files classified:** 14  
**Analogs found:** 13 / 14

## File Classification

| New/modified file | Role | Data flow | Closest analog | Match |
|---|---|---|---|---|
| `android/.../HttpBridgePolicy.java` | policy / DTO validator | request-response | itself + `NavigationPolicy.java` | exact extension |
| `android/.../AndroidHttpBridge.java` | native bridge / transport | async request-response, cancellation | itself | exact extension |
| `android/.../MainActivity.java` | lifecycle host | event-driven | itself | exact extension |
| `android/.../NavigationPolicy.java` | navigation policy | request-response | itself | exact extension |
| `app/.../js/lowebutil.js` | browser-safe RPC adapter | request-response, event-driven | `Listen2AndroidHttpAdapter` | exact extension |
| `app/.../js/provider/bilibili.js` | provider adapter | request-response, transform | existing Android search + Electron manifest branches | exact extension |
| `app/.../js/player_thread.js` | foreground player integration | event-driven, streaming | current URL-candidate/retry flow | exact extension |
| `app/.../js/controller/playlist.js` | home loading controller | async UI state | `runAfterFirstPaint` / current loader | role match, needs hardening |
| `app/.../js/controller/instant_search.js` | search controller | async UI state / cancellation | existing search-controller token pattern | role match |
| `app/.../js/controller/play.js` | lyric-entry state | async UI state | lyric candidate token/finalization | role match |
| `app/.../test/android_http_bilibili_search.test.js` | JS contract fixture | mocked request-response | itself | exact extension |
| `android/.../HttpBridgePolicyTest.java` | JVM policy test | deterministic request-response | itself | exact extension |
| `android/.../AndroidHttpBridge*Test.java` (new if pure helper is extracted) | lifecycle/DTO unit test | cancellation, terminal settlement | `HttpBridgePolicyTest.java` | role match |
| `android/scripts/phase01-api35-smoke.sh` plus redacted evidence template | emulator smoke / evidence | ADB event-driven | no local analog | new harness |

`android/app/build.gradle` and `listen1.html` already package/load all affected shared source directories (`build.gradle:8-35`, `listen1.html:45-81`), so no new asset-list or script-order change is expected unless a genuinely new shared JavaScript file is introduced. Prefer extending the loaded files above.

## Pattern Assignments

### `android/app/src/main/java/com/dazzlingwuming/listen2/HttpBridgePolicy.java`

**Role/data flow:** pure Java operation-policy and DTO validation; synchronous request-response.  
**Analog:** existing `HttpBridgePolicy` (`:11-39`, `:41-84`, `:203-258`).

Keep protocol constants, route construction, bounds, and validation Android-free. The v2 parser must reject unknown operation fields rather than accepting a URL-shaped fallback; retain the v1 route only for the existing consumers.

```java
// HttpBridgePolicy.java:41-84 -- fail closed before any transport starts.
static ValidationResult validateRequest(String method, String rawUrl) {
    if (rawUrl == null || rawUrl.isEmpty()) return ValidationResult.error("INVALID_URL");
    if (rawUrl.length() > MAX_URL_LENGTH) return ValidationResult.error("URL_TOO_LONG");
    URI uri = new URI(rawUrl);
    if (!"https".equalsIgnoreCase(uri.getScheme())) {
        return ValidationResult.error("HTTPS_REQUIRED");
    }
    // Exact host, port, method, path and query checks follow.
}
```

Use a new package-private `V2Request`/`V2Operation` helper only if it remains pure Java and directly JUnit-testable. The policy should construct exact Bilibili endpoints for search, `view/pages`, and playurl/manifest from bounded `keyword`, `page`, `bvid`, and `cid`; never accept `url`, `method`, `headers`, `cookies`, or arbitrary JSON keys in a v2 payload. Preserve `ValidationResult.error(code)` as the stable native error boundary.

**Landmines:** existing `BILIBILI_GET` is host-wide (`:62-67`); do not retain that breadth for v2. `RequestRoute` currently supplies fixed Referer (`:239-258`), which is the correct ownership point for native-only headers.

### `android/app/src/main/java/com/dazzlingwuming/listen2/AndroidHttpBridge.java`

**Role/data flow:** origin-bound asynchronous WebMessage RPC, queueing and HTTPS transport.  
**Analog:** `AndroidHttpBridge` (`:30-87`, `:89-167`, `:257-340`, `:365-407`).

```java
// AndroidHttpBridge.java:73-79 -- expose exactly one origin-scoped object.
WebViewCompat.addWebMessageListener(
        webView,
        HttpBridgePolicy.JAVASCRIPT_OBJECT_NAME,
        HttpBridgePolicy.ALLOWED_ORIGIN_RULES,
        bridge.new Listener());

// AndroidHttpBridge.java:119-133 -- bounded single-worker dispatch.
try {
    networkExecutor.execute(() -> { /* resolve fixed route, execute, reply */ });
} catch (RejectedExecutionException ignored) {
    replyOnMain(view, replyProxy, BridgeReply.error(parsed.requestId, 0, "BRIDGE_BUSY"));
}
```

Evolve `ParsedRequest` and `BridgeReply` into v2 envelope parsing/replying rather than installing another listener. Carry `requestId` and `pageEpoch` in every reply; register active calls by ID, make a v2 `cancel` operation remove queued work and disconnect active `HttpsURLConnection` where possible, and guard the terminal transition with one shared settle method. Keep deadline/timeout a separate error path.

```java
// AndroidHttpBridge.java:301-328 -- retain bounded, redirect-free transport.
connection.setConnectTimeout(CONNECT_TIMEOUT_MILLIS);
connection.setReadTimeout(READ_TIMEOUT_MILLIS);
connection.setInstanceFollowRedirects(false);
connection.setUseCaches(false);
connection.setRequestProperty("Accept-Encoding", "identity");
```

`resolveCookieHeader` and the in-memory `buvid3` bootstrap (`:170-201`) are reusable only for anonymous Bilibili calls. Do not persist, return, log, or accept cookie material. Validate response DTOs before `BridgeReply.success`: Bilibili code, requested BVID/CID, page identity, duration, MIME/codec allow-list, candidate count/HTTPS signed URL shape, and expiry metadata. Return a bounded descriptor, not provider JSON or raw transport response.

**Landmines:** `replyOnMain` correctly tolerates a destroyed WebView (`:332-340`), but it does not itself prevent a late state mutation; v2 request/page identity must do so. Current reply JSON exposes body (`:392-407`), unsuitable for the v2 manifest descriptor.

### `android/app/src/main/java/com/dazzlingwuming/listen2/MainActivity.java` and `NavigationPolicy.java`

**Role/data flow:** WebView lifecycle and safe navigation; event-driven.  
**Analogs:** `MainActivity` (`:44-67`, `:81-107`, `:134-145`, `:147-192`) and `NavigationPolicy` (`:15-35`).

```java
// MainActivity.java:134-145 -- tie bridge cancellation/removal to page teardown.
protected void onDestroy() {
    if (webView != null) {
        if (httpBridge != null) {
            httpBridge.destroy(webView);
            httpBridge = null;
        }
        webView.destroy();
        webView = null;
    }
    super.onDestroy();
}
```

Keep secure settings and the exact appassets main surface; add bridge page-epoch lifecycle hooks here only if the bridge cannot derive them from message state. External navigation must keep using `ACTION_VIEW` without forwarding bridge headers/cookies.

**Landmine:** `NavigationPolicy.isApprovedExternalUrl` intentionally permits normal HTTP(S) external browser handoff (`:27-35`); do not use it as provider-transport authorization.

### `app/listen1_chrome_extension/js/lowebutil.js`

**Role/data flow:** classic-global v2 RPC adapter, Promise settlement, Angular digest, cancellation.  
**Analog:** `Listen2AndroidHttpAdapter` (`:139-389`).

```javascript
// lowebutil.js:247-278 -- resolve exactly the matching pending request.
const entry = pending.get(response.requestId);
if (!entry) return;
pending.delete(response.requestId);
clearTimeout(entry.timeoutId);
if (!response.ok) {
  rejectPending(entry, createError('android-http-failed', 'Android HTTP request failed.', { status: response.status }));
  return;
}
resolvePending(entry, { status: response.status, body: response.body });
```

Keep this one global (`window.Listen2AndroidHttpAdapter`, `:391-393`) and evolve it to a `request(operation, payload, { pageEpoch, timeoutMs })` API with `cancel(requestId)`/cancel handle. Maintain the v1 `get()` compatibility path untouched for NetEase and temporarily shipped Bilibili search callers. For v2, validate replies before touching `pending`, ignore mismatched epoch/unknown/duplicate replies, and send cancellation before locally settling a superseded call. Preserve digest ordering (`:231-245`) so Angular mutations happen before the digest.

**Landmines:** do not overwrite bridge `onmessage`; preserve the chaining behavior (`:284-300`). Do not reintroduce arbitrary URL validation as v2 input merely because `validateUrl()` exists (`:310-318`).

### `app/listen1_chrome_extension/js/provider/bilibili.js`

**Role/data flow:** provider-specific transform from v2 descriptors to legacy provider/player contracts.  
**Analogs:** Android search seam (`:1890-1932`, `:2478-2506`), part transform (`:2036-2053`), safe failure mapper (`:2140-2225`), manifest bootstrap (`:2228-2422`).

```javascript
// bilibili.js:2397-2418 -- pass ordered candidates and media metadata to the player.
const urlCandidates = [audio.url, ...(Array.isArray(audio.backupUrls) ? audio.backupUrls : [])]
  .filter(Boolean);
success({
  url: urlCandidates[0],
  urlCandidates: [...new Set(urlCandidates)],
  bitrate: audio.label || '',
  duration: this.parse_duration(manifest.duration),
  platform: 'bilibili',
  audioCacheDescriptor: { kind: 'video', bvid: videoIdParts.bvid, cid: Number(manifest.cid || videoIdParts.cid || 0), codecs: String(audio.codecs || ''), mimeType: String(audio.mimeType || '') },
});
```

Add Android-only v2 calls at `search`, `bi_track`/detail, and `bootstrap_track`; leave Electron behavior unchanged. Use `bi_convert_song3` IDs (`bitrack_v_<bvid>-<cid>`) as the selected-part identity. An unqualified BVID may receive the API-declared first page; once a part was explicitly selected, require that exact CID and convert absence to `invalid-part`, not the current legacy `pages[0]` fallback (`:2293-2309`). Extend `create_media_failure` with stable safe statuses rather than surfacing native exception messages.

**Landmines:** `bootstrap_video_track_legacy` makes direct Axios calls and silently falls back to first page; it is not an Android implementation pattern. Browser codec probing via `get_can_play_type` (`:2127-2138`) is the correct boundary before Howler starts.

### `app/listen1_chrome_extension/js/player_thread.js`

**Role/data flow:** existing foreground Howler proof, track-epoch guarded retry, streaming progress.  
**Analog:** request token/recovery (`:1604-1699`), Howler callbacks (`:1779-1960`), playback watch (`:354-430`).

```javascript
// player_thread.js:1621-1634 -- reject late media resolution for a superseded track.
MediaService.bootstrapTrack(msg.data, (bootinfo) => {
  if (!this.isCurrentMediaUrlRequest(index, track, playNow, requestToken)) return;
  // then mutate playlist, choose URL candidate, and load.
});
```

Keep finite candidate recovery and `isCurrentMediaUrlRequest` token checks. Extend descriptor handling to retain MIME/codec and choose an audio-compatible candidate; do not introduce a native audio player in this phase. The Phase 1 emulator assertion should observe `beginPlaybackWatch`/position advancement after `onplay`, not accept `setMediaURI()` as playback success.

**Landmine:** `finishLoad` hardcodes `format: 'mp3'` (`:1791-1797`), which conflicts with Bilibili `audio/mp4` descriptors. Fix in the shared Howler construction path using validated descriptor MIME/codec/canPlayType, preserving current non-Bilibili behavior.

### `app/listen1_chrome_extension/js/controller/playlist.js`, `controller/instant_search.js`, and `controller/play.js`

**Role/data flow:** Angular state finalization, retry and stale-result protection.  
**Analogs:** post-first-paint scheduler (`playlist.js:18-33`), lyric token/state settlement (`play.js:2730-2794`), `$destroy` cleanup (`play.js:3436-3443`).

```javascript
// play.js:2768-2785 -- token plus current-track guard before UI state change.
$scope.$evalAsync(() => {
  if (searchToken !== lyricSearchToken || !$scope.currentPlaying || $scope.currentPlaying.id !== trackId) return;
  $scope.lyricSearchResults = Array.from(candidatesById.values());
  $scope.lyricSearchPending = completedRequests < requests.length;
  $scope.lyricSearchState = $scope.lyricSearchResults.length > 0 ? 'results' :
    ($scope.lyricSearchPending ? 'loading' : (failedRequests > 0 ? 'error' : 'empty'));
});
```

Apply this pattern to Bilibili search/detail/part UI: increment an epoch when user submits, cancels, navigates, or tears down; cancel adapter handles; retain prior valid rows when a later request fails; ensure every success, error, timeout, and cancellation clears only its own busy indicator. For the home controller, retain `runAfterFirstPaint` but add a deadline/failure completion path: existing callbacks only set `loading=false` on success (`playlist.js:41-66`). Lyric entry may reuse the existing primary surface, but it must independently show loading/content/unavailable/error without blocking playback.

### Tests and emulator evidence

**JS analog:** `app/listen1_chrome_extension/test/android_http_bilibili_search.test.js:19-56,123-414` uses Node `assert` plus `vm`, a mocked message bridge, and no browser dependency.

```javascript
// android_http_bilibili_search.test.js:123-185 -- deterministic out-of-order/duplicate reply fixture.
const first = adapter.get('https://api.bilibili.com/first');
const second = adapter.get('https://api.bilibili.com/second');
bridge.emit({ requestId: bridge.posted[1].requestId, ok: true, status: 200, body: '{"second":true}', version: 1 });
bridge.emit({ requestId: bridge.posted[0].requestId, ok: true, status: 200, body: '{"first":true}', version: 1 });
```

Extend this same harness with v2 success/cancel/stale epoch/timeout/duplicate terminal tests; add fixtures for detail/pages and manifest schema, exact CID, malformed/oversize/redirect, incompatible codec and safe error copy. Test controller state in an equally deterministic VM harness; do not make live Bilibili a CI fixture.

**JVM analog:** `android/app/src/test/java/com/dazzlingwuming/listen2/HttpBridgePolicyTest.java:9-101` uses direct package-private access and assert helpers.

```java
// HttpBridgePolicyTest.java:97-101 -- compact stable-code test helper.
private static void assertError(String message, String method, String url, String expectedError) {
    HttpBridgePolicy.ValidationResult result = HttpBridgePolicy.validateRequest(method, url);
    assertFalse(message, result.isValid());
    assertEquals(message, expectedError, result.getErrorCode());
}
```

New test-only files may cover pure v2 DTO/lifecycle helpers; keep Android APIs out of them. Add an opt-in API-35 ADB smoke script and redacted evidence record under a non-packaged `android/` test/docs location. It must capture command, timestamp/timezone, APK and Git SHA, AVD/API/ABI/WebView/network, timings, redacted screenshots/log excerpts, pass/fail/not-verified steps, and recovery path. It must never write signed URLs, cookies, headers, or credentials.

## Shared Patterns

### Security boundary

- Origin listener registration is exact appassets only: `AndroidHttpBridge.java:68-80`.
- The callback repeats main-frame/origin validation before parsing/dispatch: `AndroidHttpBridge.java:97-117`.
- Navigation is packaged assets or external browser, never arbitrary in-WebView URLs: `MainActivity.java:179-191` and `NavigationPolicy.java:15-35`.
- Preserve fixed transport headers and `setInstanceFollowRedirects(false)`; only native selects provider headers (`AndroidHttpBridge.java:301-312`).

### Terminal-state and Angular pattern

- Maintain one `pending` map entry, delete it before resolve/reject, and clear its timeout (`lowebutil.js:247-278`).
- Pair each request token with an identity/current-state guard before every mutation (`player_thread.js:1621-1634`, `play.js:2768-2785`).
- Use `$evalAsync` after mutations and always provide a final loading state. The existing playlist controller has the exact failure gap Phase 1 must close (`playlist.js:41-66`).

### Safe provider error pattern

- Convert only bounded stable codes to displayable kinds; emit local fixed messages rather than raw Axios/native errors (`bilibili.js:2140-2225`).
- Preserve the current result/track during independent lyric/provider failure where the primary action remains valid; use `Promise.allSettled` only for optional lyric enrichment (`bilibili.js:1498-1511`).

### Playback pattern

- Provider sends `urlCandidates` and typed metadata; player owns finite recovery and active-track checks (`bilibili.js:2397-2418`, `player_thread.js:1654-1677`).
- Phase 1 remains Howler HTML5 foreground playback. No Media3 service, notification ownership, cache ownership, or parallel native player belongs here.

## No Analog Found

| File/concern | Role | Data flow | Planner guidance |
|---|---|---|---|
| `android/scripts/phase01-api35-smoke.sh` and evidence template | emulator test / evidence | ADB lifecycle and live provider | New harness; consume Validation Strategy’s required fields and make live failure explicit `BLOCKED`/`not verified`, never fake pass. |
| Explicit active-connection cancellation registry | transport lifecycle | cancellation | Extract a small pure/package-private helper from `AndroidHttpBridge` if needed, then JUnit its exactly-once semantics; do not hide it in Activity callbacks. |

## Metadata

**Analog search scope:** Android host/policy/tests; shared bridge/provider/player/controllers; Gradle asset allow-list and HTML loader.  
**Files scanned:** 15 focused source/test/config files.  
**Pattern extraction date:** 2026-08-30.
