# Phase 6 Coverage Baseline — Personal Library & Continuity

**Status:** planning baseline; no Phase 6 implementation, APK, live-provider,
or device acceptance claim.

**Canonical route:** `mobile/` React Native UI and `mobile/android/` Kotlin
modules. The old `android/` WebView route, Electron/Angular sources, and
archived Phase 5 WebView plans are read-only historical context.

## Evidence semantics

- `partial` means a current test or seam proves only a related foundation; it
  does not close the requirement.
- `gap` is the missing owner, boundary, failure path, or evidence.
- `owner` names a future Phase 6 plan placeholder, not an existing plan file.
- Phase 7 cache/media-byte behavior and Phase 8 runtime/live/release gates are
  explicitly excluded even where a current offline or Bilibili test is useful
  context.

## Fifteen-requirement coverage map

| Requirement | Current evidence (partial only) | Current gap | Owning future plan | Boundary / non-owner |
|---|---|---|---|---|
| `LIB-001` — distinguish personal/favorite/remote/local collections and retain valid local browsing offline | `mobile/src/store/__tests__/librarySlice.test.ts` covers favorites, playlists, recent/local reducer cleanup; `MyMusicScreen.tsx` renders basic local/favorite/personal sections. | No Room source of truth, remote sync-state projection, offline retention test, or repository-backed library screen. | `06-03-PLAN.md` (with Room/cutover foundation from `06-01` → `06-02`) | Room owns semantic collection/status data; DataStore does not hold lists; remote/network failure must not erase local data. Phase 7 cache is not a library-sync proof. |
| `LIB-002` — playlist/favorite CRUD, order, duplicate and destructive confirmation | `librarySlice.test.ts` covers create and `(source,id)` playlist de-duplication; current screens have basic create/delete affordances. | Rename/edit/reorder/receipt semantics, confirmation focus, native atomic mutation, rapid failure and rollback are absent. | `06-03-PLAN.md` | Room transaction + safe UI receipt; queue occurrence duplicates remain a Phase 5/player concern, not a playlist duplicate shortcut. |
| `LIB-003` — rapid-edit/restart consistency and capability-gated actions | `mobile/src/store/__tests__/playerPersistence.test.ts` covers player-state sanitization; `store/index.ts` has Redux Persist migration. | Library has no revision/receipt owner, restart/process-recovery test, or capability-derived action projection. | `06-01-PLAN.md` → native prerequisite; `06-02-PLAN.md` → cutover; `06-03-PLAN.md` → library closure | Room is sole durable owner after verified migration; RNTP remains sole player owner; unavailable playback/lyrics/download actions stay hidden. |
| `AUTH-001` — truthful per-provider account-state matrix | `mobile/src/bilibili/__tests__/client.test.ts`, Settings Bilibili state wiring, and native `bilibili/BilibiliSession.kt` provide Bilibili-related public states. | No fixed seven-row matrix for QQ/Kugou/Kuwo/Migu/Taihe/Bilibili/NetEase, no consistent public capability projection, and no screen-flow tests. | `06-03-PLAN.md` | Native account/session state and capability registry own truth; no generic login bridge or fake provider state. |
| `AUTH-002` — Bilibili QR lifecycle and controlled other-provider outcomes | `mobile/android/app/src/test/java/com/listen2mobile/bilibili/BilibiliContractTest.kt` covers waiting/scanned/expired/cancelled/authenticated state; JS Bilibili client tests validate DTOs. | Full UI lifecycle/retry/refresh ownership and stale attempt handling are not covered; other provider login routes are not verified. | `06-03-PLAN.md` | Bilibili native QR/refresh is reused; real scan/account entitlement remains Phase 8, and no unverified provider gets a login button. |
| `AUTH-003` — Keystore-only secrets and logout/new-session cleanup | `mobile/android/app/src/main/java/com/listen2mobile/bilibili/BilibiliVault.kt` and `BilibiliSession.kt` keep session material native; Bilibili JVM contract covers parts of the lifecycle. | Cross-data retention, protected-reference cleanup, re-login non-reuse, JS/backup/log redaction and runtime Keystore evidence are incomplete. | `06-03-PLAN.md` | Keystore/native vault owns secrets; Room keeps playlists/history/local records; Phase 8 owns real Keystore/account/runtime proof. |
| `LOCAL-001` — multi-select SAF import without broad storage permission | `mobile/src/localAudio/__tests__/picker.test.ts` bounds multi-select and accepts persistable physical `content://` documents. | The current picker returns raw URI/bookmark values to TypeScript; no native `ACTION_OPEN_DOCUMENT`, persisted-grant, format or instrumentation proof exists. | `06-04-PLAN.md` | SAF grant and `ContentResolver` are native-only; JS receives opaque record metadata. |
| `LOCAL-002` — metadata/artwork/duration/LRC, library/queue/playback | Current picker/library/player tests exercise JS conversion and a raw local URI handoff; `OfflineAudioContractTest.kt` is for private downloaded media. | No native tag/artwork/duration extractor, explicit/authorized LRC association, opaque local provider, or local Media3/RNTP proof. | `06-04-PLAN.md` → import/metadata/LRC; `06-05-PLAN.md` → private RNTP playback | SAF/local-record/provider belong to Phase 6; downloaded media/cache bytes and offline resolver lifecycle remain Phase 7. |
| `LOCAL-003` — repair/revoke/unsupported safety and no handle leakage | Picker tests reject invalid/virtual/duplicate selections; `librarySlice.test.ts` removes local references; `localAudio/backup.test.ts` filters local tracks. | Raw URI is still a JS model field; no grant revocation/moved-file/non-seekable provider test or recursive bridge/backup/log scan. | `06-05-PLAN.md` (with import foundation from `06-04`) | Native opaque local ID and non-exported read-only provider only; never delete the original device file or expose a path/URI. |
| `DATA-001` — Room durable relational state and DataStore-only small settings | `store/index.ts` and `playerPersistence.test.ts` prove only Redux Persist/player sanitization; current `OfflineCore` catalog is not Room. | No Room schema/DAO/migrations/exported schema, migration ledger/readback, DataStore flags, or cache-catalog schema boundary. | `06-01-PLAN.md` → native storage/migration; `06-02-PLAN.md` → production cutover | Room owns library/history/queue checkpoint/lyric metadata/local records and a catalog schema slot; Phase 7 owns cache behavior/media bytes. DataStore cannot hold lists or secrets. |
| `DATA-002` — strict portable backup allow-list | `mobile/src/backup/__tests__/backupCodec.test.ts` rejects credential/path/prototype fields; `localAudio/__tests__/backup.test.ts` filters local tracks. | Current portable shape still exports queue and is not the required Phase 6 personal/favorite-only document; native/recursive redaction evidence is missing. | `06-03-PLAN.md` | Backup owns only personal/favorite playlists and necessary safe metadata; no Room database copy, SAF grant, account, lyric, cache, or media export. |
| `DATA-003` — previewed merge/default, confirmed overwrite and rollback | `backupCodec.test.ts` has pure merge/overwrite planning and conflict counts. | `SettingsScreen.tsx` currently applies queue and library separately; no native one-transaction apply, interrupted/corrupt rollback, or screen confirmation test. | `06-03-PLAN.md` | UI previews; Room applies one transaction. Phase 7 cache is never imported/exported; Phase 8 only tests integrated recovery. |
| `HIST-001` — genuine-play threshold and exactly-once dedupe | Player tests cover accepted previous/history-pointer and `librarySlice.test.ts` covers recent-list de-duplication. | No threshold ledger, monotonic segment handling, seek/pause/buffer/preload exclusion, or native asynchronous commit. | `06-06-PLAN.md` → native ledger; `06-07-PLAN.md` → RNTP adapter | History ledger owns validity; RNTP callback observation is semantic only and must not delay first playback. |
| `HIST-002` — restart/midnight/year-consistent history and recap | `playerPersistence.test.ts`/player slice tests preserve transport-free history pointers, not valid listening aggregates. | No Room history rows/aggregates, completion date/year rule, annual metrics, monthly trend, restart or boundary fixture. | `06-06-PLAN.md` → Room/restart/year; `06-07-PLAN.md` → recap UI | Room history/aggregate owner; Phase 8 owns process-death/system playback journey, not the ledger rule itself. |
| `HIST-003` — disable/export/clear privacy without start latency | `clearRecent` is only a recent-track reducer; no valid-history privacy store exists. | No DataStore opt-out, safe history export, irreversible clear, clear-generation fence, delayed-write test, or UI accessibility flow. | `06-06-PLAN.md` → native preference/fence; `06-07-PLAN.md` → privacy UX | DataStore holds the small preference; Room clears history/aggregates; backup/cache/logs cannot restore it. |

## Ownership ledger

The following ledger prevents cross-phase or cross-storage claims from being
merged by implication:

| Boundary | Phase 6 responsibility | Explicitly not owned here |
|---|---|---|
| Room | Playlist/favorite/local metadata, membership ordering, semantic queue checkpoint and lyric metadata needed for continuity, migration/import receipts, history rows/aggregates, and the required cache-catalog schema boundary | Media bytes, signed URLs, download jobs, cache eviction, or Phase 7 offline playback behavior |
| Preferences DataStore | Small non-sensitive flags: history enabled/disabled, migration/backend markers, and later-approved bounded settings | Playlists, queue/history lists, local records, credentials, cookies, API keys, or arbitrary JSON state |
| SAF / `ContentResolver` | Native document selection, persisted grant, bounded inspection, LRC association, repair/revoke, and opaque local-record provider | Broad storage permission, JS-visible raw URI/path/bookmark, deleting user originals, or claiming all cloud/device providers work |
| Account / Keystore | Bilibili QR/session/refresh/logout lifecycle and public matrix projection; truthful terminal states for other providers | Credentials in JS/Room/backup/logs, fake login routes, live account entitlement and real Keystore/device proof (Phase 8) |
| History | Genuine-play ledger, exactly-once commit, stable local date/year, recap queries, opt-out/export/clear fence | Counting `recordRecent`, cache hits, page browsing, seek/buffer/preload, or synchronous writes on the playback start path |
| Portable backup | Versioned personal/favorite allow-list, parse/preview, default merge, confirmed overwrite, conflict counts and safe transaction receipt | Queue/checkpoint, lyrics, settings/theme, local records/URI grants, account/session, cache/download/media, raw logs |
| Phase 7 cache and advanced playback | — | Temporary/playlist/explicit-download ownership, bytes/hash/quota/eviction/offline resolver, rendition/MV/PiP, effects, spectrum, loudness and DeepSeek translation |
| Phase 8 integrated runtime | — | API 35 APK install, live provider/account/SAF, RNTP notification/lock-screen/audio-focus/process recovery, real accessibility/performance and release-like artifact/signature/hash gates |

## Coverage state and hand-off rule

The current baseline is intentionally incomplete: no row above is `complete`.
`06-VALIDATION.md` defines the focused/full/JVM/instrumentation evidence each
owner must add and the Nyquist positive/negative sample before expanding.

When an owning plan finishes, its summary must report each row as `covered`,
`partial`, `blocked`, or `not verified` with command, fixture, and recovery
evidence. A row remains incomplete if any required mapped evidence is missing,
if a raw secret/URI/path leaks, if a failure is silently converted to empty
success, or if the result depends on Phase 7/8 behavior.

Passing Phase 6 deterministic tests can close an implementation slice only; it
does not make the integrated application `parity-ready`. That label belongs to
the Phase 8 plan after the recorded API 35 human/device/live/release-like gates
pass. No product code, APK, live provider, commit, or push is part of this
coverage-baseline task.
