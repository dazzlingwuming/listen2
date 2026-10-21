/**
 * Pure synthetic Electron loudness diagnosis: no network, audio files, userData,
 * real Electron runtime, application settings, or system volume are accessed.
 * Only committed repository JavaScript is read; playback/cache inputs are fabricated.
 *
 * Run from any directory:
 *   node doc/2026-10-21/loudness-diagnosis-reproduce.cjs
 *
 * This historical reproducer reads the exact v2.35.5 diagnosis baseline from
 * local Git objects, so fixing the live source does not rewrite the evidence.
 * It requires that baseline commit to exist locally. Current behavior is tested
 * separately by npm run test:comfort-loudness; these are not desired assertions.
 */
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const Module = require("node:module");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "../..");
const BASELINE = "5b5f90d891824cc5e339df78f3d546cb9f5d5b3e";
function baselineSource(relativePath) {
  return execFileSync("git", ["show", `${BASELINE}:${relativePath}`], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
}
function baselineRequire(relativePath) {
  const filename = path.join(root, relativePath);
  const snapshot = new Module(filename, module);
  snapshot.filename = filename;
  snapshot.paths = Module._nodeModulePaths(path.dirname(filename));
  snapshot._compile(baselineSource(relativePath), filename);
  return snapshot.exports;
}
console.log("HISTORICAL_BASELINE", BASELINE);
const core = baselineRequire("app/loudnessAnalyzerRenderer.js");
const { AudioCache } = baselineRequire("app/audioCache.js");
const { BilibiliService } = baselineRequire("app/bilibiliService.js");

function verifyGainExamples() {
  const examples = [
    [-8, -1, -6],
    [-24, -1, 0],
    [-20, -0.2, -0.8],
    [-40, -30, 12],
    [-20, -10, 6],
  ];
  const results = examples.map(([inputLufs, inputPeak, expectedGain]) => {
    const gainDb = core.calculateGainDb(inputLufs, inputPeak);
    assert.equal(gainDb, expectedGain);
    return { inputLufs, inputPeak, gainDb, outputLufs: inputLufs + gainDb };
  });
  console.log("GAIN", JSON.stringify(results));
}

function createPlayerHarness() {
  let ready = false;
  let lookups = 0;
  const howls = [];

  function MockHowl(options) {
    const howl = {
      options,
      _sounds: [],
      duration: () => 180,
      play() {},
      playing: () => false,
      seek: () => 0,
      stop() {},
      unload() {},
    };
    howls.push(howl);
    return howl;
  }

  const context = {
    Date,
    URL,
    console,
    clearInterval() {},
    clearTimeout() {},
    setInterval: () => 1,
    setTimeout: () => 1,
    Howl: MockHowl,
    Howler: { _muted: false, unload() {}, volume: () => 1 },
    MediaMetadata() {},
    navigator: { mediaSession: { setActionHandler() {} } },
    playerSendMessage() {},
    window: {},
    MediaService: {
      getAudioCacheLookup() {
        lookups += 1;
        return Promise.resolve(
          ready
            ? {
                ok: true,
                hit: true,
                entry: {
                  url: "listen2-cache://audio/example",
                  loudness: {
                    integratedLufs: -8,
                    truePeakDbtp: -1,
                    gainDb: -6,
                    targetLufs: -14,
                    analyzerVersion: core.ANALYZER_VERSION,
                    analyzedAt: 1,
                  },
                },
              }
            : { ok: true, hit: false }
        );
      },
      bootstrapTrack(_track, success) {
        success({
          url: "https://example.test/media.m4s",
          platform: "bilibili",
        });
      },
    },
  };
  vm.createContext(context);
  const filename = path.join(
    root,
    "app/listen1_chrome_extension/js/player_thread.js"
  );
  vm.runInContext(
    baselineSource("app/listen1_chrome_extension/js/player_thread.js"),
    context,
    { filename }
  );

  return {
    player: context.window.threadPlayer,
    howls,
    getLookups: () => lookups,
    markAnalysisReady() {
      ready = true;
    },
  };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function verifyStalePlayerGain() {
  const harness = createPlayerHarness();
  const { player, howls } = harness;
  player.playlist = [{ id: "bitrack_v_BV1ab411c7mD-1", source: "bilibili" }];
  player.index = 0;
  player.play();
  await flushPromises();
  assert.equal(harness.getLookups(), 1);
  assert.equal(howls[0]._listen1TrackGain, 1);

  // A complete cache and its background analysis become available later.
  harness.markAnalysisReady();
  player.setLoudnessNormalizationEnabled(true);
  player.play();
  await flushPromises();
  assert.equal(harness.getLookups(), 1);
  assert.equal(player.currentHowl._listen1TrackGain, 1);
  console.log(
    "STALE_AFTER_ANALYSIS",
    JSON.stringify({
      lookups: harness.getLookups(),
      gain: player.currentHowl._listen1TrackGain,
      expectedIfReloaded: 10 ** (-6 / 20),
    })
  );

  player.unloadTrackHowl(player.currentAudio);
  player.play();
  await flushPromises();
  assert.equal(harness.getLookups(), 2);
  assert.equal(player.currentHowl._listen1TrackGain, 10 ** (-6 / 20));
  console.log(
    "AFTER_EXPLICIT_REBUILD",
    JSON.stringify({
      lookups: harness.getLookups(),
      gain: player.currentHowl._listen1TrackGain,
    })
  );
}

function verifyFailedAnalysisRetry() {
  const key = createHash("sha256").update("test-stable-key").digest("hex");
  let analyzerCalls = 0;
  // Use only prototype methods: never construct or initialize an on-disk cache.
  const cache = Object.create(AudioCache.prototype);
  cache.loudnessAnalyzer = {
    version: core.ANALYZER_VERSION,
    analyze() {
      analyzerCalls += 1;
      throw new Error("The baseline must not retry this failed analysis.");
    },
  };
  cache.index = {
    settings: { loudnessNormalizationEnabled: true },
    entries: {
      [key]: {
        stableKey: "test-stable-key",
        sha256: "a".repeat(64),
        loudness: {
          status: "failed",
          cacheKey: key,
          contentSha256: "a".repeat(64),
          analyzerVersion: core.ANALYZER_VERSION,
        },
      },
    },
  };
  cache.loudnessJobs = new Map();
  assert.equal(cache.loudnessIsCurrent(cache.index.entries[key]), true);
  cache.queueLoudnessAnalysis(key);
  assert.equal(analyzerCalls, 0);
  assert.equal(cache.loudnessJobs.size, 0);
  console.log(
    "FAILED_SAME_VERSION_RETRY",
    JSON.stringify({ isCurrent: true, analyzerCalls })
  );
}

function verifyUpstreamFieldFiltering() {
  const manifest = BilibiliService.prototype.normalizeManifest.call(
    { now: () => 1 },
    { bvid: "BV1ab411c7mD", cid: 1, duration: 180 },
    {
      volume: { measured_i: -20, measured_tp: -1, target_i: -14 },
      dash: {
        audio: [
          {
            id: 30280,
            baseUrl: "https://example.test/media.m4s",
            codecs: "mp4a.40.2",
            volume: { measured_i: -20, measured_tp: -1 },
            measured_i: -20,
            measured_tp: -1,
          },
        ],
      },
    }
  );
  assert.equal("volume" in manifest, false);
  assert.equal("volume" in manifest.audioVariants[0], false);
  assert.equal("measured_i" in manifest.audioVariants[0], false);
  assert.equal("measured_tp" in manifest.audioVariants[0], false);
  console.log(
    "UPSTREAM_FIELDS",
    JSON.stringify({
      manifestKeys: Object.keys(manifest),
      audioKeys: Object.keys(manifest.audioVariants[0]),
    })
  );
}

async function main() {
  verifyGainExamples();
  await verifyStalePlayerGain();
  verifyFailedAnalysisRetry();
  verifyUpstreamFieldFiltering();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
