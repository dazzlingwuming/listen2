# Testing Patterns

**Analysis Date:** 2026-08-30

## Test framework and commands

**Desktop runner:**

- `app/test/` primarily uses Node's built-in `node:test` runner and Node `assert`; most files import `require("node:test")` and register `test("...", ...)` cases.
- Two desktop scripts are intentionally standalone programs rather than `node:test` suites: `app/test/listeningHistoryStore.test.js` performs top-level assertions, and `app/test/machineTranslationDeepSeek.test.js` runs an async `run().catch(...)` harness.
- There is no Jest, Mocha, Vitest, Playwright, Cypress, or coverage configuration in the tracked repository.

**Embedded frontend runner:**

- `app/listen1_chrome_extension/test/` contains 21 plain Node programs. They use built-in `assert`, filesystem reads, and `vm` contexts; they do not use `node:test`.
- The extension `test` script in `app/listen1_chrome_extension/package.json` runs all 21 files serially with `node test/<file>.test.js`. Add a new file to this explicit chain or it will not run through the package command.
- Most frontend files finish with a success message and `run().catch((error) => { console.error(error); process.exitCode = 1; })`, or set `process.exitCode` after collecting contract failures.

**Android runner:**

- `android/app/src/test/` contains two JUnit 4 JVM test classes, `NavigationPolicyTest.java` and `HttpBridgePolicyTest.java`, using `org.junit.Test` and `org.junit.Assert`.
- `android/app/build.gradle` declares only `testImplementation 'junit:junit:4.13.2'` for tests. There is no `androidTest/`, Espresso, Robolectric, instrumentation runner usage, emulator setup, or `adb` test command in the tracked repository.
- The pure-Java split is deliberate: URL/origin/request policy can be tested without Android APIs. The real WebView, message listener, network executor, and lifecycle remain outside JVM test coverage.

**Documented local commands:**

```bash
npm run test:bilibili
npm run test:desktop-cache
npm run test:loudness
npm run test:desktop-lyric
npm run test:machine-translation
npm run test:listening-history
npm --prefix app/listen1_chrome_extension test
cd android
gradle --no-daemon :app:testDebugUnitTest :app:assembleDebug
"$ANDROID_SDK_ROOT/build-tools/35.0.0/apksigner" verify --verbose \
  app/build/outputs/apk/debug/app-debug.apk
```

- The root scripts are feature groups in `package.json`; there is no generic root `npm test` script. The root README lists the same commands and requires Node.js 18+, while release CI uses Node 20.
- Android development requires JDK 17, Android SDK Platform 35, Build Tools 35.0.0, and Gradle 8.10.2. The repository has no Gradle wrapper JAR, so use the pinned external Gradle distribution shown in `android/README.md` and CI.

## Test file organization

- Desktop service/unit tests are separated from production code in `app/test/`, with one feature-oriented file per module or contract: `bilibiliService.test.js`, `audioCache.test.js`, `lyricCacheStore.test.js`, `loudnessAnalyzer.test.js`, and `mainLocalDataCache.test.js`.
- Frontend tests live in a separate `app/listen1_chrome_extension/test/` directory under the embedded app, rather than beside each source module. Names describe the behavior or contract: `app/listen1_chrome_extension/test/player_recovery.test.js`, `app/listen1_chrome_extension/test/player_shuffle.test.js`, `app/listen1_chrome_extension/test/desktop_cache_renderer_contract.test.js`, and `app/listen1_chrome_extension/test/mobile_ui_contract.test.js`.
- Android tests mirror the production package under `android/app/src/test/java/com/dazzlingwuming/listen2/`, allowing package-private policy helpers to be exercised directly.
- There is no shared `fixtures/` directory, snapshot directory, browser E2E directory, or coverage output checked into the repository.

## Test structure and assertions

- Node tests favor descriptive standalone cases with arrange/act/assert sequencing, `assert.strictEqual`, `assert.deepStrictEqual`, `assert.match`, `assert.ok`, `assert.rejects`, and `assert.doesNotMatch` (`app/test/bilibiliFailureContract.test.js`, `app/test/audioCache.test.js`).
- Async resource tests create a temporary directory, perform assertions, and clean up in `finally`; use this pattern for cache/index/file tests (`app/test/audioCache.test.js`, `app/test/lyricCacheStore.test.js`, `app/test/loudnessAudioCache.test.js`).
- Frontend behavior tests load the actual source with `fs.readFileSync`, create a minimal `vm` context, and execute it using `vm.runInContext`. This exercises selected browser logic without starting Angular, Electron, or a real browser (`app/listen1_chrome_extension/test/player_recovery.test.js`, `app/listen1_chrome_extension/test/audio_visualizer_output_recovery.test.js`).
- Frontend contract tests also assert source/HTML/CSS markers with regular expressions. Stable `data-*` markers and semantic strings are preferred over incidental indentation, as documented in `app/listen1_chrome_extension/test/audio_cache_library_ui_contract.test.js`.
- Test names and failure messages should describe the externally observable contract, including retry bounds, status fields, UI markers, and security rejection reasons.
- Android tests group positive and negative policy cases by method and use a small `assertError` helper in `HttpBridgePolicyTest.java` to verify both rejection and stable error codes.

## Mocking and test doubles

- Desktop services accept injected dependencies instead of requiring live services: tests provide an in-memory `Map`/store, fake `fetch` functions, `Response` objects, and deterministic clocks (`app/test/bilibiliService.test.js`, `app/test/listeningHistoryStore.test.js`).
- File-backed cache tests use `mkdtemp(path.join(os.tmpdir(), ...))`, then remove the exact temporary directory in `finally`; do not use repository paths or real user data.
- `mainLocalDataCache.test.js` evaluates `app/main.js` in a VM with mocked Electron, Store, and IPC objects to verify handler registration and cleanup behavior without launching Electron.
- Frontend harnesses provide only the globals the loaded script needs and record calls. Common doubles include `MockHowl` in `app/listen1_chrome_extension/test/player_recovery.test.js`, fake `AudioContext`/timers in `app/listen1_chrome_extension/test/audio_visualizer_output_recovery.test.js`, captured Axios calls in the Android HTTP tests, and mocked IPC promises in `app/listen1_chrome_extension/test/desktop_cache_renderer_contract.test.js`.
- Android policy tests deliberately avoid mocks: pure methods are deterministic and do not require an Android runtime. If a future test needs WebView lifecycle or `WebMessageCompat`, add an instrumentation test rather than pretending a JVM policy test covers it.
- Do not call Bilibili, NetEase, DeepSeek, GitHub, or CDN services from tests. Use fake response payloads and `example.test` URLs, and never place credentials/cookies in fixtures.

## Coverage and validation limits

- No line/branch coverage target or coverage tool is configured, and neither CI workflow invokes a coverage command. Treat test counts as regression evidence, not a coverage guarantee.
- `.github/workflows/android-apk.yml` runs JDK 17, installs SDK 35/Build Tools 35.0.0, provisions Gradle 8.10.2, runs `:app:testDebugUnitTest` plus `:app:assembleDebug`, verifies the debug APK with `apksigner`, and uploads it. It does not install or exercise the APK on an emulator/device.
- `.github/workflows/release.yml` runs `npm ci` and Electron Builder for macOS, Linux, and Windows. It does not run the root Node tests or the extension test chain before packaging/publishing.
- `app/listen1_chrome_extension/.github/workflows/eslint.yml` runs ESLint under Node 16, but it is nested below the repository root `.github/workflows/`; verify whether it is intended as a separately consumed workflow before relying on it as root-repository CI.
- There is no automated verification of real Electron windows, audio decoding, Bilibili login, WebView navigation, Android message-listener support, emulator configuration, or platform-specific installers.

## Test types and recommended additions

- Add pure desktop logic tests to `app/test/<module>.test.js`, export the pure helper from the CommonJS module, and place external I/O behind injectable `fetch`, store, clock, filesystem, or Electron dependencies.
- Add an explicit root `package.json` feature script when a new desktop behavior is independently meaningful; update `README.md` if the local verification command is user-facing.
- Add frontend playback/provider behavior to `app/listen1_chrome_extension/test/` with a focused VM harness. Reuse the actual source file and minimal mocks; append the file to the extension package's serial `test` script.
- For HTML/CSS/controller contracts, assert stable semantic markers and localized-key presence. Avoid broad regexes that merely encode current formatting, and pair source contracts with a behavioral harness when state transitions matter.
- For Android security or URL validation, keep the policy in a pure Java class and add JUnit cases for accepted and rejected inputs, including error codes and bounds. Run `:app:testDebugUnitTest` before build verification.
- For Android UI/WebView/bridge behavior, create a separate instrumentation test under `android/app/src/androidTest/` and document the emulator/API level and `adb`/Gradle command. Until then, mark that behavior `not verified` rather than extending JVM claims.
- Every async test must await the operation and restore/close timers, queues, windows, listeners, and temporary files. Use `finally` for cleanup and set `process.exitCode = 1` on standalone harness failure.

## Error and regression testing guidance

- Test both success and expected failure statuses. `app/test/bilibiliFailureContract.test.js` is the model for retryable versus permanent classifications and for asserting that raw signed URLs/messages are not exposed.
- Exercise malformed input, missing capabilities, stale revisions, cache corruption, network timeout, HTTP error, redirect, response-size, and shutdown paths where a module defines those statuses (`app/audioCache.js`, `app/lyricCacheStore.js`, `app/machineTranslation.js`, `android/app/src/main/java/com/dazzlingwuming/listen2/AndroidHttpBridge.java`).
- For fallback/retry logic, assert the number and order of attempts and ensure intermediate errors stay silent when a bounded retry remains (`app/listen1_chrome_extension/test/bilibili_cdn_fallback.test.js`, `app/listen1_chrome_extension/test/player_recovery.test.js`).
- For persistence, assert the on-disk shape after reloading and verify sensitive fields are absent; do not assert implementation-private paths unless the path itself is the contract.
- When a test fails only on a real device, preserve the deterministic unit test and add an explicit device/instrumentation test with environment details instead of weakening the unit assertion.

---

*Testing analysis: 2026-08-30*
*Update when test patterns change*
