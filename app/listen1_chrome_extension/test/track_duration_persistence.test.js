/* eslint-env node */
/* eslint-disable no-console */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const filename = path.join(__dirname, '..', 'js', 'myplaylist.js');
const source = fs.readFileSync(filename, 'utf8');
const values = new Map();
const writes = [];
const localStorage = {
  getObject(key) {
    const value = values.get(key);
    return value === undefined ? null : JSON.parse(JSON.stringify(value));
  },
  setObject(key, value) {
    writes.push(key);
    values.set(key, JSON.parse(JSON.stringify(value)));
  },
  removeItem(key) {
    values.delete(key);
  },
};
const context = {
  getParameterByName() {
    return '';
  },
  localStorage,
};
vm.createContext(context);
vm.runInContext(`${source}\nthis.myplaylistForTest = myplaylist;`, context, {
  filename,
});

values.set('myplaylist_test', {
  info: { id: 'myplaylist_test', title: 'test' },
  tracks: [
    { id: 'bitrack_v_BV_FIRST-101', title: 'first' },
    { id: 'bitrack_v_BV_SECOND-202', title: 'second', duration: 196 },
  ],
});

const result = context.myplaylistForTest.update_track_durations(
  'myplaylist_test',
  [
    { id: 'bitrack_v_BV_FIRST-101', duration: 228 },
    { id: 'bitrack_v_BV_SECOND-202', duration: 196 },
    { id: 'unrelated', duration: 999 },
  ]
);

assert.deepStrictEqual(JSON.parse(JSON.stringify(result.tracks)), [
  { id: 'bitrack_v_BV_FIRST-101', title: 'first', duration: 228 },
  { id: 'bitrack_v_BV_SECOND-202', title: 'second', duration: 196 },
]);
assert.deepStrictEqual(writes, ['myplaylist_test']);
assert.strictEqual(
  values.get('myplaylist_test').tracks[0].duration,
  228,
  'hydrated duration must survive reopening the local playlist'
);

console.log('track duration persistence tests passed');
