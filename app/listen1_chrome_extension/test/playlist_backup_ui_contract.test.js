/* eslint-env node */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'listen1.html'), 'utf8');
const navigation = fs.readFileSync(
  path.join(root, 'js', 'controller', 'navigation.js'),
  'utf8'
);

const backupScriptIndex = html.indexOf('src="js/playlist_backup.js"');
const githubScriptIndex = html.indexOf('src="js/github.js"');
const navigationScriptIndex = html.indexOf('src="js/controller/navigation.js"');
assert(backupScriptIndex >= 0, 'playlist backup engine must be loaded');
assert(
  backupScriptIndex < githubScriptIndex &&
    githubScriptIndex < navigationScriptIndex,
  'playlist backup engine must load before Gist and navigation consumers'
);

assert.match(navigation, /createBackup\(localStorage\)/);
assert.match(navigation, /importBackup\(\s*localStorage,\s*data,\s*\{\s*mode,/);
assert.doesNotMatch(
  navigation,
  /Object\.keys\(localStorage\)/,
  'playlist export must not snapshot all local storage'
);
assert.doesNotMatch(
  navigation,
  /localStorage\.setObject\(item,/,
  'playlist import must not write arbitrary backup keys'
);
assert.doesNotMatch(
  navigation,
  /window\.confirm|\bconfirm\(/,
  'replace must use the in-app confirmation dialog'
);
assert.match(navigation, /preparePlaylistBackupReplace\(data,/);
assert.match(navigation, /importPlaylistBackup\(pending\.data, 'replace'\)/);
assert.match(navigation, /MAX_BACKUP_BYTES/);
assert.match(navigation, /BACKUP_ROLLBACK_FAILED/);
assert.match(navigation, /\.gist2json\(raw\)/);
assert.match(navigation, /\.finally\(\(\) =>/);

assert.strictEqual(
  (html.match(/data-playlist-backup-replace-confirm/g) || []).length,
  2,
  'classic and modern layouts must both expose an in-app replace confirmation'
);
assert.strictEqual(
  (html.match(/data-backup-import-mode="merge"/g) || []).length,
  2
);
assert.strictEqual(
  (html.match(/data-backup-import-mode="replace"/g) || []).length,
  2
);

const fileInputIds = [...html.matchAll(/id="(my-file-selector-[^"]+)"/g)].map(
  (match) => match[1]
);
assert.strictEqual(fileInputIds.length, 4);
assert.strictEqual(new Set(fileInputIds).size, 4);

['en-US', 'fr-FR', 'ko-KR', 'pt-BR', 'zh-CN', 'zh-TC'].forEach((language) => {
  const translations = JSON.parse(
    fs.readFileSync(path.join(root, 'i18n', `${language}.json`), 'utf8')
  );
  [
    '_RECOVER_OVERWRITE_WARNING',
    '_PLAYLIST_BACKUP_IMPORT_SUMMARY',
    '_PLAYLIST_BACKUP_FILE_TOO_LARGE',
    '_PLAYLIST_BACKUP_PARTIAL_WRITE_FAILURE',
  ].forEach((key) => {
    assert.strictEqual(typeof translations[key], 'string');
    assert(translations[key].length > 0);
  });
});

// eslint-disable-next-line no-console
console.log('Playlist backup UI contract passed.');
