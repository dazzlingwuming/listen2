# Phase 5: Five-Source Listen Journey - Pattern Map

**Mapped:** 2026-09-10
**Scope source:** `05-CONTEXT.md` (technical research/implementation plan had not yet been produced when mapped)
**Files analyzed:** 31 likely extensions/new tests
**Analogs found:** 31 / 31

## File Classification

| Planned file or responsibility | Role | Data flow | Closest existing analog | Match |
|---|---|---|---|---|
| `AndroidRpcContract.java` | typed RPC contract | request-response/cancellable | same file's Bilibili + NetEase operations | exact extension |
| `ProviderCapabilityFacade.java` | capability facade | transform | same file | exact extension |
| `NetEaseNativeProvider.java`, `NetEaseResponseMapper.java`, `NetEaseProviderClient.java` | native provider client/mapper | request-response | same NetEase stack | exact extension |
| `BilibiliDirectoryProvider.java` | directory client/mapper | request-response | same file | exact extension |
| new `QqNativeProvider.java`, `KugouNativeProvider.java`, `KuwoNativeProvider.java` (only if routes are approved) | typed provider client/mapper | request-response | `NetEaseNativeProvider.java` + `BilibiliDirectoryProvider.java` | role match |
| `AndroidHttpBridge.java` / host dispatch wiring | bridge dispatcher | async request-response | current NetEase/Bilibili dispatch | exact extension |
| `mobile_provider_registry.js`, `loweb.js`, `lowebutil.js` | capability + semantic facade | request-response/cancellable | current registry and Android adapter | exact extension |
| `instant_search.js`, `listen1.html`, `redesign.css` | search/directory/detail UI | event-driven/cancellable | current provider search + Bilibili detail layer | exact extension |
| `l1_player.js`, `PlaybackBridgePolicy.java` | selection identity bridge | event-driven/request-response | current Bilibili/NetEase selection | exact extension |
| `PlaybackService.java`, `PlaybackMediaResolver.java`, provider resolvers | Media3 resolver/service | queued async streaming | current NetEase/Bilibili resolver lanes | exact extension |
| `PlaybackQueueEngine.java`, `PlaybackCoordinator.java`, `PlaybackCheckpointRepository.java` | queue/checkpoint | event-driven/persistence | current mixed occurrence engine | exact reuse + fixture expansion |
| `PlaybackSnapshot.java`, `PlaybackBridgeController.java`, `play.js` | snapshot projection UI | pub-sub/event-driven | current Android playback snapshot | exact extension |
| `BilibiliLyricProvider.java`, `LyricClockProjection.java`, `LyricPersistencePort.java`, `data/LyricRepository.java` | lyric lookup/clock/persistence | request-response + persistence | current Bilibili/NetEase lyric seam | exact extension |
| `android/app/build.gradle` | APK asset config | file-I/O | `syncListen1Assets` allow-list | exact |
| Android JVM + frontend Node tests | fixture/contract test | request-response/event-driven | `NetEaseNativeProviderTest.java`, `android_netease_typed_provider.test.js` | exact |

## Pattern Assignments

### Typed provider client, mapper, and contract

**Extend:** `android/app/src/main/java/com/dazzlingwuming/listen2/AndroidRpcContract.java`, `NetEaseNativeProvider.java`, `NetEaseResponseMapper.java`, `NetEaseProviderClient.java`; add one isolated provider package/class family per newly approved QQ/Kugou/Kuwo route rather than placing their transport inside the RPC contract.

**Primary analog:** `NetEaseNativeProvider.java:24-128, 152-230`; `BilibiliDirectoryProvider.java:26-154`; `AndroidRpcContract.java:18-94`.

```java
// A semantic operation is parsed, not a URL selected by page code.
enum Operation {
    NETEASE_SEARCH("netease.search"),
    NETEASE_DIRECTORY_DETAIL("netease.directory.detail"),
    NETEASE_RENDITION_DEFAULT("netease.rendition.default"),
    NETEASE_LYRIC_PRIMARY("netease.lyric.primary"),
    RPC_CANCEL("rpc.cancel");
}

// Provider request is native-owned and keeps credentials/headers behind the boundary.
Request buildSearchRequest(String keyword, int page) throws URISyntaxException {
    if (!isSafeKeyword(keyword) || page < 1 || page > 1_000) {
        throw new URISyntaxException("", "Invalid search input");
    }
    return request(Route.SEARCH, new URI("https://" + MUSIC_HOST + SEARCH_PATH + "?" + query),
            "", cookies.forWeapi());
}
```

Copy the bounded constants, native `Route` enum, injected `Transport` test seam, request/response objects, exact host/path/query validation, byte limits, timeout/interrupt mapping, and mapper return shape. A new provider starts with all capabilities false; it is not enough to add an enum value. Add the facade bit only after the provider has a semantic DTO, fixture/schema tests for success/empty/malformed/timeout-cancel/authorization/oversize/stale response, and native dispatch that never returns transport fields.

**Do not copy:** desktop `js/provider/qq.js`, `kugou.js`, or `kuwo.js` transport code into Android. Their Axios/browser-cookie/CORS/signature assumptions are evidence for normalized shape only, not an approved native route.

### Capability facade and packaged-page projection

**Extend:** `provider/ProviderCapabilityFacade.java`, `js/mobile_provider_registry.js`, `js/loweb.js`.

**Primary analog:** `ProviderCapabilityFacade.java:9-69, 72-120`; `mobile_provider_registry.js:3-116, 150-215`; `loweb.js:148-223`.

```java
public Capability get(String provider) {
    if ("bilibili".equals(provider)) return bilibili;
    if ("netease".equals(provider)) return netease;
    return Capability.unavailable();
}
```

```javascript
const values = CAPABILITY_FIELDS.reduce(
  (result, field) => ({
    ...result,
    [field]: Boolean(source && source.primary && nativeCapabilities[field] === true),
  }),
  {}
);
```

Keep the fixed primary ordering and make every field independent (`search`, `directory`, `detail`, `media`, `lyric`, `login`, etc.). The page receives a new projected object, never the native handshake or a raw error. Missing/unknown provider keys resolve to the all-false shape.

### Search, directory, detail, and navigation lifecycle

**Extend:** `js/controller/instant_search.js`, `listen1.html`, `css/redesign.css`; if directory navigation needs a reusable non-Angular helper, add it alongside `mobile_provider_registry.js` and package it in Gradle.

**Primary analog:** `instant_search.js:15-56, 96-144, 192-245, 446-572, 670-683`; `mobile_provider_registry.js:384-526`.

```javascript
function currentSearch(epoch, sourceId, query, page) {
  return !destroyed &&
    $scope.providerSearch.epoch === epoch &&
    $scope.providerSearch.sourceId === sourceId &&
    $scope.providerSearch.query === query &&
    $scope.providerSearch.page === page;
}

if (!currentSearch(epoch, sourceId, query, page) ||
    $scope.providerSearch.state !== 'loading') return false;
```

```javascript
const settle = (terminal) => {
  if (handle.terminal) { handle.ignoredReplies += 1; return false; }
  if (terminal.terminal !== 'ok') abortExecutor();
  handle.terminal = terminal;
  active.delete(handle);
  if (timer) clearTimer(timer);
  resolve(terminal);
  return true;
};
```

Directory/detail must be generalized from `bilibiliDetail`, but retain the nearest-layer Back handling and cancellation rules. State carries source, opaque directory/track/part identity, cursor/page, epoch, selected row and scroll restoration key. A source/page/epoch change, Back, destroy or timeout invalidates/cancels exactly once; late responses are ignored. Preserve valid rows on partial failure and display terminal states rather than converting them to empty results.

### Playback identity, resolver, service, queue, checkpoint, and snapshot

**Extend:** `js/l1_player.js`, `PlaybackBridgePolicy.java`, `PlaybackService.java`, plus only source-specific resolvers with an approved media contract. Reuse `PlaybackQueueEngine.java`, `PlaybackCoordinator.java`, `PlaybackCheckpointRepository.java`, `PlaybackSnapshot.java`, `PlaybackBridgeController.java`, and `controller/play.js` unless a new pure helper is needed.

**Primary analog:** `l1_player.js:20-152`; `PlaybackBridgePolicy.java:113-181, 359-406`; `PlaybackService.java:259-383, 670-710, 815-870`; `PlaybackCoordinator.java:9-215`.

```javascript
// Page sends semantic identity only.
return androidPlayback.prepareSelection(selection)
  .then((prepared) => {
    nativeTracksByOccurrence.set(prepared.occurrenceId, track);
    return androidPlayback.selectPrepared(prepared, { action, playWhenReady });
  });
```

```java
// Native-selected candidate is transient; snapshot/RPC/Room never gets it.
PlaybackMediaResolver activeResolver = newResolver(source);
PlaybackMediaResolver.Prepared nativePrepared = activeResolver.prepare(descriptor);
if (nativePrepared == null) return;
preparedMediaByPageHandle.put(pagePrepared.getTrackHandle(), new PreparedMedia(activeResolver,
        nativePrepared, pagePrepared.getOccurrenceId()));
```

```java
PersistenceResult persisted = persistence.persist(before.toState().getRevision(), transition.getState(),
        token, lastPositionMs);
if (!persisted.accepted) {
    engine = PlaybackQueueEngine.restore(before, new PlaybackQueueEngine.IncrementingIdSource("rollback"),
            clock, new PlaybackQueueEngine.SequenceRandom(0L));
    return rejected();
}
```

Preserve page occurrence identity separately from resolver occurrence identity. Extend `nativeTrackSelection()` and `isValidLogicalIdentity()` with an explicit branch per source; never identify a source by title/url, and never fall through unknown source to Bilibili. `PlaybackService.newResolver()` currently has precisely that risky final Bilibili fallback (`PlaybackService.java:311-330`): replace with an explicit Bilibili branch and a fail-closed unknown resolver/result before enabling any further source.

On resolver failure retain the selected occurrence and checkpoint/snapshot it with a stable recovery code; do not invoke natural-next. Keep resolver candidate/expiry/header/cookie data native only. Mixed-source tests belong at the queue/coordinator/service seams and must cover FIFO play-next, duplicate entries, reorder/removal, shuffle/repeat, history, recovery and restored checkpoints.

### Lyrics: lookup, persistence, Media3 clock, and UI projection

**Extend:** `BilibiliLyricProvider.java`, `LyricClockProjection.java`, `LyricPersistencePort.java`, `data/LyricRepository.java`, `controller/play.js`, and source adapters only where a bounded lyric route exists.

**Primary analog:** `BilibiliLyricProvider.java:17-27, 180-214, 352-425`; `LyricClockProjection.java:1-103`; `LyricPersistencePort.java:1-121`; `controller/play.js:920-1080`.

```java
boolean sameSelection = previous != null && previous.identity.matches(identity);
if (previous != null && playbackRevision <= previous.playbackRevision) return previous;
if (sameSelection && event != Event.SEEK && boundedPosition < previous.positionMs) {
    boundedPosition = previous.positionMs;
}
return new Projection(identity, playbackRevision, boundedPosition, boundedDuration, state, capability);
```

```javascript
return Boolean(identity && current &&
  isSameNativeLyricSelection(identity, current) &&
  Number(identity.playbackRevision) === Number(current.playbackRevision));
```

Use provider/track/part/revision plus selection/occurrence identity as the persistence and stale-reply key. A lyric is advisory: missing/plain/mismatched/timeout/login-required/unsupported updates a visible degradation but never blocks playback. Only enable a provider lyric field after source-attributed content has validated size, match/duration policy and exact active identity; never reuse Bilibili's NetEase candidate fallback as an unattributed cross-provider fallback.

### Gradle assets and test organization

**Extend:** `android/app/build.gradle` only when a new, intentional shared asset is introduced; `syncListen1Assets` is an allow-list, not a broad copy.

**Primary analog:** `android/app/build.gradle:8-40, 91-101`; `android/app/src/test/java/com/dazzlingwuming/listen2/NetEaseNativeProviderTest.java:1-96`; `app/listen1_chrome_extension/test/android_netease_typed_provider.test.js:1-240`.

```groovy
from(listen1SourceDirectory) {
    // This is deliberately an allow-list: extension metadata, developer
    // documentation, lockfiles, and tests are not packaged in the APK.
    include 'js/provider/*.js'
    include 'js/controller/*.js'
    include 'js/mobile_provider_registry.js'
}
```

Java tests inject a fake `Transport`/cookie source and assert exact routes, normalization and stable failure codes. Node tests load only the browser-safe adapter/provider in `vm`, make Axios/cookie access throw, send typed bridge replies, and assert no URL/header/cookie/candidate leaks. Add fixtures before capability bits: success, empty, malformed, timeout/cancel, authorization/unavailable, stale reply, and oversized payload.

## Shared Patterns

### Boundary validation and safe errors

**Source:** `AndroidRpcContract.java:94-135`, `NetEaseNativeProvider.java:152-230`, `mobile_provider_registry.js:426-526`.

- Exact key sets, bounded strings/numbers, fixed operation/source names, and allow-listed routes are validated before work begins.
- Map external failures to stable codes (`INVALID_PAYLOAD`, `CANCELLED`, `DEADLINE_EXCEEDED`, `PROVIDER_ERROR`, route unavailable); never surface raw exception text, signed URL, cookie, request headers, credentials or candidates.
- Cancellation aborts best-effort transport but local terminal settlement is authoritative and exactly once.

### Native ownership and asynchronous projection

**Source:** `PlaybackService.java:259-383, 566-610`; `PlaybackCoordinator.java:155-205`.

- WebView only issues semantic commands and renders snapshots.
- Media3 service owns resolver state, ExoPlayer mutation, checkpointing, audio focus and recovery.
- Persist semantic queue state before projection; projection failure is actionable state, not permission to skip an entry.

### Classic-script frontend compatibility

**Source:** `mobile_provider_registry.js:1-4, 532-548`; `instant_search.js:1-56`.

- Browser modules are globals/UMD-compatible, use the frontend's single-quote formatting, and must be added in `listen1.html` order plus the Gradle asset allow-list.
- Preserve both legacy `.success/.error` and promise handles at provider/controller boundaries while Android typed paths migrate.

## Extensions, New Files, and Collision Risks

| Area | Prefer extension or new file | Risk/control |
|---|---|---|
| RPC operation payload parsing | Extend `AndroidRpcContract.java`; only split pure source mapper/client classes | 904-line contract; one owner and narrow additions to operation/payload/response switch cases |
| New provider routes | New `Qq/Kugou/Kuwo...Provider` + mapper + tests, only after route approval | Do not duplicate `NetEaseNativeProvider` encryption/cookies blindly; route evidence is source-specific |
| Provider capability fields | Extend facade + registry | Capability enabling must be a single atomic slice with native dispatch and fixtures; prevent mismatched hard-coded source lists |
| Search/detail UI | Extend `instant_search.js` and template selectively | 683-line controller; extract a pure directory lifecycle helper if generic state would otherwise entangle Bilibili part UI |
| Player selection | Extend `l1_player.js` and policy validators | `l1_player.js` uses source regexes; centralize source/identity validation rather than scatter branches |
| Media3 resolver | New provider-specific resolver; extend `PlaybackService` dispatch only | 1128-line service; do not add provider HTTP inline, and eliminate Bilibili default fallback first |
| Lyrics | New source adapter only if route exists; extend current persistence/clock contracts | Old lyric data must never win after a selection/revision change |
| Tests | New focused `*Test.java` and `android_*_typed_provider.test.js`; extend mixed queue/lyric tests | Fixtures must test terminal behavior; do not rely on a live provider in unit tests |

## Anti-Patterns to Reject

1. Calling Axios, legacy browser provider transport, browser cookies, CORS workarounds, cleartext URLs, caller headers, arbitrary request URLs, or opaque desktop signing code from Android typed paths.
2. Turning a capability true because a search row rendered, or enabling all capability fields for a provider as one boolean.
3. Returning candidates, media URLs, response headers, cookies, resolver handles, provider request bodies, or raw provider errors to JavaScript/Room/snapshots.
4. Defaulting unknown source identities or resolvers to Bilibili; fail closed with a source-specific unavailable state.
5. Treating one provider's empty/malformed/timeout response as global empty search, losing existing rows, or applying late replies after tab/query/page/selection changes.
6. Making Howler a fallback for Android, letting page code own ExoPlayer state, or advancing queue after resolver failure.
7. Copying legacy QQ/Kugou/Kuwo provider implementation based solely on its desktop adapter rather than proving a bounded Android contract.

## No Analog Found

| File/responsibility | Reason | Planner direction |
|---|---|---|
| Approved QQ/Kugou/Kuwo Android route details | No approved typed native client exists | Research primary route evidence; otherwise preserve false capabilities and truthful UI states |
| A generalized multi-source directory controller | Bilibili detail is currently source-specific | Extract only a pure lifecycle/helper when extending `instant_search.js` would make selection identity ambiguous |

## Metadata

**Analog search scope:** Android native/provider/data/test, shared frontend provider/controller/player/bridge/tests, Gradle asset pipeline, Phase 4 artifacts
**Large-file caution:** `AndroidRpcContract.java` (904), `PlaybackService.java` (1128), `loweb.js` (1909), `lowebutil.js` (3126), `bilibili.js` (3209)
**Pattern extraction date:** 2026-09-10
