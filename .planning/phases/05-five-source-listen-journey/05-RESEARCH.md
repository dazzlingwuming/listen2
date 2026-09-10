# Phase 5: Five-Source Listen Journey - Research

**Researched:** 2026-09-10
**Domain:** Hardened Android WebView typed RPC, provider adapters, Media3 playback, queue identity, and lyric projection
**Confidence:** MEDIUM

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Preserve the exact Android primary order `netease`, `kugou`, `kuwo`, `qq`, `bilibili`; Migu and Taihe remain registry-only unavailable.
- Use the original author's `listen1/listen1_mobile` v0.8.2 as the interaction and normalized-provider-contract reference. Use current desktop `main` and the existing Android architecture as capability and implementation authority.
- Carry one source-prefixed semantic identity from search rows through directory/detail selection, queue occurrences, playback preparation, lyric lookup, error recovery, and restored state. Never infer a source from a title, URL, or row position.
- Keep successful rows and the current user context when one source, page, artwork, directory, media, or lyric request fails. Empty, partial, login-required, unsupported, timeout, malformed-response, and authorization failures are distinct terminal states.
- Bilibili and NetEase are reusable foundations, not completed Phase-5 claims. Regression-prove their full search-to-lyric paths before enabling additional fields.
- QQ, Kugou, and Kuwo currently have desktop/browser adapters but no approved Android semantic routes. Their search, directory/detail, media, lyric, login, and fallback fields remain false until each field has a bounded native route and fixture/schema evidence.
- Enable capability fields independently. Search support never implies directory, playback, lyrics, or login support.
- Do not route Android through legacy direct Axios, cleartext endpoints, caller-provided cookies/headers, arbitrary URLs, opaque signing material, or browser CORS workarounds.
- A provider slice stops fail-closed if it requires permission bypass, unapproved credentials, generic transport exposure, or cannot produce a bounded normalized response. The UI keeps the precise capability unavailable with a safe next action.
- Reuse the Phase-4 semantic lifecycle for search, directory, media, lyric, and login. Source/query/page/epoch changes, cancellation, Back, timeout, renderer destruction, and late replies settle the active operation exactly once.
- Normalize search and directory rows to source, semantic identity, title, artist/author, artwork, duration, result kind, playable/login/unsupported state, and safe reason. Provider-only metadata stays native or inside its adapter.
- Directory/detail navigation preserves source, cursor, selected part/track, scroll context, and valid prior rows across rotation or a recoverable failure; it never appends a duplicate page after restoration.
- Bilibili details retain base video identity plus validated part/CID selection. Other providers retain provider-native album/playlist/track identity without exposing a transport URL.
- `PlaybackService` remains the sole ExoPlayer/MediaSession/queue owner. The WebView sends semantic track/part and queue intents and renders native snapshots; Howler is not an Android fallback.
- Add a resolver only after the provider's normalized media contract proves real MIME/container/codec/duration, entitlement, expiry, and bounded candidate recovery. Never route an unknown provider through the Bilibili resolver.
- Reuse native occurrence identity, FIFO play-next, duplicate entries, reorder/removal, shuffle, repeat, previous-history, checkpoint, audio-focus, noisy/headset/Bluetooth, notification, and lock-screen behavior across mixed-source fixtures.
- A media failure retains the current track and queue occurrence, exposes retry or the truthful next action, and never consumes another queue item merely because resolution failed.
- Lyrics are keyed to current provider/track/part/revision and use the Media3 clock. A provider reply or fallback is accepted only when current identity, duration/match policy, epoch, and source attribution still match.
- Preserve existing Bilibili/NetEase candidate, manual selection, offset, translation, persistence, and stale-reply contracts; extend capabilities source by source only where a bounded route exists.
- Missing lyrics, plain text, insufficient timestamps, mismatch, timeout, login-required, and unsupported are visible degradations and never block first playback.
- Old-track text, guessed timestamps, or an unattributed cross-provider lyric must never replace the active track's lyric state.
- Implement in cohesive slices and use focused JavaScript/JVM/fixture tests while coding. Do not assemble an APK after each capability.
- Each provider fixture must include success, empty, malformed, timeout/cancel, authorization/unsupported, stale reply, and bounded payload cases before its capability becomes true.
- Phase 5 proves deterministic five-source contracts and mixed-source playback/lyric behavior. Phase 8 retains real API 35 WebView, IME, rotation, TalkBack, codec, notification/lock-screen/audio-focus, renderer/process recovery, performance, and live-provider acceptance.

### the agent's Discretion
- Exact Java class split, adapter helper names, fixture organization, and mobile row/detail presentation may follow established project patterns when the boundaries and observable states above remain intact.

### Deferred Ideas (OUT OF SCOPE)
- Provider account/session management and Bilibili QR lifecycle are completed in Phase 6, though Phase 5 must represent login-required and entitlement states truthfully.
- Offline/download/cache and advanced MV/effects/loudness completion belong to Phase 7.
- Integrated APK, API 35 emulator, live-provider/credential runs, system-control/device lifecycle, accessibility, performance, and release-like evidence belong to Phase 8.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|---|---|---|
| NET-003 | Bilibili search → part/detail → authorized media → primary lyric entry | Closed Android RPC, Bilibili directory, resolver and lyric seams. |
| NET-004 | NetEase closed loop plus independent provider capability fields | Closed NetEase client; A-class QQ/Kugou/Kuwo fields are individually fixture-gated, while every B/C field remains false. |
| SRCH-001..003 | Cancellable, paged, source-labelled, non-destructive results | Phase-4 semantic lifecycle plus typed response/terminal validation. |
| PLAY-001,003..006 | Native sole owner, controls, queue, history, service continuity | Existing `PlaybackService`, policy, queue engine, checkpoint, and Media3 service. |
| LYR-001..003 | Identity-safe Media3-clock lyrics, manual state, accessible degradation | Existing clock/persistence contracts; add provider-specific fixture gates and accessible projection tests. |
</phase_requirements>

## Project Constraints (from AGENTS.md)

- Use the shared browser UI and provider/player contracts; keep Android-native security/network policy in small pure-Java helpers with JVM tests. [VERIFIED: AGENTS.md Project Constraints]
- Preserve a narrow, versioned, allow-listed native bridge: no arbitrary URL, caller header, cookie control, generic JavaScript interface, cleartext route, DRM/entitlement bypass, or secret in source/logs/APK/planning artifacts. [VERIFIED: AGENTS.md Project Constraints]
- Keep `PlaybackService`/Android system lifecycle native; do not depend on a living WebView for playback. [VERIFIED: AGENTS.md Project Constraints]
- Modify generated Android assets only through `android/app/build.gradle`'s allow-list; do not hand-edit build output. [VERIFIED: AGENTS.md Conventions]
- Preserve classic-script load order and browser-safe guards; add frontend tests under `app/listen1_chrome_extension/test/` and Android boundary tests under `android/app/src/test/java/com/dazzlingwuming/listen2/`. [VERIFIED: AGENTS.md Conventions]
- No merge, deploy, release signing credentials, account credentials, or production/runtime data are authorized. Full local CI is required before any commit/push; this research task itself makes no commit. [VERIFIED: AGENTS.md Project Constraints and Collaboration Contract]

## Summary

Phase 5 should extend one already-safe architecture, not transplant the original mobile app. The original `v0.8.2` source confirms the intended phone interaction: four provider tabs feed one normalized track row, a row resolves to playback, and a mini-player reflects the current track. Its client selects `netease`, `kugou`, `kuwo`, and `qq` from one provider array, while its search list pages rows and its background player owns system controls. [CITED: https://github.com/listen1/listen1_mobile/blob/v0.8.2/src/api/client.js] [CITED: https://github.com/listen1/listen1_mobile/blob/v0.8.2/src/views/playlist/search.screen.js] [CITED: https://github.com/listen1/listen1_mobile/blob/v0.8.2/src/views/player/background-player.screen.js]

Its historical transport is not reusable as-is: it contains cleartext routes and page-controlled `Referer`/`User-Agent` headers. Current desktop adapters nevertheless identify several independently usable, fixed HTTPS request shapes. Phase 5 may implement only those shapes behind named native operations and bounded mappers; it must not transplant the legacy transport. QQ and Kugou still lack a safe live media-candidate contract, while Kuwo's current search, directory, and media requests depend on a cookie-derived opaque header. Thus the phase can complete five-source normalized UI/fixture journeys, but cannot honestly claim five live search-to-play-to-lyric journeys unless the blocked media routes obtain an approved, fixed native contract. [VERIFIED: app/listen1_chrome_extension/js/provider/qq.js:228-534] [VERIFIED: app/listen1_chrome_extension/js/provider/kugou.js:61-215,308-348] [VERIFIED: app/listen1_chrome_extension/js/provider/kuwo.js:231-481] [CITED: https://github.com/listen1/listen1_mobile/tree/v0.8.2/src/api/provider]

**Primary recommendation:** regression-lock Bilibili and NetEase first, then add an explicit source adapter/factory with a fail-closed resolver. Implement only the A-class fixed HTTPS operations below; use B-class adapters only with deterministic fixtures and never send C-class legacy requests. Plan the product gate as **two live closed loops plus five-source contract parity** unless approved media contracts are added for QQ, Kugou, and Kuwo.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|---|---|---|---|
| Source selection, row rendering, cursor/scroll restoration | Packaged browser client | Typed native RPC | Page owns interaction state; native returns only bounded semantic DTOs. [VERIFIED: app/listen1_chrome_extension/js/mobile_provider_registry.js:4-31] |
| Operation lifecycle/cancel/late reply | Both | — | Browser owns page epoch; bridge owns active request and returns one typed terminal. [VERIFIED: android/app/src/main/java/com/dazzlingwuming/listen2/AndroidHttpBridge.java:696-730] |
| Provider request minting, allow-list, schema mapping | Native provider adapter | Browser projection | The page cannot choose a URL or credential. [VERIFIED: android/app/src/main/java/com/dazzlingwuming/listen2/AndroidRpcContract.java:18-21] |
| Playback manifest resolution and candidate recovery | `PlaybackService` / native resolver | Media3 | Resolver candidates never cross to page snapshots. [VERIFIED: android/app/src/main/java/com/dazzlingwuming/listen2/PlaybackService.java:277-330] |
| Queue, duplicate occurrences, history, checkpoint | `PlaybackService` / Room | Browser snapshot | Page occurrence is semantic identity; native resolver occurrence stays private. [VERIFIED: android/app/src/main/java/com/dazzlingwuming/listen2/PlaybackService.java:342-350] |
| Lyric selection/persistence and time | Native lyric port / Media3 clock | Browser lyric display | Lyrics are applied only to the current source/track/part/revision projection. [VERIFIED: android/app/src/main/java/com/dazzlingwuming/listen2/LyricClockProjection.java:69-97] |

## Standard Stack

### Core

| Component | Version | Purpose | Direction |
|---|---:|---|---|
| AndroidX WebKit | `1.12.1` | Packaged WebView and origin-scoped message listener | Retain; no generic `addJavascriptInterface`. [VERIFIED: android/app/build.gradle:103-105] [CITED: https://developer.android.com/reference/androidx/webkit/WebViewCompat] |
| Media3 ExoPlayer + Session | `1.9.4` | Sole native player, MediaSession, notification/system controls | Retain; the official architecture places player/session in `MediaSessionService`. [VERIFIED: android/app/build.gradle:5,103-106] [CITED: https://developer.android.com/media/media3/session/background-playback] |
| Room | `2.8.4` | Queue/lyric/domain persistence | Retain for checkpoints and lyric selections. [VERIFIED: android/app/build.gradle:6,107-111] |
| AngularJS classic scripts + existing typed adapter | packaged | Mobile UI, provider registry, typed operation client | Retain; no framework migration or new runtime package. [VERIFIED: android/app/build.gradle:10-40] |

### Supporting

| Component | Purpose | Use in Phase 5 |
|---|---|---|
| JUnit `4.13.2` + `org.json:json:20240303` | Native contract/mapper fixtures | Add pure-JVM provider/resolver/lyric fixture tests. [VERIFIED: android/app/build.gradle:110-115] |
| Existing Node test harness | Shared registry/controller/player contracts | Add small Node tests alongside existing Android provider contract tests. [VERIFIED: app/listen1_chrome_extension/package.json:6-8] |

**Installation:** none. Phase 5 should not install an external dependency; therefore no package-legitimacy audit is applicable.

## Provider-by-Provider Capability Matrix and Gaps

`ProviderCapabilityFacade` serializes exactly `search`, `directory`, `detail`, `media`, `lyric`, `manualLyric`, `fallback`, `login`, and `permission`; only `bilibili` and `netease` are emitted by the native facade today. Verbatim source shape: `result.put("bilibili", bilibili.toJson()); result.put("netease", netease.toJson());`. [VERIFIED: android/app/src/main/java/com/dazzlingwuming/listen2/provider/ProviderCapabilityFacade.java:58-69]

| Source | Current safe foundation | Exact Phase-5 gap | Capability state required until gap closes |
|---|---|---|---|
| Bilibili | Typed search, video detail, directory, private resolver, lyric candidate seam exist. [VERIFIED: android/app/src/main/java/com/dazzlingwuming/listen2/AndroidRpcContract.java:38-62] | Prove base-video → CID, MIME/codec/expiry/entitlement mapping, no queue consumption on resolve failure, and source-attributed lyric outcome with fixtures. | Regress all declared fields; only retain `true` after fixture contract passes. |
| NetEase | Native closed search/detail/rendition/primary lyric routes are dispatched. [VERIFIED: android/app/src/main/java/com/dazzlingwuming/listen2/AndroidHttpBridge.java:783-800] | Finish UI path/queue integration and prove media/lyric failure and restoration. Manual lyric search explicitly returns route unavailable. | `manualLyric=false`; no fabricated candidate list. |
| QQ | Desktop provider exists, but no Android RPC enum/facade/client/resolver branch. [VERIFIED: android/app/src/main/java/com/dazzlingwuming/listen2/AndroidRpcContract.java:38-76] [VERIFIED: android/app/src/main/java/com/dazzlingwuming/listen2/PlaybackService.java:311-327] | A-class fixed HTTPS search and playlist/detail request shapes exist; media is B because the response supplies a dynamic stream base; lyric's current route explicitly needs a browser Referer workaround (C). | Start false; `search`/`directory`/`detail` can turn true only after their native fixture/schema gates and an owner accepts the external-route risk; `media` and `lyric` stay false. |
| Kugou | Same absence from Android enum/facade/resolver. [VERIFIED: android/app/src/main/java/com/dazzlingwuming/listen2/provider/ProviderCapabilityFacade.java:52-56] | A-class HTTPS track search, playlist/detail, and lyric shapes exist; every legacy cleartext enrichment endpoint is C; media is B because it returns an unbounded dynamic stream URL. | Start false; only A-class fields can turn true after their native fixture/schema gates and an owner accepts the external-route risk; `media` stays false. |
| Kuwo | Same absence from Android enum/facade/resolver. [VERIFIED: android/app/src/main/java/com/dazzlingwuming/listen2/PlaybackMediaResolver.java:94-107] | The current search/directory/media adapter fetches a browser cookie and derives an opaque `Secret` header (C). Only its unauthenticated fixed-HTTPS lyric request is A-class. | Start false; `lyric` alone may turn true after its native fixture/schema gate and an owner accepts the external-route risk. `search/directory/detail/media/login` stay false. |
| Migu/Taihe | Registry-only non-primary entries. [VERIFIED: app/listen1_chrome_extension/js/mobile_provider_registry.js:76-92] | Out of Phase 5 route work. | All false. |

### Bilibili and NetEase implementation facts

- The v2 contract exposes named semantic operations and intentionally skips `BILIBILI_AUDIO_MANIFEST` when accepting page messages, so a manifest URL cannot be returned to WebView. Verbatim: `if (operation == BILIBILI_AUDIO_MANIFEST) continue;`. [VERIFIED: android/app/src/main/java/com/dazzlingwuming/listen2/AndroidRpcContract.java:84-94]
- `PlaybackBridgePolicy` currently accepts only Bilibili, local, and NetEase logical identities. Verbatim: `if ("bilibili".equals(source)) return isSafeBvid(providerTrackId); ... return "netease".equals(source)`. [VERIFIED: android/app/src/main/java/com/dazzlingwuming/listen2/PlaybackBridgePolicy.java:359-369]
- `PlaybackService.newResolver` falls through to Bilibili for every source other than `local` and `netease`; adding QQ/Kugou/Kuwo identities before explicit resolver selection would be a security/correctness defect. [VERIFIED: android/app/src/main/java/com/dazzlingwuming/listen2/PlaybackService.java:311-330]
- Bilibili's current lyric seam performs an explicitly attributed NetEase-catalog match, not a provider-native Bilibili lyric URL. Verbatim: `return new Resolution(Status.FOUND, null, "netease-primary-for-bilibili", lyric.lrc,`. [VERIFIED: android/app/src/main/java/com/dazzlingwuming/listen2/BilibiliLyricProvider.java:16-25,165-168] Preserve that attribution in UI and never label it as direct Bilibili lyrics.

## Fixed Native-Route Migration Decision

This is a **technical security decision**, not a claim that any undocumented third-party endpoint is a provider-approved public API. The original v0.8.2 mobile code is used only to compare normalized behavior and data shapes; its cleartext and caller-controlled-header patterns are never implementation inputs. [VERIFIED: /tmp/listen1-mobile-v082.dlGwZe/src/api/provider/qq.js:156-185] [VERIFIED: /tmp/listen1-mobile-v082.dlGwZe/src/api/provider/kugou.js:428-462] [CITED: https://github.com/listen1/listen1_mobile/tree/v0.8.2/src/api/provider]

Classification used by the planner:

**Live-status label:** no QQ, Kugou, or Kuwo external route in this table was live-verified in this session. “A” means boundary-safe to implement from current project evidence, never “provider-approved” or “confirmed available in production.”

- **A — fixed native candidate:** existing desktop code demonstrates an HTTPS host/path/method and a semantic input-to-DTO mapping that can be made safe: native code constructs the URI itself, accepts only bounded semantic input, sends no page cookie/header/URL, disables redirects, bounds the body, and projects a strict DTO. It is implementation-eligible with fixture/schema tests; live availability/stability and entitlement behavior still require Phase-8 acceptance.
- **B — fixture-only:** the current evidence reaches a dynamic media host or otherwise lacks the static host/codec/expiry/entitlement contract required by `PlaybackMediaResolver`. Implement the operation/mapping only against local fixtures; the production capability remains false.
- **C — prohibited:** the observed route requires HTTP, a caller/browser cookie, an opaque browser-derived signature, a caller-controlled header, a CORS/Referer workaround, or a raw page media URL. Do not send it from Android. A pure mapper fixture is allowed, but no production route/capability is.

| Source | Operation | Class | Fixed native route evidence (host · path · method) | Required implementation boundary and truthful Phase-5 state |
|---|---|---|---|---|
| QQ | Track/playlist search | A | `u.y.qq.com` · `/cgi-bin/musicu.fcg` · POST with a native-constant operation name and a bounded query/page/search-kind body. [VERIFIED: app/listen1_chrome_extension/js/provider/qq.js:340-404] | Add one named operation per search kind; bound UTF-8 query, page and output rows; map only safe identifiers/metadata. No page JSON body or headers. `search` may become true only after success/empty/malformed/timeout/cancel/authorization/bounded fixture cases pass. |
| QQ | Playlist/album detail | A | `i.y.qq.com` · `/qzone-music/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg` · GET for playlist detail; a separate fixed album CGI is shown for album detail. The desktop mapper converts returned rows to `qqtrack_` identities. [VERIFIED: app/listen1_chrome_extension/js/provider/qq.js:228-291] | Accept only a numeric/validated semantic collection ID; native emits normalized detail/rows. No artwork/media URL crosses to WebView. `directory`/`detail` may become true only after fixture gates. |
| QQ | Media bootstrap | B | `u.y.qq.com` · `/cgi-bin/musicu.fcg` · POST, but the reply combines a server-provided stream base with a path. [VERIFIED: app/listen1_chrome_extension/js/provider/qq.js:418-500] | Model entitlement/empty-path as a terminal unavailable result (the desktop code already treats an empty path as VIP). Do not concatenate or pass stream URLs to the page; keep `media=false` until an approved fixed CDN host set plus MIME/container/codec/duration/expiry schema and resolver tests exist. |
| QQ | Lyric | C | The observed HTTPS lyric CGI is explicitly annotated to require Chrome-extension Referer modification. [VERIFIED: app/listen1_chrome_extension/js/provider/qq.js:514-534] | Do not reproduce a Referer/CORS workaround. Keep `lyric`, `manualLyric`, and `fallback` false; fixture-only text normalization is permitted. |
| QQ | Login/account | C | No Android account route exists; account/session lifecycle is explicitly Phase 6. [VERIFIED: android/app/src/main/java/com/dazzlingwuming/listen2/AndroidRpcContract.java:45-49] [VERIFIED: 05-CONTEXT.md: Locked Decisions] | Do not add cookies, credential fields, or a login workaround. Return named unavailable/login-required state only. |
| Kugou | Track search | A | `songsearch.kugou.com` · `/song_search_v2` · GET. The response maps provider hashes into `kgtrack_` identities. [VERIFIED: app/listen1_chrome_extension/js/provider/kugou.js:61-133] | Construct fixed query/page parameters natively; omit optional artwork enrichment rather than expanding transport. `search` may become true only after bounded mapper fixture gates. |
| Kugou | Playlist/detail | A | `m.kugou.com` · `/plist/list/{validated-id}` · GET, plus `/app/i/getSongInfo.php` · GET when required to normalize a row. [VERIFIED: app/listen1_chrome_extension/js/provider/kugou.js:135-215] | Validate numeric collection IDs and hashes; return a bounded collection and rows. Do not call the separate cleartext album-info enrichment route. `directory`/`detail` may become true only after fixture gates. |
| Kugou | Media bootstrap | B | `m.kugou.com` · `/app/i/getSongInfo.php` · GET, but reply exposes an arbitrary media URL. [VERIFIED: app/listen1_chrome_extension/js/provider/kugou.js:308-328] | Keep the candidate private and reject it unless a future approved static CDN allow-list and MIME/container/codec/duration/expiry schema are established. Until then `media=false`; test only fixture resolver failures and entitlement states. |
| Kugou | Lyric | A | `wwwapi.kugou.com` · `/yy/index.php` · GET; desktop unwraps a known JSONP envelope into lyric text. [VERIFIED: app/listen1_chrome_extension/js/provider/kugou.js:330-348] | Native code must accept only a strict fixed wrapper (never evaluate JavaScript), cap text/line sizes, normalize safe LRC/plain text, and bind it to `kgtrack_` identity/revision. `lyric` may become true only after fixture gates. |
| Kugou | Legacy search/detail enrichment | C | `mobilecdnbj.kugou.com` routes in current desktop code use `http`, including playlist search and album metadata. [VERIFIED: app/listen1_chrome_extension/js/provider/kugou.js:65-103,162-176] | Do not upgrade, proxy, or silently substitute the HTTP route. Preserve missing optional metadata as a truthful degradation. |
| Kuwo | Track/playlist search and directory/detail | C | Current code first obtains a browser cookie then sends a derived opaque `Secret` header to HTTPS search/detail routes. [VERIFIED: app/listen1_chrome_extension/js/provider/kuwo.js:231-292,294-377] | Do not port the cookie acquisition, opaque signing algorithm, header, retry, or any page-controlled equivalent. Keep `search`, `directory`, and `detail` false; provide source-labelled fixture rows/disabled actions only. |
| Kuwo | Media bootstrap | C | The same cookie-derived-header helper wraps the media route and yields a raw response URL. [VERIFIED: app/listen1_chrome_extension/js/provider/kuwo.js:380-397] | No request, no URL projection, no resolver. Keep `media=false`; model login/authorization/unsupported in fixtures only. |
| Kuwo | Lyric | A | `m.kuwo.cn` · `/newh5/singles/songinfoandlrc` · GET; current implementation directly maps its lyric list without the cookie helper. [VERIFIED: app/listen1_chrome_extension/js/provider/kuwo.js:400-481] | Construct only from validated numeric `kwtrack_` ID; cap lines/text and map only current identity/revision. `lyric` may become true after fixture/schema gates; it never makes the provider playable. |
| Kuwo | Login/account | C | Phase 5 defers account/session management; the existing route dependency is browser-cookie based. [VERIFIED: 05-CONTEXT.md: Deferred Ideas] [VERIFIED: app/listen1_chrome_extension/js/provider/kuwo.js:231-292] | Keep `login`/`permission` false and project a safe next action only. |

**Consequence for the plan:** A-class operations are safe incremental native-client work, but they do not create an end-to-end playable provider without A-class media. On evidence available now, Bilibili and NetEase are the only live search → playback → lyric loops. QQ and Kugou can gain live browsing/partial lyric capabilities but must remain non-playable; Kuwo can gain only an independently attributable lyric capability. Therefore a requirement or plan title promising five **live** listen journeys is blocked; the implementable Phase-5 outcome is five-source UI/semantic/fixture parity plus two live closed loops. Do not hide that gap behind a Bilibili fallback or a generic media URL.

## Architecture Patterns

### System Architecture Diagram

```text
source selector/query/page/epoch
        |
        v
mobile_provider_registry + semantic lifecycle
        |  named operation + bounded semantic payload
        v
AndroidRpcContract -> native ProviderAdapter -> fixed HTTPS route / fixture
        |                 |                         |
        |                 +-> map schema -> safe row/detail/error DTO
        v
source-labelled rows -> detail/CID or track identity
        |
        v
PlaybackBridgePolicy -> PlaybackService -> source-specific resolver -> Media3
        |                    |                   |
        |                    +-> queue/checkpoint  +-> private candidate only
        v
snapshot -> mini-player / player / system MediaSession controls
        |
        v
LyricClockProjection + LyricPersistencePort -> current identity-only lyric UI
```

### Pattern 1: Capability is a native declaration, never a UI guess

**Use:** Create a source-neutral internal `ProviderAdapter` contract with methods for only the semantic operations already declared by a capability. Add a source to the facade only after its adapter validates fixture success and negative cases; do not make `get()` infer support from a desktop JS provider. This extends the existing capability rule that page code cannot enable a field with URL/credential input. [VERIFIED: android/app/src/main/java/com/dazzlingwuming/listen2/provider/ProviderCapabilityFacade.java:6-10]

### Pattern 2: Two-step semantic playback selection

**Use:** Retain `prepareSelection` followed by `selectPrepared`. The browser passes `source`, provider IDs, metadata and `mediaKind`; native mints opaque handles, then service binds a source-specific resolver to the occurrence. Verbatim accepted actions: `"replace-current"` and `"enqueue-next"`. [VERIFIED: android/app/src/main/java/com/dazzlingwuming/listen2/PlaybackBridgePolicy.java:119-145,148-175]

### Pattern 3: Keep provider transport entirely native

**Use:** Each client creates a request from a semantic operation, checks exact method/host/path/query/body rules, bounds response bytes, maps provider data into a page-safe DTO, and maps failures to safe error codes. NetEase is the closest model: its class documents that no method accepts page URL, headers, cookies, or arbitrary body. [VERIFIED: android/app/src/main/java/com/dazzlingwuming/listen2/NetEaseNativeProvider.java:23-29]

### Pattern 4: Lyrics are an optional, revision-checked projection

**Use:** Start lyrics after playback intent and accept a result only if source/track/part/occurrence/selection revision match the active `LyricClockProjection.Identity`. The projection refuses non-increasing revision callbacks, preventing a retired track from reviving. [VERIFIED: android/app/src/main/java/com/dazzlingwuming/listen2/LyricClockProjection.java:69-83]

## Safe Incremental Slices

1. **Regression baseline:** Add Bilibili/NetEase fixture tests for search, empty, malformed, timeout/cancel, authorization, stale replies, bounded payload, directory selection, resolver failure, and lyric attribution. Do not change public capability truth yet.
2. **Neutral adapter spine:** Extract internal source-specific adapter and resolver factory selection. The factory must return a named unavailable result for unknown/disabled source, never the Bilibili fallback. Extend no external routes in this slice.
3. **Bilibili closure:** Wire detail/CID → prepared semantic descriptor → resolver; assert exact current occurrence survives media failure and retry. Keep candidate URLs private.
4. **NetEase closure:** Wire typed search/detail/rendition/primary lyric through the same row/detail/playback projection; `netease.lyric.search` stays unavailable until a bounded verified route exists. [VERIFIED: android/app/src/main/java/com/dazzlingwuming/listen2/AndroidHttpBridge.java:795-800]
5. **A-class native operations:** Add named fixed-HTTPS mappers for QQ search/detail, Kugou search/detail/lyric, and Kuwo lyric. Every operation receives only a validated semantic input and must pass success, empty, malformed, timeout/cancel, authorization, stale, and bounded-body fixtures before its individual capability can turn true. An owner must also accept that external route authorization has not been independently verified.
6. **B/C-class contracts:** Keep QQ/Kugou media fixture-only and reject Kuwo cookie/signature transport, QQ Referer lyric, and every Kugou HTTP endpoint at policy level. Exercise source-labelled fixture rows and the exact unavailable action, not a fake live response.
7. **Mixed-source queue/lyric invariants:** Exercise duplicates, FIFO next, reorder/removal, shuffle/repeat/history/checkpoint, track switching and lyric staleness over mixed semantic identities. Only Bilibili/NetEase fixtures may assert actual resolver preparation; unsupported QQ/Kugou/Kuwo media must retain queue state and return a terminal reason.

## Don't Hand-Roll

| Problem | Do not build | Use instead | Why |
|---|---|---|---|
| Background playback/system controls | WebView/Howler audio fallback | Existing Media3 `PlaybackService` + `MediaSessionService` | Official Media3 guidance places player/session in the service for background/system control. [CITED: https://developer.android.com/media/media3/session/background-playback] |
| Generic provider networking | URL/header/cookie escape hatch | Named `AndroidRpcContract` operations and per-provider native mappers | Keeps untrusted page input out of transport and credentials. [VERIFIED: android/app/src/main/java/com/dazzlingwuming/listen2/AndroidRpcContract.java:18-21] |
| Cross-provider resolver | String-prefix routing to Bilibili | Explicit resolver factory, unavailable result by default | Current fallback proves unknown sources would otherwise be misrouted. [VERIFIED: android/app/src/main/java/com/dazzlingwuming/listen2/PlaybackService.java:311-327] |
| Lyric clock | JavaScript timers/guessed timestamps | `LyricClockProjection` from native playback state | Guards identity and revision races. [VERIFIED: android/app/src/main/java/com/dazzlingwuming/listen2/LyricClockProjection.java:69-83] |

## Common Pitfalls

### Unknown source accidentally plays through Bilibili

`newResolver` uses Bilibili in its final `else`; adding a new identity regex before an explicit branch can issue a Bilibili manifest request for a QQ/Kugou/Kuwo track. Require a `switch`/map with an explicit unknown-source failure test before registering any new source. [VERIFIED: android/app/src/main/java/com/dazzlingwuming/listen2/PlaybackService.java:311-327]

### Capability says true while the route is only a placeholder

The facade's production NetEase shape makes media and lyric true, but its generic `get()` returns an all-false capability for any other provider. Add a five-source matrix test that verifies each true field has a native adapter operation, schema fixture, and resolver/lyric proof. [VERIFIED: android/app/src/main/java/com/dazzlingwuming/listen2/provider/ProviderCapabilityFacade.java:36-40,52-56,96-117]

### Bilibili lyric provenance is lost

The existing fallback source string explicitly identifies NetEase for Bilibili. If UI maps it to a generic “Bilibili lyric”, it violates source attribution and can mislead users. Preserve provider attribution and show a degraded/fallback label. [VERIFIED: android/app/src/main/java/com/dazzlingwuming/listen2/BilibiliLyricProvider.java:165-168]

### Appending a late page after rotation/Back

The native bridge can cancel active requests, but page code must bind response acceptance to the same source/query/page/epoch key and ignore a terminal reply after destruction. Test it at registry/lifecycle and controller seams rather than relying on a device race. [VERIFIED: android/app/src/main/java/com/dazzlingwuming/listen2/AndroidHttpBridge.java:704-730]

### Treating a successful APK build as live-provider proof

No `adb` is on this host's PATH, and the user has deferred emulator/live-provider acceptance to Phase 8. JVM/Node fixtures prove contract behavior only; they do not demonstrate provider availability, codec support, entitlement, notification/lock-screen behavior, or device accessibility. [VERIFIED: local environment probe 2026-09-10] [VERIFIED: 05-CONTEXT.md Deferred Ideas]

## External Route Evidence and Stop Condition

No official/public provider API documentation authorizing QQ, Kugou, or Kuwo integration was live-verified in this research. That is a compliance/product uncertainty, not permission to reintroduce the original mobile transport. The A/B/C table separates that uncertainty from the technically enforceable Android boundary:

| Provider | Technically enable-eligible after fixture/schema gate | Must remain false on evidence available now | Why five live journeys remain blocked |
|---|---|---|---|
| QQ | `search`, `directory`, `detail` | `media`, `lyric`, `manualLyric`, `fallback`, `login`, `permission` | The only observed media response carries a dynamic stream base (B), and lyric explicitly depends on a Referer workaround (C). |
| Kugou | `search`, `directory`, `detail`, `lyric` | `media`, `manualLyric`, `fallback`, `login`, `permission` | The only observed media route returns an arbitrary media URL (B); the alternate desktop enrichment routes are HTTP (C). |
| Kuwo | `lyric` | `search`, `directory`, `detail`, `media`, `manualLyric`, `fallback`, `login`, `permission` | Search/detail/media all depend on a browser cookie plus opaque derived header (C). |

The planner may implement A-class operations only as narrow native routes with the listed fixture/schema gate and a clearly recorded external-route-risk decision. It may implement B/C source behavior solely via fixtures and truthful unavailable actions. This permits deterministic five-source UI, identity, queue, and lyric-contract coverage, but it blocks the claim that all five providers are live playable. A later provider-sanctioned media contract must state fixed allowed stream hosts and the MIME/container/codec/duration/expiry/entitlement behavior before it changes a B field to true; Phase 8 then supplies live-device evidence.

## Validation Architecture

### Test Framework

| Property | Value |
|---|---|
| Browser contract framework | Node scripts chained by `app/listen1_chrome_extension/package.json`. [VERIFIED: app/listen1_chrome_extension/package.json:6-8] |
| Native framework | JUnit `4.13.2` with JVM `org.json` parity dependency. [VERIFIED: android/app/build.gradle:110-115] |
| Quick focused run | `npm --prefix app/listen1_chrome_extension test`; `cd android && gradle --no-daemon :app:testDebugUnitTest` |
| Full phase gate | Required repository local CI plus APK build/signature check, once per coherent phase/review gate, not per feature. [VERIFIED: AGENTS.md Collaboration Contract] |

### Requirement → Test Map

| Requirements | Automated coverage to add/extend | Test type |
|---|---|---|
| NET-003, SRCH-001..003 | Bilibili typed search/detail/CID mapper, page epoch cancellation, bad JSON/error map tests | JS + JVM fixture |
| NET-004 | NetEase closed client mapper/resolver fixtures; five-source capability matrix where only A-class fields can become true and every B/C field remains false | JVM + JS matrix |
| PLAY-001,003..006 | Explicit resolver-factory choice, selection/queue occurrence, failure retry, checkpoint and MediaSession snapshot tests; B/C media fields prove they do not consume an occurrence or fall back to Bilibili | JVM |
| LYR-001..003 | Identity/revision/offset/manual selection/fallback attribution and accessible row-state projection tests; A-class Kugou/Kuwo lyrics prove strict mapping and C-class QQ lyric remains unavailable | JVM + JS |

### Wave 0 Gaps

- [ ] `android/app/src/test/java/com/dazzlingwuming/listen2/ProviderAdapterContractTest.java` — source-neutral fixture suite, including all terminal modes, A-class URI/schema guards, and B/C false-by-default behavior.
- [ ] `android/app/src/test/java/com/dazzlingwuming/listen2/PlaybackResolverFactoryTest.java` — proves unsupported sources do not select `BilibiliPlaybackResolver`.
- [ ] `app/listen1_chrome_extension/test/android_five_source_journey_contract.test.js` — source-labelled row/detail/capability/lifecycle behavior and safe unavailable actions.
- [ ] Focused lyric accessibility contract test — active line, translated/original mode, offset, and stale result must have observable labels; device TalkBack evidence stays Phase 8.

## Security Domain

| ASVS category | Applies | Phase-5 control |
|---|---|---|
| V2 Authentication | Yes | Do not add login/session transport; truthfully project login-required and defer account lifecycle to Phase 6. |
| V3 Session Management | Yes | Cookies/credentials remain native-only and no page-supplied header/cookie crosses RPC. [VERIFIED: android/app/src/main/java/com/dazzlingwuming/listen2/NetEaseNativeProvider.java:23-29] |
| V4 Access Control | Yes | Capability gate controls enabled actions; no entitlement/DRM/region bypass. |
| V5 Input Validation | Yes | Exact named operation/payload parsing, bounded body, identity validation and schema projection. [VERIFIED: android/app/src/main/java/com/dazzlingwuming/listen2/AndroidRpcContract.java:99-136] |
| V6 Cryptography | Yes | Reuse native credential/Keystore paths; never introduce client-side signing material. |

| Threat | STRIDE | Mitigation |
|---|---|---|
| Page injects URL/header/cookie | Tampering / elevation | No generic route; semantic native request factory only. |
| Stale reply overwrites current track/lyric | Tampering | Request epoch + lyric projection revision/identity checks. |
| Signed candidate leaks to WebView/Room | Information disclosure | Resolver candidates remain service-private; checkpoint stores semantic descriptor only. [VERIFIED: android/app/src/main/java/com/dazzlingwuming/listen2/PlaybackService.java:277-330,728-764] |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|---|---|---|
| A1 | `[ASSUMED]` A provider-sanctioned media contract may later exist for QQ/Kugou/Kuwo without credentials or entitlement bypass. | External Route Evidence | Do not enable the affected B/C media route; keep it false. |
| A2 | `[ASSUMED]` An owner accepts the external-route risk before enabling an A-class undocumented route in a product build. | Fixed Native-Route Migration Decision | Keep the field false even if its fixtures pass. |

## Open Questions

1. **Can an owner accept A-class undocumented route risk, and what provider-sanctioned media contract exists for QQ/Kugou/Kuwo?**
   - What we know: the current desktop providers reveal bounded HTTPS request shapes for the A-class operations, while B/C operations have the concrete boundary failures above. [VERIFIED: app/listen1_chrome_extension/js/provider/qq.js:340-534] [VERIFIED: app/listen1_chrome_extension/js/provider/kugou.js:61-215,308-348] [VERIFIED: app/listen1_chrome_extension/js/provider/kuwo.js:231-481]
   - What's unclear: provider terms, fixed stream hosts, supported MIME/codec, expiry, entitlement, cancellation, and rate-limit behavior.
   - Recommendation: do not let the planner promise five live journeys. It should either record an explicit risk acceptance for the A-class non-media features or retain all three external providers as fixture-only; it must retain every B/C field false until a provider-sanctioned contract exists.

2. **Should Bilibili's current attributed NetEase-catalog lyric be displayed as fallback rather than primary?**
   - What we know: its source is `netease-primary-for-bilibili`. [VERIFIED: android/app/src/main/java/com/dazzlingwuming/listen2/BilibiliLyricProvider.java:165-168]
   - Recommendation: preserve the exact attribution and label it fallback/degraded until a Bilibili-native lyric contract is approved.

## Environment Availability

| Dependency | Required by | Available | Version | Fallback |
|---|---|---:|---|---|
| Node | Shared contract tests | Yes | `v24.15.0` | — |
| npm | Shared contract tests | Yes | `11.12.1` | — |
| Gradle | JVM tests/build | Yes | `8.14.5` | CI/documented pinned environment must be recorded separately |
| adb / running emulator | Phase-8 device acceptance | No on PATH | — | Phase-5 Node/JVM fixtures only; no device claim |

## Sources

### Primary

- [Android Media3 background playback](https://developer.android.com/media/media3/session/background-playback) — service ownership, notification and resumption guidance. [CITED: https://developer.android.com/media/media3/session/background-playback]
- [AndroidX WebViewCompat reference](https://developer.android.com/reference/androidx/webkit/WebViewCompat) — origin-rule-scoped WebMessage listener. [CITED: https://developer.android.com/reference/androidx/webkit/WebViewCompat]
- [listen1_mobile v0.8.2 source](https://github.com/listen1/listen1_mobile/tree/v0.8.2) — product interaction/data-shape reference only. [CITED: https://github.com/listen1/listen1_mobile/tree/v0.8.2]

### Codebase evidence

- Android typed RPC, native providers, resolvers, playback, lyric and registry sources cited inline.
- Phase context and requirements cited inline.

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — existing dependency declarations and Android official docs.
- Architecture: HIGH — current native boundaries are directly inspected; external provider availability is intentionally not inferred.
- Provider rollout: MEDIUM — Bilibili/NetEase paths are implemented and fixture-testable, but live account/codec/provider acceptance is Phase 8.
- QQ/Kugou/Kuwo A-class route shape: MEDIUM — current desktop source proves exact HTTPS shapes, but official authorization and live behavior are unverified.
- QQ/Kugou/Kuwo B/C media and bypass-prone routes: HIGH boundary confidence — the current code directly shows the dynamic URL, HTTP, cookie/signature, or Referer dependency that keeps the field false.

**Research date:** 2026-09-10
**Valid until:** Bilibili/NetEase code findings until next branch change; external route evidence must be rechecked immediately before implementation.
