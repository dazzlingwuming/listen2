# Phase 6: Personal Library & Continuity — Pattern Map

**Mapped:** 2026-09-15
**Canonical implementation root:** `mobile/` only (React Native + Kotlin Android).
**Files classified:** 30 planned create/modify targets. **Strong analogs:** 30 / 30.

## Scope and non-negotiable seams

- This is a native-persistence migration. `mobile/src/store/index.ts:21-38` currently makes both player and library Redux-persisted writable state; Phase 06 must replace library/history durable ownership with a native repository, then hydrate Redux as a disposable projection.
- RNTP remains the only player/media-session owner. The history adapter may observe semantic player events but must not create a Media3/RNTP player or persist transport URLs.
- `LocalTrack.contentUri` and `bookmark` (`mobile/src/types/music.ts:22-35`) are legacy leakage to remove from all Phase-06 JS DTOs, Redux, navigation params, logs, and portable backup. JS can receive only opaque `localRecordId` plus display metadata and an app-private playable URI only at RNTP handoff.
- Do not use legacy `android/` WebView or desktop/Electron files as mobile implementation templates.

## File Classification

| New/Modified File | Role | Data flow | Closest analog | Match |
|---|---|---|---|---|
| `mobile/android/app/build.gradle` | config | migration | `mobile/android/app/build.gradle:1-120` | exact |
| `mobile/android/app/src/main/java/com/listen2mobile/library/LibraryDatabase.kt` | model/database | CRUD, migration | `offline/OfflineCore.kt:150-208` | data-owner |
| `.../library/LibraryDao.kt`, entities and `LibraryRepository.kt` | repository/model | CRUD, transactional | `offline/OfflineCore.kt:150-208` | exact boundary shape |
| `.../library/LibraryModule.kt`, `LibraryPackage.kt` | native bridge | request-response, event-driven | `offline/OfflineAudioModule.kt:20-95`, `bilibili/BilibiliModule.kt:18-141` | exact |
| `.../library/LegacyMigration.kt` | migration | transform, transactional | `playerPersistence.ts:37-85`, `OfflineCore.kt:186-204` | role-match |
| `.../local/LocalAudioModule.kt`, `LocalAudioPackage.kt` | native bridge | file-I/O, request-response | `offline/OfflineAudioModule.kt:20-95` | exact |
| `.../local/LocalMediaProvider.kt` | provider | file-I/O | `offline/OfflineAudioModule.kt:97-108` | exact |
| `.../local/SafImportActivity.kt`, extractor/LRC helpers | service | file-I/O | `deepseek/DeepSeekKeyActivity.kt` activity registration plus `picker.ts:134-150` UX seam | role-match |
| `.../history/HistoryLedger.kt`, aggregate DAO/repository | service/model | event-driven, batch | `offline/OfflineCore.kt:150-208` | transactional analog |
| `.../history/HistoryModule.kt`, `HistoryPackage.kt` | native bridge | event-driven, request-response | `offline/OfflineAudioModule.kt:72-95` | exact |
| `mobile/android/app/src/main/java/com/listen2mobile/MainApplication.kt` | config/registration | request-response | `MainApplication.kt:13-32` | exact |
| `mobile/android/app/src/main/AndroidManifest.xml` | config | file-I/O | `AndroidManifest.xml:6-35` | exact |
| `mobile/src/library/libraryClient.ts`, DTO/validator helpers | client/utility | request-response | `bilibili/client.ts:1-129`, `offline/offlineAudio.ts:45-106` | exact |
| `mobile/src/library/libraryProjection.ts` and Redux hydration changes | store/migration | transform | `store/playerPersistence.ts:37-85`, `store/index.ts:21-68` | exact |
| `mobile/src/store/librarySlice.ts` | store | CRUD | `librarySlice.ts:27-168` | replacement seam |
| `mobile/src/backup/backupCodec.ts`, `localAudio/backup.ts` | utility | transform, file-I/O | `backupCodec.ts:114-284`, `localAudio/backup.ts:6-26` | exact |
| `mobile/src/localAudio/*` | client/controller | file-I/O, request-response | `offline/offlineAudio.ts:93-159` | exact bridge client |
| `mobile/src/player/playerController.ts` | controller | event-driven | `playerController.ts:46-100` | exact ownership seam |
| `mobile/src/history/historyClient.ts`, `historyController.ts` | client/controller | event-driven, batch | `offline/offlineAudio.ts:107-159`, `playerController.ts:55-74` | role-match |
| `mobile/src/screens/MyMusicScreen.tsx` | component | CRUD, request-response | `MyMusicScreen.tsx:36-68,143-244` | exact |
| `mobile/src/screens/PlaylistDetailScreen.tsx` | component | CRUD, request-response | `PlaylistDetailScreen.tsx:74-123` | exact |
| `mobile/src/screens/SettingsScreen.tsx` | component | request-response | `SettingsScreen.tsx:137-266,278-370` | exact |
| `mobile/src/screens/HistoryScreen.tsx`, recap route/type changes | component/route | transform, request-response | `RootNavigator.tsx:104-147` | role-match |
| JS unit/screen tests | test | CRUD/transform | `backupCodec.test.ts:33-232`, `librarySlice.test.ts:19-122` | exact |
| Kotlin JVM + Android instrumentation migration/SAF tests | test | migration, file-I/O | `OfflineAudioContractTest.kt:15-204`, `BilibiliContractTest.kt:57-177` | exact |

## Pattern Assignments

### Native Room repository, migration and atomic commands

**Copy the ownership and stale-completion model from:** `mobile/android/app/src/main/java/com/listen2mobile/offline/OfflineCore.kt:150-208`.

```kotlin
private val lock = Any()
private val entries = LinkedHashMap<String, OfflineEntry>()
private val active = HashMap<String, ActiveWork>()

fun remove(source: String, trackId: String) {
    val result = synchronized(lock) {
        val removed = entries.remove(key) ?: return@synchronized null
        val work = active.remove(key); work?.reservation = 0
        persistLocked(); Triple(removed.operationId, work, snapshotLocked())
    } ?: return
    result.second?.task?.cancel()
    publish(result.third)
}
```

Implement `LibraryRepository` as the sole Room owner of playlist identity, membership ordering, favorites, local records, queue checkpoints, lyric metadata, history rows/aggregates, and migration/import ledger. Replace the in-memory lock/persist sequence with a Room `withTransaction` (or DAO `@Transaction`) that updates all affected rows and one monotonically increasing `libraryRevision` before returning one safe snapshot/receipt. Send `expectedRevision` with every JS mutation; on mismatch return `STALE_REVISION` and reload projection—never let two writable sources reconcile silently.

Preserve the existing library identity rule from `mobile/src/store/librarySlice.ts:27-40,127-151`: favorite and playlist dedupe key is `(source,id)`; queue occurrences must stay separate, as the player does. Playlist deletion/local-record removal must clean membership, favorites, queue checkpoints and history references inside the same transaction, equivalent to the current reducer cleanup at `librarySlice.ts:75-92`, but durable and atomic.

For migration, copy the defensive semantic-projection approach from `mobile/src/store/playerPersistence.ts:37-85`: read unknown legacy JSON once, type/length-bound each field, copy only semantic metadata, then write a receipt/ledger in the same transaction. Do not use Room destructive migration fallback. Leave the old AsyncStorage library key untouched until Room readback succeeds; a failed import must retain legacy data and yield a safe migration error state.

### Kotlin bridge/package registration

**Copy:** `mobile/android/app/src/main/java/com/listen2mobile/bilibili/BilibiliModule.kt:18-54,126-141` and `offline/OfflineAudioModule.kt:27-90`.

```kotlin
@ReactModule(name = OfflineAudioModule.NAME)
class OfflineAudioModule(private val app: ReactApplicationContext) : ReactContextBaseJavaModule(app) {
    companion object { const val NAME = "Listen2OfflineAudio" }
    @ReactMethod fun listDownloads(promise: Promise) = promise.resolve(snapshot(coordinator().snapshot()))
}

private fun complete(promise: Promise, operation: () -> WritableMap) {
    worker.execute {
        try { promise.resolve(if (invalidated) error(CANCELLED) else operation()) }
        catch (_: IllegalArgumentException) { promise.resolve(error(INVALID_REQUEST)) }
        catch (_: Exception) { promise.resolve(error(PROVIDER_ERROR)) }
    }
}
```

New `Listen2Library`, `Listen2LocalAudio`, and `Listen2History` modules must expose a small allow-listed verb set and validate exact map keys, types, enums, IDs and lengths before scheduling native work. Resolve a safe object with stable error code/status; do not reject with raw exception text. Event emitters are snapshot/receipt notifications only and must stop when React is invalidated. Register each package in `MainApplication.kt:18-25`; keep shared composition/lazy native dependencies patterned after `bilibili/BilibiliPackage.kt:8-29`.

### Secure session and account matrix

**Copy:** `mobile/src/bilibili/client.ts:73-129` and `mobile/android/.../bilibili/BilibiliVault.kt:24-99`.

```ts
function call(name: string, ...args: unknown[]): Promise<unknown> {
  const fn = native?.[name];
  if (typeof fn !== 'function') return Promise.reject(new BilibiliClientError('UNAVAILABLE'));
  return (fn as (...items: unknown[]) => Promise<unknown>)(...args);
}
```

```kotlin
/** Native-only encrypted storage; React Native has no plaintext getter. */
override fun clear() {
    if (!preferences.edit().clear().commit()) throw IllegalStateException("secure-storage-failed")
    // remove Keystore alias too
}
```

Keep Bilibili QR begin/poll/cancel/restore/logout exactly behind its existing native vault/session; only project `BilibiliPublicState`. Account-matrix UI must use declared provider capability/status values and show unsupported/unverified as truthful terminal states—no generic login route or synthetic success. Logout clears identifiable session and protected cache references only; it must not delete Room library/history/local data.

### SAF import and opaque local playback

**Current code to replace, not extend:** `mobile/src/localAudio/picker.ts:92-149`, `types/music.ts:22-49`.

The current picker correctly limits physical `content://` audio and cancellation, but returns/persists the URI into TS. Move `ACTION_OPEN_DOCUMENT`, `EXTRA_ALLOW_MULTIPLE`, grant persistence, MIME/extension validation, metadata/artwork/duration and optional LRC association to native code. Return `{ localRecordId, source:'local', title, artist, album?, durationMs?, artwork?, mimeType?, accessStatus }` only. Native stores URI/grant privately and checks it again at playback/repair.

**Copy opaque content-provider mechanics from:** `mobile/android/app/src/main/java/com/listen2mobile/offline/OfflineAudioModule.kt:97-108`.

```kotlin
class OfflineAudioProvider : ContentProvider() {
    override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor {
        if (mode != "r" || uri.pathSegments.size != 1) throw FileNotFoundException("not-found")
        val file = OfflineRegistry.get(requireNotNull(context)).file(uri.lastPathSegment)
            ?: throw FileNotFoundException("not-found")
        return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
    }
}
```

Create non-exported `LocalMediaProvider` with an opaque record ID authority and read-only `openFile`; resolve the third-party grant only native-side. Add its non-exported manifest entry following `AndroidManifest.xml:15-17`. JS receives this app-private URI only in the RNTP handoff object; never retain it in Redux, backup, navigation state, accessibility labels or errors. Reuse `releaseLocalAudioAccess`'s cleanup philosophy (`localAudio/access.ts:4-16`): remove durable record first, and treat grant-release failure as non-user-facing cleanup.

### Backup codec and import transaction

**Copy validation boundary from:** `mobile/src/backup/backupCodec.ts:114-203,239-284`.

```ts
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const CREDENTIAL_KEY_PATTERN = /(?:token|cookie|secret|password|...)/i;
const LOCAL_PATH_PATTERN = /^(?:file|content):\\/\\/|^(?:\\/|~[\\\\/]|...)/i;

function assertSafeTree(value: unknown, depth = 0, active = new Set<object>()) {
  if (depth > 32) fail('INVALID_BACKUP', '备份数据嵌套层级过深');
  // reject credential keys, prototype keys, local handles and non-plain objects
}
```

Keep this bounded parse-before-plan contract, but bump to a Phase-06 portable document that contains only personal playlists, favorites and necessary non-sensitive remote semantic metadata. Explicitly remove queue, queue mode, lyric/settings/cache/local records/paths/URIs/media and all session material; replace `createPortableBackupState` (`localAudio/backup.ts:6-26`) rather than copying its queue export.

`planImport` remains pure and previewable. The native repository must apply the already validated merge/overwrite in *one* transaction and return a receipt with counts (identical skipped, same-name independent, ID reminted). Do not repeat current Settings behavior at `SettingsScreen.tsx:328-352`, which applies player queue then library separately and can leave a partial import. Overwrite requires the second UI confirmation before the native call.

### UI projection, CRUD state and navigation

**Copy component conventions from:** `MyMusicScreen.tsx:36-68,143-244`, `PlaylistDetailScreen.tsx:74-123`, and `RootNavigator.tsx:104-147`.

```tsx
const importAudio = async () => {
  if (importingLocalAudio) return;
  setImportingLocalAudio(true);
  const result = await pickLocalAudio();
  setImportingLocalAudio(false);
  if (result.status === 'cancelled') return;
  // update only from a confirmed receipt; show classified safe status
};
```

Screen commands should hold local `busy/error/receipt` state, disable only the pending command, retain last confirmed projection, and replace Redux projection only from matching repository acknowledgement. Use existing `Alert.alert` destructive-confirmation pattern (`SettingsScreen.tsx:355-369`; `PlaylistDetailScreen.tsx` deletion actions) with cancel first and `destructive` confirmation. Follow `RootNavigator.tsx:129-145` for new History/Recap routes and `navigation/types.ts` for typed parameters—pass IDs, not raw local tracks/URIs.

### Valid-play history ledger

**Copy controller ownership/guard conventions from:** `mobile/src/player/playerController.ts:46-74,76-100`.

```ts
function assertNativeOperationCurrent(context?: NativeOperationContext) {
  if (context && (!context.isCurrent() || !context.isTargetAvailable()))
    throw STALE_NATIVE_COMMAND;
}
```

Add a narrow asynchronous `recordPlaybackSegment` call from confirmed RNTP state/progress transitions. Send only occurrence ID, semantic source/track ID, position/duration, monotonic elapsed segment, playback instance/generation and reason. Native ledger decides eligibility: count once only after actual forward play exceeds 30 seconds and `min(duration/2, 4 minutes)`, rejecting seek/pause/buffer/preload/failure/stale generation. Persist local-date/year at commitment and aggregate in Room; event writes must never block `playTracks` or alter its transactional lifecycle.

History preference belongs in DataStore as a small non-sensitive flag. For disable/clear, use a persistent generation fence before deleting Room history/aggregates so queued/stale writes cannot resurrect rows. Export through the same bounded, allow-listed serializer approach as backup.

## Shared Patterns

### Strict native DTO boundary

Apply to all JS↔Kotlin commands. Native exact-key validation is demonstrated at `BilibiliModule.kt:39-70,223-241`; TypeScript exact-key response parsing at `bilibili/client.ts:38-72,79-129`. Unknown fields, invalid enum/type/length and stale revisions get stable safe code. Never pass arbitrary URLs, headers, SQL, file handles, cookies or diagnostic exception strings.

### Serialized ownership and cancellation

Apply to repository mutations, SAF jobs, migration and ledger writes. Use a single repository executor/transaction with an operation/mutation token, equivalent to `OfflineCore.kt:168-208` and `BilibiliModule.kt:126-141`. Publish only active/current snapshots. Cancelled or invalidated React calls yield `CANCELLED`, not a late success.

### Safe retention on failure

Apply to all CRUD/import/repair/migration UI. Existing remote-detail loading (`PlaylistDetailScreen.tsx:74-110`) cancels prior work, generations replies, and leaves explicit `error`; follow that model. Do not map provider/repository failure to an empty collection and do not erase confirmed data.

### Test entrypoints

- TS pure validation/plan tests: extend `backup/__tests__/backupCodec.test.ts:33-232`, `localAudio/__tests__/picker.test.ts:34-98`, and `store/__tests__/librarySlice.test.ts:19-122` for safe DTO projection, duplicate/order/revision and no URI/secret export.
- TS screen tests: follow existing screen-flow tests under `mobile/src/screens/__tests__/`; cover busy/retained-data/error/confirmation/accessibility labels and account-matrix terminal states.
- Kotlin JVM boundary/transaction tests: copy deterministic fakes/manual executor layout in `offline/OfflineAudioContractTest.kt:15-204` and session stale/cancel/safe-state tests in `bilibili/BilibiliContractTest.kt:57-177`.
- Android instrumentation only for Room schema migration and SAF/content-provider grant/revoke behavior. These do not claim Phase-08 emulator/live-provider acceptance.

## Anti-patterns and migration traps

1. Do not leave Redux Persist and Room independently writable after cutover. Legacy data is read once; Room receipt/readback selects the active owner.
2. Do not keep or “sanitize later” `contentUri`, bookmark, raw LRC path or absolute path in TS. The current `LocalTrack` model is specifically a migration target, not a reusable interface.
3. Do not let a picker result mean media is playable. Every native playback/open must revalidate grant/readability and return repair/remove-safe status.
4. Do not count at play start, on every progress callback, or before native dedupe. The ledger owns threshold, instance ID and clear generation.
5. Do not run backup queue mutation and library mutation separately. Preview is pure; apply is exactly one native transaction.
6. Do not model QQ/Kugou/Kuwo/Migu/Taihe as logged in without a declared verified native route. Their UI state is honest `unsupported`/`unverified` fixture output.
7. Do not extend Phase-07 download/cache ownership or claim API-35/device/live-provider verification in this phase.

## Metadata

**Analog search scope:** `mobile/src`, `mobile/android/app/src/main`, `mobile/android/app/src/test`, Phase 05 patterns.
**Files scanned:** focused 25 source/test/planning artifacts.
**Pattern extraction date:** 2026-09-15.
