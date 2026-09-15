# Phase 6 Validation Contract — Personal Library & Continuity

**Status:** planning contract; no Phase 6 implementation or validation command
was run while creating this document.

**Applicability:** This contract covers the canonical `mobile/` React Native
application and its Kotlin Android modules. `android/`, Electron/Angular, and
`legacy-webview-plans/` are not validation targets. Phase 7 owns cache/download,
advanced playback/effects/loudness/translation behavior; Phase 8 owns installed
API 35, live provider, system-runtime, performance, and release-like evidence.

## Evidence vocabulary and gates

Evidence must be labelled rather than implied:

- **existing partial** — a current test or implementation seam exercises a
  related behavior but does not satisfy the Phase 6 owner/boundary;
- **focused planned** — the future plan must add/run this narrow test before it
  expands its slice;
- **full planned** — the complete deterministic mobile gate after all focused
  tests in the current slice pass;
- **JVM planned** — deterministic Kotlin/Room/policy contract evidence;
- **instrumentation planned** — Android-specific Room migration, SAF grant,
  provider, or lifecycle evidence using controlled fixtures, not live accounts;
- **Phase 8 only** — an installed-device/live/human gate explicitly excluded from
  Phase 6; it cannot be substituted by a unit, JVM, or APK-build result.

The words `PASS` and `complete` in a future evidence record require the command,
source/fixture, environment, date, result, uncovered items, and recovery path.
This planning document itself records no pass.

### Focused JavaScript gates

The following commands are future plan entrypoints. Paths under `library/`,
`history/`, and the new screen-flow tests are intentional test placeholders;
the owning plan may refine a test filename, but must preserve the behavior and
evidence mapping.

```sh
# F06-01: native Room repository/bridge/migration
./mobile/android/gradlew --offline -p mobile/android :app:testDebugUnitTest --tests \
  'com.listen2mobile.library.LibraryRepositoryTest' \
  --tests 'com.listen2mobile.library.LibraryBridgeContractTest'

# F06-02: Redux cutover, hydration and rollback
npm --prefix mobile test -- --runInBand \
  src/store/__tests__/playerPersistence.test.ts \
  src/store/__tests__/librarySlice.test.ts \
  src/library/__tests__/libraryMigration.test.ts \
  src/library/__tests__/libraryRepositoryClient.test.ts

# F06-03: library, backup, account and UI receipts
npm --prefix mobile test -- --runInBand \
  src/store/__tests__/librarySlice.test.ts \
  src/backup/__tests__/backupCodec.test.ts \
  src/localAudio/__tests__/backup.test.ts \
  src/screens/__tests__/libraryFlow.test.tsx \
  src/screens/__tests__/accountFlow.test.tsx \
  src/screens/__tests__/backupFlow.test.tsx

# F06-04: native SAF import/metadata/artwork/explicit LRC
npm --prefix mobile test -- --runInBand \
  src/localAudio/__tests__/picker.test.ts \
  src/localAudio/__tests__/localLibraryFlow.test.tsx

# F06-05: private provider/RNTP/repair/removal
npm --prefix mobile test -- --runInBand \
  src/localAudio/__tests__/localLibraryFlow.test.tsx \
  src/player/__tests__/playerController.test.ts

# F06-06: native ledger/restart/year/clear fence
./mobile/android/gradlew --offline -p mobile/android :app:testDebugUnitTest --tests \
  'com.listen2mobile.history.ListeningLedgerTest' \
  --tests 'com.listen2mobile.history.HistoryBridgeContractTest'

# F06-07: RNTP adapter and privacy/recap UI
npm --prefix mobile test -- --runInBand \
  src/history/__tests__/historyLedger.test.ts \
  src/history/__tests__/historyPrivacy.test.tsx \
  src/screens/__tests__/historyFlow.test.tsx \
  src/player/__tests__/playerController.test.ts \
  src/player/__tests__/playerController.lifecycle.test.ts
```

Current `librarySlice.test.ts`, `backupCodec.test.ts`, `localAudio/picker.test.ts`,
`localAudio/backup.test.ts`, and player/Bilibili tests are reusable baseline
fixtures. They are not substitutes for the planned native-repository, opaque
local-record, or ledger tests; the current raw local URI and queue-in-backup
shapes are specifically expected to change.

### Full deterministic mobile gates

After the focused command for a slice, run the repository-defined full JS gates:

```sh
npm run mobile:test
npm run mobile:typecheck
npm --prefix mobile run lint -- --quiet
cd mobile
npx prettier --check <the exact Phase-06 files touched by the owning plan>
```

`npm run mobile:test` is the root wrapper for Jest with `--runInBand`; the
formatter file list must be explicit and must not hide unrelated formatting
changes. A full JS pass proves deterministic JS contracts only.

### Kotlin/JVM and Android instrumentation gates

Run the relevant focused test classes first, then the full JVM suite:

```sh
cd mobile/android
./gradlew --offline :app:testDebugUnitTest --tests \
  'com.listen2mobile.library.*' \
  --tests 'com.listen2mobile.local.*' \
  --tests 'com.listen2mobile.history.*'

# Full current native deterministic suite after focused classes pass.
./gradlew --offline :app:testDebugUnitTest
```

The owning plans create these exact classes. A missing JDK/Gradle dependency
makes the result `blocked` or `not verified`, not green.

The Android-only gates are deliberately narrow and fixture-based. Each owning
plan compiles its exact instrumentation source; after all seven plans, the consolidated
Phase 6 invocation is:

```sh
cd mobile/android
./gradlew :app:connectedDebugAndroidTest \
  -Pandroid.testInstrumentationRunnerArguments.class=com.listen2mobile.library.LibraryRepositoryInstrumentationTest,com.listen2mobile.library.LibraryMigrationTest,com.listen2mobile.library.BackupTransactionInstrumentationTest,com.listen2mobile.local.SafImportInstrumentationTest,com.listen2mobile.local.LocalMediaProviderInstrumentationTest,com.listen2mobile.history.ListeningLedgerInstrumentationTest
```

Instrumentation proves Android storage/provider semantics with fake or
controlled documents; it does not prove a user-selected cloud file, a live
provider, a screen-off system session, or a release APK.

## Per-requirement evidence map

`J-FULL` means all full JS gates above, including the exact formatter list for
the current plan. `K-FULL` means the full offline JVM suite. `I-06` means the
controlled Phase-6 instrumentation suite. Existing entries are marked partial;
planned files are ownership placeholders rather than present evidence.

| Requirement | Focused evidence (current baseline → required) | Full JS | JVM evidence | Instrumentation evidence | Do not claim complete until |
|---|---|---|---|---|---|
| `LIB-001` | Existing partial: `librarySlice.test.ts`, `MyMusicScreen.tsx`. Planned: `libraryFlow.test.tsx` proves personal/favorite/remote/local labels, sync states, offline local retention. | `J-FULL` | Planned `LibraryRepositoryTest` proves source/type/sync projection and remote failure retention. | Planned Room/restart fixture in `LibraryMigrationTest`; separate Phase 8 integrated offline device journey. | The repository snapshot, UI state, and a failed remote refresh all retain valid local data in focused + JVM + restart instrumentation evidence. |
| `LIB-002` | Existing partial: `librarySlice.test.ts` covers create and playlist de-duplication. Planned `libraryFlow.test.tsx` covers rename/edit/reorder/favorite/delete, confirmation and receipt failure. | `J-FULL` | Planned `LibraryRepositoryTest` proves one-transaction CRUD, duplicate rule, order and destructive rollback. | Planned library process/recreation fixture proves the acknowledged order survives Android recreation. | Every mutation is receipt-backed, duplicate/order behavior is explicit, delete failure retains data, and focused/JVM/instrumentation results agree. |
| `LIB-003` | Existing partial: Redux player persistence tests, but no library revision. Planned migration/revision and `libraryFlow.test.tsx` race/restart cases. | `J-FULL` | Planned repository stale-revision/transaction test. | Planned migration and process-recovery fixture; capability-gated action screen assertion. | Rapid edits, restart/rotation and recovery produce one confirmed ordering/identity snapshot and hide unavailable playback/lyrics/download/delete actions. |
| `AUTH-001` | Existing partial: Bilibili client/Settings paths. Planned `accountFlow.test.tsx` renders the fixed seven-provider matrix and distinct public states/actions. | `J-FULL` | Existing `bilibili/BilibiliContractTest.kt` proves the only native session route; the typed closed-state matrix is a deterministic JS/UI contract. | The one final controlled Phase-6 fixture run verifies native registration/storage seams; live account remains Phase 8. | Every provider row has a truthful public state and only controlled routes expose an action; no fake login is shown. |
| `AUTH-002` | Existing partial: `mobile/src/bilibili/__tests__/client.test.ts` and Settings polling. Planned `accountFlow.test.tsx` covers waiting/scanned/success/expired/cancel/retry/refresh. | `J-FULL` | Existing `bilibili/BilibiliContractTest.kt` covers QR state machine; extend refresh/logout edge cases. | Planned fake-gateway/native-module lifecycle test; actual QR/account scan remains Phase 8 only. | The native/public state lifecycle and UI cancellation/retry are deterministic, stale attempts cannot commit, and unverified providers have no login button. |
| `AUTH-003` | Existing partial: `BilibiliVault.kt`/`BilibiliSession.kt` and Bilibili contract tests. Planned account-flow redaction and logout-retention cases. | `J-FULL` | Existing vault/session contract plus planned clear-owned-session and new-login tests. | Planned keystore/session cleanup and library-preservation fixture; real Keystore behavior remains a Phase 8 runtime check. | Secrets never enter JS/backup/logs/notifications, logout clears session/protected references, and library/history/local records survive and do not reuse the old session. |
| `LOCAL-001` | Existing partial/unsafe baseline: `localAudio/picker.test.ts` proves multi-select and persistable `content://` filtering but currently returns the URI to JS. Planned native client/flow tests use opaque records. | `J-FULL` | Planned `LocalAudioPolicyTest` validates MIME/count/identifier bounds. | Planned `SafImportInstrumentationTest` proves `ACTION_OPEN_DOCUMENT`, persisted grant and no broad storage permission. | Native owns the grant and only safe record metadata crosses the bridge; all required formats and multi-select are exercised in instrumentation. |
| `LOCAL-002` | Existing partial: picker conversion, library reducer and player local-URI tests; no native metadata/LRC/provider. Planned local client/flow and explicit-LRC tests. | `J-FULL` | Planned metadata/LRC and opaque-provider contract tests. | Planned SAF metadata/LRC/provider playback fixture; actual device/cloud/codec playback remains Phase 8. | Tags/artwork/duration/LRC and local playlist/queue/RNTP handoff work through the opaque record path without exposing the grant. |
| `LOCAL-003` | Existing partial: picker rejects duplicates/invalid documents and reducer removes references; raw URI still leaks. Planned repair/revoke/redaction tests. | `J-FULL` | Planned `LocalMediaProviderContractTest` for read-only/opaque IDs and repair statuses. | Planned revoke/move/unreadable/unsupported/non-seekable instrumentation with backup/JS leak scan. | Each failure has repair/remove action, original files are not deleted, and no raw URI/path/handle appears in JS, bridge, backup, or logs. |
| `DATA-001` | Existing partial: Redux Persist/player sanitizer tests only; no Room/DataStore. Planned migration/repository client tests cover semantic projection and idempotent receipt. | `J-FULL` | Planned repository/data-boundary contracts; no JSON blob or secret in DataStore. | Planned `LibraryMigrationTest` with exported Room schema and explicit migration/readback; cache catalog schema only, not Phase 7 cache behavior. | Room is the durable relational owner, DataStore contains only bounded non-sensitive flags, migration is explicit/reversible, and the Android migration fixture passes. |
| `DATA-002` | Existing partial: `backupCodec.test.ts` rejects secrets/paths; `localAudio/backup.test.ts` filters local media, but the current document still exports queue. Planned V2 backup tests. | `J-FULL` | Planned native export/redaction contract where repository owns the projection. | Planned backup boundary/restore fixture if export/import crosses native storage; no cache/media bytes. | Versioned output contains only personal/favorite playlists plus allowed metadata and a recursive secret/path/URI scan is clean. |
| `DATA-003` | Existing partial: `backupCodec.test.ts` has pure merge/overwrite planning. Current Settings applies queue and library separately. Planned preview/receipt/rollback screen tests. | `J-FULL` | Planned one-transaction merge/overwrite/conflict/rollback repository test. | Planned interrupted/corrupt/oversize migration/import fixture preserving the prior Room snapshot. | Preview is side-effect free, merge is default, overwrite has a second confirmation, and every malformed/failed apply leaves existing data unchanged. |
| `HIST-001` | Existing partial: `recordRecent` and player history-pointer tests are not valid-play accounting. Planned `historyLedger.test.ts` covers threshold, seek/pause/buffer/preload/failure and duplicate callbacks. | `J-FULL` | Planned `ListeningLedgerTest` proves monotonic segments and exactly-once eligibility. | Planned persistence/restart fixture for committed ledger rows; RNTP/system behavior remains Phase 8. | Only forward playback over 30 seconds and the smaller of half duration/four minutes commits once; all excluded events remain excluded. |
| `HIST-002` | Existing partial: player history pointer/rehydration only; no recap aggregate. Planned ledger/recap screen tests for restart, midnight/year and empty state. | `J-FULL` | Planned aggregate/date-key tests for duration, valid plays, distinct tracks/artists, top values and monthly trend. | Planned history restart/year-boundary Room fixture; integrated process death remains Phase 8. | Committed history and recap aggregates remain stable across restart/time boundary and show no fabricated top values when data is insufficient. |
| `HIST-003` | Existing partial: `clearRecent` is a recent-list reducer, not history privacy. Planned `historyPrivacy.test.tsx` covers disable/export/clear and non-blocking UI. | `J-FULL` | Planned DataStore preference, asynchronous writer, clear-generation fence and export-redaction test. | Planned clear/restart fixture proves delayed events cannot resurrect rows; user/device privacy behavior remains Phase 8. | Disable stops new writes, export is safe, irreversible clear removes history/aggregates, late events cannot restore them, and playback start is not delayed. |

## Nyquist sampling and progressive expansion

The minimum Nyquist sample for each future plan is one representative positive
fixture plus one negative/race/rollback fixture at every new ownership boundary.
The sample is a stop/expand gate, not a completion claim. Do not expand to a
large dataset or all screens until both samples pass and the output contains no
raw secret, URI, path, transport URL, or uncategorized error.

| Slice | Positive sample before expansion | Negative/race sample before expansion | Required observation |
|---|---|---|---|
| `06-01` native Room/bridge/migration | One revisioned playlist mutation commits, reopens, and one bounded legacy snapshot copies/validates/activates once. | Stale/duplicate/malformed mutation or interrupted/failed migration rolls back, keeps legacy selected, and retries without duplicate rows. | Actual Room CRUD/reopen, exported schema, bridge bounds, DataStore-only flags and retained migration source. |
| `06-02` Redux cutover/hydration | One safe native snapshot hydrates a fresh store and one matching receipt updates its projection. | Malformed/stale/late receipt or native migration/hydration failure retains the confirmed/legacy state and exposes retry. | No persisted library ownership, no invented empty state, paused URL-free legacy DTO and later-start readback. |
| `06-03` library/account/backup | One playlist create → add/remove/reorder/favorite flow, backup preview/apply, and fixed account matrix render from confirmed state. | Rapid stale edit, malformed/oversize/stale/failed backup or stale QR/logout attempt retains confirmed non-account data. | Complete CRUD, provider truth, recursive backup redaction and actual one-transaction Room backup rollback. |
| `06-04` SAF import/metadata/LRC | One accepted multi-select document yields bounded metadata/artwork and explicit LRC on an opaque record. | Cancel/late/duplicate/unsupported/unreadable/oversized metadata-art-LRC input performs no unsafe or partial write. | Independent package, native grant ownership, exact metadata JVM tests and fake-provider import instrumentation. |
| `06-05` provider/RNTP/repair | One valid provider token opens read-only and the matching local load reaches RNTP; one repair preserves identity. | Expired/reused/wrong token, write/query/delete/traversal, revoke/mismatch/cancel/remove failure is rejected without source deletion/leak. | Exact provider policy/instrumentation, transient URI handoff, non-seekable capability and relationship-safe repair/removal. |
| `06-06` native history ledger | One session crosses the exact threshold and creates one history/aggregate transaction with stable local buckets. | Seek/pause/buffer/preload/failure/duplicate, restart/year/timezone and old-generation-after-clear produce no false/resurrected row. | JVM state machine, independent async package, actual Room restart/aggregate/year/clear-fence instrumentation. |
| `06-07` RNTP history/recap/privacy UI | One identity-confirmed RNTP session appears once in recent/history/recap without delaying playback. | Lifecycle stale callbacks, disable, export redaction, clear/remount/reload race preserve privacy and cannot resurrect data. | Required lifecycle/history/privacy JS files, recap completeness, disposable projection and no player regression. |

After the seven samples pass, run each plan's complete focused set, then
`J-FULL`, `K-FULL`, and the applicable `I-06` classes. A failed sample stops
expansion at that slice; preserve the evidence and fix or replan before adding
more entities/screens/providers.

## Evidence record requirements

Every future result must record:

- date/time and timezone, current worktree/commit identity, and canonical
  `mobile/` route;
- exact command and focused/full/JVM/instrumentation class or test path;
- JDK/Gradle/Android/API/device or emulator configuration where relevant;
- sanitized fixture identity and data shape, not its user contents or secrets;
- pass/fail/blocked/not-verified outcome, uncovered behavior, and recovery path;
- whether the result is deterministic Phase 6 evidence or a Phase 8-only gate.

Never include credentials, cookies, refresh material, API keys, signed media
URLs, local paths/URIs, raw backup text, raw provider bodies, or runtime logs.

## Conditions that prohibit a `complete` claim

Do not mark an individual requirement, plan, or Phase 6 as complete when any of
the following is true:

- only a screen, mocked HTTP response, TypeScript compile, Jest subset, JVM
  suite, APK build, or existing foundation test passed;
- the focused happy path passes but the mapped negative/race/rollback or
  redaction sample is absent;
- Room/DataStore ownership is not cut over, two writable stores can diverge,
  migration can delete legacy data on failure, or a DataStore JSON blob holds a
  collection;
- a raw local URI/path/grant/handle appears in JS, Redux, navigation, backup,
  accessibility text, logs, or a generic bridge;
- backup still includes queue, local handles, lyrics/settings, cache/media, or
  account/session material, or overwrite/rollback is not one transaction;
- the account UI invents login for an unverified provider, or logout can restore
  a cancelled/stale session or delete unrelated user data;
- the history ledger counts start/seek/buffer/preload, double-commits callbacks,
  resurrects after clear, or blocks initial playback;
- an item is labelled `degraded`, `not verified`, `blocked`, or `foundation
  present` in the evidence that is required to close it;
- the remaining proof is an installed API 35/live-provider/real-account,
  system-control, accessibility, performance, or release-like gate assigned to
  Phase 8. Those items may be explicitly pending, never silently implied.

When all deterministic Phase 6 evidence passes, report **Phase 6 implementation
complete** only for the mapped scope. Do not call the product `parity-ready` or
claim the integrated Android journey until Phase 8 closes its human/device/live
gates.
