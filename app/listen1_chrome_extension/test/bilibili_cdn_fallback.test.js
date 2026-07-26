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

function createBilibiliProvider(manifestCalls) {
  const filename = path.join(
    __dirname,
    '..',
    'js',
    'provider',
    'bilibili.js'
  );
  const source = fs.readFileSync(filename, 'utf8');
  const storage = new Map();
  const context = {
    MediaService: {
      getBilibiliMediaManifest(options) {
        manifestCalls.push(options);
        return Promise.resolve({
          ok: true,
          manifest: {
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
        });
      },
    },
    axios: {},
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
    LRUCache: class {
      constructor() {}
    },
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
  vm.runInContext(`${source}\nthis.MediaServiceForTest = MediaService;`, context, {
    filename,
  });
  return {
    mediaService: context.MediaServiceForTest,
    getBootstrapArgs() {
      return bootstrapArgs;
    },
  };
}

async function run() {
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
      messages.filter(
        ({ message }) => message.type === 'BG_PLAYER:PLAY_FAILED'
      ).length,
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
