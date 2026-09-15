# Phase 5: Five-Source Listen Journey — Canonical Context

**Corrected:** 2026-09-15
**Status:** planning baseline corrected; no Phase-5 implementation plan is created here.

## Canonical implementation boundary

Phase 5 targets the independent mobile application under `mobile/`: React Native 0.87 UI, Kotlin native modules, and `react-native-track-player` (RNTP) for native playback and system integration. All new product work, tests, and implementation references for this phase must stay on that route.

`android/` and `app/listen1_chrome_extension/` are historical/reference-only material. They may be read to understand prior behavior, data vocabulary, or regressions, but are not Phase-5 write targets, runtime targets, or acceptance evidence. The previous WebView/Angular plans are preserved verbatim in `legacy-webview-plans/` for traceability and must not be executed as current plans.

## Product outcome

One phone journey must truthfully support the ordered source surface `netease`, `kugou`, `kuwo`, `qq`, `bilibili`: source-labelled search, valid detail/part selection where the source capability permits it, playback through the native RNTP path, and lyrics that remain tied to the selected occurrence. A visible source is never evidence that every operation is available.

The user must retain successful rows, the selected source, query/detail context, and current playback when another operation fails. Empty, unsupported, login-required, permission/authorization, timeout/cancelled, malformed-response, and offline states must remain distinct and give a safe next action.

## Confirmed mobile baseline

The following completed quick-task slices are reusable `mobile/` baseline, not proof that Phase 5 or device acceptance is complete:

| Record | Reusable baseline |
| --- | --- |
| `g8n` | bounded offline download/cache and cache-first playback path |
| `jlv` | bounded Discover collections and detail/playback navigation |
| `f3q` | Bilibili QR session, account/part flow, native audio resolution and recovery contracts |
| `h1s` | consented DeepSeek lyric translation boundary and cache identity |
| `iuc` | Bilibili lyric candidates, manual picker, cancellation/race protection and persistence path |
| `kh4` | native Bilibili MV semantic/lifecycle flow |

These slices must be integrated without silently widening provider authority, accepting arbitrary URLs/headers/cookies, or using a WebView/desktop fallback.

## Actual Phase-5 gaps

### A. Per-source search and detail restoration

- Restore source-specific search, directory/detail and selection behavior only where a bounded approved `mobile/` route and normalized schema exist.
- Project per-operation capability truth: search does not imply discover, detail, playback, lyrics, login, download, or MV.
- Preserve populated results on later-page cancellation/failure; provide retry or the exact safe recovery action, and do not collapse provider errors into “no results.”
- Keep source identity, cursor, selected part/track, query and scroll/restoration state stable across navigation and late responses.

### B. Player and occurrence-safe queue UX

- Surface seek, volume, mute, previous/next, play/pause and play-mode actions through the one RNTP/controller path.
- Provide queue UI for FIFO play-next occurrences, including duplicate tracks, reorder, remove, clear and restore semantics.
- A queue operation is committed only after its native/player transaction succeeds; failed resolution leaves the current occurrence and visible queue truthful.

### C. Lyrics as occurrence/revision state

- Bind lyric projection, candidate selection and persistence to the active provider/track/part occurrence and revision, using the native playback clock.
- Generalize manual selection and bounded offset editing where a source supports them; user choice wins over automatic selection for the exact identity/revision.
- Show fallback/provider provenance, translation state and meaningful terminal/retry actions without blocking playback.
- Add TalkBack-readable original/translation/current-line/offset semantics without announcing every position tick.

## Security and lifecycle constraints

- Kotlin/native modules own provider credentials, signed media and network policy; JavaScript receives only normalized safe DTOs and semantic commands.
- Do not expose arbitrary URL, caller-supplied headers, cookies, signing data, or generic native JavaScript execution.
- RNTP/native playback remains the sole system playback owner. Preserve audio-focus, noisy-route, notification, lock-screen, headset/Bluetooth and process/lifecycle contracts for later runtime proof.
- Treat live-provider behavior, entitlement, CDN/MIME/codec variation and account state as external inputs; failure must be visible and non-destructive.

## Phase boundary with Phase 8

Phase 5 defines and proves deterministic mobile contracts and UI behavior with focused tests. Phase 8 retains integrated APK assembly/install, API 35 emulator acceptance, live-provider/API behavior, system playback runtime (notification, lock screen, audio focus, headset/Bluetooth, background/restart/process recovery), accessibility runtime, and performance evidence. Passing unit tests or TypeScript checks does not replace Phase-8 evidence.
