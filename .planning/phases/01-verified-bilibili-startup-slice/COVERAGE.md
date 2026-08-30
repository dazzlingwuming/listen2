# API Coverage — Bilibili Android Startup Slice

> Full coverage is the default. Every capability not integrated in Phase 1 is an explicit, reasoned opt-out tied to the approved roadmap or to a permanent product/security boundary. The matrix is the complete Bilibili surface considered for the Android music-player integration; it does not claim the Phase-1 subset is the entire Bilibili API.

| capability | decision | reason |
|---|---|---|
| anonymous-fingerprint-bootstrap | INTEGRATE | |
| video-search | INTEGRATE | |
| video-detail-and-pages | INTEGRATE | |
| selected-part-identity | INTEGRATE | |
| public-audio-manifest | INTEGRATE | |
| ordered-audio-cdn-candidates | INTEGRATE | |
| provider-status-and-entitlement-errors | INTEGRATE | |
| bounded-cancel-and-timeout | INTEGRATE | |
| primary-lyrics-entry-state | INTEGRATE | |
| subtitle-and-lyric-source-resolution | OPT-OUT | Phase 3 owns synchronized, manual, translated, and accessible lyric resolution; Phase 1 only proves truthful entry state. |
| qr-login-and-session-refresh | OPT-OUT | Phase 5 owns persistent Bilibili authentication, refresh, expiry, and logout cleanup. |
| authenticated-quality-selection | OPT-OUT | Phase 5 establishes session authority and Phase 9 proves advanced rendition selection. |
| user-space-and-channel-catalog | OPT-OUT | Phase 7 exposes additional catalog capabilities only after route, fixture, entitlement, and device evidence pass. |
| legacy-audio-menu-catalog | OPT-OUT | Phase 7 evaluates this separate Bilibili surface; it is not required by the Phase-1 video-part journey. |
| remote-home-recommendations | OPT-OUT | Phase 1 is local-first and may not delay the shell; provider expansion is evidence-gated in Phase 7. |
| favorites-watch-later-and-history | OPT-OUT | Library and favorites are Phase 4, listening history is Phase 6, and remote account state depends on Phase 5. |
| comments-danmaku-and-social-actions | OPT-OUT | Listen2 is a music player and the approved parity requirements contain no social-authoring capability. |
| upload-and-creator-management | OPT-OUT | Creator publishing is outside the approved Listen2 playback and library product boundary. |
| video-mv-streaming | OPT-OUT | Phase 9 owns MV, video rendition, fullscreen, and picture-in-picture evidence. |
| cache-download-and-offline-media | OPT-OUT | Phase 8 owns cache indexes, downloads, integrity, entitlement, quota, repair, and offline playback. |
| arbitrary-provider-url-relay | OPT-OUT | Permanently forbidden by D-01, NET-001, and SEC-003; native accepts closed typed operations only. |
| caller-controlled-method-header-cookie | OPT-OUT | Permanently forbidden at the page boundary; native alone constructs requests and session handling remains Phase 5. |
| raw-media-proxy | OPT-OUT | Permanently forbidden by NET-001; the page receives only validated bounded playback descriptors. |
| paid-drm-region-or-membership-bypass | OPT-OUT | Permanently forbidden by project compliance constraints; unavailable entitlement must fail truthfully. |

## Integrated Operation Contract

| Operation | Native route ownership | Typed request | Safe result | Evidence |
|---|---|---|---|---|
| `bilibili.search` | Exact search path and fixed query/header construction | bounded keyword, page, fixed page size, request identity | labelled bounded result rows and paging state | JS contract, JVM policy, live search/cancel/resubmit |
| `bilibili.video.detail` | Exact `/x/web-interface/view` route | validated BVID and request identity | sanitized video identity and bounded ordered pages | detail fixture, exact CID tests, live part selector |
| `bilibili.audio.manifest` | Exact public playurl route | BVID, explicit/default selection mode, CID rules | validated MIME/codec/duration/expiry and ordered HTTPS candidates | schema fixtures, incompatible-codec case, live progress |
| `rpc.cancel` | No provider route; native request registry only | target `(pageEpoch, requestId)` | one `cancelled` terminal settlement for the target | queued/running/destroy/duplicate fixtures and runtime smoke |

## Explicitly Unresolved Execution Assumptions

| ID | Assumption | Status | Required disposition |
|---|---|---|---|
| AVD-01 | A supported API-35 AVD image and a compatible WebView provider are available at execution time. | unresolved and flagged | The smoke harness records image, ABI, API, WebView version, and commands; absence blocks Phase 1 rather than substituting fixtures. |
| LIVE-01 | At least one public anonymous Bilibili item remains playable through the current provider/CDN/codec combination. | unresolved and flagged | Select and record a non-sensitive BVID/CID at smoke time; provider unavailability is recorded as an external blocker without signed URLs. |

## Spec-less Edge Disposition

All 14 probe items are preserved below. The four unclassified rows were manually classified using D-01–D-16 and the approved UI contract; no item was auto-dismissed.

| Probe item | Disposition | Plan evidence |
|---|---|---|
| NET-001 adjacency | explicit | 01-01 and 01-02 accept exact host/path/query values and reject adjacent suffix/path/query values. |
| NET-001 empty | explicit | 01-01 rejects missing, null, empty, wrong-type, and unknown envelope fields before dispatch. |
| NET-001 ordering | backstop | 01-01 carries a structured `verification: backstop` truth because equal-result ordering is not specified. |
| NET-001 concurrency | explicit | 01-02 proves stale/duplicate replies cannot mutate state and every request settles once. |
| NET-002 unclassified | manually classified: terminal lifecycle | 01-02 proves queued/running cancel, timeout distinction, teardown, retry bound, and exactly-once settlement. |
| NET-003 unclassified | manually classified: authorization and device observability | 01-03, 01-06, and 01-07 prove exact part, permitted descriptor, AudioFlinger/UI progress, pause/resume, and lyric entry. |
| SRCH-001 concurrency | explicit | 01-01 and 01-04 prove newest query authority under submit/cancel/resubmit and late replies. |
| SRCH-002 unclassified | manually classified: identity and cursor preservation | 01-03 and 01-04 prove exact BVID/CID, rotation/back/re-entry cursor preservation, and no duplicate append. |
| SRCH-003 unclassified | manually classified: partial/hostile provider data | 01-03 and 01-04 prove labelled partial rows, neutral covers, safe error copy, and preservation of valid results. |
| SEC-001 concurrency | explicit | 01-02 and 01-05 reject cross-origin, iframe, duplicate, and old-epoch messages without state mutation. |
| SEC-002 concurrency | backstop | 01-05 carries a structured backstop because the secure WebView configuration has no defined parallel ordering. |
| SEC-003 adjacency | explicit | 01-01 through 01-03 reject adjacent unknown operation, enum, length, URL-host, and MIME/codec values. |
| SEC-003 empty | backstop | 01-03 carries a structured backstop for unspecified empty/null provider-field semantics while required fields fail closed. |
| SEC-003 ordering | backstop | 01-03 carries a structured backstop for equal provider-item order while ordered CDN candidates remain explicit. |

## Descriptor-less Prohibition Recall

The kept product-specific prohibitions are projected into the relevant plans as `status: unverified`, `flagged: true`, with no `check_*` descriptor. They therefore remain fail-closed and can never become a silent green result.

| ID | Kept bespoke must-NOT | Owner plan |
|---|---|---|
| PROH-01 | The typed boundary must not silently become a general-purpose network, header, cookie, or media proxy. | 01-01 |
| PROH-02 | A selected Bilibili part must not be replaced by a different page or used to claim permission the user lacks. | 01-03 |
| PROH-03 | Unverified provider, login, background, or lyric capabilities must not be presented as working or as empty success. | 01-04 |
| PROH-04 | Startup must not probe unsupported accounts, erase local/successful content, or hold the phone shell behind remote work. | 01-04 |
| PROH-05 | Descriptor creation or a Howler object must not be reported as playback success before real forward progress is observed. | 01-06 |
| PROH-06 | Lyric loading or failure must not stop otherwise valid foreground audio or substitute another track's state. | 01-06 |

Canon breadcrumbs, not minted prohibitions: unsafe navigation, cleartext, injection/prototype pollution, credential leakage, and generic data-retention controls are owned directly by SEC-001/002/003, the plan threat registers, static/runtime tests, and the later `$gsd-secure-phase` audit.

## Multi-Source Coverage Audit

| Source | ID | Feature or constraint | Plan | Status |
|---|---|---|---|---|
| GOAL | — | API-35 local home through current Bilibili search, exact selected part, audible progress, and primary lyric entry via typed cancellation | 01-01 through 01-07 | COVERED |
| REQ | NET-001 | versioned typed trusted-origin RPC and precise native route ownership | 01-01, 01-02, 01-05 | COVERED |
| REQ | NET-002 | bounded deadline, retry, real cancellation, teardown, stale drop, and unique terminal result | 01-02, 01-04, 01-06 | COVERED |
| REQ | NET-003 | authorized Bilibili closed loop with schema, CID, MIME, permission, expiry, recovery, and live evidence | 01-03, 01-06, 01-07 | COVERED |
| REQ | SRCH-001 | query/page/request identity, cancel/resubmit, and current-result authority | 01-01, 01-04, 01-07 | COVERED |
| REQ | SRCH-002 | detail/pages/part/cursor behavior with no duplicate append | 01-03, 01-04, 01-07 | COVERED |
| REQ | SRCH-003 | complete source-labelled result states and actionable partial/error behavior | 01-03, 01-04, 01-07 | COVERED |
| REQ | SEC-001 | exact appassets main-frame/current-epoch bridge and safe navigation | 01-02, 01-05, 01-07 | COVERED |
| REQ | SEC-002 | hardened debug/release-like WebView, HTTPS provider network, secret-free external navigation | 01-05, 01-07 | COVERED |
| REQ | SEC-003 | closed operation/payload/schema/size/MIME/URL/sink validation | 01-01 through 01-05 | COVERED |
| RESEARCH | R-01 | evolve one WebMessage listener; do not add another bridge or framework | 01-01, 01-02 | COVERED |
| RESEARCH | R-02 | pure-Java policy and lifecycle helpers with JUnit coverage | 01-01, 01-02 | COVERED |
| RESEARCH | R-03 | native-owned URLs/headers, HTTPS, no redirects, bounded body, finite retry | 01-01, 01-02 | COVERED |
| RESEARCH | R-04 | selected CID and minimized descriptor validated before crossing the boundary | 01-02, 01-03 | COVERED |
| RESEARCH | R-05 | local-first finalization and safe error mapping in Angular | 01-04 | COVERED |
| RESEARCH | R-06 | existing Howler only, finite current-track candidates, real progress proof | 01-06, 01-07 | COVERED |
| RESEARCH | R-07 | deterministic fixtures plus non-substitutable API-35 smoke | 01-01, 01-02, 01-07 | COVERED |
| CONTEXT | D-01 | operation-based protocol with native route/header construction | 01-01, 01-02, 01-03 | COVERED |
| CONTEXT | D-02 | bounded request identity, page epoch, matched terminal response, stale drop | 01-01, 01-02, 01-04 | COVERED |
| CONTEXT | D-03 | explicit queued/running/teardown cancellation and distinct timeout | 01-02, 01-04, 01-06 | COVERED |
| CONTEXT | D-04 | retain legacy search compatibility without new routes or broader host policy | 01-01, 01-03 | COVERED |
| CONTEXT | D-05 | anonymous public playback with in-memory fingerprint only | 01-02, 01-03, 01-07 | COVERED |
| CONTEXT | D-06 | default first page only for unqualified BVID; exact explicit CID otherwise | 01-02, 01-03, 01-04 | COVERED |
| CONTEXT | D-07 | validate status, identity, duration, MIME/codec, candidates, expiry, and safe fields | 01-02, 01-03 | COVERED |
| CONTEXT | D-08 | existing foreground Howler only; no competing native player | 01-06 | COVERED |
| CONTEXT | D-09 | progress beyond zero, pause/resume, finite epoch-bound recovery | 01-06, 01-07 | COVERED |
| CONTEXT | D-10 | truthful primary lyric entry without delaying audio | 01-06, 01-07 | COVERED |
| CONTEXT | D-11 | local shell first, bounded remote finalization, no permanent Gathering | 01-04, 01-07 | COVERED |
| CONTEXT | D-12 | no unsupported unsolicited startup auth probes | 01-04, 01-07 | COVERED |
| CONTEXT | D-13 | stable safe error states, one retry, preserve valid results, no raw secrets | 01-03, 01-04, 01-06 | COVERED |
| CONTEXT | D-14 | bounded deterministic success/race/error fixtures | 01-01 through 01-06 | COVERED |
| CONTEXT | D-15 | timestamped public-item API-35 vertical smoke and blocker honesty | 01-07 | COVERED |
| CONTEXT | D-16 | evidence identity, environment, commands, timings, redaction, gaps | 01-07 | COVERED |

No required GOAL, REQ, RESEARCH, or CONTEXT item is missing. The five deferred capability groups in `01-CONTEXT.md` are excluded only from Phase 1 and remain assigned to their named later phases.

## Artifacts this phase produces

- Native contract and lifecycle: `AndroidRpcContract`, `BridgeRequestRegistry`, `BridgeRetryPolicy`, `BilibiliResponseMapper`, and their JVM tests.
- Existing native seams extended: `AndroidHttpBridge.dispatchTypedRequest`, `AndroidHttpBridge.executeTypedOperation`, `MainActivity` lifecycle/navigation hooks, and `NavigationPolicy` exact runtime decisions.
- Shared frontend seams extended: `Listen2AndroidHttpAdapter.request`, `cancel`, and epoch handling; `MediaService.search(source, options)` cancellation forwarding; `MediaService.getVideoContext(track, options)`; Bilibili typed search/detail/manifest adapters; current-track Howler descriptor handling; phone-first controller states and safe copy.
- Deterministic fixtures: typed bridge/provider/UI/player Node tests and bounded Bilibili fixture data under `app/listen1_chrome_extension/test/fixtures/`.
- Runtime verification: `Phase01WebViewInstrumentationTest`, `android/scripts/phase01-api35-smoke.sh`, `android/evidence/phase01/README.md`, and timestamped redacted evidence under `.planning/phases/01-verified-bilibili-startup-slice/evidence/`.
