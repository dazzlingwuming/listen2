/* eslint-env node */
/* eslint-disable no-console */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const controller = fs.readFileSync(
  path.join(root, 'js', 'controller', 'play.js'),
  'utf8'
);
const markup = fs.readFileSync(path.join(root, 'listen1.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css', 'redesign.css'), 'utf8');

function requireText(source, expected, explanation) {
  assert.ok(source.includes(expected), `${explanation}: missing ${expected}`);
}

async function run() {
  const keyboardScope = {
    androidPlaybackEnabled: true,
    androidPlaybackDetailOpen: true,
    androidUi: {},
    androidQueueConfirmation: { open: false },
    lyricPickerOpen: true,
    closeLyricPicker() { this.lyricPickerOpen = false; },
    closeAndroidPlayerDetail() { this.androidPlaybackDetailOpen = false; },
    $evalAsync(fn) { fn(); },
  };
  const keyboardContext = { $scope: keyboardScope };
  vm.runInNewContext(controller.slice(
    controller.indexOf('$scope.handleAndroidPlayerBack ='),
    controller.indexOf("$scope.$on('android:playback-back'")
  ) + '\nthis.keydown = handleAndroidPlayerKeydown;', keyboardContext);
  for (const [key, keyCode] of [['a', 65], ['Enter', 13], ['Backspace', 8], ['Process', 229], ['Tab', 9]]) {
    const event = { type: 'keydown', key, keyCode, preventDefault() { throw new Error('Ordinary input was consumed'); } };
    keyboardScope.handleAndroidPlayerBack(event);
    keyboardContext.keydown(event);
    assert.ok(keyboardScope.lyricPickerOpen && keyboardScope.androidPlaybackDetailOpen,
      'typing and submitting lyrics must preserve both panels');
  }
  keyboardContext.keydown({ key: 'Escape', keyCode: 27, preventDefault() {} });
  assert.strictEqual(keyboardScope.lyricPickerOpen, false);
  assert.strictEqual(keyboardScope.androidPlaybackDetailOpen, true, 'Escape closes only the top panel');
  keyboardScope.handleAndroidPlayerBack({ preventDefault() {} });
  assert.strictEqual(keyboardScope.androidPlaybackDetailOpen, false, 'native Back still works');
  const actionContext = { $scope: { androidPlaybackEnabled: true, androidPlaybackSnapshot: {
    revision: 7, actions: { play: true, pause: false, next: true, seek: true, retry: true },
  } } };
  vm.runInNewContext(controller.slice(controller.indexOf('function isAndroidPlaybackActionAvailable(action)'),
    controller.indexOf('function androidPlaybackStateCopy(snapshot)')), actionContext);
  assert.strictEqual(actionContext.isAndroidPlaybackActionAvailable('mode'), true,
    'mode is a configuration command, not one of the six transport action flags');
  assert.strictEqual(actionContext.isAndroidPlaybackActionAvailable('pause'), false);
  actionContext.$scope.androidPlaybackSnapshot.revision = 0;
  assert.strictEqual(actionContext.isAndroidPlaybackActionAvailable('mode'), false);
  const seekCommands = [];
  const seekContext = {
    $scope: {
      androidPlaybackSeekDraft: 52000,
      androidUi: {},
      androidPlaybackSnapshot: { positionMs: 90000, durationMs: 120000 },
      $evalAsync: (fn) => fn(),
      sendAndroidPlaybackCommand: (command, payload) => { seekCommands.push({command, payload}); return Promise.resolve(); },
    },
    isAndroidPlaybackActionAvailable: () => true,
  };
  vm.runInNewContext(controller.slice(
    controller.indexOf('$scope.commitAndroidSeek ='),
    controller.indexOf('$scope.openAndroidPlayerDetail =')
  ), seekContext);
  vm.runInNewContext(controller.slice(
    controller.indexOf('$scope.previewAndroidSeek ='),
    controller.indexOf('$scope.commitAndroidSeek =')
  ), seekContext);
  for (const position of [40000, 60000, 90000]) seekContext.$scope.previewAndroidSeek(position);
  assert.strictEqual(seekCommands.length, 0, 'dragging stays local until release');
  assert.strictEqual(seekContext.$scope.androidUi.seekMs, 90000);
  const updateScope = {
    ...seekContext.$scope, androidPlaybackSnapshot: { revision: 1 },
    androidPlaybackCommandPending: 'seek', currentPlaying: null,
  };
  const updateContext = {
    $scope: updateScope, androidPlaybackAdapter: {}, androidPlaybackLastAnnouncementRevision: 0,
    l1Player: {},
  };
  vm.runInNewContext(controller.slice(
    controller.indexOf('function applyAndroidPlaybackSnapshot(snapshot)'),
    controller.indexOf('$scope.sendAndroidPlaybackCommand =')
  ), updateContext);
  updateScope.applyAndroidPlaybackSnapshot({ revision: 2, positionMs: 12000, durationMs: 120000 });
  assert.strictEqual(updateScope.androidUi.seekMs, 90000, 'incoming progress must not pull back the drag');
  assert.strictEqual(updateScope.androidPlaybackCommandPending, 'seek', 'progress does not prematurely unlock pending commands');
  updateScope.applyAndroidPlaybackSnapshot({ revision: 2, positionMs: 13000 });
  assert.strictEqual(updateScope.androidPlaybackSnapshot.positionMs, 12000, 'duplicate revisions are ignored');
  await seekContext.$scope.commitAndroidSeek(90000);
  assert.strictEqual(seekCommands[0].payload.positionMs, 90000,
    'seek must use the input child scope draft, not the older parent snapshot');
  requireText(markup, 'ng-change="previewAndroidSeek(androidUi.seekMs)"',
    'dragging previews locally without flooding the native player');
  requireText(markup, 'android-seek-commit="commitAndroidSeek($value)"',
    'range commits the final native value when the drag ends');

  const stateCopySource = controller.slice(
    controller.indexOf('function androidPlaybackStateCopy(snapshot)'),
    controller.indexOf('$scope.androidPlaybackStateCopy =')
  );
  const copyContext = { $scope: {} };
  vm.runInNewContext(stateCopySource, copyContext);
  const copy = (status) => copyContext.androidPlaybackStateCopy({
    revision: 4,
    state: 'error',
    metadata: { title: 'Selected track' },
    recovery: { status, retryable: true },
  });
  assert.strictEqual(copy('bilibili-detail-http-0'), '网络连接失败，暂时无法播放这首歌曲');
  assert.strictEqual(copy('bilibili-manifest-http-412'), '来源暂时拒绝提供这首歌曲的音频');
  assert.strictEqual(copy('bilibili-manifest-provider--404'), '来源暂时拒绝提供这首歌曲的音频');
  assert.strictEqual(copy('bilibili-manifest-map-identity-mismatch'), '来源返回的音频信息暂时无法使用');
  assert.strictEqual(copy('candidate-rejected'), '音频地址暂时无法使用');
  assert.strictEqual(copy('media-network-unavailable'), '音频网络连接失败，请稍后重试');
  assert.strictEqual(copy('https://private.invalid/?token=secret'), '当前歌曲暂时无法播放');
  const detailErrorCard = markup.match(
    /class="android-player-state"\s+ng-if="androidPlaybackSnapshot.state === 'error'"[\s\S]*?<\/p>/
  );
  assert.ok(detailErrorCard, 'native detail error card exists');
  requireText(
    detailErrorCard[0],
    '<strong>{{androidPlaybackStateCopy()}}</strong>',
    'visible detail error uses the same safe classified state copy'
  );
  [
    'applyAndroidPlaybackSnapshot',
    'sendAndroidPlaybackCommand',
    'openAndroidPlayerDetail',
    'closeAndroidPlayerDetail',
    'commitAndroidSeek',
    'handleAndroidPlayerBack',
  ].forEach((name) =>
    requireText(controller, name, 'native controller contract')
  );

  [
    '正在连接播放器…',
    '正在准备播放…',
    '正在缓冲…',
    '正在尝试恢复播放（',
    'androidPlaybackRetryAttempt',
    'androidPlaybackRetryMax',
  ].forEach((text) =>
    requireText(controller, text, 'safe playback state copy')
  );

  [
    '当前歌曲暂时无法播放',
    '请重试，或选择其他歌曲。',
    '重试播放',
    '暂时无法跳转进度',
    '播放当前歌曲',
    '暂停当前歌曲',
    '播放队列（{{androidPlaybackQueue.length}}）',
  ].forEach((text) => requireText(markup, text, 'safe playback copy'));

  [
    'data-android-mini-player',
    'data-android-player-detail',
    'data-android-playback-live-region',
    'role="slider"',
    'aria-busy="{{androidPlaybackBusy}}"',
    'ng-disabled="androidPlaybackCommandPending',
    'ng-click="openPrimaryLyrics()',
  ].forEach((text) => requireText(markup, text, 'semantic playback markup'));

  assert.ok(
    !markup.includes('当前设备无法播放此音频'),
    'legacy unsafe Android error copy must not remain in the phone player'
  );

  [
    '--android-player-target: 48px',
    '--android-mini-player-height: 72px',
    'min-height: var(--android-player-target)',
    'min-width: var(--android-player-target)',
    'height: 100svh',
    'prefers-reduced-motion: reduce',
    'env(safe-area-inset-bottom, 0px)',
    'forced-colors: active',
  ].forEach((text) => requireText(css, text, 'phone layout contract'));
  console.log('android native playback UI tests passed');
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
