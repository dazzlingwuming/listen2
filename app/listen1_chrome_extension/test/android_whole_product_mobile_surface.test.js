/* eslint-env node */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), 'utf8');

const html = read('listen1.html');
const css = read('css/redesign.css');
const navigation = read('js/controller/navigation.js');
const auth = read('js/controller/auth.js');
const profile = read('js/controller/profile.js');
const play = read('js/controller/play.js');
const instantSearch = read('js/controller/instant_search.js');

[
  'mobile-product-home',
  'mobile-product-discover',
  'mobile-product-settings',
  'mobile-product-sheet',
  'mobile-library-hub-capabilities',
  '本机音乐库',
  '本地音乐与授权修复',
  '账户与哔哩哔哩登录',
  '高级音质、MV/PiP、音效、可视化与响度功能会按 native capability 单独启用',
].forEach((marker) =>
  assert.ok(html.includes(marker), `phone product surface missing ${marker}`)
);

[
  "openMobileCapability('history')",
  "openMobileCapability('cache')",
  "openMobileCapability('backup')",
  "openMobileCapability('local')",
  'focusMobileSearch()',
  "openMobileCapability('playlists')",
  "openMobileCapability('favorites')",
  "openMobileCapability('settings')",
  "startMobileSafPicker('saf.pickAudio')",
  "startMobileSafPicker('saf.pickTree')",
].forEach((binding) =>
  assert.ok(html.includes(binding), `reachable phone action missing ${binding}`)
);

[
  'mobileProductPage',
  'openMobileProductPage',
  'closeMobileProductPage',
  'focusMobileSearch',
  'openMobileCapability',
  'refreshMobileCapabilities',
  'loadMobileLocalPage',
  'runMobileLocalCommand',
  'previewMobileBackup',
  'importMobileBackup',
  'startMobileSafPicker',
  'addCurrentTrackToMobilePlaylistDraft',
  'toggleCurrentMobileFavorite',
  'playlist.create',
  'playlist.replace',
  'playlist.delete',
  'playlist.reorder',
  'favorite.set',
  'Android 文件选择与存储 bridge；当前未验证',
  'Android 缓存 bridge；当前未验证',
  'Android account bridge；当前不可用',
  'Android secure-storage bridge；当前不可用',
  'window.Listen2AndroidPlaybackBack',
  'android:search-back',
  'android:close-transient-overlay',
].forEach((marker) =>
  assert.ok(
    navigation.includes(marker),
    `capability-safe navigation missing ${marker}`
  )
);
assert.ok(
  play.includes("$scope.$on('android:close-transient-overlay'"),
  'Android back must close the lyric translation confirmation'
);
[
  'ng-click="saveMachineTranslationApiKey()"',
  'ng-model="machineTranslationConfig.apiKeyInput"',
  'ng-click="saveMachineTranslationStyle()"',
].forEach((marker) =>
  assert.ok(html.includes(marker), `mobile translation setup missing ${marker}`)
);
[
  'history.enable',
  'history.clear',
  'cache.refresh',
  'cache.capacity',
  'settings.update',
  'backup.import',
  '确认覆盖导入',
].forEach((marker) =>
  assert.ok(
    html.includes(marker) || navigation.includes(marker),
    `mobile local-data action missing ${marker}`
  )
);

assert.ok(
  !navigation.includes("window.open(url, '_blank')") ||
    auth.includes('isAndroidTyped()'),
  'Android login path must be guarded before browser login fallback'
);
assert.ok(
  auth.includes('Android 账号与扫码登录 bridge 尚未验证，未发起登录。'),
  'Android account login must have an actionable unavailable result'
);
[
  'startAndroidBilibiliQrLogin',
  'refreshAndroidAccountStatus',
  'scheduleAndroidQrPoll',
  'account.begin',
  'account.poll',
  'account.logout',
].forEach((marker) =>
  assert.ok(auth.includes(marker), `Android QR account flow missing ${marker}`)
);
assert.ok(
  profile.includes('Android Keystore 安全保存'),
  'translation settings must describe Android secure storage truthfully'
);
assert.ok(
  navigation.includes("$rootScope.$broadcast('android:playback-back'"),
  'Android back must ask native player layers to close before leaving'
);
assert.ok(
  instantSearch.includes("$scope.$on('android:search-back'") &&
    instantSearch.includes('$scope.backFromBilibiliDetail()'),
  'Android back must close Bilibili detail before leaving the Activity'
);
assert.ok(
  html.includes(
    "ng-if=\"(!isChrome || isAndroidSurface()) && currentPlaying.source === 'bilibili'"
  ),
  'Android Bilibili lyrics must expose the DeepSeek retranslation action'
);
assert.ok(
  instantSearch.includes("['netease', 'bilibili'].includes(item.name)") &&
    instantSearch.includes("isAndroidTyped() && $scope.tab === 'bilibili'"),
  'Android search must expose verified sources and honor the selected provider'
);
assert.ok(
  html.includes(
    'ng-if="!isAndroidSurface()"\n                                  class="now-playing-orbit-spectrum"'
  ) &&
    html.includes(
      'ng-if="!isAndroidSurface()"\n                                class="now-playing-spectrum"'
    ),
  'Android must not show WebAudio visualizers without a native analysis capability'
);
assert.ok(
  !html.includes('网易云：路由待验证') &&
    !html.includes('QQ/酷狗/酷我等：当前不可用'),
  'discover primary surface must not be a provider-status explainer'
);
assert.match(
  html,
  /editorial-discovery-page[\s\S]*?ng-if="!isAndroidSurface\(\)"[\s\S]*?ng-controller="PlayListController"/,
  'Android home must not initialize the desktop discovery controller or its CORS-only routes'
);

[
  'height: 100svh',
  'env(safe-area-inset-bottom, 0px)',
  'min-height: 48px',
  'grid-template-columns: repeat(2, minmax(0, 1fr))',
  '@media screen and (max-width: 359px)',
  'prefers-reduced-motion: reduce',
  'overflow-y: auto',
].forEach((marker) =>
  assert.ok(css.includes(marker), `accessible phone layout missing ${marker}`)
);

process.stdout.write('android whole product mobile surface tests passed\n');
