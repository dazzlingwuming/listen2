/* eslint-env node */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(
  path.resolve(__dirname, '../js/controller/navigation.js'),
  'utf8'
);
const calls = { commands: [], queries: [] };
const playbackCalls = [];
let controller;

const adapter = {
  isAvailable: () => true,
  localData: {
    query(action, payload) {
      calls.queries.push({ action, payload });
      const replies = {
        capabilities: {
          cache: true,
          favorites: true,
          historyAnnual: true,
          playlists: true,
          saf: true,
          settings: true,
          backupExport: true,
        },
        playlists: {
          items: [
            {
              playlistId: 'mobile.alpha',
              name: 'Alpha',
              ordinal: 0,
              revision: 2,
              tracks: [
                {
                  source: 'bilibili',
                  providerTrackId: 'BV1abc',
                  title: 'One',
                  artist: 'Artist',
                  durationMs: 120000,
                },
              ],
            },
            {
              playlistId: 'mobile.beta',
              name: 'Beta',
              ordinal: 1,
              revision: 4,
              tracks: [],
            },
          ],
        },
        favorites: {
          items: [
            {
              source: 'bilibili',
              providerTrackId: 'BV1abc',
              title: 'One',
              artist: 'Artist',
              addedAtMs: 1,
            },
          ],
        },
        saf: {
          items: [
            { referenceId: 'tree.1', displayName: 'Music', state: 'ready' },
          ],
        },
        localTracks: {
          items: [
            {
              localTrackId:
                'local.track.0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
              source: 'local',
              title: 'Local song',
              artist: 'Local artist',
              durationMs: 180000,
              displayName: 'local-song.mp3',
              mime: 'audio/mpeg',
              cover: false,
              lrc: false,
              availability: 'available',
              grantReferenceId: 'saf.tree.1',
            },
            {
              localTrackId:
                'local.track.abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
              source: 'local',
              title: 'Revoked song',
              artist: 'Local artist',
              durationMs: 90000,
              displayName: 'revoked.mp3',
              mime: 'audio/mpeg',
              cover: false,
              lrc: false,
              availability: 'revoked',
              grantReferenceId: 'saf.tree.1',
            },
          ],
        },
      };
      return {
        promise: Promise.resolve({ ok: true, data: replies[action] || {} }),
      };
    },
    command(action, payload) {
      calls.commands.push({ action, payload });
      const data =
        action.indexOf('saf.') === 0
          ? { accepted: true, status: 'pending' }
          : {};
      return { promise: Promise.resolve({ ok: true, data }) };
    },
  },
};

const context = {
  angular: {
    module: () => ({
      controller: (name, dependencies) => {
        controller = dependencies[dependencies.length - 1];
      },
    }),
  },
  window: { Listen2AndroidHttpAdapter: adapter },
  document: {
    getElementsByClassName: () => [{ scrollTop: 0 }],
    getElementById: () => ({ focus: () => {} }),
  },
  isElectron: () => false,
  MediaService: {
    getAndroidProviderCapabilities: () => ({ bilibili: { media: false } }),
    startAndroidProviderCapabilities: () => Promise.resolve(),
    onAndroidProviderCapabilities: () => () => {},
  },
  l1Player: {
    addTrack(track) {
      playbackCalls.push({ type: 'addTrack', track });
    },
    playById(id) {
      playbackCalls.push({ type: 'playById', id });
      return Promise.resolve(null);
    },
  },
  hotkeys: () => {},
  lastfm: {},
  GithubClient: { gist: {} },
  playlistBackup: {},
  i18next: { t: (value) => value },
  notyf: {
    success: () => {},
    warning: () => {},
    info: () => {},
    dismissAll: () => {},
  },
  localStorage: { getObject: () => null, setObject: () => {} },
  require: () => ({}),
  console,
};
vm.runInNewContext(source, context, { filename: 'navigation.js' });

const scope = {
  $evalAsync: (callback) => callback(),
  $on: () => {},
  $broadcast: () => {},
  $emit: () => {},
  currentPlaying: {
    id: 'current-1',
    source: 'bilibili',
    providerTrackId: 'BV9current',
    title: 'Current',
    artist: 'Now',
    durationMs: 200000,
  },
};
const timeout = (callback) => callback();
controller(scope, timeout, {});

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};
const plain = (value) => JSON.parse(JSON.stringify(value));

(async () => {
  await settle();
  assert.ok(calls.queries.some((call) => call.action === 'capabilities'));
  assert.ok(calls.queries.some((call) => call.action === 'playlists'));

  scope.loadMobileLocalPage('library');
  await settle();
  assert.deepStrictEqual(
    plain(scope.mobileLocalData.playlists.map((item) => item.playlistId)),
    ['mobile.alpha', 'mobile.beta']
  );
  assert.strictEqual(scope.mobileLocalData.localTracks.length, 2);
  await scope.playMobileLocalTrack(scope.mobileLocalData.localTracks[0]);
  assert.strictEqual(playbackCalls[0].type, 'addTrack');
  assert.strictEqual(
    playbackCalls[0].track.id,
    'local.track.0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
  );
  assert.strictEqual(playbackCalls[1].type, 'playById');
  assert.strictEqual(
    playbackCalls[1].id,
    'local.track.0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
  );
  await scope.repairMobileLocalGrant(scope.mobileLocalData.localTracks[1]);
  await settle();
  const repair = calls.commands.find(
    (call) => call.action === 'localTracks.repair'
  );
  assert.deepStrictEqual(plain(repair.payload), {
    grantReferenceId: 'saf.tree.1',
  });

  scope.beginMobilePlaylistCreate();
  scope.mobileLocalData.playlistDraft.name = 'New list';
  scope.addCurrentTrackToMobilePlaylistDraft();
  scope.saveMobilePlaylistDraft();
  await settle();
  const create = calls.commands.find(
    (call) => call.action === 'playlist.create'
  );
  assert.ok(create, 'create must call typed local-data command');
  assert.strictEqual(create.payload.name, 'New list');
  assert.deepStrictEqual(plain(create.payload.tracks), [
    {
      source: 'bilibili',
      providerTrackId: 'BV9current',
      title: 'Current',
      artist: 'Now',
      durationMs: 200000,
    },
  ]);

  scope.beginMobilePlaylistEdit(scope.mobileLocalData.playlists[0]);
  scope.removeMobilePlaylistDraftTrack(0);
  scope.saveMobilePlaylistDraft();
  await settle();
  const replace = calls.commands.find(
    (call) => call.action === 'playlist.replace'
  );
  assert.deepStrictEqual(plain(replace.payload), {
    playlistId: 'mobile.alpha',
    expectedRevision: 2,
    name: 'Alpha',
    tracks: [],
  });

  scope.moveMobilePlaylist(0, 1);
  await settle();
  scope.toggleMobileFavorite(scope.mobileLocalData.favorites[0], false);
  await settle();
  scope.requestMobilePlaylistDelete(scope.mobileLocalData.playlists[0]);
  scope.confirmMobilePlaylistDelete();
  await settle();
  scope.startMobileSafPicker('saf.pickAudio');
  await settle();
  assert.deepStrictEqual(
    plain(
      calls.commands.find((call) => call.action === 'playlist.reorder').payload
    ),
    { playlistIds: ['mobile.beta', 'mobile.alpha'] }
  );
  assert.deepStrictEqual(
    plain(
      calls.commands.find((call) => call.action === 'favorite.set').payload
    ),
    {
      track: {
        source: 'bilibili',
        providerTrackId: 'BV1abc',
        title: 'One',
        artist: 'Artist',
        durationMs: 0,
      },
      wanted: false,
    }
  );
  assert.strictEqual(
    calls.commands.find((call) => call.action === 'playlist.delete').payload
      .playlistId,
    'mobile.alpha'
  );
  assert.deepStrictEqual(
    plain(
      calls.commands.find((call) => call.action === 'saf.pickAudio').payload
    ),
    {}
  );
  assert.strictEqual(
    scope.mobileLocalData.safPickerStatus.indexOf('系统文件选择器') >= 0,
    true
  );
  process.stdout.write('android whole product local-data UI tests passed\n');
})().catch((error) => {
  process.stderr.write(`${error.stack}\n`);
  process.exitCode = 1;
});
