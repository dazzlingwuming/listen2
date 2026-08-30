---
status: resolved
trigger: "API35 connectedDebugAndroidTest intermittently times out in PlaybackRecoveryInstrumentationTest stageBRestoresPausedExactSemanticCheckpointWithoutTransport while waiting for playback state, blocking the Phase 1 live Bilibili gate before any provider request."
created: 2026-08-31T05:44:00+08:00
updated: 2026-08-31T06:09:20+08:00
---

## Symptoms

- Expected: The exact installed debug APK's connected tests deterministically restore the Stage A Room checkpoint into a paused, actionable, transport-free Stage B playback snapshot, allowing the live provider harness to continue.
- Actual: `PlaybackRecoveryInstrumentationTest > stageBRestoresPausedExactSemanticCheckpointWithoutTransport` times out in `PlaybackInstrumentationFixture.await` while waiting for playback state.
- Error: Await timeout reported by the instrumentation test; the live provider request was never reached.
- Timeline: The same Phase 2 recovery test passed during Plan 02-08/02-09 evidence, then failed on the next 01-07 cold run after app/emulator setup.
- Reproduction: With JDK 17 and the API35 arm64 emulator, run the Phase 1 live harness/its `:app:connectedDebugAndroidTest` prerequisite on current HEAD `bbd5437`.

## Current Focus

- resolution: Human verification confirmed that commit `08b0f404aaa6937945dc711697321027f455f8c7` advanced through aggregate instrumentation and reached live Bilibili search.
- verified_outcome: The connected prerequisite passed 13 tests with only the intentional host Stage-A/Stage-B pair skipped; live Bilibili search returned five rows.
- scope_boundary: The subsequent provider-detail error occurred after this gate and is a separate issue; it is not diagnosed or resolved by this session.
- next_action: Move this confirmed session to `.planning/debug/resolved/` without changing provider code or Phase 3 planning artifacts.

## Evidence

- timestamp: 2026-08-31T06:05:00+08:00
  checked: Phase-0 semantic recall and durable knowledge base
  found: MemPalace is disabled in project configuration and `.planning/debug/knowledge-base.md` does not exist.
  implication: No prior-resolution hypothesis is available; investigate from direct code and runtime evidence.

- timestamp: 2026-08-31T06:05:00+08:00
  checked: Phase-01 and Phase-02 API-35 evidence contracts
  found: Phase 02 explicitly uses the Stage-A force-stop, empty-PID, relaunch, Stage-B recovery sequence; Phase 01's live gate runs connected instrumentation before provider access.
  implication: The reported failure blocks the prerequisite recovery proof, not a live provider request.

- timestamp: 2026-08-31T06:14:00+08:00
  checked: `PlaybackRecoveryInstrumentationTest`, `PlaybackInstrumentationFixture`, and `PlaybackService`
  found: Stage B waits exclusively for `recovery.status == restored`. `PlaybackService.onCreate` schedules Room restore on its executor while registering ExoPlayer callbacks that call `publishPlayerSnapshot`, which writes a new non-restored recovery status from the current snapshot.
  implication: There is a testable write-order race in production snapshot publication; it is not yet confirmed because runtime ordering has not been observed.

- timestamp: 2026-08-31T06:18:00+08:00
  checked: `android/scripts/phase02-process-death-smoke.sh` and API-35 device readiness
  found: The authoritative deterministic sequence explicitly runs Stage A, force-stops until PID is empty, starts `MainActivity`, then runs Stage B. One API-35 arm64 emulator is ready and the pinned Gradle 8.10.2 binary is available.
  implication: Reproducing this script exercises the reported condition without calling a provider or changing test order.

- timestamp: 2026-08-31T06:21:00+08:00
  checked: unchanged process-death runner invocation
  found: It exited before Gradle tasks with `Unable to locate a Java Runtime`.
  implication: This is a local shell prerequisite failure, not a reproduction result; no test or provider path ran.

- timestamp: 2026-08-31T06:28:00+08:00
  checked: unchanged `phase02-process-death-smoke.sh --verify` with the installed JDK 17
  found: The exact Stage-A → force-stop/empty-PID → relaunch → Stage-B sequence passed after build/install, without any provider request.
  implication: The persisted checkpoint, product recovery path, and fixture polling work when the documented lifecycle boundary is present. This weakens the product snapshot-race hypothesis and makes runner orchestration the next discriminating branch.

- timestamp: 2026-08-31T06:32:00+08:00
  checked: installed `PlaybackRecoveryInstrumentationTest` executed as one AndroidJUnitRunner class
  found: AndroidJUnitRunner reported `stageBRestoresPausedExactSemanticCheckpointWithoutTransport` before Stage A. This first invocation passed only because the explicit process-death runner had left a valid restored snapshot in the app process; Stage A then cleared/reseeded durable state without a restart.
  implication: The class is not self-contained and cannot validly run as Gradle's normal full-suite unit. Method ordering/stale state is a concrete synchronization defect; a second execution now differentiates the predicted timeout.

- timestamp: 2026-08-31T06:39:00+08:00
  checked: second installed full-class AndroidJUnitRunner invocation
  found: It again ran Stage B before Stage A and passed because the previous invocation's Stage A had persisted a checkpoint and Android force-stopped the target at the end of that invocation.
  implication: The nondeterminism is stale persisted state across runner invocations, not the product's in-process restore. Clearing package data is the decisive falsification test.

- timestamp: 2026-08-31T06:45:00+08:00
  checked: clean-package full-class AndroidJUnitRunner invocation
  found: The runner executed Stage B first and reproduced the reported `AssertionError: timed out waiting for playback state` after 10.757 seconds; it then ran Stage A. The unchanged explicit process-death script passed.
  implication: Root cause confirmed: ordinary aggregate instrumentation is executing external host-driven stages without their required lifecycle. Product checkpoint recovery is not the failing path.

- timestamp: 2026-08-31T07:02:00+08:00
  checked: initial green-phase Android test compilation
  found: The shell failed at `/usr/libexec/java_home -v 17` with `Unable to locate a Java Runtime`, before Gradle or instrumentation ran.
  implication: This is a local JDK-discovery prerequisite conflict, not a test or product result; locate the proven JDK path before evaluating the guard.

- timestamp: 2026-08-31T07:06:00+08:00
  checked: local Java installations
  found: `/usr/libexec/java_home` lists no runtimes, while Homebrew reports `openjdk@17 17.0.20.1` installed.
  implication: JDK 17 is available but unregistered with macOS; Gradle must use the formula's explicit `Contents/Home` path.

- timestamp: 2026-08-31T07:10:00+08:00
  checked: green-phase `:app:assembleDebugAndroidTest` with explicit JDK 17
  found: Gradle started but stopped before compilation because neither `ANDROID_HOME` nor `android/local.properties` supplies an SDK path.
  implication: The JDK discovery problem is resolved; API-35 SDK discovery is the remaining local prerequisite before any guard result can be observed.

- timestamp: 2026-08-31T07:14:00+08:00
  checked: conventional user, Homebrew, and `/usr/local` Android SDK locations
  found: No directory simultaneously contains `platforms/android-35` and `platform-tools/adb`; the inherited Android SDK environment variables are empty.
  implication: The previously documented API-35 environment may no longer be installed or is in a nonstandard location; inspect installed package/emulator records before declaring the runtime verification blocked.

- timestamp: 2026-08-31T07:19:00+08:00
  checked: Homebrew Android tooling and AVD records
  found: `/opt/homebrew/share/android-commandlinetools` contains `adb`, the emulator, SDK package directories, and a `listen2_api35` AVD definition.
  implication: The SDK root was found; the earlier discovery condition failed because it also required an unconfirmed `platforms/android-35` directory. Verify installed platform versions next.

- timestamp: 2026-08-31T07:24:00+08:00
  checked: SDK platform directories
  found: The discovered SDK root contains `platforms/android-35` and `build-tools/35.0.0`; the prior Gradle command had not exported this root as `ANDROID_SDK_ROOT`.
  implication: Android SDK installation is complete; setting the correct environment variable is sufficient to unblock build and device verification.

- timestamp: 2026-08-31T07:31:00+08:00
  checked: clean-package AndroidJUnitRunner class selection after compiling the guard
  found: Both Stage B and Stage A reported the guard's `AssumptionViolatedException`, then AndroidJUnitRunner completed `OK (2 tests)` in 0.018 seconds. No timeout occurred.
  implication: Normal aggregate/class instrumentation excludes the invalid external lifecycle before it can bind the service or wait for recovery; the RED failure no longer reproduces under clean state.

- timestamp: 2026-08-31T07:39:00+08:00
  checked: unchanged explicit host lifecycle runner after the guard
  found: Two consecutive `phase02-process-death-smoke.sh --verify` runs passed, each rebuilding/installing the test APK and completing Stage A -> force-stop -> relaunch -> Stage B.
  implication: The exact method selector used by the established host runner enables both stages; the guard does not suppress the actual process-death proof.

- timestamp: 2026-08-31T07:47:00+08:00
  checked: full `:app:connectedDebugAndroidTest` on the API-35 AVD
  found: All 15 instrumentation tests completed successfully; only the two intentionally host-driven recovery stages were marked `SKIPPED`.
  implication: The aggregate instrumentation prerequisite is clean-state safe, while the external lifecycle proof remains separately exercised by its host runner.

- timestamp: 2026-08-31T06:05:00+08:00
  checked: Android README and CI workflow local gate
  found: With JDK 17 and SDK 35 configured, `:app:testDebugUnitTest :app:assembleDebug` completed successfully and `apksigner verify --verbose` accepted the debug APK. HEAD remained `bbd5437`; unrelated untracked planning artifacts were preserved.
  implication: The repository's documented build/JVM/signature gate passes for the one-file fix; the remaining guardrail check is causal revert-and-reconfirm.

- timestamp: 2026-08-31T06:12:00+08:00
  checked: bounded revert-and-reconfirm (guard temporarily stashed only)
  found: With the test guard removed, a clean normal class selection failed exactly as before: Stage B ran first and timed out in `PlaybackInstrumentationFixture.await` after 10.844 seconds. The one-file stash then reapplied cleanly and was dropped.
  implication: The guard is causally necessary for the fixed aggregate-runner behavior; no unrelated user or planning change was stashed or altered.

- timestamp: 2026-08-31T06:17:00+08:00
  checked: restored-guard clean class selection and current-snapshot local CI
  found: The restored guard yielded `OK (2 tests)` with both stages skipped in 0.018 seconds. The repository Android gate again passed: `:app:testDebugUnitTest :app:assembleDebug` and `apksigner verify --verbose`; HEAD remained `bbd5437` throughout.
  implication: Reapplying the exact fix restores the desired aggregate behavior, and the final tested source snapshot is buildable, JVM-tested, and correctly signed.

- timestamp: 2026-08-31T06:22:00+08:00
  checked: final fix diff and mutation-test availability
  found: `git diff --check` passed and the fix is nine additions with zero deletions: two method-entry guards plus one exact-selector helper. No Stryker configuration, package dependency, or executable exists in the repository.
  implication: The fix is neither deletion-only nor an assertion relaxation; mutation analysis is transparently unavailable rather than treated as a pass.

- timestamp: 2026-08-31T06:26:00+08:00
  checked: post-commit Android README/workflow local CI on `08b0f40`
  found: `:app:testDebugUnitTest :app:assembleDebug` and `apksigner verify --verbose` passed with unchanged start/end SHA `08b0f40`; the working tree retained only untracked debug/planning artifacts.
  implication: The publish gate applies to the exact commit that will be pushed.

- timestamp: 2026-08-31T06:31:00+08:00
  checked: remote branch publication
  found: Commit `08b0f40` was pushed successfully to `origin/agent/android-mobile-rebuild`; only pre-existing/untracked debug and planning artifacts remain outside the commit.
  implication: The verified code fix is available to the parent workflow; end-to-end real-workflow confirmation is the final outstanding checkpoint.

- timestamp: 2026-08-31T06:07:23+08:00
  checked: human end-to-end verification on commit `08b0f404aaa6937945dc711697321027f455f8c7`
  found: The Phase-1 gate advanced past aggregate instrumentation; its connected prerequisite passed 13 tests with only the intentional host Stage-A/Stage-B pair skipped, and live Bilibili search returned five rows.
  implication: The original recovery-timeout blocker is resolved in the real workflow. A later provider-detail error is outside this session because it occurred only after the prerequisite and search gate had succeeded.

## Eliminated

- hypothesis: `PlaybackService` loses a valid restored snapshot to an ExoPlayer callback race
  evidence: The exact explicit process-death lifecycle restored the checkpoint successfully without product changes; only the normal runner's missing lifecycle failed.
  timestamp: 2026-08-31T06:45:00+08:00

## Resolution

- root_cause: Normal `connectedDebugAndroidTest` executes host-driven Stage B before Stage A and without the required force-stop/relaunch boundary; a clean Room store exposes this as the timeout, while stale Stage-A durable data masks it.
- oracle_type: specified (the Phase-02 contract explicitly requires the host Stage-A -> force-stop -> relaunch -> Stage-B lifecycle)
- fix: Added a test-local assumption that enables each recovery stage only when AndroidJUnitRunner's existing `class` argument exactly selects that stage (`PlaybackRecoveryInstrumentationTest#method`). Normal aggregate/class runs skip the external lifecycle stages; the unchanged host runner retains the exact per-method selectors.
- verification:
  target_test: { result: pass, evidence: "two explicit Stage-A -> force-stop -> relaunch -> Stage-B host runs passed" }
  mutation_check: { result: skipped, reason_if_skipped: "no Stryker configuration, dependency, or executable in this Java/Gradle repository" }
  no_op_deletion: { result: pass, deletion_justified_by_rca: true, evidence: "nine additions, zero deletions; exact selector guard is the documented lifecycle-contract enforcement" }
  adjacent_tests: { result: pass, suites_run: [":app:connectedDebugAndroidTest (15 tests; only host stages skipped)", ":app:testDebugUnitTest", ":app:assembleDebug", "apksigner verify --verbose"] }
  revert_and_reconfirm: { result: pass, bug_returned_on_revert: true, fixed_on_reapply: true }
  human_end_to_end: { result: pass, commit: "08b0f404aaa6937945dc711697321027f455f8c7", evidence: "2026-08-31T06:07:23+08:00: aggregate prerequisite passed 13 tests with the intentional host pair skipped; live Bilibili search returned five rows" }
  guardrail_verdict: accepted
- files_changed:
  - android/app/src/androidTest/java/com/dazzlingwuming/listen2/PlaybackRecoveryInstrumentationTest.java
- out_of_scope: A provider-detail error reported after successful live search is a separately occurring provider issue and is not part of this resolution.
