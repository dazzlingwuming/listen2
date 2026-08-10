/* eslint-env node */
/* eslint-disable no-console, no-underscore-dangle */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createPlayer(mediaService, windowValues = {}) {
  const filename = path.join(__dirname, '..', 'js', 'player_thread.js');
  const source = fs.readFileSync(filename, 'utf8');
  const messages = [];
  const timers = [];
  const timerDelays = [];
  const intervals = [];
  const howls = [];
  let now = 0;
  function MockHowl(options) {
    const howl = {
      _sounds: [],
      duration() {
        return 180;
      },
      options,
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
    Date: { now: () => now },
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
    navigator: {
      mediaSession: {
        setActionHandler() {},
      },
    },
    playerSendMessage(mode, message) {
      messages.push({ mode, message });
    },
    setInterval(callback) {
      intervals.push(callback);
      return intervals.length;
    },
    setTimeout(callback, delay) {
      timers.push(callback);
      timerDelays.push(delay);
      return timers.length;
    },
    window: { ...windowValues },
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename });
  return {
    player: context.window.threadPlayer,
    howls,
    messages,
    runTimers() {
      while (timers.length) {
        timers.shift()();
      }
    },
    runRefreshTick() {
      intervals[0]();
    },
    setNow(value) {
      now = value;
    },
    timerDelays,
  };
}

function createMediaNode(bufferedEnd = 0) {
  const listeners = new Map();
  return {
    playCalls: 0,
    buffered: {
      length: bufferedEnd ? 1 : 0,
      start() {
        return 0;
      },
      end() {
        return bufferedEnd;
      },
    },
    addEventListener(event, listener) {
      listeners.set(event, listener);
    },
    removeEventListener(event) {
      listeners.delete(event);
    },
    play() {
      this.playCalls += 1;
      return Promise.resolve();
    },
    dispatch(event) {
      const listener = listeners.get(event);
      if (listener) {
        listener();
      }
    },
  };
}

{
  let bootstrapCalls = 0;
  const { player, messages, runTimers, timerDelays } = createPlayer({
    bootstrapTrack(_track, _success, failure) {
      bootstrapCalls += 1;
      failure('network timeout');
    },
  });
  const track = { id: 'bitrack_v_test-1', source: 'bilibili', howl: null };
  player.playlist = [track];
  player.index = 0;

  player.play();
  runTimers();

  assert.strictEqual(bootstrapCalls, 3, 'media URL retries must be bounded');
  assert.deepStrictEqual(
    timerDelays,
    [350, 1000],
    'media URL retries use bounded non-zero backoff'
  );
  assert.strictEqual(
    track.disabled,
    true,
    'terminal failure remains retryable by user'
  );
  assert.strictEqual(
    messages.filter(
      ({ message }) => message.type === 'BG_PLAYER:RETRIEVE_URL_FAIL_ALL'
    ).length,
    0,
    'a transient failure must not auto-skip across the playlist'
  );
  const terminalFailure = messages.find(
    ({ message }) =>
      message.type === 'BG_PLAYER:PLAY_FAILED' &&
      message.data &&
      message.data.stage === 'media-url'
  );
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(terminalFailure.message.data)),
    {
      stage: 'media-url',
      kind: 'retrieve-failed',
      retryable: false,
      attempt: 3,
      message: 'Playback request failed',
    }
  );
}

{
  const calls = [];
  const { player } = createPlayer({
    bootstrapTrack(_track, success, _failure, options) {
      calls.push(options);
      success({ url: 'https://fresh.example/audio.m4s', platform: 'bilibili' });
    },
  });
  const staleHowl = {
    unloadCalled: false,
    unload() {
      this.unloadCalled = true;
    },
  };
  const track = {
    id: 'bitrack_v_test-2',
    source: 'bilibili',
    howl: staleHowl,
  };
  player.playlist = [track];
  player.index = 0;
  player._media_uri_list[track.id] =
    'https://expired.example/audio.m4s?deadline=1';
  player.play();

  assert.strictEqual(staleHowl.unloadCalled, true);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(calls)), [
    { forceRefresh: true },
  ]);
}

{
  const { player, messages, runRefreshTick, setNow } = createPlayer({
    bootstrapTrack() {},
  });
  const node = createMediaNode(40);
  let position = 12;
  let howlPlayCalls = 0;
  const howl = {
    _sounds: [{ _node: node }],
    duration() {
      return 180;
    },
    play() {
      howlPlayCalls += 1;
    },
    playing() {
      return true;
    },
    seek(next) {
      if (typeof next === 'number') {
        position = next;
      }
      return position;
    },
  };
  const track = { id: 'track-stall', source: 'bilibili', howl };
  player.playlist = [track];
  player.index = 0;
  player.beginPlaybackWatch(howl, track);

  node.dispatch('waiting');
  setNow(5000);
  runRefreshTick();

  assert.strictEqual(
    node.playCalls,
    1,
    'refresh timer triggers the first recovery on the real media node'
  );
  assert.strictEqual(
    howlPlayCalls,
    0,
    'recovery never creates a second Howl sound'
  );
  assert.strictEqual(
    position,
    12.05,
    'buffered recovery applies only a tiny nudge'
  );
  assert.ok(
    messages.some(
      ({ message }) =>
        message.type === 'BG_PLAYER:PLAYBACK_RECOVERY' &&
        message.data.state === 'buffering'
    )
  );
  assert.ok(
    messages.some(
      ({ message }) =>
        message.type === 'BG_PLAYER:PLAYBACK_RECOVERY' &&
        message.data.state === 'retrying' &&
        message.data.attempt === 1
    )
  );

  position = 12.5;
  setNow(5100);
  runRefreshTick();
  assert.strictEqual(
    player._playback_watch.recoveryAttempt,
    0,
    'watchdog observes real time progress instead of spectrum amplitude'
  );
}

{
  let bootstrapCalls = 0;
  const permanentError = {
    stage: 'https://cdn.example/audio.m4s?token=stage-secret',
    kind: 'token-kind-secret',
    retryable: false,
    status: 'https://cdn.example/audio.m4s?token=status-secret',
    httpStatus: 403,
    bilibiliCode: -104,
    message: 'https://cdn.example/audio.m4s?token=secret-token',
  };
  const { player, messages, timerDelays } = createPlayer({
    bootstrapTrack(_track, _success, failure) {
      bootstrapCalls += 1;
      failure(permanentError);
    },
  });
  player.playlist = [
    { id: 'bitrack_v_permanent-1', source: 'bilibili', howl: null },
  ];
  player.index = 0;
  player.play();

  assert.strictEqual(
    bootstrapCalls,
    1,
    'permanent provider failures do not retry'
  );
  assert.deepStrictEqual(timerDelays, []);
  const failure = messages.find(
    ({ message }) =>
      message.type === 'BG_PLAYER:PLAY_FAILED' &&
      message.data &&
      message.data.kind === 'retrieve-failed'
  );
  assert.deepStrictEqual(JSON.parse(JSON.stringify(failure.message.data)), {
    stage: 'media-url',
    kind: 'retrieve-failed',
    retryable: false,
    attempt: 1,
    httpStatus: 403,
    bilibiliCode: -104,
    message: 'Playback request failed',
  });
  assert.ok(
    !JSON.stringify(failure.message.data).includes('secret'),
    'public errors never expose signed URLs in stage, kind, status, or message'
  );
}

{
  const { messages, player } = createPlayer({
    bootstrapTrack(_track, _success, failure) {
      failure({
        kind: 'rate-limited',
        retryable: true,
        status: 'request-failed',
      });
    },
  });
  player.playlist = [
    { id: 'bitrack_v_rate-limited-1', source: 'bilibili', howl: null },
  ];
  player.index = 0;
  player.play();

  const retryNotice = messages.find(
    ({ message }) => message.type === 'BG_PLAYER:RETRIEVE_URL_FAIL'
  );
  assert.strictEqual(
    retryNotice.message.data.kind,
    'rate-limited',
    'safe provider kinds remain available for accurate UI notices'
  );
}

{
  const pendingRequests = [];
  const { player, timerDelays } = createPlayer({
    bootstrapTrack(_track, success, failure) {
      pendingRequests.push({ failure, success });
    },
  });
  const track = { id: 'bitrack_v_deferred-1', source: 'bilibili', howl: null };
  player.playlist = [track];
  player.index = 0;
  player.retrieveMediaUrl(0, true);
  player.retrieveMediaUrl(0, true, { forceRefresh: true });

  pendingRequests[1].success({
    platform: 'bilibili',
    url: 'https://fresh.example/audio.m4s',
    urlCandidates: [
      'https://fresh.example/audio.m4s',
      'https://fresh-backup.example/audio.m4s',
    ],
  });
  pendingRequests[0].success({
    platform: 'bilibili',
    url: 'https://stale.example/audio.m4s',
    urlCandidates: ['https://stale.example/audio.m4s'],
  });
  pendingRequests[0].failure({ retryable: true });
  pendingRequests[1].failure({ retryable: true });

  assert.strictEqual(
    player._media_uri_list[track.id],
    'https://fresh.example/audio.m4s',
    'a late request A success cannot overwrite newer request B'
  );
  assert.deepStrictEqual(
    Array.from(player._media_retry_state[track.id].candidates),
    [
      'https://fresh.example/audio.m4s',
      'https://fresh-backup.example/audio.m4s',
    ]
  );
  assert.notStrictEqual(track.disabled, true);
  assert.deepStrictEqual(
    timerDelays,
    [],
    'late callbacks cannot schedule a retry after request B succeeded'
  );
}

{
  const { player } = createPlayer({ bootstrapTrack() {} });
  const staleHowl = {
    unload() {},
  };
  const track = {
    id: 'track-rebuild',
    source: 'bilibili',
    howl: staleHowl,
  };
  player.playlist = [track];
  player.index = 0;
  player._media_uri_list[track.id] = 'https://primary.example/audio.m4s';
  player.setMediaRetryState(track, [
    'https://primary.example/audio.m4s',
    'https://backup.example/audio.m4s',
  ]);

  player.recreateCurrentMediaAt(
    { index: 0, recoveryAttempt: 2, track },
    48.25,
    'stalled'
  );

  assert.strictEqual(
    player._media_uri_list[track.id],
    'https://backup.example/audio.m4s',
    'source recovery advances to the next bounded CDN candidate'
  );
  assert.strictEqual(
    player._media_resume_positions[track.id],
    48.25,
    'source recovery retains the exact position for the replacement Howl'
  );
}

{
  const { player } = createPlayer({ bootstrapTrack() {} });
  player.playlist = [
    { id: 'bitrack_v_safe-diagnostic-1', source: 'bilibili', howl: null },
  ];
  player.index = 0;
  for (let attempt = 0; attempt < 55; attempt += 1) {
    player.recordPlaybackDiagnostic({
      stage: 'media-url',
      kind: 'retrieve-failed',
      state: 'retrying',
      attempt,
      position: attempt,
      uri: 'https://secret.example/audio?token=do-not-store',
    });
  }
  const diagnostics = player.getPlaybackDiagnostics();
  assert.strictEqual(
    diagnostics.length,
    50,
    'diagnostics keep a fixed ring size'
  );
  assert.strictEqual(
    diagnostics[0].attempt,
    5,
    'old diagnostics are evicted first'
  );
  assert.strictEqual(diagnostics[0].trackId, 'bitrack_v_safe-diagnostic-1');
  assert.ok(
    !JSON.stringify(diagnostics).includes('secret.example'),
    'diagnostics never include media URLs or query parameters'
  );
  diagnostics[0].stage = 'mutated-copy';
  assert.strictEqual(player.getPlaybackDiagnostics()[0].stage, 'media-url');
}

{
  const { howls, messages, player, runRefreshTick, setNow } = createPlayer(
    { bootstrapTrack() {} },
    {
      Listen1AudioAnalysis: {
        debug() {
          return { output: { hint: 'recreate-media-element' } };
        },
        ensureOutput() {
          return true;
        },
      },
    }
  );
  const node = createMediaNode();
  let position = 72;
  const staleHowl = {
    _sounds: [{ _node: node }],
    duration() {
      return 180;
    },
    playing() {
      return true;
    },
    seek() {
      return position;
    },
    unload() {},
  };
  const track = {
    id: 'track-audio-output',
    source: 'bilibili',
    howl: staleHowl,
  };
  player.playlist = [track];
  player.index = 0;
  player._media_uri_list[track.id] = 'https://primary.example/audio.m4s';
  player.setMediaRetryState(track, [
    'https://primary.example/audio.m4s',
    'https://backup.example/audio.m4s',
  ]);
  player.beginPlaybackWatch(staleHowl, track);
  position = 73.5;

  runRefreshTick();
  assert.strictEqual(
    player._media_uri_list[track.id],
    'https://backup.example/audio.m4s',
    'output recovery uses the existing bounded CDN rebuild path'
  );
  assert.strictEqual(
    player._media_resume_positions[track.id],
    position,
    'output recovery retains the advancing media position'
  );

  const rebuiltHowl = howls[0];
  const rebuiltNode = createMediaNode(40);
  rebuiltHowl._sounds = [{ _node: rebuiltNode }];
  rebuiltHowl.playing = () => true;
  rebuiltHowl.seek = () => position;
  rebuiltHowl.pauseCalls = 0;
  rebuiltHowl.pause = () => {
    rebuiltHowl.pauseCalls += 1;
  };
  track.howl = rebuiltHowl;
  player.beginPlaybackWatch(rebuiltHowl, track);
  rebuiltNode.dispatch('waiting');
  [5000, 10000, 15000].forEach((time) => {
    position += 0.5;
    setNow(time);
    runRefreshTick();
  });
  assert.strictEqual(
    player._media_retry_state[track.id].candidateIndex,
    1,
    'the same output hint cannot rebuild the new Howl again in one session'
  );
  assert.strictEqual(
    rebuiltNode.playCalls,
    3,
    'persistent output-only recovery is bounded to local media-node retries'
  );
  assert.strictEqual(
    player._media_retry_state[track.id].forceRefreshAttempted,
    false,
    'persistent output recovery never reaches force refresh'
  );
  assert.notStrictEqual(track.disabled, true);
  assert.strictEqual(
    player._media_uri_list[track.id],
    'https://backup.example/audio.m4s'
  );

  position += 0.5;
  setNow(20000);
  runRefreshTick();
  assert.strictEqual(
    rebuiltHowl.pauseCalls,
    1,
    'output-only recovery terminates'
  );
  assert.strictEqual(player._playback_watch, null);
  assert.strictEqual(player._media_retry_state[track.id].candidateIndex, 1);
  assert.notStrictEqual(track.disabled, true);
  assert.ok(
    messages.some(
      ({ message }) =>
        message.type === 'BG_PLAYER:PLAYBACK_RECOVERY' &&
        message.data.state === 'failed' &&
        message.data.kind === 'audio-output'
    ),
    'persistent output recovery reports one bounded terminal state'
  );
}

{
  let ensureCalls = 0;
  const { player, runRefreshTick, setNow } = createPlayer(
    { bootstrapTrack() {} },
    {
      Listen1AudioAnalysis: {
        debug() {
          return { output: { status: 'capture-unavailable' } };
        },
        ensureOutput() {
          ensureCalls += 1;
          return false;
        },
      },
    }
  );
  const node = createMediaNode(40);
  let position = 18;
  const howl = {
    _sounds: [{ _node: node }],
    duration() {
      return 180;
    },
    playing() {
      return true;
    },
    seek(next) {
      if (typeof next === 'number') {
        position = next;
      }
      return position;
    },
  };
  const track = { id: 'track-chrome-native-output', howl, source: 'bilibili' };
  player.playlist = [track];
  player.index = 0;
  player._media_uri_list[track.id] = 'https://primary.example/audio.m4s';
  player.setMediaRetryState(track, [
    'https://primary.example/audio.m4s',
    'https://backup.example/audio.m4s',
  ]);
  player.beginPlaybackWatch(howl, track);
  node.dispatch('waiting');
  setNow(5000);
  runRefreshTick();

  assert.strictEqual(ensureCalls, 1);
  assert.strictEqual(
    node.playCalls,
    1,
    'Chrome capture failure keeps native HTML media recovery active'
  );
  assert.strictEqual(
    player._media_uri_list[track.id],
    'https://primary.example/audio.m4s',
    'capture failure alone does not consume a CDN candidate'
  );
}

{
  const { howls, player } = createPlayer({ bootstrapTrack() {} });
  const first = { id: 'late-callback-first', howl: null, source: 'bilibili' };
  const second = {
    id: 'late-callback-second',
    howl: null,
    source: 'bilibili',
  };
  player.playlist = [first, second];
  player.index = 0;
  player._media_uri_list[first.id] = 'https://primary.example/audio.m4s';
  player._media_uri_list[second.id] = 'https://second.example/audio.m4s';
  player.setMediaRetryState(first, [
    'https://primary.example/audio.m4s',
    'https://backup.example/audio.m4s',
  ]);
  player.finishLoad(0, true);
  const firstHowl = howls[0];

  player.index = 1;
  player.finishLoad(1, true);
  const secondHowl = howls[1];
  player.beginPlaybackWatch(secondHowl, second);
  firstHowl.options.onloaderror(1, 'late error');
  firstHowl.options.onend();
  firstHowl.options.onpause();

  assert.strictEqual(
    player.index,
    1,
    'late end callback cannot skip new track'
  );
  assert.strictEqual(
    player._media_retry_state[first.id].candidateIndex,
    0,
    'late error callback cannot consume the old track CDN candidate'
  );
  assert.strictEqual(
    player._playback_watch.howl,
    secondHowl,
    'late pause callback cannot clear the new track watchdog'
  );
}

console.log('player recovery tests passed');
