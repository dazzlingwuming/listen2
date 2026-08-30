# Phase 3: NetEase Lyrics & Provider Contract - Pattern Map

**Mapped:** 2026-08-31  
**Files classified:** 18 expected production/config/test targets  
**Analogs found:** 17 / 18 (the live, entitlement-compliant NetEase rendition implementation has no proven local analog)

## Scope-derived File Classification

| New/modified file or area | Role | Data flow | Closest proven analog | Match |
|---|---|---|---|---|
| `AndroidRpcContract.java` | closed RPC schema/projector | request-response | current Bilibili v2 operations | exact extension |
| `HttpBridgePolicy.java` | route policy | request-response | existing NetEase v1 search route | partial; v2 must be narrower |
| `AndroidHttpBridge.java` | origin-bound native transport | async request-response / cancellation | current typed Bilibili dispatcher | exact extension |
| NetEase response mapper (new focused Java helper if extracted) | provider projection | transform | `AndroidRpcContract.projectSearchResponse` / `BilibiliResponseMapper` | role/data-flow match |
| `PlaybackMediaResolver.java` + `PlaybackService.java` | native rendition resolver / Media3 owner | streaming / event-driven | current resolver seam + player snapshot publisher | exact extension, but resolver is deliberately empty today |
| `PlaybackSnapshot.java` | sanitized native clock/identity DTO | pub-sub / transform | current allow-listed snapshot | exact extension |
| `PlaybackBridgeController.java` (only if lyric snapshot events use it) | revision/epoch publisher | pub-sub | current monotonic snapshot delivery | exact extension |
| `data/DurableRecordEntities.java`, `Listen2Database.java`, `Listen2Dao.java`, new lyric repository/DAO | Room model/repository/migration | CRUD / transaction | checkpoint entity/repository/migration tests | role match |
| `lowebutil.js` | classic-global typed RPC client | request-response / cancellation | existing `request()` handle | exact extension |
| `provider/netease.js` | provider adapter | request-response / transform | current Android-search branch, desktop callbacks | extension; replace only Android branch |
| `l1_player.js` | native-selection facade | command / snapshot projection | Bilibili-only `nativeTrackSelection` | partial; identity must become provider-neutral |
| `controller/play.js` | lyric state/controller | event-driven UI / stale arbitration | primary lyric token lifecycle | role match; current state is Bilibili-bound |
| `listen1.html`, `css/redesign.css` | accessible phone lyric UI | event-driven rendering | Android detail/live-region markup | role match |
| JVM contract/policy/bridge tests | deterministic boundary tests | request-response | `AndroidRpcContractTest`, `PlaybackBridgeControllerTest` | exact style |
| Room migration/repository tests | DB migration/transaction | CRUD / migration | `PlaybackMigrationInstrumentationTest`, `PlaybackPersistenceInstrumentationTest` | exact style |
| frontend RPC/provider/lyric/UI tests | VM/DOM contract fixtures | request-response / event-driven | `android_rpc_contract.test.js`, `android_http_netease_search.test.js`, `android_native_playback_ui.test.js` | exact style |
| API-35 NetEase/TalkBack evidence harness + redacted evidence | device E2E | event-driven | Phase 01/02 evidence conventions | partial; new live gate |
| provider-capability matrix UI/data | config/state projection | transform | requirement capability matrix only | no source analog; keep unavailable by default |

## Pattern Assignments

### `android/app/src/main/java/com/dazzlingwuming/listen2/AndroidRpcContract.java`

**Copy from:** its existing closed v2 envelope and Bilibili operation family.

- At [AndroidRpcContract.java:34](/Users/fluenteng/个人相关/listen1/listen1_desktop/android/app/src/main/java/com/dazzlingwuming/listen2/AndroidRpcContract.java:34), add named `netease.*` and lyric operations to the enum; do not add a generic URL operation.
- At [AndroidRpcContract.java:58](/Users/fluenteng/个人相关/listen1/listen1_desktop/android/app/src/main/java/com/dazzlingwuming/listen2/AndroidRpcContract.java:58), retain exact top-level keys/version/epoch validation. At [AndroidRpcContract.java:148](/Users/fluenteng/个人相关/listen1/listen1_desktop/android/app/src/main/java/com/dazzlingwuming/listen2/AndroidRpcContract.java:148), use one exact payload-key branch per operation, as Bilibili does.
- Native route construction belongs beside [AndroidRpcContract.java:97](/Users/fluenteng/个人相关/listen1/listen1_desktop/android/app/src/main/java/com/dazzlingwuming/listen2/AndroidRpcContract.java:97), never in page input.
- Map provider bodies to a bounded page-safe DTO following [AndroidRpcContract.java:246](/Users/fluenteng/个人相关/listen1/listen1_desktop/android/app/src/main/java/com/dazzlingwuming/listen2/AndroidRpcContract.java:246): reject malformed/provider-status results, independently project valid rows, and return fixed error codes.

**Test anchor:** [AndroidRpcContractTest.java:12](/Users/fluenteng/个人相关/listen1/listen1_desktop/android/app/src/test/java/com/dazzlingwuming/listen2/AndroidRpcContractTest.java:12) asserts the final native URI; extend it for exact allowed NetEase payloads/routes and unknown `url`, `headers`, cookies, signed candidates, unknown fields, bounds, and safe projection.

### `HttpBridgePolicy.java` and `AndroidHttpBridge.java`

**Copy from:** one origin-scoped listener, typed registry, one terminal reply, redirect-free bounded transport.

- `HttpBridgePolicy`’s legacy route at [HttpBridgePolicy.java:30](/Users/fluenteng/个人相关/listen1/listen1_desktop/android/app/src/main/java/com/dazzlingwuming/listen2/HttpBridgePolicy.java:30) is **v1 compatibility only**. Do not broaden it into Phase 3 transport policy; build exact typed routes from the new contract.
- In [AndroidHttpBridge.java:202](/Users/fluenteng/个人相关/listen1/listen1_desktop/android/app/src/main/java/com/dazzlingwuming/listen2/AndroidHttpBridge.java:202), preserve parse → trusted main-frame/origin validation → cancel branch → registry admission → one terminal reply. Extend `executeTypedOperation`, not a second WebMessage listener.
- Reuse the cancellation registry and deadline behavior around [AndroidHttpBridge.java:220](/Users/fluenteng/个人相关/listen1/listen1_desktop/android/app/src/main/java/com/dazzlingwuming/listen2/AndroidHttpBridge.java:220) and typed execution around [AndroidHttpBridge.java:482](/Users/fluenteng/个人相关/listen1/listen1_desktop/android/app/src/main/java/com/dazzlingwuming/listen2/AndroidHttpBridge.java:482). A cancellation/timeout/transition may settle once only.

**Test anchor:** [HttpBridgePolicyTest.java](/Users/fluenteng/个人相关/listen1/listen1_desktop/android/app/src/test/java/com/dazzlingwuming/listen2/HttpBridgePolicyTest.java) for pure route rejection; [AndroidRpcContractTest.java:36](/Users/fluenteng/个人相关/listen1/listen1_desktop/android/app/src/test/java/com/dazzlingwuming/listen2/AndroidRpcContractTest.java:36) for v1/v2 separation.

### Native NetEase rendition and lyric clock: `PlaybackMediaResolver.java`, `PlaybackService.java`, `PlaybackSnapshot.java`

**Copy from:** the native-only Media3 resolver seam and snapshot allow-list.

- `PlaybackService` currently installs an empty resolver at [PlaybackService.java:89](/Users/fluenteng/个人相关/listen1/listen1_desktop/android/app/src/main/java/com/dazzlingwuming/listen2/PlaybackService.java:89). Phase 3 must replace that seam with an entitlement-compliant default-NetEase resolver or record NET-004 as externally blocked; fixture playback cannot satisfy the live route gate.
- Preserve the resolver rule at [PlaybackMediaResolver.java:190](/Users/fluenteng/个人相关/listen1/listen1_desktop/android/app/src/main/java/com/dazzlingwuming/listen2/PlaybackMediaResolver.java:190): candidates are internal, freshly resolved, occurrence/revision scoped, and never serialized.
- Project lyric-safe identity plus selection generation/capability/state into the existing snapshot allow-list, following [PlaybackSnapshot.java:64](/Users/fluenteng/个人相关/listen1/listen1_desktop/android/app/src/main/java/com/dazzlingwuming/listen2/PlaybackSnapshot.java:64). No signed URL, raw provider body, headers, cookie, or credential field is permitted.
- Derive active timing from the service at [PlaybackService.java:247](/Users/fluenteng/个人相关/listen1/listen1_desktop/android/app/src/main/java/com/dazzlingwuming/listen2/PlaybackService.java:247): immediate snapshots on state/discontinuity/restore/error, bounded foreground progress cadence only, no persistent/announced timer ticks. Keep ExoPlayer mutations main-looper-confined as at [PlaybackService.java:149](/Users/fluenteng/个人相关/listen1/listen1_desktop/android/app/src/main/java/com/dazzlingwuming/listen2/PlaybackService.java:149).

**Test anchor:** [PlaybackBridgeControllerTest.java:50](/Users/fluenteng/个人相关/listen1/listen1_desktop/android/app/src/test/java/com/dazzlingwuming/listen2/PlaybackBridgeControllerTest.java:50) proves stale epoch/revision and transport-field rejection. Add clock/identity/seek/pause/transition/recovery projection cases there or in a focused pure helper test.

### Durable lyric state: `data/*`

**Copy from:** Room schema ownership plus expected-revision transactions—not WebView storage.

- Extend the placeholder lyric record at [DurableRecordEntities.java:66](/Users/fluenteng/个人相关/listen1/listen1_desktop/android/app/src/main/java/com/dazzlingwuming/listen2/data/DurableRecordEntities.java:66) through a schema version bump in [Listen2Database.java:6](/Users/fluenteng/个人相关/listen1/listen1_desktop/android/app/src/main/java/com/dazzlingwuming/listen2/data/Listen2Database.java:6), DAO, focused repository, and explicit migration. Records need provider/track/part/revision identity, selection generation, bounded offset, source/match metadata, validated bounded lyric representation and timestamps; schema must have no transport-like columns.
- Use the transaction/revision result vocabulary in [PlaybackCheckpointRepository.java:37](/Users/fluenteng/个人相关/listen1/listen1_desktop/android/app/src/main/java/com/dazzlingwuming/listen2/PlaybackCheckpointRepository.java:37): validate first, transact, distinguish accepted/idempotent/stale/invalid, and restore only safe semantic state.

**Test anchor:** [PlaybackMigrationInstrumentationTest.java:31](/Users/fluenteng/个人相关/listen1/listen1_desktop/android/app/src/androidTest/java/com/dazzlingwuming/listen2/PlaybackMigrationInstrumentationTest.java:31) is the migration baseline pattern, including forbidden-column scan at [PlaybackMigrationInstrumentationTest.java:57](/Users/fluenteng/个人相关/listen1/listen1_desktop/android/app/src/androidTest/java/com/dazzlingwuming/listen2/PlaybackMigrationInstrumentationTest.java:57). [PlaybackPersistenceInstrumentationTest.java:18](/Users/fluenteng/个人相关/listen1/listen1_desktop/android/app/src/androidTest/java/com/dazzlingwuming/listen2/PlaybackPersistenceInstrumentationTest.java:18) is the in-memory transaction/idempotency pattern.

### `app/listen1_chrome_extension/js/lowebutil.js`

**Copy from:** `Listen2AndroidHttpAdapter.request()`.

Use the normalized named-operation payload, `pageEpoch`, timeout and explicit request handle at [lowebutil.js:585](/Users/fluenteng/个人相关/listen1/listen1_desktop/app/listen1_chrome_extension/js/lowebutil.js:585). Preserve cancellation order at [lowebutil.js:675](/Users/fluenteng/个人相关/listen1/listen1_desktop/app/listen1_chrome_extension/js/lowebutil.js:675): post native cancel first, remove the pending entry, then settle local consumers. Extend validation/normalization for exact `netease.*`/`lyric.*` shapes; retain v1 `get()` only for legacy compatibility.

**Test anchor:** [android_rpc_contract.test.js:46](/Users/fluenteng/个人相关/listen1/listen1_desktop/app/listen1_chrome_extension/test/android_rpc_contract.test.js:46) is the VM harness for exact envelope, mismatched epoch, duplicate/cancel/timeout/teardown and arbitrary-field rejection.

### `app/listen1_chrome_extension/js/provider/netease.js`

**Copy from:** the existing Android split while preserving the desktop provider API.

- Keep desktop `bootstrap_track` and its callback contract untouched ([netease.js:355](/Users/fluenteng/个人相关/listen1/listen1_desktop/app/listen1_chrome_extension/js/provider/netease.js:355)); it exposes a raw `sound.url` and cookie/EAPI assumptions unsuitable for Android.
- Replace only the Android v1-search branch ([netease.js:401](/Users/fluenteng/个人相关/listen1/listen1_desktop/app/listen1_chrome_extension/js/provider/netease.js:401), [netease.js:468](/Users/fluenteng/个人相关/listen1/listen1_desktop/app/listen1_chrome_extension/js/provider/netease.js:468)) with typed request/DTO transforms and stable actionable errors. Do not turn a parse/network/provider error into `{ result: [], total: 0 }` as the current lines 496–503 do.
- Let native resolve and consume the authorized default rendition. The adapter may receive safe logical state/identity, never candidate URLs or session material.

**Test anchor:** [android_http_netease_search.test.js](/Users/fluenteng/个人相关/listen1/listen1_desktop/app/listen1_chrome_extension/test/android_http_netease_search.test.js) is the existing desktop-vs-Android fixture harness; evolve it to v2 result/error/cancel tests and add detail/default-rendition/primary-lyric DTO fixtures.

### `l1_player.js`, `controller/play.js`, `listen1.html`, `css/redesign.css`

**Copy from:** the Android snapshot-only player and token-guarded lyric UI, while making its identity provider-neutral.

- Generalize Bilibili-only parsing at [l1_player.js:18](/Users/fluenteng/个人相关/listen1/listen1_desktop/app/listen1_chrome_extension/js/l1_player.js:18); the page must render the service-issued active identity rather than treat `nativeCurrentTrack` as audio/clock truth.
- Base lyric reply acceptance on the current page epoch, snapshot occurrence/track identity, selection generation, playback revision and lyric request token. Existing primary lyric state starts at [play.js:882](/Users/fluenteng/个人相关/listen1/listen1_desktop/app/listen1_chrome_extension/js/controller/play.js:882); retain its token teardown behavior, but remove the Bilibili ID gate and do not delay audio.
- Reuse Android detail entry [listen1.html:8759](/Users/fluenteng/个人相关/listen1/listen1_desktop/app/listen1_chrome_extension/listen1.html:8759) and native player semantic/live-region conventions asserted in [android_native_playback_ui.test.js:53](/Users/fluenteng/个人相关/listen1/listen1_desktop/app/listen1_chrome_extension/test/android_native_playback_ui.test.js:53). Add explicit active-line, original/translation, offset, loading/degraded/error, manual select/clear and polite transition semantics; 48dp and reduced-motion/high-contrast rules remain in `redesign.css`.
- Preserve manual-selection precedence and translation enrichment behavior as a model only from [bilibili_lyric_translation.test.js:552](/Users/fluenteng/个人相关/listen1/listen1_desktop/app/listen1_chrome_extension/test/bilibili_lyric_translation.test.js:552). Persistence moves to Room; do not extend the existing Bilibili-only localStorage convention.

## Shared Patterns and Non-negotiable Anti-patterns

| Concern | Reuse | Do not do |
|---|---|---|
| RPC security | exact-key typed envelope, native URI construction and result projector | generic fetch/URL/header/cookie route, legacy v1 expansion, provider bodies passed to page |
| Terminal behavior | registry + `requestId`/epoch cancellation and first-terminal settlement | empty success on error, double settle, late reply state mutation |
| Playback authority | `PlaybackService` Media3 position plus monotonic snapshot | Howler/timer/page metadata as Android clock or a second player |
| Snapshot/privacy | `PlaybackSnapshot.toMap()` allow-list | URLs, candidates, headers, cookies, raw lyric provider bodies, credentials in snapshot/Room/evidence/logs |
| Persistence | Room migration + expected-revision transaction | WebView `localStorage` as Android durable source or destructive migration fallback |
| UX/accessibility | snapshot-rendered phone panels, polite state/line announcements | per-progress-tick announcements, inaccessible highlighted lines, lyric failure blocking playback |
| Capability matrix | unavailable-by-default for QQ/Kugou/Kuwo/Migu/Taihe | dead controls or claiming a fixture as provider/device/authorization proof |

## Ownership and Conflict Boundaries

| Owner boundary | Files | Coordination rule |
|---|---|---|
| Native provider boundary | `AndroidRpcContract`, `HttpBridgePolicy`, `AndroidHttpBridge`, NetEase mapper | One owner changes operation names, DTOs and projections together; frontend consumes only final contract. |
| Native playback/clock | `PlaybackService`, `PlaybackMediaResolver`, `PlaybackSnapshot`, `PlaybackBridgeController` | Keep one owner for service/snapshot schema; do not let lyric UI independently redefine revision or playback state. |
| Lyric durable model | `data/DurableRecordEntities`, `Listen2Database`, `Listen2Dao`, lyric repository, migrations | One owner handles schema/version/migration/repository/tests atomically. |
| Shared page adapter/UI | `lowebutil`, `provider/netease`, `l1_player`, `controller/play`, HTML/CSS | Coordinate contract names with native owner; preserve desktop callback paths and script order. |
| Evidence | new Phase 3 harness/evidence only | Do not alter or delete untracked Phase 1 evidence; live NetEase credentials and transport data never enter artifacts. |

## No Safe Local Analog

| Concern | Why no analog exists | Planning implication |
|---|---|---|
| Authorized native NetEase default rendition | existing `PlaybackService` resolver returns an empty candidate list; desktop path relies on EAPI/cookies | create a closed native resolver seam only with an authorized documented route; otherwise implementation can be deterministic but NET-004 live E2E remains `BLOCKED`/not verified |
| Provider-neutral Android lyric repository/content retention | current Room table is metadata-only | make retention bounds, migration, corruption recovery and exact semantic identity explicit before implementation |
| Sibling `../listen1_mobile` behavior files | directory is absent in this workspace | no mobile source may be copied; desktop/Android contracts are the only available analogs |

## Metadata

**Search scope:** Phase 1/2 patterns and summaries; Android RPC/policy/bridge/Media3/Room code and tests; shared NetEase/provider/player/lyric UI and Node tests; attempted sibling mobile checkout.  
**Files scanned:** 30 focused source, test, phase and configuration files.  
**Pattern extraction date:** 2026-08-31.
