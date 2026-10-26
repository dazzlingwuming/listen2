/* eslint-env node */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const extensionRoot = path.resolve(__dirname, '..');
const css = fs.readFileSync(
  path.join(extensionRoot, 'css', 'redesign.css'),
  'utf8'
);
const html = fs.readFileSync(path.join(extensionRoot, 'listen1.html'), 'utf8');
const themeCss = fs.readFileSync(
  path.join(extensionRoot, 'css', 'theme-collection.css'),
  'utf8'
);
const mainProcess = fs.readFileSync(
  path.resolve(extensionRoot, '..', 'main.js'),
  'utf8'
);

const capacityContract = css.slice(
  css.indexOf('/* Player dock capacity contract'),
  css.length
);

assert.ok(
  capacityContract.startsWith('/* Player dock capacity contract'),
  'the modern dock must keep an explicit capacity contract'
);
assert.match(
  capacityContract,
  /grid-template-columns:\s*minmax\(0, 0\.72fr\)\s+minmax\(430px, 1\.58fr\)\s+max-content/,
  'desktop layout must give the utility column its intrinsic width'
);
assert.match(
  capacityContract,
  /@media screen and \(max-width: 1000px\)[\s\S]*?max-content/,
  'the default-width breakpoint must preserve the intrinsic utility column'
);
assert.match(
  capacityContract,
  /@media screen and \(max-width: 820px\)[\s\S]*?max-content/,
  'the compact breakpoint must preserve the intrinsic utility column'
);
assert.match(
  capacityContract,
  /@media screen and \(max-width: 680px\)[\s\S]*?max-content/,
  'the minimum-window breakpoint must preserve the intrinsic utility column'
);
assert.match(capacityContract, /min-width:\s*max-content/);
assert.match(capacityContract, /flex-wrap:\s*nowrap/);
assert.match(
  capacityContract,
  /grid-template-columns:\s*180px minmax\(0, 1fr\) max-content/,
  'the default desktop must reserve a readable track metadata column'
);
assert.match(
  capacityContract,
  /> \.audio-effects-toggle,[\s\S]*?> \.desktop-lyric-toggle|> \.audio-effects-toggle,[\s\S]*?> \.lyric-toggle/,
  'fixed-size desktop utilities must opt out of flex shrinking'
);

const modernDock = html.slice(
  html.indexOf('<div class="footerwrap">', html.indexOf('modern-player-state')),
  html.indexOf(
    'data-audio-effects-popover',
    html.indexOf('modern-player-state')
  )
);

[
  'class="right-control"',
  'class="audio-effects-toggle"',
  'class="lyric-toggle desktop-lyric-toggle"',
  'class="bilibili-mv-switch"',
  'class="mask"',
].forEach((marker) => {
  assert.ok(
    modernDock.includes(marker),
    `modern player dock must include ${marker}`
  );
});

assert.match(
  mainProcess,
  /mainWindow\s*=\s*new BrowserWindow\([\s\S]*?minWidth:\s*600/,
  'the layout contract must cover the real 600px desktop minimum'
);

const seekRow = modernDock.slice(
  modernDock.indexOf('<div class="playbar">'),
  modernDock.indexOf('<div class="volume-ctrl"')
);
assert.match(
  seekRow,
  /class="dock-time current">{{ currentPosition }}<\/span>[\s\S]*id="progressbar"[\s\S]*class="dock-time total">{{ currentDuration }}<\/span>/,
  'elapsed and total time must flank the same seek control'
);
assert.strictEqual((modernDock.match(/{{ currentPosition }}/g) || []).length, 1);
assert.strictEqual((modernDock.match(/{{ currentDuration }}/g) || []).length, 1);
assert.match(
  capacityContract,
  /bottom:\s*calc\(var\(--now-playing-shelf-height\) \+ var\(--now-playing-shelf-inset\) \+ 12px\)/,
  'the stage boundary must reserve both shelf height and bottom inset'
);
assert.match(
  capacityContract,
  /\.now-playing-left\s*{[^}]*max-height:\s*100%;[^}]*overflow-y:\s*auto/,
  'oversize metadata must remain reachable above the shelf'
);
assert.doesNotMatch(
  themeCss,
  /\.now-playing-spectrum-shell\s*{\s*display:\s*none/,
  'theme breakpoints must retain the frequency display'
);
assert.match(
  themeCss,
  /\.theme-designed \.now-playing-layout\.now-playing-no-lyrics \.now-playing-spectrum/,
  'absence of lyrics must preserve the theme spectrum height budget'
);
assert.match(
  capacityContract,
  /\.now-playing-copy,[\s\S]*?\.now-playing-spectrum-caption\s*{[^}]*box-sizing:\s*border-box/,
  'theme text padding must remain inside the available column width'
);
assert.match(
  capacityContract,
  /\.now-playing-spectrum-shell\s*{[^}]*width:\s*auto;[^}]*align-self:\s*stretch/,
  'theme spectrum margins must be included in the available column width'
);
assert.doesNotMatch(
  css,
  /\.now-playing-spectrum-caption\s*{\s*display:\s*none/,
  'short windows must retain the spectrum time caption'
);
const sceneLyrics = themeCss.slice(
  themeCss.indexOf('/* Photograph and illustrated themes'),
  themeCss.indexOf('.modern-body.theme-daily .collection-player-label')
);
assert.match(sceneLyrics, /theme-scenic, \.theme-custom, \.theme-daily, \.theme-anime/);
assert.match(
  sceneLyrics,
  /\.now-playing-lyrics\s*{\s*background:\s*transparent;\s*border:\s*0;[\s\S]*?box-shadow:\s*none;[\s\S]*?backdrop-filter:\s*none/,
  'scene lyrics must reveal the image without a panel, border or backdrop'
);
assert.match(
  sceneLyrics,
  /\.now-playing-lyrics::after\s*{\s*display:\s*none/,
  'scene lyrics must not replace the removed panel with a pseudo-element scrim'
);

// eslint-disable-next-line no-console
console.log('Player dock layout contract passed.');
