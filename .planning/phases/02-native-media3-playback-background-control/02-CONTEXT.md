# Phase 2: Native Media3 Playback & Background Control - Context

**Gathered:** 2026-08-31
**Status:** Ready for planning

<domain>
## Phase Boundary

Replace Android's temporary page-owned foreground audio with one native Media3 owner and make the page, mini-player, queue, notification, lock screen, headset/Bluetooth controls, and recovery paths observe the same durable playback state. This phase owns basic controls, bounded candidate retry, duplicate-preserving play-next behavior, shuffle/repeat/previous semantics, legal background execution, and migration-safe playback checkpoints. Provider expansion, full lyric synchronization, accounts, offline downloads, MV, effects, loudness, and AI remain in their assigned later phases.

</domain>

<decisions>
## Implementation Decisions

### Sole playback ownership
- **D-01:** Android uses one `MediaSessionService`-owned ExoPlayer/MediaSession. The WebView and Activity are controllers/renderers only and never create a second Android audio owner after cutover. Desktop and browser Howler behavior remains unchanged.
- **D-02:** Use the API-35-compatible Media3 `1.9.4` line for all Media3 artifacts. Current stable `1.11.0` requires compile SDK 36 and is not introduced without an explicit toolchain phase.
- **D-03:** Activity/WebView teardown disconnects only that page controller. It does not release or pause service-owned playback. The service leaves foreground/high-cost state when no meaningful playback context remains.

### Typed playback protocol
- **D-04:** Extend the existing origin-restricted WebMessage/RPC architecture with allow-listed playback intents and revisioned sanitized snapshots. Do not add `addJavascriptInterface`, arbitrary URLs, caller headers/cookies, raw `MediaItem` control, or a second message bridge.
- **D-05:** Intents refer to native-issued track/occurrence identities and existing page epochs. Native code rejects stale page generations, invalid revisions, unsupported commands, oversized payloads, and replies after teardown.
- **D-06:** Phase 1's typed provider descriptor is the only candidate-resolution seam. Signed candidates remain transient; Room, page snapshots, logs, backups, and evidence store provider/domain identities and playback semantics, never signed URLs or credentials.

### Queue and playback semantics
- **D-07:** Play-next is a visible FIFO semantic queue outside the raw Media3 timeline. Every entry has a unique occurrence ID so duplicate tracks remain distinct; reorder, remove, and consume operate on occurrences, not provider track IDs.
- **D-08:** Consuming the last play-next occurrence returns to the saved originating playlist/context and playback mode. Natural completion, page next, notification next, and headset next share one serialized transition path and cannot double-consume an entry.
- **D-09:** Previous follows real accepted playback history. Shuffle order, repeat mode, current occurrence, base context, queue order, and history cursor survive restart without inserting queue-only tracks into the originating playlist.
- **D-10:** Basic controls are play, pause, seek, previous, next, volume, and mute. A bounded current-track candidate retry may recover the same occurrence; failure stays on the selected track with an actionable state and never silently skips.

### Durable state and recovery
- **D-11:** Room is the migration-safe source for playback checkpoints and ordered relational state. Use unique occurrence keys and transactions. Small non-sensitive preferences may use one application-scoped settings adapter only when the implementation spike proves the Java API and dependency cost worthwhile.
- **D-12:** Checkpoint logical transitions, queue/mode edits, completed seeks, and bounded position intervals—not every position callback. Restore defensively to a paused/actionable state when a provider descriptor cannot be refreshed.
- **D-13:** Media3 handles audio focus through audio attributes; wired/Bluetooth noisy transitions, screen-off, renderer loss, Activity recreation, and low-memory/process recovery must have explicit tested terminal behavior. Playback resumption never relies on a stale WebView.

### Phone surfaces and interaction
- **D-14:** The phone mini-player and player detail render one native snapshot: artwork/metadata, resolving/playing/paused/error, progress/duration, mode, and available controls. The queue is a phone-appropriate sheet/panel with 48dp targets, drag/reorder alternative controls, remove/clear confirmation, and duplicate entries visibly distinguishable.
- **D-15:** Notification and lock-screen metadata/actions derive from the same MediaSession state. Unsupported or temporarily unavailable actions are disabled/omitted consistently across all surfaces.
- **D-16:** System Back closes queue/player detail before leaving the app; rotation and renderer recreation restore the same native snapshot without restarting audio or duplicating commands.

### Verification evidence
- **D-17:** Pure Java tests prove queue/history/mode transitions, duplicate identities, retry bounds, stale revisions, serialization, and checkpoint schema behavior. Room migration tests start with the first schema.
- **D-18:** API-35 instrumentation/device evidence proves one player, page/notification/session agreement, background playback, seek/control parity, audio focus/noisy handling, rotation/renderer loss, process recovery, and foreground-service release when idle.
- **D-19:** Phase 2 cannot be accepted from build/JVM tests alone. Evidence records exact git/APK identity and must not contain media URLs, cookies, credentials, raw provider bodies, or personal paths.

### Agent discretion
The planner may choose concrete Java class names, Room table names, snapshot fields, notification layout supported by Media3, checkpoint cadence, and whether small settings initially use DataStore or a migration-ready wrapper, provided the sole-owner, security, queue, recovery, and evidence decisions above remain true.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Scope and acceptance
- `.planning/ROADMAP.md` §Phase 2 — fixed goal, requirements, dependency, and observable success criteria.
- `.planning/REQUIREMENTS.md` — PLAY-001, PLAY-003, PLAY-004, PLAY-005, PLAY-006, DATA-001.
- `.planning/phases/02-native-media3-playback-background-control/02-RESEARCH.md` — Media3/Room architecture, official Android guidance, integration seams, risks, and test strategy.
- `.planning/research/STACK.md` — verified API-35 dependency compatibility, especially Media3 `1.9.4` versus the API-36-only current stable line.

### Existing Android and bridge seams
- `android/app/build.gradle` and `android/app/src/main/AndroidManifest.xml` — current API/JDK/dependency and service/permission baseline.
- `android/app/src/main/java/com/dazzlingwuming/listen2/MainActivity.java` — WebView/page lifecycle and bridge composition root.
- `android/app/src/main/java/com/dazzlingwuming/listen2/AndroidRpcContract.java` and `AndroidHttpBridge.java` — typed operation, request identity, transport, and response security boundary.
- `app/listen1_chrome_extension/js/lowebutil.js` — Android request identity, timeout, cancellation, and stale-page handling.
- `app/listen1_chrome_extension/js/l1_player.js` and `player_thread.js` — existing page control/state/candidate-recovery seams that Android must redirect without breaking desktop.

### Behavioral references
- `app/listen1_chrome_extension/test/player_play_next_queue.test.js` — duplicate FIFO, reorder/remove/clear, and return-context behavior.
- `app/listen1_chrome_extension/test/player_shuffle.test.js` and `player_recovery.test.js` — shuffle/repeat/previous and recovery contracts.
- `.planning/phases/01-verified-bilibili-startup-slice/01-CONTEXT.md` and `01-06-SUMMARY.md` — temporary Howler boundary, exact part descriptor, mobile player/lyrics entry, and Phase 2 cutover obligations.
- `listen1/listen1_mobile@v0.8.2` concepts in `src/views/player/background-player.screen.js`, `src/redux/player.reducer.js`, and `src/redux/actions.js` — interaction reference only; do not copy its obsolete React Native/SDK 28 implementation.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable assets
- The existing WebMessage bridge already supplies trusted-origin enforcement, request IDs, page epochs, bounded payloads, cancellation, and teardown behavior; playback commands should follow that shape.
- Phase 1 already projects Bilibili selections into bounded candidate descriptors and a phone-first mini-player/lyric-entry state.
- Desktop queue/shuffle/recovery tests encode product semantics more precisely than the obsolete mobile runtime and are the behavioral source of truth.

### Integration points
- Add Media3/Room dependencies and foreground-service declarations without weakening the existing Network Security or WebView policy.
- Bind `MainActivity` to a controller/snapshot adapter while keeping `PlaybackService` independent of Activity and renderer lifetime.
- Route Android page controls through native intents only after the service handshake; ensure the cutover prevents Android Howler creation for the same track.
- Project native snapshots back into the existing mini-player/player-detail controller without changing desktop paths.

### Known risks
- Dual Howler/ExoPlayer ownership, treating Media3 timeline as the semantic queue, persisting signed URLs, double consumption from competing control surfaces, over-frequent Room writes, illegal foreground-service starts, and false recovery claims are blocking defects.
- Phase 1's live Bilibili gate may temporarily be externally provider-blocked; Phase 2 deterministic work can proceed, but Phase 2 live provider evidence cannot substitute for the still-required Phase 1 gate.

</code_context>

<deferred>
## Deferred Ideas

- Quality/rendition selection and MV — Phase 9.
- Full synchronized/manual/translated/accessibility lyric ownership — Phase 3.
- Account/session lifecycle — Phase 5.
- Local media and backup/history — Phase 6.
- Cache/download/offline playback — Phase 8.
- Effects, loudness, visualization, and AI translation — Phase 9.

</deferred>

---

*Phase: 02-native-media3-playback-background-control*
*Context gathered: 2026-08-31*
