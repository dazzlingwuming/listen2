/* eslint-env node */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const play = fs.readFileSync(path.join(root, 'js/controller/play.js'), 'utf8');
const handlers = play.slice(
  play.indexOf('    $scope.openLyricPicker = () => {'),
  play.indexOf('    $scope.chooseLyricCandidate = (candidate) => {')
);

function makeController(options = {}) {
  const calls = [];
  const scope = {
    currentPlaying: {
      id: 'bitrack_123',
      title: 'Video title',
      artist: 'Uploader must not become artist',
    },
    lyricSearch: { title: '', artist: '' },
    $evalAsync: (callback) => callback(),
    $on: () => {},
  };
  vm.runInNewContext(
    `let lyricSearchToken = 0;
    let neteaseLyricVerificationToken = 0;
    let activeLyricSearch = null;
    let activeLyricSearchKey = '';
    ${handlers}`,
    {
      $scope: scope,
      $timeout: () => {},
      window: { matchMedia: () => ({ matches: false }) },
      document: options.document || { querySelector: () => null },
      MediaService: {
        getLyricSearchQuery: () => 'Suggested title',
        searchLyrics: (track, fields, options) => {
          const call = { track, fields, options, cancelled: false };
          calls.push(call);
          return {
            cancel: () => {
              call.cancelled = true;
            },
          };
        },
      },
      decorateLyricCandidate: (candidate) => candidate,
      compareLyricCandidates: (a, b) => a.id.localeCompare(b.id),
      isBilibiliTrack: (track) => track && track.id.startsWith('bitrack_'),
      i18next: { t: (key) => key },
    }
  );
  return { scope, calls };
}

function update(call, options = {}) {
  call.options.onUpdate({
    candidates: [{ id: 'a', lyric: '[00:00]Lyrics' }],
    sources: [{ source: 'QQ', stage: 'lyrics', status: 'success' }],
    pending: false,
    ...options,
  });
}

const current = makeController();
current.scope.openLyricPicker();
assert.strictEqual(current.calls.length, 0, 'opening must not search');
assert.strictEqual(current.scope.lyricSearch.title, 'Suggested title');
assert.strictEqual(
  current.scope.lyricSearch.artist,
  '',
  'never prefill uploader'
);
assert.strictEqual(current.scope.lyricSearchState, 'idle');
current.scope.lyricSearch.title = ' 折风渡夜 ';
current.scope.lyricSearch.artist = ' 泽国同学 ';
current.scope.searchLyricCandidates();
assert.strictEqual(current.calls.length, 1);
assert.strictEqual(current.calls[0].fields.title, '折风渡夜');
assert.strictEqual(current.calls[0].fields.artist, '泽国同学');
assert.strictEqual(current.scope.lyricSearchSubmitted.title, '折风渡夜');
update(current.calls[0]);
assert.strictEqual(current.scope.lyricSearchState, 'results');
current.scope.lyricSearch.artist = '';
current.scope.editLyricSearch();
assert.strictEqual(current.calls[0].cancelled, true);
assert.strictEqual(current.scope.lyricSearchState, 'edited');
assert.strictEqual(current.scope.lyricSearchSubmitted, null);
assert.strictEqual(current.scope.lyricSearchResults.length, 0);
update(current.calls[0]);
assert.strictEqual(
  current.scope.lyricSearchResults.length,
  0,
  'late result ignored'
);
current.scope.searchLyricCandidates();
assert.strictEqual(current.calls[1].fields.artist, '', 'artist can stay empty');
current.scope.openLyricPicker();
assert.strictEqual(
  current.calls[1].cancelled,
  true,
  'reopening cancels pending search'
);
assert.strictEqual(current.calls.length, 2, 'reopening must not search');
update(current.calls[1]);
assert.strictEqual(current.scope.lyricSearchState, 'idle');
assert.strictEqual(current.scope.lyricSearchResults.length, 0);
assert.strictEqual(
  current.scope.lyricSearch.title,
  ' 折风渡夜 ',
  'retain edited fields'
);
current.scope.lyricSearch.title = '   ';
current.scope.editLyricSearch();
current.scope.searchLyricCandidates();
assert.strictEqual(current.calls.length, 2, 'empty title must not request');
assert.strictEqual(current.scope.lyricSearchState, 'required');

for (const mutate of [
  (scope) => {
    scope.lyricSearch.title = 'Other title';
  },
  (scope) => {
    scope.lyricSearch.artist = 'Other artist';
  },
  (scope) => {
    scope.currentPlaying = { id: 'bitrack_456' };
  },
  (scope) => {
    scope.closeLyricPicker();
  },
]) {
  const stale = makeController();
  stale.scope.openLyricPicker();
  stale.scope.searchLyricCandidates();
  mutate(stale.scope);
  update(stale.calls[0]);
  assert.strictEqual(stale.scope.lyricSearchResults.length, 0);
}
const empty = makeController();
empty.scope.openLyricPicker();
empty.scope.searchLyricCandidates();
update(empty.calls[0], {
  candidates: [],
  sources: [{ source: 'QQ', stage: 'lyrics', status: 'no-synced-lyrics' }],
});
assert.strictEqual(empty.scope.lyricSearchState, 'no-synced');
assert.strictEqual(empty.scope.lyricSearchPartial, false);
assert.strictEqual(
  empty.scope.lyricSourceStatus({ status: 'unavailable', stage: 'catalog' }),
  '_LYRIC_CATALOG_UNAVAILABLE'
);
assert.strictEqual(
  empty.scope.lyricSourceStatus({ status: 'unavailable', stage: 'lyrics' }),
  '_LYRIC_LYRICS_UNAVAILABLE'
);
assert.strictEqual(
  empty.scope.lyricSourceStatus({
    status: 'unavailable',
    stage: 'catalog',
    reason: 'rate-limited',
    httpStatus: 429,
    retryAfterMs: 1000,
  }),
  '_LYRIC_STAGE_CATALOG: _LYRIC_REASON_RATE_LIMITED'
);
assert.strictEqual(
  empty.scope.lyricSourceStatus({
    status: 'unavailable',
    stage: 'lyrics',
    reason: 'service-busy',
    httpStatus: 503,
  }),
  '_LYRIC_STAGE_LYRICS: _LYRIC_REASON_SERVICE_BUSY'
);
assert.strictEqual(
  empty.scope.lyricSourceStatus({
    status: 'timeout',
    stage: 'catalog',
    reason: 'connection-failed',
    networkStage: 'tls',
    networkCode: 'ECONNRESET',
    attempts: 2,
    message: 'must not be shown',
    url: 'https://private.invalid/',
  }),
  '_LYRIC_STAGE_CATALOG: _LYRIC_NETWORK_TLS_FAILED'
);
assert.strictEqual(
  empty.scope.lyricSourceStatus({
    status: 'invalid-response',
    stage: 'catalog',
    reason: 'netease-unexpected-result',
  }),
  '_LYRIC_STAGE_CATALOG: _LYRIC_REASON_NETEASE_UNEXPECTED_RESULT'
);
assert.strictEqual(
  empty.scope.lyricSourceStatus({
    status: 'unavailable',
    stage: 'catalog',
    reason: 'unrecognized-reason',
  }),
  '_LYRIC_CATALOG_UNAVAILABLE',
  'unknown reason must fall back to the existing safe status'
);
assert.strictEqual(
  empty.scope.lyricSourceStatus({
    status: 'verification-required',
    stage: 'catalog',
    reason: 'rate-limited',
  }),
  '_LYRIC_STAGE_CATALOG: _LYRIC_SOURCE_VERIFICATION_REQUIRED',
  'verification flow keeps its existing status'
);
assert.strictEqual(
  empty.scope.lyricSourceStatus({
    status: 'no-synced-lyrics',
    stage: 'lyrics',
    reason: 'service-busy',
  }),
  '_LYRIC_SOURCE_NO_SYNCED_LYRICS'
);
// Native details must collapse for a fresh request, even before ng-if updates.
const sourceDetails = { open: true };
const detailsController = makeController({
  document: { querySelector: () => sourceDetails },
});
detailsController.scope.openLyricPicker();
assert.strictEqual(sourceDetails.open, false, 'reopening collapses sources');
sourceDetails.open = true;
detailsController.scope.searchLyricCandidates();
assert.strictEqual(sourceDetails.open, false, 'new search collapses sources');
sourceDetails.open = true;
detailsController.scope.editLyricSearch();
assert.strictEqual(sourceDetails.open, false, 'editing collapses sources');

// The disclosure summary participates in the same keyboard cycle as inputs.
let focused = '';
const firstInput = {
  offsetWidth: 100,
  focus: () => {
    focused = 'input';
  },
};
const summary = {
  offsetWidth: 100,
  focus: () => {
    focused = 'summary';
  },
};
const focusDocument = {
  activeElement: summary,
  querySelector: () => ({
    querySelectorAll: (selector) => {
      assert(selector.includes('summary'), 'native summary is focusable');
      return [firstInput, summary];
    },
  }),
};
const keyboard = makeController({ document: focusDocument });
let prevented = 0;
keyboard.scope.handleLyricPickerKeydown({
  key: 'Tab',
  preventDefault: () => {
    prevented += 1;
  },
});
assert.strictEqual(focused, 'input');
focusDocument.activeElement = firstInput;
keyboard.scope.handleLyricPickerKeydown({
  key: 'Tab',
  shiftKey: true,
  preventDefault: () => {
    prevented += 1;
  },
});
assert.strictEqual(focused, 'summary');
keyboard.scope.lyricPickerOpen = true;
keyboard.scope.handleLyricPickerKeydown({
  key: 'Escape',
  preventDefault: () => {
    prevented += 1;
  },
  stopPropagation: () => {},
});
assert.strictEqual(keyboard.scope.lyricPickerOpen, false);
assert.strictEqual(prevented, 3);

const html = fs.readFileSync(path.join(root, 'listen1.html'), 'utf8');
assert.match(html, /ng-model="lyricSearch.title"/);
assert.match(html, /ng-model="lyricSearch.artist"/);
assert.strictEqual(
  (html.match(/ng-change="editLyricSearch\(\)"/g) || []).length,
  2
);
for (const locale of ['zh-CN', 'zh-TC', 'en-US', 'fr-FR', 'ko-KR', 'pt-BR']) {
  const translations = JSON.parse(
    fs.readFileSync(path.join(root, 'i18n', `${locale}.json`), 'utf8')
  );
  for (const key of [
    'SEARCH_TITLE_LABEL',
    'SEARCH_ARTIST_LABEL',
    'SEARCH_HELP',
    'SEARCH_IDLE',
    'SEARCH_EDITED',
    'SEARCH_TITLE_REQUIRED',
    'SOURCE_NO_SYNCED_LYRICS',
    'SOURCE_DETAILS',
    'CATALOG_UNAVAILABLE',
    'LYRICS_UNAVAILABLE',
    'REASON_RATE_LIMITED',
    'REASON_SERVICE_BUSY',
    'REASON_CONNECTION_FAILED',
    'REASON_NETEASE_UNEXPECTED_RESULT',
    'NETWORK_DNS_FAILED',
    'NETWORK_CONNECT_FAILED',
    'NETWORK_TLS_FAILED',
    'NETWORK_RESPONSE_FAILED',
  ]) {
    assert(translations[`_LYRIC_${key}`], `${locale}: ${key}`);
  }
}
console.log('Manual lyric search UI behavior passed');
