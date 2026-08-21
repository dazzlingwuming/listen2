/* eslint-env node */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const extensionRoot = path.resolve(__dirname, '..');
const playSource = fs.readFileSync(
  path.join(extensionRoot, 'js/controller/play.js'),
  'utf8'
);
const htmlSource = fs.readFileSync(
  path.join(extensionRoot, 'listen1.html'),
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

const automaticResolver = functionBody('resolveCandidateTranslation');
const confirmationOpener = functionBody('openLyricTranslationConfirmation');
const confirmedRequest = playSource.slice(
  playSource.indexOf('$scope.confirmCurrentLyricTranslation = () =>'),
  playSource.indexOf('\n    function requestTrackLyric(')
);

assert.match(playSource, /return 'zh-CN';/);
assert.match(automaticResolver, /allowNetwork:\s*false/);
assert.doesNotMatch(automaticResolver, /allowNetwork:\s*true/);
assert.doesNotMatch(confirmationOpener, /machineTranslateLyricCandidate/);
assert.match(confirmedRequest, /allowNetwork:\s*true/);
assert.strictEqual(
  (playSource.match(/allowNetwork:\s*true/g) || []).length,
  1,
  'only the confirmed DeepSeek request may enable network access'
);
assert.match(confirmedRequest, /lyricTranslationRequestToken/);
assert.match(playSource, /resetLyricTranslationConfirmation\(\);/);
assert.doesNotMatch(playSource, /machineTranslationConfig\.enabled/);
assert.doesNotMatch(
  htmlSource,
  new RegExp(
    ['openDeep', 'LApiPage|machineTranslationConfig\\.enabled'].join(''),
    'i'
  )
);
assert.match(htmlSource, /_MACHINE_TRANSLATION_CONFIRM_ACTION/);
assert.match(htmlSource, /ng-if="!isChrome"/);

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
    assert.match(contents, /_MACHINE_TRANSLATION_CONFIRM_TITLE/);
    assert.match(contents, /_MACHINE_TRANSLATION_INVALID_RESPONSE/);
  });

// eslint-disable-next-line no-console
console.log('DeepSeek lyric translation UI contract passed.');
