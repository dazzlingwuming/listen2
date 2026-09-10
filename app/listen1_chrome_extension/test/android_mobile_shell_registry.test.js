/* eslint-env node */
/* eslint-disable no-console */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const frontendRoot = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(frontendRoot, 'listen1.html'), 'utf8');
const gradle = fs.readFileSync(
  path.join(frontendRoot, '../../android/app/build.gradle'),
  'utf8'
);

function scriptIndex(filename) {
  const marker = `src="${filename}"`;
  const index = html.indexOf(marker);
  assert.notStrictEqual(index, -1, `missing ${filename}`);
  return index;
}

function run() {
  const registry = scriptIndex('js/mobile_provider_registry.js');
  [
    'js/provider/netease.js',
    'js/provider/kugou.js',
    'js/provider/kuwo.js',
    'js/provider/qq.js',
    'js/provider/bilibili.js',
  ].forEach((provider) => assert(scriptIndex(provider) < registry));
  [
    'js/loweb.js',
    'js/app.js',
    'js/controller/navigation.js',
    'js/controller/instant_search.js',
  ].forEach((consumer) => assert(registry < scriptIndex(consumer)));

  const includes = gradle.match(/^\s*include\s+'([^']+)'/gm) || [];
  assert.strictEqual(
    includes.filter(
      (line) => line === "        include 'js/mobile_provider_registry.js'"
    ).length,
    1
  );
  assert.strictEqual(gradle.includes("include 'js/**'"), false);
  assert.strictEqual(gradle.includes("include 'test/**'"), false);
  assert.strictEqual(gradle.includes("include 'package.json'"), false);
  console.log('Android mobile shell registry manifest contract passed');
}

run();
