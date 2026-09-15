---
phase: 07-offline-advanced-playback
plan: 01
status: complete
completed: 2026-09-15
---

# Plan 07-01 Summary

Implemented the native-owned media descriptor and lease handoff across the
five remote sources, then migrated the shared API, Bilibili client, player,
and focused UI/test fixtures to consume only validated descriptors.

## Delivered

- Added a versioned `NativeMediaDescriptor` bridge vocabulary with exact-key,
  app-owned URI, entitlement, rendition/part membership, size/duration, lease,
  generation, and cancellation validation.
- Updated Bilibili, NetEase, Kugou, QQ, and Kuwo native adapters to return the
  common descriptor while keeping transport URLs and headers native-private.
- Removed the raw `BootstrapTrack` contract and URL/header handoff from API,
  provider registry, Bilibili client, and player resolution paths.
- Made TrackPlayer receive only the validated app-owned URI and safe metadata;
  retained bounded Bilibili re-resolution, offline fallback, cancellation,
  stale-generation protection, and rollback behavior.
- Added migration/forgery coverage and adapted API, Bilibili, player, MV flow,
  and native contract fixtures to the strict handoff.

## Verification

At 2026-09-15 on branch `agent/android-mobile-rebuild`:

- Focused Jest selectors: 8 suites, 108 tests passed (`client`, descriptor
  migration, Bilibili client, player transition/retry/lifecycle/rollback, and
  Bilibili flow).
- Focused JVM selectors for the five-source descriptor and Bilibili rendition
  contracts plus existing Bilibili/QQ/Kuwo contracts: 37 tests passed.
- `npm run mobile:typecheck`, focused/full mobile ESLint, and `git diff --check`
  passed. The full mobile Jest run reached 246 passing tests but remains
  `not verified` because two concurrent 07-04 DeepSeek contract selectors
  fail against their in-flight changes; all 07-01 selectors are green.

APK/emulator, live provider credentials, and the complete Phase 7 gate remain
deferred to plan 07-05. No APK or emulator was run for this task.
