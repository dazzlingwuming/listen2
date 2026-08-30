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
    'openAndroidQueueSheet',
    'requestAndroidQueueMove',
    'requestAndroidQueueRemove',
    'requestAndroidQueueClear',
    'confirmAndroidQueueMutation',
    'closeAndroidQueueConfirmation',
  ].forEach((name) =>
    requireText(controller, name, 'queue controller contract')
  );

  [
    'data-android-queue-sheet',
    'role="dialog"',
    'aria-modal="true"',
    '队列第 {{$index + 1}} 首',
    '移到最前',
    '上移',
    '下移',
    '移到最后',
    '删除此条队列项？',
    '这不会删除原歌单中的歌曲。',
    '保留此队列项',
    '删除此队列项',
    '清空播放队列？',
    '将移除',
    '首待播歌曲，原歌单不会改变。',
    '保留播放队列',
    '清空播放队列',
    '播放队列为空',
    '添加“下一首播放”的歌曲会显示在这里。',
  ].forEach((text) => requireText(markup, text, 'queue markup/copy'));

  [
    'track by entry.occurrenceId',
    'data-android-queue-row',
    'data-android-queue-confirmation',
    'aria-label="队列第 {{$index + 1}} 首',
  ].forEach((text) =>
    requireText(markup, text, 'occurrence identity contract')
  );

  assert.ok(
    markup.indexOf('data-android-queue-sheet') <
      markup.indexOf('track by entry.occurrenceId'),
    'Android queue must be keyed by native occurrence identity'
  );
  [
    '.android-queue-sheet',
    '.android-queue-row',
    '.android-queue-confirmation',
    'overscroll-behavior: contain',
    'max-height: min(82svh',
  ].forEach((text) => requireText(css, text, 'queue sheet layout contract'));
  console.log('android native queue UI tests passed');
}

run();
