---
phase: quick-260914-iuc-five-source-mobile-lyric-parity
plan: "01"
type: execute
wave: 1
depends_on: []
files_modified:
  - mobile/src/api/http.ts
  - mobile/src/api/providers.ts
  - mobile/src/api/client.ts
  - mobile/src/api/ids.ts
  - mobile/src/types/provider.ts
  - mobile/src/bilibili/types.ts
  - mobile/src/bilibili/lyrics.ts
  - mobile/src/bilibili/__tests__/lyrics.test.ts
  - mobile/src/api/__tests__/client.test.ts
  - mobile/src/api/__tests__/fixtures/providerLyrics.ts
  - mobile/src/lyrics/cache.ts
  - mobile/src/lyrics/__tests__/cache.test.ts
  - mobile/src/components/BilibiliLyricPicker.tsx
  - mobile/src/screens/PlayerScreen.tsx
  - mobile/src/screens/__tests__/bilibiliLyricsFlow.test.tsx
  - mobile/src/screens/__tests__/playerTranslationBehavior.test.tsx
  - mobile/src/screens/__tests__/deepSeekFlow.test.tsx
  - mobile/src/deepseek/types.ts
  - mobile/src/deepseek/client.ts
  - mobile/src/deepseek/__tests__/client.test.ts
  - mobile/android/app/src/main/java/com/listen2mobile/deepseek/DeepSeekPolicy.kt
  - mobile/android/app/src/test/java/com/listen2mobile/deepseek/DeepSeekContractTest.kt
autonomous: true
requirements:
  - QUICK-MOBILE-LYRIC-PARITY-001
estimate:
  tokens: 64000
  raw_tokens: 64000
  tasks: 3
  confidence: medium
must_haves:
  truths:
    - "NetEase and QQ lyric behavior remains working; bounded dormant Kugou/Kuwo adapters and fixtures are source-complete but production capabilities remain false until final device evidence, while Bilibili lyric resolution uses only the existing fixed NetEase/QQ search plus lyric contracts."
    - "Kugou JSONP is fetched as bounded text and parsed with JSON.parse only; no eval, Function, script injection, caller URL, caller header, cookie, or arbitrary route exists. Kuwo parses only its fixed JSON response and never fabricates a platform translation."
    - "A Bilibili lyric candidate is always attached to the exact bitrack_v_<BVID>-<CID> selection; automatic application uses fixed high-confidence title/artist/duration gates, while manual selection exposes bounded NetEase/QQ candidates and can restore automatic resolution."
    - "Bilibili manual/automatic lyric records are bounded, versioned, atomically published, revision-guarded, and keyed by exact BVID plus CID; a second part can never inherit the first part's lyric. Manual records are sticky and automatic records expire."
    - "Original lyric, provider/platform translation, and DeepSeek machine translation remain separate fields and reversible UI states; DeepSeek never overwrites the source or provider translation."
    - "Every lyric, candidate, cache, and translation operation has abort/cancel and monotonic identity guards; late results cannot clear loading, replace another track, or overwrite a newer manual choice, and lyric failures never interrupt playback."
    - "DeepSeek accepts Bilibili only for an explicitly matched lyric and exact Bilibili track hash, performs cache-only lookup before consent, requires all six consent fields for network/force refresh, and never auto-connects or handles a Bilibili endpoint."
    - "Kugou/Kuwo live route behavior gates later capability enablement and DeepSeek live-key behavior remains human-needed evidence; dormant source/parsers/fixtures/tests are complete regardless of device/JDK availability."
  artifacts:
    - path: "mobile/src/api/providers.ts"
      provides: "Fixed bounded NetEase/QQ/Bilibili existing contracts plus Kugou JSONP and Kuwo JSON lyric adapters"
      contains: "getKugouLyric|getKuwoLyric"
    - path: "mobile/src/bilibili/lyrics.ts"
      provides: "Exact BVID/CID lyric candidate orchestration, normalization, deterministic scoring, and strict auto selection from NetEase/QQ"
      contains: "AUTO_MATCH_THRESHOLD"
    - path: "mobile/src/lyrics/cache.ts"
      provides: "Versioned bounded exact-identity Bilibili lyric cache with atomic publication and revision checks"
      contains: "expectedRevision"
    - path: "mobile/src/components/BilibiliLyricPicker.tsx"
      provides: "Accessible bounded candidate search, manual selection, and restore-auto sheet"
      contains: "BilibiliLyricPicker"
    - path: "mobile/src/deepseek/client.ts"
      provides: "Strict Bilibili-aware provider/trackHash adapter while preserving existing NetEase/QQ consent behavior"
      contains: "bilibili"
    - path: "mobile/android/app/src/main/java/com/listen2mobile/deepseek/DeepSeekPolicy.kt"
      provides: "Native DeepSeek provider allow-list including explicit Bilibili matched lyrics"
      contains: "isEligibleProvider"
    - path: "mobile/src/bilibili/__tests__/lyrics.test.ts"
      provides: "Pure scorer, candidate, exact identity, and provider-fallback contracts"
      contains: "describe"
    - path: "mobile/src/screens/__tests__/bilibiliLyricsFlow.test.tsx"
      provides: "Auto/manual/cache/stale/cancel/player UI regression coverage"
      contains: "describe"
  key_links:
    - from: "mobile/src/api/client.ts"
      to: "mobile/src/bilibili/lyrics.ts"
      via: "Bilibili getLyric receives the full exact Track and delegates only to existing NetEase/QQ search and lyric adapters"
      pattern: "resolveBilibiliLyric"
    - from: "mobile/src/bilibili/lyrics.ts"
      to: "mobile/src/api/providers.ts"
      via: "providerFor('netease'|'qq') search plus getNetEaseLyric/getQqLyric fixed contracts"
      pattern: "getNetEaseLyric|getQqLyric"
    - from: "mobile/src/screens/PlayerScreen.tsx"
      to: "mobile/src/lyrics/cache.ts"
      via: "exact BVID/CID cache-first lyric load, revision-guarded manual save, and restore-auto invalidation"
      pattern: "lyricCache"
    - from: "mobile/src/screens/PlayerScreen.tsx"
      to: "mobile/src/components/BilibiliLyricPicker.tsx"
      via: "bounded candidate query, partial/error state, selection, and restore-auto controls"
      pattern: "BilibiliLyricPicker"
    - from: "mobile/src/screens/PlayerScreen.tsx"
      to: "mobile/src/deepseek/client.ts"
      via: "explicit Bilibili matched-lyric translation uses provider bilibili and exact current track ID/hash"
      pattern: "hashTrack"
    - from: "mobile/src/deepseek/client.ts"
      to: "mobile/android/app/src/main/java/com/listen2mobile/deepseek/DeepSeekPolicy.kt"
      via: "the same provider allow-list and SHA-256 track identity are validated in JS and native"
      pattern: "trackHash"
---

<objective>
Deliver a source-complete five-source lyric slice in canonical `mobile/`: fixed Kugou JSONP and Kuwo JSON lyric adapters, exact Bilibili BVID/CID automatic and manual lyric selection from the already-approved NetEase/QQ search-plus-lyric contracts, bounded exact-part caching, stale/cancel protection, and explicit DeepSeek translation for matched Bilibili lyrics.

Preserve the existing QQ lyric contract and playback transaction. Do not add a Bilibili lyric endpoint, LRCLIB, an arbitrary URL/header/cookie bridge, or any live-network/device dependency to the implementation. Kugou/Kuwo route truth and any DeepSeek live-key/device proof are final human-needed acceptance items, not reasons to omit source, fixture, tests, or UI.
</objective>

<execution_context>
@/Users/fluenteng/.codex/gsd-core/workflows/execute-plan.md
@/Users/fluenteng/.codex/gsd-core/templates/summary.md
</execution_context>

<execution_gate>
This is the implementation plan only. During execution, modify only the listed canonical `mobile/` files and preserve all unrelated tracked/untracked changes. Do not run npm install/update, real provider requests, a live DeepSeek request/key, APK assembly, APK install, emulator/device actions, merge, deploy, or commit as part of this plan. Use mocked fetch/native transports and checked-in fixtures for automated evidence. Run the focused Kotlin test only when a usable JDK 17 is already present; otherwise report that gate as `not verified`, without reducing source or tests. Final Kugou/Kuwo network behavior and DeepSeek key behavior are human-needed acceptance evidence.
</execution_gate>

<context>
@AGENTS.md
@mobile/README.md
@mobile/package.json
@mobile/src/types/provider.ts
@mobile/src/api/http.ts
@mobile/src/api/client.ts
@mobile/src/api/providers.ts
@mobile/src/api/ids.ts
@mobile/src/bilibili/types.ts
@mobile/src/bilibili/client.ts
@mobile/src/screens/PlayerScreen.tsx
@mobile/src/screens/BilibiliDetailScreen.tsx
@mobile/src/screens/__tests__/bilibiliFlow.test.tsx
@mobile/src/deepseek/types.ts
@mobile/src/deepseek/client.ts
@mobile/src/deepseek/consent.ts
@mobile/src/deepseek/__tests__/client.test.ts
@mobile/src/screens/__tests__/playerTranslationBehavior.test.tsx
@mobile/src/screens/__tests__/deepSeekFlow.test.tsx
@app/listen1_chrome_extension/js/provider/kugou.js
@app/listen1_chrome_extension/js/provider/kuwo.js
@app/listen1_chrome_extension/js/provider/bilibili.js
@app/listen1_chrome_extension/js/controller/play.js
@app/listen1_chrome_extension/test/bilibili_lyric_translation.test.js
@android/app/src/main/java/com/dazzlingwuming/listen2/BilibiliLyricProvider.java
@android/app/src/test/java/com/dazzlingwuming/listen2/BilibiliLyricProviderTest.java
</context>

<locked_decisions source="approved provider audit and project constraints">
- D-01: The canonical target is React Native `mobile/`; desktop and legacy `android/` code are behavioral/test-vector references only.
- D-02: Existing NetEase and QQ mobile lyric routes remain unchanged and covered. Bilibili candidates are obtained exclusively by calling the existing fixed NetEase/QQ search adapters followed by the existing fixed NetEase/QQ primary lyric adapters. No Bilibili lyric/player endpoint, `lyricUrl`, LRCLIB, or new native Bilibili route may be invented or called.
- D-03: Kugou lyric uses only the fixed HTTPS JSONP route from the provider source: `https://wwwapi.kugou.com/yy/index.php?r=play/getdata&callback=jQuery&mid=1&hash=<validated hash>&platid=4&album_id=<validated AlbumID>&_=<internal timestamp>`. The `hash` and numeric `AlbumID` are semantic fields, not URLs. If a track lacks a valid AlbumID, fail closed without a request. JSONP is text plus strict `JSON.parse`; never `eval`, `Function`, DOM script, or caller callback.
- D-04: Kuwo lyric uses only `https://m.kuwo.cn/newh5/singles/songinfoandlrc?musicId=<validated numeric ID>`, with the bounded JSON `status/data.lrclist` contract. The legacy Kuwo source cannot prove a separate translation timeline, so `translation` remains absent rather than copying original text into it. No cookie bootstrap or caller header is allowed.
- D-05: Fixed bounds are query <=256 UTF-8 bytes, page size <=20, provider response rows <=50, Bilibili/NetEase/QQ candidate fetch <=6 per provider and final display <=10, lyric text <=512 KiB, Kuwo lyric rows/timed lines <=400, one request timeout <=10 seconds, and Kugo/Kuwo response text <=1 MiB before the stricter lyric parser. All text rejects controls and unsafe markup where the existing contract requires it.
- D-06: Scoring is deterministic: NFC/lowercase/punctuation-normalized title variants (at most 8), title weight `.70`, artist `.18`, duration `.08`, rank bonus at most `.04`, version penalty `.20`. Manual display cutoff is `.30`. Automatic application requires title >= `.92`, artist >= `.88`, duration known and within `max(10s,10%)`, total >= `.93`, and bounded timed lyric content. A provider-translation candidate wins only when its score is within `.04` of the best candidate. Missing duration never auto-applies but may remain manually selectable.
- D-07: Bilibili cache identity is exact `bitrack_v_<BVID>-<CID>` / `bilibili:<BVID>:<CID>`; no base-BVID alias for any multipart selection. Automatic records expire after 30 days. Manual records are sticky until Restore automatic. Cache writes use bounded two-slot/versioned publication, serialized writes, expected revision, and one current-identity-checked retry; corrupt data never silently overwrites valid data.
- D-08: Lyric `text`, provider/platform `translation`, and DeepSeek machine translation are separate. A Bilibili selected candidate records `matchedProvider` (`netease` or `qq`) and `matchedCandidateId`, while DeepSeek hashes `provider='bilibili'` with the exact Bilibili track ID. DeepSeek network work is explicit only: cache-only first, six consent fields before network, force-refresh only after consent, and no automatic network translation.
- D-09: Candidate/lyric failures settle to safe loading/partial/empty/unavailable/retry states and never alter playback, queue, history, or current-track activation. Late results must fail the exact track/CID/epoch/revision guard.
- D-10: Kugou/Kuwo routes are source-complete from repository behavior and fixtures but have no new live-device proof in this plan; mark them `human-needed`. The same applies to a user-supplied DeepSeek key. Do not downgrade implementation scope because JDK/device/network evidence is unavailable.
- D-11: Keep `PROVIDER_CAPABILITIES.kugou.lyric` and `.kuwo.lyric` false and keep production `providerClient.getLyric` returning typed unavailable until final device evidence validates each fixed route; tests may invoke the dormant adapters directly through a test-only export. Bilibili lyric capability may be enabled because it composes the already-enabled NetEase/QQ contracts and introduces no unverified provider route.
- D-12: Export one canonical Bilibili track parser from `mobile/src/api/ids.ts` and use it in Bilibili client, lyric/cache, and DeepSeek JS. It accepts only exact `bitrack_v_<BVID>-<CID>` with a positive decimal CID that is a JavaScript safe integer; reject base BVID for lyric/DeepSeek and cover the safe-integer boundary. Native DeepSeek independently enforces the same BVID pattern and positive CID range; it never trusts JS provenance alone.
</locked_decisions>

<interfaces>
Existing contracts to preserve:
- `mobile/src/api/http.ts` owns bounded fetch, timeout, AbortSignal, fixed provider profiles, and response parsing; UI never supplies URL, headers, cookies, or body.
- `providerClient.search(source, query, page, options)` already constructs the fixed NetEase/QQ search routes and returns discriminated semantic `Track` results; `getNetEaseLyric` and `getQqLyric` already return bounded `Lyric` objects.
- `mobile/src/bilibili/client.ts` and `BilibiliDetailScreen.tsx` establish exact `bitrack_v_<BVID>-<CID>` identities. Search must still open detail and never assume page one.
- `PlayerScreen.tsx` owns lyric epochs, AbortController cancellation, timeline rendering, and the current explicit DeepSeek consent flow. Keep the existing QQ and NetEase behavior.
- Native `Listen2DeepSeek` already owns the key, endpoint, headers, cache, cancellation, consent validation, and `trackHash`; only the provider allow-list and Bilibili identity vectors change.

New closed contracts created by this plan:
- `Track.providerAlbumId?: string` is an optional validated semantic AlbumID used only by Kugou lyric construction; it is never a URL or transport/header field.
- `Lyric.provenance` contains only mode (`auto|manual`), matched provider/candidate ID, numeric match score, and optional translation provider; machine translation remains Player state/native DeepSeek cache.
- `BilibiliLyricCandidate` contains semantic candidate ID, matched provider (`netease|qq`), title/artist/album/duration, bounded original `text`, optional provider `translation`, numeric `matchScore`, and `hasTranslation`; it contains no route, URL, headers, cookies, or provider body.
- `resolveBilibiliLyric(track, options)` returns a `Lyric` whose `source` and `trackId` are the exact Bilibili selection while preserving matched-provider provenance. It may return `no-lyric`/partial-safe results but never fabricate text.
- `bilibiliLyricCache` exposes `get(identity)`, `put(record, expectedRevision)`, `clear(identity)`, and `list/repair`; all records are bounded and exact-CID keyed, with source/platform fields separate and revision/status explicit.
- `DeepSeekTranslateRequest.provider` expands only to `netease|qq|bilibili`; `hashTrack('bilibili', exactBilibiliTrackId, lyricHash)` must be identical in JS and native. Kugou/Kuwo do not gain implicit DeepSeek eligibility in this batch.
</interfaces>

<tasks>

<task type="tracer" tdd="true">
  <name>Task 1: Freeze fixed Kugou/Kuwo adapters, Bilibili NetEase/QQ candidates, scorer, and exact cache</name>
  <files>mobile/src/api/http.ts, mobile/src/api/providers.ts, mobile/src/api/client.ts, mobile/src/api/ids.ts, mobile/src/types/provider.ts, mobile/src/bilibili/types.ts, mobile/src/bilibili/client.ts, mobile/src/bilibili/lyrics.ts, mobile/src/api/__tests__/fixtures/providerLyrics.ts, mobile/src/api/__tests__/client.test.ts, mobile/src/bilibili/__tests__/lyrics.test.ts, mobile/src/lyrics/cache.ts, mobile/src/lyrics/__tests__/cache.test.ts</files>
  <behavior>
    - Existing NetEase and QQ primary lyric responses, QQ first-party Referer, error mapping, and capability behavior remain unchanged.
    - Kugou constructs only the fixed HTTPS JSONP route from a validated `kgtrack_<hash>` plus semantic numeric AlbumID, reads bounded text, requires an exact `jQuery(<JSON>);` envelope, calls `JSON.parse`, validates `data.lyrics`, and never evaluates provider text. Missing AlbumID, malformed callback, controls, oversize text, no lyric, timeout, cancellation, and non-2xx status become stable typed errors.
    - Kuwo constructs only the fixed HTTPS `newh5/singles/songinfoandlrc` route from `kwtrack_<positive numeric ID>`, validates `status===200` and a bounded `data.lrclist`, emits deterministic original LRC, and leaves platform translation absent when the provider does not supply a distinct verified timeline.
    - Bilibili candidate search receives a full exact Bilibili Track, calls only existing `providerFor('netease').search` and `providerFor('qq').search` page one, scores rows before fetching at most six lyrics per provider through existing `getNetEaseLyric`/`getQqLyric`, deduplicates semantic candidate IDs, returns partial results when one provider fails, and throws only when all providers fail. It never calls Bilibili lyric/player metadata or a new route.
    - The scorer implements D-06, bounds variants/candidates, rejects unsafe or untimed lyric text for automatic application, applies the strict `.93` auto gate, and uses the `.04` platform-translation tie-break without replacing a selected original lyric body.
    - `providerClient.getLyric` accepts the exact Track when Bilibili needs title/artist/duration, preserves the string-ID overload for NetEase/QQ, enables Bilibili only through the candidate resolver, and keeps Kugou/Kuwo production dispatch unavailable until the final evidence gate. Dormant fixed adapters are fixture-tested directly and no native Bilibili lyric capability is added.
    - The Bilibili cache uses AsyncStorage only behind `mobile/src/lyrics/cache.ts`, with two bounded slots plus a head/revision marker (or equivalent recoverable atomic publication), a versioned exact-CID record, serialized writes, max 64 records/max 4 MiB aggregate lyric text, 512 KiB record text, 30-day auto expiry, sticky manual mode, and one expected-revision retry. It stores original/provider fields and provenance only; no URL/header/cookie/token/raw provider response.
  </behavior>
  <action>Write the pure fixture and cache/scorer tests first. Extend the internal fixed-text transport helper in `http.ts` without exposing a public arbitrary-URL API: it inherits existing timeout/AbortSignal/bounds and adapter-owned headers only. Add `providerAlbumId` only when Kugou search returns a canonical positive AlbumID. Implement dormant `getKugouLyric` and `getKuwoLyric` with the exact routes, strict JSONP `JSON.parse`, bounded schema/LRC conversion, and typed failures; export them only through a clearly named test/internal seam while D-11 keeps production capability/dispatch false. Add the D-12 canonical Bilibili parser and replace duplicate parsing in client/lyrics. In `bilibili/lyrics.ts`, use that exact identity, bounded hints, existing NetEase/QQ search/lyric functions, provenance, and pure scoring. Implement the recoverable exact-CID cache with revision checks and safe corruption handling. Enable Bilibili lyric through the candidate resolver, retain NetEase/QQ behavior, keep Kugou/Kuwo unavailable in production, and test both dormant adapters plus unavailable public dispatch. Do not alter PlayerScreen or DeepSeek beyond closed types.</action>
  <verify>
    <automated>npm --prefix mobile test -- --runInBand src/api/__tests__/client.test.ts src/bilibili/__tests__/lyrics.test.ts src/lyrics/__tests__/cache.test.ts &amp;&amp; npm run mobile:typecheck</automated>
  </verify>
  <done>Focused fixtures and Jest prove exact fixed Kugo/Kuwo routes, JSONP no-eval parsing, missing AlbumID fail-closed behavior, bounded LRC conversion, unchanged QQ/NetEase lyric behavior, Bilibili candidates sourced only from existing NetEase/QQ search-plus-lyric functions, deterministic strict scoring/tie-break, and exact-CID atomic cache/revision/expiry/manual semantics. TypeScript compiles; no new Bilibili route or transport authority exists.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Integrate Bilibili auto/manual lyric UI, cache lifecycle, and stale-safe player states</name>
  <precondition>Task 1 has completed the fixed provider adapters, exact Bilibili candidate resolver, Lyric provenance shape, and cache API. Execute Task 2 strictly after Task 1; it consumes those contracts and owns only the lyric-loading/candidate UI region of PlayerScreen.</precondition>
  <files>mobile/src/components/BilibiliLyricPicker.tsx, mobile/src/screens/PlayerScreen.tsx, mobile/src/screens/__tests__/bilibiliLyricsFlow.test.tsx, mobile/src/screens/__tests__/playerTranslationBehavior.test.tsx</files>
  <behavior>
    - On lyric open, local tracks remain unavailable without network; Bilibili first reads exact BVID/CID cache, then resolves automatic NetEase/QQ candidates; Kugou/Kuwo use their fixed primary adapters; NetEase/QQ keep their current primary path. Lyric failure never changes playback state.
    - Bilibili automatic result is applied only when its exact current track/CID, epoch, candidate generation, and strict match gates still hold. If no strict result exists, the user sees a truthful empty/manual-search state instead of a guessed lyric.
    - The picker has a bounded query, loading, partial-results, empty, retry/error, and selection state. It shows at most 10 semantic candidates with provider/title/artist/album/duration/score and a platform-translation badge; no URL, raw response, cookie, header, or internal transport identity renders.
    - Choosing a candidate stores the selected original lyric plus optional provider translation, matched provider/candidate ID, score, mode=manual, and exact BVID/CID revision. Restore automatic clears only the current exact identity and re-runs auto; a second part cannot read or clear the first part's record.
    - Every auto/search/manual request has AbortController plus monotonic request/selection tokens and captures exact `track.id`, parsed BVID/CID, and cache revision. Track change, part change, unmount, close, a newer query, or a newer selection cancels/invalidates old work. A stale response cannot clear a newer loading/error/result state.
    - All buttons and candidate rows have accessible Chinese labels, roles, and at least 48dp targets. Existing lyrics timeline remains source-first; provider translation is rendered separately and remains restorable.
  </behavior>
  <action>Write `bilibiliLyricsFlow.test.tsx` first with mocked candidate promises, cache revisions, and current-track changes. Add `BilibiliLyricPicker` as a phone-sized `Sheet` child with explicit search/choose/restore/cancel controls, 48dp targets, safe fixed copy, and no transport props. Refactor only the lyric state/loading region of `PlayerScreen`: pass the full current Track to `providerClient.getLyric`, cache Bilibili exact records before network, invoke the Task 1 resolver, maintain the existing NetEase/QQ/Kugou/Kuwo paths, and keep playback controls independent. On a strict auto miss, retain a playable player and expose the picker; on a manual choose, persist with `expectedRevision` and retry once only if current identity/tokens still match. On restore, clear the exact cache record and machine-translation display for that identity before resolving again. Ensure `Lyric.text` is always original, `Lyric.translation` is only provider/platform translation, and provenance never contains URL/header/cookie. Keep the existing DeepSeek code path structurally intact for Task 3's provider expansion; do not make Bilibili network translation automatic here. Extend the existing player translation tests only where the new Bilibili lyric state changes shared mocks, and add assertions that QQ behavior and playback/queue/history remain unchanged on every lyric failure.
  <verify>
    <automated>npm --prefix mobile test -- --runInBand src/screens/__tests__/bilibiliLyricsFlow.test.tsx src/screens/__tests__/bilibiliFlow.test.tsx src/screens/__tests__/playerTranslationBehavior.test.tsx &amp;&amp; npm run mobile:typecheck</automated>
  </verify>
  <done>Focused UI tests prove exact BVID/CID cache-first auto resolution, manual candidate search/selection, restore-auto, platform-translation separation, partial/error/empty accessibility states, request cancellation and stale suppression across track/part/query/selection changes, and no lyric failure affecting playback. Existing QQ/NetEase translation behavior still passes.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Extend DeepSeek Bilibili allow-list and finish full five-source verification contract</name>
  <precondition>Task 2 has completed exact Bilibili lyric provenance and UI guards. Execute Task 3 strictly after Task 2; it owns the DeepSeek provider/trackHash region of PlayerScreen and the native/JS DeepSeek allow-list tests.</precondition>
  <files>mobile/src/deepseek/types.ts, mobile/src/deepseek/client.ts, mobile/src/deepseek/__tests__/client.test.ts, mobile/android/app/src/main/java/com/listen2mobile/deepseek/DeepSeekPolicy.kt, mobile/android/app/src/test/java/com/listen2mobile/deepseek/DeepSeekContractTest.kt, mobile/src/screens/PlayerScreen.tsx, mobile/src/screens/__tests__/playerTranslationBehavior.test.tsx, mobile/src/screens/__tests__/deepSeekFlow.test.tsx</files>
  <behavior>
    - DeepSeek provider validation accepts only the existing NetEase/QQ plus `bilibili`; both JS and native independently require matched provenance and the D-12 exact safe-range `bitrack_v_<BVID>-<CID>` identity. Kugou/Kuwo and unmatched/empty Bilibili lyrics remain unavailable for DeepSeek in this batch.
    - JS and native compute `trackHash = SHA-256(provider + "\\n" + sourceTrackId + "\\n" + lyricHash)` identically. Equal lyric text on another BVID/CID, another provider, or another lyric revision cannot hit or apply the translation cache.
    - Source original and provider/platform translation remain visible/restorable; a successful DeepSeek result is machine translation state only. A failure, cancellation, invalid alignment, missing key, or stale result leaves source fields untouched.
    - Translation remains explicit: first call is cache-only with no consent/network; a cache miss opens the existing six-disclosure sheet; only all six accepted fields allow network; force-refresh always requires that same explicit consent. No lyric hydration, playback, candidate search, or cache write triggers network translation.
    - Native endpoint/model/prompt/headers/key vault/cache/cancellation remain unchanged and native-owned; only provider allow-list and Bilibili track identity vectors expand. No Bilibili endpoint or caller transport field is introduced.
  </behavior>
  <action>Write Bilibili provider/hash and D-12 boundary vectors into existing TypeScript and Kotlin DeepSeek tests first. Extend the request provider to `bilibili`, retain consent/LRC bounds, and hash the exact Bilibili track ID rather than the matched candidate ID. Add a native source-specific validator in DeepSeekPolicy which parses the BVID and decimal CID itself, rejects base IDs, malformed/zero/overflow/out-of-range CID, and requires the supplied sourceTrackId before computing/accepting trackHash; JS provenance cannot substitute this native check. In PlayerScreen permit translation only for current matched Bilibili provenance, pass provider bilibili, preserve epoch/hash guards, and keep Kugou/Kuwo unavailable. Test cache hit, consent-gated miss/force, cancellation, BVID/CID/hash changes, source restore, safe errors, and JS/native parser parity. Keep native endpoint/header/key/cache ownership unchanged and do not persist lyric/consent/machine/transport data in Redux/AsyncStorage backup.</action>
  <verify>
    <automated>npm --prefix mobile test -- --runInBand src/deepseek/__tests__/client.test.ts src/screens/__tests__/deepSeekFlow.test.tsx src/screens/__tests__/playerTranslationBehavior.test.tsx &amp;&amp; npm run mobile:typecheck</automated>
  </verify>
  <done>Focused JS and Kotlin-source contracts prove Bilibili-only explicit DeepSeek eligibility, cross-CID/provider trackHash isolation, six-consent/cache-first/no-auto-network behavior, cancellation/stale suppression, strict source/platform/machine separation, and unchanged QQ behavior. The native endpoint and credentials remain untouched.</done>
</task>

</tasks>

<verification>
Run each task's focused Jest/typecheck command, then run the complete JavaScript and static gates from the final tree:

1. `npm --prefix mobile test -- --runInBand`.
2. `npm run mobile:typecheck`.
3. `npm --prefix mobile run lint` (full mobile ESLint; do not substitute a single file).
4. `cd mobile && npx --no-install prettier --check src/api/http.ts src/api/providers.ts src/api/client.ts src/api/ids.ts src/types/provider.ts src/bilibili/types.ts src/bilibili/client.ts src/bilibili/lyrics.ts src/bilibili/__tests__/lyrics.test.ts src/api/__tests__/client.test.ts src/api/__tests__/fixtures/providerLyrics.ts src/lyrics/cache.ts src/lyrics/__tests__/cache.test.ts src/components/BilibiliLyricPicker.tsx src/screens/PlayerScreen.tsx src/screens/__tests__/bilibiliLyricsFlow.test.tsx src/screens/__tests__/playerTranslationBehavior.test.tsx src/screens/__tests__/deepSeekFlow.test.tsx src/deepseek/types.ts src/deepseek/client.ts src/deepseek/__tests__/client.test.ts`.
5. `IUC_METRO_DIR="$(mktemp -d /tmp/listen2-iuc-metro.XXXXXX)" && cd mobile && npx --no-install react-native bundle --platform android --dev false --entry-file index.js --bundle-output "$IUC_METRO_DIR/index.android.bundle" --assets-dest "$IUC_METRO_DIR/assets"` (Metro only; no APK assembly).
6. If and only if `java -version` shows an already-installed JDK 17, run `cd mobile/android && ./gradlew --offline --no-daemon :app:testDebugUnitTest --tests 'com.listen2mobile.deepseek.DeepSeekContractTest'`; otherwise record the Kotlin gate as `not verified`. Do not install JDK/Gradle/dependencies.

Automated tests must use mocked `fetch`, native modules, and the checked-in provider fixture; no Kugou/Kuwo/Bilibili/DeepSeek real request is allowed. Before any later commit (outside this plan's write-only action), inspect the diff for arbitrary URL/header/cookie/eval/script leakage, raw provider text in errors/logs, lyric/cache/consent/key expansion into backup or Redux, generated files, legacy `android/`/desktop edits, and unrelated user changes. A passing local suite does not close the human-needed Kugou/Kuwo route or DeepSeek-key/device evidence.
</verification>

<device_acceptance>
Human-needed, outside the automated plan gate: on an authorized Android environment, verify the fixed Kugou JSONP route returns a parseable bounded lyric for a real semantic hash+AlbumID and that the app never sends caller cookies/headers; verify the fixed Kuwo JSON route returns a bounded `lrclist` and no fabricated translation. Verify a real Bilibili multipart selection can obtain candidates only through the existing NetEase/QQ search-plus-lyric contracts, manual/restore behavior survives restart with CID isolation, and lyric failure leaves playback active. With a user-supplied DeepSeek key kept outside the repository, verify only explicit six-consent Bilibili matched-lyric translation, cache/stale/cancel/source-restore behavior, and absence of key/lyric/transport data from RN state, backup, logs, and artifacts. If either fixed provider route has changed, retain the typed unavailable/error state and open a provider decision rather than inventing a route.
</device_acceptance>

<threat_model>
| Boundary | Required protection |
|---|---|
| RN UI → fixed provider adapters | Only semantic IDs and bounded metadata; no URL/header/cookie/body authority from UI. |
| Provider text/JSONP → lyric model | Bounded text, exact envelope/schema, JSON.parse only, controls/size/timeline validation, typed failure. |
| Bilibili part identity → candidate/cache | Exact BVID/CID plus epoch/revision; no base-ID alias across multipart selections. |
| Lyric source → DeepSeek | Explicit matched provenance, exact source hash, six consent fields, cache-first, no automatic network. |
| Lyric failure → player | Safe localized error/state only; never queue/history/current-track mutation or playback interruption. |
</threat_model>

<success_criteria>
- All five mobile sources have truthful lyric behavior: NetEase/QQ remain enabled, Bilibili is enabled only through existing NetEase/QQ contracts, and dormant bounded Kugou/Kuwo adapters remain unavailable in production until their explicit final device evidence gates pass.
- Bilibili exact BVID/CID auto scoring, manual selection, restore-auto, exact-CID atomic cache, stale/cancel guards, and accessible UI are covered by focused tests.
- Original lyric, provider translation, and explicit DeepSeek machine translation remain separate; Bilibili DeepSeek uses exact trackHash and never auto-connects.
- Complete JS Jest, typecheck, full lint, Prettier, and Metro checks are specified; Kotlin is attempted only with existing JDK 17 and otherwise reported `not verified`.
- Kugou/Kuwo real route and DeepSeek live-key/device behavior are explicitly `human-needed`; no unknown Bilibili endpoint, LRCLIB, arbitrary URL/header/cookie bridge, APK, install, or real network call is introduced.
</success_criteria>
