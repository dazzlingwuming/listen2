/* eslint-env node */
/* eslint-disable no-console */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createMediaService({ autoChooseSource }) {
  const filename = path.join(__dirname, '..', 'js', 'loweb.js');
  const source = fs.readFileSync(filename, 'utf8');
  const providerFailure = {
    stage: 'manifest',
    kind: 'network',
    status: 'request-failed',
    retryable: true,
  };
  const bilibiliProvider = {
    bootstrap_track(_track, _success, failure) {
      failure(providerFailure);
    },
  };
  const emptyProvider = {};
  const context = {
    LRUCache: class {},
    bilibili: bilibiliProvider,
    getLocalStorageValue() {
      return [];
    },
    kugou: emptyProvider,
    kuwo: emptyProvider,
    localmusic: emptyProvider,
    localStorage: {
      getObject(key) {
        if (key === 'enable_auto_choose_source') {
          return autoChooseSource;
        }
        return null;
      },
    },
    migu: emptyProvider,
    myplaylist: emptyProvider,
    netease: emptyProvider,
    qq: emptyProvider,
    setPrototypeOfLocalStorage() {},
    taihe: emptyProvider,
    URLSearchParams,
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
    providerFailure,
  };
}

async function bootstrapFailure(autoChooseSource) {
  const { mediaService, providerFailure } = createMediaService({
    autoChooseSource,
  });
  const received = await new Promise((resolve, reject) => {
    mediaService.bootstrapTrack(
      {
        id: 'bitrack_v_BV1ipCgB8Enx-34002175114',
        source: 'bilibili',
        title: 'Test track',
        artist: 'Test artist',
      },
      () => reject(new Error('bootstrap unexpectedly succeeded')),
      resolve
    );
  });
  assert.strictEqual(received, providerFailure);
}

async function run() {
  await bootstrapFailure(false);
  await bootstrapFailure(true);
  console.log('media bootstrap error propagation tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
