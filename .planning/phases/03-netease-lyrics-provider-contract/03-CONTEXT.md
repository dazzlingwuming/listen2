# Phase 3: NetEase Lyrics & Provider Contract - Context

**Gathered:** 2026-08-31
**Status:** Ready for planning
**Source:** User-approved autonomous parity mandate plus codebase assumptions analysis

<domain>
## Phase Boundary

Deliver the smallest complete NetEase listening slice on Android and make lyrics follow the sole native Media3 track and clock. This phase owns typed NetEase search, directory/detail, one provider-authorized default rendition, primary/manual lyrics, provider-neutral lyric persistence, stale-request protection, and accessible phone rendering. Phase 9 retains quality/rendition selection, alternate renditions, advanced CDN policy, part switching, and MV. QQ, Kugou, Kuwo, Migu, and Taihe remain unavailable until their own evidence exists.

</domain>

<decisions>
## Implementation Decisions

### NetEase provider boundary
- **D-01:** Extend the closed v2 WebMessage RPC with separate named NetEase search, directory/detail, default-rendition, and primary-lyric operations. Do not add a generic URL/fetch route or expand the legacy v1 URL bridge.
- **D-02:** Native code constructs final HTTPS requests and validates exact host, path, method, query/body shape, redirects, response size/schema, deadline, cancellation, and one terminal result. The page never supplies a URL, headers, cookies, signing material, or transport candidates.
- **D-03:** Phase 3 owns one authorized default NetEase rendition because NET-004 requires real playback. Native resolves and consumes it through the sole Media3 owner and may refresh only that same default selection. Quality choice, alternate renditions, advanced failover, MV, and part switching remain Phase 9.
- **D-04:** Entitlement, membership, region, DRM, login-required, rate-limit, provider-format, network, timeout, cancellation, and unsupported states remain distinct actionable results. None may be converted to an empty success.
- **D-05:** QQ, Kugou, Kuwo, Migu, and Taihe controls remain unavailable in the capability matrix. The legacy mobile app is a behavior reference only; its old React Native runtime, direct networking, routes, and security assumptions are not copied.

### Native playback and lyric identity
- **D-06:** `PlaybackService`/Media3 remains the only Android audio and clock authority. NetEase audio enters the existing native resolver seam; Android never re-enables page-owned Howler playback.
- **D-07:** The native snapshot adds only a bounded lyric-safe identity: source, provider track/part identity as allowed, opaque occurrence/track handle, selection generation, playback revision, position, duration, and lyric capability/state. It never exposes signed rendition data, cookies, headers, provider bodies, or credentials.
- **D-08:** A lyric reply is accepted only when page epoch, current native track/occurrence, selection generation, playback revision, and lyric request token are current. Track changes, renderer loss, cancellation, timeout, and errors each settle once and cannot overwrite a newer lyric view.
- **D-09:** Active-line timing derives from Media3 position. Publish immediate clock/state changes on play, pause, seek, transition, error, and restore, plus a bounded foreground cadence for ordinary progress; do not persist or announce timer ticks.

### Lyrics behavior and persistence
- **D-10:** Bilibili and NetEase use one provider-neutral lyric model and UI. Automatic primary lyrics never delay audio. Missing, plain-text, insufficient-timestamp, duration/track mismatch, timeout, and provider refusal show an explicit degradation and keep playback usable.
- **D-11:** Manual lyric search and selection are capability-driven rather than Bilibili-ID-gated. A user can select or clear a source, adjust a bounded offset, and retain the choice for the exact provider/track/part/revision.
- **D-12:** Room owns Android lyric selection, revision, offset, match metadata, and bounded validated content using a migration-tested schema and transactional expected-revision writes. Android does not rely on WebView localStorage as the durable source.
- **D-13:** Translation is rendered when supplied by an authorized provider lyric response, but DeepSeek configuration/consent/cost/caching remains Phase 9.

### Phone UX and accessibility
- **D-14:** Player detail exposes original/translation state, source, offset, loading/degraded/error state, manual search/select/clear, and recovery actions using phone-sized panels and 48dp targets. Audio controls remain usable while lyric work is pending or failed.
- **D-15:** TalkBack receives concise polite announcements on lyric state or active-line transitions, not every clock tick. The active line, offset, original/translation mode, controls, empty/degraded state, and errors have explicit accessible names and state.
- **D-16:** System Back closes lyric search/source panels before player detail/app navigation; rotation and renderer recreation restore the current native identity and persisted lyric choice without duplicate requests.

### Evidence and completion
- **D-17:** JVM and frontend tests must cover every RPC schema/policy/projection, cancellation and stale settlement, lyric parsing/timestamp quality, native-clock transitions, persistence/migration/revision conflicts, accessibility markup, and capability-matrix defaults.
- **D-18:** API-35 evidence must bind exact git/APK/device identity and prove the installed app's NetEase search → directory/detail → authorized default rendition → advancing Media3 playback → primary/manual lyric journey, plus pause/seek/track-change/recovery and TalkBack-visible state.
- **D-19:** Fixture evidence cannot complete NET-004. If an entitlement-compliant live NetEase route or authorized test item is unavailable, the live gate stays `BLOCKED`/not verified while deterministic implementation may continue.
- **D-20:** Evidence, Room, snapshots, logs, and backups are scanned to exclude URLs/query strings, signed candidates, headers, cookies, provider bodies, credentials, and personal paths.

### Agent discretion
The planner may choose exact operation names, DTO/class/table names, bounded polling cadence, lyric timestamp-quality thresholds, offset bounds, and panel composition, provided the closed provider boundary, one default rendition scope, sole Media3 clock, stale-response binding, accessibility, persistence, and fail-closed evidence decisions remain intact.

</decisions>

<canonical_refs>
## Canonical References

- `.planning/ROADMAP.md` §Phase 3 and `.planning/REQUIREMENTS.md` — NET-004 and LYR-001..003.
- `.planning/phases/03-netease-lyrics-provider-contract/03-RESEARCH.md` — verified seams, risks, provider matrix, and test strategy.
- `.planning/phases/01-verified-bilibili-startup-slice/01-CONTEXT.md` and `.planning/phases/02-native-media3-playback-background-control/02-CONTEXT.md` — bridge, transport, sole-player, lifecycle, and evidence boundaries.
- `android/app/src/main/java/com/dazzlingwuming/listen2/AndroidRpcContract.java`, `HttpBridgePolicy.java`, `AndroidHttpBridge.java` — typed request and transport boundary.
- `android/app/src/main/java/com/dazzlingwuming/listen2/PlaybackService.java`, `PlaybackSnapshot.java`, and `data/` — Media3 clock, sanitized projection, and Room seam.
- `app/listen1_chrome_extension/js/provider/netease.js`, `lowebutil.js`, `l1_player.js`, `player_thread.js`, `controller/play.js`, and `listen1.html` — desktop behavior and Android adapter/UI integration points.
- Sibling `../listen1_mobile` at the verified v0.8.2 behavior reference — navigation and interaction concepts only, never runtime/network/security source.

</canonical_refs>

<deferred>
## Deferred Ideas

- Quality picker, alternate renditions, advanced CDN failover, MV, effects, loudness, visualization, and DeepSeek translation — Phase 9.
- Provider session/login lifecycle — Phase 5.
- QQ, Kugou, Kuwo, Migu, and Taihe expansion — Phase 7 after independent contract/evidence.
- Download/cache/offline lyric-media ownership — Phase 8.

</deferred>

---

*Phase: 03-netease-lyrics-provider-contract*
*Context gathered: 2026-08-31*
