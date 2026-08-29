# Listen2 Android UI sample

This directory packages the browser-compatible Listen1 UI in a small Android
WebView host. It serves only the required UI assets from
`https://appassets.androidplatform.net/assets/listen1/` through
`WebViewAssetLoader`; it does not load the UI with `file://`.

## Scope

This is a UI and foreground-playback sample only. It does **not** provide a
native Media3 background service, Bilibili native login/session handling,
offline media cache, Electron IPC, desktop lyrics, or a claim of feature
parity with the desktop app. Those require separately designed Android
features and validation.

The WebView keeps file URL access and universal file URL access disabled.
Packaged `appassets` URLs stay in the WebView; HTTP(S) navigation goes to the
system browser; all other navigation schemes are blocked. As a consequence,
legacy provider requests that rely on cleartext HTTP or browser CORS may fail.
This sample intentionally does not weaken those defaults.

## Build and verification

Use JDK 17, Android SDK Platform 35, Build Tools 35.0.0, and Gradle 8.10.2:

```sh
cd android
gradle --no-daemon :app:testDebugUnitTest :app:assembleDebug
"$ANDROID_SDK_ROOT/build-tools/35.0.0/apksigner" verify --verbose \
  app/build/outputs/apk/debug/app-debug.apk
```

`NavigationPolicyTest` is a JVM test for the WebView URL boundary and the two
file-URL security flags. The repository does not currently include a Gradle
wrapper JAR; CI provisions the pinned Gradle distribution explicitly.

Debug builds use the side-by-side package ID
`com.dazzlingwuming.listen2.debug`, so installing a test APK does not replace
or clear data from an existing Listen2 release installation. Release builds
keep the production package ID `com.dazzlingwuming.listen2`.
