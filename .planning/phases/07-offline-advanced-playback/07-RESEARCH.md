# Phase 7 Research: Offline & Advanced Desktop-Equivalent Playback

## Scope and Evidence Baseline

The implementation target is the React Native/Kotlin application in `mobile/`. The legacy WebView sample and Electron implementation are references only. Current source inspection and prior quick-task artifacts establish these facts:

- Playback is owned by React Native Track Player 4.1.2. Bilibili, QQ, and Kuwo already have native resolver code, but provider URLs and some headers still cross JS. NetEase and Kugou use different paths. `BootstrapTrack` still models a raw `url`.
- Bilibili audio bootstrap currently requests `qn=80`; the app does not expose the actual authorized rendition set as one native contract. MV already uses opaque native handles, but audio, part, rendition, and entitlement are not one descriptor boundary.
- `OfflineCore.kt` uses a single JSON catalog, only accepts NetEase/Kugou, defaults to 512 MB total capacity, and uses an in-process executor. It has atomic `.part` rename and hash/signature checks, but no owner model, Room catalog, byte-range resume, durable scheduler, quota presets, LRU, or full cache-library projection.
- `LibraryDatabase.kt` version 3 contains a skeletal `cache_catalog` row. Phase 7 must expand it through an explicit migration and exported schema; destructive migration remains forbidden.
- No Android effect, real analyzer, or loudness implementation exists. A generic output-mix/session-zero effect would be unsafe and is deprecated; effects must attach to the actual player session.
- DeepSeek already has a native client, consent UI, cache, and encrypted vault path. The remaining boundary closes any plaintext preference fallback, makes Keystore absence an explicit unavailable state, and ensures raw prompt/result text never enters JS state or persistence.
- Phase 8 is the owner of integrated APK/API-35/emulator/live/device evidence. Phase 7 still delivers every functional contract and focused deterministic tests.

## Recommended Architecture

### 1. Versioned native `MediaDescriptor`

Create a provider-neutral native descriptor subsystem under `mobile/android/app/src/main/java/com/listen2mobile/media/`:

- `MediaIdentity`: provider source, semantic track ID, optional Bilibili part ID, and a bounded media revision.
- `MediaRendition`: opaque ID, truthful label/quality, MIME, container, codec, duration, optional byte length, and entitlement flags. It contains no URL or cookie.
- `EntitlementDecision`: `allowed`, `requires-login`, `membership-required`, `region-blocked`, `drm-unsupported`, `expired`, or `provider-unavailable`, plus bounded user-action metadata.
- `MediaDescriptor`: protocol version, request ID, identity, selected rendition, allowed renditions/parts, safe app-owned URI, expiry of the ephemeral native lease, and fallback status.
- `MediaLeaseRegistry`: bounded native-memory mapping from an unguessable handle to signed URL/CDN candidates and native-only headers. It has a short TTL, use count, cancellation, account-generation binding, and zero persistence.
- `MediaStreamProvider`: exposes a package-private content URI backed by `StorageManager.openProxyFileDescriptor` on API 26+, so ExoPlayer can use range reads/seeks while each request/redirect/CDN candidate is revalidated natively. The app minSdk remains 24. On API 24/25, only a complete verified local file may be opened through the normal provider file descriptor; an uncached remote item returns a safe actionable `download-first`/streaming-unsupported status. A stale lease is re-resolved through provider code, not returned to JS.

This preserves React Native Track Player as the background/lifecycle owner while removing secrets and signed transports from JS. Offline-ready entries use the same safe provider URI shape but resolve to a complete verified local file.

Provider adapters should normalize into this contract rather than return independent raw URL shapes. Bilibili resolution returns the authorized part and rendition list and never hard-codes `qn=80`; QQ, Kuwo, NetEase, and Kugou report the same error/entitlement vocabulary. Local SAF playback remains under the existing local provider and is not copied into the remote descriptor registry.

### 2. Durable cache domain

Expand Room to a migration-safe schema with separate media identity, owners, transfer attempts, verified blobs, and analysis metadata. Use physical owner alias directories (`owners/temporary`, `owners/playlist/<playlist-key>`, `owners/explicit`) plus one content-addressed `blobs/` directory and a separate unreachable `attempts/` directory. Alias/index records represent ownership while one physical blob may have multiple owners without copying bytes:

| Owner | Cause | Eviction/deletion |
|---|---|---|
| `temporary` | A track reaches actual playing state | LRU eligible |
| `playlist:<id>` | Track is associated with that personal playlist | LRU eligible when space is required; association remains and may reacquire |
| `explicit` | User invokes Download or promotes an entry | Never LRU; user-only cancel/delete |

Recommended state machine:

`queued -> resolving -> transferring -> verifying -> ready`, with terminal/recoverable states `paused-network`, `paused-constraint`, `cancelled`, `failed-entitlement`, `failed-storage`, `repair-required`, and `removed`. Only `ready` with matching expected length/hash and a readable local descriptor is playable. Partial bytes have an attempt ID and verified range metadata, live only under `attempts/`, have no owner alias, and are rejected by every player-facing provider route.

Use WorkManager unique work keyed by media identity for durable acquisition. Network, battery-not-low, and storage-not-low constraints are explicit; user-initiated long work publishes a foreground notification and cancellation action. Range requests use `Range` plus `If-Range`/ETag or Last-Modified when the provider permits it. A response that does not validate the resume contract restarts the same attempt safely rather than appending. Resolver leases are reacquired on expiry, resume, account change, and authorization failure.

Use a nullable `quotaBytes` DataStore value: 2 GB default, 1/5/10 GB presets, `null` unlimited. Eviction orders non-explicit blobs by last successful use and owner class, computes shared-owner reachability transactionally, and never selects an explicitly owned blob. Before every reservation, account for committed bytes, valid partial bytes, and concurrent reservations. Disk-full and catalog/file divergence enter a bounded repair pass with stable results rather than recursive retries.

The cache library should be a separate screen/domain adapter rather than extending the existing large settings component further. It consumes paged/bounded projections from native Room, supports search/sort/owner/status filters, selected/bulk delete, clear eligible, retry/repair, and promotion. Backup codecs receive semantic playlists/settings only; cache tables, paths, URIs, leases, signed URLs, and bytes are excluded.

### 3. Actual-session effects and real visualization

Android `Equalizer` and `Visualizer` require the real player audio session. React Native Track Player does not expose a supported high-level hook in the current app, so extend the already-pinned `react-native-track-player+4.1.2.patch` with a process-local native listener seam. The patched service reports session creation/recreation/release to an app-native bridge; the ID never becomes a React method/event or JS value. Do not attach to session zero.

`AudioEffectsModule` exposes only high-level capability and commands: query capability, enable/disable, select/reset preset, enable/disable visualization, and receive bounded analyzer frames/status. It owns `Equalizer`/`Visualizer`, recreates them when the playback session changes, and releases them on pause/background/route loss/track replacement. Unsupported devices, permission denial, constructor errors, control loss, and parameter errors return stable statuses while original playback continues.

`Visualizer` requires `RECORD_AUDIO`. Request it only when the user explicitly enables live visualization and explain its Android purpose. Never capture the global output mix, never run in background, never retain PCM/waveform frames, and cap update rate/bin count. The UI must label static/hidden fallback instead of animating fabricated values.

### 4. Loudness analysis and fixed gain

Analyze only complete cache blobs. A constrained worker uses `MediaExtractor` + `MediaCodec` to decode PCM and a pure tested BS.1770/EBU-style analyzer to calculate integrated loudness and true peak. Persist only result metrics and identity: blob hash, sample rate, codec, analyzer version, LUFS, dBTP, calculated gain, status, and timestamp.

Target approximately -14 LUFS and clamp predicted peak to -1 dBTP. The playback integration keeps user/application volume and normalization gain as separate values, then applies their product at the native player seam. No analysis blocks first play. A missing/stale/failed metric yields unity normalization gain and schedules analysis only when complete media is available.

### 5. DeepSeek native-private transaction

Replace fallback storage with a sealed vault result: `configured`, `not-configured`, `keystore-unavailable`, or `corrupt-and-cleared`. Key creation, encryption, decryption, test, and clear occur natively. No plaintext preference write is allowed, including test constructors.

Treat translation as a native transaction:

1. JS creates a one-use consent request from the current semantic lyric revision and displays all required disclosure text.
2. Confirm sends the bounded lyric input directly to the native method; JS does not place it into Redux, AsyncStorage, navigation params, logs, analytics, or debug snapshots.
3. Native constructs the provider request, sends it, parses the raw response, validates schema/line count/order/timeline/text completeness, and writes a revision-addressed encrypted/private cache record.
4. JS receives status plus the validated line projection needed for the current render. It never receives the raw provider response, prompt, key, or request headers.
5. Cancel before confirmation or during a cancellable request invalidates the operation and persists nothing.

## Architectural Responsibility Map

| Concern | Kotlin/native owner | JS/UI owner | Persistence owner |
|---|---|---|---|
| Remote media resolution | `media/*` plus provider gateways | `api/nativePlayback.ts`, provider client normalization | Ephemeral lease registry only |
| Entitlement | Provider gateway + media policy | Actionable status rendering | Account generation/status only; no signed URL |
| Offline bytes and owners | `offline/*`, WorkManager worker, content provider | `offline/*`, cache-library screen | Room + private no-backup media directory |
| Quota and constraints | Native cache repository/worker | Settings/cache-library controls | DataStore nullable quota |
| Effects | Native module + pinned RNTP native seam | Effects adapter and player controls | Non-secret preference only |
| Analyzer frames | Native actual-session `Visualizer` | Player visualization component | None |
| Loudness | Native decoder/analyzer worker | Enable/status display | Room metrics keyed by content identity |
| DeepSeek | Native vault/client/policy/cache | Consent and bounded status/render projection | Keystore + private no-backup cache |
| Security closure | Native/JS contract tests and scanners | Safe error copy only | No secret/media/URL backup surface |

## Package Legitimacy Audit

No npm, pip, or Cargo installation is required. The existing `patch-package` workflow and React Native Track Player version remain pinned.

| Package | Version | Classification | Evidence | Use |
|---|---:|---|---|---|
| `androidx.work:work-runtime` | 2.11.2 | VERIFIED | AndroidX WorkManager release notes and Google Maven coordinate | Durable constrained download/analysis jobs |
| `androidx.work:work-testing` | 2.11.2 | VERIFIED | AndroidX WorkManager testing documentation and Google Maven coordinate | Deterministic worker/constraint tests |
| `androidx.media3:*` | existing 1.9.4 | VERIFIED / already pinned | Existing Gradle lock/configuration and AndroidX Media3 docs | Player/media interoperability; no Phase 7 upgrade |
| `react-native-track-player` | existing 4.1.2 | VERIFIED / already pinned | Existing `mobile/package-lock.json` and patch file | Background playback owner and native session seam |

Primary documentation:

- [WorkManager overview](https://developer.android.com/develop/background-work/background-tasks/persistent/getting-started)
- [WorkManager constraints](https://developer.android.com/develop/background-work/background-tasks/persistent/how-to/define-work#work-constraints)
- [Long-running workers](https://developer.android.com/develop/background-work/background-tasks/persistent/how-to/long-running)
- [Media3 downloading media](https://developer.android.com/media/media3/exoplayer/downloading-media)
- [ContentProvider openProxyFileDescriptor](https://developer.android.com/reference/android/os/storage/StorageManager#openProxyFileDescriptor(int,%20android.os.ProxyFileDescriptorCallback,%20android.os.Handler))
- [AudioEffect](https://developer.android.com/reference/android/media/audiofx/AudioEffect)
- [Equalizer](https://developer.android.com/reference/android/media/audiofx/Equalizer)
- [Visualizer](https://developer.android.com/reference/android/media/audiofx/Visualizer)
- [MediaExtractor](https://developer.android.com/reference/android/media/MediaExtractor)
- [MediaCodec](https://developer.android.com/reference/android/media/MediaCodec)
- [Android Keystore](https://developer.android.com/privacy-and-security/keystore)
- [Room migrations](https://developer.android.com/training/data-storage/room/migrating-db-versions)

## Pitfalls to Prevent in Plans

- Returning a raw provider URL with a safer TypeScript name does not satisfy the boundary; `BootstrapTrack` and its raw `url`/header call sites and tests must be removed, not retained as a compatibility union.
- Raising minSdk to avoid the API 24/25 stream-provider branch silently drops supported users. Keep minSdk 24 and provide verified-local/download-first behavior on those releases.
- A resolve-time entitlement check alone is insufficient. Download/resume and play/login/account-generation boundaries must revalidate.
- Marking a download `ready` after rename without verifying expected length/hash and read-open through the player-facing provider makes partial/corrupt media reachable.
- Treating playlist association as an explicit download violates user intent and prevents LRU behavior.
- `Long.MAX_VALUE`, `-1`, or `0` as unlimited causes cross-language ambiguity; use nullable quota per D-05.
- Global/session-zero Equalizer or Visualizer can affect other apps and is forbidden. Visualizer frames must never be simulated.
- Loudness data keyed only by track ID survives media changes incorrectly; use complete content identity.
- Catching Keystore errors and storing plaintext is a security failure, not a compatibility fallback.
- Full prompt/model payloads in Redux, AsyncStorage, exception messages, snapshots, or fixtures violate AI-003 even when production network transport is native.
