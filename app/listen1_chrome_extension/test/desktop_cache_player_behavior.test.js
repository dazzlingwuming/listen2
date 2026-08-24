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
      volume() {
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
  return { player: context.window.threadPlayer, howls };
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
  const { player, howls } = createPlayer({
    getAudioCacheLookup() {
      lookups += 1;
      return Promise.resolve({
        ok: true,
        hit: true,
        entry: {
          cacheKey: 'a'.repeat(64),
          url: 'listen2-cache://audio/cache-hit',
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
}

run()
  .then(() => console.log('Desktop cache player behavior tests passed.'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
