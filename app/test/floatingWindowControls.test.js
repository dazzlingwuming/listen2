const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const appRoot = path.resolve(__dirname, "..");
const floatingWindowSource = fs.readFileSync(
  path.join(appRoot, "floatingWindow.html"),
  "utf8"
);
const mainSource = fs.readFileSync(path.join(appRoot, "main.js"), "utf8");
const preloadSource = fs.readFileSync(path.join(appRoot, "preload.js"), "utf8");

test("the unlocked lyric toolbar exposes the three standard playback controls", () => {
  assert.match(floatingWindowSource, /data-msg="float_window_previous"/);
  assert.match(floatingWindowSource, /data-msg="float_window_toggle_playback"/);
  assert.match(floatingWindowSource, /data-msg="float_window_next"/);
  assert.match(floatingWindowSource, /role="group"\s+aria-label="播放控制"/);
});

test("the locked toolbar exposes only its unlock action", () => {
  const lockedToolbar = floatingWindowSource.match(
    /<div class="locked">([\s\S]*?)<\/div>\s*<div class="unlocked">/
  );
  assert.ok(lockedToolbar, "locked and unlocked toolbar sections must exist");
  assert.match(lockedToolbar[1], /aria-label="解锁桌面歌词"/);
  assert.doesNotMatch(lockedToolbar[1], /control-action/);
  assert.doesNotMatch(lockedToolbar[1], /float_window_(previous|next|toggle)/);
});

test("desktop lyric controls reuse the existing player shortcut channel", () => {
  const routes = [
    ["float_window_previous", "left"],
    ["float_window_toggle_playback", "space"],
    ["float_window_next", "right"],
  ];

  routes.forEach(([command, shortcut]) => {
    const routePattern = new RegExp(
      `case "${command}":[\\s\\S]*?webContents\\.send\\("globalShortcut", "${shortcut}"\\);`
    );
    assert.match(mainSource, routePattern);
  });
});

test("playback state is mirrored into the floating lyric window", () => {
  assert.match(preloadSource, /onPlaybackState/);
  assert.match(preloadSource, /ipcRenderer\.on\("playbackState"/);
  assert.match(mainSource, /sendFloatingWindowPlaybackState/);
  assert.match(mainSource, /isPlaying: playerIsPlaying/);
  assert.match(floatingWindowSource, /body\.classList\.toggle\(/);
  assert.match(floatingWindowSource, /"player-is-playing"/);
});
