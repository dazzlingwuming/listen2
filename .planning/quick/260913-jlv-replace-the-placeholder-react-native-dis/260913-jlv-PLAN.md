---
phase: quick-260913-jlv-react-native-discover
plan: "01"
type: execute
wave: 1
depends_on: []
files_modified:
  - mobile/src/types/provider.ts
  - mobile/src/api/ids.ts
  - mobile/src/api/providers.ts
  - mobile/src/api/client.ts
  - mobile/src/api/__tests__/client.test.ts
  - mobile/src/screens/DiscoverScreen.tsx
  - mobile/src/screens/PlaylistDetailScreen.tsx
  - mobile/src/screens/__tests__/discoverFlow.test.tsx
  - mobile/src/player/playerController.ts
  - mobile/src/player/__tests__/playerController.rollback.test.ts
autonomous: true
requirements:
  - QUICK-DISCOVER-001
estimate:
  tokens: 56000
  raw_tokens: 56000
  tasks: 3
  confidence: low
must_haves:
  truths:
    - "A mobile user can switch Discover between NetEase and Kugou, refresh real provider-owned sections, and see loading, refreshing-with-stale-content, empty, per-section unavailable/error, and retry states without raw provider text."
    - "NetEase Discover shows at most 12 real featured playlists and 12 real charts; every card carries an exact neplaylist_ semantic ID and opens a bounded detail whose returned order and completeness are truthful."
    - "Kugou Discover shows at most 12 real charts, each using a distinct kgchart_ semantic ID and a bounded paginated detail; curated Kugou playlists remain explicitly unavailable because no verified JSON detail route exists."
    - "All discovery and detail traffic uses adapter-owned fixed HTTPS hosts/routes through requestJson, with capped responses, items, pages, batches, concurrency, timeouts, and cancellation; UI cannot supply a URL, header, cookie, token, provider page, or transport option."
    - "An incomplete remote detail remains visibly partial and cannot use play-all; a complete detail navigates to Player only after the first track resolves and TrackPlayer loads successfully, while failure rolls native playback back to the prior item, media descriptor, position, repeat/volume and play/pause state and leaves durable queue/current/history/play-next state unchanged."
    - "Existing Search behavior and existing NetEase playlist navigation remain compatible, external response drift fails visibly, and only canonical mobile/ TypeScript/Jest files change."
  artifacts:
    - path: "mobile/src/types/provider.ts"
      provides: "Transport-free discovery section contract, discovery operation, and truthful remote-detail completeness metadata"
      contains: "DiscoverPage"
    - path: "mobile/src/api/providers.ts"
      provides: "Fixed bounded NetEase featured/chart/detail and Kugou chart/detail adapters"
      contains: "getNetEaseDiscover"
    - path: "mobile/src/api/client.ts"
      provides: "Capability-gated getDiscover and semantic remote-collection dispatch"
      contains: "getDiscover"
    - path: "mobile/src/api/ids.ts"
      provides: "Exact kgchart_ resolver without treating a chart as a curated playlist"
      contains: "kgchart_"
    - path: "mobile/src/screens/DiscoverScreen.tsx"
      provides: "Provider filters, request lifecycle, accessible collection cards, refresh, and safe section states"
      contains: "DiscoverScreen"
    - path: "mobile/src/screens/PlaylistDetailScreen.tsx"
      provides: "Truthful complete/partial remote detail and success-gated play-all navigation"
      contains: "remoteDetail"
    - path: "mobile/src/screens/__tests__/discoverFlow.test.tsx"
      provides: "Focused UI contract for the real directory-to-detail path and all lifecycle states"
      contains: "describe"
    - path: "mobile/src/player/playerController.ts"
      provides: "Boolean transactional playTracks completion result"
      contains: "async playTracks"
    - path: "mobile/src/api/__tests__/client.test.ts"
      provides: "Provider boundary tests for fixed routes, mapping, bounds, partials, drift, and closed legacy paths"
      contains: "providerClient"
    - path: "mobile/src/player/__tests__/playerController.rollback.test.ts"
      provides: "Focused native call-order and durable-state tests for successful collection start, playing/paused rollback, and rollback failure"
      contains: "collection playback rollback"
  key_links:
    - from: "mobile/src/screens/DiscoverScreen.tsx"
      to: "mobile/src/api/client.ts"
      via: "an epoch-scoped AbortController calls providerClient.getDiscover with only netease or kugou"
      pattern: "getDiscover|AbortController"
    - from: "mobile/src/api/client.ts"
      to: "mobile/src/api/providers.ts"
      via: "capability dispatch selects only fixed NetEase or Kugou discovery/detail adapters"
      pattern: "getNetEaseDiscover|getKugouDiscover|getKugouChart"
    - from: "mobile/src/api/providers.ts"
      to: "mobile/src/api/http.ts"
      via: "every remote JSON request is built inside the adapter and passed to requestJson with abort/timeout options"
      pattern: "requestJson"
    - from: "mobile/src/screens/DiscoverScreen.tsx"
      to: "mobile/src/navigation/types.ts"
      via: "card presses navigate to PlaylistDetail with sourceId, title, and semantic remotePlaylistId only"
      pattern: "PlaylistDetail|remotePlaylistId"
    - from: "mobile/src/screens/PlaylistDetailScreen.tsx"
      to: "mobile/src/player/playerController.ts"
      via: "the playTracks thunk resolves to true only after native first-track load and queue replacement, and navigation consumes that result"
      pattern: "playTracks|navigate\('Player'"
    - from: "mobile/src/player/playerController.ts"
      to: "react-native-track-player"
      via: "playTracks captures a bounded in-memory native snapshot before reset and restores reset/add/repeat/volume/seek/play-or-pause order if the replacement load fails"
      pattern: "getActiveTrack|getProgress|getPlaybackState|restore"
---

<objective>
Replace the static React Native Discover surface with real, bounded NetEase featured-playlist/chart discovery and Kugou chart discovery, then carry semantic collection identities through truthful remote detail and transactional play-all.

Purpose: Let Android users browse provider-owned collections and start a collection confidently without importing the original author's insecure legacy transport, inventing Kugou playlist content, hiding upstream truncation, or losing the currently playing native item when a replacement fails.
Output: Typed discovery/detail contracts, fixed provider adapters and semantic dispatch, an accessible refreshable Discover screen, bounded remote-detail completeness UI, rollback-safe transactional Player navigation, and focused Jest/TypeScript/lint/format/Metro evidence.
</objective>

<execution_context>
@/Users/fluenteng/.codex/gsd-core/workflows/execute-plan.md
@/Users/fluenteng/.codex/gsd-core/templates/summary.md
</execution_context>

<execution_gate>
Use the existing mobile/node_modules only. Do not run npm install/update, repository-wide CI or tests, Gradle, APK assembly, install/run-android, an emulator/device, push, merge, or deploy in this source loop. Run only the focused TypeScript/Jest/scoped ESLint/Prettier/Metro commands named below. Preserve every existing tracked or untracked file outside the listed mobile/ paths, including legacy android/ and app/listen1_chrome_extension/ sources used only as behavioral references.
</execution_gate>

<context>
@AGENTS.md
@.planning/STATE.md
@.planning/quick/260913-jlv-replace-the-placeholder-react-native-dis/260913-jlv-RESEARCH.md
@mobile/README.md
@mobile/package.json
@mobile/src/types/provider.ts
@mobile/src/api/http.ts
@mobile/src/api/errors.ts
@mobile/src/api/ids.ts
@mobile/src/api/providers.ts
@mobile/src/api/client.ts
@mobile/src/navigation/types.ts
@mobile/src/screens/DiscoverScreen.tsx
@mobile/src/screens/SearchScreen.tsx
@mobile/src/screens/PlaylistDetailScreen.tsx
@mobile/src/player/playerController.ts
@mobile/src/store/playerSlice.ts
@mobile/src/api/__tests__/client.test.ts
@mobile/src/player/__tests__/playerController.test.ts
@app/listen1_chrome_extension/js/provider/netease.js
@app/listen1_chrome_extension/js/provider/kugou.js
</context>

<locked_decisions source="approved quick-task research">
- D-01: NetEase provides real featured playlists plus charts and bounded detail; when embedded tracks are incomplete, hydrate returned semantic track IDs through fixed batches while reporting any upstream/bounded incompleteness honestly.
- D-02: Kugou provides real charts and bounded paginated chart detail only; curated playlist detail is unproven HTML and remains explicitly unavailable rather than scraped, sampled, or fabricated.
- D-03: All traffic uses fixed HTTPS provider routes with bounded bodies, pages, items, batches, concurrency, timeout, cancellation, exact semantic IDs, and exact-host artwork normalization; callers never supply URLs, headers, cookies, tokens, provider pages, or credentials.
- D-04: Discover exposes NetEase/Kugou provider filters, loading, refresh, empty, per-section unavailable/error/retry states, accessible mobile cards, and semantic remote-detail navigation.
- D-05: Play-all is transactional and enters Player only after the first item resolves and native load succeeds; incomplete detail disables play-all, and a destructive native-load failure restores the prior native media descriptor/position/repeat/volume/play-pause state while durable playlist/current/history/play-next state remains unchanged. Rollback failure exposes only a fixed bounded recovery code and reconciles isPlaying safely.
- D-06: Preserve Search and existing NetEase playlist behavior, surface external drift as a diagnostic failure, modify canonical mobile/ only, and validate with focused TypeScript/Jest/scoped lint/Prettier/Metro without an APK/emulator/repository-wide CI loop or dependency install.
</locked_decisions>

<interfaces>
Existing contracts to preserve:
- mobile/src/api/http.ts exports requestJson(FixedRequest, SourceId, ProviderOperation, ProviderRequestOptions). FixedRequest accepts only adapter-created url, optional GET/POST body, and an internal bilibili/qq profile; requestJson caps timeout at 10 seconds, response text at 1 MiB, propagates AbortSignal, and exposes stable ProviderClientError codes.
- mobile/src/types/provider.ts defines PlaylistSummary as a semantic non-playable collection identity and PlaylistDetail as a semantic collection plus normalized Track rows. ProviderOperation currently has search, playlist, bootstrap, and lyric.
- mobile/src/api/client.ts owns PROVIDER_CAPABILITIES and providerClient.search/getPlaylist/bootstrapTrack/getLyric. Screens receive semantic data and never construct provider transport.
- mobile/src/navigation/types.ts already carries PlaylistDetail {sourceId, title, remotePlaylistId}; remotePlaylistId is explicitly semantic and never a URL, so no new navigation route is required.
- mobile/src/screens/SearchScreen.tsx demonstrates the required AbortController plus monotonically increasing request-epoch pattern and already navigates NetEase playlist summaries to PlaylistDetail. Its query, pagination, source, and playlist-search behavior must remain unchanged.
- mobile/src/player/playerController.ts playTracks resolves and loads the first track before replacePlaylist and recordRecent, but currently returns no success value and reset/add can destroy the prior native item before failure is known. mobile/src/store/playerSlice.ts already returns the controller promise from its playTracks thunk.

New closed contracts created by this plan:
- ProviderOperation adds discover. DiscoverSource is exactly netease or kugou. DiscoverSection is a discriminated union keyed by featured or charts: ready carries bounded PlaylistSummary rows; error carries only a stable ProviderErrorCode plus retryable; unavailable carries only the fixed reason unverified-route. DiscoverPage carries source and its ordered sections.
- providerClient.getDiscover(source, options?) accepts only DiscoverSource plus ProviderRequestOptions. PROVIDER_CAPABILITIES exposes discovery independently from playlistSearch and remote detail.
- NetEase featured playlists and charts both retain neplaylist_ IDs because both use the same checked NetEase detail adapter. Kugou charts use new ^kgchart_[1-9][0-9]{0,17}$ identities; legacy kgplaylist_ identities remain unavailable and never dispatch to chart detail.
- PlaylistDetail adds completeness: complete or partial and declaredTrackCount. complete is true only when every ID in the accepted bounded provider set maps to a returned track and the declared collection does not exceed that set; any cap, missing song, duplicate/malformed provider row, or count mismatch is represented as partial or a typed invalid response, never silently renamed complete.
- playerController.playTracks and the existing Redux thunk resolve Promise<boolean>: true only after first-track native load, replacePlaylist, and recordRecent; false for no target, resolution failure, native load failure, or rollback failure.
- Immediately before playTracks performs its first destructive reset, a function-local NativeRollbackSnapshot captures the current semantic PlayableTrack, a cloned and bounded native URL/headers descriptor from TrackPlayer.getActiveTrack, current position from getProgress, durable repeat/volume/mute settings, and native playing-versus-paused state from getPlaybackState. The snapshot is never dispatched, persisted, logged, returned, or retained after that one transition.
- A failed replacement restores the old native item in reset, add, repeat, volume, seek, then play-or-pause order and returns false with the original durable playlist/current/history/play-next values intact. A rollback failure emits only playback-recovery-required, sets Redux isPlaying=false, performs a best-effort native pause, and never includes a URL, header, provider body, or exception string in state.
</interfaces>

<tasks>

<task type="tracer" tdd="true">
  <name>Task 1: Open one real NetEase featured collection from Discover</name>
  <files>mobile/src/types/provider.ts, mobile/src/api/providers.ts, mobile/src/api/client.ts, mobile/src/screens/DiscoverScreen.tsx, mobile/src/screens/__tests__/discoverFlow.test.tsx</files>
  <behavior>
    - D-01/D-03: Initial NetEase Discover calls only https://music.163.com/api/playlist/list with cat=全部, order=hot, limit=12, offset=0, and total=true through requestJson; it accepts code 200, maps no more than 12 checked rows to neplaylist_ summaries, and rejects oversized/all-invalid drift.
    - D-03/D-04: The screen passes only source plus AbortSignal into getDiscover; a ready card press navigates with sourceId, bounded title, and semantic remotePlaylistId and never exposes the route URL or provider response.
    - D-04: NetEase and Kugou are the only 48dp provider filters; initial load, selection, safe image/icon fallback, title/author/count fallback, and provider-inclusive accessibility labels render without altering the Search tab.
    - D-02: Until its proven chart adapter participates, Kugou resolves through the same typed facade to an explicit unverified-route section and performs no network fallback.
  </behavior>
  <action>Write discoverFlow.test.tsx first with react-test-renderer, deterministic fetch responses, and mocked navigation; its tracer case must mount DiscoverScreen, observe the exact fixed NetEase featured request, press a mapped card, and assert the semantic PlaylistDetail parameters. In provider.ts, add the discover operation and discriminated DiscoverSource/DiscoverSection/DiscoverPage screen-facing types without transport fields. In providers.ts, add getNetEaseDiscover's featured-section mapper using the existing asObject, text, positive, safeArtwork, requestJson, and ProviderClientError patterns; accept a structurally valid empty list as ready-empty, but classify a non-empty all-invalid list, excess rows, non-200 provider code, malformed root, transport failure, and cancellation distinctly. In client.ts, add the discovery capability and getDiscover dispatch; it may dispatch only NetEase/Kugou and must project unsupported/unverified sections without calling fetch. Replace DiscoverScreen's static recommendations/topics with an epoch-scoped effect, a two-source accessible filter, and vertically scrollable ready cards while retaining the existing Search shortcut. The first slice intentionally proves exactly one data-producing path—NetEase featured directory to existing remote detail—and gives every other section a closed typed state that Task 2 can expand without changing the UI/facade architecture. Implement D-01, D-02, D-03, D-04, and D-06.</action>
  <verify>
    <automated>npm --prefix mobile test -- --runInBand src/screens/__tests__/discoverFlow.test.tsx -t 'loads NetEase featured collections and opens semantic detail'</automated>
  </verify>
  <done>A focused Jest tracer proves a real fixed NetEase featured response becomes an accessible Discover card and opens the existing PlaylistDetail route with neplaylist_ identity only; the screen has no endpoint/header/cookie/token input, Kugou cannot fall through to transport, and Search files/behavior are unchanged.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Expand to NetEase charts/full bounded hydration and Kugou paginated charts</name>
  <reversibility rating="costly">The kgchart_ grammar and remote-detail completeness fields become shared API/navigation/UI contracts, so undoing them requires coordinated provider, screen, and fixture changes.</reversibility>
  <files>mobile/src/types/provider.ts, mobile/src/api/ids.ts, mobile/src/api/providers.ts, mobile/src/api/client.ts, mobile/src/api/__tests__/client.test.ts</files>
  <behavior>
    - D-01: NetEase charts come only from https://music.163.com/api/toplist, retain at most 12 valid rows, and use neplaylist_ IDs; failure of featured or charts yields that section's stable error while a successful sibling section remains usable.
    - D-01/D-03: NetEase detail validates id echo/code/title/trackIds, accepts at most 1,000 IDs, hydrates only those IDs through https://music.163.com/api/v3/song/detail in ordered 50-ID batches with at most three active requests, and returns tracks in original trackIds order.
    - D-01: NetEase completeness is partial when the declared count exceeds the 1,000-item cap or any accepted ID lacks one valid hydrated song; malformed roots/IDs/batches or provider/transport drift remain typed failures rather than empty success.
    - D-02/D-03: Kugou charts come only from https://m.kugou.com/rank/list?json=true, retain at most 12 checked rows, and map positive rankid to kgchart_; curated kgplaylist_ and any HTML/non-JSON response remain route-unavailable without another request.
    - D-02/D-03: Kugou detail constructs https://m.kugou.com/rank/info/?rankid=&lt;checked-id&gt;&amp;page=&lt;internal-page&gt;&amp;json=true only, validates total/pagesize/page rows, requests no more than 40 pages with at most three active requests, returns no more than 1,000 unique checked tracks in page order, and marks bounded/missing content partial.
    - D-03: Kugou artwork substitutes 400 only for the {size} token and upgrades only exact imge.kugou.com HTTP/HTTPS candidates after rejecting credentials, ports, fragments, control text, or other hosts; it never performs a general scheme rewrite.
    - D-06: Existing search URLs, result mappings, playlistSearch restrictions, NetEase IDs, and bootstrap/lyric behavior remain covered by the full focused client suite.
  </behavior>
  <action>Extend client.test.ts first with queued fetch fixtures that assert exact URLs and request counts for NetEase featured/toplist/detail/song batches and Kugou rank index/pages. Add cases for 12/50/1,000/40/three-active bounds, stable ordering, abort propagation, valid empty directory, oversized/all-invalid directory drift, bad provider code/ID echo/page metadata, missing hydrated IDs, declared totals above the accepted cap, exact image-host normalization, semantic ID rejection, and zero-fetch kgplaylist_ unavailability; keep all existing search tests running. In ids.ts, add a separate kgchart_ collection pattern to sourceForPlaylistId without broadening kgplaylist_. In providers.ts, make NetEase featured and chart section requests independently settled while rethrowing cancellation, and replace embedded-tracks trust with validated trackIds plus a small abortable three-worker batch helper over fixed 50-ID song/detail requests; preserve accepted ID order and compute completeness/declaredTrackCount explicitly. Add getKugouDiscover and getKugouChart using only the verified rank routes, internal page construction, MAX_DISCOVER_ROWS=12, MAX_COLLECTION_TRACKS=1000, MAX_KUGOU_DETAIL_PAGES=40, and MAX_DETAIL_CONCURRENCY=3; map hash/songname/authors[0].author_name/duration to kgtrack_ rows, discard unsafe artwork, de-duplicate repeated hashes without reordering, and expose short or capped results as partial. In client.ts, enable Kugou discovery/remote detail only for kgchart_, retain playlistSearch=false and zero dispatch for kgplaylist_, and keep NetEase search/detail compatibility. This task owns exactly the five listed files and must not change requestJson, navigation, screen, player, package, or native files. If the approved routes cannot be completed within those existing contracts and five-file boundary, stop before broadening edits and request an explicit follow-up plan that carries every remaining D-01/D-02/D-03 behavior; do not omit, approximate, or silently move any provider/detail requirement. Do not port NetEase weapi/cookies/encryption/DOM parsing or Kugou cleartext/mobilecdnbj routes, caller User-Agent/Referer, HTML scraping, per-track fan-out, or catch-to-empty behavior from the legacy files; borrow only their provider/collection distinction and semantic identity intent. Implement D-01, D-02, D-03, and D-06.</action>
  <verify>
    <automated>npm --prefix mobile test -- --runInBand src/api/__tests__/client.test.ts</automated>
  </verify>
  <done>Within the five declared files, the focused provider suite proves both NetEase sections, ordered 50-ID hydration, exact incomplete-detail reporting, the Kugou chart-only boundary, 12/1,000/40/three-worker limits, exact kgchart_ routing/artwork normalization, cancellation and visible drift failures while every pre-existing search/playlist/bootstrap/lyric contract still passes; if that boundary proves insufficient, execution stops with a lossless follow-up-plan request rather than weakening scope.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Complete refresh/error/detail UX and rollback-safe play-all</name>
  <reversibility rating="costly">Boolean completion and bounded native rollback form an internal cross-screen/player transaction contract that must stay synchronized with all collection playback callers.</reversibility>
  <files>mobile/src/screens/DiscoverScreen.tsx, mobile/src/screens/PlaylistDetailScreen.tsx, mobile/src/screens/__tests__/discoverFlow.test.tsx, mobile/src/player/playerController.ts, mobile/src/player/__tests__/playerController.rollback.test.ts</files>
  <behavior>
    - D-04: Initial load clears old content; pull/button refresh retains existing cards only while the request is pending; source changes abort and clear, increment the epoch, and ignore every stale success or failure.
    - D-04: Valid zero-row responses render an empty state; all-section failure renders a source-level retry; one-section failure or unverified Kugou featured content renders an inline safe explanation/retry while ready sibling cards remain pressable.
    - D-04: Every filter, refresh/retry control, collection card, and play-all control has a provider/title-aware label and at least a 48dp target; artwork uses only sanitized URLs and otherwise renders the existing icon-style fallback.
    - D-01/D-02/D-05: Remote detail displays returned count versus declared count and a fixed partial notice; partial details allow individual eligible rows but expose play-all as disabled and never dispatch it.
    - D-05: Before its first reset, playTracks snapshots the prior native item URL/headers metadata, semantic track, position, repeat/volume/mute and playing/paused state into one bounded function-local value that never enters Redux, persistence, logs, return values, or module-lifetime caches.
    - D-05: If replacement reset/add/seek/play fails, rollback restores the prior item in reset → add → repeat/volume → seek → play-or-pause order and returns false while Redux playlist/current/history/play-next remains unchanged for both previously playing and paused states.
    - D-05: If rollback fails, playTracks returns false, best-effort pauses native playback, sets isPlaying=false, and exposes only playback-recovery-required; no native/provider URL, header, body, or exception text reaches state.
    - D-05: playTracks returns false for no target or pre-reset bootstrap/snapshot failure without touching native/durable playback; it returns true only after the new first track is loaded/playing and replacePlaylist plus recordRecent complete.
    - D-05: PlaylistDetail awaits the thunk result and navigates to Player exactly once only on true; false or rejection leaves the detail visible, including after successful rollback or bounded rollback-failure reconciliation.
  </behavior>
  <action>Write playerController.rollback.test.ts first with the existing TrackPlayer/provider/offline/store mocks plus getActiveTrack, getProgress and getPlaybackState. Use invocationCallOrder assertions to prove: a failure during new reset/add/seek/play triggers a second reset followed by restoring the prior item, repeat mode, volume, prior position and play when it was playing; a previously paused item follows the same restore sequence but ends with pause and no restore-play; a restore reset/add/seek/play-or-pause failure returns false, best-effort pauses, emits exactly playback-recovery-required plus isPlaying=false, and never dispatches a media descriptor or raw error. Snapshot playlist/current/history/playNextQueue before each failure and compare the final values exactly; also prove pre-reset resolution/snapshot failure makes no destructive native call and success returns true with one replacePlaylist. Extend discoverFlow.test.tsx to cover NetEase/Kugou filters, initial loading, refresh with stale cards, abort/epoch suppression, valid empty, all-error, per-section error, fixed curated-Kugou unavailable copy, exact card accessibility/navigation, partial detail copy, disabled play-all, false/rejected thunk no-navigation, and true single navigation; mock only semantic facade/thunk/navigation/store boundaries. In DiscoverScreen, complete the loading/refresh/ready/empty/error state machine with one current AbortController and epoch; retain stale page data only during an explicit refresh, replace it when the current request settles, and map only stable section codes to fixed Simplified Chinese copy. In playerController.ts, refactor the collection-start path so all target media resolution happens before mutation, then capture a function-local rollback snapshot immediately before reset: validate the active native URL as a non-empty string no longer than 4,096 characters; clone at most eight string header pairs with keys at most 64 and values at most 1,024 characters; use the durable current PlayableTrack, play mode, muted/volume values plus native getProgress position and getPlaybackState playing/paused status. If a current durable item lacks a valid bounded active descriptor or snapshot calls fail, emit a fixed playback-transition-unavailable code and return false before reset. Attempt the new item with no durable Redux commit; on any post-reset failure, restore the snapshot in reset/add/configure/seek/play-or-pause order, then restore the prior isPlaying projection and emit only the fixed playback-unavailable code. If restoration itself fails, make one best-effort pause, emit playback-recovery-required and isPlaying=false, and discard the snapshot in finally. Never store snapshot data in module state, Redux, persistence, logs, errors, diagnostics, or SUMMARY evidence. Only after the new item is playing emit replacePlaylist and recordRecent, discard the snapshot, and return true. In PlaylistDetailScreen, use the typed playTracks thunk result instead of dynamic fallback dispatch: await it for individual remote/local rows and play-all, navigate only on true, and preserve existing library/local controls. Render declared/returned counts for remote details, a visible fixed partial explanation, and accessibilityState disabled on play-all whenever completeness is partial; do not disable valid individual returned tracks. Implement D-01, D-02, D-04, D-05, and D-06.</action>
  <verify>
    <automated>npm --prefix mobile test -- --runInBand src/screens/__tests__/discoverFlow.test.tsx src/player/__tests__/playerController.rollback.test.ts src/player/__tests__/playerController.test.ts &amp;&amp; npm run mobile:typecheck</automated>
  </verify>
  <done>Focused screen/player tests and TypeScript prove deterministic provider switching/refresh/error/empty/unavailable states, safe accessible cards, truthful complete/partial detail, disabled partial play-all, bounded transition-only native snapshots, exact playing/paused rollback call order, fixed rollback-failure reconciliation, unchanged durable state/no navigation on every false result, and exactly one Player navigation after successful native load and queue commit.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|---|---|
| React Native screen → provider facade | Screen-controlled source selection and semantic IDs cross into adapter routing; no transport value may cross. |
| Provider HTTPS response → typed discovery/detail | Remote JSON, counts, identifiers, text, artwork and pagination metadata are untrusted until validated and bounded. |
| Remote detail → Redux/player controller | A provider collection can propose queue entries, but no durable playback state may change before first native load succeeds. |
| Player transaction → TrackPlayer native state | Destructive reset/add crosses from reversible in-memory intent to the current native item; failure must restore the bounded prior descriptor and exact play/pause configuration. |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|---|---|---|---|---|---|
| T-JLV-01 | Spoofing | Discover/detail semantic identities | high | mitigate | Exact neplaylist_/kgchart_ grammars, positive provider IDs, source-capability dispatch, ID echo validation, and zero transport fallback for unknown/legacy collection IDs. |
| T-JLV-02 | Tampering | Provider directory/detail bodies | high | mitigate | requestJson HTTPS/1 MiB/10-second boundary plus strict code/root/row/count/page/batch validation and stable INVALID_RESPONSE failures. |
| T-JLV-03 | Repudiation | Refresh/source-change lifecycle | medium | mitigate | One AbortController and monotonic epoch; only the current request may settle screen state, with deterministic stale/cancellation tests. |
| T-JLV-04 | Information disclosure | UI/API errors and transport | high | mitigate | Adapter-owned fixed URLs, no caller headers/cookies/tokens/pages, semantic-only navigation, stable error codes, fixed UI copy, and no raw exception/provider-body rendering. |
| T-JLV-05 | Denial of service | Large directories, hydration and rank pagination | high | mitigate | 12-card sections, 1,000-track details, 50-ID batches, 40 Kugou pages, three active detail requests, abort propagation, 10-second per-request timeout, and bounded response bodies. |
| T-JLV-06 | Elevation of privilege | Membership/region/DRM and legacy provider routes | high | mitigate | Anonymous verified routes only; no weapi crypto, credentials, forged mobile headers, cleartext fallback, HTML scraping, or entitlement bypass. |
| T-JLV-07 | Tampering | Playback transaction | high | mitigate | Pre-reset bounded function-local snapshot, ordered native rollback for prior playing/paused state, durable state equivalence, queue commit only after success, partial-detail play-all disablement, and false-result no-navigation tests. |
| T-JLV-08 | Information disclosure | Native rollback snapshot | high | mitigate | URL capped at 4,096 characters, at most eight 64/1,024-character header pairs, transition-local lifetime with finally discard, and explicit prohibition from Redux, persistence, logs, errors, diagnostics, returns, and evidence. |
| T-JLV-09 | Denial of service | Rollback failure | high | mitigate | One bounded restore attempt, one best-effort pause, fixed playback-recovery-required state, isPlaying=false reconciliation, and no recursive recovery. |
| T-JLV-SC | Tampering | npm dependency supply chain | low | accept | No package install, manifest change, or new dependency; execution uses the repository's existing mobile/node_modules with --no-install for direct tool invocations. |
</threat_model>

<source_audit>
SOURCE | ID | Feature/Requirement | Task | Status | Notes
--- | --- | --- | --- | --- | ---
GOAL | G-01 | Replace static Discover with bounded real NetEase/Kugou discovery, remote detail, and transactional play-all | 1-3 | COVERED | Tracer proves one end-to-end path; expansion adds all approved routes and lifecycle states.
REQ | QUICK-DISCOVER-001 | Full orchestrated quick-task description | 1-3 | COVERED | Synthetic quick requirement; it does not mark broader Phase 5 requirements complete.
RESEARCH | R-01 | NetEase featured playlists and charts, trackIds hydration in fixed 50-ID batches, truthful 1,000-item limit | 1-3 | COVERED | D-01; API, detail UI, and play-all gates all consume completeness.
RESEARCH | R-02 | Kugou chart index plus bounded paginated detail; curated playlist detail unavailable | 1-3 | COVERED | D-02; kgchart_ is distinct and kgplaylist_ remains zero-fetch unavailable.
RESEARCH | R-03 | Fixed HTTPS routes, safe semantic IDs/artwork, bounded body/page/item/timeout/cancel/concurrency, no caller transport or credentials | 1-3 | COVERED | D-03; exact constants and negative provider tests are named.
RESEARCH | R-04 | Provider filters, loading/refresh/empty/error, accessible cards, semantic navigation | 1,3 | COVERED | D-04; epoch and stale-refresh behaviors are explicit.
RESEARCH | R-05 | Truthful partial detail and success-gated transactional play-all with restoration after destructive native failure | 2-3 | COVERED | D-05; partial disables play-all, false restores prior playing/paused native state and preserves durable state/navigation, rollback failure is bounded and safe.
RESEARCH | R-06 | Port useful original-author collection semantics but reject insecure legacy mechanisms | 2 | COVERED | Action names allowed semantics and rejected mechanisms explicitly.
RESEARCH | R-07 | Preserve Search; mobile/ only; focused TS/Jest/lint/Prettier/Metro; no install/APK/emulator/repository-wide CI | 1-3 | COVERED | D-06 execution gate and overall verification enforce the boundary.
CONTEXT | — | No CONTEXT.md exists for this quick task; approved research decisions D-01 through D-06 are the locked context | 1-3 | COVERED | Every D-ID appears in task behavior/action/done.
</source_audit>

<verification>
Run only these focused gates after all three tasks, from the repository root unless the command changes directory:

1. `npm --prefix mobile test -- --runInBand src/api/__tests__/client.test.ts src/screens/__tests__/discoverFlow.test.tsx src/player/__tests__/playerController.rollback.test.ts src/player/__tests__/playerController.test.ts`
2. `npm run mobile:typecheck`
3. `cd mobile &amp;&amp; npx --no-install eslint src/types/provider.ts src/api/ids.ts src/api/providers.ts src/api/client.ts src/api/__tests__/client.test.ts src/screens/DiscoverScreen.tsx src/screens/PlaylistDetailScreen.tsx src/screens/__tests__/discoverFlow.test.tsx src/player/playerController.ts src/player/__tests__/playerController.rollback.test.ts --quiet`
4. `cd mobile &amp;&amp; npx --no-install prettier --check src/types/provider.ts src/api/ids.ts src/api/providers.ts src/api/client.ts src/api/__tests__/client.test.ts src/screens/DiscoverScreen.tsx src/screens/PlaylistDetailScreen.tsx src/screens/__tests__/discoverFlow.test.tsx src/player/playerController.ts src/player/__tests__/playerController.rollback.test.ts`
5. `cd mobile &amp;&amp; DISCOVER_METRO_DIR="$(mktemp -d /tmp/listen2-discover-metro.XXXXXX)" &amp;&amp; npx --no-install react-native bundle --platform android --dev false --entry-file index.js --bundle-output "$DISCOVER_METRO_DIR/index.android.bundle" --assets-dest "$DISCOVER_METRO_DIR/assets"`

Do not replace a failed focused gate with an APK build, emulator run, dependency install, repository-wide test/CI command, or live-provider success claim. Deterministic fixtures prove endpoint construction, parsing, bounds, lifecycle, and playback transaction only; current live provider availability and Android device rendering/playback remain external and are not claimed by this quick source loop.
</verification>

<success_criteria>
- Discover displays real bounded NetEase featured playlists/charts and real bounded Kugou charts behind NetEase/Kugou-only filters, with accessible semantic cards and deterministic load/refresh/empty/error/unavailable behavior.
- NetEase detail hydrates accepted IDs in order through fixed 50-ID batches; Kugou chart detail paginates through internally constructed fixed routes; both stop at declared bounds and expose incomplete results as partial.
- Kugou curated playlists, legacy HTML/HTTP/header/cookie/encryption routes, arbitrary transport inputs, and fabricated/sample content have no execution path.
- Partial detail cannot play all; complete detail changes queue/current/history and navigates only after first native playback load succeeds. Any destructive failure restores the bounded prior native media/position/repeat/volume/play-pause state while preserving durable queue/current/history/play-next and route; rollback failure stops with fixed safe recovery state.
- Existing focused provider tests continue to prove Search and current NetEase playlist, bootstrap, lyric, and source-restriction behavior.
- All five focused verification gates pass with only the listed mobile/ files changed and without install, Gradle/APK, emulator, repository-wide CI, push, merge, or deploy actions; if Task 2 cannot remain inside its declared five-file contracts, execution stops for an explicit lossless follow-up plan.
</success_criteria>

<output>
Create `.planning/quick/260913-jlv-replace-the-placeholder-react-native-dis/260913-jlv-SUMMARY.md` when execution completes.
</output>
