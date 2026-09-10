# Phase 4: Official Mobile Shell & Unified Provider Registry - Pattern Map

**Mapped:** 2026-09-10  
**Files analyzed:** 11 planned files  
**Analogs found:** 11 / 11

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `app/listen1_chrome_extension/js/mobile_provider_registry.js` | utility / registry | transform | `js/app.js` | partial (source descriptors) |
| `app/listen1_chrome_extension/js/app.js` | config / app bootstrap | transform | current `sourceList` in the same file | exact |
| `app/listen1_chrome_extension/js/loweb.js` | service / platform adapter | request-response | current Android capability projection | exact |
| `app/listen1_chrome_extension/js/controller/instant_search.js` | controller | request-response / cancellable | current Bilibili search lifecycle | exact lifecycle, needs generalization |
| `app/listen1_chrome_extension/js/controller/navigation.js` | controller | event-driven | current Android Back dispatcher | exact |
| `app/listen1_chrome_extension/listen1.html` | component/template / script manifest | event-driven | current mobile tab, library, and Bilibili-search markup | exact |
| `app/listen1_chrome_extension/css/redesign.css` | component style | transform | terminal `Mobile shell contract` block | exact |
| `android/app/build.gradle` | config / asset pipeline | file-I/O | `syncListen1Assets` allow-list | exact |
| `app/listen1_chrome_extension/test/mobile_provider_registry.test.js` | test | transform | `test/android_rpc_contract.test.js` / source-file Node contracts | role-match |
| `app/listen1_chrome_extension/test/android_mobile_shell_registry.test.js` | test | request-response / event-driven | `test/android_mobile_bilibili_ui.test.js` | exact harness/lifecycle match |
| `app/listen1_chrome_extension/package.json` | config / test runner | batch | current `test` chain | exact |

## Pattern Assignments

### `js/mobile_provider_registry.js` (utility, transform)

**Closest analog:** `js/app.js:11-40` for descriptor shape; `js/loweb.js:148-215` for bounded Android capability projection.

**Classic-global entry pattern:** this must be a browser-safe global loaded before `app.js`; do not use CommonJS imports or a bundler. Use the frontend's single-quote style and add a narrow `/* global ... */` declaration in consumers.

**Descriptor pattern** (`js/app.js:11-40`):

```javascript
const sourceList = [
  { name: 'netease', displayId: '_NETEASE_MUSIC' },
  { name: 'qq', displayId: '_QQ_MUSIC' },
  // ... stable provider names remain unchanged
];
```

**Safe capability projection pattern** (`js/loweb.js:162-215`): construct a fresh semantic-only matrix; accept only declared booleans, default absent/unverified providers to false, and never return the native handshake object itself.

```javascript
const empty = unavailableAndroidCapabilities();
matrix[name] = ANDROID_PROVIDER_CAPABILITY_FIELDS.reduce(
  (result, field) => ({ ...result, [field]: provider[field] === true }),
  {}
);
```

**Phase-specific requirements:** own exact primary order `netease`, `kugou`, `kuwo`, `qq`, `bilibili`; retain `migu` and `taihe` as registry-only entries. Validate source-prefixed identities as opaque values. Projection fields are semantic availability/reason/account state only: no URL, headers, cookies, local paths, request IDs, raw native objects, or raw error text.

### `js/app.js` (app bootstrap, transform)

**Analog:** `js/app.js:1-44`.

**Keep source compatibility:** replace duplicated list construction by the registry's compatible selector/list helper without changing provider IDs or Angular bootstrap.

```javascript
const main = () => {
  const app = angular.module('listenone', []);
  setPrototypeOfLocalStorage();
```

Do not move the Angular module, change its classic-script bootstrapping, or expose registry data through a privileged bridge.

### `js/loweb.js` (service/platform adapter, request-response)

**Analog:** `js/loweb.js:148-249`.

**Capability handshake and subscription pattern:** native data is read through the existing typed adapter, recomputed into a UI-facing matrix after settlement, and consumers receive a cleanup function.

```javascript
return adapter
  .startProviderCapabilities(options)
  .then(() => getAndroidProviderCapabilities());

return adapter.onProviderCapabilities(() => {
  if (typeof listener === 'function') {
    listener(getAndroidProviderCapabilities());
  }
});
```

**Fail-closed rule:** preserve explicit unverified-provider treatment (`js/loweb.js:206-210`), but derive it from the registry rather than another hard-coded selector. Existing semantic `MediaService` calls and typed request handles remain the only dispatch path. Do not add URLs, headers, cookies, generic JavaScript interfaces, or provider-specific WebView fallback transport.

### `js/controller/instant_search.js` (controller, cancellable request-response)

**Analog:** `js/controller/instant_search.js:15-56, 101-143, 192-279` and `test/android_mobile_bilibili_ui.test.js:74-223`.

**Handle compatibility pattern:** retain support for legacy `.success/.error` handles and Promise handles; cancellation is optional and guarded.

```javascript
const cancelHandle = (handle) => {
  if (handle && typeof handle.cancel === 'function') handle.cancel();
};
const promise = handle.promise || handle;
if (promise && typeof promise.then === 'function') {
  return promise.then(success).catch(failure);
}
```

**Exactly-once state pattern:** generalize the current Bilibili state to `{ sourceId, epoch, query, page, state, message }`; each settlement must check the complete identity and `loading` state before changing the surface.

```javascript
if (!currentSearch(epoch, query, page) || $scope.bilibiliSearch.state !== 'loading') {
  return false;
}
clearSearchDeadline();
activeSearchHandle = null;
$scope.loading = false;
```

On source/query/page change, explicit cancel, route/layer Back, or `$destroy`, increment the visible epoch, cancel the active handle, clear stale rows for a different identity, and ignore late replies. Keep Bilibili part detail as a child-layer-specific state; do not make the generic search lifecycle infer a provider from a title or URL. Product messages must come from registry-safe Chinese capability copy rather than `androidUnavailableFacade`'s English/raw transport message.

### `js/controller/navigation.js` (controller, event-driven)

**Analog:** `js/controller/navigation.js:778-823, 933-978`.

**Back dispatch pattern:** broadcast first to the nearest owner, return only when it marks the mutable `handled` object, then close the current sheet before falling through to native Activity Back.

```javascript
const playbackBack = { handled: false };
$rootScope.$broadcast('android:playback-back', playbackBack);
if (playbackBack.handled) return true;

const searchBack = { handled: false };
$rootScope.$broadcast('android:search-back', searchBack);
```

Keep `window.Listen2AndroidPlaybackBack` registration/removal and Android-only event plumbing. Extend priority to IME, confirmations, queue/lyrics child sheet, full player, detail/library/product sheet, then child route; do not silently switch tabs or call a privileged route from navigation.

### `listen1.html` (template/script manifest, event-driven)

**Analogs:** `listen1.html:30-90` (ordered scripts), `:4563-4765` (mobile search surface), `:9296-9349` (four-tab navigation), and `test/mobile_ui_contract.test.js:47-112` (structural assertions).

**Script-order constraint:** add `js/mobile_provider_registry.js` before `js/app.js` and before controllers that reference its global. Preserve existing order: vendors/utilities and bridge, providers/services, app bootstrap, then controllers. Do not turn the page into a module graph.

**Angular template pattern:** use semantic buttons and text interpolation, preserving existing actions/layers. The current tab bar establishes the shape:

```html
<nav class="mobile-tabbar" data-mobile-tabbar>
  <button type="button" class="mobile-tab" data-mobile-tab="home">...</button>
  <button type="button" class="mobile-tab" data-mobile-tab="discover">...</button>
</nav>
```

Render one source-labelled state region and a five-item horizontal `role="tablist"`; test/accessibility copy must be registry derived. Do not use `ng-bind-html` for provider DTO fields (existing security assertion: `test/android_mobile_bilibili_ui.test.js:279-300`). Retain mini-player, full player, queue, and library markup as layers rather than adding desktop affordances or a second navigator.

### `css/redesign.css` (component style, transform)

**Analog:** final `/* Mobile shell contract */` block at `css/redesign.css:9944+`; existing Bilibili search styles at `:964-1164`; mobile tab/library geometry at `:10954-11260`.

Append/refactor within the terminal mobile contract rather than scattering a new desktop override. Preserve the shell variables, fixed docks, safe-area calculations, bounded sheet scrolling, and reduced-motion override. The current contract reserves the dock and tab bar with variables beginning at `:9971` and keeps the tab bar fixed at `:10954-10968`.

Implement selector touch targets at least 48px, a single non-wrapping horizontal row, CSS-only visual states, `max-width: 760px`, focus-visible treatment, and `prefers-reduced-motion: reduce`. Do not rely on hover and do not expose a desktop sidebar at phone widths.

### `android/app/build.gradle` (config, file-I/O)

**Analog:** `android/app/build.gradle:10-37`.

```groovy
tasks.register('syncListen1Assets', Copy) {
    from(listen1SourceDirectory) {
        // This is deliberately an allow-list...
        include 'js/app.js'
        include 'js/loweb.js'
        include 'js/lowebutil.js'
    }
}
```

Add the exact registry filename to this allow-list if a new file is created. Never copy it into generated assets manually. No Java bridge/policy file changes are implied by this phase unless a bounded capability-envelope contract demonstrably requires one.

### Tests and `package.json` (tests/config)

**Registry-test analog:** `test/android_rpc_contract.test.js` reads source and asserts bounded request/response behavior; follow its Node `assert` style. The new registry test must load the pure browser-safe global in a VM or equivalent isolated context and prove ordering, registry-only entries, immutability, safe projection, and opaque source-prefixed identity.

**Shell-lifecycle-test analog:** `test/android_mobile_bilibili_ui.test.js:1-115, 118-223` supplies an Angular-controller VM loader, fake cancellable handles, and a controllable `$timeout`. Reuse that harness to prove source/query/page/epoch switching, cancel, timeout, navigation-away/Back, late-reply rejection, selector ARIA/copy, safe-area reservation, 320px/200% CSS constraints, and nearest-layer Back.

**Package test-chain pattern:** append both tests to the existing sequential command at `package.json:6-8`; retain Node built-in `assert`, no new test package or runner.

## Shared Patterns

### Classic-script dependency order

**Sources:** `listen1.html:30-90`, `js/app.js:42-44`.

The registry is a browser-safe global; it must load before `app.js` (which materializes `sourceList`) and before `loweb.js`/controllers consume it. Browser globals get targeted `/* global MobileProviderRegistry */` declarations. No ES modules or imports.

### Typed Android boundary and fail-closed capabilities

**Sources:** `js/loweb.js:169-249`, `android/app/src/main/java/com/dazzlingwuming/listen2/provider/ProviderCapabilityFacade.java`, `android/app/src/test/java/com/dazzlingwuming/listen2/AndroidRpcContractTest.java`.

Only native capability booleans cross the existing typed bridge; Java remains capability truth. A missing adapter, malformed handshake, unknown source, or unverified route is unavailable and starts no request. Existing origin/main-frame, envelope, cancellation, and bounded-payload regression tests must remain green.

### Controller cancellation and stale-reply handling

**Sources:** `js/controller/instant_search.js:101-143, 192-264`; `test/android_mobile_bilibili_ui.test.js:151-223`.

Use one active handle/deadline per operation, cancel before superseding, and make every terminal transition identity-checked and exactly once. A cancellation/timeout remains visible even if a late native callback arrives.

### Mobile markup/accessibility/layout contract

**Sources:** `test/mobile_ui_contract.test.js:47-171`, `css/redesign.css:9944+`.

Retain four stable top-level tabs, semantic landmarks/buttons, fixed mini-player/tab bar, safe-area reservations, focus-visible states, and reduced-motion handling. The provider selector adds one accessible `tablist`, not a new navigation framework.

## No Analog Found

| File/Concern | Role | Data Flow | Reason / Planner Direction |
|---|---|---|---|
| `js/mobile_provider_registry.js` | utility / registry | transform | No existing single immutable five-source mobile projection. Combine `app.js` descriptor syntax with `loweb.js`'s bounded capability matrix; keep it pure and globally loaded. |
| generic five-source shell state | controller | cancellable request-response | Current lifecycle is Bilibili-specific. Generalize its identity/settlement mechanics without retaining prior rows across a changed source/query. |

## Metadata

**Analog search scope:** `app/listen1_chrome_extension/js`, `js/controller`, `css`, frontend tests, `listen1.html`, and Android asset/config/JVM-boundary tests.  
**Files scanned:** 14 focused implementation/test/config files.  
**Pattern extraction date:** 2026-09-10.
