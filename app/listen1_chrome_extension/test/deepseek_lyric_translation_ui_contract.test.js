/* eslint-env node */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const extensionRoot = path.resolve(__dirname, '..');
const playSource = fs.readFileSync(
  path.join(extensionRoot, 'js/controller/play.js'),
  'utf8'
);
const htmlSource = fs.readFileSync(
  path.join(extensionRoot, 'listen1.html'),
  'utf8'
);
const cssSource = fs.readFileSync(
  path.join(extensionRoot, 'css/redesign.css'),
  'utf8'
);

function functionBody(name) {
  const start = playSource.indexOf(`function ${name}(`);
  assert.notStrictEqual(start, -1, `${name} should exist`);
  const nextFunction = playSource.indexOf('\n    function ', start + 1);
  const nextScopeFunction = playSource.indexOf('\n    $scope.', start + 1);
  const end = [nextFunction, nextScopeFunction]
    .filter((index) => index !== -1)
    .sort((left, right) => left - right)[0];
  return playSource.slice(start, end === undefined ? playSource.length : end);
}

function topLevelFunctionSource(name) {
  const start = playSource.indexOf(`function ${name}(`);
  assert.notStrictEqual(start, -1, `${name} should exist`);
  const bodyStart = playSource.indexOf('{', start);
  let depth = 0;
  for (let index = bodyStart; index < playSource.length; index += 1) {
    if (playSource[index] === '{') depth += 1;
    if (playSource[index] === '}') depth -= 1;
    if (depth === 0) return playSource.slice(start, index + 1);
  }
  throw new Error(`Unable to parse ${name}`);
}

const sourceTranslationHelpers = vm.runInThisContext(
  `(() => {
    ${topLevelFunctionSource('hasMeaningfulLyricText')}
    ${topLevelFunctionSource('buildSourceTranslationSnapshot')}
    ${topLevelFunctionSource('restoreSourceTranslationResult')}
    return { buildSourceTranslationSnapshot, restoreSourceTranslationResult };
  })()`
);

const automaticResolver = functionBody('resolveCandidateTranslation');
const confirmationOpener = functionBody('openLyricTranslationConfirmation');
const confirmedRequest = playSource.slice(
  playSource.indexOf('$scope.confirmCurrentLyricTranslation = () =>'),
  playSource.indexOf('\n    function requestTrackLyric(')
);
const retranslateRequest = playSource.slice(
  playSource.indexOf('$scope.requestAiLyricRetranslation = () =>'),
  playSource.indexOf('\n    $scope.restoreSourceLyricTranslation = () =>')
);

assert.match(playSource, /return 'zh-CN';/);
assert.match(automaticResolver, /allowNetwork:\s*false/);
assert.doesNotMatch(automaticResolver, /allowNetwork:\s*true/);
assert.doesNotMatch(confirmationOpener, /machineTranslateLyricCandidate/);
assert.match(confirmedRequest, /allowNetwork:\s*true/);
assert.match(confirmedRequest, /forceRefresh:\s*retranslate/);
assert.match(
  retranslateRequest,
  /openLyricTranslationConfirmation\('retranslate'\)/
);
assert.strictEqual(
  (playSource.match(/allowNetwork:\s*true/g) || []).length,
  1,
  'only the confirmed DeepSeek request may enable network access'
);
assert.match(confirmedRequest, /lyricTranslationRequestToken/);
assert.match(playSource, /resetLyricTranslationConfirmation\(\);/);
assert.doesNotMatch(playSource, /machineTranslationConfig\.enabled/);
assert.match(playSource, /immutableSystemPrompt/);
assert.match(playSource, /promptTemplatePreview/);
assert.doesNotMatch(playSource, /machineTranslationFixedRules/);
[
  'sourceTlyric',
  'sourceTranslationProvider',
  'sourceTranslationEnriched',
  'sourceMachineTranslated',
  'sourceMachineTranslationProvider',
  'sourceMachineTranslationTarget',
  'sourceMachineTranslationDetectedSource',
].forEach((field) => {
  assert(
    (playSource.match(new RegExp(field, 'g')) || []).length >= 2,
    `${field} must survive result/candidate conversion`
  );
});
assert.doesNotMatch(
  htmlSource,
  new RegExp(
    ['openDeep', 'LApiPage|machineTranslationConfig\\.enabled'].join(''),
    'i'
  )
);
assert.match(htmlSource, /lyricTranslationConfirmationAction\(\)/);
assert.match(htmlSource, /ng-if="!isChrome"/);
assert.match(htmlSource, /requestAiLyricRetranslation\(\)/);
assert.match(htmlSource, /restoreSourceLyricTranslation\(\)/);
assert.match(htmlSource, /machineTranslationConfig\.immutableSystemPrompt/);
assert.match(htmlSource, /machineTranslationConfig\.promptTemplatePreview/);
assert.match(
  htmlSource,
  /lyricTranslationSourceSnapshot \|\| currentLyricResult\.sourceTlyric/
);
assert.strictEqual(
  (htmlSource.match(/data-lyric-translation-confirm/g) || []).length,
  2,
  'each mutually exclusive classic/modern root needs one modal'
);
assert.strictEqual(
  (htmlSource.match(/machine-translation-style-label/g) || []).length,
  2,
  'classic and modern settings must expose the same style editor'
);
const modernModalIndex = htmlSource.lastIndexOf(
  'data-lyric-translation-confirm'
);
const modernStageIndex = htmlSource.indexOf(
  'class="songdetail-wrapper now-playing-stage"'
);
assert(
  modernModalIndex < modernStageIndex,
  'the modern confirmation modal must be a root sibling, not inside the stage'
);
assert.match(
  cssSource,
  /\.lyric-translation-confirm-backdrop\s*\{[\s\S]*?z-index:\s*1000/
);
assert.match(cssSource, /\.lyric-translation-confirm\s*\{[\s\S]*?max-height:/);
assert.match(
  cssSource,
  /\.lyric-translation-confirm\s*\{[\s\S]*?overflow-y:\s*auto/
);

const persistentSource =
  sourceTranslationHelpers.buildSourceTranslationSnapshot(
    { id: 'bitrack_v_demo-1' },
    {
      tlyric: '[00:01.00]DeepSeek',
      machineTranslated: true,
      sourceTlyric: '[00:01.00]Catalog',
      sourceTranslationProvider: 'qq',
      sourceTranslationEnriched: true,
      sourceMachineTranslated: false,
    }
  );
assert.deepStrictEqual(persistentSource, {
  trackId: 'bitrack_v_demo-1',
  tlyric: '[00:01.00]Catalog',
  translationProvider: 'qq',
  translationEnriched: true,
  machineTranslated: false,
  machineTranslationProvider: '',
  machineTranslationTarget: '',
  machineTranslationDetectedSource: '',
});
const restoredSource = sourceTranslationHelpers.restoreSourceTranslationResult(
  {
    tlyric: '[00:01.00]DeepSeek',
    machineTranslated: true,
    machineTranslationPromptFingerprint: 'current-fingerprint',
  },
  persistentSource
);
assert.strictEqual(restoredSource.tlyric, '[00:01.00]Catalog');
assert.strictEqual(restoredSource.translationProvider, 'qq');
assert.strictEqual(restoredSource.machineTranslated, false);
assert.strictEqual(restoredSource.machineTranslationPromptFingerprint, '');
assert.strictEqual(
  sourceTranslationHelpers.buildSourceTranslationSnapshot(
    { id: 'bitrack_v_demo-1' },
    { tlyric: '[00:01.00]DeepSeek', machineTranslated: true }
  ),
  null,
  'a machine translation without sourceTlyric must not fabricate a source'
);
assert.strictEqual(
  sourceTranslationHelpers.buildSourceTranslationSnapshot(
    { id: 'bitrack_v_demo-1' },
    { tlyric: '[00:01.00]Catalog', machineTranslated: false }
  ).tlyric,
  '[00:01.00]Catalog',
  'a visible catalog translation remains a valid pre-retranslation snapshot'
);

fs.readdirSync(path.join(extensionRoot, 'i18n'))
  .filter((file) => file.endsWith('.json'))
  .forEach((file) => {
    const contents = fs.readFileSync(
      path.join(extensionRoot, 'i18n', file),
      'utf8'
    );
    assert.doesNotMatch(
      contents,
      new RegExp(['deep', 'l'].join(''), 'i'),
      `${file} must not mention the retired provider`
    );
    const locale = JSON.parse(contents);
    [
      '_MACHINE_TRANSLATION_CONFIRM_TITLE',
      '_MACHINE_TRANSLATION_INVALID_RESPONSE',
      '_MACHINE_TRANSLATION_RETRANSLATE',
      '_MACHINE_TRANSLATION_RETRANSLATE_CONFIRM_TITLE',
      '_MACHINE_TRANSLATION_RETRANSLATE_CONFIRM_ACTION',
      '_MACHINE_TRANSLATION_STYLE_HINT',
      '_MACHINE_TRANSLATION_RESTORE_DEFAULT_STYLE',
      '_MACHINE_TRANSLATION_FIXED_RULES',
      '_MACHINE_TRANSLATION_IMMUTABLE_PROMPT',
      '_MACHINE_TRANSLATION_PROMPT_TEMPLATE',
      '_MACHINE_TRANSLATION_PROMPT_PREVIEW_UNAVAILABLE',
      '_MACHINE_TRANSLATION_PRIVACY_NOTICE',
    ].forEach((key) => assert.ok(locale[key], `${file} must define ${key}`));
  });

// eslint-disable-next-line no-console
console.log('DeepSeek lyric translation UI contract passed.');
