# Quick Task: Replace the Placeholder React Native Discover - Research

**Researched:** 2026-09-13
**Domain:** Bounded anonymous provider directories for the React Native Discover flow
**Confidence:** MEDIUM

## Summary

Replace the static Discover copy with a provider-owned directory API and keep the screen transport-free. The recommended scope is NetEase featured playlists plus charts, and Kugou charts. Every card carries a semantic collection ID, never an upstream URL; detail routes are constructed only by the adapter after validating that ID. This fits the current client boundary, whose fixed request type accepts only an adapter-created URL/body/profile and explicitly excludes caller headers. [VERIFIED: mobile/src/api/http.ts:17-23] Verbatim: `readonly url: string;`, `readonly method?: 'GET' | 'POST';`, `readonly body?: string;`, and `readonly profile?: 'bilibili' | 'qq';`.

Direct anonymous HTTPS probes on 2026-09-13 confirmed the NetEase routes below: featured listing returned HTTP 200 / `code: 200` / 12 rows; `toplist` returned HTTP 200 / `code: 200` / 63 rows; a discovered collection's detail returned HTTP 200 / `code: 200`; and a fixed song-detail request hydrated all 26 IDs returned for that probe (the existing `tracks` field alone contained only 10). [VERIFIED: direct HTTPS probes against music.163.com, 2026-09-13] Do not hard-code that probe's playlist ID, title, or song data.

Kugou's anonymous HTTPS `rank/list` and `rank/info` routes also returned HTTP 200 in the same probe: the rank list had 55 rows and rank detail pages had 30 songs with a positive numeric total. [VERIFIED: direct HTTPS probes against m.kugou.com, 2026-09-13] Its curated-playlist detail route returned an HTML document rather than parseable JSON in three parameter variants, so the task must **not** present Kugou featured playlists as real content. [VERIFIED: direct HTTPS probes against m.kugou.com, 2026-09-13]

**Primary recommendation:** Add a bounded `getDiscover(source, options)` facade backed by fixed NetEase directory/detail hydration and Kugou chart routes; show Kugou charts only, with a real unavailable state for its featured-playlist section.

## Project Constraints (from AGENTS.md)

- Reuse the current React Native mobile shell and typed shared provider/player contracts; do not introduce a framework migration or a new dependency. [VERIFIED: AGENTS.md, Project Constraints]
- UI code must not provide arbitrary URLs, caller headers, cookies, tokens, or secrets. Keep HTTPS allow-lists, bounded response bodies, timeouts, cancellation, and finite retries at the provider boundary. [VERIFIED: AGENTS.md, Project Constraints]
- Do not bypass membership, DRM, region, or account restrictions. Convert provider failures to visible diagnostic states rather than fake empty results. [VERIFIED: AGENTS.md, Project Constraints]
- Preserve source IDs and provider contracts; use explicit source labels, accessible Android-sized controls, localized messages, and product-safe errors. [VERIFIED: AGENTS.md, Conventions]
- This quick task is documentation/research only: do not install packages, run APK/emulator/CI checks, alter product code, commit, push, merge, or deploy. [VERIFIED: task scope]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|---|---|---|---|
| Discover filter, refresh, skeleton/empty/error surfaces, card accessibility | React Native client | — | The screen owns presentation and invokes only a semantic facade. [VERIFIED: mobile/src/screens/SearchScreen.tsx:38-155] |
| Endpoint construction, validation, JSON mapping and artwork sanitization | API/provider adapter | Client | Existing adapters construct fixed routes and map untrusted fields before returning UI types. [VERIFIED: mobile/src/api/providers.ts:230-300] |
| Remote collection identity and destination | API/provider adapter | Navigation | The navigator transports semantic IDs; it does not transport provider URLs. [VERIFIED: mobile/src/navigation/types.ts:13-21] |
| Queue replacement and first-track resolution | Native player controller | Redux store | Playback loads the selected track before replacing the durable playlist. [VERIFIED: mobile/src/player/playerController.ts:384-407] |

## Standard Stack

### Core

| Component | Version | Purpose | Decision |
|---|---:|---|---|
| Existing React Native / TypeScript client | `react-native` `0.87.1` | Discover UI, navigation and provider facade | Reuse; no new package. [VERIFIED: mobile/package.json:18-25] |
| Existing `requestJson` boundary | in-repo | Timeout, abort, byte bound and typed provider errors | Reuse for every new directory call. [VERIFIED: mobile/src/api/http.ts:66-151] |
| Existing Redux/player controller | in-repo | Transactional first-track start and queue replacement | Reuse for play-all. [VERIFIED: mobile/src/player/playerController.ts:384-407] |

**Installation:** none. [VERIFIED: task scope]

## Endpoint and Mapping Contract

### NetEase — approved scope

| Purpose | Fixed HTTPS route and bounds | Sanitized mapping | Failure rule |
|---|---|---|---|
| Featured playlists | `https://music.163.com/api/playlist/list?cat=全部&order=hot&limit=12&offset=0&total=true`; retain at most 12 rows per refresh. [VERIFIED: direct HTTPS probe against music.163.com, 2026-09-13] | Accept only positive numeric `id`, non-empty bounded `name`, optional creator nickname, positive `trackCount`, and HTTPS artwork with no credentials. [VERIFIED: direct HTTPS probe; mapping policy aligned with mobile/src/api/providers.ts:65-113] | Non-200, non-200 provider code, malformed/oversized list, or no valid rows is a typed `playlist` failure—not a fabricated list. [VERIFIED: mobile/src/api/http.ts:103-147] |
| Charts | `https://music.163.com/api/toplist`; retain at most 12 chart rows in the section. [VERIFIED: direct HTTPS probe against music.163.com, 2026-09-13] | The chart row is mapped to the same NetEase semantic collection grammar as a playlist, after positive-ID/title/artwork checks. [VERIFIED: direct HTTPS probe; mobile/src/api/ids.ts:12-18] | One failed section may render its own retry state while the other successful section remains visible. [ASSUMED] |
| Collection detail | First call `https://music.163.com/api/v3/playlist/detail?id=<validated-id>&n=1000`; accept at most 1,000 `trackIds`, then hydrate only those IDs through fixed `https://music.163.com/api/v3/song/detail?c=<JSON>&ids=<JSON>`. [VERIFIED: direct HTTPS probe against music.163.com, 2026-09-13] Use batches of 50 as a safe query-length/concurrency design limit. [ASSUMED] | Validate ID echo and `code === 200`; preserve returned `trackIds` order, map each hydrated song through the existing NetEase track mapper, and mark any incomplete hydration explicitly. [VERIFIED: direct HTTPS probe; mobile/src/api/providers.ts:151-172] | Cancel outstanding batches on navigation/refresh; if the declared bounded set cannot be hydrated completely, do not describe it as a full collection. [ASSUMED] |

The existing implementation already states `const MAX_PLAYLIST_TRACKS = 1_000;`. [VERIFIED: mobile/src/api/providers.ts:33-36] Retain that ceiling rather than making the directory effectively unbounded. The existing one-call detail mapper is inadequate for a “full bounded detail” claim because it reads only `playlist.tracks`; this was empirically shorter than `trackIds` in the direct probe. [VERIFIED: mobile/src/api/providers.ts:379-389; direct HTTPS probe against music.163.com, 2026-09-13]

### Kugou — approved scope and fail-closed boundary

| Purpose | Fixed HTTPS route and bounds | Sanitized mapping | Failure rule |
|---|---|---|---|
| Chart index | `https://m.kugou.com/rank/list?json=true`; retain at most 12 validated rows. [VERIFIED: direct HTTPS probe against m.kugou.com, 2026-09-13] | Positive numeric `rankid`, bounded `rankname`, optional HTTPS-converted `imge.kugou.com` artwork only after host/credential/path validation. [VERIFIED: direct HTTPS probe against m.kugou.com, 2026-09-13] | Discard invalid rows; classify an all-invalid response as a new typed provider failure. [ASSUMED] |
| Chart detail | `https://m.kugou.com/rank/info/?rankid=<validated-id>&page=<bounded-page>&json=true`; page 1 supplied `songs.list`, `songs.total`, and `songs.pagesize` in the probe. [VERIFIED: direct HTTPS probes against m.kugou.com, 2026-09-13] Bound the maximum number of requested pages/tracks at 1,000. [ASSUMED] | Map `hash` to a `kgtrack_` ID, `songname`, `authors[0].author_name`, duration seconds, and optional validated image; retain original page ordering. [VERIFIED: direct HTTPS probe against m.kugou.com, 2026-09-13] | If total/page metadata is malformed, one page fails, or fewer unique valid tracks than the bounded expected set arrive, render partial/error truthfully and do not call it full. [ASSUMED] |
| Curated playlists | **Do not implement in this quick task.** `plist/index` itself returned rows, but `plist/list/<runtime-specialid>?json=true` returned HTML rather than parseable JSON in the direct probe. [VERIFIED: direct HTTPS probes against m.kugou.com, 2026-09-13] | — | Show a source-section unavailable/retry explanation; do not scrape HTML, send a mobile User-Agent/Referer, or substitute a sample playlist. [VERIFIED: project constraints; direct probe] |

Kugou image fields in the probe were HTTP `imge.kugou.com` URLs with a `{size}` placeholder; dynamically substituting `400` and changing only that exact host's scheme to HTTPS returned HTTP 200 image responses in the probe. [VERIFIED: direct HTTPS probes against imge.kugou.com, 2026-09-13] Do not perform a broad `http:`→`https:` replacement and do not retain the original HTTP URL. [VERIFIED: mobile/src/api/providers.ts:98-113]

### Semantic ID grammar

- Preserve the existing NetEase grammar: `^neplaylist_[1-9][0-9]{0,17}$`. [VERIFIED: mobile/src/api/ids.ts:12-18] This is appropriate for both NetEase featured playlists and NetEase chart collections because both hydrate through the same validated NetEase detail adapter. [VERIFIED: direct HTTPS probes against music.163.com, 2026-09-13]
- Introduce a distinct Kugou chart grammar, `^kgchart_[1-9][0-9]{0,17}$`, rather than mislabelling a rank as `kgplaylist_`. [ASSUMED] Add it to the source resolver and route it only to the Kugou chart-detail adapter.
- The existing registry currently recognizes `kugou` playlist IDs as `^kgplaylist_[1-9][0-9]{0,17}$`, but the public facade only dispatches a NetEase playlist and otherwise throws `ROUTE_UNAVAILABLE`. [VERIFIED: mobile/src/api/ids.ts:12-18; mobile/src/api/client.ts:90-99] Verbatim capability state: `playlist: false,` for `kugou`. [VERIFIED: mobile/src/api/client.ts:43-49]

## Architecture Patterns

### Data Flow

```text
Discover Screen
  -> selected provider (NetEase | Kugou)
  -> providerClient.getDiscover(source, AbortSignal)
  -> fixed adapter route(s) + requestJson bounds
  -> validated semantic collection summaries
  -> accessible card -> PlaylistDetail(remoteCollectionId)
  -> providerClient.getPlaylist(remoteCollectionId, AbortSignal)
  -> bounded detail hydration
  -> playTracks(tracks, index) resolves first media
  -> successful native load -> replacePlaylist -> Player
```

### Recommended implementation seams

1. Add a small, pure directory module under `mobile/src/api/` (or extract pure validation helpers from `providers.ts`) that owns feature/chart mapping and collection-detail hydration. It must use `requestJson`, not raw `fetch`. [VERIFIED: mobile/src/api/http.ts:66-151]
2. Extend the provider facade with semantic discovery and remote-collection dispatch. Keep `DiscoverScreen` unaware of endpoint strings or provider response keys. The current facade already centralizes search/playlist/bootstrap dispatch. [VERIFIED: mobile/src/api/client.ts:78-129]
3. Add a typed discover state machine to `DiscoverScreen`: initial loading, refreshing while stale cards remain, ready, per-section unavailable/error, and all-sections-empty. Use an epoch plus `AbortController`, as Search does, so a late response cannot overwrite a newer source/filter or refresh. [VERIFIED: mobile/src/screens/SearchScreen.tsx:56-149]
4. Reuse `PlaylistDetail` navigation with a semantic remote collection ID. The current route contract explicitly says `remotePlaylistId` is “never a URL or a caller-provided route.” [VERIFIED: mobile/src/navigation/types.ts:13-21]
5. Make play-all await an explicit boolean result from `playerController.playTracks`; navigate to Player only after successful native loading and `replacePlaylist`. Current code already delays `replacePlaylist` until `loadAndPlay` succeeds, but it returns `void`, while the screen navigates synchronously. [VERIFIED: mobile/src/player/playerController.ts:384-407; mobile/src/screens/PlaylistDetailScreen.tsx:99-120]

### UI contract

- Provider filter contains only the directory-capable sources: NetEase and Kugou. All other sources must be absent or visibly unavailable, not selectable into an empty fake feed. [ASSUMED]
- NetEase filter renders “精选歌单” and “热门榜单”; Kugou renders “酷狗榜单” and a precise unavailable state for curated playlists. [VERIFIED: direct HTTPS probes, 2026-09-13]
- Every card is a `Pressable` with a provider-inclusive accessibility label, 48px minimum touch target, title/author/count fallback, safe artwork or icon fallback, and a semantic navigation action. This matches the existing source tabs and search playlist cards. [VERIFIED: mobile/src/components/SourceTabs.tsx:31-54; mobile/src/screens/SearchScreen.tsx:382-406]
- Refresh must cancel the previous request and retain old cards only during a refresh; source change clears cards, increments the request epoch, and cannot accept stale results. [VERIFIED: mobile/src/screens/SearchScreen.tsx:69-73, 128-149]
- Detail loading/error must preserve the existing retry treatment; partial detail needs a visible “returned tracks only” notice and a disabled play-all until the bounded set is complete. [ASSUMED]

## Don’t Hand-Roll

| Problem | Do not build | Use instead | Why |
|---|---|---|---|
| Arbitrary provider transport | UI-supplied URL/header/cookie wrapper | `requestJson` with adapter-owned fixed URLs | It supplies 10s maximum timeout, abort propagation, 1 MiB body limit and typed errors. [VERIFIED: mobile/src/api/http.ts:8-10, 66-151] |
| Queue transaction | New “play all” reducer that pre-replaces the playlist | Existing `playerController.playTracks` with a boolean completion result | It resolves/loads the first item before committing replacement. [VERIFIED: mobile/src/player/playerController.ts:384-407] |
| Artwork trust | Display arbitrary or HTTP image strings | Existing HTTPS sanitizer plus exact Kugou host conversion | Existing sanitizer rejects non-HTTPS URLs and credentials. [VERIFIED: mobile/src/api/providers.ts:98-113] |
| NetEase full detail | Trust `playlist.tracks` as complete | `trackIds` + bounded fixed song-detail batches | Direct probe proved the embedded `tracks` list can be incomplete. [VERIFIED: direct HTTPS probe against music.163.com, 2026-09-13] |

## Legacy Behavior: Port vs. Reject

Port the original author’s useful semantics: NetEase’s distinction between a hot-playlist directory and a toplist, semantic `neplaylist_` identities, Kugou’s semantic source identity, and normalizing a collection to track rows before playback. [VERIFIED: app/listen1_chrome_extension/js/provider/netease.js:78-158, 300-345; app/listen1_chrome_extension/js/provider/kugou.js:180-214, 419-466]

Reject legacy mechanisms: NetEase `weapi` encryption/cookie creation, DOM scraping of Discover HTML, calls to HTTP `mobilecdnbj.kugou.com`, parallel per-track metadata fan-out, and catch-to-empty-result behavior. [VERIFIED: app/listen1_chrome_extension/js/provider/netease.js:34-76, 120-158, 161-216, 265-288; app/listen1_chrome_extension/js/provider/kugou.js:65-102, 135-177] These violate the project’s narrow bridge and diagnosable-error constraints. [VERIFIED: AGENTS.md, Project Constraints]

## Common Pitfalls

1. **Calling partial NetEase detail “full.”** `n=1000` does not ensure the embedded `tracks` array has all IDs. Hydrate the validated `trackIds` batches and expose incompleteness. [VERIFIED: direct HTTPS probe against music.163.com, 2026-09-13]
2. **Misclassifying provider failure as empty.** Empty is valid only after a structurally valid response has no valid mapped rows; timeout, cancellation, malformed JSON, non-200, and provider codes stay typed failures. [VERIFIED: mobile/src/api/http.ts:103-147; mobile/src/api/errors.ts:8-42]
3. **Kugou HTTP artwork or curated-detail scraping.** Only preserve the exact verified HTTPS image host conversion; do not use the HTML playlist detail as a data API. [VERIFIED: direct HTTPS probes against m.kugou.com and imge.kugou.com, 2026-09-13]
4. **Navigating after failed play-all.** The controller currently catches first-track failure and returns; callers need a success result before opening Player. [VERIFIED: mobile/src/player/playerController.ts:389-407]
5. **Late refresh overwrites a new source.** Reuse Search’s abort/epoch pattern rather than a simple `isLoading` boolean. [VERIFIED: mobile/src/screens/SearchScreen.tsx:69-110]

## Validation Architecture

### Test Framework

| Property | Value |
|---|---|
| Framework | Jest with `@react-native/jest-preset`. [VERIFIED: mobile/jest.config.js:1-6] |
| Existing provider tests | `mobile/src/api/__tests__/client.test.ts`. [VERIFIED: mobile/src/api/__tests__/client.test.ts:1-16] |
| Existing player transaction tests | `mobile/src/player/__tests__/playerController.test.ts`. [VERIFIED: mobile/src/player/__tests__/playerController.test.ts:87-175] |
| Focused command | `npm --prefix mobile test -- client.test.ts playerController.test.ts` (not run in this research). [ASSUMED] |

### Required focused cases

| Behavior | Test type | Acceptance |
|---|---|---|
| NetEase featured and charts | adapter unit | Exact fixed HTTPS paths/parameters; cap 12; reject malformed/non-200/oversized payloads; semantic `neplaylist_` output. [VERIFIED: direct probes; mobile/src/api/__tests__/client.test.ts:68-118] |
| NetEase full bounded detail | adapter unit | Validate root ID/code; preserve ID order; incomplete song batches signal partial/error rather than success. Test the proposed 50-ID batch ceiling separately. [ASSUMED] |
| Kugou chart index/detail | adapter unit | Exact HTTPS rank routes; map hash/author/duration; reject non-HTTPS artwork except exact verified transformation. Test the proposed 12/1,000 display/detail bounds separately. [ASSUMED] |
| Kugou curated playlist | adapter unit | Parser failure is typed/unavailable and never yields fixture/sample cards. [VERIFIED: direct probe against m.kugou.com, 2026-09-13] |
| Discover state | component test | Provider filter, cancellation/epoch, refresh, error, empty, per-section unavailable, accessible card navigation. [ASSUMED] |
| Play-all transaction | player/controller and screen test | Failed first bootstrap/native load preserves prior playlist/current item and does not navigate; success loads first, replaces playlist exactly once, then navigates. [VERIFIED: mobile/src/player/playerController.ts:389-407; mobile/src/player/__tests__/playerController.test.ts:109-175] |

## Security Domain

| ASVS Category | Applies | Control |
|---|---|---|
| V5 Input Validation | Yes | Validate semantic IDs, response shapes, collection sizes, titles/artwork, all provider numeric identifiers, and byte size. [VERIFIED: mobile/src/api/providers.ts:38-113; mobile/src/api/http.ts:106-123] |
| V3 Session Management | Yes | Anonymous directory routes only; no UI cookie/token/header input and no credential persistence. [VERIFIED: mobile/src/api/http.ts:66-75] |
| V4 Access Control | Yes | Provider capability map gates UI operations; add discovery/detail capability only for approved sources. [VERIFIED: mobile/src/api/client.ts:24-71] |
| V6 Cryptography | No new control | Use platform TLS via HTTPS; do not port custom `weapi` crypto. [VERIFIED: project constraints; app/listen1_chrome_extension/js/provider/netease.js:34-76] |

## Assumptions Log

| # | Claim | Risk if Wrong |
|---|---|---|
| A1 | Per-section partial success is the intended Discover UX. | A product decision may instead require all-or-nothing refresh. |
| A2 | A distinct `kgchart_` grammar is preferable to reusing `kgplaylist_`. | Existing callers may expect only playlist ID prefixes; update resolver/tests together. |
| A3 | Incomplete hydrated detail should disable play-all. | Product may choose playback of verified returned subset, but must label it partial. |

## Sources

- [VERIFIED: direct HTTPS probes against music.163.com, 2026-09-13] Anonymous response status, bounded list/detail behavior, and dynamic song-detail hydration only; provider APIs remain external and may drift.
- [VERIFIED: direct HTTPS probes against m.kugou.com and imge.kugou.com, 2026-09-13] Rank routes and exact image-host HTTPS probe; curated playlist detail was not accepted as JSON.
- [VERIFIED: mobile/src/api/http.ts:66-151] Existing transport boundary.
- [VERIFIED: mobile/src/api/providers.ts:33-390] Existing validation, ID mapping, and NetEase detail implementation.
- [VERIFIED: app/listen1_chrome_extension/js/provider/netease.js:78-158, 300-345; app/listen1_chrome_extension/js/provider/kugou.js:180-214, 419-466] Original-author behavioral reference only.
- [ASSUMED] Web search results were non-authoritative endpoint discussions and were not used as the basis for any endpoint approval.

## Environment Availability

Skipped: this is research only; the task explicitly prohibits package installation, APK/emulator/CI work, and no external runtime tool is needed to plan the source-level implementation. [VERIFIED: task scope]
