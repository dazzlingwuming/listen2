---
quick_task: 260914-f3q
status: complete
requirements-completed: [QUICK-BILIBILI-001]
actuals:
  tasks: 3
  commits: 6
  changed_lines: 2868
---

# Bilibili account session and exact playback summary

Native-owned QR/session, exact BVID/CID selection, and transient authenticated Bilibili audio handoff now run through the canonical React Native Android application.

## Task commits

1. `73f62d5` — native Bilibili policy, Keystore vault, QR/session state, fixed gateway, native module, and Kotlin contracts.
2. `5e3acdd` — strict React Native adapter, local-only QR UI lifecycle, Bilibili detail route, and exact part selection.
3. `8a223f9` — native semantic BVID/CID playback resolution and transactional player handoff/rollback checks.
4. `ed4e841` — verifier-gap repair: encrypted native session restore/refresh, immediate QR request cancellation, actual signed-deadline media validation, and lifecycle/hostile-input/exact-part tests.
5. `def4d80` — binds authentication persistence to an active QR generation, conditionally revokes only that attempt's vault envelope, and adds a deterministic cancellation-during-account-validation contract.
6. `8ce07d1` — writes QR material as owner-tagged provisional storage, rejects provisional envelopes on restore, and commits a restorable session only after the final active-attempt boundary.

All six commits were pushed to `origin/agent/android-mobile-rebuild`.

## Verification

- Passed: `npm --prefix mobile test -- --runInBand src/bilibili/__tests__/client.test.ts src/screens/__tests__/bilibiliFlow.test.tsx` (2 suites, 3 tests).
- Passed: `npm --prefix mobile test -- --runInBand src/bilibili/__tests__/client.test.ts src/api/__tests__/client.test.ts src/player/__tests__/playerController.test.ts` (3 suites, 47 tests).
- Passed: `npm run mobile:typecheck`.
- Passed: `npm run mobile:test` (14 suites, 105 tests).
- Passed: `npm --prefix mobile run lint -- --quiet`, `cd mobile && ./node_modules/.bin/prettier --check src/bilibili/client.ts src/bilibili/__tests__/client.test.ts src/screens/__tests__/bilibiliFlow.test.tsx`, and `git diff --check`.
- Not verified: `cd mobile/android && ./gradlew --no-daemon :app:testDebugUnitTest --tests com.listen2mobile.bilibili.BilibiliContractTest` — this host has no Java Runtime/JDK 17. No JDK or dependency substitute was installed.
- Not verified: APK assembly, emulator/device flow, live Bilibili account/QR behavior, and native TrackPlayer playback/audio-focus behavior. These remain deliberately deferred to final Android acceptance.

## Decisions and deviations

- Kept QR keys, cookies, refresh material, WBI construction, fixed API routes, and entitlement decisions native-only. JavaScript sees only sanitized public state, opaque attempts, QR PNG, detail data, and a short-lived validated handoff.
- Used exact `bitrack_v_BVID-CID` identity. The native module resolves the unique returned page for that CID rather than allowing a JavaScript default-page fallback.
- [Rule 1 - bug] The initial native module used separate gateway instances for QR/session and semantic detail/audio calls. Task 3 corrected it to share one native gateway and to resolve a CID's exact native page before requesting audio; included in `8a223f9`.
- [Rule 1/2 - security and correctness] Verifier review found a write-only vault, non-cancellable single-worker QR poll, fabricated audio expiry, and shallow lifecycle coverage. `ed4e841` adds native-only AES-GCM read/restore, a fixed cookie-info/correspond/refresh/confirm flow with explicit OAEP SHA-256/MGF1, strict host/path and signed-deadline handling, disconnectable current QR requests, and test coverage for fail-closed persistence, WBI, media candidates, and Search-to-second-part dispatch.
- [Rule 1 - race] Re-verification found that a cancellation between QR success and account validation could leave a stale encrypted session. `def4d80` carries an immutable active generation through export, account validation, vault save, and public commit; a stale owner can only remove its own vault envelope. Kotlin fixtures now pass bounded `SESSDATA`/`bili_jct` maps matching `SessionMaterial`.
- [Rule 1 - persistence atomicity] Final verification found that a stale write could still become restorable during the small interval before public commit. `8ce07d1` introduces an encrypted provisional/committed envelope state and a commit gate shared with cancellation; restart discards provisional envelopes, while owner-conditional cleanup leaves a newer committed envelope untouched.

## Remaining gaps

No source-code task remains. Native compilation and device/live-provider acceptance require a host with JDK 17 plus the final Android emulator/device gate.
