# Coding Conventions

**Analysis Date:** 2026-08-30

## Scope and source layout

- The desktop runtime is CommonJS Electron/Node code under `app/*.js`; the main process and IPC entry point is `app/main.js`.
- The shared browser UI is an AngularJS 1.x application, not modern Angular/TypeScript. Its root module is created in `app/listen1_chrome_extension/js/app.js` and bootstrapped by `app/listen1_chrome_extension/listen1.html`.
- Browser scripts are classic globals loaded in a deliberate order in `app/listen1_chrome_extension/listen1.html`; there is no bundler or module import graph for this UI.
- Angular controllers live in `app/listen1_chrome_extension/js/controller/`; platform adapters live in `app/listen1_chrome_extension/js/provider/`; playback state is concentrated in `app/listen1_chrome_extension/js/player_thread.js`.
- Android is a small Java WebView host. Activity/UI code is in `android/app/src/main/java/com/dazzlingwuming/listen2/MainActivity.java`, while URL and HTTP policy are isolated in `NavigationPolicy.java` and `HttpBridgePolicy.java`.
- Generated Android files under `android/app/build/` and `android/.gradle/` are ignored. Never hand-edit generated assets; change the allow-list task in `android/app/build.gradle` instead.

## Naming patterns

**Files:**

- Desktop modules use lower camel case such as `app/audioCache.js`, `app/bilibiliService.js`, and `app/lyricCacheStore.js`.
- Legacy browser modules use a mixture of lower camel case and snake case (`app/listen1_chrome_extension/js/l1_player.js`, `app/listen1_chrome_extension/js/controller/my_playlist.js`, `app/listen1_chrome_extension/js/provider/bilibili.js`). Match the directory's established name when adding a file.
- Frontend tests are `*.test.js` in `app/listen1_chrome_extension/test/`; desktop tests use the same suffix in `app/test/`.
- Java production and test classes use PascalCase (`MainActivity`, `AndroidHttpBridge`, `HttpBridgePolicyTest`) and remain in the package directory.

**Functions and methods:**

- New desktop functions use lower camel case and descriptive verbs (`getBilibiliService`, `ensureAudioCacheAvailable`, `createBilibiliFailure`).
- Angular/controller and general UI code uses lower camel case for new functions, but provider compatibility methods intentionally retain snake case (`get_video_context`, `bootstrap_track`, `search_lyric_candidates`).
- Event callbacks are usually named by event or operation (`onPostMessage`, `handleNavigation`, `submitListeningHistory`); preserve the existing callback signatures at provider and IPC boundaries.
- Java methods use lower camel case and explicit visibility. Keep pure policy helpers package-private when their only consumer is the same package's tests.

**Variables and constants:**

- JavaScript constants are `UPPER_SNAKE_CASE` (`MAX_LYRIC_LENGTH`, `DEEPSEEK_PROMPT_VERSION`); local values and object keys are lower camel case.
- `Player` keeps legacy private-ish state with an underscore prefix (`_shuffle_queue`, `_media_retry_state`). Do not rename these fields casually because tests and the UI harness inspect them.
- Java constants are `private static final` or package-visible `UPPER_SNAKE_CASE`; mutable instance state is lower camel case.
- There are no TypeScript interfaces or type aliases. Use JSDoc only when a cross-boundary shape is non-obvious, and use Java types for Android contracts.

## Formatting and linting

- Root JavaScript formatting is described by `.prettierrc`: two spaces, LF, semicolons, double quotes, trailing ES5 commas, and parentheses around arrow parameters.
- The embedded frontend has its own `app/listen1_chrome_extension/.prettierrc`, which changes strings to single quotes while retaining ES5 trailing commas. Follow this config for files under that directory.
- Frontend linting extends `airbnb-base` plus `prettier` in `app/listen1_chrome_extension/.eslintrc.json`, uses ECMAScript 2020 syntax (`ecmaVersion: 11`), and ignores `app/listen1_chrome_extension/js/vendor/*.js`.
- Existing frontend files use file-level `/* global ... */` and targeted `eslint-disable` comments because classic script globals and legacy provider APIs are intentional. Prefer a narrow rule suppression with a reason over broad new disables.
- Root `package.json` exposes Prettier as a dev dependency but has no root `lint` or `format` script. Do not claim root formatting is CI-enforced; run the configured formatter/check explicitly when changing root modules.
- The extension package has Husky/lint-staged configuration in `app/listen1_chrome_extension/package.json`; it runs ESLint/Prettier on staged files when that package's hooks are installed.
- Android Java uses four-space indentation, braces on the declaration line, explicit `final` where useful, and comments/Javadoc for security boundaries. Gradle Groovy in `android/app/build.gradle` uses four spaces and single-quoted dependency/configuration strings.

## Import and dependency organization

- CommonJS `require` calls are at the top of desktop modules, with Node built-ins first and local modules after them (`app/main.js`, `app/audioCache.js`). There are no path aliases or barrel files.
- Browser scripts intentionally depend on globals established by HTML order (`angular`, `axios`, `Howl`, providers, `MediaService`). Add a `/* global ... */` declaration when introducing a new external global.
- Keep `app/listen1_chrome_extension/listen1.html` script order valid: vendor libraries, utility/bridge modules, providers, player/service modules, the Angular app, then controllers.
- Android imports are grouped by Android framework, AndroidX, JSON, Java standard library, and `javax` as shown in `AndroidHttpBridge.java`; keep policy code independent of Android APIs where possible.

## Error handling

**Desktop and IPC:**

- Throw for invalid internal inputs or violated invariants in service modules, attaching a stable `code` when the caller needs to classify the failure (`app/bilibiliService.js`, `app/machineTranslation.js`, `app/audioCache.js`).
- At Electron IPC boundaries, catch errors and return a serializable `{ ok: false, status: ... }` result. `registerLocalDataHandler` in `app/main.js` also validates the sender and normalizes payloads before dispatch.
- Use `app/bilibiliFailure.js` as the pattern for external media errors: classify retryability and expose safe status/kind fields, never raw exception messages, signed URLs, cookies, or headers.
- Browser-only paths return explicit `{ ok: false, status: 'unsupported' }` when desktop IPC is absent (`app/listen1_chrome_extension/js/loweb.js`). Preserve this contract instead of throwing on a normal capability difference.
- Cache stores serialize writes through `writeChain` and return stable statuses such as `invalid-input`, `stale-revision`, `manual-locked`, and `not-found` (`app/lyricCacheStore.js`, `app/audioCache.js`). Keep expected business failures distinguishable from transport failures.
- For cleanup or optional enrichment, a deliberately ignored catch is acceptable only when the primary operation remains valid; document the reason as in `attachMachineTranslationToLyricCache` in `app/main.js`.

**Frontend/provider code:**

- Legacy providers commonly use `success`/`failure` callbacks and `{ status: 'success' | 'fail' }`; newer paths use Promises. Preserve the API style of the provider being changed and bridge both styles explicitly when needed.
- Isolate independent provider/lyric failures with fallback values or `Promise.allSettled` where the UI can continue (`app/listen1_chrome_extension/js/provider/bilibili.js`). Do not silently turn a required operation into success.
- Controller catches should reset pending/loading state and show a localized `notyf` message (`app/listen1_chrome_extension/js/controller/play.js`). Keep raw errors out of user-visible notifications.

**Android:**

- `HttpBridgePolicy` returns `ValidationResult.error(code)` for invalid scheme, host, route, query, size, or method; `AndroidHttpBridge` maps parse/network/timeout/redirect failures to explicit `BridgeReply` error codes.
- Keep the WebView bridge bounded and asynchronous: fixed queue, timeouts, no redirects, bounded response bodies, and no caller-supplied headers. A destroyed WebView is an expected late-reply case and is caught in `replyOnMain`.
- `NavigationPolicy` treats malformed or untrusted URLs as false rather than throwing. Maintain the packaged-asset boundary and never broaden it to arbitrary `file:`, `content:`, or `intent:` navigation.

## Logging and comments

- There is no application logging framework. Runtime diagnostics use bounded in-memory playback diagnostics (`player_thread.js`) and occasional `console.warn`; tests use `console.log`/`console.error` for script completion/failure.
- Log only sanitized state, status, stage, and bounded identifiers at boundaries. Never log API keys, cookies, signed media URLs, or arbitrary exception messages.
- Comments should explain why a security, retry, cache, queue, or compatibility choice exists. Examples include the security rationale in `HttpBridgePolicy.java` and the bounded cleanup/retry comments in `app/audioCache.js`.
- Existing TODOs are plain `// TODO:` comments (for example in `app/listen1_chrome_extension/js/provider/qq.js` and `app/listen1_chrome_extension/js/loweb.js`). Add an issue/reference when one exists and avoid creating TODOs that hide a required behavior change.

## Function and module design guidance

- Prefer guard clauses and explicit returns for validation, unsupported capabilities, and empty state; this is the dominant style in `app/lyricCacheStore.js`, `app/listeningHistoryStore.js`, and the Android policy classes.
- Use an options object for operations crossing process/module boundaries or needing several values; retain existing positional signatures only for legacy provider callbacks.
- The codebase contains intentionally large legacy modules (`app/main.js`, `app/audioCache.js`, `app/listen1_chrome_extension/js/controller/play.js`, and provider files). For new work, extract pure validation/classification helpers and keep side effects at boundaries instead of growing these files further.
- Desktop modules expose named CommonJS exports for tests; browser modules expose globals or UMD-style exports (`app/loudnessAnalyzerRenderer.js`, `app/listen1_chrome_extension/js/playlist_backup.js`). Keep new reusable pure logic exportable without requiring Electron.
- Before changing a contract, update the relevant test and the corresponding IPC/provider status shape together. Preserve old aliases only when the consuming browser or extension path still requires them.

---

*Convention analysis: 2026-08-30*
*Update when patterns change*
