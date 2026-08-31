/* eslint-env node */
/* eslint-disable no-console */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const playerSource = fs.readFileSync(
  path.join(root, 'js/player_thread.js'),
  'utf8'
);
const facadeSource = fs.readFileSync(
  path.join(root, 'js/l1_player.js'),
  'utf8'
);
const playSource = fs.readFileSync(
  path.join(root, 'js/controller/play.js'),
  'utf8'
);
const htmlSource = fs.readFileSync(path.join(root, 'listen1.html'), 'utf8');

function topLevelFunctionSource(name) {
  const start = playSource.indexOf(`function ${name}(`);
  assert.notStrictEqual(start, -1, `${name} should exist`);
  const bodyStart = playSource.indexOf('{', start);
  let depth = 0;
  for (let index = bodyStart; index < playSource.length; index += 1) {
    if (playSource[index] === '{') depth += 1;
    if (playSource[index] === '}') depth -= 1;
    if (depth === 0) return playSource.slice(start, index + 1);
  }
  throw new Error(`Unable to parse ${name}`);
}

const snapshot = {
  revision: 18,
  state: 'paused',
  metadata: { title: 'Native Song', artist: 'Native Artist' },
  durationMs: 180000,
  positionMs: 65000,
  volumePercent: 50,
  muted: false,
  mode: 'sequential',
  queue: [],
  lyric: {
    source: 'netease',
    providerTrackId: '42',
    providerPartId: 42,
    trackHandle: 'track-native',
    occurrenceId: 'occ-native',
    selectionGeneration: 3,
    playbackRevision: 18,
    capability: 'primary-and-manual',
    state: 'ready',
  },
};

const context = {
  Date,
  Map,
  Math,
  Number,
  Promise,
  String,
  Array,
  Object,
  clearInterval() {},
  setInterval() {
    return 1;
  },
  setTimeout,
  clearTimeout,
  localStorage: { getObject: () => null, setObject() {} },
  Howler: { volume: () => 1, mute() {}, unload() {} },
  Howl() {
    throw new Error('Android must not construct Howl');
  },
  MediaService: {},
  playerSendMessage() {},
  navigator: { mediaSession: { setActionHandler() {} } },
  window: {
    Listen2AndroidHttpAdapter: {
      isAvailable: () => true,
      connect({ onSnapshot }) {
        onSnapshot(snapshot);
        return { promise: Promise.resolve(snapshot), cancel() {} };
      },
      getPlaybackSnapshot: () => snapshot,
      command: () => Promise.resolve(snapshot),
      detach() {},
    },
    addEventListener() {},
  },
  getPlayerMode: () => 'front',
  getPlayer: () => context.window.threadPlayer,
  getPlayerAsync(_mode, callback) {
    callback(context.window.threadPlayer);
  },
  addPlayerListener() {
    throw new Error('native path must not subscribe to page player');
  },
};

vm.createContext(context);
vm.runInContext(playerSource, context, { filename: 'player_thread.js' });
vm.runInContext(facadeSource, context, { filename: 'l1_player.js' });
context.window.l1Player.connectPlayer();

const lyricSnapshot = context.window.l1Player.getNativeLyricSnapshot();
assert.deepStrictEqual(JSON.parse(JSON.stringify(lyricSnapshot)), {
  pageEpoch: lyricSnapshot.pageEpoch,
  revision: 18,
  positionMs: 65000,
  durationMs: 180000,
  state: 'paused',
  source: 'netease',
  providerTrackId: '42',
  providerPartId: 42,
  trackHandle: 'track-native',
  occurrenceId: 'occ-native',
  selectionGeneration: 3,
  playbackRevision: 18,
  capability: 'primary-and-manual',
  lyricState: 'ready',
});
assert.match(playSource, /getNativeLyricSnapshot/);
assert.match(playSource, /selectionGeneration/);
assert.match(playSource, /lyricRequestToken/);
assert.match(playSource, /positionMs/);
assert.doesNotMatch(
  playSource.slice(
    playSource.indexOf('function syncAndroidLyricClock'),
    playSource.indexOf('function syncAndroidLyricClock') + 5000
  ),
  /l1Player\.status\.playing\.pos/
);
const classifyNativeLyricState = vm.runInThisContext(
  `(${topLevelFunctionSource('classifyNativeLyricState')})`
);
assert.strictEqual(
  classifyNativeLyricState({
    lineCount: 4,
    timedLineCount: 3,
    durationMs: 180000,
    matchedDurationMs: 180000,
    identityAccepted: true,
  }),
  'synchronized'
);
assert.strictEqual(
  classifyNativeLyricState({
    lineCount: 4,
    timedLineCount: 2,
    durationMs: 180000,
    matchedDurationMs: 180000,
    identityAccepted: true,
  }),
  'insufficient-timestamp'
);
assert.strictEqual(
  classifyNativeLyricState({
    lineCount: 3,
    timedLineCount: 3,
    durationMs: 180000,
    matchedDurationMs: 150000,
    identityAccepted: true,
  }),
  'duration-mismatch'
);
[
  'no-lyric',
  'provider-refusal',
  'timeout',
  'cancelled',
  'schema-error',
].forEach((status) => {
  assert.strictEqual(
    classifyNativeLyricState({
      terminalStatus: status,
      identityAccepted: true,
    }),
    status
  );
});
assert.strictEqual(
  classifyNativeLyricState({
    lineCount: 3,
    timedLineCount: 3,
    durationMs: 180000,
    matchedDurationMs: 180000,
    identityAccepted: false,
  }),
  'stale'
);
assert.match(playSource, /function canUseManualLyric\(track\)/);
assert.match(playSource, /function getCurrentLyricTrack\(track\)/);
assert.match(playSource, /nativeManualLyricPending/);
assert.match(playSource, /nativeManualLyricClearPending/);
assert.match(playSource, /nativeLyricOffsetPending/);
assert.match(playSource, /MediaService\.setLyricOffset/);
assert.match(htmlSource, /adjustLyricOffset\(-500\)/);
assert.match(htmlSource, /adjustLyricOffset\(500\)/);
console.log('android native lyric state tests passed');
