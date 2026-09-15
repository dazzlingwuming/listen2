---
phase: 07-offline-advanced-playback
verified: 2026-09-15T15:10:00Z
status: passed
score: 5/5
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 3/5
  gaps_closed:
    - "A current locally-held native entitlement now admits a verified cached blob before network resolution; cache miss/expired grant falls through to online resolution."
    - "Owner rows are now indexes over the canonical blob, legacy copied aliases are purged privately, and quota/eviction/repair operate on the only media bytes."
    - "The cache library has accessible selected/bulk promote/delete actions, while constrained durable work has a foreground notification and cancellation path."
    - "A bounded, source/track/account-generation entitlement receipt now survives catalog reopen and is denied on expiry, account change, identity mismatch, or non-allowed state."
    - "Authority is now source-scoped: restart fails closed for account-bound sources, only explicitly native-classified anonymous-free sources retain bounded offline authority, and Bilibili logout/switch revokes only Bilibili authority."
    - "Initial, retry, and process-recovered transfers are operation-bound to a fresh native grant; cancellation and stale completion cannot publish bytes under a replacement attempt."
  gaps_remaining: []
  regressions: []
---

# Phase 7: Offline & Advanced Desktop-Equivalent Playback Verification Report

**Phase Goal:** Users can keep authorized media offline and use advanced desktop capabilities through real Android behavior or an honest, actionable platform-equivalent state.

**Verified:** 2026-09-15T15:10:00Z at product HEAD `17da1fe`.

**Status:** passed

**Re-verification:** Yes — final source verification after the offline-cache lifecycle closure.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Owner-separated, complete, currently-authorized offline media is recoverable and only then playable. | ✓ VERIFIED (deterministic scope) | `playerController` first asks `authorizeLocalCache`, then opens only a verified canonical cache URI; a cache miss/expired/revoked receipt falls through to online resolution. Room stores source-scoped semantic authority, not transport/session material. On restart account-bound authorities become unknown; only an explicitly native-classified anonymous-free source can reopen until TTL. A resumed transfer needs a fresh native grant bound to its new operation ID; tests prove stale/cancelled attempt completion cannot consume it. |
| 2 | Cache limits and complete cache-library management work on live cache data. | ✓ VERIFIED (deterministic scope) | Room quota/reservations/non-explicit LRU and bounded repair are active. The subscribed cache screen filters/sorts real catalog entries and exposes individual/selected promote/delete plus eligible clear. Durable work is unique, constrained, foreground-notified and cancellable. |
| 3 | Authorized Bilibili rendition/part/MV controls either work or honestly fall back. | ✓ VERIFIED (deterministic scope) | Versioned native descriptors, part/rendition policy, MV fallback, account-sensitive lease validation and request-ID cancellation are substantive and wired. |
| 4 | Effects, real analysis, and loudness normalization operate independently and fail safely. | ✓ VERIFIED (deterministic scope) | Verified cache commit schedules native analysis; the player starts at unity, then applies only bounded completed-cache gain asynchronously. |
| 5 | DeepSeek is Keystore-only, explicitly consented, and native-private through validated persistence. | ✓ VERIFIED (deterministic scope) | Consent fencing, Keystore-only configuration/status, native schema/alignment validation, revisioned private cache and leak boundaries are wired. |

**Score:** 5/5 truths verified in deterministic scope.

## Required Artifacts

| Artifact | Expected | Status | Details |
| --- | --- | --- | --- |
| `OfflineCatalogRepository.kt` | One verified content-addressed blob with owner indexes | ✓ VERIFIED | Owner records are now Room-only indexes; `ready`/`addOwner` never copy bytes. Initialization removes only legacy private `owners/` copies. |
| `OfflineCatalogService.kt` | Source-scoped authorization receipt, recovery, quota and catalog boundary | ✓ VERIFIED | Only a native provider descriptor attaches a bounded receipt. Local reopen validates exact source/track, classified authority, generation, TTL and ready bytes. Initial/retry/resume transfer work obtains a fresh in-memory grant installed before its task starts; restart marks account-bound authority unknown and source revoke clears only that source. |
| `OfflineCore.kt` | Durable constrained acquisition and user cancellation | ✓ VERIFIED | Unique semantic work has network/battery/storage constraints, foreground notification/cancel action, stop cleanup and bounded terminal outcome. It exposes an atomic pre-start binding point so a task cannot race its fresh authorization installation. |
| `LibraryRepository.kt` | Playlist owner lifecycle | ✓ VERIFIED | Accepted add/restore paths link exact ready blob rows; remove/delete paths clear their playlist owner reference with no physical alias to orphan. |
| `playerController.ts` | Offline-first safe playback and temporary owner signal | ✓ VERIFIED | Valid current receipt authorization precedes network resolution; only post-`TrackPlayer.play()` cache media gets `markPlayed`. |
| `CacheLibraryScreen.tsx` | Complete cache management UI | ✓ VERIFIED | Initial snapshot plus native subscription provide live data; owner/status filters, individual and selected bulk actions carry each entry's true source/track identity. |
| Loudness/effects modules | Independent safe audio enhancement | ✓ VERIFIED | Commit → native analyzer → Room metrics → bounded nonblocking player gain is connected. |
| Descriptor/AI native boundaries | Fail-closed entitlement and protected translation | ✓ VERIFIED | Source-scoped lease invalidation, bounded durable cache-authority policy, and safe consent/Keystore projections are connected and covered by deterministic contracts. |

## Key Link Verification

| From | To | Via | Status | Details |
| --- | --- | --- | --- | --- |
| `playerController` | durable source-scoped authority → cache provider | `authorizeLocalCache` → `resolveReady` | ✓ WIRED | This path requires a current exact source/track receipt plus matching classified source authority, TTL and verified canonical bytes; it does no provider/network resolution. |
| cache miss/expiry | native provider resolver | fall-through after local cache denial/miss | ✓ WIRED | Online bootstrap is used only when retained cache cannot be admitted. |
| successful cached playback | temporary owner | `TrackPlayer.play()` → `markCachePlayed` | ✓ WIRED | D-03 owner creation is after actual successful playback, not queue/resolve. |
| personal playlist mutation/restore | playlist owner index | `linkReadyCacheToPlaylist` | ✓ WIRED | Exact ready Room blobs receive/remove playlist references without copying media. |
| owner index | canonical media bytes | Room owner rows → `blobs/` | ✓ WIRED | Copying was removed; legacy alias root is privately purged, and no owner path reaches the provider. |
| `OfflineAcquireWorker` | catalog recovery | semantic source/track → fresh-grant `resumeOutcome`/`awaitTerminal` | ✓ WIRED | Process recreation without a fresh descriptor returns a terminal reauthorization state; a requeue binds the new operation before it starts. No URL/cookie persists in input. |
| cache screen | current catalog | `offlineAudio.subscribe` and bounded action methods | ✓ WIRED | UI list, individual and batch operations consume real native snapshots. |
| source cancellation/account transition | media lease registry → offline authority | request-ID cancel and source revoke | ✓ WIRED | Provider leases are revoked before further native use; Bilibili logout/switch revokes Bilibili cache authority without invalidating unrelated source authority. |

## Data-Flow Trace

| Artifact | Data | Source | Produces real data | Status |
| --- | --- | --- | --- | --- |
| Cache snapshot | Ready Room blobs + active transfer records | DAO/transfer → catalog service → native module → JS parser | Yes | ✓ FLOWING |
| Offline cache admission | Bounded source-scoped semantic receipt for exact track | native descriptor → Room receipt + source authority → `authorizeLocal` → cache provider revalidation | Yes | ✓ FLOWING |
| Owner lifecycle | successful playback + playlist mutation + explicit action | player/library/cache UI → Room owner rows | Yes | ✓ FLOWING |
| Storage accounting | canonical ready blobs/reservations | Room blob rows → quota/LRU/repair | Yes | ✓ FLOWING |
| Loudness gain | verified-blob analysis metrics | catalog analyzer → Room → player | Yes | ✓ FLOWING |

## Behavioral Spot-Checks

| Behavior | Evidence | Result | Status |
| --- | --- | --- | --- |
| Integrated deterministic gate | Supplied current evidence: security scan, 52 Jest suites/258 tests, typecheck, lint and JVM suite | Passed at current closure HEAD | ✓ PASS (recorded evidence) |
| Offline-first authorized cache | Focused `playerController` test `starts a locally authorized retained blob without resolving the network provider` | Native player receives cache URI; provider resolver is not called | ✓ PASS |
| Cache entitlement class | `MediaDescriptorContractTest` anonymous-class selector | Generation zero is denied unless native resolver explicitly classifies it anonymous-free | ✓ PASS |
| Receipt restart/source isolation | `OfflineRecoveryContractTest` authority selectors | Fresh restart denies account-bound authority; only explicit anonymous-free authority survives TTL; switch/logout revokes the matching source only | ✓ PASS |
| Recovered transfer authority | `OfflineRecoveryContractTest` transfer-book selectors | New operation consumes only its own fresh binding; stale completion and cancel race cannot publish with it | ✓ PASS |
| D-03 temporary and playlist owners | Focused player/discover-flow tests plus production trace | Successful cache play adds temporary owner; accepted playlist mutation links Room owner | ✓ PASS |
| One-blob owner storage | Repository source trace | No `copyTo` remains in owner-ready/add flows; private legacy owner copies are purged | ✓ PASS |
| Work cancellation/foreground lifecycle | Worker source trace | Foreground notification has `WorkManager` cancel PendingIntent; `onStopped` cancels semantic transfer | ✓ PASS |

## Requirements Coverage

| Requirement | Status | Evidence |
| --- | --- | --- |
| PLAY-002 | ✓ SATISFIED (deterministic) | Native rendition/part/MV fallback and entitlement/cancellation policy are wired. |
| CACHE-001 | ✓ SATISFIED (deterministic) | Temporary, playlist and explicit causes create distinct Room owners over one verified canonical blob. |
| CACHE-002 | ✓ SATISFIED (deterministic) | A valid source-scoped receipt/authority selects verified cache without network; restart, cache miss, expiry, revoked/unknown/account-invalid authority fails closed. Resume/retry needs a fresh descriptor and atomically binds it to the new attempt; recovery/cancel/repair paths are wired. |
| CACHE-003 | ✓ SATISFIED (deterministic) | 1/2/5/10/unlimited quota, reservation admission and non-explicit LRU account for the only stored media bytes. |
| CACHE-004 | ✓ SATISFIED (deterministic) | Accessible cache UI actions, bounded repair, semantic worker constraints, notification/cancel, and private projection are wired. |
| FX-001 | ✓ SATISFIED (deterministic) | Effect preset/fallback boundary preserves original playback on failure. |
| FX-002 | ✓ SATISFIED (deterministic) | Real native analysis and labelled static/hidden degradation are wired. |
| FX-003 | ✓ SATISFIED (deterministic) | Complete-media identity-bound analysis and nonblocking bounded gain application are wired. |
| AI-001 | ✓ SATISFIED (deterministic) | Keystore-only configuration/status boundary is wired. |
| AI-002 | ✓ SATISFIED (deterministic) | Explicit consent and cancellation/no-call controls are wired. |
| AI-003 | ✓ SATISFIED (deterministic) | Native validation/revision/private-cache and source leak protections are wired. |
| SEC-004 | ✓ SATISFIED (deterministic) | Cache playback needs a bounded native-created receipt plus source-scoped classified authority. Account-bound state is fail-closed after restart; generation zero is allowed only for explicitly native-classified anonymous-free descriptors. No URL/header/cookie/lease identifier persists. |

## Anti-Patterns Found

No blocker or warning anti-pattern remains in the Phase 7 closure files. In particular, the prior `copyTo` owner duplication and remote-before-cache ordering have been removed.

## Phase 8 Evidence Boundary

This deterministic pass does not substitute for Phase 8 device/API-35 acceptance: actual offline flight-mode and process-kill journeys, durable-authority behavior across real provider account lifecycle, WorkManager/Doze/network-change and notification rendering, codec/PiP/effects capability, APK/package/backup scans, and real Keystore/provider credentials remain external runtime evidence. Deterministically, account-bound authority is source-scoped and fails closed after restart; only an explicitly native-classified anonymous-free descriptor may reopen until its TTL. Recovered transfer work likewise requires a fresh process-local native grant bound to its new operation. JS cannot manufacture authority, and no URL/header/cookie/lease identifier persists.

---

_Verified: 2026-09-15T15:10:00Z_

_Verifier: gsd-verifier_
