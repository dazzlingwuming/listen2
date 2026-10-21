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
      _playing: false,
      _position: 0,
      play() {
        this._playing = true;
      },
      playing() {
        return this._playing;
      },
      seek(position) {
        if (Number.isFinite(position)) this._position = position;
        return this._position;
      },
      pause() {
        this._playing = false;
      },
      stop() {
        this._playing = false;
        this._position = 0;
      },
      unload() {
        this._playing = false;
        this.unloaded = true;
      },
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
      unload() {
        howls.forEach((howl) => {
          howl._playing = false;
        });
      },
      volume(...args) {
        howlerVolumeCalls.push(args);
        return 1;
      },
    },
    MediaMetadata: function MediaMetadata() {},
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
  for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
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
          url: `listen2-cache://audio/${'a'.repeat(64)}`,
          contentSha256: 'f'.repeat(64),
          analyzerVersion: 'ebur128-v1',
          loudness: {
            status: 'ready',
            cacheKey: 'a'.repeat(64),
            contentSha256: 'f'.repeat(64),
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
          url: `listen2-cache://audio/${'b'.repeat(64)}`,
          contentSha256: 'f'.repeat(64),
          analyzerVersion: 'ebur128-v1',
          loudness: {
            status: 'ready',
            cacheKey: 'b'.repeat(64),
            contentSha256: 'f'.repeat(64),
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

  const entry = {
    cacheKey: 'c'.repeat(64),
    url: `listen2-cache://audio/${'c'.repeat(64)}`,
    contentSha256: 'd'.repeat(64),
    analyzerVersion: 'ebur128-v1',
    loudness: {
      status: 'ready',
      cacheKey: 'c'.repeat(64),
      contentSha256: 'd'.repeat(64),
      integratedLufs: -8,
      truePeakDbtp: -1,
      gainDb: -6,
      targetLufs: -14,
      analyzerVersion: 'ebur128-v1',
      analyzedAt: 1760000000000,
    },
  };
  let completed = false;
  let boundaryLookups = 0;
  const lifecycle = createPlayer({
    getAudioCacheLookup() {
      boundaryLookups += 1;
      return Promise.resolve(
        completed ? { ok: true, hit: true, entry } : { ok: true, hit: false }
      );
    },
    bootstrapTrack(_track, success) {
      success({ url: 'https://cdn.example/stream.m4s', platform: 'bilibili' });
    },
  });
  lifecycle.player.playlist = [{ id: 'bitrack_lifecycle', source: 'bilibili' }];
  lifecycle.player.index = 0;
  lifecycle.player.play();
  await flush();
  const originalHowl = lifecycle.howls[0];
  assert.strictEqual(originalHowl._listen1ComfortEnabled, true);
  assert.strictEqual(originalHowl._listen1Loudness, null);
  originalHowl.seek(41);
  completed = true;
  lifecycle.player.play();
  await flush();
  assert.strictEqual(
    boundaryLookups,
    1,
    'a redundant play while playing cannot hot swap'
  );
  assert.strictEqual(
    originalHowl._listen1TrackGain,
    1,
    'completion cannot retune an active stream'
  );
  originalHowl.pause();
  lifecycle.player.play();
  await flush();
  assert.strictEqual(
    boundaryLookups,
    2,
    'existing Howl must recheck cache at a new playback boundary'
  );
  assert.strictEqual(
    lifecycle.howls.length,
    2,
    'verified cache replaces the previous online quality'
  );
  assert.strictEqual(originalHowl.unloaded, true);
  assert.strictEqual(lifecycle.howls[1]._listen1TrackGain, 10 ** (-6 / 20));
  assert.strictEqual(
    lifecycle.howls[1]._listen1Loudness.contentSha256,
    'd'.repeat(64)
  );
  assert.strictEqual(
    lifecycle.player._media_resume_positions.bitrack_lifecycle,
    41,
    'cache switch preserves resume position'
  );
  lifecycle.howls[1].options.onplay();
  assert.strictEqual(
    lifecycle.howls[1].seek(),
    41,
    'new cache Howl restores the paused position on play'
  );
  assert.strictEqual(
    lifecycle.player._media_resume_positions.bitrack_lifecycle,
    undefined
  );
  lifecycle.howls[1].pause();
  lifecycle.player.play();
  await flush();
  assert.strictEqual(boundaryLookups, 3);
  assert.strictEqual(
    lifecycle.howls.length,
    2,
    'same validated cached bytes can reuse Howl'
  );
  lifecycle.player.setLoudnessNormalizationEnabled(false);
  assert.strictEqual(lifecycle.howls[1]._listen1ComfortEnabled, false);
  lifecycle.player.setLoudnessNormalizationEnabled(true);
  assert.strictEqual(lifecycle.howls[1]._listen1ComfortEnabled, true);

  const pending = [];
  const race = createPlayer({
    getAudioCacheLookup() {
      return new Promise((resolve) => pending.push(resolve));
    },
  });
  const oldHowl = {
    playing: () => false,
    seek: () => 22,
    stop() {},
    unload() {},
  };
  const newHowl = {
    playing: () => false,
    seek: () => 0,
    pause() {},
    stop() {},
    unload() {},
    play() {
      this.played = true;
    },
  };
  race.player.playlist = [
    { id: 'old', howl: oldHowl },
    { id: 'new', howl: newHowl },
  ];
  race.player._media_uri_list.old = 'https://cdn.example/old';
  race.player._media_uri_list.new = 'https://cdn.example/new';
  race.player.index = 0;
  race.player.play();
  await flush();
  race.player.play(1);
  await flush();
  pending[0]({ ok: true, hit: true, entry });
  await flush();
  assert.strictEqual(
    race.player._media_uri_list.old,
    'https://cdn.example/old',
    'stale prior-song result is ignored'
  );
  assert.strictEqual(
    race.howls.length,
    0,
    'stale prior-song result cannot create a new Howl'
  );
  pending[1]({ ok: true, hit: false });
  await flush();
  assert.strictEqual(newHowl.played, true);

  let resolveReentry;
  const reentry = createPlayer({
    getAudioCacheLookup() {
      return new Promise((resolve) => {
        resolveReentry = resolve;
      });
    },
  });
  reentry.player.playlist = [
    { id: 'same', howl: { ...newHowl, played: false } },
  ];
  reentry.player._media_uri_list.same = 'https://cdn.example/same';
  reentry.player.index = 0;
  reentry.player.play();
  await flush();
  reentry.player.pause();
  resolveReentry({ ok: true, hit: true, entry });
  await flush();
  assert.strictEqual(
    reentry.howls.length,
    0,
    'pause cancels a pending resume/cache switch'
  );
  assert.strictEqual(reentry.player.currentHowl.played, false);

  const mismatch = createPlayer({
    getAudioCacheLookup: () =>
      Promise.resolve({
        ok: true,
        hit: true,
        entry: { ...entry, contentSha256: 'e'.repeat(64) },
      }),
  });
  mismatch.player.playlist = [{ id: 'mismatch' }];
  mismatch.player.index = 0;
  mismatch.player.play();
  await flush();
  assert.strictEqual(
    mismatch.howls[0]._listen1Loudness,
    null,
    'a different byte hash cannot supply initial measurement'
  );
  assert.strictEqual(mismatch.howls[0]._listen1TrackGain, 1);

  let cachedAnalysisReady = false;
  const cached = createPlayer({
    getAudioCacheLookup: () =>
      Promise.resolve({
        ok: true,
        hit: true,
        entry: {
          ...entry,
          loudness: cachedAnalysisReady ? entry.loudness : null,
        },
      }),
  });
  cached.player.playlist = [{ id: 'cached' }];
  cached.player.index = 0;
  cached.player.play();
  await flush();
  cached.howls[0].seek(17);
  cachedAnalysisReady = true;
  cached.howls[0].pause();
  cached.player.play();
  await flush();
  assert.strictEqual(
    cached.howls.length,
    1,
    'later measurement of identical cache bytes reuses the existing Howl'
  );
  assert.strictEqual(cached.howls[0]._listen1TrackGain, 10 ** (-6 / 20));
  assert.strictEqual(
    cached.howls[0].seek(),
    17,
    'same-cache refresh never resets user progress'
  );
  cached.howls[0].options.onseek();
  assert.strictEqual(cached.howls[0]._listen1LoudnessResetToken, 1);

  const concurrentResolvers = [];
  const concurrent = createPlayer({
    getAudioCacheLookup: () =>
      new Promise((resolve) => concurrentResolvers.push(resolve)),
  });
  const resumedHowl = { ...newHowl, played: false };
  concurrent.player.playlist = [{ id: 'concurrent', howl: resumedHowl }];
  concurrent.player._media_uri_list.concurrent =
    'https://cdn.example/concurrent';
  concurrent.player.index = 0;
  concurrent.player.play();
  await flush();
  concurrent.player.play();
  await flush();
  concurrentResolvers[1]({ ok: true, hit: false });
  await flush();
  concurrentResolvers[0]({ ok: true, hit: true, entry });
  await flush();
  assert.strictEqual(
    concurrent.howls.length,
    0,
    'older same-song lookup cannot replace the latest resumed Howl'
  );
  assert.strictEqual(resumedHowl.played, true);
  assert.strictEqual(
    concurrent.player._media_uri_list.concurrent,
    'https://cdn.example/concurrent'
  );

  const versionMismatch = createPlayer({
    getAudioCacheLookup: () =>
      Promise.resolve({
        ok: true,
        hit: true,
        entry: { ...entry, analyzerVersion: 'next-version' },
      }),
  });
  versionMismatch.player.playlist = [{ id: 'version' }];
  versionMismatch.player.index = 0;
  versionMismatch.player.play();
  await flush();
  assert.strictEqual(
    versionMismatch.howls[0]._listen1Loudness,
    null,
    'analysis version must match the cache response'
  );
  assert.strictEqual(versionMismatch.howls[0]._listen1TrackGain, 1);

  const invalidUnity = createPlayer({
    getAudioCacheLookup: () =>
      Promise.resolve({
        ok: true,
        hit: true,
        entry: {
          ...entry,
          loudness: {
            ...entry.loudness,
            integratedLufs: -14,
            gainDb: 0,
            analyzedAt: 0,
          },
        },
      }),
  });
  invalidUnity.player.playlist = [{ id: 'invalid-unity' }];
  invalidUnity.player.index = 0;
  invalidUnity.player.play();
  await flush();
  assert.strictEqual(
    invalidUnity.howls[0]._listen1Loudness,
    null,
    'unity gain cannot bypass measurement validation'
  );

  let replacementEntry = entry;
  const replacement = createPlayer({
    getAudioCacheLookup: () =>
      Promise.resolve({
        ok: true,
        hit: true,
        entry: replacementEntry,
      }),
  });
  replacement.player.playlist = [{ id: 'replacement' }];
  replacement.player.index = 0;
  replacement.player.play();
  await flush();
  replacement.howls[0].seek(33);
  replacement.howls[0].pause();
  replacementEntry = {
    ...entry,
    contentSha256: 'e'.repeat(64),
    loudness: {
      ...entry.loudness,
      contentSha256: 'e'.repeat(64),
    },
  };
  replacement.player.play();
  await flush();
  assert.strictEqual(
    replacement.howls.length,
    2,
    'same cache URL with different bytes must rebuild the Howl'
  );
  assert.strictEqual(replacement.howls[0].unloaded, true);
  assert.strictEqual(
    replacement.howls[1]._listen1CacheContentSha256,
    'e'.repeat(64)
  );
  assert.strictEqual(
    replacement.howls[1]._listen1Loudness.contentSha256,
    'e'.repeat(64)
  );
  assert.strictEqual(
    replacement.player._media_resume_positions.replacement,
    33
  );
}

run()
  .then(() => console.log('Desktop cache player behavior tests passed.'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
