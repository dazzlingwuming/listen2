# Listen2 Mobile

`mobile/` is the canonical Android application. It follows the original
`listen1_mobile` product shape—a standalone React Native app with Redux-backed
state, native background audio and mobile navigation—while using a current
React Native/Android toolchain.

It does not load the desktop application in a WebView. The older `android/`
project remains in this repository only as migration evidence until the new
application has passed integrated emulator acceptance.

## Current scope

- Mobile tabs for My Music, Discover, Search and Settings.
- Real Discover content from bounded anonymous provider routes: NetEase featured
  playlists and charts, plus Kugou charts. Remote detail reports incomplete
  provider data honestly and disables play-all when the collection is partial.
- Search adapters for NetEase, Kugou, QQ Music and Bilibili, including NetEase
  remote playlist search and detail navigation. Unsupported provider operations
  fail visibly instead of returning fake empty results.
- Native foreground/background playback through `react-native-track-player`,
  including notification controls, audio interruptions, queue, previous/next,
  seek, volume and persisted position.
- NetEase, Kugou and Bilibili playback bootstrap; NetEase remote playlist
  detail and playback. QQ anonymous playback is unavailable, and Kuwo playback
  still requires Cookie/Secret.
- NetEase and QQ Music lyrics with bounded LRC timelines, timestamp-based
  translation pairing, active-line highlighting and automatic scrolling.
- Versioned JSON backup for favorites, user-created playlists and the current
  queue. Export uses the native share sheet; import accepts pasted text,
  defaults to a non-destructive merge, and requires a second confirmation for
  overwrite. The codec is metadata-only and rejects credentials, local paths,
  unknown fields and oversized input.
- Queue transitions resolve the provider media and load the native track before
  switching state or consuming a play-next occurrence; failed transitions keep
  the pending queue item.
- Local favorites, recent-play history and user playlists persisted with
  AsyncStorage.
- Local audio import uses `@react-native-documents/picker` 12.0.2 with Android
  SAF `open`/audio/multi/long-term access. It persists authorized `content://`
  URIs without requesting media-library permission or copying/deleting the
  user's original files.
- Imported local tracks persist in the library, play directly through
  TrackPlayer, and participate in the queue and recent-play history. Removing
  one clears app references and releases its URI access; unavailable access is
  marked `needs-repair`. Local tracks never request network lyrics and are
  excluded from portable JSON backups.
- Explicit NetEase and Kugou downloads use an app-private, size-bounded native
  cache with atomic SHA-256 publication, sanitized progress/error state and
  Settings controls. Playback checks verified offline media before provider
  bootstrap; Bilibili is intentionally excluded from this cache path.
- Starting a discovered collection waits for the first native track to load.
  A destructive transition failure restores the prior bounded native item,
  position, volume, repeat mode and play/pause state before reporting failure.

The original `listen1_mobile` had no local-audio or offline-cache capability;
its `local` concept was only part of JSON backup. This local-audio slice is an
explicit mobile extension, and it is not the same as downloading network audio
for offline playback.

Provider access is intentionally bounded: UI code cannot supply URLs, headers,
cookies or tokens. Membership, DRM, region and account restrictions are not
bypassed.

NetEase's public playlist detail sample returned 10 tracks while its summary
reported 35; this is recorded as an upstream/public-endpoint limitation, not
as proof that the full playlist was retrieved.

## Development

Requirements:

- Node.js 22.13+ or 24.3+
- JDK 17
- Android SDK Platform 37 and Build Tools 37.0.0
- an Android emulator or device

From the repository root:

```sh
npm run mobile:install
npm run mobile:start
```

In a second terminal, after Metro is ready:

```sh
npm run mobile:android
```

Focused checks used during implementation:

```sh
npm run mobile:typecheck
npm run mobile:test
npm --prefix mobile run lint -- --quiet
```

### Current source verification

- Formatting, TypeScript and ESLint checks: passed.
- Focused provider, Discover, playback rollback, offline-cache and UI Jest
  suites: passed, including 53 Discover/provider/rollback checks and 17 offline
  cache/player checks.
- Android production Metro bundles for the offline and Discover slices: passed
  with 19 assets.
- No APK, Gradle/native compile-only, or Android emulator end-to-end test was
  completed. The focused Kotlin/JVM offline contract remains `not verified`
  because this host has no Java Runtime/JDK 17; this does not establish native
  Kotlin compilation or content-provider playback.
- Real `content://` URI playback in the background and after app restart:
  `not verified`.

APK assembly is intentionally deferred until an integrated feature slice is
ready; it is not repeated after every source-level change.

## Packaging status

No new APK was generated for this feature batch. Debug signing can use the
standard React Native development keystore; release signing is deliberately
not configured and must use credentials supplied outside the repository. No
production signing material belongs in source.
