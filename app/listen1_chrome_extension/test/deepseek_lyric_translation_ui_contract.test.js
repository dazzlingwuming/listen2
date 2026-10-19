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
assert.match(playSource, /secureStorageAvailable:\s*null/);
assert.doesNotMatch(
  htmlSource,
  /ng-if="!machineTranslationConfig\.secureStorageAvailable"/
);
assert.strictEqual(
  (
    htmlSource.match(
      /ng-if="machineTranslationConfig\.secureStorageAvailable === false"/g
    ) || []
  ).length,
  2,
  'unknown secure storage must not display an unavailable error in either settings layout'
);
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
assert.strictEqual(
  (htmlSource.match(/ng-click="saveMachineTranslationStyle\(\)"/g) || [])
    .length,
  2,
  'classic and modern settings need a save action next to the style editor'
);
assert.strictEqual(
  (htmlSource.match(/ng-click="saveMachineTranslationApiKey\(\)"/g) || [])
    .length,
  2,
  'API key save must remain a separate action in both settings layouts'
);
assert.doesNotMatch(htmlSource, /ng-click="saveMachineTranslationConfig\(\)"/);
const styleSaveHandler = playSource.slice(
  playSource.indexOf('$scope.saveMachineTranslationStyle = () =>'),
  playSource.indexOf('$scope.restoreDefaultMachineTranslationStyle = () =>')
);
const apiKeySaveHandler = playSource.slice(
  playSource.indexOf('$scope.saveMachineTranslationApiKey = () =>'),
  playSource.indexOf('$scope.saveMachineTranslationStyle = () =>')
);
assert.match(styleSaveHandler, /includeApiKey:\s*false/);
assert.match(styleSaveHandler, /includeStyleHint:\s*true/);
assert.match(apiKeySaveHandler, /includeApiKey:\s*true/);
assert.match(apiKeySaveHandler, /includeStyleHint:\s*false/);
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
      '_MACHINE_TRANSLATION_SAVE_STYLE',
      '_MACHINE_TRANSLATION_STYLE_SAVED',
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

async function verifyTranslationSettingsPendingLock() {
  const queue = [];
  const notices = [];
  let testCalls = 0;
  let resolveTest;
  const scope = {
    machineTranslationConfig: { apiKeyInput: 'mock-key', styleHint: '' },
    machineTranslationConfigPending: false,
    $evalAsync(callback) {
      queue.push(callback);
    },
  };
  const context = {
    $scope: scope,
    isElectron: () => true,
    i18next: { t: (key) => key },
    notyf: { error: (message) => notices.push(message), success() {} },
    MediaService: {
      setMachineTranslationConfig: async () => ({
        ok: true,
        config: { hasApiKey: true },
      }),
      testMachineTranslationConfig() {
        testCalls += 1;
        return new Promise((resolve) => {
          resolveTest = resolve;
        });
      },
    },
  };
  const testAction = playSource.slice(
    playSource.indexOf('    $scope.testMachineTranslationConfig ='),
    playSource.indexOf('    $scope.loadLocalSettings =')
  );
  vm.runInNewContext(
    [
      functionBody('getMachineTranslationErrorMessage'),
      functionBody('applyMachineTranslationConfigResponse'),
      functionBody('saveMachineTranslationConfig'),
      testAction,
      'globalThis.getError = getMachineTranslationErrorMessage;',
    ].join('\n'),
    context
  );
  scope.testMachineTranslationConfig();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.strictEqual(testCalls, 1);
  queue.splice(0).forEach((callback) => callback());
  assert.strictEqual(
    scope.machineTranslationConfigPending,
    true,
    'delayed save digest must not unlock the in-flight connection test'
  );
  scope.testMachineTranslationConfig();
  assert.strictEqual(
    testCalls,
    1,
    'repeat clicks must not start another request'
  );
  resolveTest({ ok: false, status: 'unexpected-test-result' });
  await Promise.resolve();
  queue.splice(0).forEach((callback) => callback());
  assert.strictEqual(scope.machineTranslationConfigPending, false);
  assert.match(notices[0], /_MACHINE_TRANSLATION_TEST_RESULT_FAILED/);
  assert.match(
    context.getError('request-timeout', 'test'),
    /_MACHINE_TRANSLATION_TEST_TIMEOUT/
  );
  assert.match(
    context.getError('request-timeout'),
    /_MACHINE_TRANSLATION_TIMEOUT/
  );
  for (const unsafeStatus of [
    'secret-provider-message',
    '__proto__',
    'constructor',
  ]) {
    assert.match(
      context.getError(unsafeStatus),
      /_MACHINE_TRANSLATION_FAILED \[request-failed\]/
    );
  }
  for (const [status, key] of Object.entries({
    'empty-content': 'EMPTY_CONTENT',
    refused: 'REFUSED',
    'invalid-response-json': 'RESPONSE_JSON_FAILED',
    'invalid-json': 'MODEL_JSON_FAILED',
    'invalid-response': 'INVALID_RESPONSE',
    'invalid-alignment': 'ALIGNMENT_FAILED',
    'unexpected-finish-reason': 'FINISH_FAILED',
  })) {
    assert.match(
      context.getError(status),
      new RegExp(`_MACHINE_TRANSLATION_${key}`)
    );
  }
}

verifyTranslationSettingsPendingLock().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
