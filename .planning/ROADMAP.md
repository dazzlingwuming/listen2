# Roadmap: Listen2 Android Platform Parity

## Overview

Deliver Android parity as dependency-ordered, emulator-proven vertical slices: first establish a safe typed bridge while proving the Bilibili home/search/play/lyrics journey, then move playback ownership into Media3, add provider and user-data capabilities, and finish with release-like evidence. Every phase is MVP mode: a capability is complete only when its observable behavior and required evidence both pass. A “degraded” or “not verified” label is honest runtime status, never completion or parity-ready evidence.

## Phases

- [ ] **Phase 1: Verified Bilibili Startup Slice** - Prove a typed, cancellable bridge through an emulator-verified home, Bilibili search, playback, and lyric-entry journey.
- [ ] **Phase 2: Native Media3 Playback & Background Control** - Make one native Media3 owner reliable across controls, queue behavior, background execution, and recovery.
- [ ] **Phase 3: NetEase Lyrics & Provider Contract** - Complete the NetEase listening slice and reliable synchronized-lyrics behavior under the capability matrix.
- [ ] **Phase 4: Durable Library & Playlist Management** - Give users a persistent, source-aware library and safe playlist/favorite editing.
- [ ] **Phase 5: Secure Account Sessions** - Provide truthful account states, Bilibili QR sign-in, and secure session lifecycle handling.
- [ ] **Phase 6: Local Music, Backup & Listening History** - Bring local files, safe backup/restore, and durable history/recap to Android.
- [ ] **Phase 7: Proven Provider Expansion** - Expand only provider capabilities that satisfy contract, entitlement, and regression evidence.
- [ ] **Phase 8: Verified Cache, Downloads & Offline Playback** - Deliver recoverable offline media with separate ownership, quotas, and user management.
- [ ] **Phase 9: Advanced Playback, Effects & AI** - Add MV/rendition handling, Android-equivalent effects, loudness, and consented DeepSeek translation.
- [ ] **Phase 10: Mobile UX, Accessibility & Performance Hardening** - Make the complete product usable, responsive, and resilient across Android device conditions.
- [ ] **Phase 11: Release-like Parity Evidence** - Prove the complete device journey and release gates before any parity-ready claim.

## Phase Details

### Phase 1: Verified Bilibili Startup Slice
**Goal:** On a supported emulator, users can open Android home and complete a safe Bilibili search → selected part → audio playback → primary-lyric-entry journey through the typed, cancellable bridge.
**Mode:** mvp
**Requirements:** NET-001, NET-002, NET-003, SRCH-001, SRCH-002, SRCH-003, SEC-001, SEC-002, SEC-003
**Depends on:** Nothing (first executable phase)
**UI hint:** yes
**Success Criteria** (what must be TRUE):
  1. On an Android emulator, a user can open the touchable home screen, submit or revise a Bilibili search, and see current, source-labelled results without a stale result replacing the active query.
  2. A user can open a supported result and part, see its playable/login/unsupported state, and hear permitted Bilibili audio after controlled manifest and rendition resolution.
  3. A user can enter the primary lyrics experience for the playing Bilibili track; unavailable content, network/TLS faults, permission failures, and bad provider data explain a recovery action instead of appearing as empty success.
  4. A user can cancel an in-flight search or detail request and receive one clear terminal state; timeouts, destroyed pages, and expired responses cannot leave a spinner or alter the new page.
  5. Unsafe origins, frames, navigation targets, URL shapes, payloads, and media-proxy attempts are rejected without exposing cookies, caller headers, local files, or executable provider content.
**Plans:** TBD

### Phase 2: Native Media3 Playback & Background Control
**Goal:** Users have one native playback experience whose controls, queue, notification, lock screen, and recovery behavior all describe the same Media3 state.
**Mode:** mvp
**Requirements:** PLAY-001, PLAY-003, PLAY-004, PLAY-005, PLAY-006, DATA-001
**Depends on:** Phase 1
**UI hint:** yes
**Success Criteria** (what must be TRUE):
  1. A user can play, pause, seek, change volume or mute, and move previous/next from the page, mini-player, notification, or lock screen with every surface reflecting the same current track and position.
  2. A user can add duplicate tracks to a visible FIFO play-next queue, reorder or remove them, and return to the originating playlist or playback mode once the queue is consumed.
  3. A user can use shuffle, repeat, and previous without skipped or duplicated queue consumption; the resulting mode and history survive restart through durable playback checkpoints.
  4. When the screen turns off, the activity or renderer is destroyed, or audio focus/noisy/headset/Bluetooth events occur, playback continues or recovers through the legal MediaSession foreground-service path with an understandable state.
  5. When nothing is playing, the app does not retain a high-cost foreground playback service; user-visible library, queue, lyric metadata, cache-catalog, and SAF records have a migration-safe durable store.
**Plans:** TBD

### Phase 3: NetEase Lyrics & Provider Contract
**Goal:** Users can complete the NetEase listening journey and use synchronized, accessible lyrics whose state follows the active Media3 track rather than stale web state.
**Mode:** mvp
**Requirements:** NET-004, LYR-001, LYR-002, LYR-003
**Depends on:** Phase 1, Phase 2
**UI hint:** yes
**Success Criteria** (what must be TRUE):
  1. Within actual authorization, a user can search NetEase, open a directory or playlist track, resolve a real rendition, play it, and enter its primary lyric experience with actionable provider errors.
  2. For Bilibili and NetEase tracks, lyric highlighting, scroll position, offset, translation, pause, seek, track change, and recovery follow the active Media3 clock rather than a prior track.
  3. A user can manually search for, select, and keep a lyric source; missing, plain-text, insufficient-timestamp, timeout, and mismatch cases remain clear degradations that do not delay audio playback.
  4. A screen-reader user can identify the active lyric line, offset, and original/translation state, while cancellation, stale results, and error callbacks cannot overwrite the current lyric view.
  5. The provider matrix names each provider route and leaves every QQ, Kugou, Kuwo, Migu, and Taihe capability unavailable until its independent fixture, device, and authorization evidence exists.
**Plans:** TBD

### Phase 4: Durable Library & Playlist Management
**Goal:** Users can manage a persistent, source-aware music library without losing correct ordering, favorites, or capability boundaries.
**Mode:** mvp
**Requirements:** LIB-001, LIB-002, LIB-003
**Depends on:** Phase 2, Phase 3
**UI hint:** yes
**Success Criteria** (what must be TRUE):
  1. A user can distinguish their playlists, favorite playlists, provider playlists, and local music with their current synchronization state; offline browsing retains valid local content when a remote source fails.
  2. A user can create, rename, edit, delete, reorder, favorite, and unfavorite playlists or tracks under the same duplicate rules as desktop, with confirmation before destructive deletion.
  3. After rapid edits, rotation, restart, or process recovery, a user sees one transactionally consistent playlist order and favorite state rather than partial edits or duplicated identities.
  4. A user sees play-next, lyrics, download, and deletion actions only when the corresponding capability is available for that item.
**Plans:** TBD

### Phase 5: Secure Account Sessions
**Goal:** Users can sign in, understand account capability, and sign out without leaving credentials or protected references behind.
**Mode:** mvp
**Requirements:** AUTH-001, AUTH-002, AUTH-003
**Depends on:** Phase 1, Phase 3, Phase 4
**UI hint:** yes
**Success Criteria** (what must be TRUE):
  1. A user sees distinct per-provider states for signed out, signing in, signed in, expired, network failure, and insufficient permission; unsupported login routes are not presented as working buttons.
  2. A user can complete the Bilibili QR journey through generation, wait, success, expiry, cancellation, retry, and session refresh, with declared provider login routes exercising controlled fixtures and recovery paths.
  3. On expiry or logout, the app removes the identifiable session, protected notification state, and protected cache references while retaining the user's playlists, history, and local music.
  4. A user never receives a token, cookie, refresh token, or API key in page state, logs, or backups, and a fresh login does not reuse the prior session.
**Plans:** TBD

### Phase 6: Local Music, Backup & Listening History
**Goal:** Users can safely own their local collection, restore playlists without destructive surprise, and review or control durable on-device listening history.
**Mode:** mvp
**Requirements:** LOCAL-001, LOCAL-002, LOCAL-003, DATA-002, DATA-003, HIST-001, HIST-002, HIST-003
**Depends on:** Phase 2, Phase 4, Phase 5
**UI hint:** yes
**Success Criteria** (what must be TRUE):
  1. A user can select supported audio files through Android's document picker without granting full storage access, then see their tags, artwork, duration, LRC, and local-source state in playlists, queues, and Media3 playback.
  2. When a local grant is revoked, a file is unreadable or unsupported, a duplicate is chosen, or a cloud item cannot seek, the user gets a repair or removal action; paths and raw file handles never enter the page, bridge, or backup.
  3. A user can export only eligible playlists and favorites, preview a backup import, merge it without losing current playlists, and use an explicitly confirmed overwrite only when desired; invalid or interrupted imports fail recoverably.
  4. A user's valid plays count only after real forward listening meets the stated threshold, and the history pointer plus annual recap remain correct across restart, midnight, and year boundaries.
  5. A user can disable, export, or clear local history; disabled history stops growing and cleared statistics cannot reappear from cache, logs, backup, or a remote source.
**Plans:** TBD

### Phase 7: Proven Provider Expansion
**Goal:** Users gain additional music-provider capabilities only when each visible capability has passed its route contract, entitlement boundary, and regression evidence.
**Mode:** mvp
**Requirements:** SEC-004, TEST-001
**Depends on:** Phase 3, Phase 5, Phase 6
**UI hint:** yes
**Success Criteria** (what must be TRUE):
  1. A user sees an additional provider capability only after its registry, request/response contract, cancellation/error behavior, and provider fixture checks pass; unverified capabilities remain unavailable rather than becoming dead controls.
  2. A user receiving a provider entitlement, membership, region, DRM, quality, download, MV, or offline refusal sees the real limitation and a safe recovery path; the app never attempts to bypass it.
  3. A user can rely on provider search, playback, lyric, library, backup, cache, history, and security regressions being exercised through JavaScript and Android policy contracts before the related capability is exposed.
**Plans:** TBD

### Phase 8: Verified Cache, Downloads & Offline Playback
**Goal:** Users can identify, manage, and reliably play complete authorized media offline without partial files, unbounded storage, or hidden retention.
**Mode:** mvp
**Requirements:** CACHE-001, CACHE-002, CACHE-003, CACHE-004
**Depends on:** Phase 2, Phase 4, Phase 5, Phase 6
**UI hint:** yes
**Success Criteria** (what must be TRUE):
  1. After playback or an explicit download, a user can distinguish temporary cache, playlist cache, and explicit download; only complete, validated, Media3-readable content becomes playable.
  2. A user can play a complete still-authorized cache entry while offline, and can cancel, resume, repair, or remove a download without duplicate or partial media appearing as playable after network changes or process death.
  3. A user can select the stated capacity limits, including the 2 GB default, and observe LRU eviction affect only non-explicit media while explicit downloads stay until the user removes them.
  4. A user can search, sort, filter, convert, delete singly or in bulk, and clear cache entries; disk-full or catalog inconsistency gives a bounded recovery state and no cache data enters backup or logs.
**Plans:** TBD

### Phase 9: Advanced Playback, Effects & AI
**Goal:** Users can access advanced desktop-parity playback and translation capabilities through Android-equivalent, permission-aware, and honest degradation paths.
**Mode:** mvp
**Requirements:** PLAY-002, FX-001, FX-002, FX-003, AI-001, AI-002, AI-003
**Depends on:** Phase 2, Phase 3, Phase 5, Phase 8
**UI hint:** yes
**Success Criteria** (what must be TRUE):
  1. A user receives only authorized, supported renditions; quality selection, part switching, bounded CDN recovery, and MV full-screen or picture-in-picture work when supported, otherwise audio fallback or an actionable error is shown.
  2. A user can enable, choose, disable, and reset audio-effect presets without changing device volume, mute, headset, Bluetooth, or fixed-gain behavior, and an effect failure does not stop playback.
  3. A user sees a spectrum or visualization that follows real audio and active playback state; background, constrained, or unsupported devices show an explicit static or hidden degradation instead of invented realtime data.
  4. A user can use loudness normalization only after non-blocking analysis of complete media; unanalysed or failed media retains original volume and changed hash, sample rate, or codec invalidates the analysis.
  5. A user can configure, test, and remove a protected DeepSeek key, then must explicitly consent to the lyrics, title, artist, possible cost, cancellation, and failure impact before a translation call; only validated, aligned results are cached.
**Plans:** TBD

### Phase 10: Mobile UX, Accessibility & Performance Hardening
**Goal:** Users can complete the available Android music journeys comfortably, accessibly, quickly, and recoverably across supported device conditions.
**Mode:** mvp
**Requirements:** PERF-001, PERF-002, PERF-003, UI-001, UI-002, UI-003, TEST-002
**Depends on:** Phase 1, Phase 2, Phase 3, Phase 4, Phase 5, Phase 6, Phase 7, Phase 8, Phase 9
**UI hint:** yes
**Success Criteria** (what must be TRUE):
  1. A user can navigate search, library, account, mini-player, player detail, queue, lyrics, playlists, and settings through phone-appropriate panels and safe system back behavior without desktop-only controls.
  2. A user using cutouts, system navigation, keyboard, rotation, 200% font scaling, high contrast, reduced motion, or a screen reader can see, reach, and understand the primary controls without obscured content or sub-48 dp targets.
  3. On the recorded API 26 and current-target emulator samples, a user reaches interactive shell and playback entry within the required cold-start budgets, and fixture search plus first audio meet their respective latency budgets with resource measurements.
  4. After low-memory process death, a user returns to the correct queue, track, playback mode, near-current position, and explainable account state without duplicate requests, queue consumption, or history counting; ten minutes of fixture playback has no ANR.
  5. Instrumentation proves the real WebMessage handshake, renderer recovery, unique player, media controls, focus/noisy handling, SAF, Room, Keystore, cache integrity, and process recovery rather than relying on static or JVM-only claims.
**Plans:** TBD

### Phase 11: Release-like Parity Evidence
**Goal:** A release evaluator can reproduce the full Android parity journey, inspect release-like gates, and make a parity-ready decision based only on passing evidence.
**Mode:** mvp
**Requirements:** TEST-003, TEST-004, REL-001, REL-002, REL-003
**Depends on:** Phase 1, Phase 2, Phase 3, Phase 4, Phase 5, Phase 6, Phase 7, Phase 8, Phase 9, Phase 10
**UI hint:** yes
**Success Criteria** (what must be TRUE):
  1. A recorded Android emulator journey covers cold start and layout, Bilibili and NetEase search/play/lyrics/translation, account state, library/queue/history, offline cache, SAF local media, backup recovery, background playback, rotation/process recovery, network recovery, and external navigation.
  2. Debug and minified release-like APKs reproducibly resolve dependencies, copy assets, run required tests, pass R8 and service/notification/migration smoke checks, and pass manifest, Network Security, version, alignment, signature, artifact-hash, and secret scans without publishing signing credentials.
  3. Every evidence record states date, API, emulator/device, network, build variant, fixture, command, result, uncovered items, and recovery path, with accessibility, performance, cleartext, and failure data redacted for review.
  4. A parity-ready result is possible only after all 58 requirements have implementation and passing evidence, including critical emulator E2E, background playback, data/security, performance, and release-like gates; “degraded” or “not verified” remains Pending and cannot satisfy completion.
**Plans:** TBD

## Progress

**Execution Order:** Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5 → Phase 6 → Phase 7 → Phase 8 → Phase 9 → Phase 10 → Phase 11

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Verified Bilibili Startup Slice | 0/TBD | Not started | - |
| 2. Native Media3 Playback & Background Control | 0/TBD | Not started | - |
| 3. NetEase Lyrics & Provider Contract | 0/TBD | Not started | - |
| 4. Durable Library & Playlist Management | 0/TBD | Not started | - |
| 5. Secure Account Sessions | 0/TBD | Not started | - |
| 6. Local Music, Backup & Listening History | 0/TBD | Not started | - |
| 7. Proven Provider Expansion | 0/TBD | Not started | - |
| 8. Verified Cache, Downloads & Offline Playback | 0/TBD | Not started | - |
| 9. Advanced Playback, Effects & AI | 0/TBD | Not started | - |
| 10. Mobile UX, Accessibility & Performance Hardening | 0/TBD | Not started | - |
| 11. Release-like Parity Evidence | 0/TBD | Not started | - |
