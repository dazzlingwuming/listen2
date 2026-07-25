# Listen2 Android APK

This directory is an Android host for the browser-compatible Listen1 UI in
`../app/listen1_chrome_extension`.

## What this first APK includes

- A native Android activity that hosts the existing music UI in a WebView.
- Local storage and WebView cookies for the browser-compatible parts of the
  player.
- Local packaged assets copied at build time, so changes to the shared UI are
  included without maintaining a second copy of it.
- Cleartext transport remains enabled because a small number of legacy music
  providers in the shared source still use HTTP endpoints.

## Deliberately unavailable on Android

Electron-only functionality is not exposed as an Android feature:

- Electron IPC, desktop file picking, floating lyric windows and global
  shortcuts.
- The desktop Bilibili QR login session service and its secure desktop cookie
  store.
- Desktop Bilibili DASH/MV IPC playback.

The shared UI already tests `isElectron()` before using those APIs.  A proper
mobile Bilibili login and media layer should be added as a separate Android
feature rather than reusing desktop credentials.

## Build

Use JDK 17 and an Android SDK that contains Platform 35 and Build Tools 35.0.0:

```powershell
./gradlew.bat :app:assembleDebug
```

The installable debug APK is written to
`app/build/outputs/apk/debug/app-debug.apk`.
