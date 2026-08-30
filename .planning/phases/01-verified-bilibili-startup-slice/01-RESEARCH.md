# Phase 1: Verified Bilibili Startup Slice - Research

**Researched:** 2026-08-30  
**Domain:** Android WebView local shell, typed provider RPC, Bilibili public-media bootstrap, and API-35 emulator verification  
**Confidence:** MEDIUM

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

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

### Deferred Ideas (OUT OF SCOPE)
- Media3 sole playback owner, background service, notification/lock-screen/audio-focus/queue recovery — Phase 2.
- Full synchronized/manual/translated/accessible lyrics contract — Phase 3.
- Bilibili QR login, persistent cookie/session refresh, logout cleanup — Phase 5.
- Cache/download/offline ownership — Phase 8.
- MV, effects, loudness, and DeepSeek — Phase 9.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|---|---|---|
| NET-001 | Typed versioned RPC only from trusted appassets main frame and precise HTTPS provider allow-list. | V2 operation policy, origin/frame validation, and transport-bound tests. |
| NET-002 | Cancellable bounded calls with a single terminal result. | Request registry, transport cancellation, deadline and stale-epoch tests. |
| NET-003 | Authorized Bilibili search-to-playback-to-primary-lyric path with schema/CID/MIME/permission validation. | Bilibili v2 operation handlers plus Howler proof and device smoke. |
| SRCH-001 | Submit/cancel/resubmit source-labelled searches without stale overwrite. | Search epoch owner in controller and adapter settlement rules. |
| SRCH-002 | Directory/detail/part/playback path with cursor and no duplicated append. | Video-detail/pages typed operation and explicit selected-CID contract. |
| SRCH-003 | Complete labelled result state and actionable malformed/offline/permission failures. | Safe provider error mapper and mobile state assertions. |
| SEC-001 | Fixed appassets HTTPS origin/main-frame/current-epoch bridge and safe navigation. | WebMessage listener plus independent policy validation. |
| SEC-002 | Secure WebView and HTTPS-only provider network; external navigation carries no secrets. | Existing secure settings retained and release-like regression checks. |
| SEC-003 | Strict operation/payload/schema/size/sink validation for hostile provider data. | Typed DTO parsing, bounded fields and DOM-safe rendering tests. |
</phase_requirements>

## Summary

The current host is a sound security starting point, but not the contract required by this phase. It installs AndroidX's origin-aware `WebMessageListener` before loading the HTTPS `appassets` page, checks the main-frame source again, uses a bounded one-worker executor, disables redirects, and caps response bodies. Its request payload is nevertheless a version-1 generic `GET` plus caller-supplied URL, and the Bilibili allow-list is host-wide. [VERIFIED: `android/app/src/main/java/com/dazzlingwuming/listen2/AndroidHttpBridge.java:68-129`, `:137-167`; `android/app/src/main/java/com/dazzlingwuming/listen2/HttpBridgePolicy.java:16-92`]

Phase 1 should evolve that single bridge in place: retain v1 only for current search compatibility, add a v2 typed Bilibili operation dispatcher, and migrate all Android Bilibili search, detail/pages, and public-manifest calls to it. The native tier constructs each URL and each fixed header, validates response DTOs before emitting the minimum safe UI/player fields, and tracks cancellation by request ID. The browser tier owns `pageEpoch`, only settles current pending work once, and applies state mutations only after identity is checked. This preserves the Electron path and uses the existing Howler player strictly as a foreground audible proof; it does not introduce Media3 before Phase 2. [VERIFIED: `app/listen1_chrome_extension/js/lowebutil.js:143-389`; `app/listen1_chrome_extension/js/provider/bilibili.js:2372-2422`; `app/listen1_chrome_extension/js/player_thread.js:1604-1654`]

**Primary recommendation:** Implement v2 as a small, pure-Java operation/payload/response policy plus a cancellable Android transport, then make the existing Angular provider/controller use epoch-scoped calls and prove the complete public-item flow on a live API-35 emulator.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|---|---|---|---|
| Local first-paint home and mobile navigation | Browser/client | Android host | The packaged Angular UI owns visible state; `MainActivity` owns only WebView lifetime and local asset loading. [VERIFIED: `android/app/src/main/java/com/dazzlingwuming/listen2/MainActivity.java:39-67`; `app/listen1_chrome_extension/js/controller/playlist.js:8-33`] |
| Typed Bilibili operation validation and URL/header construction | Android native bridge | Browser/client | Native is the enforcement point; browser only sends typed, bounded intent. [CITED: Android native bridge guidance](https://developer.android.com/develop/ui/views/layout/webapps/native-api-access-jsbridge?hl=en) |
| Request epoch, cancellation intent, and visible terminal state | Browser/client | Android native bridge | Navigation/search owns which result is current; native cancels/interrupts work without deciding UI. [VERIFIED: `app/listen1_chrome_extension/js/controller/instant_search.js:49-137`; `android/app/src/main/java/com/dazzlingwuming/listen2/AndroidHttpBridge.java:119-133`] |
| Bilibili response schema, selected part, and safe manifest descriptor | Android native bridge | Browser/player | Native can reject malformed/unentitled data before it crosses the trust boundary; player consumes a reduced descriptor. [VERIFIED: `app/listen1_chrome_extension/js/provider/bilibili.js:2127-2242`, `:2372-2418`] |
| Audible progress/pause proof | Browser/player | Android emulator | The current Phase-1 player is Howler; device audio/progress is the required observable evidence. [VERIFIED: `.planning/phases/01-verified-bilibili-startup-slice/01-CONTEXT.md:30-34`] |
| Primary lyric entry and honest unavailable/error state | Browser/controller | Android native bridge | The existing play surface owns lyric state; Bilibili operations must not delay audio or return raw provider failures. [VERIFIED: `app/listen1_chrome_extension/js/controller/play.js:2740-2785`; `.planning/phases/01-verified-bilibili-startup-slice/01-CONTEXT.md:35-36`] |

## Standard Stack

### Core

| Library / component | Version | Purpose | Why standard for this phase |
|---|---|---|---|
| AndroidX WebKit | `1.12.1` | `WebViewAssetLoader` and origin-aware WebMessage bridge | Already packaged and explicitly declares `implementation 'androidx.webkit:webkit:1.12.1'`; Android recommends `addWebMessageListener` for native/JS communication. [VERIFIED: `android/app/build.gradle:88-90` — `implementation 'androidx.webkit:webkit:1.12.1'`; CITED: Android native bridge guidance](https://developer.android.com/develop/ui/views/layout/webapps/native-api-access-jsbridge?hl=en) |
| Existing Java 17 Android app | Java 17 / SDK 35 | Pure policy helpers and WebView host | The project pins Java source/target 17 and SDK 35; no framework migration is authorized. [VERIFIED: `android/app/build.gradle:40-69` — `compileSdk 35`, `minSdk 26`, `targetSdk 35`, `sourceCompatibility JavaVersion.VERSION_17`, `targetCompatibility JavaVersion.VERSION_17`] |
| Existing AngularJS/classic-script frontend | vendored | Mobile states, provider compatibility, current Howler proof | Script order deliberately loads `lowebutil`, providers, player, and controllers as globals; adding a bundler would enlarge the phase unnecessarily. [VERIFIED: `app/listen1_chrome_extension/listen1.html:31-81`] |
| Existing `HttpsURLConnection` transport | platform API | HTTPS-only, fixed headers, bounded body and no redirects | It already embodies the right native transport boundary and does not add a dependency. [VERIFIED: `android/app/src/main/java/com/dazzlingwuming/listen2/AndroidHttpBridge.java:257-330`] |

### Supporting

| Component | Purpose | When to use |
|---|---|---|
| JUnit 4.13.2 | Pure Java policy/DTO/cancellation tests | Extend the existing `HttpBridgePolicyTest` before wiring WebView code. [VERIFIED: `android/app/build.gradle:88-90` — `testImplementation 'junit:junit:4.13.2'`] |
| Node built-in `assert`/`vm` contract harness | Browser adapter/provider race tests | Extend `android_http_bilibili_search.test.js`; it already executes the classic globals without a browser. [VERIFIED: `app/listen1_chrome_extension/test/android_http_bilibili_search.test.js:1-56`] |
| API-35 Android emulator and `adb` | Required live smoke evidence | Use after deterministic tests and APK assembly; a device was not attached during this research. [VERIFIED: local probe 2026-08-30 — Android Debug Bridge 1.0.41 installed; `adb devices -l` returned no attached devices] |

### Alternatives Considered

| Instead of | Could use | Disposition |
|---|---|---|
| Existing `addWebMessageListener` bridge | `addJavascriptInterface` | Do not use. Existing code deliberately avoids it, and Android recommends the WebMessage approach for modern bridge communication. [VERIFIED: `android/app/src/main/java/com/dazzlingwuming/listen2/AndroidHttpBridge.java:30-34`; CITED: Android native bridge guidance](https://developer.android.com/develop/ui/views/layout/webapps/native-api-access-jsbridge?hl=en) |
| Existing foreground Howler proof | A native Media3 player in Phase 1 | Do not use. It would create the dual-player ownership explicitly deferred to Phase 2. [VERIFIED: `.planning/phases/01-verified-bilibili-startup-slice/01-CONTEXT.md:30-34`] |
| Typed native operations | Generic arbitrary URL proxy | Do not use. It contradicts D-01 and leaves the host-wide Bilibili rule unbounded. [VERIFIED: `.planning/phases/01-verified-bilibili-startup-slice/01-CONTEXT.md:12-15`; `android/app/src/main/java/com/dazzlingwuming/listen2/HttpBridgePolicy.java:53-57`] |

**Installation:** None. Phase 1 must not install a package or migrate framework/runtime.

## Project Constraints (from AGENTS.md)

- Preserve user changes and edit only source/planning artifacts that the assigned plan owns; never edit generated Android output. Extend `syncListen1Assets` rather than generated assets. [VERIFIED: `AGENTS.md` project conventions, `android/app/build.gradle:8-38`]
- Keep the shared UI browser-safe and preserve classic-script ordering; provider APIs may remain callback-compatible while new bridge work uses explicit Promise settlement. [VERIFIED: `AGENTS.md` project conventions; `app/listen1_chrome_extension/listen1.html:45-81`]
- Keep Android validation in pure Java helpers where possible; Java code uses explicit visibility/four-space style, and browser globals need narrow declarations/suppressions only. [VERIFIED: `AGENTS.md` project conventions]
- Use guard clauses and stable safe error shapes. Do not expose raw exceptions, cookies, signed media URLs, headers, tokens, local files, or arbitrary provider data in UI/logs/evidence. [VERIFIED: `AGENTS.md` error/logging conventions; `.planning/phases/01-verified-bilibili-startup-slice/01-CONTEXT.md:43-51`]
- Before any future commit/push, run the project’s full local CI gate via the `run-local-ci` skill; emulator end-to-end evidence remains mandatory and is not replaced by build/JVM tests. [VERIFIED: `AGENTS.md` CI rules; `.planning/phases/01-verified-bilibili-startup-slice/01-CONTEXT.md:49-51`]
- Do not merge, deploy, publish signing material, or claim feature parity from a degraded/not-verified state. [VERIFIED: `AGENTS.md`; `.planning/REQUIREMENTS.md:9-12`]

## Architecture Patterns

### System Architecture Diagram

```text
User search / select part / retry
            |
            v
Angular controller owns pageEpoch + visible terminal state
            |
            | v2 {operation, typed payload, requestId, pageEpoch}
            v
Browser adapter pending registry ---- cancel ----> native request registry
            |                                      |
            | <---- one matched terminal reply ----+-- pure policy validates operation,
            |                                         parameters, body/schema and limits
            v                                      |
current epoch only mutates UI                       v
Howler receives safe audio descriptor         HTTPS Bilibili fixed route/header
            |                                      |
            v                                      v
advance position + lyric entry               bounded response / structured safe error
```

### Recommended Project Structure

```text
android/app/src/main/java/com/dazzlingwuming/listen2/
├── HttpBridgePolicy.java          # retain pure URL/origin limits; add v2 operation/DTO validation
├── AndroidHttpBridge.java         # request registry, timeout/cancel and fixed-route transport
└── MainActivity.java              # one install/destroy point for the bridge
android/app/src/test/java/com/dazzlingwuming/listen2/
└── HttpBridgePolicyTest.java      # v2 policy, schema and terminal-state fixtures
app/listen1_chrome_extension/js/
├── lowebutil.js                   # v1 compatibility and v2 pending/epoch/cancel adapter
├── provider/bilibili.js           # Android-only v2 search/detail/manifest route selection
└── controller/{instant_search,playlist,play}.js # epoch finalization and truthful UI states
app/listen1_chrome_extension/test/
└── android_http_bilibili_search.test.js # deterministic adapter/provider race fixtures
```

### Pattern 1: Versioned operation dispatcher

**What:** Parse one bounded envelope into a closed v2 operation, then construct the Bilibili URL and fixed headers natively. Do not allow the page to provide a URL, headers, cookies, or method for v2. Keep the current v1 parser only behind an explicit compatibility branch for shipped search calls.

**When to use:** All Android Bilibili Phase-1 search, detail/pages, and manifest work.

**Implementation direction:** [ASSUMED] Define an internal Java request DTO with `version`, `operation`, `requestId`, `pageEpoch`, and a small operation-specific payload. The policy must allow only three Phase-1 operation families (search, video detail/pages, public audio manifest) plus cancellation; it must reject unknown fields and invalid types/lengths before queueing. The native result must contain only sanitized result rows/pages or a minimized descriptor (`bvid`, selected `cid`, duration, MIME/codec, expiry metadata, bounded ordered CDN candidates), never headers/cookies/raw JSON. This naming is intentionally planner discretion, not an existing contract.

### Pattern 2: One request lifecycle, one terminal settlement

**What:** Store each native job by request ID with an atomic terminal flag and transport handle. `cancel` first removes a queued job; if running, disconnects its current connection; all code paths then attempt one common `settleOnce` function. Browser timeout calls cancel and rejects as timeout; browser navigation/controller teardown calls cancel and resolves visible cancellation. Late v1/v2 replies and mismatched `pageEpoch` are discarded without digest or UI mutation.

**When to use:** Search typing, pagination, result selection, detail load, manifest resolve, lyric entry request, and WebView destruction.

**Why this fits:** The current adapter already uses one pending map and deletes the record before settling; the player already validates a current media URL request before changing state. Preserve those two identities and extend them with page epoch/cancel instead of inventing a second race model. [VERIFIED: `app/listen1_chrome_extension/js/lowebutil.js:152-278`, `:339-379`; `app/listen1_chrome_extension/js/player_thread.js:1604-1634`]

### Pattern 3: Explicit part identity

**What:** Treat the video BVID and selected CID as separate typed data. Detail resolves and displays pages; only a deliberately unqualified BVID can choose API page one. Any selected part whose CID is absent from returned pages fails as `invalid-part`, and manifest work receives the selected CID rather than re-falling back.

**When to use:** A user opens a Bilibili video result, changes part, retries manifest resolution, or returns to detail.

**Why this is necessary:** The legacy implementation currently falls back to `pages[0]` even when `idParts.cid` was supplied, which violates D-06. [VERIFIED: `app/listen1_chrome_extension/js/provider/bilibili.js:2286-2315`]

### Pattern 4: Local-first home and terminal UI reducer

**What:** Paint local shell/navigation immediately. Every remote home/search/detail operation must publish a current epoch state in `loading`, then exactly one terminal `content`, `empty`, `error`, or `cancelled` state; preserve already successful rows during a later failure and make retry source-specific. Treat startup account checks as unavailable unless user invoked a Phase-1 supported action.

**When to use:** Home catalog, search, detail, audio bootstrap, and lyric entry.

**Why this is necessary:** `PlayListController` sets `loading` true and clears it only in the success callback; `InstantSearchController` does the same. Those paths can strand the current UI in loading on rejected/late requests. [VERIFIED: `app/listen1_chrome_extension/js/controller/playlist.js:35-76`; `app/listen1_chrome_extension/js/controller/instant_search.js:49-65`]

## Don't Hand-Roll

| Problem | Don't build | Use instead | Why |
|---|---|---|---|
| Native JS bridge | `addJavascriptInterface` or a second global bridge | Existing `WebViewCompat.addWebMessageListener` installation | Origin rule, source origin, main-frame and reply-proxy semantics are already supported. [CITED: WebViewCompat reference](https://developer.android.com/reference/androidx/webkit/WebViewCompat) |
| Local asset origin | `file://`, `data:`, or manually copied generated assets | Existing `WebViewAssetLoader` plus Gradle allow-list | Android recommends appassets HTTPS loading and explicitly disabling file/universal-file access. [CITED: Android local-content guidance](https://developer.android.com/develop/ui/views/layout/webapps/load-local-content) |
| Audio player | A premature Media3/Howler dual owner | Existing Howler-only foreground proof | Phase 2 owns the sole native playback migration. [VERIFIED: `.planning/phases/01-verified-bilibili-startup-slice/01-CONTEXT.md:30-34`] |
| Provider error copy | Raw `IOException`, JSON, URL, or Bilibili message rendering | Existing safe `create_media_failure` mapping extended with stable bridge codes | Legacy Axios errors can contain request URLs; the existing mapper fixes the user message. [VERIFIED: `app/listen1_chrome_extension/js/provider/bilibili.js:2140-2225`] |

## Common Pitfalls

### Pitfall 1: v2 still accepts a generic URL

**What goes wrong:** Merely adding `operation` alongside `url` retains arbitrary proxy capability and lets provider/UI code choose routes or header context.

**Avoidance:** v2 parser rejects `url`, `method`, `headers`, `cookie`, and body fields; native operation dispatch is the only place that creates a request. Keep the old parser isolated to v1 compatibility. [VERIFIED: `.planning/phases/01-verified-bilibili-startup-slice/01-CONTEXT.md:12-15`]

### Pitfall 2: Timeout leaves native work alive or double-settles

**What goes wrong:** The current browser timeout deletes its pending entry but sends no native cancellation, while late native replies are merely ignored. A v2 phase must release queue/connection work and still return one terminal condition to the current UI.

**Avoidance:** Couple browser timeout/navigation teardown to cancellation; native stores state/connection and uses one terminal guard. Add fixtures for queued cancel, running cancel, timeout, destroy, and late reply. [VERIFIED: `app/listen1_chrome_extension/js/lowebutil.js:356-379`; `android/app/src/main/java/com/dazzlingwuming/listen2/AndroidHttpBridge.java:119-133`, `:332-340`]

### Pitfall 3: selected CID silently becomes first page

**What goes wrong:** A stale or malformed selected part can start the first page, so user intent and lyric identity diverge.

**Avoidance:** v2 detail/manifest policy distinguishes absent CID from selected CID; test explicit missing CID separately. [VERIFIED: `app/listen1_chrome_extension/js/provider/bilibili.js:2292-2309`; `.planning/phases/01-verified-bilibili-startup-slice/01-CONTEXT.md:24-26`]

### Pitfall 4: loading state only has a success callback

**What goes wrong:** Offline/TLS/provider failures leave home or search indefinitely in `Gathering`/spinner even though the local shell is usable.

**Avoidance:** Route every adapter terminal shape through a controller reducer that finalizes `loading`; retain successful rows and expose exactly one retry control. [VERIFIED: `app/listen1_chrome_extension/js/controller/playlist.js:41-66`; `app/listen1_chrome_extension/js/controller/instant_search.js:49-65`]

### Pitfall 5: device proof checks URL creation, not audio

**What goes wrong:** A manifest success or Howl construction can pass while codec/CDN/autoplay behavior prevents audible media.

**Avoidance:** The smoke must record start gesture, pause/resume, and position that becomes greater than zero; only then record lyric entry. [VERIFIED: `.planning/phases/01-verified-bilibili-startup-slice/01-CONTEXT.md:32-34`, `:49-51`]

## Code Examples

### Existing safe bridge installation pattern

```java
// Source: AndroidHttpBridge.java:68-79 (existing implementation)
if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
    return null;
}
WebViewCompat.addWebMessageListener(
        webView,
        HttpBridgePolicy.JAVASCRIPT_OBJECT_NAME,
        HttpBridgePolicy.ALLOWED_ORIGIN_RULES,
        bridge.new Listener());
```

The exact current source values are: `static final int PROTOCOL_VERSION = 1;`, `static final String JAVASCRIPT_OBJECT_NAME = "Listen2AndroidHttp";`, and `static final String TRUSTED_ORIGIN_RULE = "https://appassets.androidplatform.net";`. [VERIFIED: `android/app/src/main/java/com/dazzlingwuming/listen2/HttpBridgePolicy.java:16-21`]

### Existing bounded response read pattern

```java
// Source: AndroidHttpBridge.java:314-329 (existing implementation)
while ((read = closeableInput.read(buffer)) != -1) {
    if (read > maximumBytes - total) {
        throw new ResponseTooLargeException();
    }
    output.write(buffer, 0, read);
    total += read;
}
```

Retain this bounded-read behavior for each v2 operation and validate parsed DTO field limits after reading. [VERIFIED: `android/app/src/main/java/com/dazzlingwuming/listen2/AndroidHttpBridge.java:314-329`]

## State of the Art

| Old/current approach | Phase-1 target | Impact |
|---|---|---|
| v1 `{version, requestId, method, url}` raw GET envelope | Versioned typed v2 operation envelope with page epoch and cancellation | Native, rather than page code, owns route/header construction and terminal transport lifecycle. [VERIFIED: `app/listen1_chrome_extension/test/android_http_bilibili_search.test.js:130-146`; `.planning/phases/01-verified-bilibili-startup-slice/01-CONTEXT.md:12-18`] |
| Host-wide Bilibili GET policy | Exact operation-to-path/query policy | Prevents arbitrary Bilibili path proxying and makes fixtures stable. [VERIFIED: `android/app/src/main/java/com/dazzlingwuming/listen2/HttpBridgePolicy.java:53-57`] |
| Foreground WebView/Howler behavior as app capability | Foreground WebView/Howler only as a Phase-1 audible proof | Avoids a second player before the Media3 ownership phase. [VERIFIED: `.planning/phases/01-verified-bilibili-startup-slice/01-CONTEXT.md:30-34`] |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|---|---|---|
| A1 | The exact v2 operation identifiers and DTO class names can be selected by the planner without changing user-visible behavior. | Architecture Pattern 1 | Low; CONTEXT explicitly grants this discretion, but test names/schemas must be frozen before provider migration. |
| A2 | A public anonymous Bilibili item and current emulator WebView can complete the live smoke at execution time. | Validation / environment | High; provider/CDN/codec availability is external and must be recorded as blocked rather than fabricated. |

## Open Questions

1. **Which API-35 AVD image and WebView provider version will be used for the timestamped smoke?**
   - What we know: `adb` and the Android emulator executable are installed, but no device was attached during this research. [VERIFIED: local probe 2026-08-30]
   - Recommendation: The execution plan must create/start one supported API-35 AVD, record its image/ABI and WebView version, and retain a redacted evidence record.
2. **Which currently public Bilibili item remains usable during final smoke?**
   - What we know: Phase decisions require a public anonymous item; provider availability/codec/CDN is external.
   - Recommendation: Use a previously validated non-sensitive test item at execution time, omit signed URLs from artifacts, and mark the phase externally blocked if it becomes unavailable after fixture tests pass.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|---|---|---:|---|---|
| JDK | Gradle/JVM test/build | ✓ | OpenJDK 17.0.20.1 at configured Homebrew path | — |
| Android platform tools | APK install/log/evidence | ✓ | ADB 1.0.41 | — |
| Android emulator executable | API-35 smoke | ✓ | executable present | Start/create supported API-35 AVD before smoke |
| Attached emulator/device | Live smoke now | ✗ | no attached devices | Not a completion fallback; execution must start an API-35 AVD |
| Node/npm | browser contract tests | ✓ | Node 24.15.0 / npm 11.12.1 | — |

## Validation Architecture

### Test Framework

| Property | Value |
|---|---|
| Java/JVM framework | JUnit 4.13.2 [VERIFIED: `android/app/build.gradle:88-90`] |
| Browser contract framework | Node `assert` + `vm` script harness [VERIFIED: `app/listen1_chrome_extension/test/android_http_bilibili_search.test.js:1-56`] |
| Existing browser command | `npm --prefix app/listen1_chrome_extension test` [VERIFIED: `app/listen1_chrome_extension/package.json:7`] |
| Existing Android build/JVM command | `gradle --no-daemon :app:testDebugUnitTest :app:assembleDebug` [VERIFIED: `android/README.md:44`; `.github/workflows/android-apk.yml:45-52`] |

### Phase Requirements → Test Map

| Req ID | Behavior | Test type | Automated command | File exists? |
|---|---|---|---|---|
| NET-001 / SEC-001 / SEC-002 | v2 trusted origin/frame/version/operation/path/query rejection | JUnit | `:app:testDebugUnitTest` | Extend `HttpBridgePolicyTest.java` |
| NET-002 | queued/running cancel, timeout, destroy, stale page epoch and exactly-once terminal result | JS contract + JUnit + instrumentation smoke | extension test; `:app:testDebugUnitTest`; live AVD | ❌ Wave 0 fixtures |
| NET-003 / SRCH-002 | search → detail/pages → selected CID → validated manifest/descriptor | JS contract + live AVD | extension test; manual/scripting evidence | Detail/manifest fixture ❌ |
| SRCH-001 / SRCH-003 | rapid revision/cancel plus labelled results/terminal errors | controller contract + live AVD | extension test; live AVD | Controller fixture ❌ |
| SEC-003 | malformed/oversized JSON, unknown field, bad CID, unsafe candidate/MIME/HTML metadata | JUnit + JS contract | `:app:testDebugUnitTest`; extension test | Extend existing test files |

### Sampling Rate

- **Per task commit:** affected JS/JVM test command plus Android debug assembly as applicable.
- **Per wave merge:** full project local CI gate defined by the repository and invoked through `run-local-ci`.
- **Phase gate:** all deterministic tests plus timestamped API-35 emulator smoke; fixture/build-only evidence is insufficient. [VERIFIED: `.planning/phases/01-verified-bilibili-startup-slice/01-CONTEXT.md:49-51`]

### Wave 0 Gaps

- [ ] V2 contract fixture in `app/listen1_chrome_extension/test/android_http_bilibili_search.test.js`: typed envelope, cancellation, stale epoch, exact-once reply, and safe error mapping.
- [ ] Pure Java v2 validation tests in `android/app/src/test/java/com/dazzlingwuming/listen2/HttpBridgePolicyTest.java`: operation payloads, exact path/query creation, schema/field limits, selected-CID rejection, redirect/oversize/timeout mapping.
- [ ] Android instrumentation or reproducible ADB smoke script that proves WebMessage handshake, page destroy, app-safe external navigation, audio position advance, pause/resume, and lyric entry on API 35.
- [ ] Redacted evidence template containing date, APK SHA-256, git SHA, API/image/ABI/WebView version, network, commands/timings, steps, screenshots/log excerpts, uncovered behavior, and recovery path.

## Security Domain

### Applicable ASVS Categories

| ASVS category | Applies | Standard control |
|---|---|---|
| V2 Authentication | Limited / Phase 5 deferred | Anonymous-only Phase-1 data path; no persistent session or login probe. [VERIFIED: `.planning/phases/01-verified-bilibili-startup-slice/01-CONTEXT.md:20-23`, `:41-42`] |
| V3 Session Management | Limited / Phase 5 deferred | In-memory bounded anonymous `buvid3` only; no page-accessible cookie/header controls. [VERIFIED: `android/app/src/main/java/com/dazzlingwuming/listen2/AndroidHttpBridge.java:41-45`, `:170-201`] |
| V4 Access Control | Yes | Exact appassets origin, main-frame and typed operation allow-list; deny unknown providers/routes. [VERIFIED: `android/app/src/main/java/com/dazzlingwuming/listen2/AndroidHttpBridge.java:97-117`; CITED: WebMessageListener reference](https://developer.android.com/reference/androidx/webkit/WebViewCompat.WebMessageListener) |
| V5 Input Validation | Yes | Size/type/enum/string-bound policy before queueing and response DTO validation before browser delivery. [VERIFIED: `android/app/src/main/java/com/dazzlingwuming/listen2/AndroidHttpBridge.java:137-167`; `android/app/src/main/java/com/dazzlingwuming/listen2/HttpBridgePolicy.java:29-92`] |
| V6 Cryptography | No new crypto in Phase 1 | HTTPS platform transport; do not add signing, entitlement bypass, cookie persistence, or secret store. [VERIFIED: `.planning/phases/01-verified-bilibili-startup-slice/01-CONTEXT.md:20-23`] |

### Known Threat Patterns

| Pattern | STRIDE | Standard mitigation |
|---|---|---|
| Cross-origin/iframe/old-page bridge message | Spoofing / elevation | Require allowed appassets origin *and* source origin/main frame; bind response to request ID/page epoch and discard stale state. [CITED: WebMessageListener reference](https://developer.android.com/reference/androidx/webkit/WebViewCompat.WebMessageListener) |
| Generic URL/header/cookie relay | Elevation / information disclosure | V2 native dispatcher constructs routes and fixed headers; page cannot name URL/header/cookie/proxy. [VERIFIED: `.planning/phases/01-verified-bilibili-startup-slice/01-CONTEXT.md:12-18`] |
| Redirect, cleartext, unsafe navigation, local file read | Tampering / disclosure | Keep HTTPS, redirect rejection, `usesCleartextTraffic="false"`, no file/content access and packaged asset policy. [VERIFIED: `android/app/src/main/AndroidManifest.xml:4-16`; `android/app/src/main/java/com/dazzlingwuming/listen2/MainActivity.java:81-107`, `:147-192`; CITED: Android WebView local-content guidance](https://developer.android.com/develop/ui/views/layout/webapps/load-local-content) |
| Oversized/malformed provider JSON or hostile title/artwork/lyric data | Denial of service / script injection | Bounded read/body/schema/field limits, no raw HTML insertion, and use text-safe rendering/encoded image URLs only. [VERIFIED: `android/app/src/main/java/com/dazzlingwuming/listen2/AndroidHttpBridge.java:272-330`; `.planning/REQUIREMENTS.md:113-115`] |
| Signed URL/cookie/raw exception leaks | Information disclosure | Return bounded descriptor/status only; sanitize UI/evidence/logs. [VERIFIED: `app/listen1_chrome_extension/js/provider/bilibili.js:2221-2225`; `.planning/phases/01-verified-bilibili-startup-slice/01-CONTEXT.md:43-51`] |

## Sources

### Primary / repository evidence

- `01-CONTEXT.md` — locked scope, security, cancellation, selected-CID, player and emulator decisions.
- `android/app/src/main/java/com/dazzlingwuming/listen2/{MainActivity,AndroidHttpBridge,HttpBridgePolicy,NavigationPolicy}.java` — current host, origin, request, transport and lifecycle seams.
- `app/listen1_chrome_extension/js/{lowebutil.js,provider/bilibili.js,player_thread.js,controller/instant_search.js,controller/playlist.js}` — current browser/provider/player seams and gaps.
- `android/app/build.gradle`, extension test suite and Android workflow — supported tooling and test entry points.

### Official Android documentation (MEDIUM confidence from checked web source)

- [Native API JavaScript bridge](https://developer.android.com/develop/ui/views/layout/webapps/native-api-access-jsbridge?hl=en) — `addWebMessageListener` recommended and installed before page load.
- [WebViewCompat reference](https://developer.android.com/reference/androidx/webkit/WebViewCompat) — origin-rule semantics and reply proxy lifecycle.
- [WebMessageListener reference](https://developer.android.com/reference/androidx/webkit/WebViewCompat.WebMessageListener) — `sourceOrigin` and `isMainFrame` parameters.
- [Load in-app content](https://developer.android.com/develop/ui/views/layout/webapps/load-local-content) — appassets HTTPS, asset loader, explicit file-access/mixed-content guidance.
- [Unsafe file inclusion in WebViews](https://developer.android.com/privacy-and-security/risks/webview-unsafe-file-inclusion?hl=en) — file/universal-file access and cleartext risk controls.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH for repository-pinned components; MEDIUM for Android official guidance because it was verified through web search.
- Architecture: HIGH for current seams and locked phase boundary; MEDIUM for the new v2 DTO naming details, which are intentionally planner discretion.
- Pitfalls: HIGH for observed source gaps; MEDIUM for external live-provider volatility.

**Research date:** 2026-08-30  
**Valid until:** 2026-09-06 for live-provider/device observations; repository structure must be rechecked after relevant code changes.
