# Phase 2: Native Media3 Playback & Background Control - Research

**Researched:** 2026-08-31
**Domain:** Android native Media3 playback ownership, foreground-service lifecycle, durable playback state, and WebView projection
**Confidence:** MEDIUM

## Summary

Phase 2 must replace Android's page-owned Howler playback with one Java `MediaSessionService` that creates, owns, restores, and releases the single `ExoPlayer` and its `MediaSession`. A WebView page is a controller and renderer only: it submits bounded, high-level playback intents through the existing origin-restricted WebMessage bridge and receives revisioned snapshots. This is the only design that leaves notification, lock-screen, Bluetooth/AVRCP, page, mini-player, and activity recreation observing the same source of truth. [CITED: https://developer.android.com/media/media3/session/background-playback] [VERIFIED: android/app/src/main/java/com/dazzlingwuming/listen2/MainActivity.java:144-168]

Keep the product's FIFO play-next and real-history semantics outside Media3's ordinary playlist order. Media3 intentionally permits duplicate `MediaItem`s and can mutate a playlist while it plays, but shuffle/repeat and `seekToNextMediaItem()` operate on Media3's timeline/shuffle order. Persist the semantic queue, originating context, consumed queue entries, history cursor, repeat/shuffle mode, and position in Room; deterministically project only the next playable sequence into the service-owned player. This prevents a notification `next`, natural item end, or page command from consuming a duplicate entry twice. [CITED: https://developer.android.com/media/media3/exoplayer/playlists] [VERIFIED: app/listen1_chrome_extension/test/player_play_next_queue.test.js:36-139] [VERIFIED: app/listen1_chrome_extension/test/player_shuffle.test.js:149-245]

**Primary recommendation:** Add a single `MediaSessionService`-hosted Media3 player and a transactionally persisted `PlaybackCoordinator`; migrate the Android WebView to a narrow native-playback protocol while retaining Phase 1's typed provider descriptor as the only candidate-resolution input. [CITED: https://developer.android.com/media/media3/session/background-playback] [VERIFIED: .planning/phases/01-verified-bilibili-startup-slice/01-CONTEXT.md:32-58]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|---|---|---|---|
| Decode, render, seek, volume/mute, audio focus and noisy-output response | Android media service | OS audio stack | One native player must make all media controls and focus decisions. [CITED: https://developer.android.com/media/media3/session/background-playback] [CITED: https://developer.android.com/media/optimize/audio-focus] |
| Notification, lock screen, headset/Bluetooth controls | Android media service | Android System UI | `MediaSessionService` exposes a session to external controllers and keeps the notification synchronized from session/player state. [CITED: https://developer.android.com/media/media3/session/background-playback] |
| FIFO play-next, repeat/shuffle, previous/history and checkpoint transitions | Android data/coordinator | Android media service | Product queue semantics exceed the player timeline and require durable, serialized decisions before updating the player. [CITED: https://developer.android.com/media/media3/exoplayer/playlists] [VERIFIED: app/listen1_chrome_extension/test/player_play_next_queue.test.js:36-139] |
| Page and mini-player controls/state | Browser client | Android bridge/controller | The packaged page remains the UI shell but cannot own audio or persistent playback state. [VERIFIED: android/app/src/main/java/com/dazzlingwuming/listen2/MainActivity.java:35-68] [VERIFIED: .planning/phases/01-verified-bilibili-startup-slice/01-CONTEXT.md:79-92] |
| Bilibili descriptor/candidate resolution | Android typed provider bridge | Browser provider adapter | Phase 1 validates and returns bounded public-media fields; Phase 2 consumes that descriptor without adding arbitrary URL/header/cookie access. [VERIFIED: android/app/src/main/java/com/dazzlingwuming/listen2/AndroidRpcContract.java:15-36] [VERIFIED: .planning/phases/01-verified-bilibili-startup-slice/01-CONTEXT.md:39-49] |
| Queue/library/checkpoint persistence and migrations | Database/storage | Android media service | These are large relational user-visible records, not transient page state. [CITED: https://developer.android.com/topic/libraries/architecture/datastore] [CITED: https://developer.android.com/training/data-storage/room/migrating-db-versions] |

## Project Constraints (from AGENTS.md)

- Preserve the shared AngularJS/classic-script frontend and its deliberate script order; do not introduce a framework migration. [VERIFIED: AGENTS.md:106-108]
- Keep Android production code under `android/app/src/main/java/com/dazzlingwuming/listen2`; keep URL/request validation pure Java and JVM-testable. [VERIFIED: AGENTS.md:15-16] [VERIFIED: AGENTS.md:109-110]
- Never weaken the WebView boundary: no arbitrary URL, caller header, cookie control, cleartext exception, or arbitrary local-file access. [VERIFIED: AGENTS.md:16-19] [VERIFIED: AGENTS.md:228-230]
- Keep playback, background lifecycle, audio focus, and notifications native rather than relying on a WebView surviving. [VERIFIED: AGENTS.md:17-17]
- Do not expose cookies, tokens, API keys, signed media URLs, raw exceptions, or user data in code, logs, backups, APK plaintext, or planning evidence. [VERIFIED: AGENTS.md:18-18] [VERIFIED: AGENTS.md:148-163]
- Do not hand-edit generated Android outputs; update the Gradle asset allow-list when shared web assets change. [VERIFIED: AGENTS.md:110-110] [VERIFIED: AGENTS.md:240-240]
- Android emulator end-to-end evidence is mandatory; JVM tests or APK assembly alone do not prove the feature. [VERIFIED: AGENTS.md:21-21] [VERIFIED: AGENTS.md:248-250]
- Do not merge or deploy; this research recommends only debug/release-like validation. [VERIFIED: AGENTS.md:22-22]

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|---|---|---|
| PLAY-001 | Single native Media3 owner; page/mini-player/notification share playback state. | `MediaSessionService` + `PlaybackCoordinator` + revisioned snapshot protocol. |
| PLAY-003 | Unified basic controls and bounded media-failure retry. | Player/MediaController commands; retain descriptor candidate context, do not auto-skip. |
| PLAY-004 | Visible duplicate-preserving FIFO play-next queue with reorder/remove/restore. | Room queue rows with unique occurrence IDs and coordinator projection. |
| PLAY-005 | Durable shuffle/repeat/previous semantics without queue double-consumption. | Persist semantic history/shuffle order; reconcile player callbacks transactionally. |
| PLAY-006 | Background, lifecycle, focus/noisy/headset/Bluetooth and legal foreground-service behavior. | MediaSessionService manifest/service policy + emulator instrumentation scenarios. |
| DATA-001 | Migration-safe durable user-visible state; DataStore only for small non-sensitive settings. | Room schema/migration test plan; singleton small-settings store. |
</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why standard |
|---|---:|---|---|
| `androidx.media3:media3-exoplayer` | `1.9.4` | Service-owned audio player and player event source. | This is the newest verified line whose official Google Maven AAR metadata allows the project's current `compileSdk 35`; current stable `1.11.0` requires `minCompileSdk=36`. [CITED: https://developer.android.com/jetpack/androidx/releases/media3] [VERIFIED: Google Maven AAR metadata, 2026-08-31] |
| `androidx.media3:media3-session` | `1.9.4` | `MediaSessionService`, system media session, notification/controller integration. | Keep all Media3 artifacts on the same API-35-compatible line; Android's background-playback guide specifies a `MediaSessionService` around the player/session. [CITED: https://developer.android.com/media/media3/session/background-playback] [VERIFIED: `.planning/research/STACK.md`] |
| `androidx.room:room-runtime` + `room-compiler` | `2.8.4` | Durable queue/context/checkpoint records and migration path. | Official Room release notes list `2.8.4`; Room is intended for relational data access. [CITED: https://developer.android.com/jetpack/androidx/releases/room] [CITED: https://developer.android.com/training/data-storage/room] |

### Supporting

| Library | Version | Purpose | When to use |
|---|---:|---|---|
| `androidx.room:room-testing` | `2.8.4` | Device migration verification from exported historical schemas. | Add with the initial schema, before any production database version ships. [CITED: https://developer.android.com/training/data-storage/room/migrating-db-versions] |
| Android platform `SharedPreferences` behind `PlaybackSettingsStore` | platform API | Exactly `volumePercent` (integer 0–100) and `muted` (boolean), using one application-scoped named file. | Resolved choice: avoid a new DataStore dependency in this Java-only phase; the wrapper exposes a migration seam and rejects lists, metadata, transport data, and secrets. [VERIFIED: DATA-001 permits an equivalent settings store] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|---|---|---|
| `MediaSessionService` | Activity-local ExoPlayer or WebView/Howler | Rejected: activity/page lifetime cannot safely own background playback, notification, or external media controls. [CITED: https://developer.android.com/media/media3/session/background-playback] |
| Room checkpoint model | `localStorage`/DataStore for full queues | Rejected: the phase requires large, ordered, partial-update relational records; DataStore is intended for small settings and lacks partial updates/referential integrity. [CITED: https://developer.android.com/topic/libraries/architecture/datastore] |
| Semantic queue coordinator | Raw Media3 playlist only | Rejected: Media3's shuffle/repeat behavior is timeline-based, whereas Listen2 has an independent FIFO queue and explicit playback history. [CITED: https://developer.android.com/media/media3/exoplayer/playlists] [VERIFIED: app/listen1_chrome_extension/test/player_play_next_queue.test.js:36-139] |

**Installation (Groovy):**

```groovy
def media3Version = '1.9.4'
def roomVersion = '2.8.4'
implementation "androidx.media3:media3-exoplayer:$media3Version"
implementation "androidx.media3:media3-session:$media3Version"
implementation "androidx.room:room-runtime:$roomVersion"
annotationProcessor "androidx.room:room-compiler:$roomVersion"
testImplementation "androidx.room:room-testing:$roomVersion"
```

The artifact coordinates and Java-only `annotationProcessor` wiring are confirmed by official Android documentation. Media3 `1.9.4` is intentionally below the current stable line: official AAR metadata reports `minCompileSdk=35` for `1.9.4` and `36` for `1.11.0`, while this app compiles against API 35. Keep the first implementation task's dependency-resolution build as the integration check, and reassess the latest Media3 only with an explicitly planned API-36 toolchain upgrade. Phase 2 adds no DataStore artifact: `PlaybackSettingsStore` wraps one platform `SharedPreferences` file for bounded volume/mute only. [CITED: https://developer.android.com/jetpack/androidx/releases/media3] [CITED: https://developer.android.com/jetpack/androidx/releases/room] [VERIFIED: Google Maven AAR metadata, 2026-08-31]

## Package Legitimacy Audit

| Package | Registry/source | Verdict | Disposition |
|---|---|---|---|
| Media3 ExoPlayer/session | Official AndroidX Media3 release page | Officially documented | Approved. [CITED: https://developer.android.com/jetpack/androidx/releases/media3] |
| Room runtime/compiler/testing | Official AndroidX Room release page | Officially documented | Approved. [CITED: https://developer.android.com/jetpack/androidx/releases/room] |
| DataStore Preferences | Official Android DataStore guide | Officially documented but not selected | Deferred: Phase 2 uses the platform settings wrapper permitted by DATA-001 and introduces no DataStore package. |

The GSD package-legitimacy seam accepts only npm, PyPI, and crates, not Maven coordinates; its invocation for this Maven-only phase fails by contract. Use Gradle resolution plus the official AndroidX coordinates above in the first implementation task. [VERIFIED: gsd-tools package-legitimacy usage output, 2026-08-31]

## Architecture Patterns

### System Architecture Diagram

```text
Packaged WebView page / mini-player
   |  bounded playback-intent (track occurrence or control command)
   v
existing WebMessage listener -> PlaybackBridgePolicy -> PlaybackBridgeController
                                                    |  reject stale/bad page generation
                                                    v
                                      PlaybackCoordinator (single serialized command lane)
                                      |                     |
                         Room transaction/checkpoint         | project/reconcile
                                      |                     v
                                      |              ExoPlayer + MediaSession
                                      |                     |
                                      |          MediaSessionService foreground lifecycle
                                      |             |             |             |
                                      v             v             v             v
                               durable state    notification  lock screen  headset/Bluetooth
                                      ^
                                      | revisioned, sanitized PlaybackSnapshot
                                      +----------- WebMessage reply/event -----------+
```

The service owns every `Player` mutation. The page never sends a URL, header, cookie, `MediaItem`, queue index, or raw player state; it sends an allow-listed intent referring to a native-issued opaque occurrence/track key. [CITED: https://developer.android.com/media/media3/session/control-playback] [VERIFIED: android/app/src/main/java/com/dazzlingwuming/listen2/AndroidRpcContract.java:15-36]

### Recommended Project Structure and File Map

```text
android/app/src/main/java/com/dazzlingwuming/listen2/
├── PlaybackService.java                 # sole MediaSessionService / ExoPlayer owner
├── PlaybackCoordinator.java              # serialized intent, transition, retry, checkpoint logic
├── PlaybackBridgeController.java         # bridge adapter: intent in, snapshot out
├── PlaybackBridgePolicy.java             # pure Java origin/page/revision/schema validation
├── PlaybackSnapshot.java                 # sanitized, versioned page projection
├── PlaybackQueueEngine.java              # FIFO occurrence IDs, return context, shuffle/history semantics
├── PlaybackCheckpointRepository.java     # Room read/write boundary
├── Listen2Database.java                  # Room composition root/version/migrations
├── playback/                             # Room entities/DAOs/migrations only
└── PlaybackSettingsStore.java             # one bounded application-scoped SharedPreferences adapter

android/app/src/test/java/com/dazzlingwuming/listen2/
├── PlaybackQueueEngineTest.java
├── PlaybackBridgePolicyTest.java
├── PlaybackCoordinatorTest.java
└── PlaybackMigrationTest.java

android/app/src/androidTest/java/com/dazzlingwuming/listen2/
├── PlaybackServiceInstrumentationTest.java
└── PlaybackRecoveryInstrumentationTest.java
```

File names are recommendations, not existing paths. Put them in the existing Android package, preserve pure-Java policy testability, and do not expand `MainActivity` beyond WebView/UI lifecycle plus controller connection. [ASSUMED] [VERIFIED: android/app/src/main/java/com/dazzlingwuming/listen2/MainActivity.java:35-68] [VERIFIED: AGENTS.md:15-16] [VERIFIED: AGENTS.md:109-110]

### Pattern 1: One service owner, many short-lived controllers

Create the ExoPlayer and MediaSession in `PlaybackService.onCreate`, return the same session from `onGetSession`, and release both in `onDestroy`. The activity binds a `MediaController` only to issue bounded commands/observe state; it does not instantiate a player. Media3 documents this service lifecycle specifically for background playback and external controls. [CITED: https://developer.android.com/media/media3/session/background-playback] [CITED: https://developer.android.com/reference/androidx/media3/session/MediaSessionService]

**Manifest guidance:** declare `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MEDIA_PLAYBACK`, and a service whose `foregroundServiceType` includes `mediaPlayback`; do not start playback FGS from `BOOT_COMPLETED` on target Android 15. The current manifest only declares internet access, so this is an intentional, reviewable delta. [CITED: https://developer.android.com/media/media3/session/background-playback] [CITED: https://developer.android.com/about/versions/15/changes/foreground-service-types] [VERIFIED: android/app/src/main/AndroidManifest.xml:1-37]

### Pattern 2: Semantic queue before player timeline

Represent each visible FIFO entry as a unique `occurrenceId` plus track reference, so repeated tracks remain distinct. On an accepted next/end event, the coordinator atomically marks exactly one queued occurrence consumed, records prior context/history, projects the new current item into Media3, then emits one snapshot revision. If the FIFO becomes empty, it restores the saved base playlist/mode context before asking Media3 for the next item. [VERIFIED: app/listen1_chrome_extension/test/player_play_next_queue.test.js:36-139] [ASSUMED]

Use Media3's playlist APIs for the service's projected timeline only. It officially supports multiple identical `MediaItem`s plus adding, moving, and removing during playback, and reports item transitions through a listener. Do not use Java object identity or provider track ID as the unique queue entry identity. [CITED: https://developer.android.com/media/media3/exoplayer/playlists] [ASSUMED]

### Pattern 3: Persist a checkpoint, restore defensively

Checkpoint after accepted logical transitions, seek completion, mode/queue mutations, and bounded progress intervals—not every raw position callback. Persist a schema-versioned snapshot that contains only non-secret domain references, queue occurrences/order, base-playlist reference/order, history cursor, mode, volume/mute, current occurrence, position, and `playWhenReady`. Resolve expired provider media again from the Phase 1 descriptor path during restoration; never store signed URLs or credentials. [VERIFIED: .planning/phases/01-verified-bilibili-startup-slice/01-CONTEXT.md:39-49] [ASSUMED]

Implement `MediaSession.Callback.onPlaybackResumption` from the latest valid checkpoint, then validate each referenced item and degrade to a paused, actionable recovery state when resolution fails. Media3 defines this callback as the place to supply the initial playlist/start position and additional repeat/shuffle setup. [CITED: https://developer.android.com/reference/androidx/media3/session/MediaSession.Callback]

### Pattern 4: Page protocol is commands plus snapshots, never player plumbing

Add a new playback operation family to the Phase 1 versioned RPC bridge, not a second global JS interface. Requests carry existing page generation/correlation information and one allow-listed intent; responses/events carry a monotonically increasing snapshot revision. Drop stale page generation and stale snapshot revisions on both sides. Keep current v1/v2 provider routes unchanged; native playback commands are a separate bounded contract. [VERIFIED: android/app/src/main/java/com/dazzlingwuming/listen2/AndroidRpcContract.java:19-36] [VERIFIED: app/listen1_chrome_extension/js/lowebutil.js:139-155] [ASSUMED]

### Explicit Phase 1 Integration Seams

| Phase 1 seam | Phase 2 action | Boundary that must remain true |
|---|---|---|
| Typed `bilibili.audio.manifest` request/reply | Feed the selected part's validated descriptor into the native resolver only after a user playback intent. | No arbitrary URL/header/cookie capability is introduced. [VERIFIED: android/app/src/main/java/com/dazzlingwuming/listen2/AndroidRpcContract.java:32-36] |
| `Listen2AndroidHttpAdapter` response identity | Reuse its listener/page epoch discipline for native playback snapshots or add a sibling adapter with identical stale-message behavior. | A destroyed/reloaded page cannot mutate service state or receive a privileged late reply. [VERIFIED: app/listen1_chrome_extension/js/lowebutil.js:210-360] [VERIFIED: android/app/src/main/java/com/dazzlingwuming/listen2/MainActivity.java:144-168] |
| Current Howler foreground proof | Retire Android's Howler media ownership after Media3 command/snapshot parity is proven; preserve the UX distinction between resolving, playing, paused, and actionable error. | Never run Howler and ExoPlayer for the same Android track. [VERIFIED: .planning/phases/01-verified-bilibili-startup-slice/01-06-SUMMARY.md:38-47] |
| Bounded CDN candidates | Native resolution uses ordered candidates only for the current semantic occurrence and a finite retry count; emits an error snapshot without silently skipping. | Failure retains the selected current track/context. [VERIFIED: app/listen1_chrome_extension/test/android_bilibili_foreground_playback.test.js:107-125] [VERIFIED: .planning/phases/01-verified-bilibili-startup-slice/01-CONTEXT.md:54-58] |
| `MainActivity` teardown/reload | WebView destruction disconnects the page controller only; it must not release or pause a continuing service player. | Service remains independent, yet bridge callbacks for the retiring page are inert. [VERIFIED: android/app/src/main/java/com/dazzlingwuming/listen2/MainActivity.java:144-168] |

## Don't Hand-Roll

| Problem | Don't build | Use instead | Why |
|---|---|---|---|
| Background player, lock screen/media-button discovery, notification synchronization | Custom `Service` + `MediaSessionCompat` notification plumbing | Media3 `MediaSessionService` and `MediaSession` | The supported component already models controllers, service lifecycle, and media notification updates. [CITED: https://developer.android.com/media/media3/session/background-playback] |
| Decode/seek/buffer/audio-focus integration | WebView audio shim or bespoke `AudioTrack` player | Media3 ExoPlayer with audio attributes/focus handling | ExoPlayer is the Media3 player; Android guidance advises letting it manage focus when configured to do so. [CITED: https://developer.android.com/media/media3/session/control-playback] [CITED: https://developer.android.com/media/optimize/audio-focus] |
| SQL schema/migration checking | Ad hoc JSON checkpoints or destructive database reset | Room entities/DAOs/migrations/exported schemas + migration tests | Room has a defined migration test path; destructive reset loses durable queue/library state. [CITED: https://developer.android.com/training/data-storage/room/migrating-db-versions] |
| Small setting consistency | Scattered preference access or multiple files | One application-scoped `PlaybackSettingsStore` over one named `SharedPreferences` file | Phase 2 has only bounded volume/mute settings; the wrapper keeps a later DataStore migration local and rejects relational or sensitive values. |

## Common Pitfalls

### Pitfall 1: Dual playback owners

**What goes wrong:** Howler continues playing while Media3 owns notification/lock-screen state, producing double audio or mismatched play/pause.
**How to avoid:** Introduce an Android platform-player facade; after the cutover flag, browser code only sends intent and renders snapshots. Add a test that no Android route creates `Howl` after a service session is ready. [VERIFIED: app/listen1_chrome_extension/test/android_bilibili_foreground_playback.test.js:170-180] [ASSUMED]

### Pitfall 2: Treating Media3's playlist as the product queue

**What goes wrong:** shuffle/timeline modifications consume or reorder play-next entries, and duplicate tracks become indistinguishable.
**How to avoid:** persist unique queue occurrences and apply coordinator transactions before each player mutation. Test natural end, rapid next, retry, previous, duplicate items, remove/reorder, and restart. [CITED: https://developer.android.com/media/media3/exoplayer/playlists] [VERIFIED: app/listen1_chrome_extension/test/player_play_next_queue.test.js:36-139]

### Pitfall 3: A foreground service that remains expensive while idle

**What goes wrong:** an idle notification/service survives after meaningful playback has stopped.
**How to avoid:** rely on the documented MediaSessionService foreground behavior, release/clear the player when the product has no active playback context, and make stop/release idempotent. Media3 automatically leaves foreground after more than ten minutes paused/stopped/failed without interaction; product verification must still assert the service's observed state. [CITED: https://developer.android.com/media/media3/session/background-playback]

### Pitfall 4: Checkpointing URLs or secrets

**What goes wrong:** expired signed URLs fail on process recovery, or sensitive transport/session data leaks into Room, bridge snapshots, backups, or logs.
**How to avoid:** checkpoint provider/domain identifiers and playback semantics only; re-resolve a fresh allowed descriptor at restore. [VERIFIED: .planning/phases/01-verified-bilibili-startup-slice/01-CONTEXT.md:39-49] [VERIFIED: AGENTS.md:18-19]

### Pitfall 5: Depending on Activity or renderer lifetime

**What goes wrong:** rotation, renderer termination, and low-memory recovery release the player or allow stale page callbacks to win.
**How to avoid:** service state survives controller disconnection; bridge uses page generation/revision rejection; checkpoint writes are service-owned. [CITED: https://developer.android.com/media/media3/session/background-playback] [VERIFIED: android/app/src/main/java/com/dazzlingwuming/listen2/MainActivity.java:144-168]

## Code Examples

### Service lifecycle shape

```java
// Names are proposed; exact implementation is a planning decision.
public final class PlaybackService extends MediaSessionService {
    @Override public void onCreate() {
        super.onCreate();
        // Create exactly one ExoPlayer and one MediaSession here.
    }

    @Override public MediaSession onGetSession(MediaSession.ControllerInfo controllerInfo) {
        // Return the single authorized session.
        return null; // Replace in implementation.
    }

    @Override public void onDestroy() {
        // Persist final checkpoint, then release session and player exactly once.
        super.onDestroy();
    }
}
```

This illustrates the documented lifecycle placement only; it is intentionally non-compilable until the service's controller authorization and coordinator dependencies are designed. [CITED: https://developer.android.com/media/media3/session/background-playback] [ASSUMED]

### Queue transition invariant

```text
accepted intent/event
  -> validate occurrence/current revision
  -> one Room transaction: mutate semantic queue + history + checkpoint revision
  -> project selected occurrence into the single Media3 timeline
  -> publish one sanitized snapshot revision
```

The transaction-before-projection ordering is the phase recommendation needed to prevent duplicate queue consumption across page, notification, and natural-end races. [ASSUMED]

## State of the Art

| Old approach | Current approach | Impact |
|---|---|---|
| Page-owned Howler proof in a foreground WebView | Native Media3 service/session owner with page controller projection | Background/lock-screen/notification controls can converge on one player state. [VERIFIED: .planning/phases/01-verified-bilibili-startup-slice/01-06-SUMMARY.md:38-47] [CITED: https://developer.android.com/media/media3/session/background-playback] |
| Android legacy media APIs / handcrafted notification plumbing | Media3 `MediaSessionService` | Android documents it for background playback and session-connected external clients. [CITED: https://developer.android.com/media/media3/session/background-playback] |
| Page `localStorage` queue restore | Room checkpoint plus MediaSession playback resumption | Recovery can be service-owned and migration-testable instead of tied to one renderer. [CITED: https://developer.android.com/reference/androidx/media3/session/MediaSession.Callback] [CITED: https://developer.android.com/training/data-storage/room/migrating-db-versions] |

## Assumptions Log

| # | Claim | Section | Risk if wrong |
|---|---|---|---|
| A1 | One semantic queue coordinator can atomically persist a transition before projecting it to Media3. | Architecture Pattern 2 | Needs implementation proof under concurrent controller/player callbacks. |
| A2 | The platform settings wrapper is sufficient for the exact Phase-2 `volumePercent` and `muted` values. | Resolved Questions | RESOLVED — no DataStore dependency; tests reject every other key/value shape. |
| A3 | The proposed file/class names and snapshot schema are appropriate. | File Map / Protocol | Planner must refine names and fields without changing security/ownership boundaries. |
| A4 | The player can re-resolve every restored public item via the Phase 1 descriptor route without storing signed URLs. | Restore pattern | Live provider expiry/authorization needs fixture plus emulator proof. |

## Resolved Questions

1. **Small settings store — RESOLVED.** Phase 2 adds no DataStore dependency. `PlaybackSettingsStore` is one application-scoped wrapper over one named platform `SharedPreferences` file and accepts exactly `volumePercent` (integer 0–100) and `muted` (boolean). Queue, mode, history, checkpoint, metadata, provider identity, lists, transport data, and secrets remain in Room or transient memory. The wrapper is the migration seam if a later phase has enough small settings to justify DataStore.

2. **Notification actions and artwork — RESOLVED.** Use the standard Media3 session notification. Expose play/pause for an active occurrence and previous/next only when the native snapshot advertises those actions; do not add custom notification seek, volume, or mute buttons. Lock-screen/system timeline seek is available only through the session when duration and seekability are known. Phase 2 notification, lock screen, page, and mini-player use sanitized title/artist/source plus the same bundled neutral artwork placeholder. No page/provider artwork URL, bitmap, fetch request, candidate, or header crosses the playback bridge. A later bounded artwork owner may replace the placeholder through a separately planned contract.

3. **Process-death induction — RESOLVED.** Use a two-stage host-driven API-35 recipe. Stage A instrumentation seeds a deterministic current occurrence, duplicate FIFO queue, mode, accepted history cursor, and nonzero position, waits for a committed checkpoint, and reports only checkpoint revision plus bounded semantic assertions. The host runs `adb shell am force-stop com.dazzlingwuming.listen2.debug`, verifies `pidof` is empty, relaunches with `adb shell am start -W -S -n com.dazzlingwuming.listen2.debug/.MainActivity`, waits for page/controller reconnect, and runs Stage B instrumentation. Stage B asserts a paused/actionable restore of the same occurrence, queue order, mode, history cursor, a position within five seconds of the Stage-A checkpoint, and a revision not older than Stage A; Room/snapshot/evidence scans must find no signed candidate or transport material. The host command owns cleanup and fails on any missing stage or identity mismatch.

## Environment Availability

| Dependency | Required by | Available | Version | Fallback |
|---|---|---:|---|---|
| Java 17 runtime | Gradle/Android unit and instrumentation tests | ✓ | `/opt/homebrew/opt/openjdk@17` | Set `JAVA_HOME` to this JDK for Android commands. [VERIFIED: orchestrator correction, 2026-08-31] |
| Gradle | Android build | ✓ | CI-pinned `8.10.2` at `/tmp/listen2-ci.CBSD9n/gradle-8.10.2/bin/gradle` | Use that pinned executable for reproducible verification. [VERIFIED: orchestrator correction, 2026-08-31] [VERIFIED: .github/workflows/android-apk.yml:40-47] |
| Android SDK | Emulator/build tooling | ✓ | `/opt/homebrew/share/android-commandlinetools` | Use this SDK with the JDK 17 environment. [VERIFIED: orchestrator correction, 2026-08-31] |
| ADB/emulator | Required Phase 2 E2E gate | ✓ | `emulator-5554`, API 35, arm64 | Run connected tests and record the required runtime evidence on this booted emulator. [VERIFIED: orchestrator correction, 2026-08-31] [VERIFIED: AGENTS.md:21-21] |
| Node/npm | Shared frontend contract tests | ✓ | Node `v24.15.0`, npm `11.12.1` | — [VERIFIED: environment audit, 2026-08-31] |

**Missing dependencies with no fallback:** None currently identified for Phase 2 execution. The API-35 emulator remains a mandatory evidence gate, not an optional fallback. [VERIFIED: orchestrator correction, 2026-08-31] [VERIFIED: AGENTS.md:21-21]

## Validation Architecture

### Test Framework

| Property | Value |
|---|---|
| JVM framework | JUnit `4.13.2`; Android test runner `1.6.2`. [VERIFIED: android/app/build.gradle:89-96] |
| Existing Android command | `gradle --no-daemon :app:testDebugUnitTest :app:assembleDebug`. [VERIFIED: android/README.md:28-37] |
| Existing device-test seam | `Phase01WebViewInstrumentationTest` under `androidTest`; it establishes API-35 device-test precedent. [VERIFIED: android/app/src/androidTest/java/com/dazzlingwuming/listen2/Phase01WebViewInstrumentationTest.java:1-260] |
| Shared frontend contract suite | `npm --prefix app/listen1_chrome_extension test`. [VERIFIED: README.md:192-202] |

### Phase Requirements → Test Map

| Req ID | Behavior | Test type | Automated command | File exists? |
|---|---|---|---|---|
| PLAY-001 | Exactly one service-owned player/session; page/notification snapshots agree | instrumentation + fake-player unit | `gradle --no-daemon :app:connectedDebugAndroidTest` | ❌ Wave 0 |
| PLAY-003 | play/pause/seek/volume/mute/previous/next and no unintended skip on media error | coordinator unit + instrumentation | `gradle --no-daemon :app:testDebugUnitTest :app:connectedDebugAndroidTest` | ❌ Wave 0 |
| PLAY-004 | FIFO duplicates/reorder/remove/clear/restart return context | queue-engine + Room migration/device test | `gradle --no-daemon :app:testDebugUnitTest :app:connectedDebugAndroidTest` | ❌ Wave 0 |
| PLAY-005 | shuffle/repeat/previous/history persists without double consume | deterministic queue-engine unit + restore instrumentation | `gradle --no-daemon :app:testDebugUnitTest :app:connectedDebugAndroidTest` | ❌ Wave 0 |
| PLAY-006 | screen off, noisy/focus, Bluetooth controls, renderer/activity/process recovery, idle FGS exit | emulator instrumentation/manual evidence | `gradle --no-daemon :app:connectedDebugAndroidTest` | ❌ Wave 0 |
| DATA-001 | Room schema migration and only small settings in DataStore | migration device test + repository unit | `gradle --no-daemon :app:connectedDebugAndroidTest` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** affected Android JVM tests plus shared frontend contract tests. [VERIFIED: android/README.md:28-42] [VERIFIED: README.md:192-202]
- **Per wave merge:** Android JVM/build plus API-35 connected tests on the currently booted `emulator-5554`. [VERIFIED: orchestrator correction, 2026-08-31] [VERIFIED: .planning/phases/01-verified-bilibili-startup-slice/01-05-SUMMARY.md:37-55]
- **Phase gate:** record a timestamped emulator journey for page, mini-player, notification/lock-screen, screen-off, noisy/focus/headset/Bluetooth, rotation/renderer loss, process recovery, and idle-service stop; static tests/builds are insufficient. [VERIFIED: AGENTS.md:21-21]

### Wave 0 Gaps

- [ ] `PlaybackQueueEngineTest.java` — duplicate FIFO, return context, shuffle/repeat/previous invariants.
- [ ] `PlaybackBridgePolicyTest.java` — origin, schema, stale page/revision and no raw URL/header/cookie inputs.
- [ ] `PlaybackCoordinatorTest.java` — serialized transition/retry/checkpoint transaction invariants with fake player.
- [ ] `PlaybackMigrationTest.java` — export Room schema and migrate retained pre-release fixtures on device.
- [ ] `PlaybackServiceInstrumentationTest.java` — one player/session, notification/controller and focus/noisy events.
- [ ] `PlaybackRecoveryInstrumentationTest.java` — activity/renderer/process recovery and no double queue consumption.
- [ ] Reuse the available JDK 17, pinned Gradle 8.10.2, Android SDK, and booted API-35 emulator when executing the above; capture the exact command/environment in Phase 2 evidence. [VERIFIED: orchestrator correction, 2026-08-31]

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard control |
|---|---|---|
| V2 Authentication | Later Phase 5 primarily | Phase 2 stores no authentication material; no credentials cross bridge/checkpoint. [VERIFIED: AGENTS.md:18-18] |
| V3 Session Management | Yes, boundary only | Re-resolve authorized media on restore; do not persist cookies/signed URLs. [VERIFIED: .planning/phases/01-verified-bilibili-startup-slice/01-CONTEXT.md:39-49] |
| V4 Access Control | Yes | Service validates controller/bridge commands and exposes only allow-listed high-level operations. [CITED: https://developer.android.com/media/media3/session/control-playback] [ASSUMED] |
| V5 Input Validation | Yes | Pure Java playback bridge policy validates origin, page generation, schema, occurrence key, bounds, and revision. [VERIFIED: android/app/src/main/java/com/dazzlingwuming/listen2/AndroidRpcContract.java:55-92] [ASSUMED] |
| V6 Cryptography | No new Phase 2 secret store | Do not add custom cryptography or move future credentials out of their later secure-storage phase. [VERIFIED: AGENTS.md:18-18] |

### Known Threat Patterns

| Pattern | STRIDE | Standard mitigation |
|---|---|---|
| Page sends attacker-selected stream URL/headers/cookies | Tampering / information disclosure | Intent-only bridge; native resolves allowed descriptor path; do not expose transport controls. [VERIFIED: android/app/src/main/java/com/dazzlingwuming/listen2/AndroidRpcContract.java:15-36] |
| Old WebView/renderer sends late command or receives new state | Tampering | Existing page epoch correlation plus new snapshot revision rejection. [VERIFIED: app/listen1_chrome_extension/js/lowebutil.js:210-360] [ASSUMED] |
| Notification/controller advances queue twice | Tampering / integrity | One coordinator command lane and one durable transition transaction. [ASSUMED] |
| Signed URL/token appears in durable state or diagnostics | Information disclosure | Persist references only and use sanitized error/snapshot shapes. [VERIFIED: AGENTS.md:18-18] |
| Illegal background service startup on target Android 15 | Denial of service | User-driven/session-resumption lifecycle only; never launch media-playback FGS from `BOOT_COMPLETED`. [CITED: https://developer.android.com/about/versions/15/changes/foreground-service-types] |

## Sources

### Primary

- [Android Media3 background playback](https://developer.android.com/media/media3/session/background-playback) — `MediaSessionService`, manifest permissions/type, notification, foreground behavior.
- [Android Media3 playlists](https://developer.android.com/media/media3/exoplayer/playlists) — duplicate media items, runtime playlist edits, shuffle/repeat semantics.
- [MediaSession callback reference](https://developer.android.com/reference/androidx/media3/session/MediaSession.Callback) — playback resumption contract.
- [Android audio focus](https://developer.android.com/media/optimize/audio-focus) — focus behavior and ExoPlayer guidance.
- [Android foreground-service type changes](https://developer.android.com/about/versions/15/changes/foreground-service-types) — Android 15 media-playback restriction.
- [Media3 release notes](https://developer.android.com/jetpack/androidx/releases/media3), [Room release notes](https://developer.android.com/jetpack/androidx/releases/room), and [DataStore guide](https://developer.android.com/topic/libraries/architecture/datastore) — current coordinates and storage boundaries.

### Codebase

- Phase 1 typed bridge and scope: `.planning/phases/01-verified-bilibili-startup-slice/01-CONTEXT.md`, `01-05-SUMMARY.md`, `01-06-SUMMARY.md`.
- Current Android host/build/security boundary: `MainActivity.java`, `AndroidRpcContract.java`, `android/app/build.gradle`, `AndroidManifest.xml`, and `android/README.md`.
- Desktop behavioral contracts: `player_play_next_queue.test.js`, `player_shuffle.test.js`, `player_recovery.test.js`, and `l1_player.js`.

## Metadata

**Confidence breakdown:**

- Standard stack: **MEDIUM** — versions and artifacts are from current official Android documentation; Java-specific DataStore wiring remains a compile-time verification item.
- Architecture: **MEDIUM** — Media3 service/session responsibilities are official, while Listen2 semantic-queue projection is a tailored design that needs deterministic and emulator evidence.
- Pitfalls: **MEDIUM** — grounded in official lifecycle/playlist rules and current Phase 1/desktop contracts; live provider and device behavior remain unverified.

**Research date:** 2026-08-31
**Valid until:** 2026-09-07 (AndroidX/foreground-service guidance is fast-moving).
