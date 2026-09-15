# Phase 7 Context: Offline & Advanced Desktop-Equivalent Playback

## Phase Boundary

Phase 7 implements the complete Android functional surface for controlled media resolution, offline ownership, effects, real visualization, loudness normalization, and DeepSeek hardening. The canonical product tree is `mobile/` only. Phase 8 performs the integrated APK/API-35/emulator/live-account/device acceptance run; that verification boundary does not remove any Phase 7 behavior.

## Decisions

- **D-01 — Canonical implementation boundary:** All product changes belong under `mobile/`. Legacy `android/`, Electron, and `app/listen1_chrome_extension/` may be read only as behavior and contract references; Phase 7 does not copy their architecture or write product code there.

- **D-02 — Functional implementation before integrated acceptance:** Executors implement every Phase 7 functional slice first and use focused, fast source/JVM/Jest checks while doing so. They do not build an APK or run an emulator after each plan. Phase 8 owns the single integrated APK/API-35/emulator/live/runtime proof after Phase 7 is functionally complete.

- **D-03 — Cache ownership is caused by user behavior:** Successful real playback creates or updates a temporary-cache owner. Association with a personal playlist creates or updates a playlist-owned cache owner tied to that playlist. Only an explicit user download action creates the durable explicit-download owner. Promotion adds the explicit owner without duplicating media bytes. Removing one owner preserves the file while another owner still requires it.

- **D-04 — Entitlement is revalidated at acquisition and use boundaries:** Native code revalidates provider/account/member/region/DRM entitlement before acquiring bytes and before serving a cached or freshly resolved item at play, login/account-change, quality-change, MV, retry, and resume boundaries. Unknown, expired, or denied entitlement fails closed with a stable actionable status; stale signed URLs are refreshed through the native resolver and never treated as durable authority.

- **D-05 — Quota and eviction contract:** The cache default is 2 GB. User-selectable values are 1 GB, 5 GB, 10 GB, and unlimited. Unlimited is represented across the native/JS/storage boundary by an explicit nullable byte limit (`null`), never by a sentinel number. LRU eviction may remove temporary and playlist-only media, but it never removes an explicit download. Explicit media is deleted only by an explicit user delete/cancel action.

- **D-06 — Native-private media transport:** The JS/player boundary receives a bounded, versioned `MediaDescriptor` containing a safe app-owned playable URI or opaque handle plus truthful MIME/container/codec/duration/rendition/entitlement metadata. Provider signed URLs, provider cookies, caller-selected headers, redirect targets, and CDN candidates remain native-private. Bilibili part and quality selection use currently authorized native-reported choices rather than a hard-coded `qn`. The project keeps minSdk 24: API 26+ may use seekable proxy descriptors, while API 24/25 may play only a complete verified local descriptor and otherwise returns an actionable `download-first`/streaming-unsupported state without exposing a remote URL.

- **D-07 — Effects and visualization are capability-driven and fail open to original audio:** Effects attach only to the actual player audio session through a narrow high-level native API. No global/session-zero audio effect is allowed. Enable/disable/select/reset is exposed only when supported. Any setup, route-change, Bluetooth/headset, player-recreation, or parameter failure releases the effect and preserves original playback. Visualization uses real analyzer frames from that same session; permission denial, background state, low-end policy, or unavailable capability produces a labelled static/hidden state and never fabricated live data.

- **D-08 — Loudness normalization is asynchronous and content-addressed:** Only complete validated media is eligible for analysis. The analyzer targets approximately -14 LUFS and -1 dBTP, stores only bounded metrics keyed by media hash, sample rate, codec, and analyzer version, and invalidates on any identity change. First playback never waits for analysis. Missing, invalid, or failed analysis preserves original gain. Applied normalization is an app-fixed gain independent of device volume and mute.

- **D-09 — DeepSeek secrets and payloads fail closed:** DeepSeek key operations require Android Keystore-backed encryption. If Keystore creation/decryption is unavailable, configure/test/translate fail closed and any legacy plaintext fallback is removed. The raw key, full lyric request payload, and raw model response remain native-private and are absent from Redux/component persistence, WebView storage, logs, crash text, backups, APK assets, and test artifacts. JS receives only bounded status, progress/error classifications, and a schema/alignment-validated translation projection. Consent must name title, artist, full lyrics, possible cost, cancellation, and failure effects; cancel sends no request.

- **D-10 — Verification ownership:** Phase 7 plans prove deterministic contracts with focused unit/contract tests and a final source-level security matrix. Phase 8 owns APK assembly/signature, API-35 emulator journeys, real account/provider/CDN behavior, Doze/process-death/network switching, audio route/codec/effect behavior, full-screen/PiP, and measured performance evidence.

## The Agent's Discretion

- Exact Room table/index/DAO names, provided cache owners, transitions, identity, quota, repair, and backup contracts remain explicit and migration-safe.
- Exact WorkManager unique-work names, tags, notification IDs, and UI component extraction, provided retry/cancel/resume and constraint behavior is deterministic.
- Effect preset names and band values, provided reset has a documented neutral state and capability/failure behavior follows D-07.
- Cache library screen decomposition and navigation placement, provided every search/filter/sort/promote/remove/bulk/clear/quota operation is reachable and tested.

## Deferred Ideas

None. Phase 8 activities listed in D-10 are required acceptance work already assigned by the roadmap, not deferred product functionality.
