# Phase 7 Code Patterns and Ownership Map

## Canonical Placement

All new or modified product files are under `mobile/`. The mappings below name the closest current analogs. They are patterns to extend, not proof that the required Phase 7 behavior already exists.

| New responsibility | Closest existing analog | Implementation direction |
|---|---|---|
| Provider-neutral media descriptor and lease | `bilibili/BilibiliModule.kt`, `qq/QqPlaybackModule.kt`, `kuwo/KuwoPlaybackModule.kt` | Replace every registered raw bootstrap module with bounded descriptor adapters; add native NetEase/Kugou adapters and keep transport/native secrets out of React payloads |
| Safe remote stream URI | `offline/OfflineAudioModule.kt` content provider, `local/LocalMediaProvider.kt` | API 26+ uses package-owned proxy URI; API 24/25 serves verified local media or returns download-first unsupported; never surface path or signed URL |
| Bilibili part/rendition entitlement | `bilibili/BilibiliGateway.kt`, `BilibiliMvPolicy.kt` | Return authorized choices from native response and reject caller-forged quality/part IDs |
| Provider error normalization | `mobile/src/api/errors.ts`, `api/nativePlayback.ts`, `player/playerErrorCopy.ts` | Stable code/stage/source/action only; sanitize native exception text |
| Cache catalog | `library/LibraryDatabase.kt` and exported Room schemas | Explicit migration, transactional DAO operations, no destructive fallback |
| Atomic offline transfer | `offline/OfflineCore.kt` | Retain attempt-specific partial files, fsync/hash/signature/atomic publication; add durable resume and owners |
| Durable background work | existing Android application registration + Gradle dependencies | Unique WorkManager work per media identity, constraints, foreground notification, cancellation cleanup |
| Cache UI state | `offline/offlineAudio.ts`, `store/downloadSlice.ts`, `SettingsScreen.tsx` | Move bounded cache projections/actions into a focused cache-library domain/screen |
| Effect bridge | `history/HistoryModule.kt` and `deepseek/DeepSeekModule.kt` | Narrow React Native module with versioned payloads and stable status codes |
| Player native integration | `patches/react-native-track-player+4.1.2.patch` | Extend pinned patch with a native-only actual-session and fixed-gain seam; do not edit generated `node_modules` as source |
| Player controls | `player/playerController.ts`, `PlayerScreen.tsx` | Capability-aware commands and explicit fallback copy; preserve playback on failures |
| Loudness worker | cache WorkManager pattern plus pure policy classes | Separate decoder side effects from pure LUFS/gain/invalidation calculations |
| DeepSeek key/payload boundary | `deepseek/DeepSeekVault.kt`, `DeepSeekClient.kt`, `DeepSeekPolicy.kt`, `deepseek/client.ts` | Keystore-only sealed results; validate/persist natively; expose safe projection only |
| Backup exclusions | `backup/backupCodec.ts`, Android backup rules/manifest | Keep semantic library data while excluding cache, private media, leases, analysis raw data, credentials, and lyric/model payloads |

## Existing Contract Conventions to Preserve

- Kotlin policy helpers stay package-private and Android-free where possible so JVM tests can instantiate them.
- React Native methods validate an exact versioned key set before doing work and resolve/reject with stable codes. Unknown keys are rejected rather than ignored at privileged boundaries.
- JS adapters validate both request and response shapes before returning domain objects. Raw native errors are converted to existing `ProviderClientError`/safe UI copy.
- Provider requests retain HTTPS-only exact host/path/query allow-lists, bounded redirects, bounded response bodies, explicit deadlines, cancellation, and no caller-supplied headers.
- Sensitive native state is never emitted via device events. Events carry bounded semantic status and opaque IDs only.
- Room remains the sole relational owner. Every schema change increments the version, exports a schema, adds an explicit migration, and includes a migration/DAO contract test.
- Ready files use private application storage and are opened through an app-owned content provider. File paths never cross React Native.
- Physical owner alias directories are distinct from the single content-addressed blob directory. Partial files are attempt-scoped under a separate non-addressable directory; ready publication is atomic and only a ready catalog row can resolve. A cancellation tombstone prevents a late worker completion from publishing.
- TypeScript uses two spaces, single quotes, semicolons, and narrow typed adapters. Kotlin uses four spaces and explicit visibility.
- UI tests exercise accessibility labels/actionability in addition to text presence. Player tests use the existing mocked TrackPlayer boundary.

## Plan File Ownership

To permit safe execution waves, use these ownership boundaries:

| Plan | Exclusive primary ownership |
|---|---|
| 07-01 | `media/*`, five provider descriptor adapters, rendition/part/MV and player descriptor contract |
| 07-02 | Room cache schema/repository, worker/core, cache-library state/screen and quota/user operations |
| 07-03 | RNTP patch, effects/visualizer native module, loudness analyzer/worker and player controls |
| 07-04 | DeepSeek native vault/client/policy/cache and DeepSeek adapter contracts only |
| 07-05 | Cross-cutting security matrix/tests/scanners/backup rules after all feature plans |

Plans sharing `playerController.ts`, Android application/manifest/build files, or navigation are explicitly ordered even when their domains are otherwise independent. Executors must preserve concurrent Phase 6 work and adapt to the then-current `LibraryDatabase.kt`, screen, and store content rather than reverting it.

## Interfaces to Establish Early

### Native media descriptor response

The wire object is exact-key and versioned. It contains:

- `version`, `requestId`, `source`, `semanticTrackId`, optional `partId`
- `playableUri` using the package-owned provider authority
- `mimeType`, `container`, `codec`, `durationMs`, optional `sizeBytes`
- `selectedRenditionId`, bounded `renditions`, bounded Bilibili `parts`
- `entitlementStatus`, optional safe `action`, `leaseExpiresAt`

It never contains URL, host, path, header, cookie, token, CDN candidates, provider response, or filesystem path.

### Cache identity and owner operations

- Identity: `(source, semanticTrackId, partId?, renditionId, mediaRevision)`.
- Owner mutation: `associateOwner(identity, ownerType, ownerKey?)`, `removeOwner(...)`, `promoteToExplicit(identity)`.
- Transfer action: `requestAcquisition(identity, reason)`, `cancel(identity)`, `resume(identity)`, `repair(identity)`.
- Playback lookup: `resolveReady(identity, accountGeneration)` returns safe URI or a stable miss/entitlement/repair status.
- Quota: `getQuota(): Long?`, `setQuota(Long?)`; `null` is unlimited.

### Effects and analyzer operations

- `getCapabilities()` returns effect/analyzer availability and safe reason codes, never an audio session ID.
- `setPreset(presetId|null)`, `setEnabled(boolean)`, `reset()` are idempotent.
- `setVisualizationEnabled(boolean)` may cause the UI to request runtime permission; frames are capped typed arrays/number arrays with timestamp and playback generation.
- Session replacement invalidates the old generation and releases old effects/analyzer before binding the new session.

### Loudness result

- Key: hash + sample rate + codec + analyzer version.
- Value: status, integrated LUFS, true peak dBTP, clamped gain dB, analyzed timestamp.
- Playback receives only fixed gain/status for the current content generation. It applies unity when absent/stale/failed.

### DeepSeek safe response

- Key status: configured/not-configured/keystore-unavailable/corrupt-cleared.
- Translation status: pending/success/cancelled/invalid-response/entitlement-or-network failure.
- Success projection: semantic lyric revision plus validated translated lines required for rendering.
- No raw prompt, provider body, raw response, key, authorization header, or full unvalidated response crosses the native boundary.

## Anti-Patterns

- Do not add Phase 7 code under legacy `android/`.
- Do not expose a general-purpose URL fetcher or allow JS to specify headers/cookies/CDN candidates.
- Do not encode entitlement as “URL exists.” It is an explicit decision bound to account generation and use boundary.
- Do not keep both JSON and Room as writable cache catalogs. Migrate/reconcile once, then make Room authoritative.
- Do not use an in-process executor as the only owner of resumable work.
- Do not let React state contain partial file paths, signed URLs, secrets, full prompt bodies, or raw model responses.
- Do not attach effects/analyzer to Android output mix/session zero.
- Do not animate random/static spectrum bars as if they were live.
- Do not apply loudness gain before identity validation or make initial playback await analysis.
- Do not broaden Android backup to include caches merely to simplify restore.
