/* eslint-env node */
/* eslint-disable no-console */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const {
  extractTimedLyricLines,
  getDeepLEndpoint,
  mapDeepLTargetLanguage,
  translateWholeLyricWithDeepL,
} = require(path.join(__dirname, '..', '..', 'machineTranslation.js'));

function createProvider() {
  const filename = path.join(
    __dirname,
    '..',
    'js',
    'provider',
    'bilibili.js'
  );
  const source = fs.readFileSync(filename, 'utf8');
  const storage = new Map();
  const context = {
    axios: {},
    console,
    DOMParser: class {
      parseFromString(value) {
        return { body: { textContent: value } };
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
        storage.set(key, value);
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(
    `${source}\nthis.BilibiliProviderForTest = bilibili;`,
    context,
    { filename }
  );
  return context.BilibiliProviderForTest;
}

function createPlayHelpers() {
  const filename = path.join(
    __dirname,
    '..',
    'js',
    'controller',
    'play.js'
  );
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
        assert.strictEqual(
          url,
          'https://api-free.deepl.com/v2/translate'
        );
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
    assert.strictEqual(
      getDeepLEndpoint('paid-key'),
      'https://api.deepl.com'
    );
  }

  {
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
  }

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

  console.log('bilibili lyric translation tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
