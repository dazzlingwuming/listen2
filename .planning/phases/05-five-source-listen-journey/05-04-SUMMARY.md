---
phase: 05-five-source-listen-journey
plan: 04
subsystem: android-native-provider
tags: [android, kotlin, react-native, qq, playback, network-security]
requires:
  - phase: 05-03
    provides: canonical mobile provider and native-boundary conventions
provides:
  - Cookie-free, semantic-ID-only QQ native resolver contract
  - Bounded metadata/probe validation, typed denials, and cancellation lifecycle
affects: [05-05, phase-08-android-acceptance]
actuals:
  tokens: 8267
  tasks: 2
  commits: 2
tech-stack:
  added: []
  patterns:
    - Fixed native provider POST with injected JVM transport fixtures
    - Request lease ledger for duplicate rejection, cancellation, and stale-completion suppression
key-files:
  created:
    - mobile/android/app/src/main/java/com/listen2mobile/qq/QqPlaybackPolicy.kt
    - mobile/android/app/src/main/java/com/listen2mobile/qq/QqPlaybackGateway.kt
    - mobile/android/app/src/main/java/com/listen2mobile/qq/QqPlaybackModule.kt
    - mobile/android/app/src/main/java/com/listen2mobile/qq/QqPlaybackPackage.kt
    - mobile/android/app/src/test/java/com/listen2mobile/qq/QqPlaybackContractTest.kt
  modified: []
key-decisions:
  - "QQ accepts only canonical qqtrack semantic IDs and builds the fixed musicu POST natively."
  - "The exact QQ fixture CDN host is fail-closed test policy, not evidence of live CDN coverage."
  - "The package remains unregistered and JavaScript capability projection remains unchanged until Plan 05-05."
patterns-established:
  - "Provider resolver boundaries expose a narrow versioned semantic request, never caller-controlled URL, headers, cookies, credentials, or retry policy."
requirements-completed: [NET-004, PLAY-001, SRCH-003, SEC-004]
coverage:
  - id: D1
    description: Cookie-free fixed QQ metadata request and probe-vetted short-lived descriptor.
    requirement: NET-004
    verification:
      - kind: unit
        ref: "QqPlaybackContractTest via :app:testDebugUnitTest"
        status: pass
    human_judgment: false
  - id: D2
    description: Typed QQ restriction, malformed input, timeout, cancellation, and teardown outcomes.
    requirement: SEC-004
    verification:
      - kind: unit
        ref: "QqPlaybackContractTest via :app:testDebugUnitTest"
        status: pass
    human_judgment: false
duration: 17min
completed: 2026-09-15
status: complete
---

# Phase 05 Plan 04: QQ Native Resolver Contract Summary

**Unregistered Android QQ resolver that turns only canonical semantic IDs into a short-lived, probe-vetted descriptor through one fixed, cookie-free musicu POST.**

## Performance

- **Duration:** 17 minutes
- **Started:** 2026-09-15T05:13:13Z
- **Completed:** 2026-09-15T05:29:54Z
- **Tasks:** 2/2
- **Files created:** 5

## Accomplishments

- Implemented exact original-provider `musicu.fcg` request semantics natively, including semantic `songmid` and M500 filename construction, with no Cookie header, CookieManager, ambient session, or retained Set-Cookie state.
- Added fixed HTTPS-only host and URI policy, bounded 256 KiB metadata parsing, no-redirect one-byte media probe, exact audio MIME/declared-size checks, and a maximum 60-second lease.
- Added deterministic typed denial, malformed, timeout, cancellation, invalidation, collision, stale-generation, and response-cookie fixture coverage while keeping QQ unavailable to JavaScript and absent from application registration.

## Task Commits

1. **Task 1: Resolve one semantic QQ mid through the fixed native request and probe** — `7fa78db` (`feat`)
2. **Task 2: Close QQ authorization, malformed, timeout, and cancellation behavior** — `ff6f668` (`fix`)

## Files Created

- `mobile/android/app/src/main/java/com/listen2mobile/qq/QqPlaybackPolicy.kt` — Pure semantic ID, fixed body, fixture-host, response/probe, lease, and safe-error policy.
- `mobile/android/app/src/main/java/com/listen2mobile/qq/QqPlaybackGateway.kt` — Stateless bounded HTTPS metadata/probe owner with cancellation.
- `mobile/android/app/src/main/java/com/listen2mobile/qq/QqPlaybackModule.kt` — Versioned semantic-only React Native boundary and atomic request lifecycle.
- `mobile/android/app/src/main/java/com/listen2mobile/qq/QqPlaybackPackage.kt` — Deliberately unregistered package placeholder for Plan 05-05.
- `mobile/android/app/src/test/java/com/listen2mobile/qq/QqPlaybackContractTest.kt` — Deterministic no-network provider contract fixtures.

## Verification

All commands passed on `agent/android-mobile-rebuild` using the explicit existing JDK 17 and Android SDK paths:

- `JAVA_HOME=/opt/homebrew/opt/openjdk@17 ANDROID_HOME=/opt/homebrew/share/android-commandlinetools ANDROID_SDK_ROOT=/opt/homebrew/share/android-commandlinetools PATH=/opt/homebrew/opt/openjdk@17/bin:$PATH ./mobile/android/gradlew --offline --no-daemon -p mobile/android :app:testDebugUnitTest --tests 'com.listen2mobile.qq.QqPlaybackContractTest'`
- Same environment with `:app:testDebugUnitTest` — 151 Gradle tasks, passed.
- `npm run mobile:test` — 34 suites / 217 tests passed.
- `npm run mobile:typecheck` — passed.
- `npm --prefix mobile run lint -- --quiet` — passed.
- `git diff --check` — passed.

## Decisions Made

- The fixture-only host set is exact and nonempty for policy readiness, but it intentionally makes no claim about exhaustive live QQ CDN hosts.
- Only explicit `listen2_error` fixture evidence maps to authorization, membership, DRM, or region errors; an ambiguous empty `purl` fails as `PLAYBACK_UNAVAILABLE`.
- Cancellation disconnects active metadata/probe transport and request leases suppress late descriptor publication.

## Deviations from Plan

None - plan executed within its five-file ownership boundary. A null HTTP status-line header is filtered before strict probe parsing so platform header representation cannot bypass or crash the policy.

## Known Stubs

None.

## Next Phase Readiness

Plan 05-05 may register the QQ package and wire the separately owned adapter/capability/player cancellation path. This plan intentionally does not register the package or enable QQ bootstrap in JavaScript.

### Phase 8 Evidence Still Required

- No APK assembly, installation, emulator/API 35 native loading, or audible playback was run here.
- No live QQ account, entitlement, provider, or CDN route was contacted.
- Exact production CDN-host coverage and React Native Track Player redirect/MIME behavior remain unproven and must not be inferred from the deterministic fixture host/probe.

## Self-Check: PASSED

All five owned QQ files and both task commits (`7fa78db`, `ff6f668`) exist; the summary diff is whitespace-clean.
