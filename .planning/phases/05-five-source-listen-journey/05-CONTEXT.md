# Phase 5: Five-Source Listen Journey - Context

**Gathered:** 2026-09-10
**Status:** Ready for planning
**Mode:** Autonomous decisions accepted by the user on 2026-09-10

<domain>
## Phase Boundary

Deliver one coherent phone journey for NetEase, Kugou, Kuwo, QQ, and Bilibili from source-labelled search through directory/detail selection, authorized Media3 playback and synchronized lyrics. This phase completes deterministic provider, player, queue, lyric, and error contracts; Phase 8 owns integrated API 35 device and live-provider acceptance.

</domain>

<decisions>
## Implementation Decisions

### Five-source product contract
- Preserve the exact Android primary order `netease`, `kugou`, `kuwo`, `qq`, `bilibili`; Migu and Taihe remain registry-only unavailable.
- Use the original author's `listen1/listen1_mobile` v0.8.2 as the interaction and normalized-provider-contract reference. Use current desktop `main` and the existing Android architecture as capability and implementation authority.
- Carry one source-prefixed semantic identity from search rows through directory/detail selection, queue occurrences, playback preparation, lyric lookup, error recovery, and restored state. Never infer a source from a title, URL, or row position.
- Keep successful rows and the current user context when one source, page, artwork, directory, media, or lyric request fails. Empty, partial, login-required, unsupported, timeout, malformed-response, and authorization failures are distinct terminal states.

### Capability truth and provider rollout
- Bilibili and NetEase are reusable foundations, not completed Phase-5 claims. Regression-prove their full search-to-lyric paths before enabling additional fields.
- QQ, Kugou, and Kuwo currently have desktop/browser adapters but no approved Android semantic routes. Their search, directory/detail, media, lyric, login, and fallback fields remain false until each field has a bounded native route and fixture/schema evidence.
- Enable capability fields independently. Search support never implies directory, playback, lyrics, or login support.
- Do not route Android through legacy direct Axios, cleartext endpoints, caller-provided cookies/headers, arbitrary URLs, opaque signing material, or browser CORS workarounds.
- A provider slice stops fail-closed if it requires permission bypass, unapproved credentials, generic transport exposure, or cannot produce a bounded normalized response. The UI keeps the precise capability unavailable with a safe next action.

### Search, directory, and detail lifecycle
- Reuse the Phase-4 semantic lifecycle for search, directory, media, lyric, and login. Source/query/page/epoch changes, cancellation, Back, timeout, renderer destruction, and late replies settle the active operation exactly once.
- Normalize search and directory rows to source, semantic identity, title, artist/author, artwork, duration, result kind, playable/login/unsupported state, and safe reason. Provider-only metadata stays native or inside its adapter.
- Directory/detail navigation preserves source, cursor, selected part/track, scroll context, and valid prior rows across rotation or a recoverable failure; it never appends a duplicate page after restoration.
- Bilibili details retain base video identity plus validated part/CID selection. Other providers retain provider-native album/playlist/track identity without exposing a transport URL.

### Media3, queue, and system controls
- `PlaybackService` remains the sole ExoPlayer/MediaSession/queue owner. The WebView sends semantic track/part and queue intents and renders native snapshots; Howler is not an Android fallback.
- Add a resolver only after the provider's normalized media contract proves real MIME/container/codec/duration, entitlement, expiry, and bounded candidate recovery. Never route an unknown provider through the Bilibili resolver.
- Reuse native occurrence identity, FIFO play-next, duplicate entries, reorder/removal, shuffle, repeat, previous-history, checkpoint, audio-focus, noisy/headset/Bluetooth, notification, and lock-screen behavior across mixed-source fixtures.
- A media failure retains the current track and queue occurrence, exposes retry or the truthful next action, and never consumes another queue item merely because resolution failed.

### Lyrics and translation projection
- Lyrics are keyed to current provider/track/part/revision and use the Media3 clock. A provider reply or fallback is accepted only when current identity, duration/match policy, epoch, and source attribution still match.
- Preserve existing Bilibili/NetEase candidate, manual selection, offset, translation, persistence, and stale-reply contracts; extend capabilities source by source only where a bounded route exists.
- Missing lyrics, plain text, insufficient timestamps, mismatch, timeout, login-required, and unsupported are visible degradations and never block first playback.
- Old-track text, guessed timestamps, or an unattributed cross-provider lyric must never replace the active track's lyric state.

### Verification cadence
- Implement in cohesive slices and use focused JavaScript/JVM/fixture tests while coding. Do not assemble an APK after each capability.
- Each provider fixture must include success, empty, malformed, timeout/cancel, authorization/unsupported, stale reply, and bounded payload cases before its capability becomes true.
- Phase 5 proves deterministic five-source contracts and mixed-source playback/lyric behavior. Phase 8 retains real API 35 WebView, IME, rotation, TalkBack, codec, notification/lock-screen/audio-focus, renderer/process recovery, performance, and live-provider acceptance.

### the agent's Discretion
- Exact Java class split, adapter helper names, fixture organization, and mobile row/detail presentation may follow established project patterns when the boundaries and observable states above remain intact.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `app/listen1_chrome_extension/js/mobile_provider_registry.js`, `js/loweb.js`, and `js/controller/instant_search.js` already provide the ordered registry, capability projection, and semantic request lifecycle.
- `js/provider/bilibili.js`, `netease.js`, `qq.js`, `kugou.js`, and `kuwo.js` contain current desktop normalization and provider behavior clues; only approved typed Android paths may be reused at runtime.
- `AndroidRpcContract.java`, `AndroidHttpBridge.java`, `ProviderCapabilityFacade.java`, `NetEaseNativeProvider.java`, `BilibiliDirectoryProvider.java`, and the existing playback/lyric providers are the closest native boundary patterns.
- `PlaybackService.java`, `PlaybackCoordinator.java`, `PlaybackQueueEngine.java`, `PlaybackBridgePolicy.java`, and Room checkpoints already own native playback, duplicate queue occurrences, shuffle/repeat/history, recovery, and projection.
- `BilibiliLyricProvider.java`, `LyricClockProjection.java`, `LyricPersistencePort.java`, and Phase-3 frontend adapters already establish identity-safe lyric state.

### Confirmed Gaps
- `ProviderCapabilityFacade` and `AndroidRpcContract` currently expose provider operations only for Bilibili and NetEase; QQ, Kugou, and Kuwo remain unavailable.
- `PlaybackBridgePolicy` and `l1_player.js` accept only the current Bilibili, NetEase, and local identity families; `PlaybackService` has no safe resolver selection for QQ, Kugou, or Kuwo.
- Desktop QQ/Kugou/Kuwo providers include browser transport assumptions that cannot cross the hardened Android boundary unchanged.
- Live provider routes, entitlement behavior, CDN/codec constraints, lyric availability, and rate limits are external and must remain explicitly not verified until Phase-8 evidence.

### Integration Points
- Capability fields flow from `ProviderCapabilityFacade` through the typed handshake into `mobile_provider_registry.js`, `loweb.js`, and the mobile selector/actions.
- Search and directory/detail operations cross the semantic lifecycle, `AndroidRpcContract`, native provider clients/mappers, and normalized frontend DTOs.
- Playback preparation crosses `l1_player.js`, `PlaybackBridgePolicy`, `PlaybackService`, provider-specific media resolvers, Media3, and native snapshot projection.
- Lyrics cross provider-specific lookup, persistence/revision policy, service clock projection, and the shared playback UI.

</code_context>

<specifics>
## Specific Ideas

- The user wants the whole functional blueprint implemented before a repeated APK inspection loop.
- The product must behave like the original author's mobile app while retaining the newest desktop capabilities and the modern Android security/lifecycle architecture.
- A visible provider tab is not considered implemented unless every enabled action produces real normalized data or a truthful actionable terminal state.

</specifics>

<deferred>
## Deferred Ideas

- Provider account/session management and Bilibili QR lifecycle are completed in Phase 6, though Phase 5 must represent login-required and entitlement states truthfully.
- Offline/download/cache and advanced MV/effects/loudness completion belong to Phase 7.
- Integrated APK, API 35 emulator, live-provider/credential runs, system-control/device lifecycle, accessibility, performance, and release-like evidence belong to Phase 8.

</deferred>
