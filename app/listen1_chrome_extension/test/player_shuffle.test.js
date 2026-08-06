/* eslint-env node */
/* eslint-disable no-bitwise, no-console, no-underscore-dangle */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createPlayer() {
  const filename = path.join(__dirname, '..', 'js', 'player_thread.js');
  const source = fs.readFileSync(filename, 'utf8');
  const context = {
    clearInterval() {},
    console,
    Howl() {},
    Howler: {
      _muted: false,
      mute() {},
      unload() {},
      volume() {
        return 1;
      },
    },
    MediaMetadata() {},
    MediaService: {},
    navigator: {},
    playerSendMessage() {},
    setInterval() {
      return 1;
    },
    window: {},
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename });
  return context.window.threadPlayer;
}

function createL1PlayerForStartup(playerSettings, currentPlaying) {
  const filename = path.join(__dirname, '..', 'js', 'l1_player.js');
  const source = fs.readFileSync(filename, 'utf8');
  const operations = [];
  let loopMode = 0;
  const player = {
    muted: false,
    volume: 1,
    playing: false,
    playlist: [],
    index: -1,
    setNewPlaylist(list) {
      operations.push(`setNewPlaylist:${loopMode}`);
      this.playlist = list;
      this.index = loopMode === 2 ? 'fresh-shuffle-track' : 0;
    },
    loadById(id) {
      operations.push(`loadById:${id}`);
      this.index = `restored:${id}`;
    },
    sendPlaylistEvent() {
      operations.push('sendPlaylistEvent');
    },
    sendPlayingEvent() {
      operations.push('sendPlayingEvent');
    },
    sendLoadEvent() {
      operations.push('sendLoadEvent');
    },
  };
  Object.defineProperty(player, 'loop_mode', {
    get() {
      return loopMode;
    },
    set(value) {
      const loopModes = { all: 0, shuffle: 2, one: 1 };
      loopMode = loopModes[value] === undefined ? value : loopModes[value];
      operations.push(`loopMode:${value}`);
    },
  });

  const context = {
    addPlayerListener() {},
    getPlayer() {
      return player;
    },
    getPlayerAsync(_mode, callback) {
      callback(player);
    },
    getPlayerMode() {
      return 'front';
    },
    localStorage: {
      getObject(key) {
        if (key === 'player-settings') {
          return playerSettings;
        }
        if (key === 'current-playing') {
          return currentPlaying;
        }
        return null;
      },
    },
    window: {},
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename });
  return { l1Player: context.window.l1Player, operations, player };
}

function createTracks(length, disabledIndices = []) {
  return Array.from({ length }, (_value, index) => ({
    id: `track-${index}`,
    title: `Track ${index}`,
    disabled: disabledIndices.includes(index),
    howl: null,
  }));
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function prepareShuffle(player, length, disabledIndices = []) {
  const targetPlayer = player;
  targetPlayer.playlist = createTracks(length, disabledIndices);
  targetPlayer.index = 0;
  targetPlayer._loop_mode = 2;
  targetPlayer._shuffle_random = seededRandom(42);
  targetPlayer.resetShuffleState(targetPlayer.index);
}

function takeNext(player, count) {
  const targetPlayer = player;
  const result = [];
  for (let i = 0; i < count; i += 1) {
    const nextIndex = targetPlayer.nextShuffleIndex(targetPlayer.index);
    result.push(nextIndex);
    targetPlayer.index = nextIndex;
  }
  return result;
}

function sorted(values) {
  return values.slice().sort((a, b) => a - b);
}

{
  const player = createPlayer();
  player._shuffle_random = () => 0.999999;
  assert.deepStrictEqual(
    Array.from(player.shuffleIndices([0, 1, 2])),
    [0, 1, 2],
    'Fisher-Yates must allow an item to remain in its current slot'
  );
}

{
  const player = createPlayer();
  prepareShuffle(player, 5);

  const firstCycle = takeNext(player, 4);
  assert.deepStrictEqual(
    sorted(firstCycle),
    [1, 2, 3, 4],
    'the first cycle must play every track except the current one exactly once'
  );

  const boundaryTrack = player.index;
  const secondCycle = takeNext(player, 5);
  assert.notStrictEqual(
    secondCycle[0],
    boundaryTrack,
    'a new cycle must not immediately repeat the current track'
  );
  assert.deepStrictEqual(
    sorted(secondCycle),
    [0, 1, 2, 3, 4],
    'every complete cycle must contain every track exactly once'
  );

  const thirdCycle = takeNext(player, 5);
  assert.deepStrictEqual(sorted(thirdCycle), [0, 1, 2, 3, 4]);
  assert.notDeepStrictEqual(
    thirdCycle,
    secondCycle,
    'consecutive cycles must not reuse one fixed order'
  );
}

function testAllPlaylistLengths() {
  for (let length = 1; length <= 30; length += 1) {
    const player = createPlayer();
    prepareShuffle(player, length);
    player._shuffle_random = seededRandom(length * 97);

    const initialRemainder = takeNext(player, Math.max(0, length - 1));
    assert.deepStrictEqual(
      sorted(initialRemainder),
      Array.from(
        { length: Math.max(0, length - 1) },
        (_value, index) => index + 1
      )
    );

    let previousCycle = null;
    for (let cycle = 0; cycle < 12; cycle += 1) {
      const boundaryTrack = player.index;
      const shuffledCycle = takeNext(player, length);
      assert.deepStrictEqual(
        sorted(shuffledCycle),
        Array.from({ length }, (_value, index) => index)
      );
      if (length > 1) {
        assert.notStrictEqual(shuffledCycle[0], boundaryTrack);
      }
      if (length > 2 && previousCycle !== null) {
        assert.notDeepStrictEqual(shuffledCycle, previousCycle);
      }
      previousCycle = shuffledCycle;
    }
  }
}

testAllPlaylistLengths();

{
  const player = createPlayer();
  prepareShuffle(player, 6);
  const played = [player.index, ...takeNext(player, 3)];

  const previousOne = player.previousShuffleIndex(player.index);
  player.index = previousOne;
  assert.strictEqual(previousOne, played[2]);

  const previousTwo = player.previousShuffleIndex(player.index);
  player.index = previousTwo;
  assert.strictEqual(previousTwo, played[1]);

  const forwardAgain = player.nextShuffleIndex(player.index);
  assert.strictEqual(
    forwardAgain,
    played[2],
    'next after previous must follow the actual playback history'
  );
}

{
  const player = createPlayer();
  prepareShuffle(player, 5, [2, 4]);

  const firstCycle = takeNext(player, 2);
  assert.deepStrictEqual(
    sorted(firstCycle),
    [1, 3],
    'disabled tracks must not consume playable shuffle slots'
  );

  const secondCycle = takeNext(player, 3);
  assert.deepStrictEqual(sorted(secondCycle), [0, 1, 3]);
}

{
  const player = createPlayer();
  player._loop_mode = 2;
  player._shuffle_random = () => 0.75;
  player.setNewPlaylist(createTracks(4));
  assert.strictEqual(
    player.index,
    3,
    'starting a playlist in shuffle mode must choose a random first track'
  );

  player._shuffle_queue = [0, 1, 2];
  player._shuffle_random = () => 0.25;
  player.setNewPlaylist(createTracks(4));
  assert.strictEqual(player.index, 1);
  assert.deepStrictEqual(
    Array.from(player._shuffle_queue),
    [],
    'a same-length replacement playlist must still get a fresh shuffle state'
  );
  assert.deepStrictEqual(Array.from(player._shuffle_history), [1]);
}

{
  const player = createPlayer();
  prepareShuffle(player, 4);
  takeNext(player, 1);
  assert.ok(player._shuffle_queue.length > 0);

  player.loop_mode = 'all';
  player.loop_mode = 'shuffle';
  assert.deepStrictEqual(Array.from(player._shuffle_queue), []);
  assert.strictEqual(
    player._shuffle_first_cycle,
    true,
    'turning shuffle back on must create a new order'
  );
}

{
  const player = createPlayer();
  prepareShuffle(player, 5);
  const played = [];
  player.play = (index) => {
    played.push(index);
  };

  player.skip('next');
  player.skip('next');
  player.skip('next');
  player.skip('next');
  assert.deepStrictEqual(
    sorted(played),
    [1, 2, 3, 4],
    'the real skip path must use the fresh shuffle queue'
  );

  const currentIndex = player.index;
  const expectedPreviousIndex = played[played.length - 2];
  player.skip('prev');
  assert.strictEqual(
    player.index,
    expectedPreviousIndex,
    'the real previous path must use playback history'
  );
  assert.notStrictEqual(player.index, currentIndex);
}

{
  const { l1Player, operations, player } = createL1PlayerForStartup(
    { playmode: 1, nowplaying_track_id: 'track-1' },
    createTracks(4)
  );
  l1Player.connectPlayer();

  assert.deepStrictEqual(
    operations.slice(0, 2),
    ['loopMode:shuffle', 'setNewPlaylist:2'],
    'the saved shuffle mode must reach the player before its playlist is restored'
  );
  assert.ok(
    !operations.includes('loadById:track-1'),
    'shuffle startup must not overwrite its fresh random first track with the persisted track'
  );
  assert.strictEqual(player.index, 'fresh-shuffle-track');
}

[
  [0, 'all'],
  [2, 'one'],
].forEach(([playmode, loopMode]) => {
  const { l1Player, operations, player } = createL1PlayerForStartup(
    { playmode, nowplaying_track_id: 'track-2' },
    createTracks(4)
  );
  l1Player.connectPlayer();

  assert.deepStrictEqual(
    operations.slice(0, 3),
    [
      `loopMode:${loopMode}`,
      `setNewPlaylist:${playmode === 2 ? 1 : 0}`,
      'loadById:track-2',
    ],
    'non-shuffle startup must retain the saved playback mode and last track'
  );
  assert.strictEqual(player.index, 'restored:track-2');
});

console.log('player shuffle tests passed');
