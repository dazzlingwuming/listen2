# Debug Session: Android Library Restore Failure

## Status

resolved

## Trigger

The user reports that the delivered Android APK still shows “音乐库恢复失败，搜索和播放仍可使用。” after installation; allowing entry into the app is not an acceptable fix.

## Symptoms

- Expected: a data-preserving upgrade from the previously delivered Android APK restores the user's library without any recovery-failure banner and retains valid favorites, playlists, queue, local-audio references, and lyric metadata.
- Actual: startup remains usable but displays “音乐库恢复失败，搜索和播放仍可使用。”
- Error message: exact visible text supplied by the user above; sanitized internal native status is not yet reproduced.
- Timeline: persists in the APK delivered from commit `1796bf2` on 2026-09-16 after earlier best-effort migration changes.
- Reproduction: install an earlier APK, seed or retain representative legacy library data, then install the current release-like APK with `adb install -r` and cold launch without clearing app data.

## Constraints

- A clean-install launch is insufficient; validation must exercise a data-preserving upgrade path.
- Do not discard, reset, overwrite, or silently replace conflicting user library data.
- Corrupt rows may be isolated, but valid rows must survive and the remaining state must be usable and accurately reported.
- Preserve unrelated `.planning` changes and evidence.
- Do not commit, push, merge, or publish an APK; the root agent owns final CI and delivery.

## Current Focus

- Root cause confirmed: `LibraryBridge.snapshot` passed React Native `WritableMap` values into `Arguments.fromList`, which rejects that type when any library collection is non-empty.
- Fix verified: mapped snapshot collections are emitted through `WritableArray.pushMap`; divergent same-identity residual metadata is rejected before it can overwrite the existing row.
- Completion evidence: the prior signed release-like APK → exact legacy AsyncStorage seed → candidate `adb install -r` → force-stop/cold-launch sequence passed on `emulator-5554`; the UI showed the migrated playlist/local reference and no recovery banner.
- Next action: no further code or Gradle work in this debug session; root agent may include the focused evidence in final release validation.

## Evidence Log

- User confirms the banner still appears in the delivered APK.
- Prior emulator validation only proved a clean/current install could start without the banner; it did not prove the user's upgrade state.
- Existing implementation already has partial idempotency/staging recovery tests, so the remaining cause must be independently reproduced rather than assumed fixed.
- The old acceptance seed was not a legacy-data fixture. It now writes the exact former Redux Persist values into the prior APK's `AsyncStorage` SQLite `Storage(key, value)` table, verifies those values, and carries them through an `adb install -r` upgrade.
- Reproduction on API 35 (`emulator-5554`): prior signed release-like APK installed, valid legacy seed written, current candidate installed with `adb install -r`, process force-stopped, then cold-launched. The Room assertions passed for playlist, membership, favorite, queue, lyric metadata, safely downgraded local reference, validated migration journal, and retained legacy source; UI then failed with `音乐库恢复失败（INVALID_RESPONSE），搜索和播放仍可使用。` and no migrated playlist.
- Root cause evidence: React Native's `Arguments.fromList` supports arrays, bundles, scalar types, and booleans, but not `WritableMap`; `LibraryBridge.snapshot` passed mapped `WritableMap` collection elements to it. A non-empty migrated snapshot therefore throws in the native bridge executor and becomes the `NATIVE_FAILURE` response that JS classifies as `INVALID_RESPONSE`. Empty clean-install snapshots do not exercise this path.
- Fix staged: snapshot arrays now use an explicit `WritableArray.pushMap` helper for all map-valued collections. The remaining `Arguments.fromList` use is only for scalar capability strings.
- Guardrail staged: same-identity favorites, remote collections, and lyric metadata with divergent content now reject the migration instead of being silently replaced; an in-memory Room regression test preserves the existing rows.
- Isolated non-incremental build passed: `:app:assembleReleaseLike :app:assembleReleaseLikeAndroidTest` (Java 17, offline/no-daemon, Kotlin incremental disabled/in-process). A follow-up release-like AndroidTest rebuild after the split collision fixture also passed. The candidate product APK SHA-256 is `a0597459fe8755e05a9206fff8befbccb50253b4e2601c2cd84f4e605b666aa8`.
- Focused JS regressions passed: `npm test -- --runInBand src/library/__tests__/libraryMigration.test.ts src/library/__tests__/LibraryBootGate.test.tsx` (2 suites, 11 tests). Acceptance-script self-test also passed: `bash mobile/scripts/acceptance/run-api35-journey.sh --self-test`.
- Final data-preserving upgrade acceptance passed on API 35 (`emulator-5554`): cleared the package once, installed the prior signed release-like APK, installed the current release-like AndroidTest APK, ran `UpgradeSeedTest` to put exact legacy Redux Persist JSON into the old `AsyncStorage` SQLite database, installed the candidate with `adb -s emulator-5554 install -r`, force-stopped, and ran `LegacyLibraryUpgradeTest`. Both instrumentation scenarios ended `completed` / `INSTRUMENTATION_CODE: -1`; the test asserted the retained raw source record, Room playlist/membership/favorite/queue/lyric/local-reference/journal state, migrated UI labels, track visibility, and absence of the failure banner.
- Collision guardrail acceptance passed on API 35 (`emulator-5554`): a pre-existing Room favorite with the same identity but different title was created before the exact legacy seed and cold launch. `LibraryConflictGuardrailSeedTest` and `LibraryConflictGuardrailTest` each ended `completed` / `INSTRUMENTATION_CODE: -1`; after recovery failure, the existing favorite remained `手机收藏` and the legacy source record was retained. The corrupt/conflicting input was not silently overwritten.
- `git diff --check` passed for the focused changes. No commits, pushes, merges, or publication were performed by this session.

## Resolution

- Root cause: non-empty library snapshots crashed because `Arguments.fromList` cannot serialize `WritableMap` entries; native bridge failure was mapped by JavaScript to `INVALID_RESPONSE` and the restore-failure banner.
- Fix: serialize all mapped snapshot collections with `WritableArray.pushMap`; preserve existing residual favorite/remote/lyric rows and reject divergent legacy rows rather than overwriting them; add true prior-APK/AsyncStorage upgrade and collision fixtures.
- Verification: release-like product and AndroidTest builds, focused JS and acceptance-script tests, a real prior-signed-APK `adb install -r` cold-launch upgrade proving valid data retained with no banner, and a separate on-device conflicting-data scenario proving no silent overwrite.
