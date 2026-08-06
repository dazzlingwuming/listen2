/* eslint-env node */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const {
  extractTimedLyricLines,
  getDeepLEndpoint,
  mapDeepLTargetLanguage,
  translateWholeLyricWithDeepL,
} = require('../../machineTranslation');

function createProvider(options = {}) {
  const filename = path.join(__dirname, '..', 'js', 'provider', 'bilibili.js');
  const source = fs.readFileSync(filename, 'utf8');
  const storage = new Map(Object.entries(options.initialStorage || {}));
  const context = {
    axios: {},
    console,
    DOMParser: class {
      parseFromString(value) {
        this.lastDocument = { body: { textContent: value } };
        return this.lastDocument;
      }
    },
    getParameterByName() {
      return '';
    },
    kuwo: {},
    localStorage: {
      getItem(key) {
        return storage.has(key) ? storage.get(key) : null;
      },
      setItem(key, value) {
        if (options.failSetItem === true) {
          throw new Error('Storage quota exceeded');
        }
        storage.set(key, value);
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(
    `${source}\nthis.BilibiliProviderForTest = bilibili;\nthis.BilibiliLyricCacheForTest = bilibiliLyricCache;`,
    context,
    { filename }
  );
  const provider = context.BilibiliProviderForTest;
  Object.defineProperty(provider, 'storageForTest', {
    value: storage,
  });
  Object.defineProperty(provider, 'lyricCacheForTest', {
    value: context.BilibiliLyricCacheForTest,
  });
  return provider;
}

function createPlayHelpers() {
  const filename = path.join(__dirname, '..', 'js', 'controller', 'play.js');
  const source = fs.readFileSync(filename, 'utf8');
  const context = {
    angular: {
      module() {
        return {
          controller() {},
        };
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(
    `${source}
this.decorateLyricCandidateForTest = decorateLyricCandidate;
this.compareLyricCandidatesForTest = compareLyricCandidates;`,
    context,
    { filename }
  );
  return {
    decorate: context.decorateLyricCandidateForTest,
    compare: context.compareLyricCandidatesForTest,
  };
}

function originalCandidate() {
  return {
    id: 'qq-original',
    provider: 'QQ',
    title: 'Traveling Light',
    artist: 'Joel Hanson',
    album: 'Traveling Light',
    duration: 208,
    lyric: '[00:01.00]Original lyric',
    tlyric: '',
    matchScore: 0.99,
  };
}

function translatedCandidate(score = 0.97) {
  return {
    id: 'netease-translated',
    provider: '网易云',
    title: 'Traveling Light',
    artist: 'Joel Hanson',
    album: 'Traveling Light',
    duration: 209,
    lyric: '[00:01.00]Matched original lyric',
    tlyric: '[00:01.00]匹配的同步译文',
    matchScore: score,
  };
}

async function run() {
  {
    const lyric = [
      '[ar:Joel Hanson]',
      '[00:01.00]Now I am traveling light',
      '[00:05.25]My spirit lifted high',
      '[00:09.00][00:13.00]I found my freedom now',
    ].join('\n');
    const lines = extractTimedLyricLines(lyric);
    assert.strictEqual(lines.length, 3);
    assert.strictEqual(lines[2].timestamps, '[00:09.00][00:13.00]');

    let requestCount = 0;
    let requestBody = null;
    const result = await translateWholeLyricWithDeepL({
      apiKey: 'test-key:fx',
      lyric,
      targetLanguage: 'zh-CN',
      title: 'Traveling Light',
      artist: 'Joel Hanson',
      fetchImpl: async (url, options) => {
        requestCount += 1;
        requestBody = JSON.parse(options.body);
        assert.strictEqual(url, 'https://api-free.deepl.com/v2/translate');
        return {
          ok: true,
          async json() {
            return {
              translations: [
                {
                  detected_source_language: 'EN',
                  billed_characters: 82,
                  text: [
                    '<lyrics>',
                    '<line id="0">现在我轻装前行</line>',
                    '<line id="1">我的精神振翅高飞</line>',
                    '<line id="2">如今我找到了自由</line>',
                    '</lyrics>',
                  ].join('\n'),
                },
              ],
            };
          },
        };
      },
    });
    assert.strictEqual(
      requestCount,
      1,
      'the complete lyric must use one translation request'
    );
    assert.strictEqual(
      requestBody.text.length,
      1,
      'the complete lyric must be one API text document'
    );
    assert.ok(
      requestBody.text[0].includes('Now I am traveling light') &&
        requestBody.text[0].includes('I found my freedom now'),
      'one document must contain every lyric line'
    );
    assert.strictEqual(requestBody.tag_handling, 'xml');
    assert.strictEqual(
      result.tlyric,
      [
        '[00:01.00]现在我轻装前行',
        '[00:05.25]我的精神振翅高飞',
        '[00:09.00][00:13.00]如今我找到了自由',
      ].join('\n')
    );
    assert.strictEqual(result.lineCount, 3);
    assert.strictEqual(result.sameLanguage, false);
    assert.strictEqual(mapDeepLTargetLanguage('zh-TC'), 'ZH-HANT');
    assert.strictEqual(getDeepLEndpoint('paid-key'), 'https://api.deepl.com');
  }

  await assert.rejects(
    () =>
      translateWholeLyricWithDeepL({
        apiKey: 'test-key:fx',
        lyric: '[00:01.00]First line\n[00:02.00]Second line',
        targetLanguage: 'zh-CN',
        fetchImpl: async () => ({
          ok: true,
          async json() {
            return {
              translations: [
                {
                  detected_source_language: 'EN',
                  text: '<lyrics><line id="0">第一行</line></lyrics>',
                },
              ],
            };
          },
        }),
      }),
    (error) => error && error.code === 'line-count-mismatch',
    'an incomplete line map must discard the whole translation'
  );

  {
    const helpers = createPlayHelpers();
    const candidates = [
      {
        id: 'slightly-better-without-translation',
        matchScore: 0.99,
        tlyric: '',
      },
      {
        id: 'translated',
        matchScore: 0.97,
        tlyric: '[00:01.00]译文',
      },
      {
        id: 'poor-translated-match',
        matchScore: 0.8,
        tlyric: '[00:01.00]译文',
      },
    ]
      .map(helpers.decorate)
      .sort(helpers.compare);
    assert.deepStrictEqual(
      candidates.map((candidate) => candidate.id),
      [
        'translated',
        'slightly-better-without-translation',
        'poor-translated-match',
      ],
      'translated candidates should win only when match scores are close'
    );
    assert.strictEqual(candidates[0].hasTranslation, true);
  }

  {
    const provider = createProvider();
    provider.search_qq_lyric_candidates = async () => [
      originalCandidate(),
      {
        ...translatedCandidate(0.87),
        id: 'qq-low-confidence',
        provider: 'QQ',
      },
    ];
    provider.search_netease_lyric_candidates = async () => [
      translatedCandidate(),
    ];

    const enriched = await provider.enrich_manual_lyric_candidate(
      originalCandidate()
    );
    assert.strictEqual(enriched.id, 'netease-translated');
    assert.strictEqual(enriched.provider, '网易云');
    assert.strictEqual(enriched.lyric, '[00:01.00]Matched original lyric');
    assert.strictEqual(enriched.tlyric, '[00:01.00]匹配的同步译文');
    assert.strictEqual(enriched.selectedProvider, 'QQ');
    assert.strictEqual(enriched.selectedCandidateId, 'qq-original');
    assert.strictEqual(enriched.translationProvider, '网易云');
    assert.strictEqual(enriched.translationEnriched, true);
  }

  {
    const provider = createProvider();
    const defaultPageTrack = 'bitrack_v_BVcache';
    const oldFirstPageTrack = 'bitrack_v_BVcache-101';
    const currentFirstPageTrack = 'bitrack_v_BVcache-202';
    const firstPageInfo = {
      source_url: 'https://www.bilibili.com/BVcache/?p=1',
    };
    assert.strictEqual(
      provider.save_manual_lyric(
        oldFirstPageTrack,
        {
          ...originalCandidate(),
          lyric: '[00:01.00]Old first-page lyric',
        },
        firstPageInfo
      ).ok,
      true
    );
    provider.lyricCacheForTest.set(defaultPageTrack, {
      lyric: '[00:01.00]Cached automatic default-page lyric',
    });
    provider.lyricCacheForTest.set(oldFirstPageTrack, {
      lyric: '[00:01.00]Cached old alias target lyric',
    });
    provider.lyricCacheForTest.set(currentFirstPageTrack, {
      lyric: '[00:01.00]Cached current first-page lyric',
    });

    assert.strictEqual(
      provider.save_manual_lyric(
        currentFirstPageTrack,
        {
          ...originalCandidate(),
          lyric: '[00:01.00]New first-page lyric',
        },
        firstPageInfo
      ).ok,
      true
    );
    assert.strictEqual(
      provider.lyricCacheForTest.has(defaultPageTrack),
      false,
      'saving a p1 alias must invalidate a cached automatic base-ID lyric'
    );
    assert.strictEqual(
      provider.lyricCacheForTest.has(oldFirstPageTrack),
      false,
      'saving a replacement p1 alias must invalidate the previous alias target'
    );
    assert.strictEqual(
      provider.lyricCacheForTest.has(currentFirstPageTrack),
      false,
      'saving a p1 alias must invalidate the canonical CID cache key'
    );

    provider.lyricCacheForTest.set(defaultPageTrack, {
      lyric: '[00:01.00]Cached automatic default-page lyric after save',
    });
    provider.lyricCacheForTest.set(currentFirstPageTrack, {
      lyric: '[00:01.00]Cached manual first-page lyric after save',
    });
    assert.strictEqual(
      provider.clear_manual_lyric(currentFirstPageTrack, firstPageInfo).ok,
      true
    );
    assert.strictEqual(
      provider.lyricCacheForTest.has(defaultPageTrack),
      false,
      'clearing a p1 alias must invalidate the base-ID cache key'
    );
    assert.strictEqual(
      provider.lyricCacheForTest.has(currentFirstPageTrack),
      false,
      'clearing a p1 alias must invalidate the canonical CID cache key'
    );
  }

  {
    const provider = createProvider();
    const existingTranslation = {
      ...originalCandidate(),
      tlyric: '[00:01.00]Existing translation',
    };
    provider.find_bilingual_catalog_lyric = () => {
      throw new Error('lookup must not run when translation already exists');
    };
    const result = await provider.enrich_manual_lyric_candidate(
      existingTranslation
    );
    assert.strictEqual(result, existingTranslation);
  }

  {
    const provider = createProvider();
    provider.search_qq_lyric_candidates = async () => [];
    provider.search_netease_lyric_candidates = async () => [
      translatedCandidate(0.87),
    ];
    const original = originalCandidate();
    const result = await provider.enrich_manual_lyric_candidate(original);
    assert.strictEqual(
      result,
      original,
      'a low-confidence translation must not replace selected lyrics'
    );
  }

  {
    const provider = createProvider();
    provider.search_qq_lyric_candidates = async () => [];
    provider.search_netease_lyric_candidates = async () => [
      translatedCandidate(),
    ];
    provider.save_manual_lyric('bitrack-test', originalCandidate());

    const resolved = await provider.resolve_lyric({
      trackId: 'bitrack-test',
      title: 'Video title',
      artist: '',
      duration: 208,
    });
    assert.strictEqual(resolved.source, 'manual-selection');
    assert.strictEqual(resolved.tlyric, '[00:01.00]匹配的同步译文');
    assert.strictEqual(resolved.translationProvider, '网易云');
    assert.strictEqual(resolved.translationEnriched, true);

    const stored = provider.get_manual_lyric('bitrack-test');
    assert.strictEqual(stored.tlyric, '[00:01.00]匹配的同步译文');
    assert.strictEqual(stored.selectedProvider, 'QQ');
    assert.strictEqual(stored.translationProvider, '网易云');
  }

  {
    const provider = createProvider();
    const firstSelection = {
      ...originalCandidate(),
      lyric: '[00:01.00]First manual lyric',
      tlyric: '[00:01.00]First translation',
    };
    const lastSelection = {
      ...originalCandidate(),
      id: 'qq-reselected',
      lyric: '[00:01.00]Last manual lyric',
      tlyric: '[00:01.00]Last translation',
    };
    assert.strictEqual(
      provider.save_manual_lyric('bitrack_same-song', firstSelection).ok,
      true
    );
    assert.strictEqual(
      provider.save_manual_lyric('bitrack_same-song', lastSelection).ok,
      true
    );
    const selections = provider.get_manual_lyric_selections();
    assert.deepStrictEqual(Object.keys(selections), ['bitrack_same-song']);
    assert.strictEqual(
      selections['bitrack_same-song'].lyric,
      '[00:01.00]Last manual lyric'
    );
    assert.strictEqual(
      selections['bitrack_same-song'].tlyric,
      '[00:01.00]Last translation'
    );
    assert.strictEqual(
      selections['bitrack_same-song'].candidateId,
      'qq-reselected'
    );
  }

  {
    const provider = createProvider();
    for (let index = 0; index < 41; index += 1) {
      const result = provider.save_manual_lyric(`bitrack_saved_${index}`, {
        ...originalCandidate(),
        id: `qq-${index}`,
        lyric: `[00:01.00]Saved lyric ${index}`,
        tlyric: `[00:01.00]保存译文 ${index}`,
      });
      assert.strictEqual(result.ok, true);
    }
    const selections = provider.get_manual_lyric_selections();
    assert.strictEqual(Object.keys(selections).length, 41);
    const reloadedProvider = createProvider({
      initialStorage: {
        'bilibili-manual-lyrics': provider.storageForTest.get(
          'bilibili-manual-lyrics'
        ),
      },
    });
    assert.strictEqual(
      reloadedProvider.get_manual_lyric('bitrack_saved_0').lyric,
      '[00:01.00]Saved lyric 0'
    );
    assert.strictEqual(
      reloadedProvider.get_manual_lyric('bitrack_saved_40').lyric,
      '[00:01.00]Saved lyric 40'
    );
  }

  {
    const legacySelection = {
      ...originalCandidate(),
      source: 'manual-selection',
      selectedAt: 1,
    };
    const provider = createProvider({
      initialStorage: {
        'bilibili-manual-lyrics': JSON.stringify({
          'bitrack_legacy-song': legacySelection,
        }),
      },
    });
    assert.strictEqual(
      provider.get_manual_lyric('bitrack_legacy-song').lyric,
      legacySelection.lyric
    );
    assert.strictEqual(
      provider.save_manual_lyric('bitrack_new-song', {
        ...originalCandidate(),
        lyric: '[00:01.00]New persisted lyric',
      }).migrated,
      true
    );
    const migrated = JSON.parse(
      provider.storageForTest.get('bilibili-manual-lyrics')
    );
    assert.strictEqual(migrated.version, 2);
    assert.strictEqual(
      migrated.records['bitrack_legacy-song'].lyric,
      legacySelection.lyric
    );
    assert.strictEqual(
      migrated.records['bitrack_new-song'].lyric,
      '[00:01.00]New persisted lyric'
    );
  }

  {
    const provider = createProvider();
    const firstPageTrack = 'bitrack_v_BVlyrics-101';
    const secondPageTrack = 'bitrack_v_BVlyrics-202';
    const firstPageInfo = {
      source_url: 'https://www.bilibili.com/BVlyrics/?p=1',
    };
    const defaultPageInfo = {
      source_url: 'https://www.bilibili.com/BVlyrics',
    };
    const secondPageInfo = {
      source_url: 'https://www.bilibili.com/BVlyrics/?p=2',
    };
    assert.strictEqual(
      provider.save_manual_lyric(
        firstPageTrack,
        {
          ...originalCandidate(),
          lyric: '[00:01.00]First page lyric',
        },
        firstPageInfo
      ).ok,
      true
    );
    assert.strictEqual(
      provider.get_manual_lyric('bitrack_v_BVlyrics', defaultPageInfo).lyric,
      '[00:01.00]First page lyric'
    );
    const reloadedProvider = createProvider({
      initialStorage: {
        'bilibili-manual-lyrics': provider.storageForTest.get(
          'bilibili-manual-lyrics'
        ),
      },
    });
    assert.strictEqual(
      reloadedProvider.get_manual_lyric('bitrack_v_BVlyrics', defaultPageInfo)
        .lyric,
      '[00:01.00]First page lyric',
      'the safe default-page alias must survive a fresh provider instance'
    );
    assert.strictEqual(
      provider.get_manual_lyric(secondPageTrack, secondPageInfo),
      null,
      'a second page must never inherit a first-page lyric'
    );
    assert.strictEqual(
      provider.save_manual_lyric(
        'bitrack_v_BVlyrics',
        {
          ...originalCandidate(),
          id: 'qq-first-page-reselected',
          lyric: '[00:01.00]Reselected first page lyric',
          tlyric: '[00:01.00]重选第一页译文',
        },
        defaultPageInfo
      ).ok,
      true
    );
    assert.strictEqual(
      Object.keys(provider.get_manual_lyric_selections()).length,
      1,
      'the default-page alias must update the same canonical record'
    );
    assert.strictEqual(
      provider.get_manual_lyric(firstPageTrack, firstPageInfo).lyric,
      '[00:01.00]Reselected first page lyric'
    );
    assert.strictEqual(
      provider.save_manual_lyric(
        'bitrack_v_BVlyrics',
        originalCandidate(),
        secondPageInfo
      ).status,
      'ambiguous-track'
    );

    const legacyVideoProvider = createProvider({
      initialStorage: {
        'bilibili-manual-lyrics': JSON.stringify({
          bitrack_v_BVlegacy: {
            ...originalCandidate(),
            source: 'manual-selection',
            lyric: '[00:01.00]Legacy first page lyric',
          },
        }),
      },
    });
    assert.strictEqual(
      legacyVideoProvider.get_manual_lyric('bitrack_v_BVlegacy-301', {
        source_url: 'https://www.bilibili.com/BVlegacy/?p=1',
      }).lyric,
      '[00:01.00]Legacy first page lyric'
    );
    assert.strictEqual(
      legacyVideoProvider.get_manual_lyric('bitrack_v_BVlegacy-302', {
        source_url: 'https://www.bilibili.com/BVlegacy/?p=2',
      }),
      null,
      'a legacy default-page value must not leak into a different part'
    );
  }

  {
    const corruptedStorage = '{not-json';
    const corruptedProvider = createProvider({
      initialStorage: {
        'bilibili-manual-lyrics': corruptedStorage,
      },
    });
    const corruptedSave = corruptedProvider.save_manual_lyric(
      'bitrack_corrupted',
      originalCandidate()
    );
    assert.strictEqual(corruptedSave.ok, false);
    assert.strictEqual(corruptedSave.status, 'storage-corrupted');
    assert.strictEqual(
      corruptedProvider.storageForTest.get('bilibili-manual-lyrics'),
      corruptedStorage,
      'a corrupted legacy value must not be overwritten silently'
    );

    const quotaProvider = createProvider({ failSetItem: true });
    const quotaSave = quotaProvider.save_manual_lyric(
      'bitrack_quota',
      originalCandidate()
    );
    assert.strictEqual(quotaSave.ok, false);
    assert.strictEqual(quotaSave.status, 'storage-write-failed');
    assert.strictEqual(
      quotaProvider.storageForTest.has('bilibili-manual-lyrics'),
      false
    );
  }

  // eslint-disable-next-line no-console
  console.log('bilibili lyric translation tests passed');
}

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exitCode = 1;
});
