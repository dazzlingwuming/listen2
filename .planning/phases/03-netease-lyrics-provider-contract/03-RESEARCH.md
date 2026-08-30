# Phase 3: NetEase Lyrics & Provider Contract - Research

**Researched:** 2026-08-31  
**Domain:** Android native provider RPC, NetEase route contracts, and Media3-clock-synchronized accessible lyrics  
**Confidence:** MEDIUM — the Android boundaries and current implementation are source-verified; the external NetEase rendition/lyric routes lack an authoritative provider contract or live authorization evidence in this workspace.

<phase_requirements>
## Phase Requirements

| ID | Description | Research support |
|---|---|---|
| NET-004 | NetEase search → detail/playlist track → rendition → playback → primary lyric, while the other five providers stay unavailable without evidence. | Close each NetEase capability behind a named v2 operation, native route policy and fixture; render every other provider row as unavailable until its own evidence bundle exists. [VERIFIED: .planning/REQUIREMENTS.md:39,135-143] |
| LYR-001 | Bilibili and NetEase lyrics follow provider/track/duration and the active Media3 clock. | Add a native-issued lyric identity to the sanitized playback snapshot and derive active line only from service-clock projection. [VERIFIED: .planning/REQUIREMENTS.md:58] |
| LYR-002 | Manual source selection persists by track/provider/revision and degradation never delays audio. | Replace Bilibili-only WebView localStorage behavior with a provider-neutral native lyric repository and versioned bridge operations. [VERIFIED: .planning/REQUIREMENTS.md:59; app/listen1_chrome_extension/js/controller/play.js:1621-1647,3266-3437] |
| LYR-003 | TalkBack receives lyric state; races/error callbacks cannot replace current state. | Make lyric requests cancellable, epoch and lyric-generation bound, and expose a concise polite accessible status rather than announcing every timing tick. [VERIFIED: .planning/REQUIREMENTS.md:60; app/listen1_chrome_extension/js/lowebutil.js:585-765] |
</phase_requirements>

## Project Constraints (from AGENTS.md)

- Reuse the shared classic-script frontend and provider/player contracts; Android native behavior stays in pure-Java-testable helpers under `android/app/src/main/java/com/dazzlingwuming/listen2`. [VERIFIED: AGENTS.md]
- Keep a narrow, versioned, allow-listed native bridge. It must not expose arbitrary URLs, caller headers/cookies, or a general JavaScript interface. [VERIFIED: AGENTS.md]
- Media3 service owns audio, background behavior and lifecycle; the WebView is a renderer/controller only. [VERIFIED: AGENTS.md; .planning/phases/02-native-media3-playback-background-control/02-CONTEXT.md]
- Preserve entitlement, membership, DRM, region and account constraints; do not place secrets, cookies, signed URLs, provider bodies, local data or personal paths in source, logs, evidence, snapshots, backups or planning artifacts. [VERIFIED: AGENTS.md]
- Use HTTPS with exact route/query allow-lists, bounded body/deadline/cancellation/retry, and explicit provider errors. Emulator E2E is a required gate; JVM tests or APK builds alone are insufficient. [VERIFIED: AGENTS.md]
- Do not hand-edit generated Android assets; edit `syncListen1Assets` allow-list only. [VERIFIED: android/app/build.gradle:10-40]

## Summary

Phase 3 must add NetEase as a first-class, closed provider contract, not expand the legacy URL bridge. The current v2 contract has only Bilibili provider operations; the only NetEase Android allowance is the v1 search GET route. Verbatim current operation list: `BILIBILI_SEARCH("bilibili.search"), BILIBILI_VIDEO_DETAIL("bilibili.video.detail"), BILIBILI_AUDIO_MANIFEST("bilibili.audio.manifest"), PLAYBACK_COMMAND("playback.command"), RPC_CANCEL("rpc.cancel")`. [VERIFIED: android/app/src/main/java/com/dazzlingwuming/listen2/AndroidRpcContract.java:32-53] The current NetEase policy is likewise search-only: `NETEASE_MUSIC_HOST = "music.163.com"` and `NETEASE_SEARCH_PATH = "/api/search/get/web"`. [VERIFIED: android/app/src/main/java/com/dazzlingwuming/listen2/HttpBridgePolicy.java:30-37]

Lyrics cannot be synchronized from the legacy page player after Phase 2: native Android intentionally disables its Howler refresh loop, while the service already projects `positionMs` and `durationMs` from ExoPlayer. [VERIFIED: app/listen1_chrome_extension/js/player_thread.js:67-77; android/app/src/main/java/com/dazzlingwuming/listen2/PlaybackService.java:247-264] Android's official Media3 guidance independently says `Player.Listener` has no normal-progress callback and that UI should query current position at appropriate intervals; use player events for transitions and discontinuities. [CITED: https://developer.android.com/media/media3/session/player] The implementation should therefore have the service publish a monotonic, sanitized lyric-clock projection at a bounded UI cadence only while its current Media3 item is meaningful, with immediate publications on selection, seek, transition, pause/play, error and restoration.

**Primary recommendation:** Plan one provider-neutral native `lyric.*` contract and a NetEase-specific `netease.*` provider contract on the existing v2 RPC; let the Media3 service be the only time and active-track authority, and gate all unproven provider capabilities off in the matrix.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|---|---|---|---|
| NetEase typed route construction, transport, status/schema projection and cancellation | API / Backend (native bridge) | Browser / Client | Native already owns trusted origin, policy and bounded transport; page requests named capability only. [VERIFIED: android/app/src/main/java/com/dazzlingwuming/listen2/AndroidHttpBridge.java:195-260] |
| Rendition resolution and entitlement-aware selection | API / Backend (native playback/provider) | Database / Storage | Page must never receive signed candidates or headers; durable semantic identity may survive, transport must not. [VERIFIED: .planning/phases/02-native-media3-playback-background-control/02-CONTEXT.md; android/app/src/main/java/com/dazzlingwuming/listen2/PlaybackSnapshot.java:8-13] |
| Active lyric clock and track transition | API / Backend (PlaybackService) | Browser / Client | Service-owned ExoPlayer is the only audio clock; the page renders a sanitized snapshot. [VERIFIED: android/app/src/main/java/com/dazzlingwuming/listen2/PlaybackService.java:136-150,247-264] |
| LRC parsing, active-line lookup, scroll and visible bilingual rendering | Browser / Client | API / Backend | Shared Angular UI owns presentation; native returns bounded lyric content/metadata and the page applies only the current snapshot. [VERIFIED: app/listen1_chrome_extension/js/controller/play.js:2313-2408,2550-2587] |
| Manual lyric selection/revision and offset persistence | Database / Storage | Browser / Client | Persist by source/track/revision natively; page sends an allow-listed selection/offset intent and renders its result. Existing Room schema already includes lyric metadata, whereas current UI persistence is Bilibili-only localStorage. [VERIFIED: android/app/src/main/java/com/dazzlingwuming/listen2/data/Listen2Database.java:6-21; app/listen1_chrome_extension/js/controller/play.js:1621-1647] |
| Accessible lyric status and controls | Browser / Client | API / Backend | The page can expose the active line, state and offset; it must not synthesize time or trust stale data. [VERIFIED: app/listen1_chrome_extension/listen1.html:2970-2980; .planning/REQUIREMENTS.md:60] |

## Standard Stack

### Core

| Component | Version | Purpose | Why standard here |
|---|---:|---|---|
| Existing AndroidX Media3 ExoPlayer + session | `1.9.4` | Sole playback owner and authoritative current position. | Already pinned for API 35 in this app; do not introduce a second player. Verbatim Gradle declarations: `def media3Version = '1.9.4'`, `implementation "androidx.media3:media3-exoplayer:$media3Version"`, `implementation "androidx.media3:media3-session:$media3Version"`. [VERIFIED: android/app/build.gradle:5,102-107] |
| Existing WebMessage v2 RPC | Protocol `2` | Named provider/lyric operations, request identity, cancellation and terminal response. | Current contract rejects unrecognized fields and operations, and native owns final routes. [VERIFIED: android/app/src/main/java/com/dazzlingwuming/listen2/AndroidRpcContract.java:17-25,58-95] |
| Existing Room | `2.8.4` | Lyrics metadata/selection/offset persistence and migrations. | Already present with a lyric metadata entity; avoid WebView-only storage for Android contract state. [VERIFIED: android/app/build.gradle:6,106-110; android/app/src/main/java/com/dazzlingwuming/listen2/data/DurableRecordEntities.java:66-82] |
| Existing AngularJS classic-script UI | vendored | Lyric parsing, scrolling, localization and accessibility semantics. | Scripts are packaged by the explicit asset allow-list; no framework migration is in scope. [VERIFIED: android/app/build.gradle:10-37] |

### Supporting

| Component | Purpose | Use |
|---|---|---|
| `BridgeRequestRegistry` + `BridgeRetryPolicy` | Exactly-once terminal settlement, active transport cancellation and bounded retry/deadline. | Reuse for every added `netease.*` and `lyric.*` operation. [VERIFIED: android/app/src/main/java/com/dazzlingwuming/listen2/AndroidHttpBridge.java:234-260,481-511] |
| Existing `parseLyric` UI utility | Turns LRC/tLRC into ordered line records. | Retain only after adding explicit validation for usable timestamp coverage and track/duration match. [VERIFIED: app/listen1_chrome_extension/js/controller/play.js:2313-2408] |

**Installation:** none. This phase must not add a package; its required primitives are already pinned and packaged. [VERIFIED: android/app/build.gradle:102-116]

## Architecture Patterns

### System Architecture Diagram

```text
User search / directory / lyric action
            |
            v
Shared Angular provider + lyric controller
  - requestId + pageEpoch + lyricGeneration
  - no URL/header/cookie/transport fields
            |
            v
WebMessage v2 adapter ---- cancel ----> BridgeRequestRegistry
            |                                  |
            v                                  v
AndroidRpcContract + HttpBridgePolicy -> native NetEase adapter
  exact operation/payload                  exact host/path/query, size,
  schema projection                         deadline/retry/no redirect
            |                                  |
            +---- structured terminal ---------+
            |
            v
PlaybackService / Media3
  native-issued track identity + position + revision
            |
            v
sanitized playback/lyric snapshot --> Angular active-line render,
                                       scroll, offset, TalkBack status
```

### Pattern 1: One high-level operation per provider capability

Use separate v2 operations for NetEase search, directory/playlist detail, track rendition and primary lyric; each has an exact payload validator, native URI/request builder, response projector and fixture. Do not permit a generic `provider.fetch`, request URL, body, header or cookie field. This follows the current bridge principle: “pages cannot select URLs, headers or cookies.” [VERIFIED: android/app/src/main/java/com/dazzlingwuming/listen2/AndroidRpcContract.java:16-19]

The legacy desktop provider is not directly portable: playlist detail, rendition and lyric all use `weapi`/`eapi` POST calls, and the rendition branch writes `sound.url`. [VERIFIED: app/listen1_chrome_extension/js/provider/netease.js:300-395,635-667] Treat any route/encryption implementation inferred from that code as [ASSUMED] until a fixture plus authorized device evidence verifies it; never send this transport material into the page snapshot.

### Pattern 2: Native-issued lyric identity + native clock

On successful `prepareSelection`, preserve a sanitized current lyric context in the native owner: source, provider track ID, optional bounded part ID, duration, opaque occurrence/track handle and a selection generation. The existing policy already retains `source`, `providerTrackId`, `providerPartId`, `trackHandle`, and `occurrenceId` internally. [VERIFIED: android/app/src/main/java/com/dazzlingwuming/listen2/PlaybackBridgePolicy.java:89-115] Extend the public snapshot only with the minimum lyric-safe identity needed by the page; do not expose candidates, provider response bodies, URLs, cookies or headers.

The service emits the current position projection. Page logic accepts a lyric response only if `(pageEpoch, playback revision/selection generation, lyric request token, track identity)` all still match. Reset active-line and loading state immediately on transition; a terminal result may update the UI once only if it is current.

### Pattern 3: Provider-neutral lyric record and manual override

Define one lyric record keyed by `(source, providerTrackId, providerPartId-or-empty, lyricRevision)` with mode `auto` or `manual`, original LRC, optional translated LRC, timestamp quality, match metadata, bounded offset and update time. The exact field names are [ASSUMED] design names, not an existing contract. A manual write must compare an expected revision and become the preferred result for that exact key; clear restores auto resolution. This generalizes the current controller, which hard-gates manual lookup/selection to Bilibili. [VERIFIED: app/listen1_chrome_extension/js/controller/play.js:3179-3183,3266-3274,3333-3377]

### Pattern 4: Accessible status is stateful, not a per-frame announcement

Render ordinary lyric lines as text. Give the active-line status a concise, unique accessible label that includes active-line state, offset and original/translation mode; update it only on line transition, manual offset/mode action or terminal lyric state—not every position poll. Android documents a polite live region as queued/non-disruptive and reserves assertive announcements for time-critical information. [CITED: https://developer.android.com/reference/androidx/core/view/ViewCompat.html] Existing lyric `<p>` rows have no lyric-specific role, label or live-region semantics. [VERIFIED: app/listen1_chrome_extension/listen1.html:2970-2980]

### Recommended Project Structure

```text
android/app/src/main/java/com/dazzlingwuming/listen2/
├── AndroidRpcContract.java          # extend closed operations/payloads/projectors
├── HttpBridgePolicy.java            # exact NetEase route policy only
├── AndroidHttpBridge.java           # registered/cancellable native execution
├── PlaybackService.java             # service-owned lyric clock projection
├── PlaybackSnapshot.java            # sanitized active lyric identity/clock only
└── data/                            # lyric repository/entity/DAO/migration owned here

app/listen1_chrome_extension/js/
├── lowebutil.js                     # v2 request handle/cancel/stale settlement
├── provider/netease.js              # Android typed NetEase adapter, desktop unchanged
└── controller/play.js               # provider-neutral lyric render/state/accessibility
```

## Don't Hand-Roll

| Problem | Do not build | Use instead | Why |
|---|---|---|---|
| Audio clock | JavaScript timer or Howler position on Android | Service-owned Media3 `getCurrentPosition()` projection | Page lifecycle and web clock are not audio authority; Media3 explicitly requires polling for normal progress. [CITED: https://developer.android.com/media/media3/session/player] |
| Cancellation/late reply arbitration | New ad-hoc Promise maps | `BridgeRequestRegistry` + existing adapter request handle | Existing bridge already namespaces by epoch, cancels futures/connections and settles terminal states. [VERIFIED: android/app/src/main/java/com/dazzlingwuming/listen2/AndroidHttpBridge.java:220-260; app/listen1_chrome_extension/js/lowebutil.js:585-765] |
| Provider network security | Generic HTTP proxy or WebView AJAX fallback | `AndroidRpcContract` + `HttpBridgePolicy` + native projector | Exact allow-list, no redirect and bounded body are already enforced patterns. [VERIFIED: android/app/src/main/java/com/dazzlingwuming/listen2/HttpBridgePolicy.java:41-84; android/app/src/main/java/com/dazzlingwuming/listen2/AndroidHttpBridge.java:432-478] |
| Durable Android lyric state | New WebView localStorage key | Existing Room database with migration-tested native repository | Existing local storage limits offsets to Bilibili IDs; it cannot implement provider-neutral Android revision semantics. [VERIFIED: app/listen1_chrome_extension/js/controller/play.js:1632-1647; android/app/src/main/java/com/dazzlingwuming/listen2/data/Listen2Database.java:6-21] |
| TalkBack announcements | Per-350ms `aria-live` updates or assertive status spam | State-change/line-change polite announcement | Repeated timing updates would queue or interrupt speech instead of conveying usable state. [CITED: https://developer.android.com/reference/androidx/core/view/ViewCompat.html] |

## Common Pitfalls

### Pitfall 1: Claiming NetEase parity from search-only v1 success

**What goes wrong:** Android search currently uses `adapter.get()` to a single v1 URL and converts every parse/transport failure to an empty result. [VERIFIED: app/listen1_chrome_extension/js/provider/netease.js:468-557] That loses actionable provider error and proves neither detail, rendition nor lyrics.

**Avoidance:** migrate the Android path to typed responses and map errors to stable user-visible provider states. Keep an existing successful result list on partial/new request failure; cancellation is terminal but not an empty-search success.

### Pitfall 2: Page metadata is mistaken for active native track

**What goes wrong:** `l1_player.js` assigns snapshot positions to `nativeCurrentTrack`, a page-local value; after background recovery or external MediaSession selection it has no native current source/provider identity. [VERIFIED: app/listen1_chrome_extension/js/l1_player.js:12-15,53-95]

**Avoidance:** include native-issued active lyric identity in the service projection, and require it on lyric requests/render acceptance.

### Pitfall 3: Existing lyric UI is Bilibili-only and non-accessible

**What goes wrong:** offset saves only `bitrack_` IDs and the picker exits for non-Bilibili tracks; lyric lines lack an accessible active-state contract. [VERIFIED: app/listen1_chrome_extension/js/controller/play.js:1632-1667,3179-3183; app/listen1_chrome_extension/listen1.html:2970-2980]

**Avoidance:** move Android persistence to native provider-neutral records, make the picker/candidate resolver capability-driven, and add explicit active-line, offset and translation semantics with TalkBack device verification.

### Pitfall 4: Signed rendition data leaks across the native/page boundary

**What goes wrong:** NetEase desktop bootstrap obtains `sound.url`; transmitting it to the page would violate the existing sanitized snapshot boundary. [VERIFIED: app/listen1_chrome_extension/js/provider/netease.js:355-395; android/app/src/main/java/com/dazzlingwuming/listen2/PlaybackSnapshot.java:8-13]

**Avoidance:** native resolves and consumes rendition transport internally; page receives only status, safe metadata, opaque handle and retryability.

### Pitfall 5: Current native resolver cannot prove live NetEase playback

**What goes wrong:** `PlaybackService` currently constructs `PlaybackMediaResolver` with `descriptor -> java.util.Collections.<String>emptyList()`. [VERIFIED: android/app/src/main/java/com/dazzlingwuming/listen2/PlaybackService.java:89-92] No real NetEase rendition can be exercised through the current Media3 owner.

**Avoidance:** Phase 3 must either own the missing native rendition-resolution seam or obtain an explicit roadmap reallocation before planning implementation. A fixture-only resolver is insufficient for NET-004 E2E acceptance.

## Code Examples

### Lyric response acceptance (implementation skeleton)

```javascript
function acceptLyricReply(reply, active) {
  if (!sameIdentity(reply.identity, active.identity)) return;
  if (reply.pageEpoch !== active.pageEpoch) return;
  if (reply.selectionGeneration !== active.selectionGeneration) return;
  if (reply.requestToken !== active.requestToken) return;
  renderLyric(reply.record, active.positionMs);
}
```

This is a proposed skeleton [ASSUMED]. It combines existing current-track/token checks with the required native selection identity; current code checks only `lyricRequestToken` and page `currentPlaying.id`. [VERIFIED: app/listen1_chrome_extension/js/controller/play.js:3014-3031]

### Native clock projection (implementation skeleton)

```java
void publishLyricClock() {
    LyricClock clock = LyricClock.from(activeIdentity, player.getCurrentPosition(), revision);
    bridge.publish(clock.toSanitizedSnapshot());
}
```

This is a proposed skeleton [ASSUMED]. It must execute on the existing player application/main looper and must not include rendition transport. Current service snapshots obtain `player.getCurrentPosition()` and emit safe DTO maps. [VERIFIED: android/app/src/main/java/com/dazzlingwuming/listen2/PlaybackService.java:149-150,247-264; android/app/src/main/java/com/dazzlingwuming/listen2/PlaybackSnapshot.java:8-13]

## Provider Capability Matrix Contract

| Provider | Search | Directory/detail | Rendition | Primary lyric | Manual lyric | Login/session | Phase 3 UI state |
|---|---|---|---|---|---|---|---|
| NetEase | Contract + fixture + device proof required | Contract + fixture + device proof required | Contract + authorized device proof required | Contract + fixture + device proof required | Native revisioned record + device proof required | Remains capability-declared; Phase 5 owns sessions | Show only fields whose evidence exists; otherwise explicit unavailable/error. [VERIFIED: .planning/REQUIREMENTS.md:138] |
| Bilibili | Existing Phase 1 contract | Existing Phase 1 contract | Existing native resolver gap must be respected | Must migrate to Media3-clock path | Must migrate from Bilibili-only UI state | Phase 5 | Preserve existing working surface; do not regress its typed boundary. [VERIFIED: .planning/phases/01-verified-bilibili-startup-slice/01-CONTEXT.md; app/listen1_chrome_extension/js/controller/play.js:1621-1667] |
| QQ / Kugou / Kuwo / Migu / Taihe | Unavailable | Unavailable | Unavailable | Unavailable | Unavailable | Unavailable | Render no actionable capability until independent route, fixture, authorization and device evidence. [VERIFIED: .planning/REQUIREMENTS.md:139-143] |

## Validation Architecture

### Test Framework

| Property | Value |
|---|---|
| Java unit tests | JUnit `4.13.2`, `:app:testDebugUnitTest`. [VERIFIED: android/app/build.gradle:109-113] |
| Frontend contract tests | Node scripts under `app/listen1_chrome_extension/test`; aggregate command is `npm --prefix app/listen1_chrome_extension test`. [VERIFIED: app/listen1_chrome_extension/package.json:6-8] |
| Android device gate | API-35 emulator instrumentation plus an authorized, redacted live-provider smoke; build/JVM success is not completion. [VERIFIED: AGENTS.md; .planning/ROADMAP.md:98-102] |

### Phase Requirements → Test Map

| Req ID | Behavior | Test type | Automated command | Gap/acceptance |
|---|---|---|---|---|
| NET-004 | Exact typed NetEase operation payloads, policy paths/queries, schema projection, cancellation/timeout/redirect/oversize/error and provider-matrix unavailable fields | JVM + Node contract | `gradle --no-daemon :app:testDebugUnitTest` and focused Node tests | New typed NetEase tests required; existing test proves only v1 search and empty-fallback behavior. [VERIFIED: app/listen1_chrome_extension/test/android_http_netease_search.test.js:198-289] |
| NET-004 | Search → playlist/detail → authorized rendition → Media3 playback → lyric entry | API-35 emulator E2E | Phase-specific `adb` evidence harness (new) | Live authorization/rendition route is a gate; fixtures do not complete it. [VERIFIED: .planning/ROADMAP.md:98-102] |
| LYR-001 | Same active line across pause/seek/track transition/recovery for Bilibili and NetEase | JVM native clock + Node controller contract + emulator | focused new tests, then extension suite | New identity/clock tests required; current parser test surface is Bilibili-focused. [VERIFIED: app/listen1_chrome_extension/test/bilibili_lyric_translation.test.js:419-569] |
| LYR-002 | Manual selection wins by provider/track/revision; plain/missing/low-timestamp/timeout/mismatch degrade without blocking audio | Room migration/JVM + Node controller | focused new DAO/controller tests | New native lyric repository and migration tests required. [VERIFIED: .planning/REQUIREMENTS.md:59] |
| LYR-003 | TalkBack labels, stale/cancel/error terminal handling and no fake timestamps | Node DOM contract + API-35 TalkBack/manual evidence | focused new UI test + device record | New accessible lyric markup/device proof required. [VERIFIED: .planning/REQUIREMENTS.md:60] |

### Wave 0 Gaps

- [ ] Java contract tests for every new `netease.*` and `lyric.*` operation, including exact fields, origin, cancellation, one-terminal-result and response redaction.
- [ ] Native provider projection fixtures for NetEase search/detail/rendition/primary-lyric success and provider/permission/schema/timeout/redirect/body-limit failures.
- [ ] Room DAO/repository migration tests for manual/auto precedence, revision conflict, offset bounds and recovery.
- [ ] Frontend tests for provider-neutral lyric rendering and stale `(epoch, selection generation, request token)` rejection.
- [ ] API-35 emulator evidence for real authorized NetEase audio and TalkBack state, with no credentials, signed URLs or provider bodies recorded.

## Security Domain

### Applicable ASVS Categories

| ASVS category | Applies | Standard control |
|---|---|---|
| V2 Authentication | Yes | NetEase entitlement/login state is an explicit provider result; Phase 3 must not imply authentication or add cookie controls. [VERIFIED: .planning/REQUIREMENTS.md:39] |
| V3 Session Management | Yes | No session material in RPC/snapshots/logs; later Phase 5 owns persistent session lifecycle. [VERIFIED: .planning/ROADMAP.md:122-134] |
| V4 Access Control | Yes | Capability matrix defaults unavailable for unproven providers; native operation allow-list prevents arbitrary provider invocation. [VERIFIED: .planning/REQUIREMENTS.md:135-143] |
| V5 Input Validation | Yes | Exact JSON keys/types/ranges, trusted main-frame origin, route/query allow-list and bounded bodies. [VERIFIED: android/app/src/main/java/com/dazzlingwuming/listen2/AndroidRpcContract.java:58-95; android/app/src/main/java/com/dazzlingwuming/listen2/HttpBridgePolicy.java:41-128] |
| V6 Cryptography | Conditional | Do not implement or expose provider signing/cookie cryptography in the page. If a verified NetEase route requires native signing, isolate it in pure Java with fixture and entitlement proof; implementation is [ASSUMED] pending route authorization. |

### Threat Patterns

| Pattern | STRIDE | Mitigation |
|---|---|---|
| Arbitrary provider URL/header/cookie injection | Elevation / information disclosure | Named v2 operations; native creates final request and rejects extra fields. [VERIFIED: android/app/src/main/java/com/dazzlingwuming/listen2/AndroidRpcContract.java:58-95] |
| Stale lyric overwrites after seek/track/page change | Tampering | Bind reply to page epoch, selection generation and lyric token; cancel active request and settle exactly once. Existing epoch/cancel primitives are reusable. [VERIFIED: app/listen1_chrome_extension/js/lowebutil.js:557-765] |
| Provider HTML/metadata causes DOM execution | Tampering | Treat titles/lyrics/metadata as text; project/validate before Angular rendering, reject unsafe markup except explicitly documented cases. [VERIFIED: android/app/src/main/java/com/dazzlingwuming/listen2/AndroidRpcContract.java:128-230] |
| Signed rendition/cookie leaks to page or evidence | Information disclosure | Native playback resolver consumes transient transport; snapshot is allow-listed DTO only. [VERIFIED: android/app/src/main/java/com/dazzlingwuming/listen2/PlaybackSnapshot.java:8-13] |
| TalkBack speech flood | Denial of service | Announce line/status transitions politely, not polling updates. [CITED: https://developer.android.com/reference/androidx/core/view/ViewCompat.html] |

## Environment Availability

| Dependency | Required by | Available | Version | Fallback |
|---|---|---|---|---|
| Java | Android build/tests | ✓ | Java 17 configured | — [VERIFIED: android/app/build.gradle:76-79] |
| Gradle | Android build/tests | ✓ (project documentation specifies external install) | 8.10.2 expected | None; wrapper JAR is absent. [VERIFIED: android/README.md:40-52] |
| API-35 emulator | required NetEase/TalkBack E2E | Not probed in this research-only task | — | No substitute for acceptance evidence. [VERIFIED: AGENTS.md] |
| Authorized NetEase account/content | live rendition/lyric proof | Not supplied | — | No entitlement bypass; record as external gate. [VERIFIED: .planning/PROJECT.md] |

## Assumptions Log

| # | Claim | Section | Risk if wrong |
|---|---|---|---|
| A1 | A native NetEase rendition/detail/lyric route can be implemented from an authorized provider contract without new dependencies. | Architecture Patterns | Could require an approved provider integration or change phase scope/dependency. |
| A2 | `LyricClock`, `selectionGeneration`, and proposed operation names are appropriate concrete contract names. | Code Examples / Architecture | Names or DTO split may change, but the authority and identity requirements remain. |
| A3 | Room should store full lyric text as part of Phase 3 rather than metadata plus protected file/cache storage. | Pattern 3 | Storage size/retention and migration design need an explicit implementation decision. |

## Open Questions / Planning Blockers

1. **Native NetEase rendition dependency is unresolved.**
   - What we know: the Phase 3 success criterion requires real rendition playback, but current `PlaybackService` resolver starts with an empty candidate list. [VERIFIED: android/app/src/main/java/com/dazzlingwuming/listen2/PlaybackService.java:89-92]
   - What's unclear: the approved, entitlement-compliant NetEase detail/rendition/lyric request contract and whether Phase 3 is authorized to implement it despite `PLAY-002` being assigned to Phase 9. [VERIFIED: .planning/REQUIREMENTS.md:49-50,184,189]
   - Recommendation: resolve before final PLAN.md: explicitly assign the closed NetEase native resolver to this phase, or revise the dependency/requirement allocation. Do not plan an arbitrary URL bridge or claim NET-004 with only fixtures.

2. **The sibling `listen1_mobile` reference is unavailable in this workspace.**
   - What we know: no sibling directory, branch or tracked reference files matching `listen1_mobile`, `background-player.screen.js`, or the cited Redux files were found during this research. [VERIFIED: filesystem/branch scan, 2026-08-31]
   - Recommendation: continue from the current desktop/Android contracts; if original-mobile behavior is required for a product decision, provide the exact checkout/revision for read-only comparison.

3. **Lyric text retention and migration boundary needs a locked decision.**
   - What we know: Room currently has `LyricMetadataEntity`, but its fields are metadata only: `lyricId`, `source`, `providerTrackId`, `language`, `updatedAtMs`. [VERIFIED: android/app/src/main/java/com/dazzlingwuming/listen2/data/DurableRecordEntities.java:66-82]
   - Recommendation: planner should include a short schema spike/migration task before committing to full LRC persistence, with size bounds and corruption recovery.

## Sources

### Primary (codebase-verified)

- `android/app/src/main/java/com/dazzlingwuming/listen2/AndroidRpcContract.java` — v2 envelope, operation allow-list and route construction.
- `android/app/src/main/java/com/dazzlingwuming/listen2/HttpBridgePolicy.java` and `AndroidHttpBridge.java` — trusted origin, NetEase search-only route, transport/cancel/deadline boundary.
- `android/app/src/main/java/com/dazzlingwuming/listen2/PlaybackService.java`, `PlaybackSnapshot.java`, `PlaybackBridgePolicy.java` — sole owner, safe snapshot and native selection identity seam.
- `app/listen1_chrome_extension/js/provider/netease.js`, `lowebutil.js`, `l1_player.js`, `controller/play.js` — current desktop/Android adapter, stale settlement and Bilibili-only lyric UI behavior.

### Official documentation (MEDIUM confidence)

- [Android Media3 Player interface](https://developer.android.com/media/media3/session/player) — polling current position and player listener behavior.
- [Android Media3 player events](https://developer.android.com/media/media3/exoplayer/listening-to-player-events?hl=en) — transitions, discontinuities and listener semantics.
- [Android accessibility live regions](https://developer.android.com/reference/androidx/core/view/ViewCompat.html) — polite versus assertive change announcements.

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — all components are current in-repo dependencies and were opened this session.
- Architecture: HIGH for native/page authority boundaries; MEDIUM for proposed NetEase operations because a verified provider contract is absent.
- Pitfalls: HIGH — directly demonstrated by the v1 search-only route, Bilibili-only lyric controller and empty native resolver.

**Research date:** 2026-08-31  
**Valid until:** Native code anchors remain valid until the next Phase 3 implementation; recheck external provider routes immediately before live-device execution.
