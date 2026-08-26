/* eslint-env node */
/* eslint-disable class-methods-use-this, max-classes-per-file, no-console, no-underscore-dangle */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createPlayer(mediaService) {
  const filename = path.join(__dirname, '..', 'js', 'player_thread.js');
  const source = fs.readFileSync(filename, 'utf8');
  const howls = [];
  const messages = [];
  function MockHowl(options) {
    const howl = {
      options,
      unloaded: false,
      unload() {
        this.unloaded = true;
      },
      playing() {
        return false;
      },
      play() {
        return 1;
      },
      stop() {},
    };
    howls.push(howl);
    return howl;
  }
  const context = {
    clearInterval() {},
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
    navigator: {},
    playerSendMessage(mode, message) {
      messages.push({ mode, message });
    },
    setInterval() {
      return 1;
    },
    window: {},
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename });
  return {
    player: context.window.threadPlayer,
    howls,
    messages,
  };
}

function createBilibiliProvider(
  manifestCalls,
  manifestResponse,
  axiosImpl = {}
) {
  const filename = path.join(__dirname, '..', 'js', 'provider', 'bilibili.js');
  const source = fs.readFileSync(filename, 'utf8');
  const storage = new Map();
  const context = {
    MediaService: {
      getBilibiliMediaManifest(options) {
        manifestCalls.push(options);
        return Promise.resolve(
          manifestResponse || {
            ok: true,
            manifest: {
              duration: 217,
              audioVariants: [
                {
                  url: 'https://primary.example/audio.m4s',
                  backupUrls: [
                    'https://backup-one.example/audio.m4s',
                    'https://backup-two.example/audio.m4s',
                  ],
                  specialType: 'normal',
                  mimeType: 'audio/mp4',
                  codecs: 'mp4a.40.2',
                },
              ],
            },
          }
        );
      },
    },
    axios: axiosImpl,
    console,
    DOMParser: class {
      parseFromString(value) {
        return { body: { textContent: value } };
      }
    },
    getParameterByName() {
      return '';
    },
    isElectron() {
      return true;
    },
    kuwo: {},
    localStorage: {
      getItem(key) {
        return storage.has(key) ? storage.get(key) : null;
      },
      setItem(key, value) {
        storage.set(key, value);
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(
    `${source}\nthis.BilibiliProviderForTest = bilibili;`,
    context,
    { filename }
  );
  return context.BilibiliProviderForTest;
}

function createMediaServiceHarness() {
  const filename = path.join(__dirname, '..', 'js', 'loweb.js');
  const source = fs.readFileSync(filename, 'utf8');
  let bootstrapArgs = null;
  const bilibiliProvider = {
    bootstrap_track(...args) {
      bootstrapArgs = args;
      args[1]({
        url: 'https://primary.example/audio.m4s',
        platform: 'bilibili',
      });
    },
  };
  const emptyProvider = {};
  const context = {
    LRUCache: class {},
    bilibili: bilibiliProvider,
    kugou: emptyProvider,
    kuwo: emptyProvider,
    localmusic: emptyProvider,
    migu: emptyProvider,
    myplaylist: emptyProvider,
    netease: emptyProvider,
    qq: emptyProvider,
    setPrototypeOfLocalStorage() {},
    taihe: emptyProvider,
    xiami: emptyProvider,
  };
  vm.createContext(context);
  vm.runInContext(
    `${source}\nthis.MediaServiceForTest = MediaService;`,
    context,
    {
      filename,
    }
  );
  return {
    mediaService: context.MediaServiceForTest,
    getBootstrapArgs() {
      return bootstrapArgs;
    },
  };
}

async function run() {
  {
    const requests = [];
    const provider = createBilibiliProvider([], undefined, {
      get(url) {
        requests.push(url);
        const bvid = new URL(url).searchParams.get('bvid');
        return Promise.resolve({
          data: {
            data: {
              bvid,
              duration: bvid === 'BV_FIRST' ? 228 : 196,
              pages: [
                {
                  cid: bvid === 'BV_FIRST' ? 101 : 202,
                  duration: bvid === 'BV_FIRST' ? 228 : 196,
                },
              ],
            },
          },
        });
      },
    });
    const tracks = [
      { id: 'bitrack_v_BV_FIRST-101', source: 'bilibili' },
      { id: 'bitrack_v_BV_SECOND-202', source: 'bilibili', duration: 0 },
      { id: 'bitrack_legacy', source: 'bilibili' },
    ];
    const hydrated = await provider.hydrate_track_durations(tracks);
    assert.strictEqual(hydrated, tracks);
    assert.deepStrictEqual(
      tracks.map((track) => track.duration || 0),
      [228, 196, 0]
    );
    assert.strictEqual(requests.length, 2);
  }

  {
    const manifestCalls = [];
    const provider = createBilibiliProvider(manifestCalls);
    const result = await new Promise((resolve, reject) => {
      provider.bootstrap_track(
        { id: 'bitrack_v_BV1ipCgB8Enx-34002175114' },
        resolve,
        () => reject(new Error('Bilibili bootstrap unexpectedly failed')),
        { forceRefresh: true }
      );
    });

    assert.deepStrictEqual(JSON.parse(JSON.stringify(manifestCalls)), [
      {
        bvid: 'BV1ipCgB8Enx',
        cid: 34002175114,
        forceRefresh: true,
      },
    ]);
    assert.deepStrictEqual(Array.from(result.urlCandidates), [
      'https://primary.example/audio.m4s',
      'https://backup-one.example/audio.m4s',
      'https://backup-two.example/audio.m4s',
    ]);
    assert.strictEqual(result.duration, 217);
  }

  {
    const provider = createBilibiliProvider([], {
      ok: false,
      stage: 'manifest',
      kind: 'timeout',
      status: 'request-timeout',
      httpStatus: 0,
      bilibiliCode: 0,
      retryable: true,
      message: 'This must not be forwarded.',
    });
    const failure = await new Promise((resolve, reject) => {
      provider.bootstrap_track(
        { id: 'bitrack_v_BV1ipCgB8Enx-34002175114' },
        () => reject(new Error('Bilibili bootstrap unexpectedly succeeded')),
        resolve
      );
    });
    assert.deepStrictEqual(JSON.parse(JSON.stringify(failure)), {
      stage: 'manifest',
      kind: 'timeout',
      status: 'request-timeout',
      httpStatus: 0,
      bilibiliCode: 0,
      retryable: true,
      message: 'The Bilibili request timed out.',
    });
  }

  {
    const provider = createBilibiliProvider([]);
    const conflicts = [
      {
        error: { httpStatus: 404, kind: 'network', retryable: true },
        kind: 'not-found',
      },
      {
        error: { bilibiliCode: -404, kind: 'network', retryable: true },
        kind: 'not-found',
      },
      {
        error: { bilibiliCode: -101, kind: 'network', retryable: true },
        kind: 'auth-required',
      },
    ];
    conflicts.forEach(({ error, kind }) => {
      const failure = provider.create_media_failure(error);
      assert.strictEqual(failure.kind, kind);
      assert.strictEqual(failure.retryable, false);
    });
  }

  {
    const provider = createBilibiliProvider([], undefined, {
      get() {
        return Promise.reject(
          Object.assign(new Error('simulated network reset'), {
            code: 'ECONNRESET',
          })
        );
      },
    });
    let failure;
    await provider.bootstrap_track(
      { id: 'bitrack_123' },
      () => {
        throw new Error('Bilibili legacy bootstrap unexpectedly succeeded');
      },
      (error) => {
        failure = error;
      }
    );
    assert.deepStrictEqual(JSON.parse(JSON.stringify(failure)), {
      stage: 'legacy-manifest',
      kind: 'network',
      status: 'econnreset',
      httpStatus: 0,
      bilibiliCode: 0,
      retryable: true,
      message: 'The network request to Bilibili failed.',
    });
  }

  {
    const provider = createBilibiliProvider([], undefined, {
      get() {
        return Promise.resolve({ data: { code: -404 } });
      },
    });
    let failure;
    await provider.bootstrap_track(
      { id: 'bitrack_123' },
      () => {
        throw new Error('Bilibili legacy bootstrap unexpectedly succeeded');
      },
      (error) => {
        failure = error;
      }
    );
    assert.deepStrictEqual(JSON.parse(JSON.stringify(failure)), {
      stage: 'legacy-manifest',
      kind: 'not-found',
      status: 'bilibili-api-error',
      httpStatus: 0,
      bilibiliCode: -404,
      retryable: false,
      message: 'This Bilibili resource is no longer available.',
    });
  }

  {
    const provider = createBilibiliProvider([], undefined, {
      get() {
        return Promise.resolve({ data: { code: 0, data: { cdns: [] } } });
      },
    });
    let failure;
    await provider.bootstrap_track(
      { id: 'bitrack_123' },
      () => {
        throw new Error('Bilibili legacy bootstrap unexpectedly succeeded');
      },
      (error) => {
        failure = error;
      }
    );
    assert.strictEqual(failure.kind, 'no-audio-stream');
    assert.strictEqual(failure.retryable, false);
  }

  {
    const provider = createBilibiliProvider([], {
      ok: false,
      stage: 'manifest',
      kind: 'not-found',
      status: 'bilibili-api-error',
      httpStatus: 404,
      bilibiliCode: -404,
      retryable: false,
    });
    const failure = await new Promise((resolve, reject) => {
      provider.bootstrap_track(
        { id: 'bitrack_v_BV1ipCgB8Enx-34002175114' },
        () => reject(new Error('Bilibili bootstrap unexpectedly succeeded')),
        resolve
      );
    });
    assert.deepStrictEqual(JSON.parse(JSON.stringify(failure)), {
      stage: 'manifest',
      kind: 'not-found',
      status: 'bilibili-api-error',
      httpStatus: 404,
      bilibiliCode: -404,
      retryable: false,
      message: 'This Bilibili resource is no longer available.',
    });
  }

  {
    const harness = createMediaServiceHarness();
    harness.mediaService.bootstrapTrack(
      {
        id: 'bitrack_v_BV1ipCgB8Enx-34002175114',
        source: 'bilibili',
      },
      () => {},
      () => {},
      { forceRefresh: true }
    );
    assert.strictEqual(harness.getBootstrapArgs().length, 4);
    assert.deepStrictEqual(
      JSON.parse(JSON.stringify(harness.getBootstrapArgs()[3])),
      { forceRefresh: true }
    );
  }

  {
    const bootstrapCalls = [];
    const mediaService = {
      bootstrapTrack(track, success, _failure, options) {
        bootstrapCalls.push({ track, options });
        if (options.forceRefresh) {
          success({
            url: 'https://fresh-primary.example/audio.m4s',
            urlCandidates: [
              'https://fresh-primary.example/audio.m4s',
              'https://fresh-backup.example/audio.m4s',
            ],
            bitrate: '128kbps',
            platform: 'bilibili',
          });
          return;
        }
        success({
          url: 'https://primary.example/audio.m4s',
          urlCandidates: [
            'https://primary.example/audio.m4s',
            'https://backup-one.example/audio.m4s',
            'https://backup-two.example/audio.m4s',
          ],
          bitrate: '192kbps',
          duration: 217,
          platform: 'bilibili',
        });
      },
    };
    const { player, howls, messages } = createPlayer(mediaService);
    const track = {
      id: 'bitrack_v_BV1ipCgB8Enx-34002175114',
      source: 'bilibili',
      title: 'Test track',
      artist: 'Test artist',
      howl: null,
      disabled: false,
    };
    player.playlist = [track];
    player.index = 0;

    player.retrieveMediaUrl(0, true);
    assert.strictEqual(bootstrapCalls.length, 1);
    assert.deepStrictEqual(
      JSON.parse(JSON.stringify(bootstrapCalls[0].options)),
      { forceRefresh: false }
    );
    assert.strictEqual(
      player._media_uri_list[track.id],
      'https://primary.example/audio.m4s'
    );
    assert.strictEqual(track.duration, 217);
    howls[0].duration = () => 219;
    howls[0].options.onload();
    assert.strictEqual(
      track.duration,
      219,
      'the decoded media duration should correct provider metadata'
    );

    howls[0].options.onloaderror(1, 'primary-failed');
    assert.strictEqual(
      player._media_uri_list[track.id],
      'https://backup-one.example/audio.m4s'
    );
    assert.strictEqual(track.disabled, false);

    howls[1].options.onloaderror(1, 'backup-one-failed');
    assert.strictEqual(
      player._media_uri_list[track.id],
      'https://backup-two.example/audio.m4s'
    );
    assert.strictEqual(track.disabled, false);

    howls[2].options.onloaderror(1, 'backup-two-failed');
    assert.strictEqual(
      bootstrapCalls.length,
      2,
      'all original Bilibili CDN candidates should trigger one refresh'
    );
    assert.deepStrictEqual(
      JSON.parse(JSON.stringify(bootstrapCalls[1].options)),
      { forceRefresh: true }
    );
    assert.strictEqual(
      player._media_uri_list[track.id],
      'https://fresh-primary.example/audio.m4s'
    );
    assert.strictEqual(track.disabled, false);

    howls[3].options.onloaderror(1, 'fresh-primary-failed');
    assert.strictEqual(
      player._media_uri_list[track.id],
      'https://fresh-backup.example/audio.m4s'
    );
    howls[4].options.onloaderror(1, 'fresh-backup-failed');
    assert.strictEqual(track.disabled, true);
    assert.strictEqual(
      bootstrapCalls.length,
      2,
      'the refresh loop must be bounded to one forced refresh'
    );
    assert.strictEqual(
      messages.filter(({ message }) => message.type === 'BG_PLAYER:PLAY_FAILED')
        .length,
      1,
      'intermediate CDN errors should stay silent while a retry remains'
    );
  }

  console.log('bilibili CDN fallback tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
