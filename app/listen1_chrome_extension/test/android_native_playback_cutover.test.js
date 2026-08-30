/* eslint-env node */
/* eslint-disable no-console */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const playerSource = fs.readFileSync(
  path.join(root, 'js', 'player_thread.js'),
  'utf8'
);
const facadeSource = fs.readFileSync(
  path.join(root, 'js', 'l1_player.js'),
  'utf8'
);

const snapshot = {
  revision: 8,
  state: 'paused',
  metadata: { title: 'Native Song', artist: 'Native Artist' },
  durationMs: 180000,
  positionMs: 2000,
  volumePercent: 40,
  muted: false,
  mode: 'sequential',
  queue: [],
};

async function run() {
  const calls = [];
  let howlCount = 0;
  let browserMediaSessionCount = 0;
  const adapter = {
    isAvailable: () => true,
    connect({ onSnapshot }) {
      onSnapshot(snapshot);
      return { promise: Promise.resolve(snapshot), cancel() {} };
    },
    getPlaybackSnapshot: () => snapshot,
    command(command, payload) {
      calls.push({ kind: 'command', command, payload });
      return Promise.resolve(snapshot);
    },
    prepareSelection(payload) {
      calls.push({ kind: 'prepare', payload });
      return Promise.resolve({
        trackHandle: 'track-native',
        occurrenceId: 'occ-native',
        expectedRevision: 9,
      });
    },
    selectPrepared(prepared, options) {
      calls.push({ kind: 'select', prepared, options });
      return Promise.resolve({
        ...snapshot,
        revision: 9,
        state: options.playWhenReady ? 'playing' : 'paused',
      });
    },
    detach() {
      calls.push({ kind: 'detach' });
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
    Howl: function FakeHowl() {
      howlCount += 1;
    },
    MediaService: {},
    playerSendMessage() {},
    navigator: {
      mediaSession: {
        setActionHandler() {
          browserMediaSessionCount += 1;
        },
      },
    },
    window: {
      Listen2AndroidHttpAdapter: adapter,
      addEventListener() {},
    },
    getPlayerMode: () => 'front',
    getPlayer: () => context.window.threadPlayer,
    getPlayerAsync(_mode, callback) {
      callback(context.window.threadPlayer);
    },
    addPlayerListener() {
      throw new Error(
        'native cutover must not subscribe to legacy player messages'
      );
    },
  };
  vm.createContext(context);
  vm.runInContext(playerSource, context, { filename: 'player_thread.js' });
  vm.runInContext(facadeSource, context, { filename: 'l1_player.js' });
  const player = context.window.l1Player;
  const track = {
    id: 'bitrack_v_BV1xx411c7mD-42',
    source: 'bilibili',
    title: 'Song',
    artist: 'Artist',
    duration: 120,
    url: 'https://never-crosses-native-boundary.invalid/audio',
    headers: { Cookie: 'never' },
  };

  player.connectPlayer();
  player.setNewPlaylist([track]);
  player.play();
  await Promise.resolve();
  await Promise.resolve();
  player.pause();
  player.seek(0.5);
  player.next();
  player.prev();
  player.setVolume(70);
  player.mute();
  player.unmute();
  player.setLoopMode('shuffle');
  player.enqueueNext(track);
  await Promise.resolve();
  await Promise.resolve();
  player.removePlayNextQueueEntry('occ-native');
  player.movePlayNextQueueEntry('occ-native', 0);
  player.clearPlayNextQueue();

  assert.strictEqual(
    howlCount,
    0,
    'Android cutover must not construct a page-owned Howl'
  );
  assert.strictEqual(
    browserMediaSessionCount,
    0,
    'Android cutover must not register browser MediaSession controls'
  );
  assert.strictEqual(
    context.window.threadPlayer.playlist.length,
    0,
    'Android cutover must not mutate the local player queue'
  );
  const prepared = calls.find((call) => call.kind === 'prepare');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(prepared.payload)), {
    source: 'bilibili',
    bvid: 'BV1xx411c7mD',
    cid: 42,
    title: 'Song',
    artist: 'Artist',
    durationMs: 120000,
    mediaKind: 'audio',
  });
  assert.ok(!Object.prototype.hasOwnProperty.call(prepared.payload, 'url'));
  assert.ok(!Object.prototype.hasOwnProperty.call(prepared.payload, 'headers'));
  assert.deepStrictEqual(
    calls.filter((call) => call.kind === 'command').map((call) => call.command),
    [
      'pause',
      'seek',
      'next',
      'previous',
      'volume',
      'mute',
      'mute',
      'mode',
      'remove',
      'reorder',
      'clear',
    ]
  );
  assert.strictEqual(
    player.status.playing.state,
    'paused',
    'facade status comes from native snapshots'
  );
  console.log('android native playback cutover tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
