/* eslint-env node */
/* eslint-disable no-console */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'js', 'controller', 'play.js'),
  'utf8'
);

// Execute the real controller event bodies with only Angular scheduling stubbed.
const format = source.slice(
  source.indexOf('function formatSecond('),
  source.indexOf('function hasMeaningfulLyricText(')
);
const progress = source.slice(
  source.indexOf("// 'currentTrack:duration'"),
  source.indexOf("          case 'LOAD':")
).replace(/break;\s*}\s*$/, '');
const drag = source.slice(
  source.indexOf("    $rootScope.$on('dragbar:myprogress'"),
  source.indexOf("    $rootScope.$on('dragbar:changing_progress'")
);
const loadReset = source.slice(
  source.indexOf('            const previousTrackId =', source.indexOf("case 'LOAD':")),
  source.indexOf('            const isVideoTrack =', source.indexOf("case 'LOAD':"))
);
let onDrag;
const scope = {
  changingProgress: false,
  $evalAsync(fn) { fn(); },
};
const context = vm.createContext({
  $scope: scope,
  $rootScope: { $on(name, fn) { onDrag = fn; } },
  msg: { data: {} },
});
vm.runInContext(`${format}\n${drag}`, context);
function update(pos, duration) {
  context.msg.data = { pos, duration };
  vm.runInContext(progress, context);
}

update(3661.9, 7323.5);
assert.strictEqual(scope.currentPosition, '1:01:01');
assert.strictEqual(scope.currentDuration, '2:02:03');
assert.strictEqual(scope.currentDurationSeconds, 7323.5);
onDrag(null, 50);
assert.strictEqual(scope.currentPosition, '1:01:01', 'drag uses seconds');

update(1, 200.1);
update(1, 200.9);
assert.strictEqual(scope.currentDurationSeconds, 200.9,
  'a duration correction within the same displayed second must still update seek');

[0, -1, NaN, Infinity, undefined].forEach((duration) => {
  update(NaN, duration);
  assert.strictEqual(scope.currentDuration, '0:00');
  assert.strictEqual(scope.currentDurationSeconds, 0);
  assert.strictEqual(scope.myProgress, 0);
  assert.strictEqual(scope.currentPosition, '0:00');
  onDrag(null, 50);
  assert.strictEqual(scope.currentPosition, '0:00', 'unknown tracks cannot seek using old duration');
});

update(-5, 240);
assert.strictEqual(scope.currentPosition, '0:00');
assert.strictEqual(scope.myProgress, 0);
onDrag(null, NaN);
assert.strictEqual(scope.myProgress, 0);
assert.strictEqual(scope.currentPosition, '0:00');
onDrag(null, 150);
assert.strictEqual(scope.myProgress, 100);
assert.strictEqual(scope.currentPosition, '4:00');
scope.changingProgress = true;
update(10, 240);
assert.strictEqual(scope.currentPosition, '4:00', 'player ticks must not overwrite a drag preview');

scope.currentPlaying = { id: 'previous' };
scope.myProgress = 80;
context.msg.data = { currentPlaying: { id: 'next' } };
vm.runInContext(loadReset, context);
assert.strictEqual(scope.currentDurationSeconds, 0);
assert.strictEqual(scope.currentDuration, '0:00');
assert.strictEqual(scope.currentPosition, '0:00');
assert.strictEqual(scope.myProgress, 0, 'new tracks cannot retain the old seek fill');

console.log('Player progress time state boundaries passed.');
