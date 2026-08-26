/* eslint-env node */
/* eslint-disable no-console, no-underscore-dangle */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createPlayer() {
  const filename = path.join(__dirname, '..', 'js', 'player_thread.js');
  const source = fs.readFileSync(filename, 'utf8');
  const messages = [];
  const context = {
    clearInterval() {},
    console,
    Howl() {},
    Howler: { _muted: false, mute() {}, unload() {}, volume: () => 1 },
    MediaMetadata() {},
    MediaService: {},
    navigator: {},
    playerSendMessage(_mode, message) {
      messages.push(message);
    },
    setInterval: () => 1,
    window: {},
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename });
  return { player: context.window.threadPlayer, messages };
}

function track(id) {
  return { id, title: id, artist: 'artist', duration: 220, disabled: false };
}

{
  const { player } = createPlayer();
  player.playlist = ['current', 'normal-next', 'A', 'B'].map(track);
  player.index = 0;
  const played = [];
  player.play = (index) => {
    player.index = index;
    played.push(player.playlist[index].id);
  };

  player.enqueueNext(track('A'));
  player.enqueueNext(track('B'));
  player.skip('next');
  player.skip('next');
  player.skip('next');
  assert.deepStrictEqual(
    played,
    ['A', 'B', 'normal-next'],
    'FIFO queue must drain before resuming the original playlist context'
  );
}

{
  const { player } = createPlayer();
  player.playlist = ['current', 'A'].map(track);
  player.index = 0;
  const played = [];
  player.play = (index) => {
    player.index = index;
    played.push(player.playlist[index].id);
  };
  player.enqueueNext(track('A'));
  player.enqueueNext(track('A'));
  player.skip('next');
  player.skip('next');
  assert.deepStrictEqual(
    played,
    ['A', 'A'],
    'duplicate queue entries are intentional'
  );
}

{
  const { player } = createPlayer();
  player.playlist = ['current', 'A'].map(track);
  player.index = 0;
  player._loop_mode = 1;
  const played = [];
  player.play = (index) => {
    player.index = index;
    played.push(player.playlist[index].id);
  };
  player.enqueueNext(track('A'));
  player.skip('next');
  assert.strictEqual(player.resumeAfterPlayNextQueue('next'), true);
  assert.deepStrictEqual(played, ['A', 'current']);
}

{
  const { player } = createPlayer();
  player.playlist = [track('current')];
  player.index = 0;
  player.setPlayNextQueue([
    { queueId: 'one', track: track('A') },
    { queueId: 'two', track: track('B') },
  ]);
  player.movePlayNextQueueEntry('two', 0);
  assert.deepStrictEqual(
    Array.from(player._play_next_queue, (entry) => entry.track.id),
    ['B', 'A']
  );
  player.removePlayNextQueueEntry('two');
  assert.deepStrictEqual(
    Array.from(player._play_next_queue, (entry) => entry.track.id),
    ['A']
  );
  player.clearPlayNextQueue();
  assert.strictEqual(player._play_next_queue.length, 0);
}

{
  const { player } = createPlayer();
  player.playlist = ['current', 'normal-next'].map(track);
  player.index = 0;
  player.play = (index) => {
    player.index = index;
  };
  player.enqueueNext(track('temporary'));
  player.skip('next');
  assert.ok(player.playlist.some((item) => item.id === 'temporary'));
  player.skip('next');
  assert.strictEqual(
    player.playlist.some((item) => item.id === 'temporary'),
    false,
    'queue-only tracks must not permanently pollute the original playlist'
  );
  assert.strictEqual(player.currentAudio.id, 'normal-next');
  player.skip('prev');
  assert.strictEqual(
    player.currentAudio.id,
    'temporary',
    'previous must follow actual playback history even for a queue-only track'
  );
}

console.log('player play-next queue tests passed');
