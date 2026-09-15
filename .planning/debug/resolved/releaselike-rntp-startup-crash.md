# Debug Session: Release-like RNTP startup crash

## Status

 resolved-source-runtime-pending

## Trigger

The exact Phase 08 release-like candidate installs on API 35 but immediately crashes when launched after the integrated instrumentation run.

## Symptoms

- Expected: `com.dazzlingwuming.listen2/.MainActivity` reaches the React Native phone shell and remains foreground.
- Actual: `am start -W` starts the activity, which is immediately force-finished; focus returns to Launcher and the process dies before the JS runtime becomes ready.
- Error: logcat reports `TrackPlayerModule` TurboModule annotation parsing failure: `returnType == void iff method synchronous`.
- Candidate: versionCode 1000001, SHA-256 `56ad3418e5df6379d523724ed3cbf66c28e4d21e6ce9fc366f44e332382a4c4b`.
- Timeline: first observed on 2026-09-16 Asia/Shanghai when 08-02 relaunched the installed release-like app to obtain UI evidence.
- Reproduction: install the exact release-like candidate on API 35 and launch `com.dazzlingwuming.listen2/.MainActivity`; inspect logcat and foreground focus.

## Constraints

- Fix the source-controlled `react-native-track-player` 4.1.2 compatibility patch or application integration; do not suppress TurboModule validation or downgrade React Native.
- Classify the exact offending exported method(s) before editing; preserve RNTP as the sole audio-session owner.
- Run focused patch/application tests, release-like startup-relevant native checks, full local CI, and `lintReleaseLike`; do not claim resolution from compilation alone.
- Product APK rebuilding belongs to Phase 08-01 after the fix; this debug session must not produce or install an APK.
- Preserve unrelated user/agent changes and historical untracked evidence.

## Current Focus

- Hypothesis: confirmed. React Native 0.87 validates that an asynchronous `@ReactMethod` returns JVM `void`; RNTP 4.1.2 exposed 37 asynchronous Kotlin expression-body methods returning `kotlinx.coroutines.Job`.
- Test: complete. The exact candidate logcat and R8 mapping identified `MusicModule`; a reflection test classified all 39 exported methods and failed on the 37 `Job` methods before the patch.
- Expecting: source fix preserves the existing coroutines, Promise callbacks, JS API, and RNTP ownership of the Android audio session while changing only the JVM method return contract.
- Next action: Phase 08 rebuilds a fresh release-like candidate and repeats API 35 launch/instrumentation evidence. This session deliberately did not build or install an APK.

## Evidence Log

- timestamp: 2026-09-16 Asia/Shanghai — API 35 `am start -W` force-finished the exact installed candidate and returned focus to Launcher.
- timestamp: 2026-09-16 Asia/Shanghai — logcat identified `TrackPlayerModule` TurboModule annotation parsing failure before JS runtime readiness.
- timestamp: 2026-09-16 Asia/Shanghai — full logcat stack reached `TurboModuleInteropUtils.getMethodDescriptorsFromModule` and rejected the `TrackPlayerModule` annotation contract before JS became ready; the process terminated with an uncaught JniException/SIGABRT.
- timestamp: 2026-09-16 Asia/Shanghai — enumerated 39 `MusicModule` `@ReactMethod` exports. `setupPlayer` and `isServiceRunning` already returned void; 37 default-asynchronous methods returned `kotlinx.coroutines.Job` because their Kotlin expression bodies were `= scope.launch { ... }`. The candidate R8 mapping corroborated the 37 Job signatures.
- timestamp: 2026-09-16 Asia/Shanghai — added `TrackPlayerReactMethodContractTest`; it was RED before the fix with 37 `return=kotlinx.coroutines.Job, synchronous=false` violations and GREEN after the fix.
- timestamp: 2026-09-16 Asia/Shanghai — regenerated the source-controlled RNTP 4.1.2 patch so each affected export uses a block body and keeps `scope.launch { ... }` inside it. A fresh temporary `npm ci` applied patch-package successfully and contained zero remaining `fun … = scope.launch` exported methods.
- timestamp: 2026-09-16 Asia/Shanghai — native source verification passed: targeted reflection test; `:react-native-track-player:compileReleaseKotlin`; `:app:lintReleaseLike`; and repository local CI (`verify:phase7-security`, `mobile:test` 52 suites/263 tests, `mobile:typecheck`, mobile lint, `:app:testDebugUnitTest`, `git diff --check`).

## Resolution

- Root cause: React Native 0.87 TurboModule metadata parsing rejects the 37 asynchronous RNTP 4.1.2 `MusicModule` methods that Kotlin compiled as non-void `kotlinx.coroutines.Job` expression-body methods, causing startup to abort before the JavaScript runtime becomes ready.
- Fix: the RNTP patch converts exactly those 37 methods to `void`-returning block bodies while retaining their original `scope.launch` implementations; a JVM reflection regression test enforces React Native's void/async versus value/synchronous annotation contract.
- Verification: source fixed and native/static checks passed; runtime verification remains pending a Phase 08 rebuild and API 35 launch of a new candidate. No APK was built or installed by this debug session.
