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
const mobileMarker = '/*\n * Mobile shell contract';
const mobileCssStart = css.indexOf(mobileMarker);
const mobileCss = css.slice(mobileCssStart);

assert.ok(modernBodyStart >= 0, 'modern theme shell should remain present');
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
  'ng-click="showPlaylist(\'lmplaylist_reserve\')"',
  'ng-click="showTag(4)"',
].forEach((binding) => {
  assert.match(modernBody, new RegExp(binding.replace(/[()']/g, '\\$&')));
});
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
  /\.footer\.player-dock\.footerdef[\s\S]*?\.footerwrap[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/,
  'the empty mini player should use the full phone width'
);
assert.match(
  mobileCss,
  /\.modern-body \.footer\.player-dock:has\(\.player-dock-surface\.slidedown\)/,
  'the existing full-screen now-playing state should have a mobile viewport rule'
);

process.stdout.write('mobile UI contract tests passed\n');
