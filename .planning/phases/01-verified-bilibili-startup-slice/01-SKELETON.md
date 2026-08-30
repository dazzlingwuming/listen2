# Walking Skeleton — Listen2 Android Platform Parity

**Phase:** 1  
**Generated:** 2026-08-30

## Capability Proven End-to-End

On a supported API-35 emulator, an Android user can open the local phone shell, search Bilibili through a typed and cancellable native boundary, choose the intended video part, hear permitted foreground audio progress beyond `0:00`, pause/resume, and enter a truthful primary-lyrics state.

## Architectural Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Framework | Existing Java 17 Android host plus packaged AngularJS/classic-script UI | Reuses the current desktop/browser domain contracts while keeping Android lifecycle and security enforcement native. |
| Network boundary | One origin-scoped AndroidX WebMessage listener with protocol version `2` typed operations | Native code, not page code, owns provider routes, fixed headers, limits, cancellation, and safe response projection. |
| Provider integration | Closed Bilibili operations `bilibili.search`, `bilibili.video.detail`, and `bilibili.audio.manifest` | This is the complete external surface required by the Phase-1 user journey; all other Bilibili capabilities are explicitly decided in `COVERAGE.md`. |
| Request lifecycle | `(pageEpoch, requestId)` identity with explicit cancellation and exactly one terminal settlement | Prevents superseded pages, timeouts, destroyed WebViews, and duplicate replies from mutating current Angular state. |
| Playback | Existing Howler HTML5 foreground player consumes a validated descriptor and ordered CDN candidates | Proves the audible path without creating a competing native player before the sole Media3 owner in Phase 2. |
| Data layer | No new durable data store in Phase 1 | The slice is anonymous and ephemeral; Room/DataStore ownership begins in Phase 2 and credentials remain Phase 5 scope. |
| Authentication | Public anonymous Bilibili access with bounded in-memory `buvid3` bootstrap only | Demonstrates authorized public playback without persisting or exposing session material. |
| UI layout | Existing phone shell at `<=760px`, one vertical scroll region, 64px shell bands, safe-area clearance, 48dp targets | Produces an Android-equivalent phone experience instead of scaling the desktop window layout. |
| Verification target | Debug APK on a supported API-35 AVD plus deterministic JS/JVM/runtime-policy tests | Device WebView, codec, CDN, audio progress, navigation, and lifecycle behavior cannot be proven by fixtures or APK assembly alone. |
| Release target | Reproducible local APK and redacted evidence only | Merge, deployment, production signing material, and parity-ready release claims are outside Phase 1 authorization. |

## Stack Touched in Phase 1

- [x] Existing project scaffold, pinned Java/SDK/Gradle, frontend test runner, and Android JVM tests
- [x] Packaged HTTPS appassets route and safe external-navigation handoff
- [x] Interactive phone UI wired through provider adapter to the native Bilibili boundary
- [x] Native HTTPS request/response path with strict operation and payload policy
- [x] Foreground playback path with observable progress and primary-lyrics entry
- [x] Local API-35 emulator run command and redacted evidence contract
- [ ] Durable database read/write — not used by this anonymous ephemeral slice; Phase 2 owns the first durable playback/data schema
- [ ] Production deployment — not authorized; the executable target is the locally installed APK on the recorded emulator

## Invariants Later Slices Must Preserve

- The shared page never supplies arbitrary provider URLs, methods, headers, cookies, or file handles to native code.
- The WebView receives only bounded, typed, sanitized provider results and playback descriptors.
- A request can finish once; a stale page or duplicate reply can never become current state.
- Provider failures remain explicit and actionable; they are never converted to empty success or an endless loading state.
- Playback ownership becomes solely Media3 in Phase 2; no later phase keeps a second competing player.
- Capabilities remain hidden or truthfully unavailable until their own implementation and device evidence pass.

## Out of Scope (Assigned to Later Slices)

- Phase 2: sole Media3 playback owner, MediaSession service, queue, background, notification, lock-screen, focus, and durable playback state.
- Phase 3: NetEase closed loop and synchronized/manual/translated/accessible lyric behavior.
- Phase 4: durable library, favorites, and playlist editing.
- Phase 5: Bilibili QR login, secure persistent session lifecycle, and authenticated quality selection.
- Phase 6: SAF local music, backup/restore, history, and recap.
- Phase 7: evidence-gated additional provider and Bilibili catalog capabilities.
- Phase 8: cache, download, repair, quota, and offline ownership.
- Phase 9: MV, advanced rendition selection, effects, loudness, and consented DeepSeek translation.
- Phase 10: whole-product accessibility, performance, low-memory, and device hardening.
- Phase 11: release-like build, artifact, redaction, and parity evidence.

## Subsequent Slice Plan

Each later phase adds one verified vertical slice while preserving the typed boundary, truthful capability exposure, single-owner playback direction, and emulator evidence discipline recorded above.

