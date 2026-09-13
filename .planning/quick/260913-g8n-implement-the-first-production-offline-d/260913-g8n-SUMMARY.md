---
phase: quick-260913-g8n-production-offline-download
plan: "01"
status: complete
verification_status: human_needed
completed_at: 2026-09-13T00:00:00+08:00
actuals:
  tasks: 3
  commits: 6
---

# Quick Task 260913-g8n: Offline download slice

Implemented the canonical React Native offline-download surface: a native-owned semantic module and non-exported provider, a volatile sanitized Redux projection, cache-first playback ordering, and explicit search/settings controls. The corrective pass replaces the shallow native coordinator with a deterministic, lock-owned state machine; its Kotlin compilation remains unverified because the host has no Java Runtime.

## Commits

- `98dead2` — native offline audio boundary and JVM contract source
- `dc5ad99` — sanitized adapter, volatile download state, cache-first playback
- `e13a7de` — explicit eligible-source controls and download management UI
- `66143d4` — durable native catalog/recovery, Kugou resolver, retry/event contract, and cache transition tests
- `7597dc0` — hardened bounded transport, atomic redundant catalog, race-safe reservations/tombstones, and behavioral contract coverage
- `5ae3984` — locked two-hop/deadline transport, per-chunk quota accounting, safe playback errors, and localized recovery copy

## Corrective Pass

- Added a pure `OfflineCore.kt` coordinator with injectable transport, executor, clock, and limits. NetEase/Kugou use finite HTTPS route allow-lists; every redirect is manually re-authorized, Kugou bootstrap data is streaming-bounded to 64 KiB, and media requires an allowed audio content type, 128 MiB cap, and recognizable signature.
- All queued/downloading/progress/ready/failed/cancelled transitions now execute under one synchronization boundary, atomically persist `catalog.previous.json` then `catalog.json` via temporary file + fsync + same-directory rename, and publish snapshots. Recovery validates both catalog copies, repairs interrupted state, removes stale partial/temp/orphan media, and checksum-invalidates corrupt cache entries.
- In-flight reservations are counted against the 512 MiB quota, duplicate semantic keys converge, and cancellation/removal/clear tombstone active work before deletion so a stale worker cannot publish ready. The production executor remains exactly two active workers plus eight queued jobs.
- Expanded deterministic Kotlin tests using a fake transport/executor/clock and expanded Jest coverage for miss/corrupt/cache-load/online-failure transactions plus adapter event-to-Redux hydration and privacy projection.

## Final Hardening Pass

- Restricted provider transport to two redirects, exact Kugou media host validation, and a monotonic 15-minute deadline carried through bootstrap, redirects, and stream reads.
- Recomputed per-chunk reservations from both declared and actual bytes; an underreported Content-Length is rejected before it can become ready, and capacity failures use the stable `CAPACITY_EXCEEDED` code.
- Replaced all player Redux error dispatches with bounded typed or product codes, and render only fixed Chinese copy for both playback and download failures. Raw media locations, headers, paths, and exception messages are not persisted or displayed.

## Verification

- Passed: focused Jest (`playerController.test.ts`, `offlineUi.test.tsx`) with 17 tests, TypeScript, scoped ESLint, scoped Prettier, and Android production Metro bundle (19 assets).
- Not verified: the permitted focused Gradle JVM test. The one allowed attempt exited before Gradle initialization with `Unable to locate a Java Runtime`. No APK, emulator, installation, repository-wide CI, merge, or deploy was run.

## Delivery

All six code commits were pushed to `origin/agent/android-mobile-rebuild`. Merge and deployment were not performed.

## Human Follow-up Required

Make JDK 17 available to the environment and run the plan's exact focused contract command. Then perform the separately authorized integrated Android emulator acceptance for real provider downloads and TrackPlayer content-provider playback. These are not established by the JavaScript checks or Metro bundling.

## Residual Risks

- Kotlin/manifest/provider compilation and the JVM contract source are present but cannot be proven without JDK 17.
- Native provider/media behavior must still be exercised on an Android device/emulator; no claim of real offline playback is made until that gate passes.
