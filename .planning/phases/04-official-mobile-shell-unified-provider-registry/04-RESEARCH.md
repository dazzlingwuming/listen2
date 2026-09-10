# Phase 4: Official Mobile Shell & Unified Provider Registry - Research

**Researched:** 2026-09-10
**Domain:** Android WebView mobile shell, deterministic provider-capability registry, AngularJS presentation
**Confidence:** HIGH for repository seams and approved product contract; MEDIUM for platform guidance

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

<!-- DATA_H7qL2mVp_START -->
## Implementation Decisions

### Product reference and navigation
- Use `listen1/listen1_mobile` v0.8.2 as the product-behavior reference: a phone-first home/library area, platform discovery, search, settings, a persistent mini-player, and a focused full-player surface.
- Preserve Listen2 branding and the latest desktop feature set; do not copy the obsolete React Native 0.59 runtime, SDK 28 build, cleartext routes, or legacy native modules.
- Replace desktop-shaped panels and engineering capability notices in the primary journey with concise mobile empty, loading, unavailable, and recovery states.
- System back closes the nearest sheet/player/detail layer before leaving the current top-level destination or Activity.

### Provider registry and search entry
- Present NetEase, Kugou, Kuwo, QQ, and Bilibili through one ordered provider contract. Use the exact official mobile order `netease`, `kugou`, `kuwo`, `qq`, then append Bilibili.
- Every source exposes the same semantic surface: identity, display name, searchable state, directory/detail state, playable state, lyric state, account requirement, and a safe actionable error.
- A source may be visible before its Phase 5 live route is complete only when the UI labels the exact unavailable capability and never renders a dead control or empty-success result.
- Preserve exact source-prefixed track identity across search, playlists, queue, favorites, backup, and playback; UI code must not infer a provider from a title or URL.

### Android architecture boundary
- Retain the API 35 hardened appassets WebView, versioned typed bridge, Media3 sole playback owner, Room, SAF, Keystore, and native cache/download ownership already present.
- Shared JavaScript owns phone presentation, navigation, source selection, and normalized provider DTOs. Native Java owns privileged lifecycle, media session, secure credentials, local documents, durable native data, and bounded provider operations that cannot safely run in WebView.
- Consolidate provider dispatch behind semantic operations instead of adding another provider-specific controller branch for each source.
- Never expose arbitrary URLs, caller headers, raw cookies, signed media candidates, local paths, or generic JavaScript interfaces to make legacy provider code work.

### UX and verification cadence
- Optimize for ordinary listening actions: search, choose source, inspect result, play, open lyrics, manage queue/library. Diagnostics remain available in recoverable error detail, not as homepage content.
- Use touch targets of at least 48 dp, safe-area insets, keyboard-safe search, readable compact rows, source labels, accessible names, and reduced-motion-compatible transitions.
- During implementation, verify cohesive UI/registry changes with JavaScript/JVM contract tests. Do not assemble an APK for each small change.
- Phase 8 owns the integrated APK, API 35 emulator, performance, accessibility, and release-like acceptance pass; Phase 4 still requires deterministic tests for its shell and registry contracts.
<!-- DATA_H7qL2mVp_END -->

### the agent's Discretion

<!-- DATA_x4Nq9RbK_START -->
- Exact visual tokens, icon choices from existing assets, transition timing, and internal module split may follow established project conventions as long as the official-mobile hierarchy and the phase success criteria remain intact.
<!-- DATA_x4Nq9RbK_END -->

### Deferred Ideas (OUT OF SCOPE)

<!-- DATA_T8cZ1wQa_START -->
- Live five-source provider routes, playback, and lyric completion belong to Phase 5.
- Personal library/account/local/backup/history completion belongs to Phase 6.
- Offline media and advanced desktop-equivalent playback belong to Phase 7.
- Integrated APK, emulator, performance, accessibility, and release-like evidence belong to Phase 8.
<!-- DATA_T8cZ1wQa_END -->
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| UI-001 | Phone hierarchy and safe system Back through navigation, player, queue, lyrics, playlists, and settings. | Reuse the existing four-tab shell, mini-player and back dispatcher; normalize transient-layer ownership rather than introduce a second navigator. |
| UI-002 | Insets, IME, orientation, 200% text, contrast/reduced motion, and 48dp controls preserve usability. | Apply the approved mobile CSS contract to the one fixed-shell surface and add deterministic DOM/CSS assertions. |
| UI-003 | Android equivalents are capability controlled; no dead control, fake success, or unexplained empty list. | Render every label/action/status from one registry projection; preserve native Media3 ownership. |
| NET-001 | Typed, versioned, origin-restricted RPC with an exact allow-list. | Retain the current v2 bridge and semantic operations; registry selection must not create a URL/header/cookie path. |
| NET-002 | Cancellable bounded operations each settle once. | Define one provider-route-free lifecycle for search/directory/media/lyric/login with exact bounded request/response shapes, deadlines, cancellation, page-destroy and stale-epoch guards, exactly-once terminals, and typed unavailable for routes not implemented until Phase 5. |
| SEC-001 | Only trusted appassets main-frame current-epoch activity can cross the bridge. | Do not change the WebMessage listener/origin policy; assert unavailable sources never call it. |
| SEC-002 | WebView and provider network remain fail-closed. | No bridge fallback, cleartext route, generic interface, or provider-direct Android web route. |
| SEC-003 | Inputs and provider DTOs remain bounded, safe, and non-executable. | Registry accepts declared source IDs and bounded native capability booleans only; UI uses text binding, not HTML sinks. |
| TEST-001 | JS/JVM contracts cover registry and safe lifecycle/error branches. | Add a pure registry contract that table-tests all five semantic operation families plus the generic search UI consumer; keep focused JVM policy tests in the quick suite. |
</phase_requirements>

## Project Constraints (from AGENTS.md)

- Retain the shared frontend plus narrow native bridge. Native Java remains under `android/app/src/main/java/com/dazzlingwuming/listen2`; policy helpers stay pure Java and testable. [VERIFIED: AGENTS.md]
- Do not expose arbitrary URL, caller headers, cookies, generic JavaScript interfaces, tokens, signed media candidates, local paths, or secrets; preserve HTTPS allow-lists, bounded bodies, timeout/cancel/retry behavior, and sanitized provider failures. [VERIFIED: AGENTS.md]
- Keep AngularJS classic globals in their deliberate HTML load order; use the embedded frontend's single-quote/ESLint conventions and targeted global declarations. [VERIFIED: AGENTS.md]
- Android source uses Java 17 conventions, four-space indentation, explicit visibility, and pure package-visible policy helpers when only JVM tests consume them. Generated assets are changed only through `android/app/build.gradle`'s allow-list. [VERIFIED: AGENTS.md]
- Tests for this work are JavaScript contracts under `app/listen1_chrome_extension/test/` and Android JVM tests under `android/app/src/test/java/com/dazzlingwuming/listen2/`; an API 35 emulator is a final integration gate, not the inner loop. [VERIFIED: AGENTS.md; android/README.md:72-101]
- This research only creates the assigned planning artifact. Any later commit/push must first pass the repository-local CI gate; merge/deploy are outside the authorization. [VERIFIED: AGENTS.md]

## Summary

Phase 4 should be a presentation-and-registry consolidation, not a provider implementation project. The current shared page already contains a four-tab mobile shell, mini-player, full-player/queue layers, Android back dispatcher, typed bridge, and five visible source records; the gap is that the Android search implementation hard-codes Bilibili lifecycle state and filters the selector to NetEase/Bilibili. Consolidate those split definitions into one browser-safe, application-owned registry that projects native capability truth into the approved five-item selector. [VERIFIED: app/listen1_chrome_extension/js/app.js:11-40; app/listen1_chrome_extension/js/controller/instant_search.js:63-89]

The official `listen1/listen1_mobile` v0.8.2 reference demonstrates the desired product shape, not a reusable stack: it keeps navigation routes separate from persistent background/mini/modal player layers and dispatches to providers by an identity prefix. Its four-source array is exactly `"[netease, kugou, kuwo, qq]"`, and the client maps a two-character ID prefix to a provider. Listen2 should retain that behavioral lesson while preserving its current API-35 WebView, typed RPC, Room, and Media3 boundaries. [VERIFIED: github.com/listen1/listen1_mobile@d3046ad93d148d573d7fbb1d1fd69ec3f1d306a1:Routes.js:29-99; github.com/listen1/listen1_mobile@d3046ad93d148d573d7fbb1d1fd69ec3f1d306a1:src/api/client.js:1-28]

**Primary recommendation:** Add one pure shared `mobile_provider_registry.js` projection layer with a provider-route-free semantic lifecycle for `search`, `directory`, `media`, `lyric`, and `login`; have the Angular search shell consume it, and have existing native capability handshakes only fill its bounded fields. Every absent route terminates as typed unavailable. Do not add provider routes, bridge operations, packages, or persistence migrations in this phase. [ASSUMED]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| Phone navigation, source selector, search state, accessible copy | Browser / Client | Android host | Shared AngularJS owns presentation and deterministic state; host only delegates Back/insets. [VERIFIED: app/listen1_chrome_extension/js/controller/navigation.js:9-52; app/listen1_chrome_extension/js/controller/instant_search.js:4-89] |
| Capability truth and privileged provider operations | API / Backend (native bridge) | Browser / Client | Java only publishes a credential-free capability handoff; the page cannot enable a route itself. [VERIFIED: android/app/src/main/java/com/dazzlingwuming/listen2/provider/ProviderCapabilityFacade.java:6-69] |
| Typed RPC validation, cancellation, origin restriction | API / Backend (native bridge) | Browser / Client | The bridge owns the v2 envelope and native request registry; JS owns no transport controls. [VERIFIED: android/app/src/main/java/com/dazzlingwuming/listen2/AndroidRpcContract.java:18-36; android/app/src/main/java/com/dazzlingwuming/listen2/AndroidHttpBridge.java:43-127] |
| Background/audio notification equivalence | Android native playback service | Browser / Client | Media3 is already the sole owner; Phase 4 only routes the user to existing player layers. [VERIFIED: android/README.md:26-30] |
| Packaged static assets | CDN / Static (APK assets) | Android host | Newly added shared files enter the APK only through the explicit Gradle allow-list. [VERIFIED: android/app/build.gradle:10-39] |

## Standard Stack

### Core

| Library / Component | Version | Purpose | Why Standard |
|---------------------|---------|---------|--------------|
| Existing AngularJS classic-script UI | vendored in repository | Phone presentation, controller state, templates. | It is the existing shared UI architecture; no framework migration is authorized. [VERIFIED: app/listen1_chrome_extension/listen1.html:31-81] |
| AndroidX WebKit | `1.12.1` | `WebViewAssetLoader` and origin-scoped `WebMessageListener`. | Existing hardened bridge boundary. [VERIFIED: android/app/build.gradle:102-115] |
| Existing Media3 / Room | `1.9.4` / `2.8.4` | Native playback truth and durable data already owned outside WebView. | Preserve, do not duplicate state in the shell. [VERIFIED: android/app/build.gradle:5-6; android/app/build.gradle:102-108] |

### Supporting

| Component | Purpose | When to Use |
|-----------|---------|-------------|
| `ProviderCapabilityFacade` | Native, credential-free capability handshake for installed Bilibili/NetEase routes. | Merge its booleans into the JS registry; missing/unverified providers remain false. [VERIFIED: android/app/src/main/java/com/dazzlingwuming/listen2/provider/ProviderCapabilityFacade.java:52-117] |
| `Listen2AndroidHttpAdapter` | Versioned request handles with page epochs and cancellation. | Only for an installed semantic operation, never for selector metadata. [VERIFIED: app/listen1_chrome_extension/test/android_rpc_contract.test.js:46-115] |
| Existing Node `assert` + VM controller tests and JUnit 4 | Fast deterministic contracts. | Wave 0 / per-task validation; no new test package. [VERIFIED: app/listen1_chrome_extension/package.json:6-37; android/app/build.gradle:109-115] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Application-owned registry projection | React Native v0.8.2 implementation | The reference establishes UX only; copying its obsolete runtime, cleartext-era provider code, or unbounded client transport violates locked decisions. [VERIFIED: github.com/listen1/listen1_mobile@d3046ad93d148d573d7fbb1d1fd69ec3f1d306a1:package.json:1-85; CONTEXT.md] |
| One generic source lifecycle | Retain Bilibili-special controller and add four more branches | It would duplicate cancellation, stale-reply, accessibility, and error logic and contradict the unified-contract decision. [VERIFIED: app/listen1_chrome_extension/js/controller/instant_search.js:177-279] |

**Installation:** None. This phase installs no package and therefore requires no Package Legitimacy Audit. [ASSUMED]

## Architecture Patterns

### System Architecture Diagram

```text
User tap / IME / Android Back
        |
        v
Mobile shell (AngularJS: tab, layer, source, request epoch)
        |
        +--> MobileProviderRegistry.project() ----> selector / status card / safe copy
        |                 ^
        |                 | credential-free capability handshake
        |                 |
        |         existing typed Android bridge <---- exact origin + main frame + v2 parser
        |                 |
        |                 +----> installed semantic provider operation (Phase 5 expands)
        |
        +--> existing l1Player intent ----> native Media3 service ----> mini/full player snapshot
```

The selector may read a native capability result, but it must never turn selection into a generic network request. Existing `AndroidRpcContract` checks the exact envelope keys and rejects a mismatched protocol version before a typed operation is parsed. [VERIFIED: android/app/src/main/java/com/dazzlingwuming/listen2/AndroidRpcContract.java:99-136]

### Recommended Project Structure

```text
app/listen1_chrome_extension/
├── js/mobile_provider_registry.js       # source metadata, projection, and route-free semantic lifecycle [ASSUMED]
├── js/loweb.js                          # bridge/capability adapter consumes registry [ASSUMED]
├── js/controller/instant_search.js      # generic source/query/page/epoch lifecycle [ASSUMED]
├── js/controller/navigation.js          # top-level and nearest-layer Back coordination [ASSUMED]
├── listen1.html                         # semantic mobile shell/selector/state surface [ASSUMED]
├── css/redesign.css                     # approved responsive/mobile styling [ASSUMED]
└── test/mobile_provider_registry.test.js # registry/identity + five-operation lifecycle contract [ASSUMED]
```

### Pattern 1: Immutable registry projection

**What:** Define all source identity/display/order/primary visibility/capability labels in one pure script. Project only the native handshake's recognized boolean fields into a frozen UI record; default every absent source/field to unavailable with a product-safe reason. Phase 4 primary list is NetEase, Kugou, Kuwo, QQ, Bilibili; Migu/Taihe are registry-only unavailable. [VERIFIED: 04-UI-SPEC.md]

**When to use:** Selector rendering, source label on rows/snapshots, action enablement, account route affordance, empty/unavailable/retry copy, and generic search dispatch. Do not derive source from title, artwork URL, or request URL. [VERIFIED: 04-CONTEXT.md]

**Compatibility invariant:** Existing provider records already carry an explicit source together with source-prefixed IDs. The repository's source-of-truth examples are:

<!-- DATA_J6pQ8wLm_START -->
`id: \`netrack_${song_info.id}\`, ... source: 'netease'`; `id: \`qqtrack_${song.songmid}\`, ... source: 'qq'`; `id: \`kgtrack_${song.FileHash}\`, ... source: 'kugou'`; `id: \`kwtrack_${song_id}\`, ... source: 'kuwo'`; `id: \`bitrack_v_${song_info.bvid}\`, ... source: 'bilibili'`.
<!-- DATA_J6pQ8wLm_END -->

These values are quoted verbatim from [VERIFIED: app/listen1_chrome_extension/js/provider/netease.js:514-524; app/listen1_chrome_extension/js/provider/qq.js:103-114; app/listen1_chrome_extension/js/provider/kugou.js:4-14; app/listen1_chrome_extension/js/provider/kuwo.js:100-110; app/listen1_chrome_extension/js/provider/bilibili.js:2035-2043]. Preserve them; do not rewrite existing Room/playlist/queue identities in Phase 4.

### Pattern 2: One route-free semantic operation identity and one terminal settlement

**What:** Admit exactly `search`, `directory`, `media`, `lyric`, and `login`; represent work by `{operation, sourceId, requestId, pageEpoch, deadlineAt, payload}` and centralize `start`, `cancel`, `timeout`, `settle`, `leave`, and `destroy`. Use exact-key operation-specific request/response validators and the existing ceilings for request ID, page epoch, deadline, keyword/page, result rows, semantic text, and lyric content. Increment the epoch before each source switch, query edit/submission, cancel, navigation away, or renderer teardown. A reply updates state only when operation/source/request/pageEpoch all match and the request has not already reached its one terminal. A missing installed route returns typed `unavailable` before dispatch. [VERIFIED: 04-UI-SPEC.md; app/listen1_chrome_extension/js/lowebutil.js:145-160; android/app/src/main/java/com/dazzlingwuming/listen2/AndroidRpcContract.java:24-34]

**When to use:** Table-test the route-free contract for all five semantic operation families in Phase 4, and bind the visible shell only to the existing search seam. Keep Bilibili part-detail code as an existing child-layer behavior and preserve current player/queue ownership; Phase 5 adds missing live provider routes. [ASSUMED]

**Example:**

```javascript
// [ASSUMED] Pure browser-safe shape; implementation must keep legacy callbacks compatible.
function acceptReply(active, reply) {
  return active.epoch === reply.epoch
    && active.sourceId === reply.sourceId
    && active.query === reply.query
    && active.page === reply.page;
}
```

The current Bilibili-only controller already has the correct essential guard: it refuses settlement unless its stored `epoch`, `query`, and `page` match and state remains loading. Lift that guard into the route-free operation lifecycle rather than copy/pasting it per provider. Stale and duplicate callbacks are ignored after the active request has already reached its single typed terminal; they do not create a second terminal. [VERIFIED: app/listen1_chrome_extension/js/controller/instant_search.js:113-143]

### Pattern 3: Nearest-layer Back delegation

**What:** Keep the existing Android host handoff, then make the shared shell consume Back in priority order: IME, confirmation, queue/lyrics sheet, full player, source/detail sheet, real child route, Activity. Back must cancel the active request when it closes the owning layer. [VERIFIED: 04-UI-SPEC.md]

**When to use:** Never add Android's own parallel router. `MainActivity` already invokes `window.Listen2AndroidPlaybackBack`, while navigation broadcasts playback/search/transient-overlay events. Extend those handlers as the one coordinator. [VERIFIED: android/app/src/main/java/com/dazzlingwuming/listen2/MainActivity.java:586-615; app/listen1_chrome_extension/js/controller/navigation.js:781-823]

### Component Responsibilities / Exact Change Map

| File | Change ownership in Phase 4 | Must preserve |
|------|-----------------------------|---------------|
| `app/listen1_chrome_extension/js/mobile_provider_registry.js` (new) | Own ordered source descriptors, primary/registry-only visibility, safe capability projection, source labels/reasons, identity validation, and the provider-route-free search/directory/media/lyric/login lifecycle. | No provider instance, URL, header, cookie, raw error, native object reference, or new live route. [ASSUMED] |
| `app/listen1_chrome_extension/js/app.js` | Replace the duplicated `sourceList` declaration with the registry's compatible selector list. | Desktop may still expose its existing full source behavior; no renamed IDs. [VERIFIED: app/listen1_chrome_extension/js/app.js:11-40] |
| `app/listen1_chrome_extension/js/loweb.js` | Replace hard-coded Android-unverified/source lists with registry-driven projection and semantic dispatch guards. | Existing provider instances and bridge capability handshake. [VERIFIED: app/listen1_chrome_extension/js/loweb.js:7-105; app/listen1_chrome_extension/js/loweb.js:148-215] |
| `app/listen1_chrome_extension/js/controller/instant_search.js` | Replace Bilibili-special shell state with generic search state; retain Bilibili part detail only as a child layer. | Cancellable handle compatibility and stale-reply rejection. [VERIFIED: app/listen1_chrome_extension/js/controller/instant_search.js:15-56; app/listen1_chrome_extension/js/controller/instant_search.js:192-279] |
| `app/listen1_chrome_extension/js/controller/navigation.js` | Make primary-tabs/layers/account recovery derive from the shell model; retain existing Back bridge events. | No direct privileged action or generic `window.open` route. [VERIFIED: app/listen1_chrome_extension/js/controller/navigation.js:39-54; app/listen1_chrome_extension/js/controller/navigation.js:781-823] |
| `app/listen1_chrome_extension/listen1.html` + `css/redesign.css` | Replace Bilibili-only mobile-search markup and engineering status language with the approved `MobileAppShell`, five-tab selector, and one state surface. | Existing script order, semantic landmarks, mini-player/full-player/queue markup. [VERIFIED: app/listen1_chrome_extension/listen1.html:45-81; app/listen1_chrome_extension/listen1.html:4563-4760; app/listen1_chrome_extension/listen1.html:9296-9349] |
| `android/app/build.gradle` | Allow-list the new shared registry script if one is added. | Never manually copy generated assets. [VERIFIED: android/app/build.gradle:10-39] |
| `android/app/src/main/java/com/dazzlingwuming/listen2/provider/ProviderCapabilityFacade.java` | Normally unchanged: it remains native truth only for installed routes. Extend only if a bounded, non-transport capability envelope needs an explicit contract test. | `bilibili`/`netease` truth must not become page-controlled. [VERIFIED: android/app/src/main/java/com/dazzlingwuming/listen2/provider/ProviderCapabilityFacade.java:52-117] |

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Provider network transport | JS URL/header/cookie proxy or a new generic bridge | Existing typed Android RPC + semantic operation guards | The existing bridge verifies origin, main-frame source, envelope, deadlines and cancellation. [VERIFIED: android/app/src/main/java/com/dazzlingwuming/listen2/HttpBridgePolicy.java:156-161; android/app/src/main/java/com/dazzlingwuming/listen2/AndroidHttpBridge.java:116-136] |
| Capability truth | Per-controller boolean switches | Native handshake merged into one pure registry projection | The existing facade makes a capability true only for an installed route. [VERIFIED: android/app/src/main/java/com/dazzlingwuming/listen2/provider/ProviderCapabilityFacade.java:6-10] |
| Persistent playback state | WebView/localStorage player clone | Existing native Media3 owner and snapshots | WebView lifetime is not playback truth. [VERIFIED: android/README.md:26-30] |
| Insets/accessibility abstractions | A new UI framework | Existing semantic HTML/CSS plus Android host insets | This keeps the shared frontend architecture and avoids an unauthorized framework migration. [VERIFIED: app/listen1_chrome_extension/listen1.html:31-81; AGENTS.md] |

**Key insight:** Phase 4's complexity is consistency, not transport. A pure registry and one lifecycle model remove provider-specific UI forks without broadening the native attack surface. [ASSUMED]

## Common Pitfalls

### Pitfall 1: Expanding the selector by duplicating provider branches
**What goes wrong:** QQ/Kugou/Kuwo become visible only after adding ad hoc controller conditions; unavailable paths then either call legacy web transport or resemble an empty successful search. [VERIFIED: app/listen1_chrome_extension/js/controller/instant_search.js:67-71; app/listen1_chrome_extension/js/loweb.js:160-210]

**How to avoid:** The selector must render descriptor records, and only the centralized dispatcher decides whether an installed semantic operation can begin. Missing capability yields the exact registry reason and a recovery action, with no request handle created. [ASSUMED]

### Pitfall 2: Treating old results as safe fallback for a different query/source
**What goes wrong:** The current Bilibili path intentionally preserves prior rows after a failed retry; reused after a source/query switch, that behavior can label stale rows as another source. [VERIFIED: app/listen1_chrome_extension/js/controller/instant_search.js:205-214; app/listen1_chrome_extension/js/controller/instant_search.js:230-263]

**How to avoid:** Retain rows only if the full request identity matches; clear rows immediately for a new source or query, show four source-labelled skeleton rows, and ignore terminal late replies. [VERIFIED: 04-UI-SPEC.md]

### Pitfall 3: Leaking bridge/provider errors into product copy
**What goes wrong:** Native error codes, URLs, signed candidates, cookies, or raw exceptions become labels or ARIA descriptions. The current low-level unavailable facade carries an English engineering message, so it must not be rendered as product copy. [VERIFIED: app/listen1_chrome_extension/js/loweb.js:251-299]

**How to avoid:** Registry maps recognized state/capability to Chinese product-level text; controllers retain only a safe status/category. Bind untrusted result metadata as text, never HTML. [VERIFIED: 04-UI-SPEC.md]

### Pitfall 4: Adding a script but omitting it from Android assets
**What goes wrong:** desktop/browser tests pass but the packaged WebView cannot load the new registry. [VERIFIED: android/app/build.gradle:10-39]

**How to avoid:** Add the exact new file to `syncListen1Assets`; test the task's output or final APK asset list only at the integration gate. [ASSUMED]

### Pitfall 5: Replacing the native bridge to simplify the UI
**What goes wrong:** A generic JavaScript interface or relaxed allowed-origin rule defeats source/main-frame policy. AndroidX documents that the listener is injected for frames matching `allowedOriginRules`; retain the exact appassets rule and feature check. [CITED: https://developer.android.com/reference/androidx/webkit/WebViewCompat]

**How to avoid:** Keep the installed `WebMessageListener`, v2 envelope, and `HttpBridgePolicy`; this phase does not add an operation. [VERIFIED: android/app/src/main/java/com/dazzlingwuming/listen2/AndroidHttpBridge.java:43-127; android/app/src/main/java/com/dazzlingwuming/listen2/AndroidRpcContract.java:99-136]

## Code Examples

### Capability-safe search dispatch

```javascript
// [ASSUMED] Pure UI orchestration: selection does not construct transport input.
const selected = MobileProviderRegistry.project(sourceId, nativeCapabilities);
if (!selected.search.available) {
  return showProviderState(selected.search.reason);
}
return MediaService.search(selected.sourceId, requestIdentity);
```

The first real implementation must preserve the adapter's typed envelope rather than adding fields. Its accepted request shape is exactly:

<!-- DATA_V3mR7kDf_START -->
`"version", "operation", "requestId", "pageEpoch", "payload"`.
<!-- DATA_V3mR7kDf_END -->

[VERIFIED: android/app/src/main/java/com/dazzlingwuming/listen2/AndroidRpcContract.java:99-132; app/listen1_chrome_extension/test/android_rpc_contract.test.js:56-69]

### Safe shell layout rule

Use the UI-SPEC's fixed header/scroll region/mini-player/tab bar layout with CSS safe-area variables and a single source selector `tablist`; do not introduce a second native navigation surface. Android API-35 target apps are edge-to-edge, so important controls must be offset from system/gesture/IME insets; Android accessibility guidance recommends at least 48dp by 48dp interactive targets. [CITED: https://developer.android.com/develop/ui/views/layout/insets; https://developer.android.com/guide/topics/ui/accessibility/views/apps-views]

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| Original mobile app's React Native route tree and prefix map | Current shared AngularJS shell with API-35 WebView + typed native bridge | Reuse product behavior, not old mobile runtime/network code. [VERIFIED: github.com/listen1/listen1_mobile@d3046ad93d148d573d7fbb1d1fd69ec3f1d306a1:Routes.js:29-99; app/listen1_chrome_extension/listen1.html:31-81] |
| Bilibili-specific Android search lifecycle + hard-coded two-source filter | One registry-backed generic lifecycle | Required to make all five primary selector states deterministic before Phase 5 routes. [VERIFIED: app/listen1_chrome_extension/js/controller/instant_search.js:63-89] |
| Desktop sidebar/panel affordances | Fixed Android phone shell with native notification/media controls | Matches locked Android-equivalent UX without pretending the desktop windows exist. [VERIFIED: 04-CONTEXT.md; android/README.md:26-30] |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | A new `mobile_provider_registry.js` is the smallest safe module split. | Architecture Patterns | Planner may choose a different pure existing-module location, but must retain one ownership point. |
| A2 | Phase 4 can leave `ProviderCapabilityFacade` unchanged because JS defaults absent providers to unavailable. | Exact Change Map | If Java needs a new bounded envelope shape, add a JVM contract before changing it. |
| A3 | New test filenames can be `mobile_provider_registry.test.js` and a generic shell lifecycle contract. | Validation Architecture | Names may vary, but the behavioral coverage is required. |

## Open Questions (RESOLVED)

1. **Desktop source visibility versus Android primary sources — binding resolution (04-01):** Preserve the existing desktop compatibility selector/view and provider instances in their current order. Android renders only `MobileProviderRegistry.primarySources` in the resolved order `netease`, `kugou`, `kuwo`, `qq`, `bilibili`; Migu/Taihe remain registry-only records and no provider definition is deleted. [VERIFIED: app/listen1_chrome_extension/js/app.js:11-40; 04-UI-SPEC.md; orchestrator source-order resolution]

2. **Player/queue shell treatment versus playback ownership — binding resolution (04-02/04-03):** Reuse and mobile-adapt the existing mini-player, full-player, lyrics, and queue layers through semantic HTML/CSS and nearest-layer Back behavior. Do not replace or move playback truth: Media3 remains the sole native playback owner, the shell consumes its existing snapshots/intents, and device acceptance remains the locked Phase 8 gate. [VERIFIED: app/listen1_chrome_extension/listen1.html:9296-9349; app/listen1_chrome_extension/test/mobile_ui_contract.test.js:47-170; android/README.md:26-30]

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node/npm | Frontend contract tests | ✓ | Node `v24.15.0`, npm `11.12.1` | — [VERIFIED: local command probe 2026-09-10] |
| Gradle | Android JVM tests / eventual asset integration | ✓, but not project-pinned | `8.14.5`; repository documents `8.10.2` | Use the documented CI-compatible Gradle 8.10.2 for release evidence. [VERIFIED: local command probe 2026-09-10; android/README.md:72-86] |
| JDK | Android JVM tests | Available to Gradle, but host launcher is JDK `21.0.12.1`; repository requires 17 | Version mismatch | Set JDK 17 before final Android validation. [VERIFIED: local command probe 2026-09-10; android/README.md:72-75] |
| Android API 35 emulator / adb | Phase 8 device acceptance, not Phase 4 inner loop | Not verified in this session | — | Deterministic Node/JVM contracts now; record API-35 evidence later. [VERIFIED: android/README.md:74-101] |

**Missing dependencies with no fallback:** None for Phase 4 deterministic planning/tests.
**Missing dependencies with fallback:** A project-pinned JDK 17/Gradle 8.10.2 environment is needed before release-like Android validation; it is not needed to plan the pure shell registry work.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Frontend framework | Node built-in `assert` plus VM-loaded Angular controller contracts. [VERIFIED: app/listen1_chrome_extension/test/android_mobile_bilibili_ui.test.js:1-56] |
| Android framework | JUnit 4.13.2 / Gradle `:app:testDebugUnitTest`. [VERIFIED: android/app/build.gradle:109-115; android/README.md:78-85] |
| Quick run command | `cd app/listen1_chrome_extension && node test/mobile_provider_registry.test.js && node test/android_mobile_shell_registry.test.js` [ASSUMED: the registry test includes the five-operation lifecycle table; add both commands to the package test script once created] |
| Full suite command | `cd app/listen1_chrome_extension && npm test && cd ../../android && gradle --no-daemon :app:testDebugUnitTest` [VERIFIED: app/listen1_chrome_extension/package.json:6-8; android/README.md:78-85] |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| UI-001 | Four tabs, layer-priority Back, mini/full player and library route preservation | Node contract | `node test/mobile_ui_contract.test.js` plus new shell registry test | Existing + Wave 0 |
| UI-002 | Five source tabs at 320px/200% type, safe reserved area, 48dp, reduced motion | DOM/CSS contract | new shell registry test | Wave 0 |
| UI-003 | Action/status/copy comes from projection and unsupported action is absent | Pure registry + DOM contract | `node test/mobile_provider_registry.test.js` | Wave 0 |
| NET-001 / SEC-001 / SEC-002 | Exact trusted origin/main frame and typed envelope remain unbroadened | JVM + Node bridge contract | `gradle --no-daemon :app:testDebugUnitTest --tests '*HttpBridgePolicyTest' --tests '*AndroidRpcContractTest'` and `node test/android_rpc_contract.test.js` | Existing |
| NET-002 | Search/directory/media/lyric/login use bounded exact request/response shapes; absent routes terminate typed unavailable; deadline/cancel/destroy/stale/duplicate/late paths accept one terminal | Pure table-driven lifecycle + VM search-consumer contract | `node test/mobile_provider_registry.test.js && node test/android_mobile_shell_registry.test.js` | Wave 0 |
| SEC-003 | Unknown source/capability/error cannot reach HTML/bridge/transport | Pure registry + existing policy tests | new registry test plus JVM policy tests | Wave 0 + Existing |
| TEST-001 | Registry plus representative safe error/race paths remain executable in CI | Full frontend/JVM suite | full suite command above | Existing infrastructure + Wave 0 |

### Sampling Rate

- **Per task commit:** focused Node contracts for the changed registry/controller/markup; if Java changes, targeted JVM policy test.
- **Per wave merge:** frontend `npm test` and Android `:app:testDebugUnitTest`.
- **Phase gate:** Full suite green; Phase 8, not Phase 4, owns API-35 emulator/installation evidence. [VERIFIED: 04-CONTEXT.md; android/README.md:88-101]

### Wave 0 Gaps

- [ ] `app/listen1_chrome_extension/test/mobile_provider_registry.test.js` — exact primary order, registry-only entries, safe projection, source-prefixed identity, and provider-route-free search/directory/media/lyric/login lifecycle with bounded shapes, typed unavailable, deadline/cancel/destroy/stale/duplicate/late exactly-once coverage and no dynamic URL/transport fields.
- [ ] `app/listen1_chrome_extension/test/android_mobile_shell_registry.test.js` — selector/order/ARIA/copy, source switch and epoch lifecycle, cancel/timeout/late reply, Back cancellation, safe-area/mobile CSS contract.
- [ ] Extend `app/listen1_chrome_extension/package.json` test script so both new Node contracts run in CI. [VERIFIED: app/listen1_chrome_extension/package.json:6-8]

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | Yes | Registry may only show account recovery when native capability says login is installed; no fake sign-in. [VERIFIED: 04-UI-SPEC.md] |
| V3 Session Management | Yes | Keep cookies/refresh state native; registry consumes status only. [VERIFIED: android/README.md:43-46] |
| V4 Access Control | Yes | Exact trusted appassets main-frame bridge and native capability truth. [VERIFIED: android/app/src/main/java/com/dazzlingwuming/listen2/HttpBridgePolicy.java:156-161] |
| V5 Input Validation | Yes | Existing v2 parser rejects unknown field/envelope/payload shapes; new registry validates source IDs and recognized booleans only. [VERIFIED: android/app/src/main/java/com/dazzlingwuming/listen2/AndroidRpcContract.java:99-136] |
| V6 Cryptography | No new crypto | Keep Keystore/credential paths out of this phase; do not hand-roll crypto. [VERIFIED: android/README.md:43-50] |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Untrusted frame invokes privileged bridge | Elevation of privilege | Exact appassets origin plus main-frame source check; do not broaden listener rules. [VERIFIED: android/app/src/main/java/com/dazzlingwuming/listen2/HttpBridgePolicy.java:156-161] |
| Selector creates arbitrary provider request | Tampering / SSRF-like outbound control | Registry permits semantic source/action only; bridge owns fixed HTTPS host/path/query allow-list. [VERIFIED: android/app/src/main/java/com/dazzlingwuming/listen2/HttpBridgePolicy.java:41-85] |
| Late response overwrites another source/query | Integrity | Full request identity plus exactly-once terminal state. [VERIFIED: app/listen1_chrome_extension/js/controller/instant_search.js:113-143] |
| Provider metadata becomes executable UI | Elevation of privilege / XSS | Text binding and no `ng-bind-html` for provider DTO fields; test strings remain non-executable. [VERIFIED: app/listen1_chrome_extension/test/android_mobile_bilibili_ui.test.js:279-300] |
| Raw errors disclose data | Information disclosure | Map to registry-safe capability/recovery copy; never bind URL/cookie/header/request ID/error text. [VERIFIED: 04-UI-SPEC.md] |

## Sources

### Primary (HIGH confidence)

- Official mobile repository tag `listen1/listen1_mobile` v0.8.2 at `d3046ad93d148d573d7fbb1d1fd69ec3f1d306a1` — navigation, persistent player layers, client provider dispatch, and source-prefixed identities inspected locally.
- Current Listen2 source — Angular shell/controller seams, Gradle asset allow-list, typed RPC, origin policy, provider facade, and existing contract tests read in this session.
- `04-CONTEXT.md` and `04-UI-SPEC.md` — locked scope, source order, state/copy/accessibility contracts.

### Secondary (MEDIUM confidence)

- [AndroidX `WebViewCompat` API reference](https://developer.android.com/reference/androidx/webkit/WebViewCompat) — origin-rule listener behavior and feature support. [CITED]
- [Android window-insets guidance](https://developer.android.com/develop/ui/views/layout/insets) and [Android accessibility Views guidance](https://developer.android.com/guide/topics/ui/accessibility/views/apps-views) — API-35 edge-to-edge and 48dp touch target guidance. [CITED]

### Tertiary (LOW confidence)

- None. Context7 was unavailable in this session; official Android documentation was used through verified web fallback.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — existing dependencies and boundary code were opened this session.
- Architecture: HIGH — direct comparison of the official v0.8.2 source and current application seams.
- Pitfalls: HIGH — identified from current Bilibili-only lifecycle and bridge policy; platform layout guidance is MEDIUM.

**Research date:** 2026-09-10
**Valid until:** 2026-10-10 for repository seams; recheck AndroidX guidance before an AndroidX upgrade.
