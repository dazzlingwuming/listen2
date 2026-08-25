/* eslint-env node */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const extensionRoot = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(extensionRoot, 'listen1.html'), 'utf8');
const css = fs.readFileSync(
  path.join(extensionRoot, 'css', 'redesign.css'),
  'utf8'
);
const playController = fs.readFileSync(
  path.join(extensionRoot, 'js', 'controller', 'play.js'),
  'utf8'
);

const expectedI18nKeys = [
  '_LYRIC_PERSISTENCE_DESCRIPTION',
  '_AUDIO_CACHE_TITLE',
  '_AUDIO_CACHE_DESCRIPTION',
  '_AUDIO_CACHE_ENABLED',
  '_LOUDNESS_NORMALIZATION_ENABLED',
  '_LOUDNESS_NORMALIZATION_DESCRIPTION',
  '_LOUDNESS_NORMALIZATION_STATUS',
  '_AUDIO_CACHE_CAPACITY',
  '_AUDIO_CACHE_USAGE',
  '_AUDIO_CACHE_TRACKS',
  '_AUDIO_CACHE_DOWNLOAD_STATUS',
  '_AUDIO_CACHE_DOWNLOAD_QUEUED',
  '_AUDIO_CACHE_DOWNLOAD_IDLE',
  '_AUDIO_CACHE_FAILURE_NOTICE',
  '_AUDIO_CACHE_REFRESH',
  '_AUDIO_CACHE_CLEAR',
  '_AUDIO_CACHE_CLEAR_CONFIRM_TITLE',
  '_AUDIO_CACHE_CLEAR_CONFIRM_DESCRIPTION',
  '_AUDIO_CACHE_CLEAR_CONFIRM_ACTION',
  '_AUDIO_CACHE_DELETE_TRACK',
  '_AUDIO_CACHE_DELETE_TRACK_CONFIRM_TITLE',
  '_AUDIO_CACHE_DELETE_TRACK_CONFIRM_DESCRIPTION',
  '_AUDIO_CACHE_DELETE_TRACK_CONFIRM_ACTION',
];

function occurrences(value, pattern) {
  return (value.match(pattern) || []).length;
}

assert.strictEqual(
  occurrences(html, /data-desktop-audio-cache-settings/g),
  2,
  'classic and modern settings layouts must both expose audio cache controls'
);
assert.strictEqual(
  occurrences(html, /data-desktop-lyric-persistence/g),
  2,
  'classic and modern settings layouts must both explain lyric persistence'
);
assert.strictEqual(
  occurrences(html, /data-audio-cache-default-capacity="2147483648"/g),
  2,
  'both layouts must declare the 2 GB default cache capacity'
);
assert.strictEqual(
  occurrences(html, /data-audio-cache-default-enabled="true"/g),
  2,
  'both layouts must declare caching enabled by default'
);
assert.strictEqual(
  occurrences(html, /data-audio-cache-clear-confirm/g),
  2,
  'clearing audio cache must use the existing in-app dialog in both layouts'
);
assert.strictEqual(
  occurrences(html, /data-track-local-data-delete-confirm/g),
  2,
  'deleting the current track data must require an in-app confirmation'
);
assert.match(html, /ng-show="dialog_type==15 && !isChrome"/);
assert.match(html, /ng-show="dialog_type==16 && !isChrome"/);
assert.match(html, /ng-model="audioCacheSettings\.enabled"/);
assert.strictEqual(
  occurrences(
    html,
    /ng-model="audioCacheSettings\.loudnessNormalizationEnabled"/g
  ),
  2,
  'classic and modern settings layouts must both expose normalization controls'
);
assert.strictEqual(
  occurrences(html, /data-audio-cache-default-loudness-normalization="true"/g),
  2,
  'both layouts must declare normalization enabled by default'
);
assert.match(html, /ng-model="audioCacheSettings\.capacityBytes"/);
assert.match(
  html,
  /ng-options="option\.value as option\.label for option in audioCacheCapacityOptions"/
);
assert.match(html, /ng-click="refreshAudioCacheStatus\(\)"/);
assert.match(html, /ng-change="updateAudioCacheEnabled\(\)"/);
assert.match(html, /ng-change="updateAudioCacheCapacity\(\)"/);
assert.match(html, /ng-change="updateLoudnessNormalizationEnabled\(\)"/);
assert.strictEqual(
  occurrences(html, /\{\{loudnessNormalizationStatus\(\)\}\}/g),
  2,
  'both settings layouts must show loudness analysis status while enabled'
);
assert.strictEqual(
  occurrences(
    html,
    /ng-if="audioCacheSettings\.loudnessNormalizationEnabled !== false"/g
  ),
  2,
  'loudness analysis status must not be shown while normalization is disabled'
);
assert.match(html, /ng-click="requestClearAudioCache\(\)"/);
assert.match(html, /ng-click="confirmClearAudioCache\(\)"/);
assert.match(html, /ng-click="cancelClearAudioCache\(\)"/);
assert.match(html, /ng-click="requestDeleteCurrentTrackLocalData\(\)"/);
assert.match(html, /ng-click="confirmDeleteCurrentTrackLocalData\(\)"/);
assert.match(html, /ng-click="cancelDeleteCurrentTrackLocalData\(\)"/);
assert.strictEqual(
  occurrences(html, /ng-disabled="audioCacheActionPending"/g) >= 12,
  true,
  'cache controls and both confirmation dialogs must disable while an action is pending'
);

const allIds = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
const duplicateIds = allIds.filter((id, index) => allIds.indexOf(id) !== index);
assert.strictEqual(
  duplicateIds.filter(
    (id) => id.includes('audio-cache') || id.includes('track-local-data')
  ).length,
  0,
  'new audio cache and local-data dialog IDs must be unique across duplicate layouts'
);
assert.match(css, /\.audio-cache-settings/);
assert.match(css, /\.loudness-normalization-description/);
assert.match(
  playController,
  /loudnessReadyEntries[\s\S]*?loudnessPendingEntries[\s\S]*?loudnessFailedEntries/,
  'the status summary must bind all core loudness counters'
);
assert.match(
  playController,
  /AUDIO_CACHE_STATUS_POLL_MS\s*=\s*2000/,
  'loudness progress must refresh every two seconds while work remains'
);
assert.match(
  playController,
  /scheduleAudioCacheStatusPoll[\s\S]*?loudnessPendingEntries[\s\S]*?\$timeout/,
  'automatic refresh must be driven by the pending analysis count'
);
assert.match(
  playController,
  /\$scope\.\$on\('\$destroy'[\s\S]*?cancelAudioCacheStatusPoll\(\)/,
  'automatic refresh must be cancelled when the controller is destroyed'
);
assert.match(css, /@media \(max-width: 520px\)/);
assert.match(
  playController,
  /requestClearAudioCache[\s\S]*?showDialog\(15\)/,
  'clear request must open an application dialog'
);
assert.match(
  playController,
  /confirmClearAudioCache[\s\S]*?if \(\$scope\.audioCacheActionPending\) return;[\s\S]*?audioCacheActionPending = true/,
  'clear confirmation must accept the first click and reject duplicate clicks'
);
assert.match(
  playController,
  /confirmDeleteCurrentTrackLocalData[\s\S]*?if \(!track \|\| !track\.id \|\| \$scope\.audioCacheActionPending\) return;[\s\S]*?audioCacheActionPending = true/,
  'track deletion confirmation must accept the first click and reject duplicate clicks'
);

fs.readdirSync(path.join(extensionRoot, 'i18n'))
  .filter((file) => file.endsWith('.json'))
  .forEach((file) => {
    const translations = JSON.parse(
      fs.readFileSync(path.join(extensionRoot, 'i18n', file), 'utf8')
    );
    expectedI18nKeys.forEach((key) => {
      assert.strictEqual(
        typeof translations[key],
        'string',
        `${file} must include ${key}`
      );
      assert.ok(
        translations[key].trim(),
        `${file} must not leave ${key} blank`
      );
    });
  });

// eslint-disable-next-line no-console
console.log('Desktop cache settings UI contract passed.');
