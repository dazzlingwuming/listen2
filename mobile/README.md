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
- Search adapters for NetEase, Kugou, QQ Music and Bilibili. Unsupported
  provider operations fail visibly instead of returning fake empty results.
- Native foreground/background playback through `react-native-track-player`,
  including notification controls, audio interruptions, queue, previous/next,
  seek, volume and persisted position.
- NetEase, Kugou and Bilibili playback bootstrap; NetEase playlist detail;
  NetEase and QQ Music lyrics.
- Local favorites, recent-play history and user playlists persisted with
  AsyncStorage.

Provider access is intentionally bounded: UI code cannot supply URLs, headers,
cookies or tokens. Membership, DRM, region and account restrictions are not
bypassed.

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

APK assembly is intentionally deferred until an integrated feature slice is
ready; it is not repeated after every source-level change.

## Packaging status

Debug signing uses the standard React Native development keystore. Release
signing is deliberately not configured and must use credentials supplied
outside the repository. No production signing material belongs in source.
