# Debug Session: RN 0.87 Native Dependency Compatibility

## Status

resolved

## Trigger

After fixing RNGH and installing the declared Android toolchain, the no-APK JVM gate fails in safe-area-context 5.5.2 and react-native-track-player 4.1.2 before application Kotlin compilation.

## Symptoms

- Expected: the React Native 0.87.1 new-architecture graph compiles and runs `:app:testDebugUnitTest`.
- Actual: safe-area-context references removed `uiImplementation`; RNTP passes nullable `Bundle?` to a non-null `Arguments.fromBundle(Bundle)` API.
- Errors: unresolved `uiImplementation` in SafeAreaView and `Bundle?`/`Bundle` type mismatch in two MusicModule result paths.
- Timeline: exposed on 2026-09-14 after RNGH 2.33.0 allowed Gradle to advance.
- Reproduction: run the exact `:app:testDebugUnitTest` task with OpenJDK 17, Android SDK, NDK 27.1.12297006 and the current worktree.

## Environment

- React Native: 0.87.1, new architecture enabled
- safe-area-context: 5.8.0 (fixed in this session)
- react-native-track-player: 4.1.2
- RNGH: 2.33.0 (already causally verified)

## Constraints

- Use the smallest source-controlled compatibility fix; do not migrate to commercial/incompatible `@rntp/player` V5.
- Prefer exact safe-area-context 5.8.0 and a deterministic two-line RNTP 4.1.2 patch applied on every clean install.
- Preserve MV/product changes and unrelated planning files; no APK/emulator/provider access.
- Historical session constraint: do not commit or push until the full local gate passes.

## Current Focus

- Hypothesis: confirmed. Exact safe-area-context 5.8.0 removes the obsolete UIManager call, while a deterministic null-safe patch to frozen RNTP 4.1.2 resolves the two RN 0.87 signature mismatches without changing non-null behavior.
- Test: completed clean install, patch verification, both dependency Kotlin tasks, three Bilibili MV Jest suites, and the full named app JVM task.
- Expecting: complete native JVM validation with the repaired dependency graph and existing product contracts intact.
- Next action: no further action in this debug session; the no-APK JVM gate passes.

## Evidence Log

- Luna max audit found 5.8.0 as the first safe-area-context release removing `uiImplementation` and confirmed RNTP 4.1.2 is the last frozen V4 release.
- RNGH 2.33.0 direct compile already passes; do not modify it again.
- timestamp: 2026-09-14 Asia/Shanghai — Added exact `react-native-safe-area-context@5.8.0`, exact dev dependency `patch-package@8.0.1`, a `postinstall` hook, and `patches/react-native-track-player+4.1.2.patch`. The patch changes only the two nullable `Bundle?` values passed to `Arguments.fromBundle` in RNTP's `MusicModule.kt`.
- timestamp: 2026-09-14 Asia/Shanghai — `npm ci` removed and reinstalled dependencies, then printed `Applying patches... react-native-track-player@4.1.2 ✔`; installed versions are safe-area 5.8.0 and RNTP 4.1.2. The installed safe-area Android source has no `uiImplementation`/`dispatchViewUpdates` reference.
- timestamp: 2026-09-14 Asia/Shanghai — `JAVA_HOME=$JAVA_HOME ANDROID_SDK_ROOT=$ANDROID_SDK_ROOT ./gradlew --no-daemon :react-native-safe-area-context:compileDebugKotlin :react-native-track-player:compileDebugKotlin` passed.
- timestamp: 2026-09-14 Asia/Shanghai — `npx jest --runInBand src/bilibili/__tests__/mvClient.test.ts src/screens/__tests__/bilibiliMvFlow.test.tsx src/player/__tests__/playerController.bilibiliRetry.test.ts` passed: 3 suites, 12 tests.
- timestamp: 2026-09-14 Asia/Shanghai — full `:app:testDebugUnitTest` reached `:app:compileDebugKotlin`; both repaired dependency modules were successful, but application Kotlin failed independently. First blocking syntax error is `BilibiliModule.kt:199`; it causes cascading unresolved Bilibili helper/type errors. Separate DeepSeek and Offline Kotlin errors are also present and require their owners after the Bilibili syntax blocker is fixed.
- timestamp: 2026-09-14 Asia/Shanghai — Repaired the independent application Kotlin errors without broadening any bridge/provider contract: balanced `BilibiliModule`'s variants map; replaced self-referential Bilibili test abstractions with package-private interfaces; used the RN 0.87 `reactApplicationContext.currentActivity` API; retained an MV opaque handle during signed-URL refresh/quality changes; fixed the DeepSeek activity/configuration and Regex API references; and made `OfflineTask.cancel()` explicitly return Unit.
- timestamp: 2026-09-14 Asia/Shanghai — Corrected the Offline JVM test connection fixture to override `getContentLengthLong()`. Added exact test-only `org.json:json:20240303`, already present in the local Gradle cache, because Android's platform `org.json` is a no-op stub under local JVM tests. Production Android continues to use the platform API; the Gradle verification ran with `--offline`.
- timestamp: 2026-09-14 Asia/Shanghai — `JAVA_HOME=$JAVA_HOME ANDROID_SDK_ROOT=$ANDROID_SDK_ROOT ./gradlew --offline --no-daemon --console=plain --warning-mode none :app:testDebugUnitTest` passed. The Bilibili-only, DeepSeek/Offline-only, and final three Bilibili MV Jest suites also passed; Jest result: 3 suites, 12 tests.
- timestamp: 2026-09-14 19:27:32–19:27:49 CST — The final repository gate passed: 26 Jest suites / 145 tests, typecheck, quiet lint, changed-file Prettier, `git diff --check`, and offline Android `:app:testDebugUnitTest` (`BUILD SUCCESSFUL`, 151 tasks). Product closure was committed and pushed as `4f02a7c`.

## Resolution

- Root cause: React Native 0.87 removed safe-area-context 5.5.2's `uiImplementation` API, frozen RNTP 4.1.2 passed nullable `Bundle?` to a non-null bridge API, and the accumulated uncommitted native slices contained one Bilibili map syntax error plus obsolete Kotlin/React Native API references. Local JVM tests additionally executed Android's stub-only `org.json` rather than a real JSON implementation.
- Fix: Applied exact safe-area-context 5.8.0, a source-controlled RNTP 4.1.2 null-safe patch, the minimum Bilibili/DeepSeek/Offline Kotlin compatibility repairs, stable opaque MV refresh handles, and an exact test-only JSON runtime.
- Verification: clean install applied the RNTP patch; direct dependency Kotlin tasks, Bilibili/DeepSeek/Offline JVM test groups, the full offline `:app:testDebugUnitTest` task, and the full 26-suite/145-test JavaScript gate passed. No APK, emulator, or provider request was performed. Product closure was committed and pushed as `4f02a7c`.
