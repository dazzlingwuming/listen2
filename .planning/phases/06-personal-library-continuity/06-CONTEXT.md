---
phase: 06-personal-library-continuity
slug: personal-library-continuity
status: planning-baseline
canonical_root: mobile/
created: 2026-09-15
decision_source: roadmap-requirements-and-explicit-autonomous-task-scope
---

# Phase 6 — Personal Library & Continuity: Canonical Context

## Planning authority and decision hygiene

This document records the already-approved product direction in
`.planning/ROADMAP.md`, `.planning/REQUIREMENTS.md`, `.planning/PROJECT.md`,
`.planning/STATE.md`, the Phase 5 mobile artifacts, and the explicit scope of
this autonomous planning task. No new product decision was made interactively
while creating it.

The canonical implementation route is the independent React Native application
under `mobile/` with Kotlin native modules under `mobile/android/`. The older
`android/` WebView project, Electron/Angular sources, and the archived
`legacy-webview-plans/` are reference material only. They are not Phase 6
write targets, implementation authorities, or acceptance evidence.

Items labelled **planning default — not a user decision** below are conservative
implementation assumptions derived from the research and existing contracts.
They keep planning unblocked; they must not be represented as a new product
approval. If implementation needs a materially different behavior, the plan
must stop at that boundary and record the decision before widening scope.

## Locked goal and outcome

Phase 6 lets an Android user safely own and continue their personal music data:

1. distinguish personal playlists, favorites, remote provider collections, and
   local music;
2. perform playlist/favorite mutations with durable ordering and safe failure;
3. see honest provider account state and complete the existing Bilibili QR
   session lifecycle without exposing credentials;
4. import, inspect, play, repair, or remove local audio through Android SAF;
5. export and restore an allow-listed personal backup; and
6. record genuine listening and view an honest annual recap across restarts.

The phase owns these 15 requirements and no others:

`LIB-001`, `LIB-002`, `LIB-003`, `AUTH-001`, `AUTH-002`, `AUTH-003`,
`LOCAL-001`, `LOCAL-002`, `LOCAL-003`, `DATA-001`, `DATA-002`, `DATA-003`,
`HIST-001`, `HIST-002`, `HIST-003`.

The roadmap success criteria remain the acceptance target: confirmed library
state survives rapid edits/restart; account state is truthful; SAF media is
repairable and source-labelled; backup merge/overwrite is previewed and safe;
and history counts only valid listening. A screen or a successful mocked call
is not by itself one of those outcomes.

## Current facts that constrain the plan

- `mobile/src/store/index.ts` currently persists player and library state with
  Redux Persist/AsyncStorage. The library reducer is still an in-memory
  mutation owner, so it is not yet the required Room source of truth.
- `mobile/src/types/music.ts` and `mobile/src/localAudio/picker.ts` currently
  carry a raw `content://` value in the TypeScript local-track model. This is a
  migration target, not a safe Phase 6 interface.
- `mobile/src/backup/backupCodec.ts` already bounds and rejects several unsafe
  fields, but the current portable shape still contains queue data. That is
  useful validation foundation, not DATA-002 completion.
- `mobile/android/app/src/main/java/com/listen2mobile/bilibili/BilibiliSession.kt`
  and `BilibiliVault.kt`, plus the existing Bilibili JS/JVM contracts, provide a reusable native-only
  account boundary. Phase 6 must preserve it rather than duplicate credential
  state in JS.
- `mobile/android/app/src/main/java/com/listen2mobile/offline/OfflineCore.kt`
  and its tests are an existing download/cache foundation. They are read-only context for this phase; their
  media-byte, quota, offline, and download lifecycle behavior belongs to Phase
  7 and cannot close a Phase 6 requirement.
- There is currently no Phase 6 Room database/repository, Preferences DataStore,
  native SAF local-library module/provider, valid-listening ledger, or recap
  persistence. Existing `librarySlice`, picker, backup, player, and Bilibili
  tests therefore remain partial evidence until the new owners and tests exist.

## Locked scope and future plan ownership

The following are planning placeholders for the later executable plans. The
files do not exist yet; naming them here does not claim that implementation has
started.

| Future plan placeholder | Owns | Requirements / phase exit |
|---|---|---|
| `06-01-PLAN.md` — native durable foundation | Room entities/DAOs/repository, exported schema, native bridge/package, Preferences DataStore flags, and copy-validate-activate migration instrumentation | Opens `DATA-001` and supplies the native persistence prerequisite for `LIB-003`; failed migration retains legacy readable data |
| `06-02-PLAN.md` — Redux cutover and rollback | Safe native client/projection, boot hydration gate, Redux ownership removal, production AsyncStorage migration handshake and later-start readback | Closes the cutover/recovery portion of `DATA-001` and `LIB-003` without an invented empty library |
| `06-03-PLAN.md` — library, backup, account | Room-backed CRUD/receipts/source status, strict portable backup preview/merge/overwrite with Room rollback instrumentation, fixed account matrix and Bilibili public QR/logout UI | Owns `LIB-001`, `LIB-002`, `LIB-003`, `AUTH-001`, `AUTH-002`, `AUTH-003`, `DATA-002`, `DATA-003` |
| `06-04-PLAN.md` — native SAF import and metadata | Independent LocalAudioPackage, multi-select grant ownership, bounded metadata/artwork and explicit LRC selection projected as opaque records | Owns `LOCAL-001` and the import/metadata portion of `LOCAL-002` |
| `06-05-PLAN.md` — private local playback and repair | Non-exported tokenized read-only provider, RNTP handoff, revoke/non-seekable states, repair and removal without source deletion | Closes `LOCAL-002` and owns `LOCAL-003`; real cloud-provider/device behavior remains Phase 8 |
| `06-06-PLAN.md` — native valid-listening ledger | Independent HistoryPackage, exact threshold/exclusions, Room evidence/aggregates, restart/year behavior, preference and clear-generation fence | Owns the native source of truth for `HIST-001`, `HIST-002`, `HIST-003` |
| `06-07-PLAN.md` — RNTP history adapter and recap/privacy UX | Lifecycle-safe asynchronous RNTP observations, disposable projection, recent/history/recap, opt-out/export/irreversible clear UI | Closes `HIST-001`, `HIST-002`, `HIST-003` without blocking first playback |

Plans must remain vertical and sequential: storage ownership before UI cutover,
library/account/backup before local-media integration, and those before the
history ledger consumes the durable player/library identities. A plan must stop
and report a split if it needs a second player, arbitrary bridge authority,
Phase 7 cache ownership, or a new requirement.

## Architecture and ownership boundaries

### Native durable data

Room is the relational source of truth for user-visible durable state: playlist
identity and membership order, favorites, safe track metadata, queue checkpoints
and lyric metadata needed for restoration, local-record metadata, history rows
and aggregates, migration/import receipts, and the schema-level cache catalog
required by `DATA-001`. Room stores no media bytes, signed media URL, cookie,
token, API key, raw diagnostic, or third-party grant value in a JS-visible DTO.

Preferences DataStore is limited to small non-sensitive flags such as the
history-recording preference, migration/backend marker, and other bounded
settings explicitly approved by a later plan. It must not become a JSON blob
for playlists, queue/history lists, local records, or secrets.

Redux remains a disposable rendering projection after cutover. A mutation is
visible only from a matching native receipt/snapshot; stale revisions reload the
projection instead of silently reconciling two writable stores.

### Account and secret boundary

The account matrix is a public capability/status projection. Bilibili QR begin,
poll, cancel, refresh, and logout reuse the existing native session and
Keystore-backed vault. Only safe public state (for example, status and an
allowed display name/avatar) can cross to React Native. Refresh material,
cookies, tokens, API keys, QR internals, and protected-cache references remain
native-only. Logout removes identifiable session/protected references but does
not delete playlists, history, or local records.

No other provider gets a sign-in button merely because its desktop adapter,
search tab, or legacy mobile code exists. An unverified or unavailable route is
a visible terminal state with a safe reason and no fabricated success.
The account matrix order is fixed by the UI contract: QQ 音乐, 酷狗音乐, 酷我音乐,
咪咕音乐, Taihe, 哔哩哔哩, 网易云音乐.

### SAF and local playback boundary

Android owns `ACTION_OPEN_DOCUMENT`, persistable grants, `ContentResolver`,
metadata/artwork/duration extraction, and local repair. Room stores an
app-owned local-record identity and safe display metadata; the third-party
`content://` grant is held only by native code. A non-exported, read-only app
provider resolves that opaque record identity for RNTP at playback handoff.

React Native must never persist, render, log, export, put in accessibility text,
or send through a general bridge a raw `content://`/`file://` URI, absolute
path, bookmark, grant, or native exception. Revoked, moved, unreadable,
unsupported, duplicate, and non-seekable files remain repair/remove states and
never delete the original device file.

### Playback and history boundary

RNTP remains the sole audio, MediaSession, and audio-focus owner. Phase 6 may
observe confirmed semantic player events and persist checkpoints/history, but it
must not create a second player or put transport URLs into library/history
records. The history adapter sends bounded semantic occurrence/track data to a
native asynchronous ledger. The ledger, not a progress timer or `recordRecent`,
decides the valid-play threshold, exactly-once commit, date/year grouping, and
clear-generation fence.

### Backup boundary

The portable document is a versioned, strictly allow-listed user export of
personal playlists, favorite playlists, and necessary non-sensitive remote
metadata only. It excludes queue/checkpoint, local tracks and handles, paths,
URI grants, lyrics/translation, settings/theme, cache/download catalog and
media, account/session material, credentials, and raw logs. Parse and preview
must be side-effect free; merge is the default; overwrite requires a second
destructive confirmation; apply is one native transaction with a receipt and
rollback-safe failure.

## Conservative defaults — not user decisions

These defaults are the safest compatible choices for planning and test fixtures.
They do not change the requirements or grant permission to weaken a boundary.

| Topic | Conservative default | Why it is safe / what remains open |
|---|---|---|
| Annual recap date | Capture the device-local completion date/year when a valid play is committed | Makes a committed record stable across restart and time-zone changes; a different product time-zone policy would require an explicit decision |
| Legacy-data retention | Keep the legacy AsyncStorage source until one later startup verifies the Room snapshot, then clean it separately | Preserves recovery after a failed migration; retention duration/UI is not a new product decision |
| Account actions | Render the seven-provider matrix, but expose a login CTA only for the existing controlled Bilibili QR route | Avoids fake parity for QQ, Kugou, Kuwo, Migu, Taihe, or NetEase; new provider login requires its own approved route/fixture |
| LRC association | Prefer explicit LRC selection for a document grant; adjacent discovery is allowed only inside a separately reviewed directory-grant scope | A single-document grant does not authorize sibling enumeration |
| Playlist duplicates | Preserve the established `(source, semanticTrackId)` de-duplication rule; keep play-next occurrences independently duplicable | Matches current library/player behavior without conflating collection identity with queue occurrence |
| Mutation presentation | Keep the last confirmed projection until a native receipt; reject stale revisions and reload | Prevents optimistic order/favorite fiction during rapid edits or process recovery |
| History preference | Use the existing user preference semantics, defaulting only through an explicit persisted non-sensitive setting; disabling stops new ledger commits without deleting old records | Separates privacy control from irreversible clear and avoids inventing a new consent model |

If implementation cannot honor a default without broadening permissions or
changing a requirement, stop at that boundary and leave the item pending rather
than silently deciding for the user.

## Evidence and completion contract

Phase 6 implementation evidence is deterministic and scoped to `mobile/`:

- each future plan has focused JS/TS tests for its own happy path, failure path,
  race/revision path, and redaction boundary;
- the full mobile Jest suite, typecheck, lint, and formatting gate pass after
  the focused gate;
- relevant Kotlin/JVM repository/policy contracts pass with the repository's
  offline Gradle test command; and
- Room migration and SAF/provider behavior have the planned instrumentation
  evidence where JVM tests cannot prove Android storage semantics.

The per-requirement matrix in `06-VALIDATION.md` is the authority for which
focused, full, JVM, and instrumentation evidence is required. A future plan may
be implementation-complete only when its mapped evidence and negative cases
pass, its safe DTO/backup scans are clean, and no requirement is quietly left
as an inferred capability.

The following are deliberately retained for Phase 8 and cannot be claimed by a
Phase 6 unit, JVM, or fake-provider test:

- one installed integrated APK on an API 35 emulator and the complete combined
  journey;
- live provider responses, actual entitlement/region/codec behavior, a
  user-owned Bilibili account, and actual cloud SAF providers/files;
- screen-off/background RNTP, notification/lock-screen, audio focus/noisy,
  headset/Bluetooth, Activity/renderer/process recovery and real media control;
- real 320 dp/inset/IME/rotation/font-scale/contrast/reduced-motion/TalkBack
  behavior;
- cold-start, first-search, first-audio, memory/CPU/battery/network and ten
  minute ANR/recovery measurements; and
- debug/minified release-like APK packaging, upgrade, alignment, signature,
  hash, secret-scan, and release-like artifact checks.

No APK, live provider/account, device, signing, merge, or deployment action is
authorized in this planning task. `parity-ready` remains impossible until
Phase 8 closes its integrated gates, even if all Phase 6 deterministic tests
pass.

## Do-not-cross list

- Do not edit `android/`, the Electron/Angular application, generated Android
  outputs, or archived Phase 5 WebView plans as part of Phase 6.
- Do not make Phase 7 claims about download/cache bytes, cache eviction,
  offline playback, MV/PiP/rendition, effects, loudness, or DeepSeek
  translation. Existing seams may be preserved, but ownership and acceptance
  stay in Phase 7.
- Do not use arbitrary URL/header/cookie/token bridges, broad storage
  permission, raw local handles, or a generic native JavaScript interface.
- Do not turn a page entry, an HTTP 200, a cached fixture, a JVM pass, or an APK
  build into a user-journey or parity claim.
- Do not write credentials, cookies, keys, signed URLs, local user data, raw
  backup payloads, or runtime logs into these planning artifacts.

## Canonical references

- `.planning/PROJECT.md` — project constraints and simulator/evidence boundary.
- `.planning/ROADMAP.md` — Phase 6 goal/success criteria and Phase 7/8 fences.
- `.planning/REQUIREMENTS.md` — the 15 owned IDs, exact user outcomes, and
  traceability.
- `.planning/STATE.md` — current Phase 5 position and retained foundation facts.
- `06-RESEARCH.md` — storage/SAF/history recommendations and known gaps.
- `06-PATTERNS.md` — mobile file ownership, bridge, migration, and test analogs.
- `06-UI-SPEC.md` — screen hierarchy, copy, accessible states, and focus rules.
- `.planning/phases/05-five-source-listen-journey/05-CONTEXT.md` — canonical
  `mobile/` route and Phase 8 acceptance partition.
- `.planning/phases/05-five-source-listen-journey/05-VALIDATION.md` and
  `COVERAGE.md` — focused/full mobile test and evidence conventions.
