/* eslint-env node */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

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
  mobileCss,
  /\.modern-body \.main \.sidebar\s*\{[\s\S]*?display: none !important;/,
  'the mobile shell must remove the desktop sidebar'
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

process.stdout.write('mobile UI contract tests passed\n');
