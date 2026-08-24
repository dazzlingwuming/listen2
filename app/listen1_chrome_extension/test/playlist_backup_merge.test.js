/* eslint-env node */
/* eslint-disable no-underscore-dangle */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const extensionRoot = path.resolve(__dirname, '..');
const playlistBackup = require('../js/playlist_backup');

class MemoryStorage {
  constructor(values = {}, failingKey = null, failureCount = 1) {
    this.values = new Map(
      Object.entries(values).map(([key, value]) => [key, JSON.stringify(value)])
    );
    this.getCalls = [];
    this.setCalls = [];
    this.failingKey = failingKey;
    this.failureCount = failureCount;
  }

  getItem(key) {
    this.getCalls.push(key);
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    if (key === this.failingKey && this.failureCount > 0) {
      this.failureCount -= 1;
      throw new Error('simulated storage write failure');
    }
    this.setCalls.push(key);
    this.values.set(key, value);
  }

  removeItem(key) {
    this.values.delete(key);
  }

  getObject(key) {
    const value = this.getItem(key);
    return value === null ? null : JSON.parse(value);
  }

  setObject(key, value) {
    this.setItem(key, JSON.stringify(value));
  }
}

function playlist(id, title, trackIds = []) {
  return {
    is_mine: 1,
    info: {
      id,
      title,
      cover_img_url: 'cover.jpg',
    },
    tracks: trackIds.map((trackId) => ({
      id: trackId,
      title: `song ${trackId}`,
      artist: 'artist',
      album: 'album',
    })),
  };
}

function favorite(id, title) {
  return {
    is_fav: 1,
    info: { id, title, cover_img_url: 'cover.jpg' },
  };
}

function v2Backup(playlists, favoritePlaylists = []) {
  return {
    format: 'listen2-playlist-backup',
    version: 2,
    exportedAt: '2026-08-23T00:00:00.000Z',
    playlists: playlists.map((item) => ({ id: item.info.id, playlist: item })),
    favoritePlaylists: favoritePlaylists.map((item) => ({
      id: item.info.id,
      playlist: item,
    })),
  };
}

function importWithStableIds(storage, backup, mode = 'merge') {
  let sequence = 0;
  return playlistBackup.importBackup(storage, backup, {
    mode,
    idFactory: () => {
      sequence += 1;
      return `myplaylist_imported_${sequence}`;
    },
  });
}

{
  const incomingFavorite = favorite('neplaylist_taken', 'Incoming favorite');
  const storage = new MemoryStorage({
    playerlists: [],
    favoriteplayerlists: [],
    neplaylist_taken: playlist('neplaylist_taken', 'Wrong category object', []),
  });
  const before = JSON.stringify(Array.from(storage.values.entries()));
  assert.throws(
    () => importWithStableIds(storage, v2Backup([], [incomingFavorite])),
    (error) => error.code === 'INVALID_STORAGE'
  );
  assert.throws(
    () =>
      importWithStableIds(storage, v2Backup([], [incomingFavorite]), 'replace'),
    (error) => error.code === 'INVALID_STORAGE'
  );
  assert.strictEqual(
    JSON.stringify(Array.from(storage.values.entries())),
    before
  );
}

{
  const storage = new MemoryStorage({
    playerlists: ['myplaylist_one'],
    myplaylist_one: playlist('myplaylist_one', 'One', ['a', 'a', 'b']),
    favoriteplayerlists: ['neplaylist_1'],
    neplaylist_1: favorite('neplaylist_1', 'Favorite'),
    theme: 'dark',
    githubOauthAccessKey: 'secret',
    lmplaylist_reserve: { local: true },
  });
  const backup = playlistBackup.createBackup(storage);

  assert.deepStrictEqual(Object.keys(backup).sort(), [
    'exportedAt',
    'favoritePlaylists',
    'format',
    'playlists',
    'version',
  ]);
  assert.deepStrictEqual(
    backup.playlists.map((entry) => entry.id),
    ['myplaylist_one']
  );
  assert.deepStrictEqual(
    backup.playlists[0].playlist.tracks.map((track) => track.id),
    ['a', 'b']
  );
  assert.deepStrictEqual(
    backup.favoritePlaylists.map((entry) => entry.id),
    ['neplaylist_1']
  );
  assert(!storage.getCalls.includes('theme'));
  assert(!storage.getCalls.includes('githubOauthAccessKey'));
  assert(!storage.getCalls.includes('lmplaylist_reserve'));
}

{
  const storage = new MemoryStorage({
    playerlists: ['myplaylist_b'],
    myplaylist_b: playlist('myplaylist_b', '同名歌单', ['b']),
    favoriteplayerlists: ['neplaylist_1'],
    neplaylist_1: favorite('neplaylist_1', 'Local favorite'),
  });
  const imported = playlist('myplaylist_a', '同名歌单', ['a', 'a', 'c']);
  const incomingFavorite = favorite('neplaylist_2', 'Imported favorite');
  const summary = importWithStableIds(
    storage,
    v2Backup(
      [imported],
      [favorite('neplaylist_1', 'Remote copy'), incomingFavorite]
    )
  );

  assert.strictEqual(summary.importedPlaylists, 1);
  assert.strictEqual(summary.conflictedPlaylists, 0);
  assert.strictEqual(summary.importedFavorites, 1);
  assert.deepStrictEqual(storage.getObject('playerlists'), [
    'myplaylist_b',
    'myplaylist_a',
  ]);
  assert.deepStrictEqual(
    storage.getObject('myplaylist_a').tracks.map((track) => track.id),
    ['a', 'c']
  );
  assert.deepStrictEqual(storage.getObject('favoriteplayerlists'), [
    'neplaylist_1',
    'neplaylist_2',
  ]);
  assert.strictEqual(
    storage.getObject('neplaylist_1').info.title,
    'Local favorite'
  );
}

{
  const same = playlist('myplaylist_same', 'Same', ['a']);
  const changed = playlist('myplaylist_same', 'Changed', ['b']);
  const storage = new MemoryStorage({
    playerlists: ['myplaylist_same'],
    myplaylist_same: same,
    favoriteplayerlists: [],
  });

  const skipped = importWithStableIds(storage, v2Backup([same]));
  assert.strictEqual(skipped.skippedPlaylists, 1);
  assert.deepStrictEqual(storage.getObject('playerlists'), ['myplaylist_same']);

  const conflicted = importWithStableIds(storage, v2Backup([changed]));
  assert.strictEqual(conflicted.conflictedPlaylists, 1);
  assert.deepStrictEqual(storage.getObject('playerlists'), [
    'myplaylist_same',
    'myplaylist_imported_1',
  ]);
  assert.strictEqual(
    storage.getObject('myplaylist_imported_1').info.id,
    'myplaylist_imported_1'
  );
  assert.strictEqual(
    storage.getObject('myplaylist_imported_1').__listen2BackupSource.id,
    'myplaylist_same'
  );

  const repeat = importWithStableIds(storage, v2Backup([changed]));
  assert.strictEqual(repeat.skippedPlaylists, 1);
  assert.strictEqual(repeat.conflictedPlaylists, 0);
  assert.deepStrictEqual(storage.getObject('playerlists'), [
    'myplaylist_same',
    'myplaylist_imported_1',
  ]);
}

{
  const storage = new MemoryStorage({
    playerlists: ['myplaylist_old'],
    myplaylist_old: playlist('myplaylist_old', 'Old', ['old']),
    favoriteplayerlists: ['neplaylist_old'],
    neplaylist_old: favorite('neplaylist_old', 'Old favorite'),
    theme: 'white',
    githubOauthAccessKey: 'must-stay',
    lmplaylist_reserve: { local: true },
    myplaylist_orphan: playlist('myplaylist_orphan', 'Orphan', ['orphan']),
  });
  const incoming = playlist('myplaylist_old', 'Replacement', ['fresh']);
  const summary = importWithStableIds(
    storage,
    v2Backup([incoming], [favorite('neplaylist_new', 'New favorite')]),
    'replace'
  );

  assert.strictEqual(summary.mode, 'replace');
  assert.deepStrictEqual(storage.getObject('playerlists'), ['myplaylist_old']);
  assert.deepStrictEqual(storage.getObject('favoriteplayerlists'), [
    'neplaylist_new',
  ]);
  assert.strictEqual(
    storage.getObject('myplaylist_old').info.title,
    'Replacement'
  );
  assert.strictEqual(storage.getObject('theme'), 'white');
  assert.strictEqual(storage.getObject('githubOauthAccessKey'), 'must-stay');
  assert.deepStrictEqual(storage.getObject('lmplaylist_reserve'), {
    local: true,
  });
  assert.strictEqual(
    storage.getObject('myplaylist_orphan').info.title,
    'Orphan'
  );
}

{
  const oldPlaylist = playlist('myplaylist_legacy', 'Legacy', ['x']);
  const legacy = {
    playerlists: ['myplaylist_legacy'],
    myplaylist_legacy: oldPlaylist,
    favoriteplayerlists: ['qqplaylist_legacy'],
    qqplaylist_legacy: favorite('qqplaylist_legacy', 'Legacy favorite'),
    theme: 'must not import',
    githubOauthAccessKey: 'must not import',
  };
  const storage = new MemoryStorage({
    playerlists: [],
    favoriteplayerlists: [],
  });
  const summary = importWithStableIds(storage, legacy);
  assert.strictEqual(summary.importedPlaylists, 1);
  assert.strictEqual(summary.importedFavorites, 1);
  assert.strictEqual(storage.getObject('theme'), null);
  assert.strictEqual(storage.getObject('githubOauthAccessKey'), null);
}

{
  const storage = new MemoryStorage({
    playerlists: ['myplaylist_existing'],
    myplaylist_existing: playlist('myplaylist_existing', 'Existing', ['e']),
    favoriteplayerlists: [],
    theme: 'dark',
  });
  const before = JSON.stringify(Array.from(storage.values.entries()));
  assert.throws(
    () =>
      playlistBackup.importBackup(
        storage,
        '{"playerlists":[],"__proto__":{"polluted":true}}'
      ),
    (error) => error.code === 'UNSAFE_BACKUP'
  );
  assert.throws(
    () => playlistBackup.importBackup(storage, '{not json'),
    (error) => error.code === 'INVALID_JSON'
  );
  assert.strictEqual(
    JSON.stringify(Array.from(storage.values.entries())),
    before
  );

  const partlyInvalid = v2Backup([
    playlist('myplaylist_valid', 'Valid', ['v']),
    { info: { id: 'myplaylist_invalid', title: 'Broken' }, tracks: {} },
  ]);
  const summary = importWithStableIds(storage, partlyInvalid);
  assert.strictEqual(summary.importedPlaylists, 1);
  assert.strictEqual(summary.skippedInvalid, 1);
  assert.strictEqual(storage.getObject('theme'), 'dark');
}

{
  const localTrack = {
    id: 'lmtrack_/Users/example/Music/private.mp3',
    source: 'localmusic',
    sound_url: 'file:///Users/example/Music/private.mp3',
    title: 'Private local track',
  };
  const absolutePathTrack = {
    id: 'remote-but-local-path',
    source: 'bilibili',
    sound_url: '/Users/example/Music/private.mp3',
    title: 'Must not export',
  };
  const remoteTrack = {
    id: 'bitrack_remote',
    source: 'bilibili',
    sound_url: 'https://example.test/audio.mp3',
    title: 'Keep me',
  };
  const slashTitleTrack = {
    id: 'bitrack_slash_title',
    source: 'bilibili',
    sound_url: 'https://example.test/slash.mp3',
    title: '/ slash is a title, not a local path',
  };
  const mixed = playlist('myplaylist_safe', 'Safe', []);
  mixed.tracks = [localTrack, absolutePathTrack, remoteTrack, slashTitleTrack];
  const storage = new MemoryStorage({
    playerlists: ['myplaylist_safe'],
    myplaylist_safe: mixed,
    favoriteplayerlists: [],
    lmplaylist_reserve: { tracks: [localTrack] },
  });
  const backup = playlistBackup.createBackup(storage);
  assert.deepStrictEqual(backup.playlists[0].playlist.tracks, [
    remoteTrack,
    slashTitleTrack,
  ]);
  assert.doesNotMatch(JSON.stringify(backup), /file:\/\/|\/Users\/example/);

  const importedStorage = new MemoryStorage({
    playerlists: [],
    favoriteplayerlists: [],
  });
  importWithStableIds(importedStorage, v2Backup([mixed]));
  assert.deepStrictEqual(importedStorage.getObject('myplaylist_safe').tracks, [
    remoteTrack,
    slashTitleTrack,
  ]);
}

{
  const occupiedStorage = new MemoryStorage({
    playerlists: [],
    favoriteplayerlists: [],
    myplaylist_reserved_for_other_data: {
      info: {
        id: 'myplaylist_reserved_for_other_data',
        title: 'Not a playlist',
      },
      tracks: [],
      setting: true,
    },
    neplaylist_reserved_for_other_data: {
      info: {
        id: 'neplaylist_reserved_for_other_data',
        title: 'Not a favorite',
      },
      setting: true,
    },
  });
  assert.throws(
    () =>
      importWithStableIds(
        occupiedStorage,
        v2Backup([
          playlist(
            'myplaylist_reserved_for_other_data',
            'Unsafe overwrite',
            []
          ),
        ]),
        'replace'
      ),
    (error) => error.code === 'INVALID_STORAGE'
  );
  assert.throws(
    () =>
      importWithStableIds(
        occupiedStorage,
        v2Backup(
          [],
          [favorite('neplaylist_reserved_for_other_data', 'Unsafe favorite')]
        ),
        'replace'
      ),
    (error) => error.code === 'INVALID_STORAGE'
  );
  assert.deepStrictEqual(
    occupiedStorage.getObject('myplaylist_reserved_for_other_data'),
    {
      info: {
        id: 'myplaylist_reserved_for_other_data',
        title: 'Not a playlist',
      },
      tracks: [],
      setting: true,
    }
  );
  assert.deepStrictEqual(
    occupiedStorage.getObject('neplaylist_reserved_for_other_data'),
    {
      info: {
        id: 'neplaylist_reserved_for_other_data',
        title: 'Not a favorite',
      },
      setting: true,
    }
  );
}

{
  const storage = new MemoryStorage({
    playerlists: [],
    favoriteplayerlists: [],
  });
  const wrongSelfId = playlist('neplaylist_not_mine', 'Wrong type', ['a']);
  const wrongFavoriteId = favorite('myplaylist_not_favorite', 'Wrong type');
  const invalidSummary = importWithStableIds(
    storage,
    v2Backup([wrongSelfId], [wrongFavoriteId])
  );
  assert.strictEqual(invalidSummary.skippedInvalid, 2);
  assert.deepStrictEqual(storage.getObject('playerlists'), []);
  assert.deepStrictEqual(storage.getObject('favoriteplayerlists'), []);

  const crossCategoryId = 'myplaylist_cross_category';
  const crossCategory = {
    format: 'listen2-playlist-backup',
    version: 2,
    exportedAt: '2026-08-23T00:00:00.000Z',
    playlists: [
      { id: crossCategoryId, playlist: playlist(crossCategoryId, 'Mine', []) },
    ],
    favoritePlaylists: [
      { id: crossCategoryId, playlist: favorite(crossCategoryId, 'Wrong') },
    ],
  };
  assert.throws(
    () => importWithStableIds(storage, crossCategory),
    (error) => error.code === 'DUPLICATE_PLAYLIST_ID'
  );
}

{
  const storage = new MemoryStorage({
    playerlists: [],
    favoriteplayerlists: [],
  });
  const excessiveTracks = playlist('myplaylist_too_many', 'Too many', []);
  excessiveTracks.tracks = Array.from(
    { length: playlistBackup.MAX_TRACKS_PER_PLAYLIST + 1 },
    (_, index) => ({ id: `track_${index}` })
  );
  assert.throws(
    () => importWithStableIds(storage, v2Backup([excessiveTracks])),
    (error) => error.code === 'BACKUP_TOO_LARGE'
  );
  assert.throws(
    () =>
      playlistBackup.importBackup(
        storage,
        `{"playerlists":[],"padding":"${'x'.repeat(
          playlistBackup.MAX_BACKUP_BYTES
        )}"}`
      ),
    (error) => error.code === 'BACKUP_TOO_LARGE'
  );
}

{
  const storage = new MemoryStorage(
    {
      playerlists: ['myplaylist_existing'],
      myplaylist_existing: playlist('myplaylist_existing', 'Existing', ['e']),
      favoriteplayerlists: [],
    },
    'playerlists'
  );
  const before = JSON.stringify(Array.from(storage.values.entries()));
  assert.throws(
    () =>
      importWithStableIds(
        storage,
        v2Backup([playlist('myplaylist_new', 'New', ['n'])])
      ),
    (error) => error.code === 'BACKUP_WRITE_FAILED'
  );
  assert.strictEqual(
    JSON.stringify(Array.from(storage.values.entries())),
    before
  );
}

{
  const storage = new MemoryStorage(
    {
      playerlists: ['myplaylist_existing'],
      myplaylist_existing: playlist('myplaylist_existing', 'Existing', ['e']),
      favoriteplayerlists: [],
    },
    'playerlists',
    Number.POSITIVE_INFINITY
  );
  assert.throws(
    () =>
      importWithStableIds(
        storage,
        v2Backup([playlist('myplaylist_new', 'New', ['n'])])
      ),
    (error) =>
      error.code === 'BACKUP_ROLLBACK_FAILED' &&
      Array.isArray(error.rollbackErrors) &&
      error.rollbackErrors.includes('playerlists')
  );
}

{
  const githubSource = fs.readFileSync(
    path.join(extensionRoot, 'js', 'github.js'),
    'utf8'
  );
  const context = {
    playlistBackup,
    window: {},
    axios: {
      create: () => ({
        interceptors: { request: { use: () => {} } },
      }),
    },
  };
  vm.runInNewContext(githubSource, context, { filename: 'github.js' });
  const backup = v2Backup([playlist('myplaylist_gist', 'Gist', ['a', 'b'])]);
  const files = context.window.GithubClient.gist.json2gist(backup);
  assert.strictEqual(
    JSON.parse(files['listen1_backup.json'].content).format,
    'listen2-playlist-backup'
  );
  assert.match(
    files['listen1_aha_playlist.md'].content,
    /歌曲数：2，歌单数：1/
  );
  assert(files['listen1_myplaylist_gist.md']);

  const legacyFiles = context.window.GithubClient.gist.json2gist({
    playerlists: ['myplaylist_old_gist'],
    myplaylist_old_gist: playlist('myplaylist_old_gist', 'Old Gist', ['a']),
  });
  assert.match(
    legacyFiles['listen1_aha_playlist.md'].content,
    /歌曲数：1，歌单数：1/
  );
}

function createGithubContext(get) {
  const githubSource = fs.readFileSync(
    path.join(extensionRoot, 'js', 'github.js'),
    'utf8'
  );
  const context = {
    playlistBackup,
    window: {},
    axios: {
      create: () => ({
        interceptors: { request: { use: () => {} } },
        get,
      }),
    },
  };
  vm.runInNewContext(githubSource, context, { filename: 'github.js' });
  return context.window.GithubClient.gist;
}

async function testGist2jsonPromiseContract() {
  const gist = createGithubContext(() => Promise.resolve({ data: {} }));
  let callbackValue = null;
  const immediate = await gist.gist2json(
    { 'listen1_backup.json': { truncated: false, content: '{"ok":true}' } },
    (value) => {
      callbackValue = value;
    }
  );
  assert.strictEqual(immediate.ok, true);
  assert.strictEqual(callbackValue.ok, true);

  const truncated = createGithubContext(() =>
    Promise.resolve({ data: '{"fromRawUrl":true}' })
  );
  const rawResult = await truncated.gist2json({
    'listen1_backup.json': {
      truncated: true,
      raw_url: 'https://gist.example/listen1_backup.json',
    },
  });
  assert.strictEqual(rawResult.fromRawUrl, true);

  await assert.rejects(
    gist.gist2json({}),
    (error) => error.code === 'BACKUP_FILE_MISSING'
  );
  await assert.rejects(
    gist.gist2json({
      'listen1_backup.json': { truncated: false, content: 'not-json' },
    }),
    (error) => error.code === 'BACKUP_JSON_INVALID'
  );

  const rejected = createGithubContext(() =>
    Promise.reject(new Error('offline'))
  );
  await assert.rejects(
    rejected.gist2json({
      'listen1_backup.json': {
        truncated: true,
        raw_url: 'https://gist.example/listen1_backup.json',
      },
    }),
    (error) => error.code === 'BACKUP_GIST_REQUEST_FAILED'
  );
}

testGist2jsonPromiseContract()
  .then(() => {
    // eslint-disable-next-line no-console
    console.log('Playlist backup merge tests passed.');
  })
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exitCode = 1;
  });
