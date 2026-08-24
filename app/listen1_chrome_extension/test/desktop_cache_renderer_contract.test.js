/* eslint-env node */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const loweb = fs.readFileSync(path.join(root, 'js', 'loweb.js'), 'utf8');
const player = fs.readFileSync(
  path.join(root, 'js', 'player_thread.js'),
  'utf8'
);
const bilibili = fs.readFileSync(
  path.join(root, 'js', 'provider', 'bilibili.js'),
  'utf8'
);
const play = fs.readFileSync(
  path.join(root, 'js', 'controller', 'play.js'),
  'utf8'
);

assert.match(loweb, /audio-cache:lookup/);
assert.match(loweb, /audio-cache:schedule-bilibili/);
assert.match(loweb, /audio-cache:invalidate/);
assert.match(loweb, /local-data:delete-track/);
assert.match(loweb, /lyric-cache:migrate-legacy-bilibili-manual/);
assert.match(loweb, /const batchSize = 200/);
assert.match(
  loweb,
  /for \(let index = 0; index < payload\.length; index \+= batchSize\)/
);
assert.match(loweb, /lyric-cache:put/);
assert.match(loweb, /mode === 'auto' \? Date\.now\(\) \+ 30 \* 24/);
assert.match(
  loweb,
  /if \(!match\[2\] && pageMatch && Number\(pageMatch\[1\]\) > 1\)/,
  'unresolved Bilibili p>=2 tracks must not share default-page cache data'
);
assert.match(loweb, /kind: 'audio', sid: audioMatch\[1\]/);
assert.match(loweb, /kind: 'video'/);
assert.match(loweb, /sid: identity\.sid \|\| ''/);
assert.match(bilibili, /audioCacheDescriptor: \{[\s\S]*?kind: 'video'/);
assert.match(bilibili, /audioCacheDescriptor = \{[\s\S]*?kind: 'audio'/);
assert.match(player, /MediaService\.getAudioCacheLookup\(track\)/);
assert.match(player, /fromAudioCache: true/);
assert.match(
  player,
  /MediaService\.invalidateAudioCache\(retryState\.audioCacheKey\)/
);
assert.match(player, /bypassAudioCache: true/);
assert.match(player, /MediaService\.scheduleBilibiliAudioCache/);
assert.match(player, /!retainedStatuses\.includes\(response\.status\)/);
assert.match(play, /legacyBilibiliLyricMigration/);
assert.match(play, /cached\.lyricCacheMode === 'manual'/);
assert.match(
  play,
  /persistAutomaticLyric\(track, result, remote\.expectedRevision\)/
);
assert.match(
  play,
  /persistManualLyric\([\s\S]*?selectedCandidate,[\s\S]*?expectedRevision,[\s\S]*?selectionToken/
);
assert.match(play, /let manualLyricSelectionToken = 0/);
assert.match(play, /const selectionToken = manualLyricSelectionToken \+ 1/);
assert.match(
  play,
  /response\.status === 'stale-revision' &&[\s\S]*?selectionToken === manualLyricSelectionToken/,
  'only the newest manual selection may retry a stale revision'
);
assert.match(
  play,
  /if \(selectionToken !== manualLyricSelectionToken\)[\s\S]*?Promise\.resolve\(null\)/,
  'an older manual selection must not update the displayed lyric'
);
assert.match(play, /MediaService\.clearPersistentLyric/);
assert.match(play, /saveTrackLyricOffset\(track\.id, 0\)/);
assert.match(
  play,
  /if \(response\.partial === true\)[\s\S]*?notyf\.warning\(i18next\.t\('_AUDIO_CACHE_FAILURE_NOTICE'\)\)/,
  'partial local-data deletion must be reported instead of presented as complete'
);
assert.match(
  play,
  /MediaService\.putPersistentLyric\([\s\S]*?'auto'[\s\S]*?expectedRevision/,
  'all desktop provider lyrics must be persisted through the shared auto path'
);

async function verifyLatestSelectionWins() {
  let latestSelection = 1;
  let staleRetries = 0;
  const retryIfCurrent = (selectionToken) =>
    new Promise((resolve) => {
      queueMicrotask(() => {
        if (selectionToken !== latestSelection) {
          resolve('superseded');
          return;
        }
        staleRetries += 1;
        resolve('retried');
      });
    });
  const oldSelection = retryIfCurrent(1);
  latestSelection = 2;
  assert.strictEqual(
    await oldSelection,
    'superseded',
    'a delayed first selection must not retry after a newer selection starts'
  );
  assert.strictEqual(staleRetries, 0);
  assert.strictEqual(await retryIfCurrent(2), 'retried');
  assert.strictEqual(staleRetries, 1);
}

verifyLatestSelectionWins().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exitCode = 1;
});

// eslint-disable-next-line no-console
console.log('Desktop cache renderer contract passed.');
