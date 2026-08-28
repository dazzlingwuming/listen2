/* eslint-env node */
/* eslint-disable no-console */
/* eslint-disable no-cond-assign, no-continue, no-useless-escape, no-underscore-dangle */

// This is intentionally a contract test rather than a browser snapshot test.
// The cache library is rendered twice in listen1.html (classic and modern
// themes), so stable data-* markers make the contract readable without
// coupling it to incidental indentation or translated copy.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const extensionRoot = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(extensionRoot, 'listen1.html'), 'utf8');
const navigation = fs.readFileSync(
  path.join(extensionRoot, 'js', 'controller', 'navigation.js'),
  'utf8'
);
const play = fs.readFileSync(
  path.join(extensionRoot, 'js', 'controller', 'play.js'),
  'utf8'
);
const loweb = fs.readFileSync(
  path.join(extensionRoot, 'js', 'loweb.js'),
  'utf8'
);
const css = fs
  .readdirSync(path.join(extensionRoot, 'css'))
  .filter((file) => file.endsWith('.css'))
  .map((file) => fs.readFileSync(path.join(extensionRoot, 'css', file), 'utf8'))
  .join('\n');

const failures = [];
const completedChecks = [];

function check(name, callback) {
  try {
    callback();
    completedChecks.push({ name, ok: true });
  } catch (error) {
    completedChecks.push({ name, ok: false });
    failures.push(`${name}: ${error.message}`);
  }
}

function countMatches(value, pattern) {
  return (value.match(pattern) || []).length;
}

function openingTagsWithMarker(source, marker) {
  const escapedMarker = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    `<([a-z][\\w:-]*)\\b(?=[^>]*\\b${escapedMarker}(?=\\s|=|>|/))[^>]*>`,
    'gi'
  );
  return [...source.matchAll(pattern)].map((match) => ({
    tagName: match[1].toLowerCase(),
    source: match[0],
    index: match.index,
  }));
}

// Return one complete element for a marker. This small tag matcher is enough
// for the static Angular template and avoids introducing a DOM dependency.
function elementForOpeningTag(source, match) {
  if (!match) return '';
  const startTagEnd = source.indexOf('>', match.index) + 1;
  if (startTagEnd <= 0) return '';
  const tagPattern = new RegExp(`<\\/?${match.tagName}\\b[^>]*>`, 'gi');
  tagPattern.lastIndex = startTagEnd;
  let depth = 1;
  let token;
  while ((token = tagPattern.exec(source))) {
    const tokenSource = token[0];
    if (/^<\//.test(tokenSource)) {
      depth -= 1;
    } else if (!/\/\s*>$/.test(tokenSource)) {
      depth += 1;
    }
    if (depth === 0) {
      return source.slice(match.index, token.index + tokenSource.length);
    }
  }
  return source.slice(match.index);
}

function elementForMarker(source, marker, occurrence = 0) {
  return elementForOpeningTag(
    source,
    openingTagsWithMarker(source, marker)[occurrence]
  );
}

function elementsForMarker(source, marker) {
  return openingTagsWithMarker(source, marker).map((_, index) =>
    elementForMarker(source, marker, index)
  );
}

function elementsForClass(source, className) {
  const matches = [];
  const pattern = /<([a-z][\w:-]*)\b[^>]*>/gi;
  let match;
  while ((match = pattern.exec(source))) {
    const classAttribute = /\bclass\s*=\s*["']([^"']*)["']/i.exec(match[0]);
    if (!classAttribute) continue;
    if (!classAttribute[1].split(/\s+/).includes(className)) continue;
    matches.push(
      elementForOpeningTag(source, {
        tagName: match[1].toLowerCase(),
        source: match[0],
        index: match.index,
      })
    );
  }
  return matches;
}

function mediaBlocksContaining(source, needle) {
  const blocks = [];
  const mediaStart = /@media\s*\([^)]*\)\s*\{/gi;
  let match;
  while ((match = mediaStart.exec(source))) {
    let depth = 1;
    let cursor = match.index + match[0].length;
    while (cursor < source.length && depth > 0) {
      if (source[cursor] === '{') depth += 1;
      if (source[cursor] === '}') depth -= 1;
      cursor += 1;
    }
    const block = source.slice(match.index, cursor);
    if (block.includes(needle)) blocks.push(block);
    mediaStart.lastIndex = cursor;
  }
  return blocks;
}

function functionBody(source, functionName) {
  const declaration = new RegExp(
    `(?:function\\s+${functionName}\\s*\\([^)]*\\)|\\b${functionName}\\s*=\\s*\\([^)]*\\)\\s*=>)\\s*\\{`,
    'm'
  );
  const match = declaration.exec(source);
  if (!match) return '';
  const bodyStart = match.index + match[0].length;
  let depth = 1;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(bodyStart, index);
  }
  return source.slice(bodyStart);
}

const libraryPages = elementsForMarker(html, 'data-audio-cache-library-page');
const settingsBlocks = elementsForMarker(
  html,
  'data-desktop-audio-cache-settings'
);
const sidebarEntries = openingTagsWithMarker(
  html,
  'data-audio-cache-library-entry'
);

check('classic and modern sidebars expose one cache-library entry each', () => {
  assert.strictEqual(
    sidebarEntries.length,
    2,
    'expected exactly two data-audio-cache-library-entry markers'
  );
  sidebarEntries.forEach((entry) => {
    assert.match(entry.source, /ng-if\s*=\s*"[^"]*!isChrome[^\"]*"/);
    assert.match(
      entry.source,
      /ng-if\s*=\s*"[^"]*audioCacheSettings\.supported[^\"]*"/
    );
    assert.match(entry.source, /ng-click\s*=\s*"showAudioCache\(\)"/);
  });
});

check('cache-library navigation uses the internal audio_cache URL', () => {
  assert.match(
    navigation,
    /(?:const|let|var)\s+url\s*=\s*['"]\/audio_cache['"]/
  );
  assert.match(navigation, /url\s*===\s*['"]\/audio_cache['"]/);
  assert.match(navigation, /window_type\s*=\s*['"]audio_cache['"]/);
  assert.match(
    navigation,
    /showAudioCache[\s\S]*?refreshAudioCacheInventory\(\)/
  );
});

check('classic and modern bodies each render the library page', () => {
  assert.strictEqual(
    libraryPages.length,
    2,
    'expected one data-audio-cache-library-page per theme'
  );
  const classicBody = elementsForClass(html, 'body')[0];
  const modernBody = elementsForClass(html, 'modern-body')[0];
  assert.ok(classicBody.includes('data-audio-cache-library-page'));
  assert.ok(modernBody.includes('data-audio-cache-library-page'));
  libraryPages.forEach((page) => {
    assert.match(page, /!isChrome/);
    assert.match(page, /audioCacheSettings\.supported/);
  });
});

check('each library page has total, space and refresh summaries', () => {
  assert.strictEqual(
    countMatches(html, /audioCacheManager\.entries\.length/g),
    2,
    'total track count must be rendered in both library pages'
  );
  libraryPages.forEach((page) => {
    assert.match(page, /audioCacheManager\.entries\.length/);
    assert.match(page, /audioCacheSettings\.usedBytes/);
    assert.match(page, /ng-click\s*=\s*"[^"]*refreshAudioCacheInventory\(\)/);
    assert.match(page, /ng-click\s*=\s*"[^"]*refreshAudioCacheStatus\(\)/);
  });
});

check('each library page exposes four semantic filters', () => {
  ['all', 'temporary', 'playlist', 'downloaded'].forEach((filter) => {
    assert.strictEqual(
      countMatches(
        html,
        new RegExp(`audioCacheManager\.filter\s*=\s*['"]${filter}['"]`, 'g')
      ),
      2,
      `${filter} filter must be present in both themes`
    );
  });
  libraryPages.forEach((page) => {
    assert.strictEqual(
      countMatches(page, /data-audio-cache-library-filter\b/g),
      4
    );
    ['all', 'temporary', 'playlist', 'downloaded'].forEach((filter) =>
      assert.match(
        page,
        new RegExp(`audioCacheManager\.filter\s*=\s*['"]${filter}['"]`)
      )
    );
  });
});

check('each library page provides search and sort controls', () => {
  assert.strictEqual(
    countMatches(html, /ng-model\s*=\s*"audioCacheManager\.query"/g),
    2
  );
  assert.strictEqual(
    countMatches(html, /ng-model\s*=\s*"audioCacheManager\.sort"/g),
    2
  );
  libraryPages.forEach((page) => {
    assert.match(page, /ng-model\s*=\s*"audioCacheManager\.query"/);
    assert.match(page, /ng-model\s*=\s*"audioCacheManager\.sort"/);
    assert.match(page, /type\s*=\s*["']search["']/);
  });
});

check(
  'each library page has per-entry play, keep-offline, select and delete actions',
  () => {
    assert.strictEqual(
      countMatches(html, /class=["'][^"']*audio-cache-library-row\b/g),
      2
    );
    assert.strictEqual(
      countMatches(html, /data-audio-cache-library-select\b/g),
      2
    );
    assert.strictEqual(
      countMatches(html, /data-audio-cache-library-play\b/g),
      2
    );
    assert.strictEqual(
      countMatches(html, /data-audio-cache-library-delete\b/g),
      2
    );
    assert.strictEqual(
      countMatches(
        html,
        /ng-click\s*=\s*"setAudioCacheDownloaded\(entry, !entry\.downloaded\)"/g
      ),
      2
    );
    libraryPages.forEach((page) => {
      const rows = elementsForClass(page, 'audio-cache-library-row');
      assert.strictEqual(rows.length, 1);
      assert.match(rows[0], /data-audio-cache-library-select\b/);
      assert.match(rows[0], /data-audio-cache-library-play\b/);
      assert.match(rows[0], /data-audio-cache-library-delete\b/);
      assert.match(
        rows[0],
        /ng-click\s*=\s*"setAudioCacheDownloaded\(entry, !entry\.downloaded\)"/
      );
    });
  }
);

check(
  'each library page supports selection and confirmed batch deletion',
  () => {
    assert.strictEqual(
      countMatches(
        html,
        /ng-click\s*=\s*"requestDeleteSelectedAudioCacheEntries\(\)"/g
      ),
      2,
      'batch deletion must be available in both themes'
    );
    assert.strictEqual(
      countMatches(html, /class=["'][^"']*audio-cache-library-confirm\b/g),
      2,
      'batch deletion must have one confirmation surface per theme'
    );
    libraryPages.forEach((page) => {
      assert.match(
        page,
        /ng-click\s*=\s*"requestDeleteSelectedAudioCacheEntries\(\)"/
      );
      assert.match(page, /class=["'][^"']*audio-cache-library-confirm\b/);
      assert.match(page, /role\s*=\s*["']alertdialog["']/);
    });
  }
);

check('each library page exposes loading, empty and error states', () => {
  assert.strictEqual(
    countMatches(html, /ng-if\s*=\s*"audioCacheManager\.loading"/g),
    2
  );
  assert.strictEqual(
    countMatches(html, /ng-if\s*=\s*"audioCacheManager\.error"/g),
    2
  );
  assert.strictEqual(
    countMatches(html, /class=["'][^"']*audio-cache-inventory-empty\b/g),
    2
  );
  libraryPages.forEach((page) => {
    assert.match(page, /ng-if\s*=\s*"audioCacheManager\.loading"/);
    assert.match(page, /ng-if\s*=\s*"audioCacheManager\.error"/);
    assert.match(page, /class=["'][^"']*audio-cache-inventory-empty\b/);
  });
});

check(
  'settings retain controls and a jump button but no detailed inventory',
  () => {
    assert.strictEqual(
      settingsBlocks.length,
      2,
      'classic and modern settings blocks must remain available'
    );
    settingsBlocks.forEach((settings) => {
      assert.match(settings, /ng-model\s*=\s*"audioCacheSettings\.enabled"/);
      assert.match(
        settings,
        /ng-model\s*=\s*"audioCacheSettings\.capacityBytes"/
      );
      assert.match(settings, /data-audio-cache-library-open\b/);
      [
        'data-audio-cache-library-page',
        'data-audio-cache-library-entry',
        'data-audio-cache-library-filter',
        'data-audio-cache-library-select',
        'data-audio-cache-library-play',
        'data-audio-cache-library-delete',
        'data-audio-cache-manager',
        'data-audio-cache-inventory',
      ].forEach((marker) => {
        assert.strictEqual(
          openingTagsWithMarker(settings, marker).length,
          0,
          `settings must not contain ${marker}`
        );
      });
    });
  }
);

check('Chrome cannot render or navigate to the cache library', () => {
  openingTagsWithMarker(html, 'data-audio-cache-library-page').forEach(
    (tag) => {
      assert.match(tag.source, /!isChrome/);
      assert.match(tag.source, /audioCacheSettings\.supported/);
    }
  );
  openingTagsWithMarker(html, 'data-audio-cache-library-entry').forEach(
    (tag) => {
      assert.match(tag.source, /!isChrome/);
      assert.match(tag.source, /audioCacheSettings\.supported/);
    }
  );
  assert.match(navigation, /showAudioCache[\s\S]*?isElectron\(\)/);
});

check('cache actions are implemented by the desktop controller', () => {
  [
    'refreshAudioCacheInventory',
    'visibleAudioCacheEntries',
    'setAudioCacheDownloaded',
    'playAudioCacheEntry',
    'requestDeleteAudioCacheEntries',
    'requestDeleteSelectedAudioCacheEntries',
    'confirmDeleteAudioCacheEntries',
    'cancelDeleteAudioCacheEntries',
  ].forEach((name) => {
    assert.match(play, new RegExp(`\\$scope\\.${name}\\s*=`));
  });
  assert.match(play, /MediaService\.listAudioCache\(\)/);
  assert.match(play, /MediaService\.setAudioCacheRetention/);
  assert.match(play, /MediaService\.deleteAudioCacheEntry/);
  assert.match(play, /deleteConfirmationOpen\s*=\s*true/);
});

check('all four filters are applied by the visible-entry behavior', () => {
  const body = functionBody(play, 'visibleAudioCacheEntries');
  ['all', 'temporary', 'playlist', 'downloaded'].forEach((filter) => {
    assert.match(body, new RegExp(`['"]${filter}['"]`));
  });
  assert.match(body, /audioCacheManager\.query/);
  assert.match(
    body,
    /(?:audioCacheManager\.sort|const\s*\{\s*sort\s*\}\s*=\s*\$scope\.audioCacheManager)/
  );
});

check('play buttons disable entries without a playable identity', () => {
  const playButtons = openingTagsWithMarker(
    html,
    'data-audio-cache-library-play'
  );
  assert.strictEqual(playButtons.length, 2);
  playButtons.forEach((button) => {
    assert.match(
      button.source,
      /ng-disabled\s*=\s*["'][^"']*(?:entry\.playable|AudioCacheEntryPlayable|audioCacheEntryPlayable)[^"']*["']/i,
      'a cache item without a playable identity must be disabled'
    );
  });
  const playBody = functionBody(play, 'playAudioCacheEntry');
  assert.match(playBody, /entry\.playable\s*!==\s*true/);
  assert.match(playBody, /getAudioCachePlayableTrack/);
});

check(
  'playback descriptions are constrained to safe Bilibili bitrack identities',
  () => {
    assert.match(loweb, /function\s+getAudioCachePlayableTrack/);
    const body = functionBody(loweb, 'getAudioCachePlayableTrack');
    assert.match(body, /bitrack_/);
    assert.match(body, /playableTrack\.source\s*!==\s*['"]bilibili['"]/);
    assert.match(body, /return\s+null/);
    [
      'file://',
      'signedUrl',
      'signed_url',
      'entry.path',
      'entry.filePath',
    ].forEach((unsafe) => assert.doesNotMatch(body, new RegExp(unsafe, 'i')));
    assert.match(loweb, /getAudioCachePlayableTrack\(entry\)/);
  }
);

check('classic, modern and narrow-window CSS contracts exist', () => {
  assert.match(css, /(?:\.audio-cache-library|\[data-audio-cache-library\])/);
  assert.match(
    css,
    /\.page\s+\.audio-cache-library\b/,
    'classic theme must style the cache library'
  );
  assert.match(
    css,
    /(?:\.modern-body[^{}]*\.audio-cache-library|\.audio-cache-library[^{}]*\.modern-body)/,
    'modern theme must style the cache library'
  );
  assert.ok(
    mediaBlocksContaining(css, 'audio-cache-library').some((block) =>
      /max-width\s*:\s*\d+px/.test(block)
    ),
    'a max-width media block must adapt the cache library for narrow windows'
  );
});

function loadMediaService() {
  const provider = {};
  const context = {
    URLSearchParams,
    Promise,
    Object,
    Number,
    String,
    JSON,
    Date,
    console,
    async: {},
    netease: provider,
    xiami: provider,
    qq: provider,
    kugou: provider,
    kuwo: provider,
    bilibili: provider,
    migu: provider,
    taihe: provider,
    localmusic: provider,
    myplaylist: provider,
    localStorage: { getObject: () => null },
    LRUCache: class LRUCache {},
    setPrototypeOfLocalStorage() {},
    getLocalStorageValue() {},
    isElectron: () => false,
  };
  vm.createContext(context);
  vm.runInContext(`${loweb}\nthis.__mediaService = MediaService;`, context, {
    filename: path.join(extensionRoot, 'js', 'loweb.js'),
  });
  return context.__mediaService;
}

check(
  'playable-track behavior rejects unsafe and preserves safe identities',
  () => {
    const mediaService = loadMediaService();
    const audio = mediaService.getAudioCachePlayableTrack({
      playableTrack: { id: 'bitrack_123', source: 'bilibili' },
      title: 'Audio cache item',
      artist: 'Bilibili',
      coverUrl: 'file:///private/cache/cover.jpg',
      duration: 12,
    });
    assert.deepStrictEqual(JSON.parse(JSON.stringify(audio)), {
      id: 'bitrack_123',
      source: 'bilibili',
      title: 'Audio cache item',
      artist: 'Bilibili',
      img_url: '',
      duration: 12,
      source_url: 'https://www.bilibili.com/audio/au123',
    });
    assert.strictEqual(
      mediaService.getAudioCachePlayableTrack({
        playableTrack: { id: 'bitrack_123', source: 'netease' },
      }),
      null,
      'a non-Bilibili identity must not be guessed into a playable track'
    );
    assert.strictEqual(
      mediaService.getAudioCachePlayableTrack({
        playableTrack: { id: 'local-file', source: 'bilibili' },
        url: 'file:///private/cache/audio.m4s',
      }),
      null,
      'a cache path or URL cannot substitute for a Bilibili identity'
    );
    assert.strictEqual(
      mediaService.getAudioCachePlayableTrack({
        playableTrack: { id: 'bitrack_v_BV1ab411c7mD', source: 'bilibili' },
      }),
      null,
      'a video identity without a CID must remain disabled'
    );
  }
);

console.log(
  `Audio cache library contract: ${
    completedChecks.filter((checkResult) => checkResult.ok).length
  }/${completedChecks.length} checks passed.`
);
if (failures.length) {
  console.error('\nExpected gaps or contract failures:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exitCode = 1;
} else {
  console.log('Audio cache library UI contract passed.');
}
