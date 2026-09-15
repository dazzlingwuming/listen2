# Debug Session: Release-like Android lint errors

## Status

awaiting_human_verify

## Trigger

Phase 08's first complete `lintReleaseLike` run reached application source analysis and failed with 41 errors and 30 warnings before any APK was produced.

## Symptoms

- Expected: the minified release-like Android variant passes lint for minSdk 24 and proceeds to the single candidate APK build.
- Actual: `:app:lintReleaseLike` fails with 41 errors and 30 warnings.
- First confirmed error: `mobile/android/app/src/main/java/com/listen2mobile/deepseek/DeepSeekVault.kt:327` calls `java.util.Base64.getEncoder()`, an API requiring Android 26 while the app declares minSdk 24.
- Error report: `/tmp/listen2-phase8-candidate.eah5Vl/mobile/android/app/build/reports/lint-results-releaseLike.xml` and `.txt`.
- Timeline: first exposed after the complete release-like dependency graph was cached on 2026-09-16 Asia/Shanghai.
- Reproduction: in the clean Phase 08 worktree, run `:app:lintReleaseLike` with the declared Java/Android toolchain.

## Constraints

- Classify all 41 errors before editing; fix real product/minSdk/security issues rather than hiding them in a lint baseline.
- Do not change minSdk merely to silence lint and do not weaken Phase 08 security checks.
- Preserve the single-candidate policy: no APK is built during diagnosis/fix; return to 08-01 only after release-like lint is clean.
- Preserve unrelated user/agent changes and the declared historical untracked files.

## Current Focus

reasoning_checkpoint:
  hypothesis: "The 41 lint errors occur because product source selected APIs newer than the intentional API-24 floor (or used Media3 APIs without their required local opt-in); replacing those calls with API-24 equivalents, or annotating the precise API-26/unstable boundary, removes the static errors without changing product policy."
  confirming_evidence:
    - "The complete XML/TXT reports identify 27 NewApi errors at concrete API-26/API-33 calls and 14 UnsafeOptInUsageError occurrences in one Media3 view."
    - "The full source read confirms each exact call and confirms every reported file matches the worktree used by lint."
    - "Existing product code already uses android.util.Base64 safely elsewhere, and MediaStreamProvider already blocks remote proxying below API 26 at runtime."
  falsification_test: "If the source-level substitutions/annotations either alter existing vault, date, token, or bounded-read contracts in focused tests, or lint still reports the same API call after the corresponding minimal change, this root-cause explanation is false or incomplete."
  fix_rationale: "Android Base64, Calendar/TimeZone, an explicit bounded read helper, a local RequiresApi boundary, and a pre-O notification constructor preserve the existing product contracts on all supported devices; the Media3 annotation records a deliberately accepted unstable dependency only on its direct caller."
  blind_spots: "The local JVM checks cannot execute an API-24 or API-25 device; final device/emulator validation remains Phase 08 work, and configuration warnings are intentionally out of this source-only scope."
  candidate_causes:
    - "code: API-26/API-33 Java and Android APIs plus an unacknowledged Media3 unstable API were introduced in product source."
    - "config: minSdk 24 and absent core-library desugaring could expose the issue, but minSdk 24 is an intentional supported-product constraint and configuration is out of scope."
    - "environment: lint runs against the release-like minSdk model rather than the newer local JDK, making previously unobserved source incompatibility deterministic."
    - "data: no input record participates; lint flags static call sites before product data exists."
  and_gate: "no — each of the eight groups independently creates a lint error; the task needs all groups fixed, but no individual failure requires multiple simultaneous conditions."
next_action: "Manager to run the repository-wide CI/release workflow and obtain the Phase 08 device-level human verification; do not commit or push this source-only lint repair from the debug session."

## Evidence Log

- timestamp: 2026-09-16 Asia/Shanghai — The full JavaScript/TypeScript/security gate passed (52 suites / 263 tests, typecheck, lint) before Android lint began.
- timestamp: 2026-09-16 Asia/Shanghai — `:app:lintReleaseLike` completed dependency resolution and reported 41 errors / 30 warnings; no APK task ran.
- timestamp: 2026-09-16 Asia/Shanghai — Read the complete XML (71 issues: 41 errors, 30 warnings) and TXT report (41 errors, 28 location warnings; two XML-only aggregate warning entries). All 41 errors appear in eight groups: NewApi in DeepSeekVault (5), HistoryModule (2), ListeningLedger (11), LocalAudioModule (3), LocalMediaPolicy (3), MediaStreamProvider (2), OfflineCore (1), plus UnsafeOptInUsageError in BilibiliMvView (14).
  implication: the failure is deterministic and source-local; SBFL is skipped because lint exposes no passing/failing per-test coverage spectrum for these locations.
- timestamp: 2026-09-16 Asia/Shanghai — MemPalace is unavailable; keyword fallback read the complete debug knowledge base and found no match (the only prior entry concerns transient Bilibili HTTP 412 retry behavior).
  implication: no known-pattern candidate applies.
- timestamp: 2026-09-16 Asia/Shanghai — Read all eight implicated Kotlin files in full and verified they exactly match the files used to generate the lint report. Complete 41-error classification follows:
  - NewApi, DeepSeekVault.kt:327/337 (5): production vault serializes its AES-GCM envelope with `java.util.Base64`, whose encoder/decoder APIs require API 26. Root cause: API-26 Java Base64 selected instead of Android API-24-compatible codec; fix direction: `android.util.Base64` with explicit no-padding/no-wrap flags.
  - NewApi, HistoryModule.kt:42 (2): invalid recap year defaults through `java.time.Year.now().value`. Root cause: API-26 java.time use in the RN bridge; fix direction: API-24-compatible `Calendar` current year.
  - NewApi, ListeningLedger.kt:30/57-64 (11): injected `ZoneId` and `Instant.atZone(...).toLocalDate()` derive the committed calendar date. Root cause: API-26 java.time chronology in persistence path; fix direction: inject/use `TimeZone` plus `Calendar` and format the stable ISO date explicitly.
  - NewApi, LocalAudioModule.kt:201/214/231 (3): SAF header/LRC reads call `InputStream.readNBytes`, introduced for Android API 33. Root cause: API-33 Java stream helper in otherwise bounded local-import flow; fix direction: source-owned bounded `InputStream` read helper that preserves the existing byte limit.
  - NewApi, LocalMediaPolicy.kt:37 (3): opaque local-playback token uses `java.util.Base64` URL encoder. Root cause: API-26 Java Base64 instead of Android API-24-compatible URL-safe codec; fix direction: `android.util.Base64.URL_SAFE | NO_PADDING | NO_WRAP`.
  - NewApi, MediaStreamProvider.kt:43 (2): nested remote lease proxy directly subclasses `ProxyFileDescriptorCallback`, an API-26 class, despite the runtime O guard in `openFile`. Root cause: the API-level restriction is not declared at the nested class boundary; fix direction: narrowly annotate that class with `@RequiresApi(O)`.
  - NewApi, OfflineCore.kt:522 (1): API-26 `Notification.Builder(context, channelId)` is constructed on API 24/25 after channel creation is guarded. Root cause: construction itself remains unguarded; fix direction: choose the channel constructor on O+ and legacy constructor below O.
  - UnsafeOptInUsageError, BilibiliMvView.kt:120-134 (14): the view intentionally uses Media3 `UnstableApi` track-selection/media-source APIs without declaring the opt-in. Root cause: missing local caller acknowledgement, not a behavior defect; fix direction: annotate the narrow Bilibili MV view class with `@OptIn(UnstableApi::class)`.
  - Build configuration handoff: no error-level lint finding is configuration-owned. The report has non-blocking configuration warnings only: `KaptUsageInsteadOfKsp` at `mobile/android/app/build.gradle:170` and generated/React Native `UnusedResources`; these remain unmodified by scope.
  implication: all error groups are independently source-fixable, and none requires a baseline, global lint disable, minSdk increase, desugaring/config change, or security-policy relaxation.
- timestamp: 2026-09-16 Asia/Shanghai — Applied source-only fixes: Android Base64 for vault/token encodings; Calendar/TimeZone date derivation; bounded local input reader; a nested API-26 proxy callback annotation; pre-O notification builder branch; and narrow Media3 UnstableApi opt-in. Added focused specified-oracle regression tests for compact vault envelope round-trip, local-date timezone boundaries, bounded SAF reads, and URL-safe opaque token flags.
  implication: each error group has a direct source-level counterfactual to test; no build configuration, security policy, acceptance script, ProGuard rule, or APK task was changed.
- timestamp: 2026-09-16 Asia/Shanghai — Focused JVM test command was retried with discovered OpenJDK 17 but stopped during Gradle configuration because `ANDROID_HOME`/`sdk.dir` is unset (`SDK location not found`). No Kotlin test task ran and no APK task was requested.
  implication: this is a local toolchain environment prerequisite, not a source-test failure; locate the existing SDK and rerun unchanged tests.
- timestamp: 2026-09-16 Asia/Shanghai — Android SDK was located at `/opt/homebrew/share/android-commandlinetools`, with required platform/build-tool material. Verification will set `JAVA_HOME=/opt/homebrew/opt/openjdk@17` and `ANDROID_HOME`/`ANDROID_SDK_ROOT` only for Gradle child processes; `local.properties` remains untouched.
  implication: focused tests and lint can now run without a configuration edit.
- timestamp: 2026-09-16 Asia/Shanghai — Focused Debug JVM contracts passed with the process-scoped JDK/SDK: DeepSeekContractTest, ListeningLedgerTest, LocalAudioPolicyTest, LocalMediaPolicyTest, MediaDescriptorContractTest, FiveSourceMediaDescriptorContractTest, OfflineAudioContractTest, OfflineRecoveryContractTest, BilibiliMvControllerTest, BilibiliMvLifecycleTest, and BilibiliMvPolicyTest. No APK task ran.
  implication: API-24 substitutions preserve the covered vault, calendar, bounded-read, opaque-token, media policy, offline, and MV contracts.
- timestamp: 2026-09-16 Asia/Shanghai — Kotlin compilation warns that `@OptIn(UnstableApi::class)` has no effect because this Java/AndroidX marker is not Kotlin `@RequiresOptIn`.
  implication: replace that acknowledgement with the marker annotation itself before lint; this is a direct source-level contract correction, not a global suppression.
- timestamp: 2026-09-16 Asia/Shanghai — Replaced the ineffective Kotlin opt-in with the direct `@UnstableApi` marker and reran the focused Bilibili MV controller/lifecycle/policy tests successfully. The prior ineffective-opt-in compiler warning is absent; no APK task ran.
  implication: the Media3 acknowledgement is now localized, explicit, and ready for lint validation.
- timestamp: 2026-09-16 Asia/Shanghai — Fresh complete release-like XML/TXT after the source fixes contains 15 errors and 30 warnings (45 issue entries total), down from 41 errors. All 15 are `UnsafeOptInUsageError` in `BilibiliMvViewManager.kt`; no new issue id/category appears. The direct class-level `@UnstableApi` marker on `BilibiliMvView` makes the view's type and public methods unstable, so lint correctly requires every manager use to acknowledge that propagated contract.
  implication: the API-level substitutions resolved all 27 `NewApi` errors, while the direct marker is too broad for this internal view boundary; test the lint-recommended non-propagating local `@OptIn(UnstableApi::class)` acknowledgement before considering any wider scope.
- timestamp: 2026-09-16 Asia/Shanghai — With the local `@OptIn(UnstableApi::class)` acknowledgement, the focused Bilibili MV controller/lifecycle/policy JVM tests pass. Kotlin continues to warn that Media3's Java marker does not carry Kotlin `@RequiresOptIn`, but compilation and test execution succeed.
  implication: this warning is an annotation-model mismatch, not a product test failure; the decisive next observation is Android lint's explicit `UnsafeOptInUsageError` result.
- timestamp: 2026-09-16 Asia/Shanghai — The fresh `:app:lintReleaseLike` run completed with 14 errors and 30 warnings. The local `@OptIn` reduced the prior 15 transitive manager findings by one, so lint accepts it for the view declaration but still observes propagated unstable calls through public view methods. No APK assembly/package task appeared.
  implication: parse the exact remaining method-level sites rather than broadening the class-level marker or changing lint configuration.
- timestamp: 2026-09-16 Asia/Shanghai — Complete fresh XML identifies every remaining error as `UnsafeOptInUsageError` at BilibiliMvView.kt:122-125 and :133-136: Media3 track-selector, ExoPlayer builder/player, data-source/media-source, and player preparation calls. No manager or configuration location remains after the local `@OptIn` declaration.
  implication: the direct Media3 call sites require a supported local acknowledgement; the Kotlin compiler independently confirms its `@OptIn` does not acknowledge this Java lint marker, while the class-level marker is rejected as too broadly propagating.
- timestamp: 2026-09-16 Asia/Shanghai — Inspected the cached Media3 1.9.4 annotation bytecode: `UnstableApi` carries `androidx.annotation.RequiresOptIn(Level.ERROR)`, not Kotlin `@RequiresOptIn`. The already-resolved `annotation-experimental` artifact provides the corresponding `androidx.annotation.OptIn(markerClass = ...)` annotation; it is a local acknowledgement and has no lint-disable semantics.
  implication: importing `androidx.annotation.OptIn` is the supported narrow source fix; the prior unqualified Kotlin annotation is eliminated as a wrong-annotation hypothesis.
- timestamp: 2026-09-16 Asia/Shanghai — Imported `androidx.annotation.OptIn` at the Bilibili MV view and reran the focused Bilibili MV controller/lifecycle/policy JVM tests successfully. The prior Kotlin `@OptIn has no effect` warning is absent; no APK task ran.
  implication: the source now uses the Media3 marker's matching AndroidX acknowledgement and is ready for the final release-like lint verification.
- timestamp: 2026-09-16 Asia/Shanghai — Final release-like lint process completed; its generated TXT report records `0 errors, 30 warnings`, and no Gradle lint process remains. The task output contains no `assembleReleaseLike`, `packageReleaseLike`, or APK-producing task.
  implication: all 41 original lint errors are absent under the release-like minSdk model; perform report/diff audit before handoff while retaining the warning-only configuration/resource findings for their owners.
- timestamp: 2026-09-16 Asia/Shanghai — Complete final XML contains 30 warning entries and zero error entries. Warning-only handoff remains outside this source-error repair: configuration/dependency checks (`AndroidGradlePluginVersion`, `GradleDependency`, `NewerVersionAvailable`, `KaptUsageInsteadOfKsp`) and generated React Native resources (`UnusedResources`); no error-level finding is build-configuration-owned.
  implication: source lint repair is complete without modifying Gradle, ProGuard, Phase 08 acceptance artifacts, or the minSdk/security policy.
- timestamp: 2026-09-16 Asia/Shanghai — Product/test diff audit covers exactly 13 Android source/test files, has 133 additions and 18 deletions, and `git diff --check` returns clean. The worktree retains pre-existing unrelated planning modifications/untracked artifacts; the owned diff contains no build.gradle, ProGuard, STATE/ROADMAP, or Phase 08 acceptance-script change.
  implication: the repair is additive/targeted rather than a baseline, global lint disable, or deletion-only workaround; manager owns repository-wide CI and the single atomic commit/push.

## Resolution

- Root cause: Product source used API-26/API-33 Java or Android calls while the release-like variant intentionally supports minSdk 24. Its Bilibili MV surface also used Media3 APIs marked with AndroidX `RequiresOptIn` without the matching local AndroidX acknowledgement. The original complete report had 27 `NewApi` and 14 `UnsafeOptInUsageError` findings; no error-level configuration cause exists.
- Fix: Kept the API-24 support/security boundary while replacing Java Base64/date/read helpers with Android/API-24-safe equivalents, preserving opaque-token entropy as URL-safe hex, declaring the existing O-only proxy callback boundary, choosing the pre-O notification constructor when required, and annotating only the Media3 MV view with `androidx.annotation.OptIn(UnstableApi::class)`. Added specified-oracle regression coverage for vault round-trip/no-padding, timezone calendar boundaries, bounded reads, and opaque token format.
- Verification:
  - PASS — `JAVA_HOME=/opt/homebrew/opt/openjdk@17 ANDROID_HOME=/opt/homebrew/share/android-commandlinetools ANDROID_SDK_ROOT=/opt/homebrew/share/android-commandlinetools PATH=/opt/homebrew/opt/openjdk@17/bin:$PATH ./gradlew --no-daemon :app:testDebugUnitTest --tests com.listen2mobile.deepseek.DeepSeekContractTest --tests com.listen2mobile.history.ListeningLedgerTest --tests com.listen2mobile.local.LocalAudioPolicyTest --tests com.listen2mobile.local.LocalMediaPolicyTest --tests com.listen2mobile.media.MediaDescriptorContractTest --tests com.listen2mobile.media.FiveSourceMediaDescriptorContractTest --tests com.listen2mobile.offline.OfflineAudioContractTest --tests com.listen2mobile.offline.OfflineRecoveryContractTest --tests com.listen2mobile.bilibili.BilibiliMvControllerTest --tests com.listen2mobile.bilibili.BilibiliMvLifecycleTest --tests com.listen2mobile.bilibili.BilibiliMvPolicyTest` (11 focused suites).
  - PASS — final Bilibili-only rerun with the same process-scoped JDK/SDK and the three `BilibiliMv*` test classes; the wrong Kotlin-OptIn warning is absent with AndroidX OptIn.
  - PASS — `JAVA_HOME=/opt/homebrew/opt/openjdk@17 ANDROID_HOME=/opt/homebrew/share/android-commandlinetools ANDROID_SDK_ROOT=/opt/homebrew/share/android-commandlinetools PATH=/opt/homebrew/opt/openjdk@17/bin:$PATH ./gradlew --no-daemon :app:lintReleaseLike`; final XML/TXT reports `0 errors, 30 warnings`.
  - PASS — `git diff --check` for all 13 owned source/test files.
  - Source-reproduction evidence — the complete original XML/TXT was generated from a source-identical candidate worktree before edits and recorded all 41 errors; a destructive in-place revert was intentionally not run because unrelated user planning changes must be preserved.
  - Scope limit — JVM tests and static release-like lint do not substitute for Phase 08 device/emulator acceptance; no APK task was requested or run.
- files_changed:
  - mobile/android/app/src/main/java/com/listen2mobile/bilibili/BilibiliMvView.kt
  - mobile/android/app/src/main/java/com/listen2mobile/deepseek/DeepSeekVault.kt
  - mobile/android/app/src/main/java/com/listen2mobile/history/HistoryModule.kt
  - mobile/android/app/src/main/java/com/listen2mobile/history/ListeningLedger.kt
  - mobile/android/app/src/main/java/com/listen2mobile/local/LocalAudioModule.kt
  - mobile/android/app/src/main/java/com/listen2mobile/local/LocalAudioPolicy.kt
  - mobile/android/app/src/main/java/com/listen2mobile/local/LocalMediaPolicy.kt
  - mobile/android/app/src/main/java/com/listen2mobile/media/MediaStreamProvider.kt
  - mobile/android/app/src/main/java/com/listen2mobile/offline/OfflineCore.kt
  - mobile/android/app/src/test/java/com/listen2mobile/deepseek/DeepSeekContractTest.kt
  - mobile/android/app/src/test/java/com/listen2mobile/history/ListeningLedgerTest.kt
  - mobile/android/app/src/test/java/com/listen2mobile/local/LocalAudioPolicyTest.kt
  - mobile/android/app/src/test/java/com/listen2mobile/local/LocalMediaPolicyTest.kt
- guardrail_verdict: accepted for the source/static lint scope; Phase 08 retains device/emulator acceptance and manager-owned repository CI/commit as separate gates.
