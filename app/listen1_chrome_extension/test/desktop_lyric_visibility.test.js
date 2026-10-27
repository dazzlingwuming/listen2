/* eslint-env node */
/* eslint-disable no-console */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const play = fs.readFileSync(path.join(root, 'js/controller/play.js'), 'utf8');
const html = fs.readFileSync(
  process.env.DESKTOP_LYRIC_HTML || path.join(root, 'listen1.html'),
  'utf8'
);

function between(source, start, end) {
  const from = source.indexOf(start);
  assert.notStrictEqual(from, -1, `missing source marker: ${start}`);
  const to = source.indexOf(end, from + start.length);
  assert.notStrictEqual(to, -1, `missing source marker: ${end}`);
  return source.slice(from, to).trim();
}

const realFunctions = [
  between(
    play,
    'function classifyNativeLyricState(input)',
    'function normalizeLyricTerminalStatus'
  ),
  between(
    play,
    'function normalizeLyricTerminalStatus(value)',
    'function compareLyricCandidates(left, right)'
  ),
  between(
    play,
    'function parseLyric(lyric, tlyric)',
    'function isBilibiliTrack(track)'
  ),
  between(
    play,
    'function setPrimaryLyricState(track, state)',
    'function getNativeLyricIdentity()'
  ),
  between(
    play,
    'function resetLyricDisplay()',
    'function applyLyricResult(track, result)'
  ),
  between(
    play,
    'function applyLyricResult(track, result)',
    'function lyricResultToCandidate(track, result)'
  ),
  between(
    play,
    'function requestTrackLyric(track, forceRefresh = false)',
    '$scope.openLyricPicker = () =>'
  ),
  between(
    play,
    '$scope.chooseLyricCandidate = (candidate) => {',
    '$scope.restoreAutoLyric = () =>'
  ),
].join('\n');

const lyricGate = html.match(/class="lyric"\s+ng-show="([^"]+)"/);
assert(
  lyricGate,
  'desktop lyric body must retain an explicit visibility contract'
);
const evaluateAngularExpression = (expression, scope) =>
  vm.runInNewContext(`Boolean(${expression})`, scope);
const bodyIsVisible = (scope) => evaluateAngularExpression(lyricGate[1], scope);
const statusGates = [
  ...html.matchAll(/class="now-playing-empty-lyrics"\s+ng-if="([^"]+)"/g),
].map((match) => match[1]);
assert.strictEqual(
  statusGates.length,
  3,
  'loading, unavailable and error states each have a status card'
);
const visibleStatusCards = (scope) =>
  statusGates.filter((gate) => evaluateAngularExpression(gate, scope));
const scopeForState = (
  state,
  { trackId = 'track-a', lyricArray = [] } = {}
) => ({
  currentPlaying: { id: 'track-a' },
  primaryLyricState: { state, trackId },
  lyricArray,
});

function makeHarness({ cache, providerResult, duration = 180 } = {}) {
  const scope = {
    currentPlaying: { id: 'bitrack_test', source: 'bilibili', duration },
    lyricArray: [],
    lyricLineNumber: -1,
    lyricLineNumberTrans: -1,
    lyricOffsetMs: 0,
    enableLyricTranslation: true,
    $evalAsync(callback) {
      if (callback) callback();
    },
    $on() {},
    closeLyricPicker() {
      this.lyricPickerOpen = false;
    },
  };
  const calls = { cache: 0, provider: 0, saves: 0 };
  const context = {
    $scope: scope,
    $timeout(callback) {
      callback();
    },
    document: { querySelector: () => null },
    window: { matchMedia: () => ({ matches: true }) },
    MediaService: {
      getPersistentLyric() {
        calls.cache += 1;
        return Promise.resolve({ result: cache || null, record: null });
      },
      putPersistentLyric() {
        calls.saves += 1;
        return Promise.resolve({ ok: true });
      },
    },
    legacyBilibiliLyricMigration: Promise.resolve(),
    isElectron: () => true,
    isAndroidTranslationSurface: () => false,
    androidPlaybackAdapter: null,
    getNativeLyricIdentity: () => null,
    isCurrentNativeLyricIdentity: () => true,
    smoothScrollTo() {},
    refreshFloatingLyric() {},
    isCurrentLyricRequest: (track, token) =>
      scope.currentPlaying.id === track.id &&
      token === context.lyricRequestToken,
    isCurrentPrimaryLyricState: (track, token) =>
      scope.currentPlaying.id === track.id &&
      token === context.lyricRequestToken &&
      scope.primaryLyricState.token === token,
    getProviderLyric() {
      calls.provider += 1;
      return Promise.resolve(providerResult);
    },
    persistAutomaticLyric() {
      return Promise.resolve(null);
    },
    resetLyricTranslationConfirmation() {},
    notyf: { warning() {} },
    getLyricStorageFailureMessage: () => 'save failed',
    canUseManualLyric: (track) => Boolean(track && track.source === 'bilibili'),
    decorateLyricCandidate: (candidate) => ({
      ...candidate,
      hasTranslation: Boolean(candidate.tlyric),
    }),
    persistManualLyric: () =>
      Promise.resolve({ ok: true, record: { revision: 1 } }),
    candidateToLyricResult: (candidate) => ({
      ...candidate,
      source: 'manual-selection',
    }),
    lyricMachineTranslationLabel: () => '机器翻译',
    lyricRequestToken: 0,
    manualLyricResolveToken: 0,
    manualLyricSelectionToken: 0,
    playControllerDestroyed: false,
    activeLyricTranslationHandle: null,
    applyAutomaticLyricTranslation() {},
    resolveCandidateTranslation() {
      return Promise.resolve(null);
    },
    notifyTranslationResult() {},
    isBilibiliTrack: (track) => track && track.source === 'bilibili',
    getTrackLyricOffset: () => 0,
    MAX_LYRIC_OFFSET_MS: 10000,
    localStorage: { setObject() {} },
  };
  vm.createContext(context);
  vm.runInContext(
    `${realFunctions}\n$scope.primaryLyricState = { state: 'idle', trackId: '', token: 0 };`,
    context
  );
  return { scope, context, calls };
}

async function flush() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

const goodLrc =
  '[00:01.00]Original one\n[00:02.00]Original two\n[00:03.00]Original three';
const goodTranslation = '[00:01.00]翻译一\n[00:02.00]翻译二\n[00:03.00]翻译三';

async function testCacheRecovery() {
  const harness = makeHarness({
    cache: {
      lyric: goodLrc,
      tlyric: goodTranslation,
      source: 'manual-selection',
      lyricCacheMode: 'manual',
    },
  });
  vm.runInContext('requestTrackLyric($scope.currentPlaying)', harness.context);
  await flush();
  assert.strictEqual(
    harness.calls.cache,
    1,
    'startup restore reads the real persistent lyric cache'
  );
  assert.strictEqual(
    harness.calls.provider,
    0,
    'manual cache restore does not fall through to provider'
  );
  assert.strictEqual(harness.scope.lyricSource, 'manual-selection');
  assert.strictEqual(
    harness.scope.lyricArray.length,
    6,
    'original and translated lines are parsed'
  );
  assert.strictEqual(harness.scope.primaryLyricState.state, 'synchronized');
  assert.strictEqual(
    bodyIsVisible(harness.scope),
    true,
    `manual cache lyrics hidden by ${lyricGate[1]}`
  );
}

async function testAutomaticProvider() {
  const harness = makeHarness({
    providerResult: {
      lyric: goodLrc,
      tlyric: goodTranslation,
      source: 'qq-match',
    },
  });
  vm.runInContext('requestTrackLyric($scope.currentPlaying)', harness.context);
  await flush();
  assert.strictEqual(
    harness.calls.provider,
    1,
    'cache miss uses the actual provider path'
  );
  assert.strictEqual(harness.scope.lyricArray.length, 6);
  assert.strictEqual(harness.scope.primaryLyricState.state, 'synchronized');
  assert.strictEqual(
    bodyIsVisible(harness.scope),
    true,
    `provider lyrics hidden by ${lyricGate[1]}`
  );
}

async function testManualSelection() {
  const harness = makeHarness();
  const candidate = {
    lyric: goodLrc,
    tlyric: goodTranslation,
    title: 'Matched',
    artist: 'Artist',
  };
  harness.scope.chooseLyricCandidate(candidate);
  await flush();
  assert.strictEqual(harness.scope.lyricSource, 'manual-selection');
  assert.strictEqual(harness.scope.lyricArray.length, 6);
  assert.strictEqual(harness.scope.primaryLyricState.state, 'synchronized');
  assert.strictEqual(
    bodyIsVisible(harness.scope),
    true,
    `manual selection lyrics hidden by ${lyricGate[1]}`
  );
}

function testOtherAcceptedStatesAndStatusCards() {
  const oneRenderedLine = [{ lineNumber: 0, content: 'Rendered lyric' }];
  ['synchronized', 'text-only', 'insufficient-timestamp'].forEach((state) => {
    const valid = scopeForState(state, { lyricArray: oneRenderedLine });
    assert.strictEqual(
      bodyIsVisible(valid),
      true,
      `${state} with a rendered line remains visible`
    );
    assert.deepStrictEqual(
      visibleStatusCards(valid),
      [],
      `${state} with a rendered line has no competing status card`
    );
  });

  const insufficient = makeHarness();
  vm.runInContext(
    "applyLyricResult($scope.currentPlaying, { lyric: '[00:01.00]One line', source: 'qq-match' })",
    insufficient.context
  );
  assert.strictEqual(
    insufficient.scope.primaryLyricState.state,
    'insufficient-timestamp'
  );
  assert.strictEqual(insufficient.scope.lyricArray.length, 1);
  assert.strictEqual(
    bodyIsVisible(insufficient.scope),
    true,
    'one valid timed line is still visible'
  );

  const textOnly = makeHarness();
  vm.runInContext(
    "applyLyricResult($scope.currentPlaying, { lyric: 'Plain text without timestamps', source: 'qq-match' })",
    textOnly.context
  );
  assert.strictEqual(textOnly.scope.primaryLyricState.state, 'text-only');
  assert.strictEqual(
    textOnly.scope.lyricArray.length,
    0,
    'parser has no timed lines to render'
  );
  assert.strictEqual(
    bodyIsVisible(textOnly.scope),
    false,
    'plain text without timestamps has no rendered line'
  );
  assert.strictEqual(
    visibleStatusCards(textOnly.scope).length,
    1,
    'a text-only result with no parsed lines gets an empty-result explanation'
  );

  const emptyStates = [
    'unavailable',
    'no-lyric',
    'provider-refusal',
    'duration-mismatch',
    'cancelled',
    'idle',
    'content',
    'synchronized',
    'text-only',
    'insufficient-timestamp',
  ];
  emptyStates.forEach((state) => {
    const empty = scopeForState(state);
    assert.strictEqual(
      bodyIsVisible(empty),
      false,
      `${state} with no lines has no body`
    );
    assert.strictEqual(
      visibleStatusCards(empty).length,
      1,
      `${state} with no lines has one empty state card`
    );
  });

  const errorStates = ['error', 'timeout', 'schema-error'];
  errorStates.forEach((state) => {
    const error = scopeForState(state);
    assert.strictEqual(bodyIsVisible(error), false, `${state} has no body`);
    assert.strictEqual(
      visibleStatusCards(error).length,
      1,
      `${state} has one error card`
    );
  });

  ['loading', 'error', 'idle'].forEach((state) => {
    const pending = scopeForState(state, { lyricArray: oneRenderedLine });
    assert.strictEqual(
      bodyIsVisible(pending),
      false,
      `${state} cannot expose lines as current content`
    );
    assert.strictEqual(
      visibleStatusCards(pending).length,
      1,
      `${state} shows only its status card`
    );
  });

  const wrongTrack = scopeForState('synchronized', {
    trackId: 'track-old',
    lyricArray: oneRenderedLine,
  });
  assert.strictEqual(
    bodyIsVisible(wrongTrack),
    false,
    'lyrics from another track are hidden'
  );
  assert.strictEqual(
    visibleStatusCards(wrongTrack).length,
    0,
    'old track must not show a stale status card'
  );
}

async function testLoadingFailureAndStaleTrack() {
  const harness = makeHarness({
    cache: { lyric: '', source: 'manual-selection', lyricCacheMode: 'manual' },
  });
  vm.runInContext('requestTrackLyric($scope.currentPlaying)', harness.context);
  assert.strictEqual(harness.scope.primaryLyricState.state, 'loading');
  assert.strictEqual(visibleStatusCards(harness.scope).length, 1);
  assert.strictEqual(
    bodyIsVisible(harness.scope),
    false,
    'loading with no lines stays hidden'
  );
  await flush();
  assert.strictEqual(harness.scope.primaryLyricState.state, 'no-lyric');
  assert.strictEqual(harness.scope.lyricArray.length, 0);
  assert.strictEqual(
    bodyIsVisible(harness.scope),
    false,
    'empty cache must not reveal a blank body'
  );
  assert.strictEqual(visibleStatusCards(harness.scope).length, 1);

  const failed = makeHarness();
  failed.context.getProviderLyric = () => Promise.reject(new Error('offline'));
  vm.runInContext('requestTrackLyric($scope.currentPlaying)', failed.context);
  await flush();
  assert.strictEqual(failed.scope.primaryLyricState.state, 'error');
  assert.strictEqual(failed.scope.lyricArray.length, 0);
  assert.strictEqual(visibleStatusCards(failed.scope).length, 1);
  assert.strictEqual(
    bodyIsVisible(failed.scope),
    false,
    'provider failure keeps body hidden'
  );

  const stale = makeHarness({
    providerResult: { lyric: goodLrc, source: 'qq-match' },
  });
  const originalTrack = stale.scope.currentPlaying;
  vm.runInContext('requestTrackLyric($scope.currentPlaying)', stale.context);
  stale.scope.currentPlaying = {
    id: 'bitrack_next',
    source: 'bilibili',
    duration: 180,
  };
  await flush();
  assert.notStrictEqual(
    stale.scope.lyricSource,
    'qq-match',
    'late previous-track response cannot overwrite current state'
  );
  assert.strictEqual(
    bodyIsVisible(stale.scope),
    false,
    'stale result does not expose previous lyrics'
  );
  assert.strictEqual(originalTrack.id, 'bitrack_test');
}

(async () => {
  await testCacheRecovery();
  await testAutomaticProvider();
  await testManualSelection();
  testOtherAcceptedStatesAndStatusCards();
  await testLoadingFailureAndStaleTrack();
  console.log('desktop lyric visibility tests passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
