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
const controller = fs.readFileSync(
  path.join(extensionRoot, 'js', 'controller', 'play.js'),
  'utf8'
);

const presetIds = [
  'original',
  'clear-vocals',
  'deep-bass',
  'airy',
  'warm',
  'hifi-live',
  'immersive-3d',
  'night',
];
const translationKeys = [
  '_AUDIO_EFFECT_TITLE',
  '_AUDIO_EFFECT_DESCRIPTION',
  '_AUDIO_EFFECT_PRESET_LABEL',
  '_AUDIO_EFFECT_PRESET_ORIGINAL',
  '_AUDIO_EFFECT_PRESET_ORIGINAL_DESCRIPTION',
  '_AUDIO_EFFECT_PRESET_CLEAR_VOCALS',
  '_AUDIO_EFFECT_PRESET_CLEAR_VOCALS_DESCRIPTION',
  '_AUDIO_EFFECT_PRESET_DEEP_BASS',
  '_AUDIO_EFFECT_PRESET_DEEP_BASS_DESCRIPTION',
  '_AUDIO_EFFECT_PRESET_AIRY',
  '_AUDIO_EFFECT_PRESET_AIRY_DESCRIPTION',
  '_AUDIO_EFFECT_PRESET_WARM',
  '_AUDIO_EFFECT_PRESET_WARM_DESCRIPTION',
  '_AUDIO_EFFECT_PRESET_HIFI_LIVE',
  '_AUDIO_EFFECT_PRESET_HIFI_LIVE_DESCRIPTION',
  '_AUDIO_EFFECT_PRESET_IMMERSIVE_3D',
  '_AUDIO_EFFECT_PRESET_IMMERSIVE_3D_DESCRIPTION',
  '_AUDIO_EFFECT_PRESET_NIGHT',
  '_AUDIO_EFFECT_PRESET_NIGHT_DESCRIPTION',
  '_AUDIO_EFFECT_HEADPHONE_HINT',
  '_AUDIO_EFFECT_ACTIVE_STATUS',
  '_AUDIO_EFFECT_ORIGINAL_STATUS',
  '_AUDIO_EFFECT_COMPARE_ORIGINAL',
  '_AUDIO_EFFECT_RESTORE',
  '_AUDIO_EFFECT_UNSUPPORTED',
  '_AUDIO_EFFECT_UNAVAILABLE',
  '_AUDIO_EFFECT_SAVE_FAILED',
  '_AUDIO_EFFECT_INVALID_PRESET',
  '_AUDIO_EFFECT_DEGRADED',
];

function occurrences(value, pattern) {
  return (value.match(pattern) || []).length;
}

assert.strictEqual(
  occurrences(html, /data-audio-effects-settings/g),
  2,
  'classic and modern settings layouts must expose the real effect controls'
);
assert.strictEqual(
  occurrences(html, /data-audio-effects-popover/g),
  2,
  'classic and modern player docks must expose an effect picker'
);
assert.strictEqual(
  occurrences(
    html,
    /ng-repeat="preset in audioEffectPresets track by preset\.id"/g
  ),
  4,
  'both settings and both popovers must render their preset lists from one model'
);
assert.match(html, /compareAudioEffectWithOriginal\(\)/);
assert.match(html, /_AUDIO_EFFECT_HEADPHONE_HINT/);

presetIds.forEach((presetId) => {
  assert.match(
    controller,
    new RegExp(`id: '${presetId}'`),
    `${presetId} must be a controller-backed preset`
  );
});

assert.match(controller, /Listen1AudioAnalysis\.setEffectPreset/);
assert.match(controller, /Listen1AudioAnalysis\.getEffectState/);
assert.match(
  controller,
  /AUDIO_EFFECT_STORAGE_KEY\s*=\s*'listen2-audio-effect-settings'/
);
assert.match(controller, /localStorage\.setObject\(AUDIO_EFFECT_STORAGE_KEY/);
assert.match(controller, /localStorage\.getObject\(AUDIO_EFFECT_STORAGE_KEY/);
assert.match(controller, /\$scope\.restoreStoredAudioEffect\(\);/);
assert.match(
  controller,
  /compareAudioEffectWithOriginal[\s\S]*?selectAudioEffectPreset\([\s\S]*?persist:\s*false/,
  'temporary A/B comparison must not overwrite the persisted preference'
);
assert.doesNotMatch(
  html,
  /audio effect strength|audio-effects-strength|_AUDIO_EFFECT_STRENGTH|custom eq|_AUDIO_EFFECT_CUSTOM/i,
  'the UI must not claim controls absent from the renderer API'
);
assert.match(css, /\.audio-effects-popover/);
assert.match(css, /\.audio-effects-preset-grid/);
assert.match(css, /@media \(max-width: 620px\)/);

fs.readdirSync(path.join(extensionRoot, 'i18n'))
  .filter((file) => file.endsWith('.json'))
  .forEach((file) => {
    const translations = JSON.parse(
      fs.readFileSync(path.join(extensionRoot, 'i18n', file), 'utf8')
    );
    translationKeys.forEach((key) => {
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
console.log('Audio effects UI contract passed.');
