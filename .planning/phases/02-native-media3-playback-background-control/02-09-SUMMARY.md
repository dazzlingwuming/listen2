---
phase: 02-native-media3-playback-background-control
plan: "09"
subsystem: api35-deterministic-evidence
tags: [android, api35, evidence, media3, redaction, process-death]
dependency_graph:
  requires: [02-08]
  provides: [fail-closed-deterministic-device-evidence]
  affects: [02-10-live-provider-gate]
tech_stack:
  added: []
  patterns: [exact-apk-identity, bounded-CDP-capture, redacted-evidence, strict-live-separation]
key_files:
  created:
    - android/scripts/phase02-api35-smoke.sh
    - android/scripts/phase02-webview-smoke.mjs
    - android/evidence/phase02/README.md
    - .planning/phases/02-native-media3-playback-background-control/02-API35-EVIDENCE.md
    - .planning/phases/02-native-media3-playback-background-control/evidence/02-player.png
    - .planning/phases/02-native-media3-playback-background-control/evidence/02-queue.png
    - .planning/phases/02-native-media3-playback-background-control/evidence/02-notification.png
decisions:
  - Deterministic installed-device proof is accepted only with --allow-live-blocked; plain strict verification remains nonzero until Plan 02-10 live proof passes.
  - Evidence may survive its documentation commit only when its recording commit is an ancestor and Android app/Gradle build inputs are unchanged.
  - Screenshots are limited to redacted clean-launch page context; installed instrumentation is the semantic proof for Media3, queue, notification, and Room behavior.
metrics:
  duration: 00:00:00
  completed: 2026-08-31
status: complete
actuals:
  tokens: 28000
  tasks: 3
  commits: 2
---

# Phase 02 Plan 09: Exact API-35 Evidence Summary

A fail-closed API-35 harness now records exact installed Media3 lifecycle proof while preserving the independent Phase-1 HTTP-412 live-provider blocker.

## Completed Tasks

1. Added the redaction-tested API-35 harness and bounded CDP page capture helper.
2. Ran an exact debug APK on `emulator-5554` (API 35, arm64-v8a, `listen2_api35`) and recorded installed service/session, system controls, semantic Room checkpoint, and Stage-A/B process-recovery outcomes.
3. Verified deterministic evidence with `--allow-live-blocked`; plain strict verification correctly exits 75 while `live-provider-media3` is `BLOCKED — Phase 1 HTTP 412`.

## Verification

- `bash android/scripts/phase02-api35-smoke.sh --self-test` passed: timeout, device/evidence rejection, hash drift, missing marker/screenshot, duplicate screenshot/fixture substitution, and redaction canaries fail closed.
- `bash android/scripts/phase02-api35-smoke.sh --run-deterministic --evidence .planning/phases/02-native-media3-playback-background-control/02-API35-EVIDENCE.md` passed using the installed debug APK.
- `bash android/scripts/phase02-api35-smoke.sh --verify-evidence .planning/phases/02-native-media3-playback-background-control/02-API35-EVIDENCE.md --allow-live-blocked` passed.
- Plain `--verify-evidence` exited 75 as required because live provider proof remains blocked.
- Full repository local CI passed at `2026-08-31T05:40:28+0800` through `2026-08-31T05:40:34+0800` on pre-commit `9affb51901d42b385eb835bd0654ca10ceb939b0`: Android unit/build/signature, six desktop suites, and the frontend suite.

## Evidence Limits

- Live provider-to-Media3 playback is **BLOCKED / not verified** by the Phase-1 anonymous Bilibili HTTP 412 result. Deterministic fixture, build, JVM, or screenshot output cannot complete Phase 2.
- Bluetooth/AVRCP remains **not verified** because the API-35 emulator has no real Bluetooth/AVRCP transport.
- The three screenshots are clean-launch, redacted packaged-page context captures. They intentionally do not claim native playback/queue/notification semantics; the installed instrumentation classes are the proof for those surfaces.

## Deviations from Plan

### Auto-fixed Issues

1. **[Rule 1 - Bug] Retried cold WebView CDP readiness before taking evidence screenshots.**
   - **Found during:** Task 2
   - **Issue:** CDP became reachable before the first WebView document returned a bounded page value.
   - **Fix:** Added a 20-second bounded document/shell poll; no arbitrary page code or provider request was introduced.
   - **Commit:** `01f2f8f`

2. **[Rule 2 - Integrity] Rejected duplicate screenshot fixture substitution and preserved APK-source identity across evidence commits.**
   - **Found during:** Task 2
   - **Issue:** a documentation/evidence commit necessarily changes repository HEAD without changing the APK source, and identical context screenshots could otherwise be substituted.
   - **Fix:** Require the recorded commit to remain reachable with unchanged Android app/Gradle inputs, and require three distinct metadata-free PNG hashes.
   - **Commit:** `01f2f8f`

## Self-Check: PASSED

- Harness, verifier, evidence record, and all three screenshots exist.
- Commits `9affb51` and `01f2f8f` exist on the pushed branch.
- No tracked files were deleted by either commit.
