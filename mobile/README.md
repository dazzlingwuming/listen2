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

### Second-batch verification

- Formatting, TypeScript and ESLint checks: passed.
- Jest: 7 suites, 40 tests: passed.
- Android production Metro bundle: passed; 1,456,166 bytes and 19 assets.
- Native compile-only: `not verified` because the TLS handshake to
  `plugins.gradle.org` failed. This does not establish Kotlin/Java compilation.
- No APK was generated and no Android emulator end-to-end test was completed.

APK assembly is intentionally deferred until an integrated feature slice is
ready; it is not repeated after every source-level change.

## Packaging status

No new APK was generated for this feature batch. Debug signing can use the
standard React Native development keystore; release signing is deliberately
not configured and must use credentials supplied outside the repository. No
production signing material belongs in source.
