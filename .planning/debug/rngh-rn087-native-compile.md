# Debug Session: RNGH RN 0.87 Native Compile

## Status

resolved

## Trigger

Android new-architecture JVM test compilation fails in react-native-gesture-handler 2.30.0 before the app MV Kotlin sources can compile.

## Symptoms

- Expected: `:app:testDebugUnitTest` compiles the React Native 0.87.1 Android dependency graph and runs the three Bilibili MV Kotlin tests without assembling an APK.
- Actual: `:react-native-gesture-handler:compileDebugKotlin` fails on `getRootViewTag()` and unresolved `getZIndexMappedChildIndex`.
- Errors: `RNGestureHandlerModule.kt:173:53 Function invocation 'getRootViewTag()' expected` and `RNViewConfigurationHelper.kt:42:30 Unresolved reference 'getZIndexMappedChildIndex'`.
- Timeline: first exact native gate on 2026-09-14 after installing NDK 27.1.12297006 and Build Tools 36 for the existing React Native 0.87.1 project.
- Reproduction: run the exact Gradle `:app:testDebugUnitTest` command with OpenJDK 17 and the installed Android SDK; failure occurs before app Kotlin compilation.

## Environment

- Repository: `$PROJECT_ROOT`
- Branch: `agent/android-mobile-rebuild`
- React Native: `0.87.1`
- react-native-gesture-handler: `2.30.0`
- OpenJDK: `$JAVA_HOME`
- Android SDK: `$ANDROID_SDK_ROOT`
- NDK: `27.1.12297006`

## Constraints

- Find and fix the minimum compatible dependency/configuration change.
- Do not generate an APK, run an emulator, contact providers, or alter MV security/audio ownership.
- Historical session constraint: preserve the then-uncommitted MV gap-fix and unrelated planning files.
- Historical session constraint: do not commit or push until the repository local gate passes.

## Current Focus

- Hypothesis: confirmed — exact RNGH 2.33.0, the first upstream-declared React Native 0.87-compatible 2.x release, resolves both reported RNGH compilation errors; the later dependency-alignment session also closed the aggregate JVM gate.
- Test: completed the direct 2.30.0 rollback/reproduction and exact 2.33.0 reapply/reconfirmation under the same JDK 17/SDK Gradle task.
- Expecting: observed — 2.30.0 fails with both original errors and 2.33.0 succeeds. Separately incompatible native modules were resolved in the follow-up session.
- Next action: completed by the follow-up `rn087-native-deps` session; the aggregate native JVM gate now passes and the combined closure is committed in `4f02a7c`.

reasoning_checkpoint:
  hypothesis: "RNGH 2.30.0 causes the two compiler errors because its Android sources use `ReactRootView.rootViewTag` and `ReactViewGroup.getZIndexMappedChildIndex`, which RN 0.87.1 no longer accepts; 2.32.0 changes both locations and 2.33.0 is the first 2.x release explicitly supporting RN 0.87."
  confirming_evidence:
    - "The failing paths are exactly RNGH 2.30.0 lines 173 and 42, before application Kotlin compiles."
    - "Official registry tarball inspection proves 2.31.2 fixes only the root-tag expression, while 2.32.0 retains that fix and removes the drawing-order override; local RN 0.87.1 exposes only `getRootViewTag()` and lacks the z-index helper."
    - "Upstream 2.33.0 release evidence explicitly states React Native 0.87 support and its package is built against React Native 0.87.1."
  falsification_test: "If 2.33.0 still raises either reported RNGH compile error under the identical JDK 17/SDK Gradle task, this source-compatibility hypothesis is false."
  fix_rationale: "A direct, exact 2.33.0 lock update replaces the incompatible third-party Kotlin source with the earliest upstream-declared RN 0.87-compatible 2.x release; it changes no app code or build configuration."
  blind_spots: "The broader native graph may still contain separately incompatible direct modules; later unrelated task failures do not falsify the reported RNGH root cause, but prevent acceptance of the aggregate gate."
  candidate_causes:
    - "code: RNGH 2.30.0 source calls React Native APIs removed/changed by RN 0.87.1."
    - "environment/config: Kotlin/AGP/SDK mismatch could reject otherwise compatible RNGH source, but the project uses RN 0.87.1's Kotlin 2.2.0 and the 2.32.0 source removes both error expressions."
  and_gate: "no — either stale source call independently causes a compiler failure; both are resolved by the same upstream RN 0.87-compatible RNGH release, while the toolchain is aligned to RN 0.87.1."

## Evidence Log

- Full mobile JavaScript gate passes: 26 suites / 145 tests, TypeScript, full quiet lint, Prettier, and diff check.
- NDK 27.1.12297006 and Build Tools 36 are now installed; Gradle proceeds through new-architecture codegen before failing in RNGH Kotlin compilation.
- The active worktree has extensive uncommitted MV/product and planning changes; none are in the dependency manifest/lockfile scope of this investigation, so they will be preserved.
- The failure is a deterministic external-dependency Kotlin compilation error before app Kotlin compiles (Bohrbug). Common-pattern candidates: dependency/version compatibility mismatch (primary) and Android/Gradle toolchain mismatch (alternative); no application-data or runtime-concurrency path is involved.
- Phase 0: MemPalace is unavailable; the durable knowledge base has only an unrelated transient Bilibili HTTP 412 resolution, so it provides no candidate cause.
- The direct lock resolves RNGH 2.30.0, whose own development dependency is React Native 0.83.0; it declares wildcard React Native peers, so npm did not block the RN 0.87.1 incompatibility.
- Direct package-source comparison from the official npm registry shows RNGH 2.31.2 changes `it.rootView.rootViewTag` to `val rv = it.rootView; rv is ReactRootView && rv.getRootViewTag() == rootViewTag`, eliminating the first error, but retains `getZIndexMappedChildIndex` and therefore cannot resolve the second error.
- Official RNGH 2.32.0 source retains the corrected explicit `getRootViewTag()` call and removes `getChildInDrawingOrderAtIndex`; its release notes explicitly state Android removal of that method and React Native 0.86 support. This is the first 2.x release that removes both reported incompatible calls.
- Local RN 0.87.1 exposes `ReactRoot.getRootViewTag()` as an explicit method and no longer exposes `ReactViewGroup.getZIndexMappedChildIndex`; local mobile Kotlin 2.2.0 is the version supplied by RN 0.87.1's Gradle plugin, making an app-level toolchain override an unsupported alternative.
- SBFL skipped: this native dependency compile failure has no failing/passing per-test coverage spectrum; the exact Gradle reproduction is the deterministic localization signal.
- The existing verified mobile JVM invocation is `cd mobile/android && JAVA_HOME=$JAVA_HOME ANDROID_SDK_ROOT=$ANDROID_SDK_ROOT ./gradlew --no-daemon :app:testDebugUnitTest`; it does not assemble an APK.
- Counterfactual setup: `npm install --package-lock-only --save-exact react-native-gesture-handler@2.32.0` changed only the direct manifest pin and lock metadata required by the updated package (five additions and seven deletions, including its newly declared type dependency and dev/prod flags). No application Kotlin, Gradle configuration, or unrelated worktree file changed. The initial install inherited a user-level mirror URL; the final lock will restore the repository convention of the official npm registry while retaining the verified 2.32.0 integrity pin.
- `npm ci` successfully materialized the exact locked graph (907 packages). Installed RNGH is 2.32.0 and its Kotlin source has the explicit `getRootViewTag()` call and no drawing-order override, matching the expected counterfactual source change.
- Historical pre-alignment gate result: `JAVA_HOME=$JAVA_HOME ANDROID_SDK_ROOT=$ANDROID_SDK_ROOT ./gradlew --no-daemon :app:testDebugUnitTest` ran 82 actionable tasks and reached `:react-native-gesture-handler:compileDebugKotlin` without either original error or a task failure. The full command exited 1 only because two other dependency tasks failed: `react-native-safe-area-context` references missing `uiImplementation`, and `react-native-track-player` passes nullable `Bundle?` where RN 0.87 requires `Bundle`.
- Isolated verification: the same JDK-17/SDK invocation of `:react-native-gesture-handler:compileDebugKotlin` exited 0 (`BUILD SUCCESSFUL`); the first full gate had already compiled the changed RNGH source, so this cached isolated run confirms the repaired task identity without an APK build.
- Scope boundary: the remaining direct packages are `react-native-safe-area-context` 5.5.2 (its own dev RN range is `^0.74.2`) and `react-native-track-player` 4.1.2 (its own dev RN is 0.68.5). Both use permissive peer ranges, so npm did not signal their RN 0.87 incompatibility. Updating either entails separate compatibility research, potentially API/config migration, and revised regression verification; this is broader than the authorized RNGH-only manifest/lock change.
- Follow-up official compatibility evidence: the RNGH 2.33.0 release explicitly supports React Native 0.87 and is built with RN 0.87.1. Therefore 2.32.0 remains strong source-level evidence but is superseded as the selected resolution by 2.33.0, the first formally compatible 2.x release.
- Final dependency setup: `npm_config_registry=https://registry.npmjs.org npm install --package-lock-only --save-exact react-native-gesture-handler@2.33.0 && npm_config_registry=https://registry.npmjs.org npm ci` selected and installed exact RNGH 2.33.0 with its official registry URL and integrity pin. Installed package metadata declares development React Native 0.87.1; its two Android source locations retain the explicit `getRootViewTag()` call and omit the obsolete z-index drawing-order override.
- Historical pre-alignment final gate result: with unchanged JDK 17, SDK root, Gradle, RN 0.87.1, and application sources, `:app:testDebugUnitTest` again reached and compiled `:react-native-gesture-handler:compileDebugKotlin` with no original errors. The command exited 1 solely in the unchanged external `react-native-safe-area-context` (`uiImplementation`) and `react-native-track-player` (`Bundle?` vs `Bundle`) Kotlin tasks.
- Final target test: `:react-native-gesture-handler:compileDebugKotlin` exits 0 on the final 2.33.0 lock (19 actionable tasks; no APK created). The target source compiled in the preceding full-gate run, so this exit status is not a stale 2.30.0 artifact.
- Revert signal: after restoring only the package manifest/lock hunk to RNGH 2.30.0 and running `npm ci`, the same isolated task deterministically failed with both original errors at `RNGestureHandlerModule.kt:173:53` and `RNViewConfigurationHelper.kt:42:30`. This confirms the reported failure returns without the dependency fix.
- Reapply signal: after restoring only the exact 2.33.0 manifest/lock hunk using the official npm registry and `npm ci`, the same isolated `:react-native-gesture-handler:compileDebugKotlin` task exited 0 after a clean recompile (19 actionable tasks). Installed package metadata is again RNGH 2.33.0 with development RN 0.87.1.

## Eliminated

- Hypothesis: the reported errors are caused solely by the installed JDK/SDK/AGP/Kotlin toolchain rather than the RNGH package source.
  Evidence: with the identical JDK 17, SDK root, Gradle, RN 0.87.1, and application sources, only the locked RNGH version changed and `:react-native-gesture-handler:compileDebugKotlin` completed successfully.
  Timestamp: 2026-09-14T18:21:28+08:00

## Resolution

- Root cause: Confirmed for the reported RNGH failure: direct `react-native-gesture-handler` 2.30.0 contained two stale Android calls incompatible with React Native 0.87.1/Kotlin 2.2.0. The package peer range was wildcard, so the incompatible combination installed without an npm peer-resolution error.
- Fix: Updated the direct `react-native-gesture-handler` dependency from exact 2.30.0 to exact 2.33.0 in `mobile/package.json` and regenerated the corresponding official-registry entry in `mobile/package-lock.json`. This is the earliest upstream-declared React Native 0.87-compatible 2.x release. No vendored node_modules patch, app Kotlin, Gradle configuration, or unrelated file changed.
- Verification:
  ```yaml
  target_test: { result: pass, evidence: "The 2.33.0 isolated :react-native-gesture-handler:compileDebugKotlin task exits 0 after a clean recompile; the exact aggregate gate also compiles this task without either original error." }
  mutation_check: { result: skipped, reason_if_skipped: "This is a third-party dependency-version resolution; no Stryker configuration or agent-authored source-level regression test applies." }
  no_op_deletion: { result: pass, deletion_justified_by_rca: false, evidence: "Scoped diff only replaces a direct dependency pin and required lock metadata; no application behavior, assertion, or branch was removed." }
  adjacent_tests: { result: fail, suites_run: [":app:testDebugUnitTest"], evidence: "Historical pre-alignment result: the full no-APK JVM gate was blocked in separately stale react-native-safe-area-context and react-native-track-player Kotlin sources, not RNGH." }
  revert_and_reconfirm: { result: pass, bug_returned_on_revert: true, fixed_on_reapply: true, evidence: "2.30.0 restored both reported errors; reapplying 2.33.0 restored target compilation." }
  guardrail_verdict: rejected
  rejected_signal: adjacent_tests
  ```
  The reported RNGH root cause is fixed and causally verified, but the aggregate native gate is not accepted or represented as passing because independently incompatible modules require broader approved dependency churn.
- Files changed: `mobile/package.json`, `mobile/package-lock.json`, `.planning/debug/rngh-rn087-native-compile.md`.

## Follow-up Closure

The later `rn087-native-deps` session aligned safe-area-context, applied the minimal source-controlled RNTP compatibility patch, fixed the application Kotlin blockers, and passed the full offline `:app:testDebugUnitTest` gate. The rejected guardrail verdict above is retained as historical evidence for this isolated RNGH diagnosis, not as the current project status.
