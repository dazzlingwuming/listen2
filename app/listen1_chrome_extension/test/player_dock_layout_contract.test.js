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

// eslint-disable-next-line no-console
console.log('Player dock layout contract passed.');
