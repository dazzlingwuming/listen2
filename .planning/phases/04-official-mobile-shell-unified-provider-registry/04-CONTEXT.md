# Phase 4: Official Mobile Shell & Unified Provider Registry - Context

**Gathered:** 2026-09-10
**Status:** Ready for planning
**Mode:** Autonomous decisions accepted by the user on 2026-09-10

<domain>
## Phase Boundary

Deliver the phone-first navigation, focused player entry, and one consistent five-source provider registry that the rest of Android v1.0 can build on. This phase makes the shell and source selection coherent and testable; Phase 5 owns live search/detail/play/lyric completion for every source.

</domain>

<decisions>
## Implementation Decisions

### Product reference and navigation
- Use `listen1/listen1_mobile` v0.8.2 as the product-behavior reference: a phone-first home/library area, platform discovery, search, settings, a persistent mini-player, and a focused full-player surface.
- Preserve Listen2 branding and the latest desktop feature set; do not copy the obsolete React Native 0.59 runtime, SDK 28 build, cleartext routes, or legacy native modules.
- Replace desktop-shaped panels and engineering capability notices in the primary journey with concise mobile empty, loading, unavailable, and recovery states.
- System back closes the nearest sheet/player/detail layer before leaving the current top-level destination or Activity.

### Provider registry and search entry
- Present NetEase, Kugou, Kuwo, QQ, and Bilibili through one ordered provider contract. The exact Android primary order is `netease`, `kugou`, `kuwo`, `qq`, `bilibili`, matching the official mobile four-source order and appending Bilibili as Listen2's fifth source.
- Every source exposes the same semantic surface: identity, display name, searchable state, directory/detail state, playable state, lyric state, account requirement, and a safe actionable error.
- A source may be visible before its Phase 5 live route is complete only when the UI labels the exact unavailable capability and never renders a dead control or empty-success result.
- Preserve exact source-prefixed track identity across search, playlists, queue, favorites, backup, and playback; UI code must not infer a provider from a title or URL.

### Android architecture boundary
- Retain the API 35 hardened appassets WebView, versioned typed bridge, Media3 sole playback owner, Room, SAF, Keystore, and native cache/download ownership already present.
- Shared JavaScript owns phone presentation, navigation, source selection, and normalized provider DTOs. Native Java owns privileged lifecycle, media session, secure credentials, local documents, durable native data, and bounded provider operations that cannot safely run in WebView.
- Consolidate provider dispatch behind semantic operations instead of adding another provider-specific controller branch for each source.
- Never expose arbitrary URLs, caller headers, raw cookies, signed media candidates, local paths, or generic JavaScript interfaces to make legacy provider code work.

### UX and verification cadence
- Optimize for ordinary listening actions: search, choose source, inspect result, play, open lyrics, manage queue/library. Diagnostics remain available in recoverable error detail, not as homepage content.
- Use touch targets of at least 48 dp, safe-area insets, keyboard-safe search, readable compact rows, source labels, accessible names, and reduced-motion-compatible transitions.
- During implementation, verify cohesive UI/registry changes with JavaScript/JVM contract tests. Do not assemble an APK for each small change.
- Phase 8 owns the integrated APK, API 35 emulator, performance, accessibility, and release-like acceptance pass; Phase 4 still requires deterministic tests for its shell and registry contracts.

### the agent's Discretion
- Exact visual tokens, icon choices from existing assets, transition timing, and internal module split may follow established project conventions as long as the official-mobile hierarchy and the phase success criteria remain intact.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `app/listen1_chrome_extension/listen1.html` already contains Android home/search/library/settings surfaces, mini-player/detail sheets, and shared Angular templates.
- `js/controller/navigation.js`, `instant_search.js`, `playlist.js`, `my_playlist.js`, and `play.js` already hold the closest presentation and interaction logic.
- `js/app.js`, `js/loweb.js`, and `js/provider/*.js` already define the shared source registry and legacy provider contracts.
- `MainActivity.java`, `AndroidRpcContract.java`, `AndroidHttpBridge.java`, and `ProviderCapabilityFacade.java` provide the current hardened Android boundary.

### Established Patterns
- Browser scripts are classic globals loaded in deliberate HTML order; new reusable logic must remain browser-safe and testable without a bundler.
- Provider IDs and provider-compatible snake_case methods are compatibility contracts and should not be casually renamed.
- Android bridge operations are typed, bounded, cancellable, origin-restricted, and return explicit safe failure states.
- Media3 snapshots are playback truth; renderer acknowledgements and WebView lifetime are not playback truth.

### Integration Points
- Source ordering and metadata begin in `js/app.js`; Android filtering currently occurs in `js/controller/instant_search.js` and capability facades.
- Search dispatch crosses `MediaService`/`loweb.js`, provider modules, and typed Android RPC for supported native routes.
- Mobile hierarchy and duplicate capability messaging are concentrated in the late Android-specific sections of `listen1.html` and `navigation.js`.
- Gradle's explicit asset allow-list must include any new shared JavaScript or CSS file before the final integrated APK build.

</code_context>

<specifics>
## Specific Ideas

- The user explicitly wants the original author's Android implementation experience used as the primary shortcut instead of re-inventing a new mobile product.
- The user wants the full blueprint implemented before repeated APK inspection; APK generation is an integration gate, not the inner development loop.
- The app must feel like a phone application and retain the latest desktop capabilities through Android-equivalent interactions.

</specifics>

<deferred>
## Deferred Ideas

- Live five-source provider routes, playback, and lyric completion belong to Phase 5.
- Personal library/account/local/backup/history completion belongs to Phase 6.
- Offline media and advanced desktop-equivalent playback belong to Phase 7.
- Integrated APK, emulator, performance, accessibility, and release-like evidence belong to Phase 8.

</deferred>
