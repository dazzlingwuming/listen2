/* eslint-env node */
/* eslint-disable no-console, no-underscore-dangle */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createPlayer(mediaService) {
  const filename = path.join(__dirname, '..', 'js', 'player_thread.js');
  const source = fs.readFileSync(filename, 'utf8');
  const howls = [];
  const howlerVolumeCalls = [];
  function MockHowl(options) {
    const howl = {
      _sounds: [],
      options,
      duration() {
        return 180;
      },
      play() {},
      playing() {
        return false;
      },
      seek() {
        return 0;
      },
      stop() {},
      unload() {},
    };
    howls.push(howl);
    return howl;
  }
  const context = {
    Date,
    URL,
    clearInterval() {},
    clearTimeout() {},
    console,
    Howl: MockHowl,
    Howler: {
      _muted: false,
      unload() {},
      volume(...args) {
        howlerVolumeCalls.push(args);
        return 1;
      },
    },
    MediaMetadata() {},
    MediaService: mediaService,
    navigator: { mediaSession: { setActionHandler() {} } },
    playerSendMessage() {},
    setInterval() {
      return 1;
    },
    setTimeout() {
      return 1;
    },
    window: {},
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename });
  return { player: context.window.threadPlayer, howls, howlerVolumeCalls };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function run() {
  let lookups = 0;
  let invalidates = 0;
  let bootstraps = 0;
  const { player, howls, howlerVolumeCalls } = createPlayer({
    getAudioCacheLookup() {
      lookups += 1;
      return Promise.resolve({
        ok: true,
        hit: true,
        entry: {
          cacheKey: 'a'.repeat(64),
          url: 'listen2-cache://audio/cache-hit',
          loudness: {
            integratedLufs: -20,
            truePeakDbtp: -10,
            gainDb: 6,
            targetLufs: -14,
            analyzerVersion: 'ebur128-v1',
            analyzedAt: '2026-08-25T00:00:00.000Z',
          },
        },
      });
    },
    invalidateAudioCache(cacheKey) {
      invalidates += 1;
      assert.strictEqual(cacheKey, 'a'.repeat(64));
      return Promise.resolve({ ok: true });
    },
    bootstrapTrack(_track, success) {
      bootstraps += 1;
      success({
        url: 'https://cdn.example/fresh.m4s',
        platform: 'bilibili',
      });
    },
  });
  const track = { id: 'bitrack_v_BV1ab411c7mD-10', source: 'bilibili' };
  player.playlist = [track];
  player.index = 0;
  player.play();
  await flush();

  assert.strictEqual(lookups, 1, 'READY local audio must be checked first');
  assert.strictEqual(
    bootstraps,
    0,
    'local cache hit must avoid remote bootstrap'
  );
  assert.strictEqual(howls.length, 1, 'local hit must create a playable Howl');
  assert.strictEqual(
    howls[0]._listen1TrackGain,
    10 ** (6 / 20),
    'a valid cache analysis must pass an independent linear gain to Howl'
  );
  assert.strictEqual(
    howlerVolumeCalls.length,
    0,
    'track normalization must not change Howler global-volume semantics'
  );
  const secondHowl = { stop() {} };
  player.playlist.push({
    id: 'bitrack_456',
    howl: secondHowl,
    _listen1_loudness: {
      integratedLufs: -8,
      truePeakDbtp: -1.2,
      gainDb: -6,
      targetLufs: -14,
      analyzerVersion: 'ebur128-v1',
      analyzedAt: 1760000000000,
    },
  });
  player.setLoudnessNormalizationEnabled(false);
  assert.strictEqual(
    howls[0]._listen1TrackGain,
    1,
    'turning normalization off must fall back to unity gain'
  );
  player.index = 1;
  assert.strictEqual(
    player.currentHowl._listen1TrackGain,
    1,
    'on-to-off must keep unity gain after switching to an already-created track'
  );
  player.index = 0;
  assert.strictEqual(
    player.currentHowl._listen1TrackGain,
    1,
    'on-to-off must keep unity gain after switching back to the first track'
  );
  player.setLoudnessNormalizationEnabled(true);
  assert.strictEqual(
    howls[0]._listen1TrackGain,
    10 ** (6 / 20),
    'off-to-on must restore the first pre-created track gain'
  );
  player.index = 1;
  assert.strictEqual(
    player.currentHowl._listen1TrackGain,
    10 ** (-6 / 20),
    'off-to-on must restore gain after switching to another pre-created track'
  );
  player.index = 0;
  howls[0].options.onloaderror(0, 'corrupt local cache');
  await flush();

  assert.strictEqual(
    invalidates,
    1,
    'local load error must invalidate its cache key'
  );
  assert.strictEqual(
    lookups,
    1,
    'the recovery path must bypass local lookup exactly once'
  );
  assert.strictEqual(
    bootstraps,
    1,
    'recovery must continue with bounded CDN flow'
  );
  assert.strictEqual(
    howls[1]._listen1TrackGain,
    1,
    'a cache-corruption recovery must rebuild with unity gain'
  );

  const invalidAnalysis = createPlayer({
    getAudioCacheLookup() {
      return Promise.resolve({
        ok: true,
        hit: true,
        entry: {
          cacheKey: 'b'.repeat(64),
          url: 'listen2-cache://audio/invalid-analysis',
          loudness: {
            integratedLufs: -18,
            truePeakDbtp: -1,
            gainDb: 100,
            targetLufs: -14,
            analyzerVersion: 'ebur128-v1',
            analyzedAt: '2026-08-25T00:00:00.000Z',
          },
        },
      });
    },
  });
  invalidAnalysis.player.playlist = [{ id: 'bitrack_123', source: 'bilibili' }];
  invalidAnalysis.player.index = 0;
  invalidAnalysis.player.play();
  await flush();
  assert.strictEqual(
    invalidAnalysis.howls[0]._listen1TrackGain,
    1,
    'missing or malformed analysis must safely preserve original gain'
  );
}

run()
  .then(() => console.log('Desktop cache player behavior tests passed.'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
