# Phase 2: Native Media3 Playback & Background Control - Pattern Map

**Mapped:** 2026-08-31
**Files classified:** 23
**Analogs found:** 13 / 23

## File Classification

| New/modified file | Role | Data flow | Closest analog | Match |
|---|---|---|---|---|
| `android/app/build.gradle` | config | build / file-I/O | itself | exact extension |
| `android/app/src/main/AndroidManifest.xml` | config | lifecycle | itself | exact extension |
| `MainActivity.java` | lifecycle host | event-driven | itself | exact extension |
| `PlaybackService.java` | service | streaming / event-driven | none | no safe analog |
| `PlaybackCoordinator.java` | service | serialized command / CRUD | `BridgeRequestRegistry.java` | partial |
| `PlaybackBridgeController.java` | bridge controller | request-response / pub-sub | `AndroidHttpBridge.java` | role-match |
| `PlaybackBridgePolicy.java` | policy / validator | request-response | `AndroidRpcContract.java` | role-match |
| `PlaybackSnapshot.java` | DTO | transform / pub-sub | `AndroidRpcContract.TypedReply` | partial |
| `PlaybackQueueEngine.java` | utility/model | state transform | `player_thread.js` queue/shuffle logic | behavioral match only |
| `PlaybackCheckpointRepository.java` | repository | CRUD / transaction | none | no safe analog |
| `Listen2Database.java`, `playback/*` | Room model/config | CRUD / migration | none | no safe analog |
| `PlaybackSettingsStore.java` | settings adapter | CRUD | none | no safe analog |
| `AndroidRpcContract.java`, `AndroidHttpBridge.java` | bridge contract/transport | request-response | themselves | exact extension |
| `app/.../js/lowebutil.js` | classic-global bridge adapter | request-response / pub-sub | `Listen2AndroidHttpAdapter` | exact extension |
| `app/.../js/l1_player.js` | platform player facade | command dispatch | itself | extension, Android branch only |
| `app/.../js/player_thread.js` | legacy player / cutover guard | streaming / recovery | current token/retry path | extension, not native owner |
| `app/.../js/controller/play.js`, `listen1.html`, `css/*.css` | component/UI | event-driven | existing queue listeners + phone dock | role-match |
| `PlaybackQueueEngineTest.java`, `PlaybackBridgePolicyTest.java`, `PlaybackCoordinatorTest.java` | JVM tests | transform / request-response | `BridgeRequestRegistryTest.java` | role-match |
| `PlaybackMigrationTest.java` | migration test | CRUD / batch | none | no safe analog |
| `PlaybackServiceInstrumentationTest.java`, `PlaybackRecoveryInstrumentationTest.java` | device tests | lifecycle / streaming | `Phase01WebViewInstrumentationTest.java` | role-match |
| `app/.../test/android_native_playback*.test.js` | JS contract test | mocked bridge / event-driven | `android_rpc_contract.test.js` | exact structure |
| `android/scripts/phase02-api35-*.sh`, `android/evidence/phase02/*`, `02-API35-EVIDENCE.md` | evidence harness/docs | device event-driven | Phase-01 harness | role-match |

## Pattern Assignments

### Android composition, lifecycle, and bridge

#### `MainActivity.java` (modify; lifecycle host)

**Analog:** `MainActivity.java:46-68, 144-168, 207-220`.

Keep this class as WebView/UI composition only. Its teardown pattern is the key contract: retire the page bridge and WebView, but only disconnect any playback page controller—never release or pause the service player.

```java
// MainActivity.java:144-168
WebView retiringWebView = webView;
webView = null;
if (retiringWebView != null) {
    retiringWebView.stopLoading();
    if (httpBridge != null) {
        httpBridge.destroy(retiringWebView);
        httpBridge = null;
    }
    retiringWebView.destroy();
}
```

Change the outdated comment at `:130`; it currently says page-owned audio. Preserve secure WebView configuration (`:83-109`) and `onPageStarted()` generation invalidation (`:207-210`). Do not put player ownership, Room work, or media callbacks here.

#### `PlaybackBridgeController.java`, `PlaybackBridgePolicy.java`, `PlaybackSnapshot.java`, and extensions to RPC files

**Analogs:** `AndroidHttpBridge.java:76-103, 105-148`; `AndroidRpcContract.java:124-189`; `BridgeRequestRegistry.java:64-145`.

Use the existing exact-origin WebMessage listener and one-terminal-state discipline. Playback is a new allow-listed operation family, not a second `addJavascriptInterface` object and not HTTP transport input. Policy stays Android-free/package-private; it validates exact keys, page epoch, current snapshot revision, bounded opaque occurrence identity, operation, and numeric bounds before controller dispatch.

```java
// BridgeRequestRegistry.java:103-132 -- first terminal result wins.
synchronized SettleResult settle(RequestKey key, AndroidRpcContract.Terminal terminal) {
    CallHandle handle = handles.get(key);
    if (destroyed) return SettleResult.DESTROYED;
    if (handle == null) return SettleResult.NOT_FOUND;
    if (handle.terminal) return SettleResult.ALREADY_SETTLED;
    handle.terminal = true;
    return terminal == AndroidRpcContract.Terminal.CANCELLED
            ? SettleResult.CANCELLED : SettleResult.OK;
}
```

`AndroidHttpBridge.onPageStarted()` (`:98-103`) and `destroy()` (`:90-96`) define lifecycle behavior: old-page work becomes inert, while a new packaged page receives fresh authority. Emit only sanitized, revisioned snapshots; never reply with signed candidates, URLs, headers, cookies, exceptions, `MediaItem`s, provider JSON, or Room internals.

#### `PlaybackService.java` (new; no safe local implementation analog)

Use the official Media3 `MediaSessionService` lifecycle described in research; no existing project service owns background media. The nearest *boundary* analog is MainActivity’s explicit ownership/teardown, but it must not be copied literally. Service creates exactly one ExoPlayer and MediaSession, delegates all semantic transitions to the coordinator, exposes the single session, and idempotently checkpoints/releases. Activity/WebView only connect as controllers/renderers.

#### `PlaybackCoordinator.java` and `PlaybackQueueEngine.java`

**Behavioral analog:** `player_thread.js:1012-1141, 2108-2137, 2221-2251`; definitive tests `player_play_next_queue.test.js:36-139` and `player_shuffle.test.js:159-245`.

Copy semantics, not JavaScript implementation or state fields. Preserve unique occurrence identity, duplicate FIFO entries, return-to-base context, and accepted-history previous behavior. Serialize page, media-session, player-ended, headset and notification transitions through one coordinator lane; transactionally advance semantic state before projecting a Media3 timeline and publishing a single snapshot revision.

```javascript
// player_play_next_queue.test.js:67-75 -- duplicate entries are intentional.
player.enqueueNext(track('A'));
player.enqueueNext(track('A'));
player.skip('next');
player.skip('next');
assert.deepStrictEqual(played, ['A', 'A']);
```

Do not copy `_play_next_queue`, random `queueId`, direct `Howler.unload()`, raw playlist insertion, or the page-local mutable state. Media3 timeline is a projection, never the semantic queue.

#### `PlaybackCheckpointRepository.java`, `Listen2Database.java`, `playback/*`, `PlaybackSettingsStore.java`

**No safe local analog.** New Room/DataStore boundary. Keep Room entities/DAOs/migrations isolated under `playback/`, repository transaction methods at the service boundary, and schema/version composition in `Listen2Database`. Store only logical provider/domain references, occurrence order, base context, history/mode, volume/mute, position, and revision—never signed URL/candidate/cookie/header/credential/raw response. Export schemas and start migration tests with version 1. DataStore, if retained after a Java API spike, is one application-scoped adapter for small non-sensitive preferences only.

### Build and manifest

#### `android/app/build.gradle`

**Analog:** `build.gradle:5-38, 66-96`.

Keep Java 17 and API 35. Declare all Media3 artifacts at `1.9.4`, Room runtime/compiler/testing at `2.8.4`, with Java `annotationProcessor`; do not introduce Media3 `1.11.0` (requires compile SDK 36). Preserve the explicit asset allow-list:

```groovy
// build.gradle:8-35
tasks.register('syncListen1Assets', Copy) {
    from(listen1SourceDirectory) {
        include 'js/controller/*.js'
        include 'js/l1_player.js'
        include 'js/lowebutil.js'
        include 'js/player_thread.js'
    }
}
```

No asset-list change is needed when extending these already-packaged JS files. Any genuinely new shared browser file requires both this allow-list and deliberate `listen1.html` script order; never hand-edit generated assets.

#### `AndroidManifest.xml`

**Analog:** `AndroidManifest.xml:2-37` formatting and minimal-permission convention.

Add only documented media-playback foreground-service permissions and a non-exported `PlaybackService` declaration with `android:foregroundServiceType="mediaPlayback"`; retain `allowBackup="false"` and cleartext prohibition. Do not broaden queries, exported components, networking, or WebView permissions.

### Shared classic-script frontend

#### `lowebutil.js`

**Analog:** `Listen2AndroidHttpAdapter` at `lowebutil.js:139-176, 319-369` and JS contract test `android_rpc_contract.test.js:14-115`.

Retain one injected object, pending-map settlement, request/page-epoch checks, cancellation, and digest ordering. Add sibling native-playback adapter behavior only if it reuses this one bridge and validates monotonic snapshot revisions. Keep desktop/browser fallback explicit and preserve v1/v2 provider routes.

```javascript
// lowebutil.js:329-349
if (!entry || entry.settled) return;
entry.settled = true;
clearTimeout(entry.timeoutId);
// ...
if (response.pageEpoch !== entry.pageEpoch) return;
```

#### `l1_player.js`, `player_thread.js`, `controller/play.js`, `listen1.html`, CSS

**Analogs:** facade forwarding at `l1_player.js:15-120`; UI state and `$evalAsync` dispatch at `controller/play.js:172-178, 3286-3367`; stale callback guard in `player_thread.js:1608-1669`.

Android-only capability detection must route controls to native intents/snapshots and prevent `Howl` construction once service handshake succeeds. Desktop/browser behavior and existing classic global load order remain unchanged. Page commands are pending until a newer native snapshot; repeated pending commands are ignored. The queue sheet must render native occurrence ordinal (`队列第 N 首`) and never dedupe same-looking entries. Use semantic buttons/ranges, Chinese labels/live state, 48dp target wrappers, safe-area CSS, and desktop-isolated selectors.

The existing Howler retry is only a semantic reference: bounded ordered candidates, selected-track token/revision guard, and no silent skip. Do not retain Android Howler as fallback after ownership cutover.

### Tests and device evidence

#### JVM tests

**Analog:** `BridgeRequestRegistryTest.java:11-85`, `AndroidRpcContractTest.java:10-75`.

Tests are direct JUnit 4 calls to package-private pure Java helpers with stable-code assertions and fakes—no Android API, sleep, provider, URL, cookie, or emulator dependency. Add deterministic cases for duplicate occurrence FIFO, remove/reorder/clear/restore, shuffle/history/previous, single transition, retry cap/current occurrence, stale epoch/revision, and checkpoint transaction shape. `PlaybackMigrationTest` has no existing local Room analog; use Room’s exported-schema migration test facility from schema 1 rather than destructive reset.

#### Instrumentation and evidence harness

**Analogs:** `Phase01WebViewInstrumentationTest.java:34-135` and `android/scripts/phase01-api35-smoke.sh:1-166`, plus `android/evidence/phase01/README.md:3-16`.

Retain fail-closed device selection, exact APK/Git identity, API-35 and WebView capture, cleanup trap, and explicit `BLOCKED / not verified`. Phase-2 instrumentation must use latches/polling helpers rather than fixed sleeps where possible, launch/finish Activity safely, and assert observable native/session/page agreement. The new harness records only timestamps/timezone, SHA-256, package/variant, API/ABI/WebView, command, redacted state/timing/screenshot names, pass/fail/blocked, uncovered steps, and recovery path. It must never accept build/JVM results as background-playback proof or serialize media URLs, cookies, tokens, headers, provider bodies, exceptions, or personal paths.

## Shared Patterns

- **One owner:** service owns every ExoPlayer/MediaSession mutation; Activity and WebView teardown detach controllers only.
- **One transition result:** `BridgeRequestRegistry` first-terminal-wins behavior applies to commands, cancellation, stale callbacks, and retry completion.
- **Semantic state first:** queue/history/checkpoint transaction precedes Media3 projection and exactly one new snapshot revision.
- **Fail closed:** exact origin, exact schema, bounded values; never accept raw transport controls or sensitive persistence/projection.
- **Frontend separation:** classic globals + `$evalAsync`; Android native branch only, no desktop regression or second audio owner.
- **Evidence:** API-35 device journey is mandatory and may remain explicitly blocked; deterministic tests are supporting evidence only.

## No Analog / Do Not Copy

| Item | Why no safe copy exists / prohibited source |
|---|---|
| `PlaybackService`, Room schema/repository/migrations, DataStore Java adapter | The repository currently has no native background media service or persistence layer. Follow the researched official contracts; prove assumptions with focused tests/spikes. |
| `listen1/listen1_mobile@v0.8.2` `background-player.screen.js`, `player.reducer.js`, `actions.js` | Interaction reference only. Do **not** copy its React Native, Redux, SDK-28 lifecycle, page/player ownership, persistence, or notification implementation. |
| `player_thread.js` Howler/`navigator.mediaSession` mechanics | Do not copy `Howl`, `Howler.unload()`, browser media-session handlers, localStorage queue restore, random queue IDs, or mutable page-owned current player as Android-native implementation. |
| Existing `MainActivity` page-owned-audio comment/behavior | `MainActivity.java:130-133` is Phase-1 temporary behavior and conflicts with sole service ownership; update it during cutover. |

## Metadata

**Analog search scope:** Android package/tests/manifest/Gradle/evidence harness; shared player, bridge, controller, markup and contract tests.
**Files scanned:** 20+ targeted source/test/config files.
**Pattern extraction date:** 2026-08-31
