# Roadmap: Listen2 Android v1.0 — Official-Mobile Product Pivot

## Overview

Android v1.0 now takes the original author's `listen1/listen1_mobile` v0.8.2 as the **product reference**, not as an obsolete technology stack to copy: its phone-first information architecture, bottom navigation, focused player flow, and the one-contract four-source search model are the starting point. The Android product adds Bilibili as a fifth source and uses the current `main` desktop behavior as the complete capability baseline.

The implementation remains the current Android API 35 architecture: shared browser UI inside the hardened WebView shell, a narrow typed native bridge, Media3 as the sole playback owner, and native Room/SAF/Keystore/cache ownership. It does **not** return to React Native 0.59, SDK 28, direct provider HTTP, caller-controlled headers, or arbitrary URL bridging.

The prior roadmap fragmented this outcome into infrastructure-heavy stages and repeatedly treated builds as acceptance. The new route completes five user journeys in sequence. Normal work validates cohesive source/UI contracts through JavaScript and JVM tests; it does not create an APK for every small change. Phase 8 is the single API 35 end-to-end, performance, and release-like acceptance gate for the integrated product.

## Retained Foundation (not acceptance)

Historical Phase 1–3 plan directories are retained to preserve evidence and avoid directory conflicts. They are not executable roadmap stages and own no v1 requirements after this pivot.

- **Phase 1 foundation present:** packaged WebView shell, fixed appassets origin, typed bridge, and Bilibili/NetEase candidate paths exist.
- **Phase 2 foundation present:** Media3 `MediaSessionService`, snapshot-driven UI, queue/checkpoint primitives, Room schema, and several JVM contracts exist.
- **Phase 3 foundation present:** a typed NetEase search/lyric seam and lyric persistence primitives exist.

Those facts reduce implementation work, but none proves that a user can complete the current five-source Android journeys. The old Phase 1–3 status is therefore **foundation implemented; product acceptance not closed**. Requirement ownership and completion evidence begin with Phase 4 below.

## Phases

- [ ] **Phase 4: Official Mobile Shell & Unified Provider Registry** - Deliver the official-style phone shell and one declarative provider capability contract for NetEase, Kugou, Kuwo, QQ, and Bilibili.
- [ ] **Phase 5: Five-Source Listen Journey** - Make source-labelled search → detail → authorized playback → lyrics work coherently across the four official mobile sources plus Bilibili.
- [ ] **Phase 6: Personal Library & Continuity** - Let users own playlists, accounts, local music, backups, and listening history on Android.
- [ ] **Phase 7: Offline & Advanced Desktop-Equivalent Playback** - Complete cache/offline, MV/PiP/rendition, effects, loudness, and consented translation with truthful Android fallbacks.
- [ ] **Phase 8: Integrated API 35 Acceptance & Release-Like Evidence** - Run the integrated device journey once, measure it, and make an honest parity-ready decision.

## Phase Details

### Phase 4: Official Mobile Shell & Unified Provider Registry

**Goal:** Users enter a phone-first Listen2 shell whose navigation and provider choices behave like the original mobile product while safely reflecting Android's real capability state.
**Depends on:** Retained Phase 1–3 foundation
**Requirements:** UI-001, UI-002, UI-003, NET-001, NET-002, SEC-001, SEC-002, SEC-003, TEST-001
**Success Criteria** (what must be TRUE):

  1. A user can move between Home, Search, Library, Account, Settings, mini-player, player detail, queue, lyrics, and playlists through a phone-sized navigation hierarchy; system Back, keyboard, rotation, insets, 200% font scaling, contrast, and 48 dp controls preserve the intended layer rather than exposing a desktop layout.
  2. In Search, a user sees one source-selector model ordered NetEase, Kugou, Kuwo, QQ, and Bilibili; the source label, supported actions, login state, and unavailable reason all come from the same capability registry rather than hard-coded per-page switches.
  3. Migu and Taihe remain represented only as explicitly unavailable capability-matrix entries until they have their own route and device proof; users never encounter a dead source tab, fake result, or empty-success state.
  4. A user can revise or cancel an operation without a stale result, spinner, or error changing the active page; offline, timeout, malformed provider data, and entitlement failures show a source-specific recovery action.
  5. Untrusted pages, frames, navigations, file/content URLs, caller-supplied cookies or headers, and oversized/malformed bridge data cannot gain provider or local-data access, while routine JavaScript/JVM contracts guard the registry and these boundaries.

**Plans:** 3/3 plans executed

- [x] 04-01-PLAN.md
- [x] 04-02-PLAN.md
- [x] 04-03-PLAN.md

**UI hint:** yes

### Phase 5: Five-Source Listen Journey

**Goal:** Within a user's actual authorization, each official mobile source and Bilibili supports a coherent phone journey from search to details, playback, and lyrics.
**Depends on:** Phase 4
**Requirements:** NET-003, NET-004, SRCH-001, SRCH-002, SRCH-003, PLAY-001, PLAY-003, PLAY-004, PLAY-005, PLAY-006, LYR-001, LYR-002, LYR-003
**Success Criteria** (what must be TRUE):

  1. A user can search NetEase, Kugou, Kuwo, QQ, or Bilibili, paginate or cancel the request, and see source-labelled title, artist, artwork, duration, result kind, and real playable/login/unsupported status without one source's failure erasing another source's result.
  2. A user can open a supported source result into its directory, album/playlist, track detail, or Bilibili part list and select the intended track; rotation, Back, artwork failure, bad JSON, and an unavailable route preserve the current context and explain the next action.
  3. A user can play an authorized, device-supported track from each of the five sources; the mini-player, player detail, notification, lock screen, audio focus/noisy/headset/Bluetooth controls, seek, volume, mute, previous/next, and track error all report the same sole-Media3 state.
  4. A user can use play-next, duplicate queue entries, reorder/removal, shuffle, repeat, and real previous history, then close, rotate, or temporarily lose the renderer without silently consuming or duplicating the queue.
  5. A user can view synchronized lyrics and available translations for the active source track, change lyric offset or choose a manual lyric source where available, and receive an explicit missing/mismatch/timeout/unsupported state instead of lyrics from a previous track or fabricated timestamps.

**Plans:** TBD
**UI hint:** yes

### Phase 6: Personal Library & Continuity

**Goal:** Users can manage their own music, account state, local files, backups, and history safely across Android restarts.
**Depends on:** Phase 5
**Requirements:** LIB-001, LIB-002, LIB-003, AUTH-001, AUTH-002, AUTH-003, LOCAL-001, LOCAL-002, LOCAL-003, DATA-001, DATA-002, DATA-003, HIST-001, HIST-002, HIST-003
**Success Criteria** (what must be TRUE):

  1. A user can distinguish personal playlists, favorite playlists, remote provider playlists, and local tracks; create, rename, edit, reorder, favorite, or delete them with the same duplicate and confirmation behavior after rapid edits, restart, rotation, or process recovery.
  2. A user sees honest per-provider account states and can complete the supported Bilibili QR sign-in lifecycle (including expiry, cancellation, retry, refresh, and sign-out); protected credentials never appear in the page, notification, logs, backup, or a new login session.
  3. A user can import supported local audio through Android's document picker without broad storage permission, inspect tags/artwork/duration and authorized LRC, add it to library/queue/playback, and repair or remove a revoked, duplicate, unreadable, unsupported, or non-seekable item.
  4. A user can export eligible playlists/favorites, preview an import, safely merge it by default, and explicitly confirm overwrite; malformed, oversized, old-version, or interrupted backups fail without deleting existing data.
  5. A user can trust listening history and annual recap to count only genuine listening, survive restart/midnight/year boundaries, and support disable, export, and irreversible clear without history writes delaying playback.

**Plans:** TBD
**UI hint:** yes

### Phase 7: Offline & Advanced Desktop-Equivalent Playback

**Goal:** Users can keep authorized media offline and use advanced desktop capabilities through real Android behavior or an honest, actionable platform-equivalent state.
**Depends on:** Phase 5, Phase 6
**Requirements:** PLAY-002, CACHE-001, CACHE-002, CACHE-003, CACHE-004, FX-001, FX-002, FX-003, AI-001, AI-002, AI-003, SEC-004
**Success Criteria** (what must be TRUE):

  1. A user can distinguish temporary cache, playlist cache, and explicit download; only complete, validated, currently authorized entries play offline, while cancel/resume/repair/eviction/disk-full/network-change/process-death states remain recoverable and do not leave partial media playable.
  2. A user can set the stated cache limit, find/filter/sort entries, promote an eligible entry to an explicit download, or remove selected/all entries; cache contents, signed URLs, paths, credentials, and media bytes never enter backup or logs.
  3. A user can choose an authorized rendition or Bilibili part and use MV full-screen/PiP only when the account, codec, device, and media permit it; otherwise the user gets an audio fallback or a concrete unsupported/entitlement explanation, never a bypass.
  4. A user can turn effects, real-time visualization, or fixed loudness normalization on/off only when the device and complete media support them; effect/analysis failure preserves audio, first playback does not wait, and static/hidden visual fallback is labelled honestly.
  5. A user can configure or remove a protected DeepSeek key and explicitly consent to the title, artist, lyrics, possible cost, cancellation, and failure consequences before translation; only schema- and alignment-valid translations persist, and no secret or lyric payload leaks to UI state, artifacts, logs, or backups.

**Plans:** TBD
**UI hint:** yes

### Phase 8: Integrated API 35 Acceptance & Release-Like Evidence

**Goal:** An evaluator can install one integrated Android build, reproduce the complete user journeys, inspect measured performance and release-like gates, and make an evidence-backed parity decision.
**Depends on:** Phase 4, Phase 5, Phase 6, Phase 7
**Requirements:** PERF-001, PERF-002, PERF-003, TEST-002, TEST-003, TEST-004, REL-001, REL-002, REL-003
**Success Criteria** (what must be TRUE):

  1. On a recorded API 35 emulator, an evaluator can run one integrated journey covering cold start/mobile layout, five-source search/detail/play/lyrics, account state, library/queue/history, local SAF music, backup recovery, cache/offline behavior, screen-off background playback, rotation/process recovery, network recovery, and safe external navigation; credential-dependent paths are explicitly marked `not verified` when no user credential is supplied.
  2. The integrated build meets the recorded cold-start, interactive-shell, playback-entry, first-search, and first-audio budgets with separate bridge/network/Media3 timings and resource measurements; ten minutes of fixture playback and low-memory recovery produce no ANR, duplicate request, duplicate history, or queue corruption.
  3. The debug and minified release-like builds reproducibly resolve dependencies, package approved assets, pass required JavaScript/JVM/instrumentation suites, and pass Media3 service, notification, Room migration, manifest, network-security, version-upgrade, alignment, signature, artifact-hash, and secret-scan checks without using release credentials.
  4. Every result records date, build, API/device, network, fixture, command, outcome, uncovered items, and recovery path. Android v1.0 becomes `parity-ready` only when all 58 requirements have passing implementation and evidence; `foundation present`, `degraded`, and `not verified` remain incomplete.

**Plans:** TBD
**UI hint:** yes

## Progress

**Execution order:** Historical foundation → Phase 4 → Phase 5 → Phase 6 → Phase 7 → Phase 8

| Phase | Plans Complete | Status | Completed |
| --- | --- | --- | --- |
| 4. Official Mobile Shell & Unified Provider Registry | 3/3 | In Progress|  |
| 5. Five-Source Listen Journey | 0/TBD | Not started | - |
| 6. Personal Library & Continuity | 0/TBD | Not started | - |
| 7. Offline & Advanced Desktop-Equivalent Playback | 0/TBD | Not started | - |
| 8. Integrated API 35 Acceptance & Release-Like Evidence | 0/TBD | Not started | - |
