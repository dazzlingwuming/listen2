/* eslint-env node */
/* eslint-disable no-console */
/* eslint-disable no-underscore-dangle -- The VM harness asserts Player's legacy private state. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const extensionRoot = path.join(__dirname, '..');
const playerSource = fs.readFileSync(
  path.join(extensionRoot, 'js', 'player_thread.js'),
  'utf8'
);

function loadPlayer() {
  const events = [];
  const timers = [];
  const context = {
    Date,
    Map,
    Set,
    URL,
    Math,
    Number,
    Object,
    String,
    Array,
    Promise,
    performance: { now: () => Date.now() },
    navigator: {},
    window: {},
    document: {
      createElement() {
        return { canPlayType: () => 'probably' };
      },
    },
    setInterval() {
      return 1;
    },
    clearInterval() {},
    setTimeout(callback) {
      timers.push(callback);
      return timers.length;
    },
    clearTimeout() {},
    playerSendMessage(mode, message) {
      events.push({ mode, message });
    },
    MediaService: {},
    Howler: {
      unload() {},
      volume: () => 1,
      mute() {},
    },
    Howl: class FakeHowl {},
  };
  vm.createContext(context);
  vm.runInContext(
    playerSource.replace(
      'const threadPlayer = new Player();',
      'window.__Player = Player;\n  const threadPlayer = new Player();'
    ),
    context,
    { filename: 'player_thread.js' }
  );
  return { Player: context.window.__Player, context, events, timers };
}

function run() {
  const { Player, events } = loadPlayer();
  assert.strictEqual(typeof Player, 'function');
  assert.strictEqual(
    typeof Player.getHowlFormatForDescriptor,
    'function',
    'Bilibili descriptors need MIME/codec-aware Howler selection'
  );
  assert.strictEqual(
    typeof Player.prototype.confirmForegroundProgress,
    'function',
    'visible playback success must be confirmed from measured progress'
  );

  const mp4 = Player.getHowlFormatForDescriptor({
    platform: 'bilibili',
    mimeType: 'audio/mp4',
    codecs: 'mp4a.40.2',
  });
  assert.strictEqual(mp4.supported, true);
  assert.strictEqual(mp4.format, 'm4a');
  const unsupported = Player.getHowlFormatForDescriptor({
    platform: 'bilibili',
    mimeType: 'audio/unsupported',
    codecs: 'unknown',
  });
  assert.strictEqual(unsupported.supported, false);
  assert.deepStrictEqual(
    Array.from(
      Player.getMediaUrlCandidates({
        url: 'https://cdn.example/a',
        urlCandidates: [
          'https://cdn.example/a',
          'https://cdn.example/b',
          'https://cdn.example/c',
          'https://cdn.example/d',
          'https://cdn.example/e',
        ],
      })
    ),
    [
      'https://cdn.example/a',
      'https://cdn.example/b',
      'https://cdn.example/c',
      'https://cdn.example/d',
    ],
    'candidate recovery must preserve order, dedupe, and stay bounded'
  );

  const player = new Player();
  const track = { id: 'bitrack_v_BV1xx-101', source: 'bilibili' };
  const howl = {
    seek: () => 0,
    playing: () => true,
  };
  player.playlist = [track];
  player.index = 0;
  track.howl = howl;
  player.beginForegroundPlaybackProof(0, track, {
    requestToken: 9,
    selectedCid: 101,
    platform: 'bilibili',
  });
  assert.strictEqual(player._foreground_playback_proof.state, 'resolving');
  assert.strictEqual(
    player.confirmForegroundProgress(howl, track, 0),
    false,
    'zero position is never visible playing'
  );
  assert.strictEqual(player.confirmForegroundProgress(howl, track, 0.4), true);
  assert.strictEqual(player._foreground_playback_proof.state, 'playing');
  assert.strictEqual(
    player.confirmForegroundProgress(howl, track, 0.7),
    false,
    'forward progress confirms only once'
  );
  player.markForegroundPlaybackPaused(howl, track);
  assert.strictEqual(player._foreground_playback_proof.state, 'paused');
  assert.ok(
    events.some(
      ({ message }) =>
        message.type === 'BG_PLAYER:FOREGROUND_PLAYBACK_STATE' &&
        message.data.state === 'playing'
    )
  );
  const staleTrack = { id: 'bitrack_v_stale', source: 'bilibili', howl };
  assert.strictEqual(
    player.confirmForegroundProgress(howl, staleTrack, 1),
    false,
    'stale track callbacks must not mutate the current proof'
  );

  assert.ok(!playerSource.includes('ExoPlayer'));
  assert.ok(!playerSource.includes('MediaSessionService'));
  console.log('android bilibili foreground playback tests passed');
}

run();
