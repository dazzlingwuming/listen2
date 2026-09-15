# Phase 8 Patterns: Acceptance Harness Placement

## Closest Existing Analogs

| New responsibility | Existing analog | Reuse rule |
|---|---|---|
| Release-like Android build | `mobile/android/app/build.gradle` debug/release blocks | Add one explicit development-signed build type; leave formal release unsigned and do not change canonical application code ownership. |
| Full deterministic source gate | `mobile/scripts/verify-phase7-security.mjs`, `mobile/package.json` | Extend by composition; Phase 8 invokes the Phase 7 scanner and adds APK/device evidence without duplicating its source policy. |
| Room upgrade/backup proof | `mobile/android/app/src/androidTest/java/com/listen2mobile/library/LibraryMigrationTest.kt`, `BackupTransactionInstrumentationTest.kt` | Use the real database and data-preserving install upgrade; no destructive migration or fake success. |
| SAF/local proof | `SafImportInstrumentationTest.kt`, `LocalMediaProviderInstrumentationTest.kt` | Drive `ACTION_OPEN_DOCUMENT` with a generated fixture and verify persisted grant/playback/restart/removal behavior. |
| History proof | `ListeningLedgerInstrumentationTest.kt` | Verify no duplicate history across pause/seek/network/process recovery and the genuine-listen threshold. |
| Provider journey | `mobile/src/screens/SearchScreen.tsx`, `BilibiliDetailScreen.tsx`, `PlayerScreen.tsx` | Drive production accessibility labels and semantic state; never add a hidden mock provider or URL/header override. |
| Background playback | `mobile/src/player/playerController.ts`, `playbackService.ts` | Observe the sole RNTP MediaSession through Android system state and advancing position. |
| Cache/offline proof | `mobile/android/app/src/main/java/com/listen2mobile/offline/`, `mobile/src/screens/CacheLibraryScreen.tsx` | Exercise only complete verified entries, owner/quota semantics, offline hit, repair/remove, and process recovery. |
| MV/effects/loudness proof | `bilibili/BilibiliMv*`, `audiofx/*`, `BilibiliMvScreen.tsx`, `PlayerScreen.tsx` | Assert capability first, then real device behavior; unsupported/denied paths retain audio and record an actionable state. |
| DeepSeek privacy proof | `deepseek/*`, `DeepSeekConsentSheet.tsx`, `SettingsScreen.tsx` | Verify no-key/cancel deterministically; use an optional out-of-repo user key only for a separate live result. |
| Toolchain preflight | `mobile/package-lock.json`, `mobile/android/gradlew`, root Android Gradle versions | Resolve JDK/SDK portably, verify cache/locks first, and stop `BLOCKED` instead of mutating missing acceptance inputs. |

## New Test/Harness Placement

- Machine-readable schema and orchestration: `mobile/scripts/acceptance/`.
- Device instrumentation: `mobile/android/app/src/androidTest/java/com/listen2mobile/acceptance/`.
- Sanitized fixture manifest: `mobile/scripts/acceptance/fixtures/phase08.json`.
- Runtime evidence: `.planning/phases/08-integrated-api-35-acceptance-release-like-evidence/evidence/<runId>/`; every JSON/log/screenshot/dump and copied build input belongs to this one canonical realpath.
- Final human-readable decision: `.planning/phases/08-integrated-api-35-acceptance-release-like-evidence/08-ACCEPTANCE.md`.
- Installable handoff copy: ignored `dist/android/`; never commit APK bytes or signing material.

## Guardrails

- Harness scripts are non-interactive, bounded, `set -euo pipefail`, accept explicit serial/AVD/artifact arguments, and install cleanup traps before device mutation.
- AVD helpers use the exact API 26/35/36 Google APIs image and host ABI, reject absent images as `BLOCKED`, verify the returned serial, and remove only AVDs bearing the current run-created marker.
- Tests select nodes by stable accessibility labels/resource IDs and validate state, not screenshot pixels or guessed coordinates.
- Retained logs are allow-listed and sanitized before writing; raw `logcat`, provider bodies, URLs, cookies, keys, local document names, and user media never enter evidence.
- Evidence writers reject unknown fields, duplicate command IDs, impossible time ordering, missing artifact hashes, unrecognized terminal states, requirements not present in `REQUIREMENTS.md`, and any absolute/parent/symlink/cross-run path.
- Host automation has no credential channel. User credentials can enter only through visible in-app controls backed by native secure storage; absent credentials remain `NOT_VERIFIED`.
- A `DEGRADED` or `NOT_VERIFIED` feature remains visible in the report but cannot satisfy its requirement or the parity-ready gate.
