/* eslint-env node */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

(async () => {
  let listener;
  const posted = [];
  const context = { URL, clearTimeout, setTimeout, console, window: { Listen2AndroidHttp: {
    addEventListener(type, fn) { listener = fn; },
    postMessage(raw) { posted.push(JSON.parse(raw)); },
  } } };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/lowebutil.js'), 'utf8'), context);
  const github = context.window.Listen2AndroidHttpAdapter.github;
  const respond = (result) => {
    const request = posted.at(-1);
    listener({ data: JSON.stringify({ version: 2, terminal: 'ok', requestId: request.requestId,
      pageEpoch: request.pageEpoch, status: 200, result }) });
  };
  const status = github.request('status');
  assert.strictEqual(posted.at(-1).operation, 'github.sync');
  respond({ ok: true, status: 'OK', connected: false, login: '', gistId: '', lastSync: '' });
  assert.strictEqual((await status.promise).connected, false);
  const connect = github.request('connect', { token: 'github_pat_fixture_only_123456' });
  respond({ ok: false, status: 'TOKEN_INVALID' });
  assert.strictEqual((await connect.promise).status, 'TOKEN_INVALID');
  const pull = github.request('pull', { gistId: 'aabbccddeeff' });
  respond({ ok: true, status: 'OK', connected: true, playlists: 2, tracks: 12 });
  assert.strictEqual((await pull.promise).tracks, 12);
  const before = posted.length;
  await assert.rejects(github.request('pull', { gistId: 'https://bad.example' }).promise);
  await assert.rejects(github.request('delete').promise);
  assert.strictEqual(posted.length, before);
  const local = context.window.Listen2AndroidHttpAdapter.localData;
  const playlistPlay = local.command('playlist.play', { playlistId: 'myplaylist_fixture', startIndex: 745 });
  assert.strictEqual(posted.at(-1).operation, 'local.data.command');
  respond({ ok: true, status: 'OK', data: { accepted: true, tracks: 746 } });
  assert.strictEqual((await playlistPlay.promise).data.tracks, 746);
  await assert.rejects(local.command('playlist.play', { playlistId: 'myplaylist_fixture', startIndex: -1 }).promise);
  await assert.rejects(local.command('playlist.play', { playlistId: 'myplaylist_fixture', startIndex: 1.5 }).promise);
  for (const action of ['backup.import.pick', 'backup.export']) {
    const picker = local.command(action);
    respond({ accepted: true, status: 'pending' });
    const reply = await picker.promise;
    assert.strictEqual(reply.ok, true);
    assert.strictEqual(reply.data.accepted, true);
  }
  const unexpectedSecret = github.request('status');
  respond({ ok: true, status: 'OK', token: 'must-never-return-to-page' });
  await assert.rejects(unexpectedSecret.promise);
  console.log('Android GitHub sync RPC tests passed');
})().catch((error) => { console.error(error); process.exitCode = 1; });
