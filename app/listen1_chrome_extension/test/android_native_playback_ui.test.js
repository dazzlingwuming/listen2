/* eslint-env node */
/* eslint-disable no-console */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

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

function run() {
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

run();
