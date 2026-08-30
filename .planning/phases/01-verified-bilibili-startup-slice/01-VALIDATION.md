---
phase: 01
slug: verified-bilibili-startup-slice
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-30
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

This phase is complete only after deterministic contract/JVM checks and a
timestamped API-35 emulator smoke both pass. A fixture, HTTP 200, generated
descriptor, JVM test, or APK build by itself is not evidence of audible
playback or phase completion. If the live public Bilibili path or a supported
API-35 emulator is unavailable, record the external blocker and leave the
phase not verified.

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node built-in `assert` + `vm` contract harness; JUnit 4.13.2 pure-Java policy tests; API-35 emulator/ADB smoke (manual gate, with a Wave 0 script or instrumentation harness) |
| **Config file** | `app/listen1_chrome_extension/package.json`, `android/app/build.gradle`, and `.github/workflows/android-apk.yml`; no additional test framework or package installation |
| **Quick run command** | `node app/listen1_chrome_extension/test/android_http_bilibili_search.test.js && (cd android && gradle --no-daemon :app:testDebugUnitTest)` |
| **Full suite command** | `npm --prefix app/listen1_chrome_extension test && (cd android && gradle --no-daemon :app:testDebugUnitTest :app:assembleDebug) && "$ANDROID_SDK_ROOT/build-tools/35.0.0/apksigner" verify --verbose android/app/build/outputs/apk/debug/app-debug.apk` |
| **Estimated runtime** | Quick: ≤120 seconds after dependencies are present; full deterministic gate: ~180 seconds, environment-dependent; API-35 live smoke is additional and not CI-replaced |

The quick command is for affected Phase 1 feedback and intentionally excludes
APK assembly and the live provider. The full command combines the repository's
documented frontend test script with the Android workflow's JVM, debug APK, and
signature checks. Before a commit or push, invoke the repository `run-local-ci`
workflow against the exact worktree; its result is separate from the emulator
gate below. No command may use watch mode or turn a failure into success.

## Sampling Rate

- **After every task commit:** Run the Quick run command; include the new W0 fixture in the targeted command once it exists.
- **After every plan wave:** Run the Full suite command, then review changed assets and test output for redaction; do not count the emulator gate as passed from this command.
- **Before `$gsd-verify-work`:** The full deterministic suite must be green and the mandatory API-35 emulator smoke must have a redacted evidence record tied to the tested APK and git SHA.
- **Max feedback latency:** 120 seconds for the quick command (excluding an unavailable or booting emulator).

## Threat References

| Threat Ref | Threat | Required secure behavior |
|------------|--------|--------------------------|
| T-01 | Cross-origin, iframe, non-main-frame, or stale-page bridge spoofing | Accept only the exact HTTPS appassets origin and trusted main-frame source; bind every reply to the request ID and current `pageEpoch`, and drop stale or mismatched messages without Angular state mutation. |
| T-02 | Generic URL proxy or caller-controlled method/header/cookie escalation | v2 accepts only closed operation names and typed bounded payloads; native constructs the final Bilibili route and fixed headers. Reject URL, method, header, cookie, file URI, raw media proxy, and unknown-field inputs. |
| T-03 | Redirect, cleartext, unsafe scheme, or local-file disclosure | Require HTTPS and exact host/path/query policy, disable redirects and cleartext, keep packaged assets inside WebView, and send approved external HTTP(S) navigation to the system handler without credentials. Block `javascript:`, `file:`, `content:`, `intent:`, and untrusted appassets targets. |
| T-04 | Cancellation/timeout/page-destroy race and double terminal settlement | Bound request IDs, queue, body, and deadline; cancellation removes queued work and interrupts active transport where possible. Timeout remains distinct from cancellation, and every request reaches at most one terminal result. |
| T-05 | Provider drift, unauthorized playback, wrong BVID/CID, or expired media | Validate Bilibili status, requested BVID/CID, selected-part identity, duration, permission state, MIME/codec, candidate count, signed-URL shape, and expiry metadata. Never fall back to `pages[0]` for an explicitly missing CID or claim entitlement. |
| T-06 | Oversized/malformed provider data or executable title/lyric/artwork content | Enforce bounded message/body/field sizes and DTO schema before delivery; render text through safe sinks and reject executable HTML/SVG/metadata, prototype-polluting keys, unsafe candidate URLs, and incompatible codecs. |
| T-07 | Offline/TLS/timeout/permission failure hidden as empty success or stuck loading | Map stable provider/native codes to distinct empty, offline/TLS, timeout, malformed, permission/login, unavailable-stream, unsupported-codec, and cancelled states; finalize loading, preserve valid results, and expose one source-specific retry. |
| T-08 | URL-created/Howler-created false playback success or unbounded CDN recovery | Verify audible progress advances beyond `0:00`, pause/resume works, and lyric entry follows the selected track. Limit candidate recovery to the current track/request epoch and do not create a competing native player in Phase 1. |

## Per-Task Verification Map

The task IDs below are the Phase 1 validation handles for the single planned
slice; they identify the behavior that must be covered even while the detailed
implementation plan is being generated. `partial; W0` means an existing test
file covers an older/v1 boundary but the Phase 1 v2 cases are still missing.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 01-01 | 01 | 1 | NET-001 | T-01, T-02, T-03 | Only v2 typed operations from the exact appassets main frame reach native; native owns route/header construction and rejects arbitrary URL/header/cookie/file inputs. | JUnit + JS contract | `node app/listen1_chrome_extension/test/android_http_bilibili_search.test.js && (cd android && gradle --no-daemon :app:testDebugUnitTest)` | partial; W0 v2 cases | ⬜ pending |
| 01-02 | 01 | 1 | NET-002 | T-04 | Bounded request/response and deadline controls, explicit cancel, stale-epoch drop, page-destroy cleanup, and one terminal result per request; timeout is not cancellation. | JS contract + JUnit lifecycle fixtures | `node app/listen1_chrome_extension/test/android_http_bilibili_search.test.js && (cd android && gradle --no-daemon :app:testDebugUnitTest)` | ❌ W0 fixtures | ⬜ pending |
| 01-03 | 01 | 2/3 | NET-003 | T-05, T-07, T-08 | Anonymous, authorized-in-scope Bilibili search → detail/part → validated manifest → audible foreground playback → primary lyric entry; errors remain truthful and recoverable. | JS/provider contract + API-35 emulator E2E | `npm --prefix app/listen1_chrome_extension test` plus the mandatory API-35 smoke record | ❌ W0 detail/manifest fixture and smoke harness | ⬜ pending |
| 01-04 | 01 | 2 | SRCH-001 | T-04, T-07 | Query/provider/page/request identity travels through submit, cancel, and resubmit; rapid input cannot let an old response overwrite current labelled results, and every path finalizes. | JS controller/provider contract + emulator check | `node app/listen1_chrome_extension/test/android_http_bilibili_search.test.js` plus API-35 smoke | partial; W0 epoch/controller cases | ⬜ pending |
| 01-05 | 01 | 2 | SRCH-002 | T-05, T-06 | Directory/detail/pages preserve cursor and explicit CID/part identity across rotation, back, and re-entry; no duplicate append, and cover failure does not block text/playback. | JS provider fixture + emulator check | `node app/listen1_chrome_extension/test/android_http_bilibili_search.test.js` plus API-35 smoke | ❌ W0 detail/pages fixture | ⬜ pending |
| 01-06 | 01 | 2 | SRCH-003 | T-06, T-07 | Every result is source-labelled with title, artist/author, cover, duration, type, and capability state; malformed/offline/permission/partial failures offer a retry without erasing valid rows. | JS contract + emulator check | `npm --prefix app/listen1_chrome_extension test` plus API-35 negative/retry steps | partial; W0 Android error-state cases | ⬜ pending |
| 01-07 | 01 | 1 | SEC-001 | T-01, T-03, T-04 | Bridge checks exact origin, main frame, trusted source, protocol/request identity, and current epoch; unsafe navigation is blocked or delegated safely. | JUnit policy + JS message contract | `(cd android && gradle --no-daemon :app:testDebugUnitTest) && node app/listen1_chrome_extension/test/android_http_bilibili_search.test.js` | partial; W0 current-epoch/navigation cases | ⬜ pending |
| 01-08 | 01 | 1 | SEC-002 | T-03 | Debug and release-like WebView keep file/universal-file access, mixed content, location, and unnecessary windows disabled; provider transport is HTTPS-only, redirect-free, and external links carry no secrets. | JUnit + manifest/config smoke + emulator navigation | `(cd android && gradle --no-daemon :app:testDebugUnitTest :app:assembleDebug) && "$ANDROID_SDK_ROOT/build-tools/35.0.0/apksigner" verify --verbose android/app/build/outputs/apk/debug/app-debug.apk` | partial; W0 release-like/navigation regression | ⬜ pending |
| 01-09 | 01 | 1/2 | SEC-003 | T-02, T-05, T-06 | Operation fields, URL/query, sizes, response DTOs, MIME/codec, metadata, and DOM sinks are allow-listed; hostile provider content cannot execute script, pollute prototypes, leak secrets, or raise bridge privilege. | JUnit + JS hostile-data contract | `node app/listen1_chrome_extension/test/android_http_bilibili_search.test.js && (cd android && gradle --no-daemon :app:testDebugUnitTest)` | ❌ W0 malformed/schema/sink fixtures | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky. A manual/emulator step is
not green until its evidence record is reviewed and tied to the exact build.*

## Wave 0 Requirements

The following gaps are known from the 2026-08-30 research snapshot. They are
dependencies for the mapped tasks, not evidence of completion:

- [ ] Extend `app/listen1_chrome_extension/test/android_http_bilibili_search.test.js` with v2 envelope/operation validation, bounded `requestId` and `pageEpoch`, cancel/resubmit, stale reply, timeout-versus-cancel, and exactly-once terminal settlement cases.
- [ ] Add deterministic Bilibili detail/pages/manifest fixtures (an additional test file is acceptable) covering status/schema, requested BVID/CID, unqualified first-page selection, explicit missing CID → `invalid-part`, duration, MIME/codec, candidate count/shape, expiry metadata, permission, and incompatible-codec errors.
- [ ] Extend `android/app/src/test/java/com/dazzlingwuming/listen2/HttpBridgePolicyTest.java` and, if needed, add a pure-Java DTO/lifecycle test for v2 operation payloads, exact path/query construction, unknown fields, bounded response fields, redirect/oversize/timeout mapping, and terminal uniqueness. Existing tests cover only the current v1/origin and URL policy.
- [ ] Add controller/provider race and terminal-state fixtures for local-first home/search loading finalization, preservation of successful rows, source-specific retry, malformed/offline/permission/unsupported states, and no raw URL/header/cookie/exception text.
- [ ] Add a reproducible API-35 emulator/ADB smoke script or instrumentation harness for WebMessage handshake, cancellation, page destruction, renderer recovery, real audio position advance, pause/resume, lyric entry, and safe external navigation. No attached emulator or such script existed in the research snapshot.
- [ ] Add a redacted evidence template/record location containing date/timezone, APK SHA-256, git SHA, API/image/ABI, WebView version, network, build variant, fixture, commands, timings, screenshots/log excerpts, passed/failed steps, uncovered behavior, and recovery path. Never store credentials, cookies, headers, signed media URLs, or full secret-bearing logs.

No framework installation is required. Until these items exist and pass, keep
`wave_0_complete: false` and keep every mapped requirement pending.

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|-----------|-------------------|
| **Mandatory live API-35 anonymous Bilibili vertical slice** | NET-003, SRCH-001, SRCH-002, SRCH-003 | Only a real API-35 WebView/codec/CDN can prove the packaged page handshake, touch/navigation behavior, audible output, advancing position, and truthful lyric state. JVM/JS fixtures, HTTP 200, descriptor creation, or APK assembly cannot replace this gate. | Start a supported API-35 AVD and record image/ABI, API level, WebView provider/version, network, device, commands, and timestamp. Install the exact debug APK and cold launch. Verify local shell and navigation are interactive before remote work; no unsolicited login probe appears. Submit a public anonymous Bilibili query, cancel and resubmit once, confirm current source-labelled results, open detail/pages, select a part, and verify re-entry/rotation/back do not duplicate rows. Resolve the manifest, perform a user-gesture start, verify audible progress becomes `> 0:00`, pause/resume works, then enter the primary lyric surface and record truthful loading/content/unavailable/error state without delaying audio. Exercise one retry and, where the harness allows, one offline/TLS/permission or malformed-response case; preserve successful rows and ensure loading finalizes. Capture redacted screenshots/log excerpts and timings. If the provider, CDN, codec, or emulator is unavailable, record the external blocker as `BLOCKED`/`not verified`; do not substitute fixture evidence. |
| **Bridge and external-navigation safety on the same API-35 build** | SEC-001, SEC-002, SEC-003, NET-001, NET-002 | Source-origin/main-frame state, WebView settings, Android intent handoff, and absence of secrets in a real page cannot be fully established by pure policy tests. | From the packaged page, verify the bridge is available only at the exact appassets HTTPS origin and current main frame; old-epoch/late replies do not change the visible page. Tap an approved external HTTPS link and confirm it leaves the WebView without token/cookie/header material. Attempt representative `javascript:`, `file:`, `content:`, `intent:`, untrusted appassets, non-HTTPS, redirect, oversized, malformed, unknown-operation, and caller-header/cookie inputs through the harness; each is blocked or maps to a safe structured error. Verify logs/screenshots contain status and bounded identifiers only, never raw URL, signed media URL, cookie, header, credential, or exception text. |

The first row is a hard phase gate. The second row supplements deterministic
policy tests with runtime evidence; neither row is replaced by a debug APK
build or a passing remote workflow.

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or an explicitly tracked Wave 0 dependency
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all missing references listed above
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s for the quick command
- [ ] Deterministic full suite is green on the exact worktree
- [ ] Mandatory timestamped API-35 emulator smoke is green with redacted evidence
- [ ] `nyquist_compliant: true` set in frontmatter only after the preceding evidence exists

**Approval:** pending
