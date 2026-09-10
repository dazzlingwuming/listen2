/* eslint-env node */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), 'utf8');

const html = read('listen1.html');
const css = read('css/redesign.css');
const modernBodyStart = html.indexOf('class="body modern-body"');
const modernBody = html.slice(modernBodyStart);
const mobileLibraryHubStart = modernBody.indexOf('class="mobile-library-hub"');
const mobileLibraryHub = modernBody.slice(mobileLibraryHubStart);
const mobileMarker = '/*\n * Mobile shell contract';
const mobileCssStart = css.indexOf(mobileMarker);
const mobileCss = css.slice(mobileCssStart);
const navigationSource = read('js/controller/navigation.js');

function loadNavigationController() {
  let factory;
  const context = {
    angular: {
      module() {
        return {
          controller(name, definition) {
            if (name === 'NavigationController') {
              factory = definition[definition.length - 1];
            }
          },
        };
      },
    },
    MediaService: {},
    l1Player: { status: {} },
    lastfm: {},
    localStorage: { getObject: () => null, setObject() {} },
    document: {},
    window: {},
    isElectron: () => false,
    hotkeys() {},
    console,
    setTimeout,
    clearTimeout,
  };
  vm.createContext(context);
  vm.runInContext(navigationSource, context, {
    filename: 'navigation.js',
  });
  assert.strictEqual(typeof factory, 'function');
  return { context, factory };
}

function createNavigationHarness(options = {}) {
  const { context, factory } = loadNavigationController();
  const broadcasts = [];
  const handlers = {};
  const input = {
    id: 'search-input',
    value: '保留中的搜索词',
    blurred: false,
    blur() {
      this.blurred = true;
    },
  };
  let confirmation = null;
  context.document = {
    activeElement: null,
    getElementById: (id) => (id === 'search-input' ? input : null),
    getElementsByClassName: () => [],
    querySelector: () => confirmation,
  };
  context.window = {
    Listen2AndroidHttpAdapter: { isAvailable: () => true },
  };
  const scope = {
    $on() {
      return () => {};
    },
    $applyAsync(callback) {
      if (options.deferApply) options.deferApply.push(callback || (() => {}));
      else if (callback) callback();
    },
    $evalAsync(callback) {
      if (callback) callback();
    },
  };
  const rootScope = {
    $broadcast(name, payload) {
      broadcasts.push(name);
      (handlers[name] || []).forEach((handler) => handler(payload));
    },
  };
  const timeout = () => ({});
  timeout.cancel = () => {};
  factory(scope, timeout, rootScope);
  return {
    broadcasts,
    context,
    input,
    on(name, handler) {
      handlers[name] = handlers[name] || [];
      handlers[name].push(handler);
      return () => {
        handlers[name] = handlers[name].filter((item) => item !== handler);
      };
    },
    setConfirmation(value) {
      confirmation = value;
    },
    scope,
  };
}

function testNearestLayerBack() {
  const harness = createNavigationHarness();
  const callback = harness.context.window.Listen2AndroidPlaybackBack;
  assert.strictEqual(typeof callback, 'function');

  harness.context.document.activeElement = harness.input;
  assert.strictEqual(
    callback(),
    true,
    'focused search must consume Back first'
  );
  assert.strictEqual(harness.input.blurred, true);
  assert.strictEqual(harness.input.value, '保留中的搜索词');
  assert.deepStrictEqual(harness.broadcasts, []);
  harness.context.document.activeElement = null;

  harness.setConfirmation({ offsetParent: null });
  const removeConfirmationGuard = harness.on('android:playback-back', () => {
    throw new Error('confirmation must close before player layers');
  });
  assert.strictEqual(callback(), true, 'confirmation must consume Back');
  assert.deepStrictEqual(harness.broadcasts, [
    'android:close-transient-overlay',
  ]);
  harness.setConfirmation(null);
  removeConfirmationGuard();

  harness.broadcasts.length = 0;
  const removePlaybackHandler = harness.on('android:playback-back', (back) => {
    Object.assign(back, { handled: true });
  });
  const removeSearchGuard = harness.on('android:search-back', () => {
    throw new Error('a consumed player child must not close search detail');
  });
  assert.strictEqual(callback(), true, 'player child sheet must consume Back');
  assert.deepStrictEqual(harness.broadcasts, ['android:playback-back']);
  removePlaybackHandler();
  removeSearchGuard();

  harness.broadcasts.length = 0;
  harness.scope.window_url_stack = [{ url: '/now_playing' }];
  harness.scope.is_window_hidden = 0;
  harness.scope.getCurrentUrl = () => '/now_playing';
  let fullPlayerPops = 0;
  harness.scope.popWindow = () => {
    fullPlayerPops += 1;
    harness.scope.window_url_stack = [];
    harness.scope.is_window_hidden = 1;
  };
  assert.strictEqual(callback(), true, 'full player must close before detail');
  assert.strictEqual(fullPlayerPops, 1);
  harness.scope.getCurrentUrl = () => '/search';

  harness.broadcasts.length = 0;
  harness.scope.mobileProductPage = 'cache';
  assert.strictEqual(callback(), true, 'product sheet must consume Back');
  assert.strictEqual(harness.scope.mobileProductPage, '');
  assert.ok(
    harness.broadcasts.includes('android:mobile-layer-back'),
    'closing an owning layer must broadcast cancellation before hiding it'
  );

  harness.broadcasts.length = 0;
  harness.scope.window_url_stack = [{ url: '/playlist?id=1' }];
  harness.scope.is_window_hidden = 0;
  harness.scope.getCurrentUrl = () => '/playlist?id=1';
  let childPops = 0;
  harness.scope.popWindow = () => {
    childPops += 1;
    harness.scope.window_url_stack = [];
    harness.scope.is_window_hidden = 1;
  };
  assert.strictEqual(
    callback(),
    true,
    'real child route must pop after layers'
  );
  assert.strictEqual(childPops, 1);
  assert.strictEqual(
    callback(),
    false,
    'clean top-level Back must fall through'
  );
}

function testDeferredBackConsumesOnlyOneLayer() {
  const deferredApply = [];
  const harness = createNavigationHarness({ deferApply: deferredApply });
  const callback = harness.context.window.Listen2AndroidPlaybackBack;
  harness.scope.window_url_stack = [{ url: '/now_playing' }];
  harness.scope.is_window_hidden = 0;
  harness.scope.getCurrentUrl = () => '/now_playing';
  let pops = 0;
  harness.scope.popWindow = () => {
    pops += 1;
    harness.scope.window_url_stack = [];
    harness.scope.is_window_hidden = 1;
  };
  assert.strictEqual(callback(), true);
  assert.strictEqual(callback(), true, 'a pending Back transition is consumed');
  assert.strictEqual(deferredApply.length, 1, 'only one close is queued');
  deferredApply.shift()();
  assert.strictEqual(
    pops,
    1,
    'rapid Back cannot cascade through a parent layer'
  );
}

assert.ok(modernBodyStart >= 0, 'modern theme shell should remain present');
assert.ok(
  mobileLibraryHubStart >= 0,
  'modern navigation should expose a mobile Library hub'
);
assert.ok(
  mobileCssStart >= 0,
  'mobile shell CSS contract should remain at the end'
);

assert.match(
  html,
  /<link href="css\/origin2\.css" rel="stylesheet" id="theme-css" \/>/,
  'modern theme CSS should be the initial theme stylesheet'
);
assert.match(
  html,
  /<link href="css\/common2\.css" rel="stylesheet" id="common-css" \/>/,
  'modern common CSS should be the initial common stylesheet'
);
assert.doesNotMatch(
  html,
  /href="css\/(?:origin|common)\.css"/,
  'the first paint should not load the legacy theme/common stylesheets'
);

assert.strictEqual(
  (modernBody.match(/class="mobile-page-heading"/g) || []).length,
  1,
  'modern navigation should expose one compact mobile heading'
);
assert.strictEqual(
  (
    modernBody.match(/data-mobile-tab="(home|discover|library|settings)"/g) ||
    []
  ).length,
  4,
  'mobile navigation should have four stable tabs'
);
[
  'ng-click="showTag(2)"',
  'ng-click="showTag(3)"',
  'ng-click="showTag(1)"',
  'ng-click="showTag(4)"',
].forEach((binding) => {
  assert.match(modernBody, new RegExp(binding.replace(/[()']/g, '\\$&')));
});
assert.match(
  mobileLibraryHub,
  /class="mobile-library-hub"[\s\S]*?ng-show="current_tag==1 && is_window_hidden==1"/,
  'the Library tab should reveal a dedicated mobile hub'
);
assert.match(
  mobileLibraryHub,
  /class="mobile-library-hub"[\s\S]*?ng-click="showPlaylist\('lmplaylist_reserve'\)"/,
  'the hub should retain the existing local music entry'
);
assert.match(
  mobileLibraryHub,
  /ng-repeat="i in myplaylists track by \$index"[\s\S]*?ng-click="showPlaylist\(i\.info\.id\)"/,
  'the hub should expose created playlists using the existing playlist action'
);
assert.match(
  mobileLibraryHub,
  /class="mobile-library-hub"[\s\S]*?ng-click="showDialog\(5\)"/,
  'the hub should retain playlist creation'
);
assert.match(
  mobileLibraryHub,
  /ng-repeat="i in favoriteplaylists track by \$index"[\s\S]*?ng-click="showPlaylist\(i\.info\.id, \{useCache: false\}\)"/,
  'the hub should expose favorited playlists without changing their cache behavior'
);
assert.match(
  mobileLibraryHub,
  /class="[\s\S]*?mobile-library-hub-tools[\s\S]*?"[\s\S]*?ng-click="showTag\(5\)"[\s\S]*?ng-click="showTag\(7\); refreshAnnualListeningSummary\(\)"[\s\S]*?ng-click="showTag\(4\)"/,
  'the hub should retain account, annual recap, and settings entries'
);
assert.match(
  mobileLibraryHub,
  /class="mobile-library-hub-close"[\s\S]*?ng-click="showTag\(2\)"/,
  'the Library hub should include a close control'
);
assert.match(
  modernBody,
  /data-mobile-tab="library"[\s\S]*?current_tag==1[\s\S]*?getCurrentUrl\(\)\.indexOf\('\/playlist\?'\) === 0/,
  'the Library tab should stay active for both the hub and playlist pages'
);
assert.match(
  modernBody,
  /class="detail mobile-current-track"[\s\S]*?ng-click="toggleNowPlaying\(\)"/,
  'the mini player title should open the existing now-playing page'
);

assert.match(css, /@media screen and \(max-width: 760px\)/);
assert.match(css, /@media screen and \(min-width: 761px\)/);
assert.match(
  read('js/app.js'),
  /data-listen2-platform', 'android'/,
  'only the trusted Android adapter may opt into phone-shell CSS'
);
assert.match(
  mobileCss,
  /html:not\(\[data-listen2-platform='android'\]\) \.modern-body \.main \.sidebar[\s\S]*?display: flex !important;/,
  'a 600–760px Electron window keeps its desktop sidebar'
);
assert.match(
  mobileCss,
  /html:not\(\[data-listen2-platform='android'\]\) \.modern-body \.mobile-tabbar[\s\S]*?display: none !important;/,
  'a narrow Electron window cannot gain Android fixed navigation'
);
assert.match(
  mobileCss,
  /\.modern-body \.main \.sidebar\s*\{[\s\S]*?display: none !important;/,
  'the mobile shell must remove the desktop sidebar'
);
assert.match(
  mobileCss,
  /html\[data-listen2-platform='android'\] \.modern-body:has\(.footer\.player-dock \.player-dock-surface\.slidedown\) \.android-queue-sheet[\s\S]*?safe-area-inset-bottom/,
  'landscape full-player queues reserve only their visible safe-area control'
);
assert.match(
  mobileCss,
  /\.modern-body \.navigation \.backfront,[\s\S]*?\.modern-body \.navigation \.window-control\s*\{[\s\S]*?display: none !important;/,
  'mobile navigation must hide desktop back/forward/window controls'
);
assert.match(mobileCss, /overflow-x: hidden/);
assert.match(
  mobileCss,
  /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/,
  'mobile card/list grids must use fluid columns'
);
assert.match(
  mobileCss,
  /grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/,
  'the bottom navigation must divide the phone width into four fluid tabs'
);
assert.doesNotMatch(
  mobileCss,
  /grid-template-columns:[^;]*(?:minmax\(\s*(?:1\d\d|[2-9]\d\d)px|(?:minmax\(\s*\d{3,}px))/,
  'mobile grids must not retain a fixed desktop minimum column width'
);
assert.match(
  mobileCss,
  /\.modern-body \.mobile-tabbar[\s\S]*?position: fixed/,
  'mobile tabs should stay reachable at the bottom edge'
);
assert.match(
  mobileCss,
  /\.modern-body \.mobile-library-hub\s*\{[\s\S]*?position: fixed/,
  'the mobile library hub should be a bounded fixed drawer'
);
assert.match(
  mobileCss,
  /\.modern-body \.mobile-library-hub-panel\s*\{[\s\S]*?max-height: min\(680px, calc\(100svh - 116px\)\)/,
  'the library hub must leave a closeable viewport above system and page navigation'
);
assert.match(
  mobileCss,
  /\.modern-body \.mobile-library-hub-(?:close|playlist|tools button)[\s\S]*?min-height: (?:44|48)px/,
  'library hub controls should preserve touch-sized targets'
);
assert.match(
  mobileCss,
  /\.footer\.player-dock\.footerdef[\s\S]*?\.footerwrap[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/,
  'the empty mini player should use the full phone width'
);
assert.match(
  mobileCss,
  /\.modern-body \.footer\.player-dock:has\(\.player-dock-surface\.slidedown\)/,
  'the existing full-screen now-playing state should have a mobile viewport rule'
);

assert.match(
  mobileCss,
  /--mobile-dock-height:\s*64px;/,
  'the mini player must reserve the canonical 64px dock'
);
assert.match(
  mobileCss,
  /--mobile-tabbar-height:\s*calc\(64px \+ env\(safe-area-inset-bottom, 0px\)\);/,
  'the tab bar must reserve 64px plus the bottom safe area'
);
assert.match(
  mobileCss,
  /calc\(var\(--mobile-tabbar-height\) \+ var\(--mobile-dock-height\) \+ 24px\)/,
  'the sole scroll surface must reserve both fixed controls and breathing room'
);
assert.match(
  mobileCss,
  /mobile-provider-selector[\s\S]*?flex-wrap:\s*nowrap;[\s\S]*?overflow-x:\s*auto;/,
  'the source selector must remain one horizontally scrollable row'
);
assert.match(
  mobileCss,
  /mobile-provider-selector[\s\S]*?min-height:\s*48px/,
  'each source selector action must remain touch sized'
);
assert.match(
  mobileCss,
  /safe-area-inset-top[\s\S]*?safe-area-inset-right[\s\S]*?safe-area-inset-bottom[\s\S]*?safe-area-inset-left/,
  'sheets must account for every safe-area edge in either orientation'
);
assert.match(
  mobileCss,
  /mobile-library-hub-panel[\s\S]*?overflow:\s*hidden[\s\S]*?mobile-library-hub-scroll[\s\S]*?overflow-y:\s*auto/,
  'bounded sheets must retain their own vertical scrolling region'
);
assert.match(
  mobileCss,
  /mobile-provider-selector[^}]*:focus-visible[\s\S]*?outline:\s*3px solid/,
  'provider selection needs a visible 3:1 focus indicator'
);
assert.match(
  mobileCss,
  /@media \(prefers-reduced-motion: reduce\)[\s\S]*?mobile-provider-selector[\s\S]*?transition-duration:\s*0\.01ms !important/,
  'reduced motion must remove shell movement'
);
assert.match(
  mobileCss,
  /mobile-provider-search[\s\S]*?transition:\s*opacity 160ms[^;]*, transform 160ms/,
  'normal shell transitions must use opacity/transform and finish within 160ms'
);
assert.match(
  mobileCss,
  /@media \(max-width: 359px\)[\s\S]*?text-overflow:\s*ellipsis[\s\S]*?white-space:\s*nowrap/,
  '320px layouts must ellipsize fixed-control labels instead of overlapping them'
);
assert.doesNotMatch(
  mobileCss,
  /mobile-library-hub-tools\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2,/,
  'phone sheet actions must not retain a two-column action grid at large text'
);

testNearestLayerBack();
testDeferredBackConsumesOnlyOneLayer();

process.stdout.write('mobile UI contract tests passed\n');
