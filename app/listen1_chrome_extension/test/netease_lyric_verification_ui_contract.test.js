/* eslint-env node */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const loweb = fs.readFileSync(path.join(root, 'js/loweb.js'), 'utf8');
const play = fs.readFileSync(path.join(root, 'js/controller/play.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'listen1.html'), 'utf8');
const api = loweb.slice(
  loweb.indexOf('  verifyNeteaseLyrics() {'),
  loweb.indexOf('  searchLyrics(trackInfo, query, options = {}) {')
);
const handlers = play.slice(
  play.indexOf('    function resetNeteaseLyricVerification() {'),
  play.indexOf('    $scope.chooseLyricCandidate = (candidate) => {')
);
const searchHandler = play.slice(
  play.indexOf('    $scope.searchLyricCandidates = (force = false) => {'),
  play.indexOf('    $scope.lyricSourceStatus = (source) =>')
);

assert.match(api, /invoke\('lyrics:verify-netease'\)/);
assert.doesNotMatch(api, /https?:\/\/|response\.(?:cookie|url|headers)/i);
assert.doesNotMatch(handlers, /document\.cookie|localStorage|https?:\/\//i);
assert.doesNotMatch(searchHandler, /verifyNeteaseLyrics\(/);
assert.strictEqual(
  (play.match(/MediaService\.verifyNeteaseLyrics\(\)/g) || []).length,
  1,
  'only the explicit manual action may open verification'
);
const button = html.match(
  /<button\s[^>]*ng-if="canVerifyNeteaseLyrics\(source\)"[^>]*>[\s\S]*?<\/button>/
);
assert(button, 'the challenge source must expose a manual verification button');
assert.match(button[0], /ng-click="verifyNeteaseLyrics\(source\)"/);
assert.match(button[0], /ng-disabled="neteaseLyricVerificationPending"/);
assert.match(html, /_LYRIC_VERIFY_HINT/);
['closeLyricPicker', 'searchLyricCandidates'].forEach((name) => {
  const start = play.indexOf(`$scope.${name} =`);
  const end = play.indexOf('\n    $scope.', start + 1);
  assert.match(play.slice(start, end), /resetNeteaseLyricVerification\(\)/);
});
assert.match(
  play,
  /\$scope\.\$on\('\$destroy',[\s\S]*?resetNeteaseLyricVerification\(\)/
);

function makeApi(ipcRenderer) {
  return vm.runInNewContext(`({${api}})`, {
    getDesktopLocalDataIpcRenderer: () => ipcRenderer,
  });
}

function makeController() {
  const source = { source: '网易云', status: 'verification-required' };
  let settle;
  let requests = 0;
  const retries = [];
  const scope = {
    isChrome: false,
    currentPlaying: { id: 'bitrack_123' },
    lyricPickerOpen: true,
    lyricSearch: { query: 'Exact manual query' },
    lyricSearchSources: [source],
    $evalAsync: (callback) => callback(),
    searchLyricCandidates: (force) => retries.push(force),
  };
  const lifecycle = vm.runInNewContext(
    `(() => {
      let lyricSearchToken = 1;
      let neteaseLyricVerificationToken = 0;
      ${handlers}
      return {
        reset: resetNeteaseLyricVerification,
        changeSearch: () => { lyricSearchToken += 1; },
      };
    })()`,
    {
      $scope: scope,
      MediaService: {
        verifyNeteaseLyrics: () => {
          requests += 1;
          return new Promise((resolve) => {
            settle = resolve;
          });
        },
      },
      isBilibiliTrack: (track) => track && track.id.startsWith('bitrack_'),
      i18next: { t: (key) => key },
    }
  );
  return {
    scope,
    source,
    retries,
    lifecycle,
    settle: (response) => settle(response),
    requests: () => requests,
  };
}

async function run() {
  const unsupported = await makeApi(null).verifyNeteaseLyrics();
  assert.strictEqual(unsupported.status, 'unsupported');
  let invocation;
  const ready = await makeApi({
    invoke: (...args) => {
      invocation = args;
      return Promise.resolve({
        ok: true,
        status: 'retry-ready',
        cookie: 'private',
        url: 'private',
      });
    },
  }).verifyNeteaseLyrics('https://caller.invalid', { cookie: 'caller' });
  assert.deepStrictEqual(invocation, ['lyrics:verify-netease']);
  assert.deepStrictEqual(Object.keys(ready).sort(), ['ok', 'status']);
  assert.strictEqual(ready.ok, true);
  assert.strictEqual(ready.status, 'retry-ready');
  const invalid = await makeApi({
    invoke: () => Promise.resolve({ ok: true, status: 'verified' }),
  }).verifyNeteaseLyrics();
  assert.strictEqual(invalid.status, 'invalid-response');
  const expired = await makeApi({
    invoke: () =>
      Promise.resolve({ ok: false, status: 'verification-unavailable' }),
  }).verifyNeteaseLyrics();
  assert.strictEqual(expired.status, 'verification-unavailable');
  const unavailable = await makeApi({
    invoke: () => Promise.reject(new Error('private transport detail')),
  }).verifyNeteaseLyrics();
  assert.strictEqual(unavailable.status, 'unavailable');

  const current = makeController();
  assert.strictEqual(
    current.scope.canVerifyNeteaseLyrics(current.source),
    true
  );
  assert.strictEqual(
    current.scope.canVerifyNeteaseLyrics({
      source: 'QQ',
      status: 'verification-required',
    }),
    false
  );
  assert.strictEqual(
    current.scope.canVerifyNeteaseLyrics({
      source: '网易云',
      status: 'unavailable',
    }),
    false
  );
  current.scope.isChrome = true;
  await current.scope.verifyNeteaseLyrics(current.source);
  assert.strictEqual(current.requests(), 0);
  current.scope.isChrome = false;
  const pending = current.scope.verifyNeteaseLyrics(current.source);
  assert.strictEqual(current.scope.neteaseLyricVerificationPending, true);
  await current.scope.verifyNeteaseLyrics(current.source);
  assert.strictEqual(
    current.requests(),
    1,
    'duplicate clicks must not open another window'
  );
  current.settle({ ok: true, status: 'retry-ready' });
  await pending;
  assert.deepStrictEqual(current.retries, [true]);
  assert.strictEqual(current.scope.neteaseLyricVerificationPending, false);

  const staleChanges = [
    (state) => {
      state.scope.lyricPickerOpen = false;
    },
    (state) => {
      state.scope.currentPlaying = { id: 'bitrack_456' };
    },
    (state) => {
      state.scope.lyricSearch.query = 'edited query';
    },
    (state) => state.lifecycle.changeSearch(),
    (state) => state.lifecycle.reset(),
  ];
  for (const change of staleChanges) {
    const stale = makeController();
    const completion = stale.scope.verifyNeteaseLyrics(stale.source);
    change(stale);
    stale.settle({ ok: true, status: 'retry-ready' });
    await completion;
    assert.deepStrictEqual(
      stale.retries,
      [],
      'stale completion must not retry'
    );
    assert.strictEqual(stale.scope.neteaseLyricVerificationPending, false);
  }
  const failed = makeController();
  const failure = failed.scope.verifyNeteaseLyrics(failed.source);
  failed.settle({ ok: false, status: 'verification-unavailable' });
  await failure;
  assert.strictEqual(
    failed.scope.neteaseLyricVerificationError,
    '_LYRIC_VERIFY_EXPIRED'
  );
  assert.deepStrictEqual(failed.retries, []);
  ['zh-CN', 'zh-TC', 'en-US', 'fr-FR', 'ko-KR', 'pt-BR'].forEach((locale) => {
    const translations = JSON.parse(
      fs.readFileSync(path.join(root, 'i18n', `${locale}.json`), 'utf8')
    );
    [
      'ACTION',
      'PENDING',
      'HINT',
      'UNAVAILABLE',
      'ALREADY_OPEN',
      'EXPIRED',
    ].forEach((key) => {
      assert(
        translations[`_LYRIC_VERIFY_${key}`],
        `${locale} must translate ${key}`
      );
    });
  });
  console.log('NetEase lyric verification UI contracts passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
