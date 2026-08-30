---
phase: 03-netease-lyrics-provider-contract
plan: "01"
subsystem: android-rpc
tags: [android, netease, lyrics, rpc, validation, redaction]
dependency_graph:
  requires: [phase-02-media3-bridge]
  provides: [closed-netease-lyric-rpc-contract, typed-provider-failure-seam]
  affects: [03-02-provider-adapter, 03-03-rendition-clock, 03-04-lyric-room]
tech_stack:
  added: []
  patterns: [named-v2-operations, exact-json-payloads, native-route-ownership, first-terminal-wins]
key_files:
  created:
    - android/app/src/main/java/com/dazzlingwuming/listen2/NetEaseProviderClient.java
    - android/app/src/main/java/com/dazzlingwuming/listen2/NetEaseResponseMapper.java
    - android/app/src/main/java/com/dazzlingwuming/listen2/LyricPersistencePort.java
  modified:
    - android/app/src/main/java/com/dazzlingwuming/listen2/AndroidRpcContract.java
    - android/app/src/main/java/com/dazzlingwuming/listen2/AndroidHttpBridge.java
decisions:
  - NetEase and lyric requests are version-2 named operations with exact semantic payloads; the page cannot select URLs, headers, cookies, bodies, candidates, quality, or alternate renditions.
  - Until an approved entitlement-compliant NetEase route is supplied, the native client returns NETEASE_ROUTE_UNAVAILABLE rather than an empty success or a live-provider claim.
  - Provider rows are allow-listed DTOs and cancellation/timeout/page transitions retain the existing first-terminal registry rule.
metrics:
  duration: 00:12:00
  completed: 2026-08-31
status: complete
actuals:
  tokens: 14500
  tasks: 3
  commits: 3
requirements-completed: []
coverage:
  - id: D1
    description: Closed native NetEase search and lyric operation schemas.
    verification:
      - kind: unit
        ref: android/app/src/test/java/com/dazzlingwuming/listen2/AndroidRpcContractTest.java
        status: pass
    human_judgment: false
  - id: D2
    description: Redacted provider mapping and deterministic terminal lifecycle behavior.
    verification:
      - kind: unit
        ref: android/app/src/test/java/com/dazzlingwuming/listen2/NetEaseResponseMapperTest.java and AndroidNetEaseRpcLifecycleTest.java
        status: pass
    human_judgment: false
---

# Phase 3 Plan 01: Closed NetEase and Lyric RPC Summary

Android now accepts only named, bounded NetEase and lyric intents, maps provider fixtures into safe DTOs, and keeps missing live authorization explicit.

## Accomplishments

- Added `netease.search` through the trusted version-2 parser, native-only route builder, provider seam, safe response mapper, registry, and typed reply path.
- Froze exact schemas for NetEase detail/default rendition/lyric operations and lyric selection/offset operations; legacy version-1 GET remains search-only compatibility code.
- Added deterministic cancellation, timeout, stale-transition, interruption, partial-row, actionable-status, and transport-redaction coverage.

## Task Commits

1. Task 1 — `b7f57d6`: closed NetEase search RPC.
2. Task 2 — `149f43d`: full NetEase and lyric operation contract.
3. Task 3 — `0b42ddb`: lifecycle and redaction hardening.

## Verification

- Focused contract/policy and lifecycle/mapper JVM suites passed.
- Full local CI passed before every task publication: Android unit tests, debug APK assembly, APK signature verification, six desktop suites, and the extension suite.
- Latest full CI: 2026-08-31T07:27:08+0800 to 2026-08-31T07:27:15+0800 on pre-commit `149f43d` (exit 0). The source task commit does not alter build tooling or unrelated suites.

## Deviations from Plan

### Auto-fixed Issues

1. [Rule 1 - Bug] Classified interrupted native provider work as `CANCELLED`.
   - The generic failure branch would otherwise collapse an interrupted request into `NETWORK_IO_ERROR`.
   - The client now preserves cancellation as a terminal state and tests verify exception text is never serialized.
   - Commit: `0b42ddb`.

## Evidence Limits

- No approved, entitlement-compliant NetEase live route or authorized test item is present. This plan intentionally returns `NETEASE_ROUTE_UNAVAILABLE`; it does not complete NET-004 live evidence.
- Phase 1's independently BLOCKED Bilibili evidence remains preserved and unmodified.

## Next Phase Readiness

The frontend adapter, Media3 default-rendition seam, and Room lyric persistence plans can consume the stable operation names and safe error vocabulary. Live NetEase execution remains an external Phase 03-08 gate.

## Self-Check: PASSED

- All nine source/test artifacts named by this plan exist.
- Task commits `b7f57d6`, `149f43d`, and `0b42ddb` are present on the pushed branch.
- No tracked files were deleted.
