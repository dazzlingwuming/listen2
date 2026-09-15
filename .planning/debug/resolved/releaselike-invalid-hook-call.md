# Debug Session: Release-like invalid hook call startup crash

## Status

awaiting_human_verify

## Trigger

The RNTP-fixed Phase 08 release-like candidate still crashes during the required API 35 pre-instrumentation launch smoke, now in React Native JavaScript with `Invalid hook call`.

## Symptoms

- Expected: the exact release-like candidate reaches and retains the phone shell foreground before instrumentation.
- Actual: ReactNativeJS logs `Invalid hook call`, followed by `JavascriptException`, fatal native exception and `Force finishing MainActivity`; focus returns to Launcher.
- Candidate: 67,106,878 bytes, SHA-256 `ca69cfa161ca8622641f047e6e6fffc08f1db6b5b3f129c5181266926d1cfe24`, versionCode 1000001.
- Evidence: Phase 08-02 captured full logcat, failure UI dump/screenshot and package/version/path facts on API 35 emulator-5554.
- Timeline: first observed on 2026-09-16 Asia/Shanghai after RNTP TurboModule compatibility was fixed and a new candidate was launched.
- Reproduction: install the exact candidate on API 35 and launch MainActivity; launch smoke fails before the integrated journey.

## Constraints

- Obtain the complete JavaScript stack and map it to source before editing; distinguish an actual Rules-of-Hooks violation from duplicate React instances or incompatible renderer versions.
- Fix product source/dependency integration at the smallest correct boundary; do not suppress the runtime error, disable Hermes/new architecture, or loosen launch smoke.
- Add a no-APK regression gate that catches this startup composition failure where feasible; run focused tests, release bundle validation, lintReleaseLike, and full local CI.
- APK building/installing belongs to Phase 08 after source fix; this debug session must not generate or install APKs.
- Preserve unrelated user/agent changes, Phase 08 evidence, and historical untracked files.

## Current Focus

- bug_class: bohrbug (the release-like launch deterministically takes the same callback path)
- reasoning_checkpoint:
  hypothesis: "`tabBar={MobileTabBar}` causes the startup crash because bottom-tabs invokes `tabBar(props)` as a Context.Consumer callback, so MobileTabBar's useSafeAreaInsets hook runs outside React component rendering."
  confirming_evidence:
    - "The exact candidate stack source-maps MobileTabBar@1:582548 to RootNavigator.tsx:63:34 and useSafeAreaInsets@1:658017 to SafeAreaContext.tsx:150:33."
    - "bottom-tabs 7.18.18 executes tabBar({...}) directly; the focused Consumer-boundary Jest reproduction fails RED with the same invalid-hook call and the RootNavigator.tsx:63 frame."
    - "npm/Metro resolution proves a single compatible React 19.2.3 and React Native 0.87.1 graph."
  falsification_test: "If replacing the callback with `props => <MobileTabBar {...props} />` does not turn the focused Consumer-boundary test GREEN, this hypothesis is wrong or incomplete."
  fix_rationale: "The wrapper returns an element from the documented tabBar callback; React subsequently renders MobileTabBar as its own component and installs the hook dispatcher before useSafeAreaInsets executes."
  blind_spots: "No post-fix API 35 launch is allowed in this task; Phase 08 must rebuild and rerun its retained release-like smoke after this source change."
  candidate_causes:
    - "code: direct component function passed to a callback API that invokes it normally"
    - "environment: duplicate or incompatible React/renderer resolution (eliminated by dependency and Metro evidence)"
  and_gate: "no — the direct callback invocation alone deterministically explains both the release stack and the exact Jest reproduction."
- Test: preserve the source-level fix and exact regression gate for Phase 08 to rebuild from the committed tree and re-run its retained API 35 release-like launch smoke.
- Expecting: a freshly rebuilt candidate reaches and retains the phone shell; no invalid-hook-call stack appears before instrumentation.
- Next action: Phase 08 rebuilds a candidate from committed/pushed `0915d50` and re-runs the retained API 35 launch smoke. No APK build or install occurs in this debug task.

## Evidence Log

- timestamp: 2026-09-16 Asia/Shanghai — API 35 pre-instrumentation launch smoke failed with ReactNativeJS `Invalid hook call` and force-finished MainActivity.
- timestamp: 2026-09-16 Asia/Shanghai — Product hash/version/install facts and failure screenshot/UI dump were preserved; no integrated journey ran.
- timestamp: 2026-09-16 Asia/Shanghai — The complete preserved stack identifies `throwInvalidHookError@1:311242 → useSafeAreaInsets@1:658017 → MobileTabBar@1:582548`, then normal React render frames. The component stack places `MobileTabBar` inside `BottomTabNavigator`; no application hook is shown outside this call path.
- timestamp: 2026-09-16 Asia/Shanghai — The candidate source map resolves `useSafeAreaInsets@1:658017` to `react-native-safe-area-context/src/SafeAreaContext.tsx:150:33` and `MobileTabBar@1:582548` to `mobile/src/navigation/RootNavigator.tsx:63:34`, the hook call itself. `RootNavigator.tsx` supplies `tabBar={MobileTabBar}` at line 47.
- timestamp: 2026-09-16 Asia/Shanghai — Installed bottom-tabs 7.18.18 directly evaluates `tabBar({...})` in `BottomTabView.tsx:234`; this invokes `MobileTabBar` outside React's render dispatcher. This precisely explains `throwInvalidHookError` in the mapped React Fabric renderer.
- timestamp: 2026-09-16 Asia/Shanghai — `npm --prefix mobile ls` reports a fully deduped React 19.2.3 and React Native 0.87.1 graph; package peer contracts accept React 19.2.3; only `mobile/node_modules/react` exists. Metro has no extra node modules, watch folders, or custom resolver, and Node resolution points every inspected consumer to that single React copy.
- timestamp: 2026-09-16 Asia/Shanghai — The installed bottom-tabs type contract describes `tabBar` as a "Function that returns a React element" (`types.tsx:403-406`), confirming the regression test must model a normal callback invocation rather than React rendering the passed function as a component.
- timestamp: 2026-09-16 Asia/Shanghai — Initial focused test was insufficient: a mock Navigator invoked `tabBar(props)` during its own component render and passed, because React's dispatcher was active for that parent render. Installed bottom-tabs invokes it from a `SafeAreaInsetsContext.Consumer` render prop, so the test must reproduce that boundary before it can serve as a regression gate.
- timestamp: 2026-09-16 Asia/Shanghai — The revised Consumer-boundary test fails RED with `Invalid hook call` at the mocked `useSafeAreaInsets` hook, `MobileTabBar (RootNavigator.tsx:63:35)`, and the simulated `tabBar` callback; this reproduces the release mechanism without an APK. Oracle type: specified (bottom-tabs requires a callback that returns a React element).
- timestamp: 2026-09-16 Asia/Shanghai — Applied the minimal source fix: `MainTabs` now passes `tabBar={props => <MobileTabBar {...props} />}`. The callback returns a React element rather than invoking the hook-using component as a normal function.
- timestamp: 2026-09-16 Asia/Shanghai — Focused Consumer-boundary test is GREEN; `npm run mobile:typecheck` and `npm --prefix mobile run lint -- --quiet` also pass. Metro emitted a production Android bundle, indexed source map, and 19 assets to a temporary directory, but the follow-up assertion incorrectly expected a flat `sources` array and exited nonzero; bundle emission itself completed and the indexed map needs a format-aware validation rerun.
- timestamp: 2026-09-16 Asia/Shanghai — Indexed-map validation passed: the no-APK Android production bundle has 922 source-map sections, includes `RootNavigator.tsx`, and embeds the wrapper source while excluding `tabBar={MobileTabBar}`. The emitted assets contain 18 image files plus `raw/keep.xml` (the 19 Metro-reported assets).
- timestamp: 2026-09-16 Asia/Shanghai — Guardrail revert step: changing only the wrapper back to `tabBar={MobileTabBar}` makes the focused Consumer-boundary test fail RED with the same invalid-hook call at `MobileTabBar (RootNavigator.tsx:63:35)`.
- timestamp: 2026-09-16 Asia/Shanghai — Guardrail reapply step: restoring only `tabBar={props => <MobileTabBar {...props} />}` returns the focused Consumer-boundary test to GREEN. This satisfies the causal revert-and-reconfirm signal.
- timestamp: 2026-09-16 Asia/Shanghai — Initial Android verification limitation: `java -version` and `/usr/libexec/java_home -V` show no globally configured Java runtime/JDK 17; Gradle's JDK 21 was not used as a substitute.
- timestamp: 2026-09-16 Asia/Shanghai — A project-authorized existing JDK 17 was then identified at `/opt/homebrew/opt/openjdk@17`; Android verification will use it only through per-subprocess `JAVA_HOME`/`PATH` assignment, without installing or changing any toolchain.
- timestamp: 2026-09-16 Asia/Shanghai — JDK 17 was confirmed (`openjdk 17.0.20.1`) and Gradle was invoked with `:app:testDebugUnitTest :app:lintReleaseLike`. It stopped during configuration, before either requested task, because neither `ANDROID_HOME` nor `android/local.properties` supplies an SDK location.
- timestamp: 2026-09-16 Asia/Shanghai — Existing SDK verified at `/opt/homebrew/share/android-commandlinetools`: platform 37.0 and build-tools 37.0.0 match the mobile project, and NDK 27.1.12297006 is installed. The SDK can be supplied only to the verification subprocess.
- timestamp: 2026-09-16 Asia/Shanghai — The first SDK retry still stopped at SDK discovery because the shell-local `ANDROID_HOME`/`ANDROID_SDK_ROOT` assignments were not exported to the Gradle daemon. This is an invocation propagation issue, not missing JDK/SDK evidence; rerun with `env` exports is required before concluding the gate is blocked.
- timestamp: 2026-09-16 Asia/Shanghai — Exact Android gate passed with explicitly exported existing JDK 17 and SDK: `./gradlew --no-daemon :app:testDebugUnitTest :app:lintReleaseLike` completed `BUILD SUCCESSFUL` (395 actionable tasks; 18 executed, 377 up-to-date). It generated the release-like JavaScript bundle as a lint dependency but did not run an APK assembly, signing, installation, or emulator task.
- timestamp: 2026-09-16 Asia/Shanghai — Final Prettier-clean regression test guardrail revert step: changing only the wrapper to `tabBar={MobileTabBar}` fails RED with `Invalid hook call` at `MobileTabBar (RootNavigator.tsx:63:35)` before the test can observe the tab list.
- timestamp: 2026-09-16 Asia/Shanghai — Final guardrail reapply step: restoring only the wrapper returns the strengthened focused test to GREEN. Its specified oracle now requires both no invalid-hook exception and a rendered `accessibilityRole="tablist"`; the correctly scoped Prettier check had already passed before the reversible one-line source swap.
- timestamp: 2026-09-16 Asia/Shanghai — The documented full mobile Jest gate passes: 53 suites, 264 tests. The first Prettier command was launched from the repository root and matched no mobile files, so it is not accepted as formatting evidence and must be rerun from `mobile/`.
- timestamp: 2026-09-16 Asia/Shanghai — Current RootNavigator Prettier output differs only in pre-existing import wrapping and SafeAreaProvider subtree indentation; it preserves the new tabBar wrapper exactly. The new test file has formatting-only differences and will be made Prettier-clean before final validation.
- timestamp: 2026-09-16 Asia/Shanghai — Final consolidated source-level CI passed from 03:19:26 to 03:19:49 +0800: `npm run mobile:test` (53 suites, 264 tests), `npm run mobile:typecheck`, `npm --prefix mobile run lint -- --quiet`, and `npx prettier --check src/navigation/__tests__/RootNavigator.test.tsx` (from `mobile/`). With existing JDK 17 and SDK exported only to its subprocess, `./gradlew --no-daemon :app:testDebugUnitTest :app:lintReleaseLike` also passed (395 actionable tasks; 18 executed, 377 up-to-date). No APK assembly, signing, installation, or emulator task ran.
- timestamp: 2026-09-16 Asia/Shanghai — Mutation testing is not configured: `npm --prefix mobile ls @stryker/core @stryker/jest-runner --depth=0` reports neither package. The causal revert/reapply test provides the available focused regression guardrail instead.
- timestamp: 2026-09-16 Asia/Shanghai — Source fix and regression test were committed and pushed as `0915d50` (`fix(mobile): render hook-using tab bar as component`) on `agent/android-mobile-rebuild`. Only `mobile/src/navigation/RootNavigator.tsx` and `mobile/src/navigation/__tests__/RootNavigator.test.tsx` were staged; pre-existing planning changes remain untouched.

## Eliminated

- hypothesis: duplicate React instance or incompatible React/renderer versions cause the startup failure
  evidence: npm dependency tree, physical install search, package peer contracts, and Metro configuration each identify one compatible React 19.2.3 / React Native 0.87.1 graph; the source-mapped call chain instead proves the callback invocation mechanism.
  timestamp: 2026-09-16 Asia/Shanghai

## Resolution

- Root cause: `RootNavigator` passes hook-using `MobileTabBar` directly to the BottomTabNavigator `tabBar` callback API. The navigator calls it as `tabBar(props)` inside a Context.Consumer render prop instead of letting React render it as a component, so `useSafeAreaInsets` throws an invalid-hook-call exception.
- Fix: wrap MobileTabBar in the tabBar callback so it returns `<MobileTabBar {...props} />`; added a Consumer-boundary no-APK regression test for that composition contract.
- Files changed: mobile/src/navigation/RootNavigator.tsx, mobile/src/navigation/__tests__/RootNavigator.test.tsx
- oracle_type: specified — BottomTabNavigator documents that tabBar is a function returning a React element, and the regression test verifies that exact boundary behavior.
- Verification:
  - target_test: PASS — Consumer-boundary regression test is GREEN; its specified oracle requires both no invalid-hook exception and the rendered tab list.
  - mutation_check: SKIPPED — neither `@stryker/core` nor `@stryker/jest-runner` is configured in the mobile package.
  - no_op_deletion: PASS — the implementation is one direct-callback-to-element-wrapper replacement plus an additive regression test; no behavior is deleted.
  - revert_and_reconfirm: PASS — reverting only the wrapper reproduced the exact invalid-hook failure at `MobileTabBar (RootNavigator.tsx:63:35)`; reapplying only the wrapper restored GREEN.
  - adjacent_gates: PASS — full Jest (53 suites/264 tests), typecheck, ESLint, scoped Prettier, no-APK production Metro source-map validation, and JDK 17 Android JVM/lintReleaseLike all pass.
  - guardrail_verdict: accepted.
  - runtime_status: source fixed in pushed commit `0915d50`; pending Phase 08 rebuild of a new release-like candidate and the retained API 35 pre-instrumentation launch smoke. This task did not build or install an APK.
