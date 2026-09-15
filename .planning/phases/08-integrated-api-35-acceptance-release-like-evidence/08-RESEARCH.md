# Phase 8 Research: Integrated Acceptance Strategy

## Discovery Level

Level 0 codebase verification is sufficient. Phase 8 uses the repository's existing React Native, Gradle, AndroidX runner, Room instrumentation, JUnit, shell, SDK Build Tools, and Phase 7 scanner. No new runtime framework or package is selected.

## Current Facts

- `mobile/` is the canonical Android application. Its Gradle configuration currently declares min SDK 24, compile SDK 37, target SDK 36, JDK 17-era tooling, application ID `com.dazzlingwuming.listen2`, version code 1, and version name `2.34.0-android`.
- The current release build has R8 disabled through `enableProguardInReleaseBuilds = false` and has no signing configuration. The debug build uses the standard development keystore. Phase 8 therefore needs a separate installable `releaseLike` type rather than altering the meaning of formal `release` signing.
- The app already has Android instrumentation fixtures for Room migration, library/backup transactions, history, SAF import, and local media. JVM contracts cover five-source descriptors, Bilibili/QQ/Kuwo, MV policy, offline recovery, DeepSeek, effects, and loudness.
- React Native screens already expose many Chinese accessibility labels for search, navigation, player, library, local import, cache, account, backup, MV, and DeepSeek controls. Device automation can use the platform accessibility tree and `UiAutomation`; no Detox/Appium dependency is needed.
- Phase 7 owns the source/Jest/JVM security gate and supplies a scanner with optional APK/unpacked-path input. Phase 8 must consume that scanner and add manifest, signing, alignment, version-upgrade, runtime-log, and final artifact checks.
- No formal signing credential belongs in the repository. A debug-key-signed, non-debuggable, minified artifact is installable evidence, not a store release.

## Recommended Execution Shape

### 1. Release-like build seam

Add a `releaseLike` build type initialized from `release`, with `debuggable false`, R8/minification and resource shrinking enabled, strict cleartext policy, and only the existing debug signing config. Give it a candidate version code greater than the diagnostic debug baseline so an on-device debug-to-releaseLike data-preserving upgrade can be exercised without defining the future production version. Keep the formal `release` variant unsigned.

The build harness must run debug and releaseLike app assembly twice from clean generated output with identical checked-out sources and locked npm inputs, retain the dependency graph and tool versions, compare per-variant APK SHA-256 values, and fail on mismatch. It also compiles and assembles `releaseLikeAndroidTest`; this development-signed black-box test APK seeds the same-package debug baseline and is the only test APK permitted to drive the release-like journey. If byte equality fails, the run remains failed while a normalized entry/hash comparison identifies the nondeterministic producer; it must not downgrade reproducibility to a warning.

Tool discovery cannot assume a Homebrew path. Resolve JDK 17 from an already-valid `JAVA_HOME`, macOS `/usr/libexec/java_home -v 17`, or the canonical parent of a PATH-resolved `javac`; resolve the SDK from `ANDROID_SDK_ROOT`, `ANDROID_HOME`, or an existing `mobile/android/local.properties` `sdk.dir`. Export validated `JAVA_HOME`, `ANDROID_SDK_ROOT`, and `ANDROID_HOME`, then prove the roots contain the required `java`/`javac`, `sdkmanager`, `avdmanager`, `emulator`, `adb`, and Build Tools 37.0.0 programs with the expected versions. Run `npm cache verify` and `npm ci --prefix mobile` against `mobile/package-lock.json`, record its hash, and fail if the lock or patches change. Resolve Gradle dependencies offline before assembly; an absent cached coordinate is `BLOCKED` and is not hidden by an online mutation inside the acceptance run.

### 2. APK security and provenance

Use the SDK selected from `ANDROID_HOME` and record the exact executable paths/versions. Verify:

- `zipalign -c -P 16 4` succeeds;
- `apksigner verify --verbose --print-certs` succeeds and the certificate digest equals the recorded development signer;
- merged manifest has the reviewed application ID/version, `debuggable=false`, cleartext disabled, expected permissions, no unexpected exported component, one playback owner, and non-exported local/offline/media providers;
- R8 mapping/usage/seeds outputs exist for the release-like build and required React Native/native bridge classes survive smoke launch;
- packaged file inventory contains the production Metro bundle and approved resources but no legacy WebView/desktop assets, test fixtures, source maps, local paths, credentials, signed URLs, cookies, raw provider bodies, raw DeepSeek payloads, or marker canaries;
- a debug baseline can be installed, cleared exactly once before seed instrumentation, seeded, then upgraded in place to the higher-version release-like candidate with Room/library/queue/settings intact; no later clear or candidate change is allowed.

### 3. Fixed fixture manifest plus live truth

The fixture manifest is data, not a provider substitute. It defines:

- the five ordered source IDs and fixed query `青花瓷` with source-labelled semantic match rules;
- NetEase and Bilibili anonymous detail/play/lyrics paths and the expected safe DTO fields;
- a locally generated ten-minute mono WAV plus LRC, their expected hashes and SAF destination;
- library, backup, cache, queue, history, navigation, network and process-recovery operations;
- optional credential lane identifiers without containing credential values.

Live responses are reduced to safe semantic observations before evidence is written. The host runner rejects credential-looking arguments/environment and never stages credentials in files, fixtures, `adb` extras, or clipboard. Bilibili QR or DeepSeek input is accepted only through the visible app UI and native secure storage during a separately authorized human interaction; without it the corresponding live lane is `NOT_VERIFIED`. A reached provider/entitlement/region/CDN/codec limitation is `DEGRADED`, not `NOT_VERIFIED`.

### 4. Black-box device timing

Avoid permanent diagnostic authority in the application. Measure observable boundaries from the test process and Android system:

- launch request to Activity displayed (`am start -W`) for TTID;
- launch to the first enabled bottom navigation/player entry accessibility node for TTFD;
- search submit to the source-specific loading state for renderer-to-bridge dispatch;
- loading state to matching result node for provider/network settlement;
- play action to MediaSession `STATE_PLAYING` with advancing position for Media3-to-audible entry;
- UID-scoped `dumpsys meminfo`, `top`, `dumpsys batterystats`, and `dumpsys netstats` samples for resources.

The evidence document must label these as observable stage measurements, not internal profiler spans. At least 20 samples make p95 a real order statistic rather than a fabricated estimate.

### 5. Recovery and cleanup

The harness snapshots package/device/network state before mutation and installs shell traps before changing Wi-Fi/data, animation scales, font scale, rotation, notification permission, TalkBack, or screen state. It validates the explicit API 26/35/36 `google_apis` image and host ABI before creating uniquely named AVDs, verifies `ro.boot.qemu.avd_name`, API and ABI before every lane, and passes the returned serial to every `adb` command. It restores settings, stops only emulator PIDs it launched, deletes only AVDs marked as created by this run, retains the previous candidate and semantic backup needed for rollback, and never deletes user-owned AVDs or repository data.

## Package Legitimacy Audit

| Ecosystem | Package installs | Result |
|---|---|---|
| npm/pip/cargo | None | Existing lockfiles and dependencies only; no legitimacy checkpoint required. |
| Gradle/AndroidX | None planned | Existing AndroidX runner/Room/WorkManager and Android platform APIs are sufficient. |

## Primary Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Passing fixtures hide broken live search | Fixtures never replace production routes; live public provider outcomes are recorded independently. |
| Release-like APK differs from tested APK | API 35 E2E installs and exercises the exact hashed release-like candidate; debug is diagnostic only. |
| Emulator state makes results irreproducible | Record AVD/API/image/device settings and snapshot/restore all mutated settings. |
| Credentials leak through commands/logs/screenshots | No CLI/environment/file credential intake; visible secure application UI only, no credential-lane screenshots, and scan retained artifacts/APK/logs. |
| One successful test is mistaken for parity | Finalizer requires a one-to-one 58-requirement evidence map and blocks `PARITY_READY` on every non-pass terminal state. |
