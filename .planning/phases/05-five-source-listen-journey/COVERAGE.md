# Phase 5 Coverage and Completion Gate

**Plan-set posture:** `BLOCKED_EXTERNAL_ROUTE_EVIDENCE`

**Original ROADMAP goal, preserved verbatim:** “Within a user's actual authorization, each official mobile source and Bilibili supports a coherent phone journey from search to details, playback, and lyrics.”

These plans do not weaken or claim that goal. They deliver two production-capable fixture journeys, dormant/probe-ready A-class native clients, a truthful five-source selector, and mixed queue/lyric semantics. QQ/Kugou/Kuwo production capabilities remain false until exact-SHA Phase-8 live/provider/device evidence; QQ/Kugou/Kuwo still lack approved playable media contracts, and Kuwo search/detail uses prohibited legacy transport.

A verifier must return `gaps_found`, `blocked`, or `not verified` until approved media contracts plus exact-SHA Phase-8 evidence exist, or the user explicitly changes the ROADMAP. Passing plans, fixtures, CI or APK assembly alone cannot produce `passed`.

## Plan / Dependency Index

| Plan | Wave | Depends | Outcome |
|---|---:|---|---|
| 05-01 | 1 | — | Explicit resolver factory; unknown/media-false → unavailable, never Bilibili |
| 05-02 | 2 | 05-01 | Independent Bilibili fixture journey and exact NetEase-catalog fallback attribution |
| 05-03 | 3 | 05-02 | Independent NetEase fixture journey and selected-source page lifecycle |
| 05-04 | 4 | 05-03 | QQ A-class fixed native clients/probe seam; production all false |
| 05-05 | 5 | 05-04 | Kugou A-class fixed native clients/probe seam; production all false |
| 05-06 | 6 | 05-05 | Kuwo lyric native client/probe seam; closed production capability/B-C matrix |
| 05-07 | 7 | 05-06 | One selected-source surface with per-source cached/restorable scope; no fan-out |
| 05-08 | 8 | 05-07 | Mixed-source occurrence-safe queue and authoritative Media3 snapshot/UI |
| 05-09 | 9 | 05-08 | Identity-safe lyric clock/manual/offset/UI and exact Bilibili fallback label |

Dependencies are acyclic and sequential because plans 04-06 share typed contract/facade files, plans 07-09 share page/player files, and each consumes the preceding closed contract.

## Production Capability Matrix After Phase 5 Implementation

Client existence and fixture success are not production capability. The production facade stays:

| Source | search | directory | detail | media | lyric | manualLyric | fallback | login | permission |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| NetEase | true | true | true | true | true | false | false | false | false |
| Kugou | **false** | **false** | **false** | **false** | **false** | false | false | false | false |
| Kuwo | **false** | **false** | **false** | **false** | **false** | false | false | false | false |
| QQ | **false** | **false** | **false** | **false** | **false** | false | false | false | false |
| Bilibili | true | true | true | true | true | false | false | false | false |
| Migu | false | false | false | false | false | false | false | false | false |
| Taihe | false | false | false | false | false | false | false | false | false |

Primary selector order remains exactly `netease`, `kugou`, `kuwo`, `qq`, `bilibili`; Migu/Taihe do not appear as primary tabs. Selecting a production-false provider shows its trusted-name unavailable state and makes no request.

`Bilibili.lyric=true` does not mean provider-native lyric: whenever its current implementation matches the NetEase catalog, native DTO, visible text and accessible state must explicitly identify `netease-primary-for-bilibili` as fallback/degraded.

## A / B / C Route Coverage

| Source/operation | Class | Phase-5 implementation | Production state |
|---|---|---|---|
| QQ track/playlist search | A | Fixed native `u.y.qq.com/cgi-bin/musicu.fcg` request factory, injectable transport, bounded mapper/fixtures | false; direct native Phase-8 probe only |
| QQ playlist/album detail | A | Fixed playlist and album CGI request factories/mappers/fixtures | false; direct native Phase-8 probe only |
| QQ media | B | Failure/entitlement mapper fixtures only; no resolver/dynamic stream base use | false |
| QQ lyric/account | C | No Referer/CORS/cookie/account workaround | false |
| Kugou track search | A | Fixed native `songsearch.kugou.com/song_search_v2` client/fixtures | false; direct native Phase-8 probe only |
| Kugou playlist/detail | A | Fixed `m.kugou.com/plist/list/{id}` plus bounded fixed song-info mapping | false; direct native Phase-8 probe only |
| Kugou lyric | A | Fixed `wwwapi.kugou.com/yy/index.php`; exact JSONP parsed as data | false; direct native Phase-8 probe only |
| Kugou media | B | Arbitrary returned URL discarded; no resolver | false |
| Kugou HTTP enrichment | C | No upgrade/proxy/substitution/request | false |
| Kuwo lyric | A | Fixed `m.kuwo.cn/newh5/singles/songinfoandlrc` request factory/mapper | false; direct native Phase-8 probe only |
| Kuwo search/detail/media/account | C | No cookie, derived Secret/header or raw media request | false |

Desktop adapters provide technical migration evidence only. They are not provider approval or live-route evidence. A fixture never changes the production matrix.

## Requirement / Backstop Coverage

| Requirement | Plans | Deterministic implementation evidence | Completion posture |
|---|---|---|---|
| NET-003 | 05-02, 05-07, 05-09 | Bilibili BVID/CID/media/fallback lyric journey and retained UI state | live API-35/provider evidence open |
| NET-004 | 05-03…05-09 | NetEase closed fixture; independent fields; dormant A clients; B/C false | external providers production-false; original full outcome open |
| SRCH-001 | 05-02…05-07 | Selected-source query/page/request/cancel/stale terminal and cache restore | five-source live search blocked; supported-source contract planned |
| SRCH-002 | 05-02, 05-03, 05-07 | Capability-declared detail, Bilibili parts, cursor/context restoration | live/rotation evidence open |
| SRCH-003 | 05-02…05-07 | Source-labelled rows and actionable unavailable/error states | rendered accessibility evidence open |
| PLAY-001 | 05-01, 05-06, 05-08, 05-09 | Closed resolver, semantic commands, sole native snapshot/clock | integrated device evidence open |
| PLAY-003 | 05-01, 05-02, 05-03, 05-08 | Bilibili/NetEase playback/control failure retention; external no-fallback | **five-source playback blocked by absent media contracts** |
| PLAY-004 | 05-08 | FIFO, duplicates, reorder/remove/clear, checkpoint/restore/source order | renderer/device evidence open |
| PLAY-005 | 05-08 | Fisher–Yates, repeat, real previous history, retry/no double consume | device evidence open |
| PLAY-006 | 05-08 | Native service/snapshot/focus/noisy state-machine contracts | notification/lock-screen/headset/Bluetooth/process evidence open |
| LYR-001 | 05-02, 05-03, 05-09 | Bilibili attributed fallback and NetEase primary identity-safe clock projection | live lyric evidence open |
| LYR-002 | 05-02, 05-03, 05-09 | Manual/offset/translation persistence where supported; explicit degradation | rendered/device evidence open |
| LYR-003 | 05-02, 05-05, 05-06, 05-09 | Stale/no-fabrication/provenance/accessibility contracts | TalkBack exact-APK evidence open |

All 13 Phase-5 requirement IDs appear in plan frontmatter. No row is removed, weakened or declared complete here.

## Multi-Source Coverage Audit

### GOAL

| Item | Coverage | Status |
|---|---|---|
| GOAL-05 five source search → detail → playback → lyrics | All nine plans implement every safe prerequisite and truthful gap; this document preserves the missing media/search/live evidence | **BLOCKED, not omitted** |

### REQ

Covered IDs: `NET-003`, `NET-004`, `SRCH-001`, `SRCH-002`, `SRCH-003`, `PLAY-001`, `PLAY-003`, `PLAY-004`, `PLAY-005`, `PLAY-006`, `LYR-001`, `LYR-002`, `LYR-003`. See the table above for exact plans and open backstops.

### RESEARCH

| Item | Plan | Status |
|---|---|---|
| Explicit unknown-source unavailable factory before new identities | 05-01 | COVERED |
| Independent Bilibili regression and exact fallback attribution | 05-02 | COVERED |
| Independent NetEase regression and page lifecycle | 05-03 | COVERED |
| All QQ A fixed routes with route/schema/cancel/bounds fixtures | 05-04 | COVERED, production false |
| All Kugou A fixed routes with strict JSONP fixtures | 05-05 | COVERED, production false |
| Kuwo A lyric route plus B/C closed matrix | 05-06 | COVERED, production false |
| A clients use native injected production path for later live probe | 05-04…05-06 | COVERED |
| Desktop route evidence is technical, not approval/live status | 05-04…05-06, validation | COVERED |
| One active selected-source lifecycle and safe normalized UI | 05-03, 05-07 | COVERED |
| Sole Media3 mixed queue/snapshot | 05-08 | COVERED |
| Identity/revision-safe lyrics and fallback provenance | 05-02, 05-09 | COVERED |
| Focused tests, no new dependencies, no per-feature APK | Every plan/validation | COVERED |
| External media/live/device gap prevents completion | This gate | COVERED AS BLOCKER |

### CONTEXT

The context has no `D-NN` labels; audit IDs below only make traceability stable.

| IDs | Locked decision group | Plans | Status |
|---|---|---|---|
| CTX-01..04 | Exact provider order/reference, source-prefixed identity, retained distinct terminal states | 05-02/03/07/08/09 | COVERED |
| CTX-05..09 | Regress Bilibili/NetEase; independent false-until-evidence fields; no legacy transport; fail closed | 05-01…06 | COVERED |
| CTX-10..13 | Single semantic lifecycle, normalized rows, restorable detail, exact BVID/CID/provider IDs | 05-02/03/07 | COVERED |
| CTX-14..17 | Sole Media3 owner, resolver proof, mixed queue/history/checkpoint, failure retains occurrence | 05-01/02/03/08 | COVERED |
| CTX-18..21 | Full lyric identity, preserved manual/offset/translation, visible degradation, no old/guessed lyric | 05-02/03/09 | COVERED |
| CTX-22..24 | Cohesive focused testing/no per-feature APK; full fixtures; Phase-8 evidence boundary | All plans/validation/gate | COVERED |

### UI-SPEC

| UI contract | Plans | Evidence boundary |
|---|---|---|
| Four-tab hierarchy and exact five-source selector | 05-07 | DOM; device Phase 8 |
| One selected-source surface, paging/cancel/cache restoration, no fan-out | 05-03/07 | Node contract |
| Source-labelled rows, unavailable/error copy, detail/Bilibili parts | 05-02/03/07 | JVM/Node; rendered device Phase 8 |
| Sole-snapshot mini/full player and occurrence-aware queue/confirmations/Back | 05-08 | JVM/Node; system/device Phase 8 |
| Lyrics/manual/offset/translation and exact fallback/degraded label | 05-02/09 | JVM/Node; TalkBack Phase 8 |
| 320dp/200%/safe-area/48dp/semantics/live status/reduced motion/redaction | 05-07/08/09 | Static/DOM; visual/TalkBack Phase 8 |

Deferred exclusions remain Phase 6 account/session, Phase 7 cache/download/MV/effects, and Phase 8 integrated APK/live/device/accessibility/performance/release-like evidence. They do not waive Phase-5 success criteria; affected criteria remain open.

## Verifier Stop Rules

Stop with an open gap if any of these is true:

- Any QQ/Kugou/Kuwo production field is true before exact-SHA Phase-8 evidence and reviewed activation.
- A packaged-page request can reach a dormant A client while its production capability is false, or fixture success mutates production capability.
- Discover starts requests for non-selected sources, renders provider sections/fan-out, or fails to restore isolated source cache.
- A Bilibili NetEase-catalog lyric lacks exact `netease-primary-for-bilibili` fallback/degraded visible and accessible attribution, or a stale result can overwrite current lyric.
- Unknown/false media reaches another provider or generic resolver; a failure consumes/reidentifies the queue.
- Any B/C path, caller transport authority, secret, raw URL or credential is reachable/exposed.
- Live Bilibili/NetEase, approved QQ/Kugou/Kuwo media, PLAY-006 system/lifecycle, LYR-003 TalkBack, or full exact-SHA CI/device evidence is absent.

Execution completion is not product-goal completion; the hard external evidence gap remains explicit.
