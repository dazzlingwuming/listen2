# Phase 1: Verified Bilibili Startup Slice - Context

**Gathered:** 2026-08-30
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver one audible, emulator-verified Android vertical slice: a usable startup/home shell, current Bilibili search results, exact video/part detail, an authorized audio descriptor that actually starts foreground playback, and entry into the existing primary lyric experience. This phase also establishes the typed, cancellable Android RPC boundary and honest terminal error UX. Native Media3 ownership, full lyric synchronization, persistent login, offline cache, and broader providers remain in their assigned later phases.

</domain>

<decisions>
## Implementation Decisions

### Bridge contract and lifecycle
- **D-01:** Introduce a versioned operation-based RPC envelope rather than broadening the current arbitrary-URL-shaped GET interface. Phase 1 operations cover Bilibili search, video detail/pages, and authorized audio manifest resolution; native code constructs final URLs and headers from bounded typed parameters. — **Reversibility:** costly — operation names and response schemas become the shared frontend/native contract used by later provider adapters.
- **D-02:** Every request carries a bounded `requestId` and `pageEpoch`; the reply carries the same identity plus one of `ok`, `cancelled`, or a structured error. The adapter drops mismatched epochs and settles each request once.
- **D-03:** Cancellation is explicit: superseded search/navigation/page teardown sends a cancel message, removes queued work where possible, disconnects active transport where possible, and prevents late replies from mutating Angular state. Timeout is a distinct terminal error, not simulated cancellation.
- **D-04:** Keep protocol v1 only as a temporary compatibility path for already-shipped Bilibili/NetEase search consumers while Phase 1 migrates Bilibili to v2. Do not add new v1 routes or widen the current Bilibili host policy.

### Bilibili selection and authorization
- **D-05:** Phase 1 proves anonymous playback of content publicly available to the user; it may use the bounded in-memory `buvid3` bootstrap already present. Persistent cookies, QR login, refresh tokens, and authenticated quality selection stay in Phase 5.
- **D-06:** An unqualified BVID may deliberately resolve to the API-declared first page after pages are shown. Once a CID/part is explicitly selected, a missing CID is an `invalid-part` failure; never silently play `pages[0]` for a missing explicit selection.
- **D-07:** The native response validates Bilibili status, requested BVID/CID, duration, MIME/codec, signed URL shape, candidate count, and expiry-related metadata. It returns only bounded playback fields needed by the shared player and never exposes cookie/header control.

### Foreground playback and lyric entry
- **D-08:** Phase 1 uses the existing foreground Howler/HTML5 player only as a bounded proof that selected public Bilibili audio is audible. It consumes a typed descriptor containing MIME/codec and ordered CDN candidates. Phase 2 replaces playback ownership with Media3; Phase 1 must not create a competing native player. — **Reversibility:** costly — duplicating a native player now would create the dual-player state that Phase 2 is designed to eliminate.
- **D-09:** Playback success means progress advances beyond `0:00` and pause/resume works on the emulator, not merely that a URL or audio object was produced. Candidate recovery is finite and remains bound to the current track/request epoch.
- **D-10:** Phase 1 opens the existing primary lyric surface for the current track and produces a truthful loading/content/unavailable/error state without delaying audio. Full Media3-clock synchronization, manual source persistence, translations, and TalkBack behavior are Phase 3 scope.

### Startup, home, and failure UX
- **D-11:** Android renders the local mobile shell and usable navigation first. Remote home/catalog requests run after first paint with deadlines and explicit finalization; a failed source cannot leave `Gathering` indefinitely or erase already successful/local content.
- **D-12:** Skip unsolicited Android startup login probes that cannot produce a supported authenticated state in this phase. Account surfaces show truthful capability state and only probe after a user action or when the relevant later-phase session adapter exists.
- **D-13:** Search/detail/play/lyric errors map stable native/provider codes into distinct empty, offline/TLS, timeout, malformed-response, permission/login, unavailable-stream, unsupported-codec, and cancelled states. Preserve valid results and show one source-specific retry action; never surface raw URLs, headers, cookies, or exception text.

### Verification evidence
- **D-14:** Deterministic tests use bounded fixtures for success, cancellation, stale epoch, timeout, redirect, oversize body, malformed schema, explicit missing CID, incompatible codec, and terminal-error uniqueness.
- **D-15:** Phase completion also requires a timestamped API 35 emulator smoke with a public anonymous Bilibili item: cold launch to usable home, search, result selection/part, audible playback with advancing position, lyric entry state, cancellation/retry, and external-navigation safety. If the live provider is unavailable, record the external blocker; fixture/build-only evidence does not complete the phase.
- **D-16:** Emulator evidence records APK SHA-256, git SHA, API/WebView version, network, commands, timings, screenshots/log excerpts, passed/failed steps, and uncovered behavior. No credential or signed media URL may appear in the evidence.

### the agent's Discretion
The planner may choose internal Java class names, exact operation identifiers, test fixture layout, localized copy, and whether v1 compatibility is implemented as an adapter or parser branch, provided all decisions above and the phase requirements remain intact.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Scope and acceptance
- `.planning/ROADMAP.md` §Phase 1 — fixed goal, requirements, dependencies, and observable success criteria.
- `.planning/REQUIREMENTS.md` — NET-001/002/003, SRCH-001/002/003, SEC-001/002/003 and the rule that degraded/not verified is not completion.
- `.planning/PROJECT.md` — complete Android parity intent, security/compliance limits, simulator evidence gate, and original mobile-app reference policy.

### Architecture and risks
- `.planning/research/ARCHITECTURE.md` — target typed bridge, native provider adapter, WebView lifecycle, and staged Media3 migration boundaries.
- `.planning/research/PITFALLS.md` — arbitrary-proxy, stale-message, provider-drift, dual-player, fake-parity, and runtime-testing failure modes.
- `android/README.md` — current secure WebView host, bridge limits, and authoritative Android build commands.

### Existing implementation seams
- `android/app/src/main/java/com/dazzlingwuming/listen2/HttpBridgePolicy.java` — pure-Java origin, HTTPS, route, parameter, and response-boundary policy.
- `android/app/src/main/java/com/dazzlingwuming/listen2/AndroidHttpBridge.java` — WebMessage listener, bounded executor, anonymous Bilibili fingerprint, transport, and reply path.
- `android/app/src/main/java/com/dazzlingwuming/listen2/MainActivity.java` — asset loading, WebView lifecycle, navigation, bridge installation, and startup label.
- `app/listen1_chrome_extension/js/lowebutil.js` — current v1 Promise adapter, request identity, response validation, timeout, and Angular digest integration.
- `app/listen1_chrome_extension/js/provider/bilibili.js` — Android search seam, video context, part selection, legacy bootstrap, media failure normalization, and lyric entry metadata.
- `app/listen1_chrome_extension/js/controller/playlist.js` — remote-home loading lifecycle and current spinner finalization gap.
- `app/listen1_chrome_extension/js/player_thread.js` — current foreground player, CDN candidate recovery, progress, and track-epoch behavior.
- `app/listen1_chrome_extension/test/android_http_bilibili_search.test.js` — existing Android bridge/search contract-test pattern.
- `android/app/src/test/java/com/dazzlingwuming/listen2/HttpBridgePolicyTest.java` — existing JVM boundary-test pattern.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `Listen2AndroidHttpAdapter` already provides bounded request IDs, response validation, timeouts, one listener, and Angular digest scheduling; evolve it rather than adding `addJavascriptInterface` or another global bridge.
- `HttpBridgePolicy` is Android-independent and already tests origin/HTTPS/query constraints; keep v2 operation/parameter validation pure Java so JVM tests remain cheap.
- `AndroidHttpBridge` already has a bounded single-worker queue, no redirects, response caps, and in-memory anonymous Bilibili fingerprint bootstrap.
- `bilibili.create_media_failure`, playable-variant selection, and `urlCandidates` already normalize desktop playback behavior and can consume a platform-specific descriptor.

### Established Patterns
- Shared frontend scripts are classic globals loaded in fixed HTML order; new bridge code must remain browser-safe and explicitly exported on `window`.
- Provider UI uses callback/result contracts while bridge calls are Promises; adapters must settle both success and failure paths and schedule Angular digest after state mutation.
- Android assets are copied by the explicit Gradle allow-list; tests and new shared modules must update that list rather than editing generated build assets.

### Integration Points
- Install and destroy the single bridge with the WebView in `MainActivity`; bind request cancellation to bridge and page lifecycle.
- Route Bilibili Android search, view/pages, and playback bootstrap through the v2 adapter while leaving Electron paths unchanged.
- Add controller-level finalization/retry so remote home and result pages always exit loading after success, failure, timeout, or cancellation.
- Extend frontend contract tests and Android JVM tests first, then add emulator instrumentation/smoke evidence without converting live provider behavior into deterministic CI.

</code_context>

<specifics>
## Specific Ideas

- Use the official `listen1/listen1_mobile@v0.8.2` only as a behavior/data-contract reference for provider IDs, queue expectations, and mobile navigation; do not copy its React Native runtime, cleartext networking, or obsolete provider calls.
- The user expects a working product, not a UI sample. The phase demo must visibly progress from search to audible playback and a non-stuck lyric state.

</specifics>

<deferred>
## Deferred Ideas

- Media3 sole playback owner, background service, notification/lock-screen/audio-focus/queue recovery — Phase 2.
- Full synchronized/manual/translated/accessible lyrics contract — Phase 3.
- Bilibili QR login, persistent cookie/session refresh, logout cleanup — Phase 5.
- Cache/download/offline ownership — Phase 8.
- MV, effects, loudness, and DeepSeek — Phase 9.

</deferred>

---

*Phase: 01-verified-bilibili-startup-slice*
*Context gathered: 2026-08-30*
