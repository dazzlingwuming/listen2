/* eslint-env node */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), 'utf8');

const appSource = read('js/app.js');
const profileSource = read('js/controller/profile.js');
const authSource = read('js/controller/auth.js');
const playlistSource = read('js/controller/playlist.js');

assert.doesNotMatch(
  appSource,
  /preload:\s*\[[^\]]*(zh-CN|en-US)/,
  'startup must not preload every translation bundle'
);

assert.match(
  profileSource,
  /getResourceBundle\(langKey, 'translation'\)/,
  'language setup should reuse the bundle already loaded by i18next'
);
assert.doesNotMatch(
  profileSource,
  /axios\.get\(['"]i18n\/zh-CN\.json['"]\)/,
  'language setup must not fetch the Chinese bundle a second time'
);

[
  ['profile', profileSource],
  ['authentication', authSource],
  ['playlist', playlistSource],
].forEach(([name, source]) => {
  assert.match(
    source,
    /requestIdleCallback/,
    `${name} startup work should yield until after the first paint`
  );
});

assert.match(
  profileSource,
  /runAfterFirstPaint\(\(\) => \{[\s\S]*api\.github\.com/,
  'release checks must not compete with the first render'
);
assert.match(
  authSource,
  /initialAuthRefreshPending[\s\S]*runAfterFirstPaint\(refresh\)/,
  'the initial multi-provider authentication refresh must be deferred'
);
assert.match(
  playlistSource,
  /initialPlaylistLoadPending[\s\S]*runAfterFirstPaint\(\$scope\.loadPlaylist\)/,
  'the initial remote playlist request must be deferred'
);

process.stdout.write('mobile startup performance contract tests passed\n');
