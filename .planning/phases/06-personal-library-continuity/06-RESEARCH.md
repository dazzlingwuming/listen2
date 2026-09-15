# Phase 6: Personal Library & Continuity - Research

**Researched:** 2026-09-15
**Domain:** React Native library/account UX backed by Android-native persistence, SAF, secure sessions, and listening history
**Confidence:** MEDIUM

## User Constraints

No Phase-06 `CONTEXT.md` exists. The scoped task direction is therefore authoritative: implement only in the canonical React Native `mobile/` application; preserve the existing Bilibili QR/Keystore, OfflineCore, and RNTP seams; introduce Room and DataStore; do not make Phase 7 cache claims or Phase 8 API-35/live-provider/device claims. [VERIFIED: `.planning/ROADMAP.md:73-87`, `.planning/STATE.md`]

## Project Constraints (from AGENTS.md)

- Keep all product changes in the planned GSD workflow; preserve unrelated dirty work and do not edit generated Android outputs. [VERIFIED: `AGENTS.md:15-22`, project conventions]
- Native functionality must use a narrow, versioned, allow-listed semantic bridge. JavaScript must never select arbitrary URLs, headers, cookies, or generic native execution. [VERIFIED: `AGENTS.md:15-20`]
- Do not put tokens, cookies, refresh tokens, API keys, signed URLs, local user data, or runtime logs into source, backups, planning artifacts, notifications, or JavaScript-visible state. [VERIFIED: `AGENTS.md:18-22`]
- RNTP remains the only player/media-session/audio-focus owner; a Phase-06 feature must not add a second Media3 player. API-35 emulator, real account, signing, and live-provider acceptance remain Phase 8 evidence, not a source-test substitute. [VERIFIED: `.planning/STATE.md`, `.planning/phases/05-five-source-listen-journey/05-CONTEXT.md`]
- Before any later commit or push, run the repository-defined local CI using the required skill; this research task is explicitly documentation-only and must not commit or push. [VERIFIED: `AGENTS.md`, task scope]

## Phase Requirements

| ID | Description | Research Support |
|---|---|---|
| LIB-001 | Source/sync-state distinction and offline-safe local browsing | Native Room library projection plus UI collection type/status. |
| LIB-002 | Playlist/favorite CRUD, ordering, duplicate and destructive-confirmation behavior | Transactional DAO commands and optimistic UI only after native acknowledgement. |
| LIB-003 | Rapid-edit/restart consistency and capability-gated actions | Versioned mutation tokens, one Room transaction per command, persisted snapshot rehydrate. |
| AUTH-001 | Honest provider account-state matrix | Static capability matrix plus Bilibili's native public state; no invented provider login route. |
| AUTH-002 | Bilibili QR lifecycle and controlled other-provider outcomes | Reuse Bilibili native session; model unsupported/unverified providers as terminal fixture states. |
| AUTH-003 | Native secure credentials and logout cleanup | Keep vault native-only; clear session/protected references without touching user library/history/local records. |
| LOCAL-001 | Multi-select SAF import for required formats | Native `ACTION_OPEN_DOCUMENT` activity result, persisted grant, opaque local identity. |
| LOCAL-002 | Metadata/artwork/duration/LRC/local playback | Native extractor and explicit LRC association; app-private provider gives RNTP an opaque playable URI. |
| LOCAL-003 | Repair/revoke/unsupported safety | Read-only provider, repair flow, no raw content URI/path in JS, backup, or logs. |
| DATA-001 | Room for relational state; DataStore only small non-sensitive state | One schema-owned native repository with migration ledger and exported Room schemas. |
| DATA-002 | Strict portable backup allow-list | Keep the bounded parser, revise export to personal/favorite data only, and exclude all local/session/cache settings. |
| DATA-003 | Previewed merge/default, confirmed overwrite, rollback | Compute plan before mutation, then apply a single native transaction with an import receipt. |
| HIST-001 | Genuine-play threshold and dedupe | Native ledger receives bounded semantic playback segments and commits once per playback instance. |
| HIST-002 | Restart/midnight/year-consistent recap | Persist completed instances and aggregate in Room; retain a stable local-date/year key at commit. |
| HIST-003 | Disable/export/irreversible clear without start latency | DataStore boolean plus asynchronous Room writer and clear-generation fence. |

All descriptions above are copied from the canonical requirement text. [VERIFIED: `.planning/REQUIREMENTS.md:64-90`]

## Summary

Phase 06 is primarily a persistence-boundary migration, not a collection of independent screens. The current store persists both the player and library through Redux Persist/AsyncStorage, while library mutations are in-memory reducers; local tracks contain their raw `content://` URI in the TypeScript model. The existing backup codec is already bounded and rejects credentials/paths, but exports queue data and applies the queue and library separately. Those facts cannot meet the requirement for a Room source of truth, atomic library edits, private SAF records, or a valid-listening ledger. [VERIFIED: `mobile/src/store/index.ts:1-68`, `mobile/src/store/librarySlice.ts:7-153`, `mobile/src/types/music.ts:17-49`, `mobile/src/backup/backupCodec.ts:1-22`, `mobile/src/screens/SettingsScreen.tsx:278-370`]

Use one Android-native `LibraryRepository` backed by Room for relational durable state and a small Preferences DataStore for non-sensitive flags only. Room is appropriate here because the library/history domains need partial, transactional updates; DataStore is suitable for small durable preferences but serializes the complete object and does not support partial updates. [CITED: https://developer.android.com/reference/androidx/datastore/core/DataStore] The official Android documentation recommends explicit Room migrations, exported schemas, and migration tests; do not use destructive migration fallback for user data. [CITED: https://developer.android.com/training/data-storage/room/migrating-db-versions]

**Primary recommendation:** Plan four sequential vertical slices: (1) native storage and reversible Redux migration, (2) library/backup/account UI over the repository, (3) private SAF local-media import/repair/playback, and (4) valid-listening ledger and recap/privacy controls.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|---|---|---|---|
| Personal playlists, favorites, ordering, remote/local collection projection | Database / Storage | Browser / Client | Room owns IDs, order and atomic mutations; React Native renders returned safe snapshots. |
| Player queue checkpoint and lyric metadata | Database / Storage | Browser / Client | Preserve semantic state without persisting RNTP IDs, URLs, headers, or credentials. Existing player sanitizer already intends this boundary. [VERIFIED: `mobile/src/store/playerPersistence.ts:37-85`] |
| Small opt-in/migration flags | Database / Storage | Browser / Client | Preferences DataStore is durable/transactional for small settings; mutable lists belong in Room. [CITED: https://developer.android.com/reference/androidx/datastore/core/DataStore] |
| Bilibili account lifecycle | API / Backend (native module) | Browser / Client | Kotlin owns credential restoration, QR polling, refresh and logout; JS receives a sanitized public state only. [VERIFIED: `mobile/android/app/src/main/java/com/listen2mobile/bilibili/BilibiliSession.kt:1-120`, `mobile/src/bilibili/client.ts:73-129`] |
| SAF import, metadata, LRC association and repair | API / Backend (native module) | Database / Storage | Android owns URI grants and `ContentResolver`; Room stores only its opaque local-record identity plus metadata. |
| Local playback | API / Backend (private content provider) | Browser / Client | A non-exported app provider resolves an opaque local-record identity for RNTP; JS never receives a third-party grant URI. The offline implementation already establishes this pattern. [VERIFIED: `mobile/android/app/src/main/java/com/listen2mobile/offline/OfflineAudioModule.kt:59-108`, `mobile/android/app/src/main/AndroidManifest.xml:15-17`] |
| Valid-play ledger and annual recap | Database / Storage | Browser / Client | Native repository owns idempotency and aggregation; player controller sends bounded semantic event summaries asynchronously. |
| Backup preview/share/import confirmation | Browser / Client | Database / Storage | UI shows validation/preview and confirmation; repository commits an already-validated plan atomically. |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---|---:|---|---|
| `androidx.room:room-runtime`, `room-ktx`, compiler, `room-testing` | 2.8.5 | Relational library/history/cache/SAF records, migrations, DAOs, migration testing | Official current stable Room release; it supplies a SQLite abstraction and migration-test artifact. [CITED: https://developer.android.com/jetpack/androidx/releases/room] |
| `androidx.datastore:datastore-preferences` | 1.2.1 | Small, non-sensitive preferences such as history recording enabled and completed migration revision | Official stable DataStore release. [CITED: https://developer.android.com/jetpack/androidx/releases/datastore] |
| Existing `react-native-track-player` | 4.1.2 | Sole RNTP audio/session owner for remote and opaque local playable URIs | Preserve the established one-player lifecycle and remote-controls path. [VERIFIED: `mobile/package.json:18-29`, `mobile/src/player/playbackService.ts:4-74`] |

### Supporting

| Library / platform API | Version | Purpose | When to Use |
|---|---:|---|---|
| Existing `@react-native-documents/picker` | 12.0.2 | Transitional picker API only | Replace its JS-visible document result with a native Activity-result operation before persisting any new local record. [VERIFIED: `mobile/package.json:7-29`, `mobile/src/localAudio/picker.ts:134-150`] |
| Android Storage Access Framework | platform | User-selected documents and reboot-persistent access | Use `ACTION_OPEN_DOCUMENT`, multi-select and persisted grants; the grant can still fail later if the document moves/deletes, so repair is mandatory. [CITED: https://developer.android.com/training/data-storage/shared/documents-files] |
| Android Keystore | platform | Existing Bilibili session envelope | Reuse the native vault; do not introduce a JavaScript credential copy. [VERIFIED: `mobile/android/app/src/main/java/com/listen2mobile/bilibili/BilibiliVault.kt:17-121`] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|---|---|---|
| Room repository | Continue Redux Persist/AsyncStorage for collections | Rejected: it cannot provide native relational transactions, hide SAF grants, or be the single durable owner demanded by DATA-001. [VERIFIED: `mobile/src/store/index.ts:21-38`] |
| Room for library/history | DataStore for full library/history JSON | Rejected: DataStore writes a complete serialized object and has no partial updates. [CITED: https://developer.android.com/reference/androidx/datastore/core/DataStore] |
| Native SAF module + opaque provider | Persist raw `content://` in Redux and give it directly to RNTP | Rejected: current code does exactly this, but LOCAL-003 forbids exposing arbitrary local handles to JS/backup. [VERIFIED: `mobile/src/types/music.ts:22-35`, `.planning/REQUIREMENTS.md:76-78`] |
| Explicit user JSON export with Auto Backup disabled | OS Auto Backup for databases/shared preferences | Rejected: Android Auto Backup includes most app data by default; credentials/URI grants and databases must not be silently transferred. The manifest already has Auto Backup disabled. [CITED: https://developer.android.com/identity/data/autobackup] [VERIFIED: `mobile/android/app/src/main/AndroidManifest.xml:6-17`] |

**Installation (planned Gradle additions, not executed by research):**

```groovy
implementation 'androidx.room:room-runtime:2.8.5'
implementation 'androidx.room:room-ktx:2.8.5'
kapt 'androidx.room:room-compiler:2.8.5'
androidTestImplementation 'androidx.room:room-testing:2.8.5'
implementation 'androidx.datastore:datastore-preferences:1.2.1'
```

The app already uses the Kotlin Android Gradle plugin but does not declare either Room or DataStore; the planner must add the Kotlin annotation-processing plugin/configuration compatible with this Gradle project and verify the resulting dependency graph. [VERIFIED: `mobile/android/build.gradle:1-21`, `mobile/android/app/build.gradle:1-92`] The exact `kapt` setup above is an implementation recommendation to validate during the first plan task. [ASSUMED]

## Package Legitimacy Audit

The legitimacy seam supports only npm, PyPI, and crates; it rejects Maven coordinates, so no misleading registry verdict is recorded. The recommended AndroidX artifacts and versions above were obtained from Android's official release pages, not from package-name memory. [VERIFIED: package-legitimacy seam output, 2026-09-15] [CITED: https://developer.android.com/jetpack/androidx/releases/room] [CITED: https://developer.android.com/jetpack/androidx/releases/datastore]

| Package | Registry | Verdict | Disposition |
|---|---|---|---|
| AndroidX Room artifacts | Google Maven | Official documentation verified | Approved, then resolve in Gradle during implementation. |
| AndroidX DataStore Preferences | Google Maven | Official documentation verified | Approved, then resolve in Gradle during implementation. |

**Packages removed due to SLOP verdict:** none.

## Recommended Plan Sequence

### Plan 06-01 — Native durable-data foundation and reversible migration

**Owns:** Gradle dependencies, Room schema/DAO/repository, Preferences DataStore, native module registration, exported schemas, migration ledger, one-time Redux/AsyncStorage import, readback verification, rollback state, and replacing durable Redux persistence with safe repository hydration.

**Requirements opened:** DATA-001 and the persistence prerequisites for LIB-003, LOCAL-003, and HIST-002/003.

**Exit condition:** A fixture containing the current sanitized library/player/lyric metadata imports exactly once into Room; a failed import leaves the legacy data readable; a second successful startup reads Room; and no raw session/media transport material is introduced into the database projection. [ASSUMED]

### Plan 06-02 — Library, backups, and honest account matrix

**Owns:** Repository-backed personal/favorite/local/remote collection views; atomic create/rename/edit/reorder/delete/favorite actions; capability-gated controls; version-2 custom export/import preview/merge/confirmed-overwrite; Bilibili QR UI wiring; and per-provider unavailable/unverified states.

**Requirements closed:** LIB-001, LIB-002, LIB-003, AUTH-001, AUTH-002, AUTH-003, DATA-002, DATA-003.

**Exit condition:** UI and native fixtures prove duplicate/order and destructive-confirmation behavior survives a rehydrate; merge and overwrite are one transaction; Bilibili state is public-only; unavailable providers have no fake sign-in action. [ASSUMED]

### Plan 06-03 — Private SAF local library

**Owns:** Native multi-select document result, persisted grants, metadata/artwork/duration extraction, explicit LRC association, opaque local record/provider URI, local play/queue integration, repair/reselect/remove states, and grant/handle leakage tests.

**Requirements closed:** LOCAL-001, LOCAL-002, LOCAL-003.

**Exit condition:** Instrumentation with a fake document provider and RNTP-facing contract verifies that raw grants do not enter JS/persistence/backup, removal revokes the native reference, and failures remain repairable. Actual device/cloud-provider behavior stays Phase 8. [ASSUMED]

### Plan 06-04 — Valid-listening ledger, recap, and privacy

**Owns:** RNTP-to-ledger adapter, native segment accumulator, Room history/aggregate queries, recap screen, history opt-out/export/clear, clear-generation fencing, and threshold/lifecycle test fixtures.

**Requirements closed:** HIST-001, HIST-002, HIST-003.

**Exit condition:** Tests prove the documented threshold, no counting on seeks/pause/buffer/preload, no duplicate callback count, restart/year-boundary stable aggregation, opt-out with no growth, and clear with no delayed-write resurrection. [VERIFIED: `.planning/REQUIREMENTS.md:88-90`] [ASSUMED]

## Architecture Patterns

### System Architecture Diagram

```text
React Native screens
  | semantic library / account / local / history commands
  v
Narrow Kotlin modules ──> validate DTO + mutation token ──> Room transaction
  |                                                       |       |
  |                                                       |       +--> library, queue, lyric-meta,
  |                                                       |            local-record, history tables
  |                                                       +--> DataStore small flags only
  |
  +--> BilibiliSession / Keystore (credentials never projected)
  +--> SAF Activity + ContentResolver --> persisted grant held native-side
                                         |
                                         v
                              non-exported LocalMediaProvider
                                         |
                                         v
                              RNTP opaque local URI playback

RNTP callbacks --> playerController --> bounded semantic segments --> history writer
```

### Recommended Project Structure

```text
mobile/
├── android/app/src/main/java/com/listen2mobile/library/ # Room entities, DAO, repository, migration
├── android/app/src/main/java/com/listen2mobile/local/   # SAF activity bridge, metadata/LRC, provider
├── android/app/src/main/java/com/listen2mobile/history/ # ledger, recap aggregation, export/clear
├── android/app/src/test/java/com/listen2mobile/          # pure policy/DAO-contract tests
├── android/app/src/androidTest/java/com/listen2mobile/   # Room migration + SAF/provider tests
├── src/library/                                          # safe DTO client, selector/thunks
├── src/localAudio/                                       # presentation-only import/repair/play actions
├── src/history/                                          # controller adapter and recap screens
└── src/screens/                                          # My Music, Settings, Playlist detail additions
```

### Pattern 1: Native repository is the durable owner

**What:** Define semantic entities for tracks, playlist membership with position, favorites, queue checkpoints, lyric metadata, local records, history play instances, and a migration/import ledger. Expose high-level commands such as `createPlaylist`, `renamePlaylist`, `reorderPlaylist`, `applyImport`, `startLocalImport`, `repairLocalRecord`, `removeLocalRecord`, `getAccountMatrix`, and `recordPlaybackSegment`. Each command validates a small DTO and returns a safe snapshot/receipt, never URLs, cookies, grant URIs, SQL, or file paths.

**When to use:** Every durable collection mutation. React state remains an immediately replaceable UI projection, not a second independently persisted source of truth.

**Required transaction rules:**

1. Store playlist identity and membership order separately; enforce the existing duplicate rule as `(source, semanticTrackId)` per playlist, while queue occurrences remain deliberately duplicable. Existing `addTrackToPlaylist` currently suppresses duplicate semantic tracks, while `enqueueNext` deliberately creates a distinct occurrence. [VERIFIED: `mobile/src/store/librarySlice.ts:127-151`, `mobile/src/store/playerSlice.ts:255-261`]
2. Add a monotonically increasing library revision to every mutation request and reply. Apply UI projection only for the acknowledgement that matches its submitted mutation; stale acknowledgements trigger a repository reload. [ASSUMED]
3. A destructive playlist/local-record removal transaction must remove affected membership/favorite/history/queue references before publishing the new snapshot. The current reducer already treats local removal as a cross-reference cleanup; preserve that observable result in Room. [VERIFIED: `mobile/src/store/librarySlice.ts:75-92`]
4. Do not treat downloaded media ownership as complete in this phase. Reference the existing offline catalog read-only; Phase 7 remains responsible for cache lifecycle. [VERIFIED: `.planning/ROADMAP.md:89-92`, `mobile/android/app/src/main/java/com/listen2mobile/offline/OfflineCore.kt:358-410`]

### Pattern 2: Reversible Redux Persist to Room/DataStore migration

**What:** Migrate once after Redux rehydration, before enabling any Phase-06 mutation UI. Convert legacy persisted semantic state with existing sanitizers, write it to Room inside an idempotent transaction keyed by a migration receipt/checksum, validate counts and identities, then switch the UI selector source to native snapshots. Retain the old AsyncStorage keys until a successful subsequent startup/readback; only then purge the legacy keys in a separately acknowledged cleanup. [ASSUMED]

**Why:** The current persisted player uses a versioned sanitizer and deliberately never restores playback as active; preserve that safety property while moving queue checkpoints to Room. [VERIFIED: `mobile/src/store/index.ts:21-34`, `mobile/src/store/playerPersistence.ts:177-252`]

**Rollback:** If conversion, Room insertion, count/identity validation, or native snapshot load fails, leave Redux Persist readable, do not set the DataStore active-backend marker, and show a non-destructive retry/recovery state. Never delete legacy state as part of a failed attempt. Future Room schema changes must supply explicit migrations, exported JSON schemas, and `MigrationTestHelper` coverage; never invoke destructive fallback. [CITED: https://developer.android.com/training/data-storage/room/migrating-db-versions] [ASSUMED]

### Pattern 3: SAF stays native and local playback uses an opaque provider URI

**What:** Move the chooser and `takePersistableUriPermission` call into a native `LocalLibraryModule`. It validates selected document count/type, retains the third-party SAF grant only in native storage, extracts bounded metadata on an IO dispatcher, and persists one opaque local record. For playback, a non-exported read-only `ContentProvider` receives an app-owned record token, loads the hidden grant from Room, and opens it through `ContentResolver`; RNTP sees only the app-owned opaque provider URI.

**When to use:** Import, repair, delete, metadata refresh, explicit LRC selection, and player local-media resolution.

**Why:** Android documents selected through `ACTION_OPEN_DOCUMENT` are `content://` documents; persisted access must be explicitly taken and can later fail when the document moves/deletes, which necessitates repair. [CITED: https://developer.android.com/reference/android/content/Intent] The project already proves the safe app-private provider shape with an `exported=false` offline provider that accepts only read mode and a validated path segment. [VERIFIED: `mobile/android/app/src/main/java/com/listen2mobile/offline/OfflineAudioModule.kt:97-108`, `mobile/android/app/src/main/AndroidManifest.xml:15-17`]

**LRC rule:** Implement explicit companion-LRC selection linked to the opaque local record first. Do not attempt adjacent-file discovery unless the user grants a directory tree and a separate reviewed scope is planned; a single-document grant does not justify sibling enumeration. [ASSUMED]

### Pattern 4: Valid listening is an asynchronous idempotent ledger

**What:** Treat RNTP callbacks as progress observations, not history entries. Maintain a per-playback-instance accumulator that counts only monotonic forward playing segments. Commit exactly once after the requirement threshold is met: forward listening must exceed 30 seconds and reach the smaller of half duration or four minutes. Seek, pause, buffering, preloading, failure, browsing, stale callback, and repeated terminal callback do not advance or duplicate the ledger. [VERIFIED: `.planning/REQUIREMENTS.md:88-90`]

**When to use:** Player progress/state callbacks after native active-track identity is confirmed. The existing controller already rejects stale native callbacks by generated identity; attach the ledger adapter after that guard. [VERIFIED: `mobile/src/player/playbackService.ts:14-74`, `mobile/src/player/playerController.ts:1302-1356`]

**Persistence:** Write final valid-play rows asynchronously on a single native executor; use a unique `(playbackInstanceId, clearGeneration)` key. Persist the local completion date/year at commit so a process restart or time boundary cannot reinterpret an already-counted play. Opt-out and clear increment `clearGeneration` and remove ledger/aggregate rows transactionally so delayed writes are rejected. This is a prescriptive design choice requiring implementation tests. [ASSUMED]

### Code Example: semantic command boundary (illustrative)

```kotlin
// Pseudocode, not a copyable API contract. [ASSUMED]
fun applyLibraryMutation(request: LibraryMutation): LibraryReceipt =
    database.transaction {
        validateSemanticOnly(request)
        repository.apply(request)
        repository.safeSnapshot()
    }
```

The implementation must mirror the existing module style: reject unknown request keys, do work off the UI thread, and resolve stable safe error codes rather than raw provider/IO exceptions. [VERIFIED: `mobile/android/app/src/main/java/com/listen2mobile/bilibili/BilibiliModule.kt:18-70`, `mobile/android/app/src/main/java/com/listen2mobile/offline/OfflineAudioModule.kt:27-89`]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---|---|---|---|
| Relational durable state and schema upgrades | JSON blobs with hand-written locking in AsyncStorage | Room entities/DAOs/migrations/schema export | Atomic joins/order/history queries and verified migration tooling are already supplied. [CITED: https://developer.android.com/training/data-storage/room/migrating-db-versions] |
| Small durable preference flags | New SharedPreferences wrapper | Preferences DataStore | It is durable, thread-safe and non-blocking for small data. [CITED: https://developer.android.com/reference/androidx/datastore/core/DataStore] |
| SAF permission persistence | Full-storage permission or copying originals | `ACTION_OPEN_DOCUMENT` plus persisted grant | User picks documents; app retains only documented access. [CITED: https://developer.android.com/reference/android/content/Intent] |
| Local playback exposure | Raw path/file URI or generic file bridge | Non-exported app `ContentProvider` with opaque record ID | Reuses the current offline-provider security pattern. [VERIFIED: `mobile/android/app/src/main/java/com/listen2mobile/offline/OfflineAudioModule.kt:97-108`] |
| Credential storage | AsyncStorage/Redux/backup | Existing Keystore-backed Bilibili vault | Existing native code encrypts its envelope and exposes only public state. [VERIFIED: `mobile/android/app/src/main/java/com/listen2mobile/bilibili/BilibiliVault.kt:17-121`] |
| Backup parsing | General state serializer | Existing bounded backup codec, revised allow-list | Current parser rejects credential keys, paths, unsafe keys, oversized input, and unknown strict fields. [VERIFIED: `mobile/src/backup/backupCodec.ts:114-203`, `mobile/src/backup/backupCodec.ts:464-476`] |
| Playback/history timing | Another player or UI timer | Existing RNTP callback/controller path plus native ledger writer | Preserves one audio owner and current stale-event defenses. [VERIFIED: `mobile/src/player/playbackService.ts:4-74`, `mobile/src/player/playerController.ts:1302-1356`] |

## Common Pitfalls

### Pitfall 1: dual writable sources during migration

**What goes wrong:** AsyncStorage and Room receive different mutations, then restart selects an arbitrary winner.

**Avoid:** Make migration a boot barrier with a persistent receipt; after a verified Room commit, route all durable mutation commands through the repository. Retain legacy data only as rollback read-state until a confirmed subsequent readback. [ASSUMED]

### Pitfall 2: violating LOCAL-003 by convenience

**What goes wrong:** The TypeScript model, Redux Persist, logs, backup, or RNTP command carries a third-party `content://` grant.

**Avoid:** Replace the current `LocalTrack.contentUri`/bookmark shape with a safe view DTO and an app-owned opaque playback URI. Add tests that recursively scan every backup/native response/Redux snapshot for `file:` and external `content:` values. The current model still exposes those values, so this is a real migration requirement. [VERIFIED: `mobile/src/types/music.ts:22-49`, `mobile/src/localAudio/picker.ts:113-125`]

### Pitfall 3: treating picker success as media usability

**What goes wrong:** A cloud document is selectable but unreadable, non-seekable, moved, or unsupported by the device codec.

**Avoid:** Model metadata extraction, read/open, and first seek/play as separate outcomes. Keep record status actionable (`available`, repair-needed, revoked, unsupported) and do not remove user library data on a remote-provider failure. Existing code already recognizes repair/revocation, but has no native metadata/playability proof. [VERIFIED: `mobile/src/types/music.ts:22-49`, `mobile/src/store/librarySlice.ts:94-96`] [ASSUMED]

### Pitfall 4: history at play-start or every progress tick

**What goes wrong:** Browsing/preload/seek inflates history, or frequent synchronous writes delay first playback.

**Avoid:** Accumulate monotonic segments in memory, send bounded snapshots off the RNTP event path, and finalize once with a uniqueness constraint. [VERIFIED: `.planning/REQUIREMENTS.md:88-90`] [ASSUMED]

### Pitfall 5: backup merge is not atomic with queue mutation

**What goes wrong:** Existing UI updates the queue first and library second; one can succeed when the other fails.

**Avoid:** Phase 06 portable backup exports favorites and personal playlists only, as required. Parse/preview before any write; apply the chosen merge/overwrite plan in one Room transaction; then refresh the player checkpoint from the confirmed repository snapshot. [VERIFIED: `.planning/REQUIREMENTS.md:82-84`, `mobile/src/screens/SettingsScreen.tsx:314-352`] [ASSUMED]

### Pitfall 6: fake account parity

**What goes wrong:** UI adds sign-in controls for providers with no verified authorized route.

**Avoid:** Render an account matrix from declared capability plus a controlled terminal reason. Reuse the complete Bilibili QR lifecycle and show non-Bilibili routes as unavailable/unverified unless an approved native route exists. [VERIFIED: `mobile/src/bilibili/client.ts:238-252`, `mobile/src/types/provider.ts:14-41`, `.planning/REQUIREMENTS.md:70-72`]

## State of the Art

| Old/current approach | Required Phase-06 approach | Impact |
|---|---|---|
| Redux Persist/AsyncStorage stores both player and library | Room owns relational durable data; Redux projects safe snapshots | Enables transactions/migrations and removes raw local handles. [VERIFIED: `mobile/src/store/index.ts:21-38`] |
| Local picker returns raw `content://` details to JavaScript | Native SAF workflow returns opaque local-record summaries | Meets the local-handle boundary. [VERIFIED: `mobile/src/localAudio/picker.ts:66-125`] |
| Current backup includes queue | Portable backup exports only personal/favorite data plus required non-sensitive metadata | Aligns DATA-002; queue checkpoint remains local Room state. [VERIFIED: `mobile/src/localAudio/backup.ts:10-26`, `.planning/REQUIREMENTS.md:82-84`] |
| Recent track is recorded when playback starts | Valid-play ledger commits only at the documented threshold | Keeps "recent" navigation separate from truthful recap metrics. [VERIFIED: `mobile/src/player/playerController.ts:743-768`, `.planning/REQUIREMENTS.md:88-90`] |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|---|---|---|
| A1 | A Kotlin `kapt` configuration is the least-disruptive compiler route for this existing Gradle project. | Standard Stack | Build configuration may need KSP instead. |
| A2 | A native opaque local-media `ContentProvider` can serve RNTP without exposing a third-party grant URI to JS. | Architecture Patterns | May require an RNTP/ExoPlayer integration adjustment. |
| A3 | Explicit LRC selection is the safe initial implementation; adjacent discovery needs a separate tree grant. | Architecture Patterns | Product may require folder-level UX. |
| A4 | Local completion date/year should be captured at ledger commit to make recap grouping stable after travel/time-zone changes. | History | Product must choose its preferred time-zone semantics. |
| A5 | Two-start readback before legacy key deletion is an adequate migration rollback threshold. | Migration | Recovery window may need a longer retention policy. |

## Open Questions

1. **Time-zone definition for annual recap**
   - What we know: HIST-002 requires midnight/year consistency. [VERIFIED: `.planning/REQUIREMENTS.md:88-90`]
   - What's unclear: whether a play belongs to the device time zone at completion or the user's current time zone when viewing a recap.
   - Recommendation: lock "completion-time local date/year" before coding; A4 is the recommended default.

2. **Existing user-data migration retention**
   - What we know: player/library currently persist in two AsyncStorage keys. [VERIFIED: `mobile/src/store/index.ts:21-38`]
   - What's unclear: acceptable duration and UI for retaining the rollback source after successful Room migration.
   - Recommendation: keep until one verified subsequent startup and expose recovery diagnostics without values; require product confirmation if a longer retention window is needed.

3. **Account matrix ownership**
   - What we know: Bilibili has an actual native state machine, while provider operation capabilities distinguish unavailable/unverified. [VERIFIED: `mobile/src/bilibili/client.ts:15-24`, `mobile/src/types/provider.ts:31-41`]
   - What's unclear: which non-Bilibili providers will receive controlled login fixtures in this phase.
   - Recommendation: render every provider honestly now, and add no login control without an approved native fixture/route.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|---|---|---:|---|---|
| Node.js | Jest/TypeScript/RN tooling | ✓ | v24.15.0 | — |
| npm | mobile package scripts | ✓ | 11.12.1 | — |
| Java/JDK | Kotlin/Room compile and JVM tests | ✗ | — | Blocking for native verification; install/configure JDK 17+ before execution. |
| Android emulator/ADB tools | SAF/provider instrumentation and eventual API-35 acceptance | ✗ on PATH | — | Unit/Jest tests only; no substitute for required device evidence. |

Probe result was recorded on 2026-09-15; the current shell cannot locate a Java runtime. [VERIFIED: environment probe, 2026-09-15]

**Missing dependencies with no fallback:** JDK for Kotlin/Room build and Android runtime tooling for SAF instrumentation.

## Validation Architecture

### Test Framework

| Property | Value |
|---|---|
| JavaScript framework | Jest via `npm run mobile:test` [VERIFIED: `package.json:6-29`, `mobile/package.json:1-39`] |
| Type check | `npm run mobile:typecheck` [VERIFIED: `package.json:6-29`] |
| Lint | `npm --prefix mobile run lint -- --quiet` [VERIFIED: `mobile/package.json:5-17`] |
| Native unit test | `cd mobile/android && ./gradlew :app:testDebugUnitTest` after JDK is available [ASSUMED] |
| Native migration/instrumentation | `cd mobile/android && ./gradlew :app:connectedDebugAndroidTest` on an emulator/device [ASSUMED] |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|---|---|---|---|---|
| LIB-001/2/3 | Room command transaction, duplicate/order/revision and UI projections | Kotlin DAO + Jest screen | Jest + native unit test | ❌ Wave 0 |
| AUTH-001/2/3 | matrix UI and Bilibili lifecycle/no-secret projection | Jest + existing Kotlin contract extension | Jest + native unit test | ✅ Bilibili contract baseline |
| LOCAL-001/2/3 | SAF result, native metadata/LRC, opaque provider, revoke/repair | instrumentation + Jest DTO | connected Android test | ❌ Wave 0 |
| DATA-001 | legacy migration and future schema migration preservation | instrumentation `MigrationTestHelper` | connected Android test | ❌ Wave 0 |
| DATA-002/3 | strict export and parse/preview/merge/overwrite rollback | Jest codec + native transaction test | Jest + native unit test | ✅ codec baseline; ❌ transaction test |
| HIST-001 | threshold, seek/pause/dedup correctness | Kotlin ledger unit + Jest controller adapter | Jest + native unit test | ❌ Wave 0 |
| HIST-002 | restart/midnight/year aggregates | Kotlin DAO/ledger test | native unit/instrumentation | ❌ Wave 0 |
| HIST-003 | opt-out/export/clear generation fence | Kotlin unit + Jest UI | Jest + native unit test | ❌ Wave 0 |

### Wave 0 Gaps

- [ ] Add Room schema export directory under `mobile/android/app/schemas/`, check it into version control, and add migration tests before a later schema version is introduced. [CITED: https://developer.android.com/training/data-storage/room/migrating-db-versions]
- [ ] Add `mobile/android/app/src/androidTest/java/com/listen2mobile/library/LibraryMigrationTest.kt` and a fake document provider instrumentation suite.
- [ ] Add `mobile/android/app/src/test/java/com/listen2mobile/history/ListeningLedgerTest.kt` for threshold, dedup, clear-generation, midnight/year behavior.
- [ ] Add `mobile/src/library/__tests__/libraryRepositoryClient.test.ts` and screen tests for matrix, destructive confirmations, migration error/retry, and local repair state.
- [ ] Extend backup tests so V2 excludes queue/local/session/configuration data and a failed native apply leaves Room/player snapshot unchanged.

Phase 8 still owns integrated API-35 emulator, real Bilibili account, real SAF/cloud provider, background playback, and release-like validation. [VERIFIED: `.planning/ROADMAP.md:107-118`, `.planning/STATE.md`]

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---|---|---|
| V2 Authentication | Yes | Bilibili public-state DTO; native-only Keystore vault; no login UI for unverified routes. |
| V3 Session Management | Yes | Refresh/expiry/logout stays in native session; clear session/protected cache references on logout without clearing user library. |
| V4 Access Control | Yes | `ContentProvider` non-exported/read-only; opaque record IDs; validate all semantic commands. |
| V5 Input Validation | Yes | Strict DTO allow-lists, typed limits, URI/metadata/backup schema validation, bounded imports. |
| V6 Cryptography | Yes | Reuse Android Keystore AES-GCM vault; do not implement encryption in JavaScript. [VERIFIED: `mobile/android/app/src/main/java/com/listen2mobile/bilibili/BilibiliVault.kt:46-121`] |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---|---|---|
| Backup contains credential/path/URI data | Information disclosure | Strict allow-list parse/export; retain the existing credential/path rejection and add native export scan. [VERIFIED: `mobile/src/backup/backupCodec.ts:114-203`] |
| Malicious or stale RN bridge call | Tampering | Exact allowed keys/types/bounds, semantic operations, revision/token check, stable error reply. [VERIFIED: `mobile/android/app/src/main/java/com/listen2mobile/bilibili/BilibiliModule.kt:39-70`, `mobile/android/app/src/main/java/com/listen2mobile/bilibili/BilibiliModule.kt:222-241`] |
| External app accesses local grant via provider | Elevation of privilege | `exported=false`, no URI grants, read-only provider and opaque ID validation. [VERIFIED: `mobile/android/app/src/main/AndroidManifest.xml:15-17`, `mobile/android/app/src/main/java/com/listen2mobile/offline/OfflineAudioModule.kt:97-108`] |
| Logout race restores cancelled credentials | Repudiation / information disclosure | Keep Bilibili attempt ownership/provisional commit/clear-on-failure patterns. [VERIFIED: `mobile/android/app/src/main/java/com/listen2mobile/bilibili/BilibiliSession.kt:34-120`] |
| Stale callback writes removed history or local item | Tampering | Native playback identity plus clear-generation/repository revision checks. Existing player identity guard is reusable. [VERIFIED: `mobile/src/player/playerController.ts:1302-1356`] |

## Sources

### Primary (official)

- [AndroidX Room release notes](https://developer.android.com/jetpack/androidx/releases/room) — stable version and artifact family.
- [Migrate your Room database](https://developer.android.com/training/data-storage/room/migrating-db-versions) — explicit migrations, schema export, migration testing, destructive-migration risk.
- [AndroidX DataStore release notes](https://developer.android.com/jetpack/androidx/releases/datastore) — stable DataStore Preferences dependency/version.
- [DataStore API reference](https://developer.android.com/reference/androidx/datastore/core/DataStore) — small-state and partial-update guidance.
- [Android `ACTION_OPEN_DOCUMENT` reference](https://developer.android.com/reference/android/content/Intent) and [SAF document guide](https://developer.android.com/training/data-storage/shared/documents-files) — persisted grants, metadata, moved/deleted-document behavior.
- [Auto Backup guide](https://developer.android.com/identity/data/autobackup) — default backup scope and include/exclude controls.

### Repository evidence

- `mobile/src/store/index.ts`, `librarySlice.ts`, `playerPersistence.ts`, and `playerSlice.ts` — current AsyncStorage/Redux persistence and mutation semantics.
- `mobile/src/localAudio/` and `types/music.ts` — current unsafe raw-local-URI exposure to eliminate.
- `mobile/android/app/src/main/java/com/listen2mobile/offline/` — reusable private catalog/provider pattern.
- `mobile/android/app/src/main/java/com/listen2mobile/bilibili/` — reusable secure native session boundary.
- `.planning/ROADMAP.md`, `.planning/REQUIREMENTS.md`, `.planning/STATE.md`, and Phase-05 artifacts — locked scope and sequencing.

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH for official AndroidX versions; MEDIUM for project-specific compiler wiring.
- Architecture: MEDIUM; storage/SAF premises are official and existing private-provider/Bilibili seams are verified, while opaque local-provider/RNTP integration needs a first-slice spike/test.
- Pitfalls: HIGH for current Redux/raw URI/backup split evidence; MEDIUM for migration and history-ledger operational design.

**Research date:** 2026-09-15
**Valid until:** 2026-09-22 for AndroidX versions; recheck before dependency installation.
