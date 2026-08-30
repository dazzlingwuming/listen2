let wbi_key = null;
const bilibiliLyricCache = new Map();
const bilibiliLyricSearchCache = new Map();
const bilibiliQQLyricSearchCache = new Map();
const bilibiliNeteaseLyricSearchCache = new Map();
const bilibiliTrackDurationCache = new Map();
const BILIBILI_LYRIC_REQUEST_TIMEOUT = 8000;
const QQ_LYRIC_REQUEST_TIMEOUT = 8000;
const NETEASE_LYRIC_REQUEST_TIMEOUT = 8000;
const LRCLIB_LYRIC_REQUEST_TIMEOUT = 15000;
const LRCLIB_SEARCH_CACHE_TTL = 10 * 60 * 1000;
const QQ_LYRIC_SEARCH_CACHE_TTL = 10 * 60 * 1000;
const NETEASE_LYRIC_SEARCH_CACHE_TTL = 10 * 60 * 1000;
const BILIBILI_AUDIO_QUALITY_LABELS = {
  30216: '64K',
  30232: '132K',
  30280: '192K',
  30250: '杜比音频',
  30251: 'Hi-Res / FLAC',
};
const BILIBILI_MANUAL_LYRIC_STORAGE_KEY = 'bilibili-manual-lyrics';
const BILIBILI_MANUAL_LYRIC_STORAGE_VERSION = 2;
const BILIBILI_AUTO_LYRIC_MATCH_THRESHOLD = 0.88;
const LRCLIB_CLIENT_ID =
  'Listen1 v2.34.0 (https://github.com/listen1/listen1_chrome_extension)';
/* global getParameterByName kuwo MediaService isElectron */
// eslint-disable-next-line no-unused-vars
/* global cookieSet cookieGet */
// eslint-disable-next-line no-unused-vars
class bilibili {
  static htmlDecode(value) {
    const parser = new DOMParser();
    return parser.parseFromString(value, 'text/html').body.textContent;
  }

  static parse_duration(value) {
    if (typeof value === 'number') {
      return value;
    }
    const text = String(value || '').trim();
    if (/^\d+(?:\.\d+)?$/.test(text)) {
      return Number(text);
    }
    const parts = text.split(':').map((part) => Number(part));
    if (parts.some((part) => Number.isNaN(part))) {
      return 0;
    }
    if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    }
    if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    return 0;
  }

  static parse_json_payload(value) {
    if (typeof value !== 'string') {
      return value;
    }
    try {
      return JSON.parse(value);
    } catch (error) {
      return value;
    }
  }

  static create_manual_lyric_store() {
    return {
      version: BILIBILI_MANUAL_LYRIC_STORAGE_VERSION,
      records: {},
      aliases: {},
    };
  }

  static is_manual_lyric_record(value) {
    return (
      value &&
      typeof value === 'object' &&
      typeof value.lyric === 'string' &&
      value.lyric.trim().length > 0
    );
  }

  static normalize_manual_lyric_store(value) {
    const emptyStore = this.create_manual_lyric_store();
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {
        ok: false,
        status: 'storage-corrupted',
        store: emptyStore,
      };
    }

    if (value.version === BILIBILI_MANUAL_LYRIC_STORAGE_VERSION) {
      if (
        !value.records ||
        typeof value.records !== 'object' ||
        Array.isArray(value.records) ||
        (value.aliases !== undefined &&
          (!value.aliases ||
            typeof value.aliases !== 'object' ||
            Array.isArray(value.aliases)))
      ) {
        return {
          ok: false,
          status: 'storage-corrupted',
          store: emptyStore,
        };
      }
      const records = {};
      Object.keys(value.records).forEach((key) => {
        if (this.is_manual_lyric_record(value.records[key])) {
          records[key] = value.records[key];
        }
      });
      const aliases = {};
      Object.keys(value.aliases || {}).forEach((alias) => {
        const target = value.aliases[alias];
        if (typeof target === 'string' && records[target]) {
          aliases[alias] = target;
        }
      });
      return {
        ok: true,
        store: {
          version: BILIBILI_MANUAL_LYRIC_STORAGE_VERSION,
          records,
          aliases,
        },
      };
    }

    if (
      Object.prototype.hasOwnProperty.call(value, 'version') ||
      Object.prototype.hasOwnProperty.call(value, 'records') ||
      Object.prototype.hasOwnProperty.call(value, 'aliases')
    ) {
      return {
        ok: false,
        status: 'storage-corrupted',
        store: emptyStore,
      };
    }

    const records = {};
    Object.keys(value).forEach((key) => {
      if (this.is_manual_lyric_record(value[key])) {
        records[key] = value[key];
      }
    });
    return {
      ok: true,
      migrated: true,
      store: {
        version: BILIBILI_MANUAL_LYRIC_STORAGE_VERSION,
        records,
        aliases: {},
      },
    };
  }

  static read_manual_lyric_store() {
    let rawValue = null;
    try {
      rawValue = localStorage.getItem(BILIBILI_MANUAL_LYRIC_STORAGE_KEY);
    } catch (error) {
      return {
        ok: false,
        status: 'storage-unavailable',
        store: this.create_manual_lyric_store(),
      };
    }
    if (rawValue === null || rawValue === '') {
      return {
        ok: true,
        store: this.create_manual_lyric_store(),
      };
    }
    try {
      return this.normalize_manual_lyric_store(JSON.parse(rawValue));
    } catch (error) {
      return {
        ok: false,
        status: 'storage-corrupted',
        store: this.create_manual_lyric_store(),
      };
    }
  }

  static write_manual_lyric_store(store) {
    try {
      localStorage.setItem(
        BILIBILI_MANUAL_LYRIC_STORAGE_KEY,
        JSON.stringify(store)
      );
      return { ok: true, status: 'saved' };
    } catch (error) {
      return { ok: false, status: 'storage-write-failed' };
    }
  }

  static get_manual_lyric_selections() {
    const result = this.read_manual_lyric_store();
    return result.ok ? result.store.records : {};
  }

  static get_manual_lyric_page(trackInfo = {}) {
    const sourceUrl = String(trackInfo.sourceUrl || trackInfo.source_url || '');
    const match = /[?&]p=(\d+)/.exec(sourceUrl);
    const page = match ? Number(match[1]) : 0;
    return Number.isInteger(page) && page > 0 ? page : 0;
  }

  static get_manual_lyric_identity(trackId, trackInfo = {}) {
    const safeTrackId = String(trackId || '');
    const idParts = this.get_video_id_parts(safeTrackId);
    if (!idParts || !idParts.bvid) {
      return {
        key: safeTrackId,
        isReliable: Boolean(safeTrackId),
        canUseDefaultPageAlias: false,
        shouldCreateDefaultPageAlias: false,
      };
    }

    const defaultPageKey = `bitrack_v_${idParts.bvid}`;
    const hasCid = Number.isFinite(idParts.cid) && idParts.cid > 0;
    const page = this.get_manual_lyric_page(trackInfo);
    if (!hasCid && page > 1) {
      return {
        key: safeTrackId,
        isReliable: false,
        canUseDefaultPageAlias: false,
        shouldCreateDefaultPageAlias: false,
      };
    }

    // The existing video resolver maps a no-CID video ID to pages[0]. A
    // contradictory ?p=2+ URL has no stable CID, so it is rejected above
    // instead of risking a lyric alias across different parts.
    const isDefaultPageTrack = !hasCid && (page === 0 || page === 1);
    const isExplicitFirstPage = hasCid && page === 1;
    return {
      key: hasCid ? `bitrack_v_${idParts.bvid}-${idParts.cid}` : defaultPageKey,
      defaultPageKey,
      isReliable: true,
      canUseDefaultPageAlias: isDefaultPageTrack || isExplicitFirstPage,
      shouldCreateDefaultPageAlias: isExplicitFirstPage,
    };
  }

  static find_manual_lyric_record(store, identity) {
    if (!identity || !identity.isReliable) {
      return null;
    }
    const direct = store.records[identity.key];
    if (this.is_manual_lyric_record(direct)) {
      return { key: identity.key, record: direct };
    }
    if (!identity.canUseDefaultPageAlias || !identity.defaultPageKey) {
      return null;
    }
    const aliasTarget = store.aliases[identity.defaultPageKey];
    const aliasedRecord = aliasTarget && store.records[aliasTarget];
    if (this.is_manual_lyric_record(aliasedRecord)) {
      return { key: aliasTarget, record: aliasedRecord };
    }
    const legacyDefaultPageRecord = store.records[identity.defaultPageKey];
    return this.is_manual_lyric_record(legacyDefaultPageRecord)
      ? {
          key: identity.defaultPageKey,
          record: legacyDefaultPageRecord,
        }
      : null;
  }

  static get_manual_lyric(trackId, trackInfo = {}) {
    const readResult = this.read_manual_lyric_store();
    if (!readResult.ok) {
      return null;
    }
    const identity = this.get_manual_lyric_identity(trackId, trackInfo);
    const found = this.find_manual_lyric_record(readResult.store, identity);
    return found ? found.record : null;
  }

  static build_manual_lyric_record(candidate) {
    return {
      lyric: candidate.lyric,
      tlyric: candidate.tlyric || '',
      source: 'manual-selection',
      matchedTitle: candidate.title || '',
      matchedArtist: candidate.artist || '',
      matchedAlbum: candidate.album || '',
      matchedDuration: candidate.duration || 0,
      matchedProvider: candidate.provider || '',
      candidateId: candidate.id || '',
      selectedProvider: candidate.selectedProvider || '',
      selectedCandidateId: candidate.selectedCandidateId || '',
      translationProvider: candidate.translationProvider || '',
      translationEnriched: candidate.translationEnriched === true,
      machineTranslated: candidate.machineTranslated === true,
      machineTranslationProvider: candidate.machineTranslationProvider || '',
      machineTranslationTarget: candidate.machineTranslationTarget || '',
      machineTranslationDetectedSource:
        candidate.machineTranslationDetectedSource || '',
      selectedAt: Date.now(),
    };
  }

  static invalidate_manual_lyric_cache(
    trackId,
    recordKey,
    identity = {},
    aliasMappings = []
  ) {
    const cacheKeys = new Set();
    [trackId, recordKey, identity.key, identity.defaultPageKey].forEach(
      (key) => {
        if (typeof key === 'string' && key) {
          cacheKeys.add(key);
        }
      }
    );

    const aliasEntries = [];
    (Array.isArray(aliasMappings) ? aliasMappings : []).forEach((aliases) => {
      if (!aliases || typeof aliases !== 'object') {
        return;
      }
      Object.keys(aliases).forEach((alias) => {
        const target = aliases[alias];
        if (typeof target === 'string' && target) {
          aliasEntries.push([alias, target]);
        }
      });
    });

    // A no-CID page ID and its canonical CID record can both be cache keys.
    // Walk linked aliases so replacing or removing an alias cannot leave an
    // automatic lyric cached under either side of the relationship.
    let addedRelatedKey = true;
    while (addedRelatedKey) {
      addedRelatedKey = false;
      for (
        let entryIndex = 0;
        entryIndex < aliasEntries.length;
        entryIndex += 1
      ) {
        const [alias, target] = aliasEntries[entryIndex];
        if (cacheKeys.has(alias) || cacheKeys.has(target)) {
          if (!cacheKeys.has(alias)) {
            cacheKeys.add(alias);
            addedRelatedKey = true;
          }
          if (!cacheKeys.has(target)) {
            cacheKeys.add(target);
            addedRelatedKey = true;
          }
        }
      }
    }
    cacheKeys.forEach((key) => bilibiliLyricCache.delete(key));
  }

  static save_manual_lyric(trackId, candidate, trackInfo = {}) {
    if (!trackId || !candidate || !candidate.lyric) {
      return { ok: false, status: 'invalid-selection' };
    }
    const readResult = this.read_manual_lyric_store();
    if (!readResult.ok) {
      return { ok: false, status: readResult.status };
    }
    const identity = this.get_manual_lyric_identity(trackId, trackInfo);
    if (!identity.isReliable) {
      return { ok: false, status: 'ambiguous-track' };
    }
    const { store } = readResult;
    const aliasesBeforeSave = { ...store.aliases };
    let recordKey = identity.key;
    if (identity.defaultPageKey && !identity.shouldCreateDefaultPageAlias) {
      const aliasTarget = store.aliases[identity.defaultPageKey];
      if (
        aliasTarget &&
        this.is_manual_lyric_record(store.records[aliasTarget])
      ) {
        recordKey = aliasTarget;
      }
    }
    if (identity.shouldCreateDefaultPageAlias) {
      const legacyDefaultPageRecord = store.records[identity.defaultPageKey];
      if (legacyDefaultPageRecord && recordKey !== identity.defaultPageKey) {
        delete store.records[identity.defaultPageKey];
      }
      recordKey = identity.key;
      store.aliases[identity.defaultPageKey] = recordKey;
    }
    store.records[recordKey] = this.build_manual_lyric_record(candidate);
    const writeResult = this.write_manual_lyric_store(store);
    if (!writeResult.ok) {
      return writeResult;
    }
    this.invalidate_manual_lyric_cache(trackId, recordKey, identity, [
      aliasesBeforeSave,
      store.aliases,
    ]);
    return {
      ok: true,
      status: 'saved',
      recordKey,
      migrated: readResult.migrated === true,
    };
  }

  static clear_manual_lyric(trackId, trackInfo = {}) {
    const readResult = this.read_manual_lyric_store();
    if (!readResult.ok) {
      return { ok: false, status: readResult.status };
    }
    const identity = this.get_manual_lyric_identity(trackId, trackInfo);
    const aliasesBeforeClear = { ...readResult.store.aliases };
    const found = this.find_manual_lyric_record(readResult.store, identity);
    if (!found) {
      this.invalidate_manual_lyric_cache(trackId, identity.key, identity, [
        aliasesBeforeClear,
      ]);
      return { ok: true, status: 'not-found' };
    }
    delete readResult.store.records[found.key];
    Object.keys(readResult.store.aliases).forEach((alias) => {
      if (readResult.store.aliases[alias] === found.key) {
        delete readResult.store.aliases[alias];
      }
    });
    const writeResult = this.write_manual_lyric_store(readResult.store);
    if (!writeResult.ok) {
      return writeResult;
    }
    this.invalidate_manual_lyric_cache(trackId, found.key, identity, [
      aliasesBeforeClear,
      readResult.store.aliases,
    ]);
    return { ok: true, status: 'cleared' };
  }

  static format_lrc_time(seconds) {
    const safeSeconds = Math.max(0, Number(seconds) || 0);
    const minutes = Math.floor(safeSeconds / 60);
    const remainingSeconds = Math.floor(safeSeconds % 60);
    const centiseconds = Math.floor((safeSeconds % 1) * 100);
    return `[${String(minutes).padStart(2, '0')}:${String(
      remainingSeconds
    ).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}]`;
  }

  static kuwo_lyric_to_lrc(lrclist) {
    if (!Array.isArray(lrclist)) {
      return '';
    }
    return lrclist
      .filter(
        (line) =>
          line &&
          Number.isFinite(Number(line.time)) &&
          String(line.lineLyric || '').trim() &&
          line.lineLyric !== '//'
      )
      .map(
        (line) =>
          `${this.format_lrc_time(line.time)}${String(line.lineLyric).trim()}`
      )
      .join('\n');
  }

  static has_version_marker(value) {
    return /(?:\blive\b|\bdj\b|\bremix\b|\bcover\b|现场|演唱会|翻唱|伴奏|纯音乐|加速|慢速|倍速|片段|串烧)/i.test(
      String(value || '')
    );
  }

  static clean_music_title(value) {
    return this.htmlDecode(String(value || ''))
      .replace(
        /(?:【|\u005B)[^】\u005D]*(?:4k|8k|hdr|hi-?res|无损|修复|画质|音质|字幕|歌词|完整版|收藏级|珍藏|超清)[^】\u005D]*(?:】|\u005D)/gi,
        ' '
      )
      .replace(
        /[（(][^）)]*(?:4k|8k|hdr|hi-?res|无损|修复|画质|音质|字幕|完整版)[^）)]*[）)]/gi,
        ' '
      )
      .replace(/[《》「」『』“”"'【】\u005B\u005D]/g, ' ')
      .replace(
        /(?:\b(?:mv|pv|amv|official|video|audio)\b|\b\d{3,4}p\b|\b\d{2,3}fps\b|官方|完整版|高清|超清|修复版|重制版|歌词版|中字|单曲循环)/gi,
        ' '
      )
      .replace(/[|｜/_—–-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  static get_lyric_search_query(trackInfo) {
    return (
      this.clean_music_title(trackInfo && trackInfo.title) ||
      this.clean_music_title(trackInfo && trackInfo.artist)
    );
  }

  static normalize_match_text(value) {
    return String(value || '')
      .normalize('NFKC')
      .toLowerCase()
      .replace(
        /[\s·•,，。.!！?？:：;；'"“”‘’()（）[\]【】《》<>_\-/\\|｜]+/g,
        ''
      );
  }

  static dice_similarity(leftValue, rightValue) {
    const left = this.normalize_match_text(leftValue);
    const right = this.normalize_match_text(rightValue);
    if (!left || !right) {
      return 0;
    }
    if (left === right) {
      return 1;
    }
    if (left.includes(right) || right.includes(left)) {
      const shorter = Math.min(left.length, right.length);
      const longer = Math.max(left.length, right.length);
      return Math.max(0.9, shorter / longer);
    }
    if (left.length < 2 || right.length < 2) {
      return 0;
    }
    const pairs = new Map();
    for (let index = 0; index < left.length - 1; index += 1) {
      const pair = left.slice(index, index + 2);
      pairs.set(pair, (pairs.get(pair) || 0) + 1);
    }
    let overlap = 0;
    for (let index = 0; index < right.length - 1; index += 1) {
      const pair = right.slice(index, index + 2);
      const count = pairs.get(pair) || 0;
      if (count > 0) {
        overlap += 1;
        pairs.set(pair, count - 1);
      }
    }
    return (2 * overlap) / (left.length + right.length - 2);
  }

  static build_title_variants(values) {
    const variants = [];
    const addVariant = (value) => {
      const cleaned = this.clean_music_title(value);
      const normalized = this.normalize_match_text(cleaned);
      if (
        cleaned &&
        normalized.length >= 2 &&
        !variants.some((item) => this.normalize_match_text(item) === normalized)
      ) {
        variants.push(cleaned);
      }
    };

    values.filter(Boolean).forEach((value) => {
      const text = this.htmlDecode(String(value));
      addVariant(text);
      const quotedPattern = /[《「『“"]([^》」』”"]{1,80})[》」』”"]/g;
      let quotedMatch = quotedPattern.exec(text);
      while (quotedMatch) {
        addVariant(quotedMatch[1]);
        quotedMatch = quotedPattern.exec(text);
      }
      text
        .split(/\s*(?:--+|[-—–|｜])\s*/)
        .filter((part) => part.length >= 2 && part.length <= 80)
        .forEach(addVariant);
    });
    return variants.slice(0, 8);
  }

  static score_kuwo_candidate(item, hints, index) {
    const candidateTitle = this.clean_music_title(
      item.NAME || item.SONGNAME || ''
    );
    const candidateArtist = this.clean_music_title(item.ARTIST || '');
    const titleScore = hints.variants.reduce(
      (score, variant) =>
        Math.max(score, this.dice_similarity(variant, candidateTitle)),
      0
    );
    const artistScore = hints.variants.reduce(
      (score, variant) =>
        Math.max(score, this.dice_similarity(variant, candidateArtist)),
      this.dice_similarity(hints.artist, candidateArtist)
    );
    const candidateDuration = this.parse_duration(item.DURATION);
    let durationScore = 0.5;
    if (hints.duration > 0 && candidateDuration > 0) {
      const difference = Math.abs(hints.duration - candidateDuration);
      if (difference <= 6) {
        durationScore = 1;
      } else if (difference <= 15) {
        durationScore = 0.82;
      } else if (difference <= 35) {
        durationScore = 0.5;
      } else if (difference <= 75) {
        durationScore = 0.2;
      } else {
        durationScore = 0;
      }
    }

    const candidateVersionText = `${item.NAME || ''} ${item.SONGNAME || ''} ${
      item.SUFFIX || ''
    } ${item.ALIAS || ''}`;
    const versionPenalty =
      this.has_version_marker(candidateVersionText) &&
      !this.has_version_marker(hints.rawTitle)
        ? 0.2
        : 0;
    const rankBonus = Math.max(0, 0.04 - index * 0.003);
    return {
      item,
      candidateDuration,
      score:
        titleScore * 0.7 +
        artistScore * 0.18 +
        durationScore * 0.08 +
        rankBonus -
        versionPenalty,
    };
  }

  static get_video_id_parts(trackId) {
    if (!String(trackId || '').startsWith('bitrack_v_')) {
      return null;
    }
    const rawId = trackId.slice('bitrack_v_'.length);
    const [bvid, cidValue] = rawId.split('-');
    return {
      bvid,
      cid: cidValue ? Number(cidValue) : 0,
    };
  }

  static get_video_context(trackId) {
    const idParts = this.get_video_id_parts(trackId);
    if (!idParts) {
      return Promise.resolve(null);
    }
    const targetUrl = `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(
      idParts.bvid
    )}`;
    return axios
      .get(targetUrl, {
        withCredentials: true,
        timeout: BILIBILI_LYRIC_REQUEST_TIMEOUT,
      })
      .then((response) => {
        const payload = this.parse_json_payload(response.data);
        const data = payload && payload.data;
        if (!data) {
          return null;
        }
        const pages = Array.isArray(data.pages) ? data.pages : [];
        const page =
          pages.find((item) => Number(item.cid) === idParts.cid) || pages[0];
        return {
          bvid: idParts.bvid,
          cid: idParts.cid || (page && Number(page.cid)) || Number(data.cid),
          duration: this.parse_duration(
            (page && page.duration) || data.duration
          ),
          partTitle: page && page.part,
          videoTitle: data.title,
          artist: data.owner && data.owner.name,
        };
      })
      .catch(() => ({
        bvid: idParts.bvid,
        cid: idParts.cid,
        duration: 0,
      }));
  }

  static get_track_duration(track) {
    const trackId = String((track && track.id) || '');
    const existingDuration = this.parse_duration(track && track.duration);
    if (existingDuration > 0) {
      return Promise.resolve(existingDuration);
    }
    if (!this.get_video_id_parts(trackId)) {
      return Promise.resolve(0);
    }
    const cached = bilibiliTrackDurationCache.get(trackId);
    if (cached) {
      return cached;
    }
    const request = this.get_video_context(trackId).then((context) => {
      const duration = this.parse_duration(context && context.duration);
      if (duration <= 0) {
        bilibiliTrackDurationCache.delete(trackId);
      }
      return duration;
    });
    bilibiliTrackDurationCache.set(trackId, request);
    return request;
  }

  static async hydrate_track_durations(tracks) {
    const safeTracks = Array.isArray(tracks) ? tracks : [];
    const pending = safeTracks.filter(
      (track) =>
        this.parse_duration(track && track.duration) <= 0 &&
        this.get_video_id_parts(track && track.id)
    );
    let cursor = 0;
    const worker = async () => {
      while (cursor < pending.length) {
        const track = pending[cursor];
        cursor += 1;
        // Keep failed metadata requests isolated: one unavailable Bilibili
        // video must not prevent the rest of the playlist from being filled.
        // eslint-disable-next-line no-await-in-loop
        const duration = await this.get_track_duration(track).catch(() => 0);
        if (duration > 0) {
          track.duration = duration; // eslint-disable-line no-param-reassign
        }
      }
    };
    const concurrency = Math.min(4, pending.length);
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    return safeTracks;
  }

  static get_player_music_metadata(playerResponse) {
    const payload =
      playerResponse && this.parse_json_payload(playerResponse.data);
    const data = payload && payload.data;
    return {
      bgmTitle: data && data.bgm_info && data.bgm_info.music_title,
    };
  }

  static fetch_bilibili_player_metadata(context) {
    if (!context || !context.bvid || !context.cid) {
      return Promise.resolve({ bgmTitle: '' });
    }
    const config = {
      withCredentials: true,
      timeout: BILIBILI_LYRIC_REQUEST_TIMEOUT,
      params: {
        bvid: context.bvid,
        cid: context.cid,
      },
    };
    const unsignedRequest = axios
      .get('https://api.bilibili.com/x/player/v2', config)
      .catch(() => undefined);

    return unsignedRequest
      .then((response) => {
        const result = this.get_player_music_metadata(response);
        if (result.bgmTitle) {
          return result;
        }
        return bilibili
          .wrap_wbi_request(
            'https://api.bilibili.com/x/player/wbi/v2',
            {
              bvid: context.bvid,
              cid: context.cid,
            },
            {
              withCredentials: true,
              timeout: BILIBILI_LYRIC_REQUEST_TIMEOUT,
            }
          )
          .then((signedResponse) => {
            const signedResult = this.get_player_music_metadata(signedResponse);
            return {
              bgmTitle: signedResult.bgmTitle || result.bgmTitle,
            };
          });
      })
      .catch(() => ({ bgmTitle: '' }));
  }

  static fetch_bilibili_audio_lyric(lyricUrl) {
    if (
      !lyricUrl ||
      lyricUrl === 'null' ||
      lyricUrl === 'undefined' ||
      lyricUrl === 'None'
    ) {
      return Promise.resolve({ lyric: '' });
    }
    let targetUrl = lyricUrl;
    if (targetUrl.startsWith('//')) {
      targetUrl = `https:${targetUrl}`;
    } else if (targetUrl.startsWith('/')) {
      targetUrl = `https://www.bilibili.com${targetUrl}`;
    }
    return axios
      .get(targetUrl, {
        withCredentials: true,
        timeout: BILIBILI_LYRIC_REQUEST_TIMEOUT,
      })
      .then((response) => {
        const payload = this.parse_json_payload(response.data);
        const lyric =
          typeof payload === 'string'
            ? payload
            : payload && (payload.lyric || payload.lrc);
        return {
          lyric: typeof lyric === 'string' ? lyric : '',
          tlyric: '',
          source: 'bilibili-audio',
          matchedTitle: '',
        };
      })
      .catch(() => ({ lyric: '' }));
  }

  static fetch_qq_lyric_search(query) {
    const cacheKey = this.normalize_match_text(query);
    const cached = bilibiliQQLyricSearchCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.request;
    }
    const targetUrl =
      'https://c.y.qq.com/soso/fcgi-bin/client_search_cp' +
      '?p=1&n=20&format=json' +
      `&w=${encodeURIComponent(query)}`;
    const request = axios
      .get(targetUrl, {
        timeout: QQ_LYRIC_REQUEST_TIMEOUT,
      })
      .then((response) => {
        const payload = this.parse_json_payload(response.data);
        const items =
          payload &&
          payload.data &&
          payload.data.song &&
          payload.data.song.list;
        if (!payload || Number(payload.code) !== 0 || !Array.isArray(items)) {
          throw new Error('QQ lyric search returned an invalid response');
        }
        return items;
      })
      .catch((error) => {
        bilibiliQQLyricSearchCache.delete(cacheKey);
        throw error;
      });
    bilibiliQQLyricSearchCache.set(cacheKey, {
      expiresAt: Date.now() + QQ_LYRIC_SEARCH_CACHE_TTL,
      request,
    });
    while (bilibiliQQLyricSearchCache.size > 40) {
      bilibiliQQLyricSearchCache.delete(
        bilibiliQQLyricSearchCache.keys().next().value
      );
    }
    return request;
  }

  static fetch_qq_lyric(songMid) {
    const targetUrl =
      'https://i.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?' +
      `songmid=${encodeURIComponent(songMid)}` +
      '&g_tk=5381&format=json&inCharset=utf8&outCharset=utf-8&nobase64=1';
    return axios
      .get(targetUrl, {
        timeout: QQ_LYRIC_REQUEST_TIMEOUT,
      })
      .then((response) => {
        const payload = this.parse_json_payload(response.data);
        if (!payload || Number(payload.retcode) !== 0) {
          return null;
        }
        const lyric = this.normalize_lrclib_lyric(payload.lyric);
        if (!lyric) {
          return null;
        }
        return {
          lyric,
          tlyric: this.normalize_lrclib_lyric(
            String(payload.trans || '').replace(/\/\//g, '')
          ),
        };
      });
  }

  static score_qq_candidate(item, scoringHints, index) {
    return this.score_kuwo_candidate(
      {
        NAME: item.name || item.songname,
        SONGNAME: item.name || item.songname,
        ARTIST: item.singer && item.singer[0] ? item.singer[0].name : '',
        ALBUM: item.album ? item.album.name : item.albumname,
        DURATION: item.interval,
      },
      scoringHints,
      index
    );
  }

  static search_qq_lyric_candidates(hints) {
    const scoringHints = this.build_lyric_scoring_hints(hints);
    const searchText =
      this.clean_music_title(hints.query) ||
      this.clean_music_title(hints.bgmTitle) ||
      scoringHints.variants[0];
    if (!searchText) {
      return Promise.resolve([]);
    }

    return this.fetch_qq_lyric_search(searchText).then((items) => {
      const scoredCandidates = items
        .filter((item) => item && (item.mid || item.songmid))
        .map((item, index) => ({
          item,
          scored: this.score_qq_candidate(item, scoringHints, index),
        }))
        .filter((candidate) => candidate.scored.score >= 0.3)
        .sort((left, right) => right.scored.score - left.scored.score)
        .slice(0, 6);
      if (scoredCandidates.length === 0) {
        return [];
      }
      return Promise.allSettled(
        scoredCandidates.map((candidate) =>
          this.fetch_qq_lyric(
            candidate.item.mid || candidate.item.songmid
          ).then((lyricResult) => {
            if (!lyricResult) {
              return null;
            }
            const { item, scored } = candidate;
            const songMid = item.mid || item.songmid;
            return {
              id: `qq_${songMid}`,
              provider: 'QQ',
              title: item.name || item.songname || '',
              artist: item.singer && item.singer[0] ? item.singer[0].name : '',
              album: item.album ? item.album.name || '' : item.albumname || '',
              duration: this.parse_duration(item.interval),
              lyric: lyricResult.lyric,
              tlyric: lyricResult.tlyric,
              matchScore: scored.score,
            };
          })
        )
      ).then((results) => {
        const fulfilled = results.filter(
          (result) => result.status === 'fulfilled'
        );
        if (fulfilled.length === 0) {
          throw new Error('QQ lyric requests failed');
        }
        return fulfilled.map((result) => result.value).filter(Boolean);
      });
    });
  }

  static find_qq_lyric(hints) {
    return this.search_qq_lyric_candidates(hints)
      .then((candidates) => {
        const candidate = candidates.find(
          (item) => item.matchScore >= BILIBILI_AUTO_LYRIC_MATCH_THRESHOLD
        );
        if (!candidate) {
          return { lyric: '' };
        }
        return {
          lyric: candidate.lyric,
          tlyric: candidate.tlyric,
          source: 'qq-match',
          matchedTitle: candidate.title,
          matchedArtist: candidate.artist,
          matchedAlbum: candidate.album,
          matchedDuration: candidate.duration,
          matchScore: candidate.matchScore,
          candidateId: candidate.id,
        };
      })
      .catch(() => ({ lyric: '' }));
  }

  static get_netease_artist(item) {
    const artists = item.artists || item.ar || [];
    return artists
      .map((artist) => artist && artist.name)
      .filter(Boolean)
      .join('/');
  }

  static get_netease_album(item) {
    const album = item.album || item.al || {};
    return album.name || '';
  }

  static fetch_netease_lyric_search(query) {
    const cacheKey = this.normalize_match_text(query);
    const cached = bilibiliNeteaseLyricSearchCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.request;
    }
    const targetUrl =
      'https://music.163.com/api/search/get/web' +
      `?s=${encodeURIComponent(query)}` +
      '&type=1&offset=0&limit=20';
    const request = axios
      .get(targetUrl, {
        timeout: NETEASE_LYRIC_REQUEST_TIMEOUT,
      })
      .then((response) => {
        const payload = this.parse_json_payload(response.data);
        const items = payload && payload.result && payload.result.songs;
        if (!Array.isArray(items)) {
          throw new Error('NetEase lyric search returned an invalid response');
        }
        return items;
      })
      .catch((error) => {
        bilibiliNeteaseLyricSearchCache.delete(cacheKey);
        throw error;
      });
    bilibiliNeteaseLyricSearchCache.set(cacheKey, {
      expiresAt: Date.now() + NETEASE_LYRIC_SEARCH_CACHE_TTL,
      request,
    });
    while (bilibiliNeteaseLyricSearchCache.size > 40) {
      bilibiliNeteaseLyricSearchCache.delete(
        bilibiliNeteaseLyricSearchCache.keys().next().value
      );
    }
    return request;
  }

  static fetch_netease_lyric(songId) {
    const targetUrl =
      'https://music.163.com/api/song/lyric' +
      `?id=${encodeURIComponent(songId)}` +
      '&lv=-1&kv=-1&tv=-1';
    return axios
      .get(targetUrl, {
        timeout: NETEASE_LYRIC_REQUEST_TIMEOUT,
      })
      .then((response) => {
        const payload = this.parse_json_payload(response.data);
        const lyric = this.normalize_lrclib_lyric(
          payload && payload.lrc && payload.lrc.lyric
        );
        if (!lyric) {
          return null;
        }
        return {
          lyric,
          tlyric: this.normalize_lrclib_lyric(
            payload && payload.tlyric && payload.tlyric.lyric
          ),
        };
      });
  }

  static score_netease_candidate(item, scoringHints, index) {
    return this.score_kuwo_candidate(
      {
        NAME: item.name,
        SONGNAME: item.name,
        ARTIST: this.get_netease_artist(item),
        ALBUM: this.get_netease_album(item),
        DURATION: Number(item.duration || item.dt || 0) / 1000,
      },
      scoringHints,
      index
    );
  }

  static search_netease_lyric_candidates(hints) {
    const scoringHints = this.build_lyric_scoring_hints(hints);
    const searchText =
      this.clean_music_title(hints.query) ||
      this.clean_music_title(hints.bgmTitle) ||
      scoringHints.variants[0];
    if (!searchText) {
      return Promise.resolve([]);
    }

    return this.fetch_netease_lyric_search(searchText).then((items) => {
      const scoredCandidates = items
        .filter((item) => item && item.id)
        .map((item, index) => ({
          item,
          scored: this.score_netease_candidate(item, scoringHints, index),
        }))
        .filter((candidate) => candidate.scored.score >= 0.3)
        .sort((left, right) => right.scored.score - left.scored.score)
        .slice(0, 6);
      if (scoredCandidates.length === 0) {
        return [];
      }
      return Promise.allSettled(
        scoredCandidates.map((candidate) =>
          this.fetch_netease_lyric(candidate.item.id).then((lyricResult) => {
            if (!lyricResult) {
              return null;
            }
            const { item, scored } = candidate;
            return {
              id: `netease_${item.id}`,
              provider: '网易云',
              title: item.name || '',
              artist: this.get_netease_artist(item),
              album: this.get_netease_album(item),
              duration: scored.candidateDuration,
              lyric: lyricResult.lyric,
              tlyric: lyricResult.tlyric,
              matchScore: scored.score,
            };
          })
        )
      ).then((results) => {
        const fulfilled = results.filter(
          (result) => result.status === 'fulfilled'
        );
        if (fulfilled.length === 0) {
          throw new Error('NetEase lyric requests failed');
        }
        return fulfilled.map((result) => result.value).filter(Boolean);
      });
    });
  }

  static has_meaningful_lyric(value) {
    return String(value || '')
      .split(/\r?\n/)
      .some(
        (line) =>
          line
            .replace(/\[[^\]]+\]/g, '')
            .replace(/\s+/g, ' ')
            .trim().length > 0
      );
  }

  static find_netease_lyric(hints) {
    return this.search_netease_lyric_candidates(hints)
      .then((candidates) => {
        const eligible = candidates
          .filter(
            (item) => item.matchScore >= BILIBILI_AUTO_LYRIC_MATCH_THRESHOLD
          )
          .sort((left, right) => {
            const translationDifference =
              Number(this.has_meaningful_lyric(right.tlyric)) -
              Number(this.has_meaningful_lyric(left.tlyric));
            return translationDifference || right.matchScore - left.matchScore;
          });
        const candidate = eligible[0];
        if (!candidate) {
          return { lyric: '' };
        }
        return {
          lyric: candidate.lyric,
          tlyric: candidate.tlyric,
          source: 'netease-match',
          matchedTitle: candidate.title,
          matchedArtist: candidate.artist,
          matchedAlbum: candidate.album,
          matchedDuration: candidate.duration,
          matchScore: candidate.matchScore,
          candidateId: candidate.id,
        };
      })
      .catch(() => ({ lyric: '' }));
  }

  static find_catalog_lyric(hints) {
    return Promise.allSettled([
      this.find_qq_lyric(hints),
      this.find_netease_lyric(hints),
    ]).then((results) => {
      const candidates = results
        .filter(
          (result) =>
            result.status === 'fulfilled' && result.value && result.value.lyric
        )
        .map((result) => result.value)
        .sort(
          (left, right) =>
            Number(right.matchScore || 0) - Number(left.matchScore || 0)
        );
      if (candidates.length === 0) {
        return { lyric: '' };
      }
      const bestScore = Number(candidates[0].matchScore || 0);
      const bilingualCandidate = candidates.find(
        (candidate) =>
          this.has_meaningful_lyric(candidate.tlyric) &&
          Number(candidate.matchScore || 0) >= bestScore - 0.04
      );
      return bilingualCandidate || candidates[0];
    });
  }

  static find_bilingual_catalog_lyric(hints) {
    return Promise.allSettled([
      this.search_qq_lyric_candidates(hints),
      this.search_netease_lyric_candidates(hints),
    ]).then((results) => {
      const candidates = results
        .filter((result) => result.status === 'fulfilled')
        .flatMap((result) => result.value || [])
        .filter(
          (candidate) =>
            candidate &&
            candidate.lyric &&
            candidate.matchScore >= BILIBILI_AUTO_LYRIC_MATCH_THRESHOLD &&
            this.has_meaningful_lyric(candidate.tlyric)
        )
        .sort(
          (left, right) =>
            Number(right.matchScore || 0) - Number(left.matchScore || 0)
        );
      return candidates[0] || null;
    });
  }

  static enrich_manual_lyric_candidate(candidate, trackInfo = {}) {
    if (!candidate || !candidate.lyric) {
      return Promise.resolve(candidate);
    }
    if (this.has_meaningful_lyric(candidate.tlyric)) {
      return Promise.resolve(candidate);
    }
    const hints = {
      title: candidate.title || trackInfo.title || '',
      artist: candidate.artist || trackInfo.artist || '',
      duration: candidate.duration || trackInfo.duration || 0,
    };
    return this.find_bilingual_catalog_lyric(hints)
      .then((bilingualCandidate) => {
        if (!bilingualCandidate) {
          return candidate;
        }
        return {
          ...candidate,
          id: bilingualCandidate.id || candidate.id,
          provider: bilingualCandidate.provider || candidate.provider,
          title: bilingualCandidate.title || candidate.title,
          artist: bilingualCandidate.artist || candidate.artist,
          album: bilingualCandidate.album || candidate.album,
          duration: bilingualCandidate.duration || candidate.duration,
          lyric: bilingualCandidate.lyric,
          tlyric: bilingualCandidate.tlyric,
          matchScore: bilingualCandidate.matchScore,
          selectedProvider: candidate.provider || '',
          selectedCandidateId: candidate.id || '',
          translationProvider: bilingualCandidate.provider || '',
          translationEnriched: true,
        };
      })
      .catch(() => candidate);
  }

  static clean_lrclib_album(value) {
    const text = String(value || '').trim();
    const optionalMatch = /^Optional\(["']?(.*?)["']?\)$/.exec(text);
    return optionalMatch ? optionalMatch[1] : text;
  }

  static normalize_lrclib_lyric(value) {
    return String(value || '')
      .split('\n')
      .map((line) =>
        line.replace(/<\d{2,}:\d{2}(?:\.\d{1,3})?>/g, '').replace(/\s+$/g, '')
      )
      .join('\n');
  }

  static fetch_lrclib_search(query) {
    const cacheKey = this.normalize_match_text(query);
    const cached = bilibiliLyricSearchCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.request;
    }
    const targetUrl = `https://lrclib.net/api/search?q=${encodeURIComponent(
      query
    )}`;
    const request = axios
      .get(targetUrl, {
        timeout: LRCLIB_LYRIC_REQUEST_TIMEOUT,
        headers: {
          'Lrclib-Client': LRCLIB_CLIENT_ID,
        },
      })
      .then((response) => {
        const payload = this.parse_json_payload(response.data);
        const items = Array.isArray(payload) ? payload : [];
        const expiresAt = Date.now() + LRCLIB_SEARCH_CACHE_TTL;
        const resolvedRequest = Promise.resolve(items);
        items.slice(0, 12).forEach((item) => {
          const titleKey = this.normalize_match_text(item.trackName);
          const fullKey = this.normalize_match_text(
            `${item.artistName || ''} ${item.trackName || ''}`
          );
          [titleKey, fullKey].filter(Boolean).forEach((key) => {
            bilibiliLyricSearchCache.set(key, {
              expiresAt,
              request: resolvedRequest,
            });
          });
        });
        while (bilibiliLyricSearchCache.size > 60) {
          bilibiliLyricSearchCache.delete(
            bilibiliLyricSearchCache.keys().next().value
          );
        }
        return items;
      })
      .catch((error) => {
        bilibiliLyricSearchCache.delete(cacheKey);
        throw error;
      });
    bilibiliLyricSearchCache.set(cacheKey, {
      expiresAt: Date.now() + LRCLIB_SEARCH_CACHE_TTL,
      request,
    });
    return request;
  }

  static build_lyric_scoring_hints(hints) {
    const explicitQuery = this.clean_music_title(hints.query);
    const scoringTitles = explicitQuery
      ? [explicitQuery]
      : [hints.title, hints.partTitle, hints.videoTitle, hints.bgmTitle];
    return {
      variants: this.build_title_variants(scoringTitles),
      artist: explicitQuery ? '' : hints.artist || '',
      duration: this.parse_duration(hints.duration),
      rawTitle:
        explicitQuery ||
        `${hints.title || ''} ${hints.partTitle || ''} ${
          hints.videoTitle || ''
        }`,
    };
  }

  static score_lrclib_candidate(item, scoringHints, index) {
    return this.score_kuwo_candidate(
      {
        NAME: item.trackName,
        SONGNAME: item.trackName,
        ARTIST: item.artistName,
        ALBUM: item.albumName,
        DURATION: item.duration,
      },
      scoringHints,
      index
    );
  }

  static search_lrclib_lyric_candidates(hints) {
    const scoringHints = this.build_lyric_scoring_hints(hints);
    const searchText =
      this.clean_music_title(hints.query) ||
      this.clean_music_title(hints.bgmTitle) ||
      scoringHints.variants[0];
    if (!searchText) {
      return Promise.resolve([]);
    }

    return this.fetch_lrclib_search(searchText).then((items) => {
      const seen = new Set();
      return items
        .filter((item) => item && item.syncedLyrics && !item.instrumental)
        .map((item, index) => {
          const scored = this.score_lrclib_candidate(item, scoringHints, index);
          return {
            id: `lrclib_${item.id}`,
            provider: 'LRCLIB',
            title: item.trackName || '',
            artist: item.artistName || '',
            album: this.clean_lrclib_album(item.albumName),
            duration: this.parse_duration(item.duration),
            lyric: this.normalize_lrclib_lyric(item.syncedLyrics),
            tlyric: '',
            matchScore: scored.score,
          };
        })
        .sort((left, right) => right.matchScore - left.matchScore)
        .filter((candidate) => {
          const key = `${this.normalize_match_text(
            candidate.title
          )}|${this.normalize_match_text(
            candidate.artist
          )}|${this.normalize_match_text(candidate.album)}|${Math.round(
            candidate.duration
          )}`;
          if (seen.has(key)) {
            return false;
          }
          seen.add(key);
          return true;
        })
        .slice(0, 12);
    });
  }

  static search_kuwo_lyric_candidates(hints) {
    const scoringHints = this.build_lyric_scoring_hints(hints);
    const searchText =
      this.clean_music_title(hints.query) || scoringHints.variants[0];
    if (!searchText) {
      return Promise.resolve([]);
    }
    const targetUrl =
      'https://www.kuwo.cn/search/searchMusicBykeyWord' +
      '?vipver=1&client=kt&ft=music&cluster=0&strategy=2012' +
      '&encoding=utf8&rformat=json&mobi=1&issubtitle=1' +
      '&show_copyright_off=1&pn=0&rn=20' +
      `&all=${encodeURIComponent(searchText)}`;

    return this.fetch_kuwo_search(targetUrl).then((response) => {
      if (!response) {
        throw new Error('Kuwo lyric search unavailable');
      }
      const payload = response && this.parse_json_payload(response.data);
      const items =
        payload && Array.isArray(payload.abslist) ? payload.abslist : [];
      const candidates = items
        .map((item, index) =>
          this.score_kuwo_candidate(item, scoringHints, index)
        )
        .filter((candidate) => candidate.score >= 0.35)
        .sort((left, right) => right.score - left.score)
        .slice(0, 2);

      return candidates.reduce(
        (request, candidate) =>
          request.then((results) => {
            const musicId =
              candidate.item.DC_TARGETID ||
              String(candidate.item.MUSICRID || '')
                .split('_')
                .pop();
            if (!musicId) {
              return results;
            }
            const lyricUrl = `https://m.kuwo.cn/newh5/singles/songinfoandlrc?musicId=${encodeURIComponent(
              musicId
            )}`;
            return axios
              .get(lyricUrl, {
                timeout: BILIBILI_LYRIC_REQUEST_TIMEOUT,
              })
              .then((lyricResponse) => {
                const lyricPayload = this.parse_json_payload(
                  lyricResponse.data
                );
                const lyric = this.kuwo_lyric_to_lrc(
                  lyricPayload && lyricPayload.data && lyricPayload.data.lrclist
                );
                if (!lyric) {
                  return results;
                }
                return [
                  ...results,
                  {
                    id: `kuwo_${musicId}`,
                    provider: 'KUWO',
                    title: candidate.item.NAME || candidate.item.SONGNAME || '',
                    artist: candidate.item.ARTIST || '',
                    album: candidate.item.ALBUM || '',
                    duration: candidate.candidateDuration,
                    lyric,
                    tlyric: '',
                    matchScore: candidate.score,
                  },
                ];
              })
              .catch(() => results);
          }),
        Promise.resolve([])
      );
    });
  }

  static search_lyric_candidates(hints) {
    return this.search_qq_lyric_candidates(hints);
  }

  static search_supplemental_lyric_candidates(hints) {
    return Promise.allSettled([
      this.search_netease_lyric_candidates(hints),
      this.search_lrclib_lyric_candidates(hints),
      this.search_kuwo_lyric_candidates(hints),
    ]).then((results) => {
      const fulfilled = results.filter(
        (result) => result.status === 'fulfilled'
      );
      if (fulfilled.length === 0) {
        throw new Error('Supplemental lyric searches failed');
      }
      return fulfilled.flatMap((result) => result.value || []);
    });
  }

  static find_lrclib_lyric(hints) {
    return this.search_lrclib_lyric_candidates(hints)
      .then((candidates) => {
        const candidate = candidates.find(
          (item) => item.matchScore >= BILIBILI_AUTO_LYRIC_MATCH_THRESHOLD
        );
        if (!candidate) {
          return { lyric: '' };
        }
        return {
          lyric: candidate.lyric,
          tlyric: '',
          source: 'lrclib-match',
          matchedTitle: candidate.title,
          matchedArtist: candidate.artist,
          matchedAlbum: candidate.album,
          matchedDuration: candidate.duration,
          matchScore: candidate.matchScore,
          candidateId: candidate.id,
        };
      })
      .catch(() => ({ lyric: '' }));
  }

  static fetch_kuwo_search(targetUrl) {
    return axios
      .get(targetUrl, { timeout: BILIBILI_LYRIC_REQUEST_TIMEOUT })
      .catch(
        () =>
          new Promise((resolve) => {
            let settled = false;
            const timeout = setTimeout(() => {
              if (!settled) {
                settled = true;
                resolve(undefined);
              }
            }, 4500);
            kuwo.kw_cookie_get(targetUrl, (response) => {
              if (!settled) {
                settled = true;
                clearTimeout(timeout);
                resolve(response);
              }
            });
          })
      );
  }

  static find_kuwo_lyric(hints) {
    const variants = this.build_title_variants([
      hints.title,
      hints.partTitle,
      hints.videoTitle,
      hints.bgmTitle,
    ]);
    if (variants.length === 0) {
      return Promise.resolve({ lyric: '' });
    }
    const searchText = this.clean_music_title(hints.bgmTitle) || variants[0];
    const targetUrl =
      'https://www.kuwo.cn/search/searchMusicBykeyWord' +
      '?vipver=1&client=kt&ft=music&cluster=0&strategy=2012' +
      '&encoding=utf8&rformat=json&mobi=1&issubtitle=1' +
      '&show_copyright_off=1&pn=0&rn=30' +
      `&all=${encodeURIComponent(searchText)}`;
    const scoringHints = {
      variants,
      artist: hints.artist || '',
      duration: this.parse_duration(hints.duration),
      rawTitle: `${hints.title || ''} ${hints.partTitle || ''} ${
        hints.videoTitle || ''
      }`,
    };

    return this.fetch_kuwo_search(targetUrl)
      .then((response) => {
        const payload = response && this.parse_json_payload(response.data);
        const items =
          payload && Array.isArray(payload.abslist) ? payload.abslist : [];
        return items
          .map((item, index) =>
            this.score_kuwo_candidate(item, scoringHints, index)
          )
          .filter(
            (candidate) =>
              candidate.score >= BILIBILI_AUTO_LYRIC_MATCH_THRESHOLD
          )
          .sort((left, right) => right.score - left.score)
          .slice(0, 3);
      })
      .then((candidates) => {
        const tryCandidate = (index) => {
          if (index >= candidates.length) {
            return Promise.resolve({ lyric: '' });
          }
          const candidate = candidates[index];
          const musicId =
            candidate.item.DC_TARGETID ||
            String(candidate.item.MUSICRID || '')
              .split('_')
              .pop();
          if (!musicId) {
            return tryCandidate(index + 1);
          }
          const lyricUrl = `https://m.kuwo.cn/newh5/singles/songinfoandlrc?musicId=${encodeURIComponent(
            musicId
          )}`;
          return axios
            .get(lyricUrl, {
              timeout: BILIBILI_LYRIC_REQUEST_TIMEOUT,
            })
            .then((response) => {
              const payload = this.parse_json_payload(response.data);
              const data = payload && payload.data;
              const lyric = this.kuwo_lyric_to_lrc(data && data.lrclist);
              if (!lyric) {
                return tryCandidate(index + 1);
              }
              return {
                lyric,
                tlyric: '',
                source: 'kuwo-match',
                matchedTitle: candidate.item.NAME || '',
                matchedArtist: candidate.item.ARTIST || '',
                matchedDuration: candidate.candidateDuration,
                matchScore: candidate.score,
              };
            })
            .catch(() => tryCandidate(index + 1));
        };
        return tryCandidate(0);
      })
      .catch(() => ({ lyric: '' }));
  }

  static resolve_lyric(options) {
    const manualLyric = this.get_manual_lyric(options.trackId, options);
    if (manualLyric) {
      if (this.has_meaningful_lyric(manualLyric.tlyric)) {
        return Promise.resolve(manualLyric);
      }
      const manualCandidate = {
        id: manualLyric.candidateId,
        provider: manualLyric.matchedProvider,
        title: manualLyric.matchedTitle,
        artist: manualLyric.matchedArtist,
        album: manualLyric.matchedAlbum,
        duration: manualLyric.matchedDuration,
        lyric: manualLyric.lyric,
        tlyric: manualLyric.tlyric,
        machineTranslated: manualLyric.machineTranslated === true,
        machineTranslationProvider:
          manualLyric.machineTranslationProvider || '',
        machineTranslationTarget: manualLyric.machineTranslationTarget || '',
        machineTranslationDetectedSource:
          manualLyric.machineTranslationDetectedSource || '',
      };
      return this.enrich_manual_lyric_candidate(manualCandidate, options).then(
        (enrichedCandidate) => {
          if (
            !enrichedCandidate ||
            !this.has_meaningful_lyric(enrichedCandidate.tlyric)
          ) {
            return manualLyric;
          }
          const saveResult = this.save_manual_lyric(
            options.trackId,
            enrichedCandidate,
            options
          );
          return saveResult.ok
            ? this.get_manual_lyric(options.trackId, options) || manualLyric
            : manualLyric;
        }
      );
    }
    return this.fetch_bilibili_audio_lyric(options.lyricUrl).then(
      (audioLyric) => {
        const directHints = {
          title: options.title,
          artist: options.artist,
          duration: options.duration,
        };
        return this.find_catalog_lyric(directHints).then(
          (directCatalogResult) => {
            if (
              directCatalogResult.lyric &&
              this.has_meaningful_lyric(directCatalogResult.tlyric)
            ) {
              return directCatalogResult;
            }
            if (audioLyric.lyric) {
              return audioLyric;
            }
            if (directCatalogResult.lyric) {
              return directCatalogResult;
            }
            return this.find_lrclib_lyric(directHints).then(
              (directLRCLIBResult) => {
                if (directLRCLIBResult.lyric) {
                  return directLRCLIBResult;
                }
                return this.get_video_context(options.trackId).then(
                  (context) => {
                    const safeContext = context || {};
                    return this.fetch_bilibili_player_metadata(
                      safeContext
                    ).then((playerMetadata) => {
                      const enhancedHints = {
                        title: options.title,
                        artist: options.artist || safeContext.artist,
                        duration: safeContext.duration || options.duration,
                        partTitle: safeContext.partTitle,
                        videoTitle: safeContext.videoTitle,
                        bgmTitle: playerMetadata.bgmTitle,
                      };
                      return this.find_catalog_lyric(enhancedHints).then(
                        (enhancedCatalogResult) => {
                          if (enhancedCatalogResult.lyric) {
                            return enhancedCatalogResult;
                          }
                          return this.find_lrclib_lyric(enhancedHints).then(
                            (enhancedLRCLIBResult) => {
                              if (enhancedLRCLIBResult.lyric) {
                                return enhancedLRCLIBResult;
                              }
                              return this.find_kuwo_lyric(enhancedHints);
                            }
                          );
                        }
                      );
                    });
                  }
                );
              }
            );
          }
        );
      }
    );
  }

  static fetch_wbi_key() {
    return axios({
      url: 'https://api.bilibili.com/x/web-interface/nav',
      method: 'get',
      responseType: 'json',
    }).then((resp) => {
      const json_content = resp.data;
      const { img_url } = json_content.data.wbi_img;
      const { sub_url } = json_content.data.wbi_img;
      return {
        img_key: img_url.slice(
          img_url.lastIndexOf('/') + 1,
          img_url.lastIndexOf('.')
        ),
        sub_key: sub_url.slice(
          sub_url.lastIndexOf('/') + 1,
          sub_url.lastIndexOf('.')
        ),
      };
    });
  }

  static clear_wbi_key() {
    wbi_key = null;
  }

  static get_wbi_key() {
    if (wbi_key) {
      return Promise.resolve(wbi_key);
    }
    return bilibili.fetch_wbi_key().then((key) => {
      wbi_key = key;
      return key;
    });
  }

  static enc_wbi(params) {
    return bilibili.get_wbi_key().then(({ img_key, sub_key }) => {
      const mixinKeyEncTab = [
        46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5,
        49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24,
        55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63,
        57, 62, 11, 36, 20, 34, 44, 52,
      ];

      // 对 imgKey 和 subKey 进行字符顺序打乱编码
      function get_mixin_key(original) {
        let temp = '';
        mixinKeyEncTab.forEach((n) => {
          temp += original[n];
        });
        return temp.slice(0, 32);
      }

      const mixin_key = get_mixin_key(img_key + sub_key);
      const curr_time = Math.round(Date.now() / 1000);
      const chr_filter = /[!'()*]/g;
      const query = [];
      Object.assign(params, { wts: curr_time }); // 添加 wts 字段
      // 按照 key 重排参数
      Object.keys(params)
        .sort()
        .forEach((key) => {
          query.push(
            `${encodeURIComponent(key)}=${encodeURIComponent(
              // 过滤 value 中的 "!'()*" 字符
              params[key].toString().replace(chr_filter, '')
            )}`
          );
        });
      const query_string = query.join('&');
      const wbi_sign = window.forge.md5
        .create()
        .update(window.forge.util.encodeUtf8(query_string + mixin_key))
        .digest()
        .toHex();
      return `${query_string}&w_rid=${wbi_sign}`;
    });
  }

  static wrap_wbi_request(url, params, config = {}) {
    return bilibili
      .enc_wbi(params)
      .then((query_string) => {
        const target_url = `${url}?${query_string}`;
        return axios.get(target_url, config);
      })
      .catch(() => {
        // 失败时进行一次清空 wbi_key 后的重试，避免因为 wbi_key 过期导致的错误
        bilibili.clear_wbi_key();
        return bilibili
          .enc_wbi(params)
          .then((query_string) => {
            const target_url = `${url}?${query_string}`;
            return axios.get(target_url, config);
          })
          .catch(() => undefined);
      });
  }

  static bi_convert_song(song_info) {
    const track = {
      id: `bitrack_${song_info.id}`,
      title: song_info.title,
      artist: song_info.uname,
      artist_id: `biartist_${song_info.uid}`,
      source: 'bilibili',
      source_url: `https://www.bilibili.com/audio/au${song_info.id}`,
      img_url: song_info.cover,
      // url: song_info.id,
      lyric_url: song_info.lyric,
      duration: this.parse_duration(song_info.duration),
    };
    return track;
  }

  static bi_convert_song2(song_info) {
    let imgUrl = song_info.pic;
    if (imgUrl.startsWith('//')) {
      imgUrl = `https:${imgUrl}`;
    }
    const track = {
      id: `bitrack_v_${song_info.bvid}`,
      title: this.htmlDecode(song_info.title),
      artist: this.htmlDecode(song_info.author),
      artist_id: `biartist_v_${song_info.mid}`,
      source: 'bilibili',
      source_url: `https://www.bilibili.com/${song_info.bvid}`,
      img_url: imgUrl,
      duration: this.parse_duration(song_info.duration),
    };
    return track;
  }

  static get_android_http_adapter() {
    if (typeof window === 'undefined') return null;
    const adapter = window.Listen2AndroidHttpAdapter;
    if (
      !adapter ||
      typeof adapter.isAvailable !== 'function' ||
      typeof adapter.get !== 'function'
    ) {
      return null;
    }
    try {
      return adapter.isAvailable() ? adapter : null;
    } catch (error) {
      return null;
    }
  }

  static create_android_search_failure(error) {
    return {
      status:
        (error && typeof error.code === 'string' && error.code) ||
        'android-search-failed',
      message: 'Bilibili search could not be completed through Android HTTP.',
    };
  }

  static parse_android_search_response(response) {
    if (!response || typeof response.body !== 'string') {
      throw new Error(
        'Android HTTP returned an invalid Bilibili search response.'
      );
    }
    const payload = JSON.parse(response.body);
    const data = payload && payload.data;
    if (!data || !Array.isArray(data.result)) {
      throw new Error('Bilibili search returned an invalid response.');
    }
    const total = Number(data.numResults);
    return {
      result: data.result.map((song) => this.bi_convert_song2(song)),
      total: Number.isFinite(total) && total >= 0 ? total : 0,
    };
  }

  static parse_android_typed_search_response(response) {
    const result = response && response.result;
    if (
      !result ||
      result.source !== 'bilibili' ||
      !Array.isArray(result.rows) ||
      !Number.isFinite(result.total)
    ) {
      throw new Error('Android typed search returned an invalid response.');
    }
    return {
      total: Math.max(0, result.total),
      result: result.rows.map((row) => ({
        artist: row.author,
        artist_id: Number.isFinite(row.authorId)
          ? `biartist_v_${row.authorId}`
          : '',
        duration: this.parse_duration(row.duration || ''),
        id: row.id,
        img_url: row.cover || '',
        source: 'bilibili',
        source_url: `https://www.bilibili.com/${row.bvid}`,
        title: row.title,
      })),
    };
  }

  static show_playlist(url) {
    let offset = getParameterByName('offset', url);
    if (offset === undefined) {
      offset = 0;
    }
    const page = offset / 20 + 1;
    const target_url = `https://www.bilibili.com/audio/music-service-c/web/menu/hit?ps=20&pn=${page}`;
    return {
      success: (fn) => {
        axios.get(target_url).then((response) => {
          const { data } = response.data.data;
          const result = data.map((item) => ({
            cover_img_url: item.cover,
            title: item.title,
            id: `biplaylist_${item.menuId}`,
            source_url: `https://www.bilibili.com/audio/am${item.menuId}`,
          }));
          return fn({
            result,
          });
        });
      },
    };
  }

  static bi_get_playlist(url) {
    const list_id = getParameterByName('list_id', url).split('_').pop();
    const target_url = `https://www.bilibili.com/audio/music-service-c/web/menu/info?sid=${list_id}`;
    return {
      success: (fn) => {
        axios.get(target_url).then((response) => {
          const { data } = response.data;
          const info = {
            cover_img_url: data.cover,
            title: data.title,
            id: `biplaylist_${list_id}`,
            source_url: `https://www.bilibili.com/audio/am${list_id}`,
          };
          const target = `https://www.bilibili.com/audio/music-service-c/web/song/of-menu?pn=1&ps=100&sid=${list_id}`;
          axios.get(target).then((res) => {
            const tracks = res.data.data.data.map((item) =>
              this.bi_convert_song(item)
            );
            return fn({
              info,
              tracks,
            });
          });
        });
      },
    };
  }

  // eslint-disable-next-line no-unused-vars
  static bi_album(url) {
    return {
      success: (fn) =>
        fn({
          tracks: [],
          info: {},
        }),
      // bilibili havn't album
      // const album_id = getParameterByName('list_id', url).split('_').pop();
      // const target_url = '';
      // axios.get(target_url).then((response) => {
      //   const data = response.data;
      //   const info = {};
      //   const tracks = [];
      //   return fn({
      //     tracks,
      //     info,
      //   });
      // });
    };
  }

  static bi_track(url) {
    const track_id = getParameterByName('list_id', url).split('_').pop();
    return {
      success: (fn) => {
        const target_url = `https://api.bilibili.com/x/web-interface/view?bvid=${track_id}`;
        axios.get(target_url).then((response) => {
          const info = {
            cover_img_url: response.data.data.pic,
            title: response.data.data.title,
            id: `bitrack_v_${track_id}`,
            source_url: `https://www.bilibili.com/${track_id}`,
          };
          const author = response.data.data.owner;
          const default_img = response.data.data.pic;
          const tracks = response.data.data.pages.map((item) =>
            this.bi_convert_song3(item, track_id, author, default_img)
          );
          return fn({
            tracks,
            info,
          });
        });
      },
    };
  }

  static bi_convert_song3(song_info, bvid, author, default_img) {
    let imgUrl = song_info.first_frame;
    if (imgUrl === undefined) {
      imgUrl = default_img;
    } else if (imgUrl.startsWith('//')) {
      imgUrl = `https:${imgUrl}`;
    }
    const track = {
      id: `bitrack_v_${bvid}-${song_info.cid}`,
      title: this.htmlDecode(song_info.part),
      artist: this.htmlDecode(author.name),
      artist_id: `biartist_v_${author.mid}`,
      source: 'bilibili',
      source_url: `https://www.bilibili.com/${bvid}/?p=${song_info.page}`,
      img_url: imgUrl,
      duration: this.parse_duration(song_info.duration),
    };
    return track;
  }

  static bi_artist(url) {
    const artist_id = getParameterByName('list_id', url).split('_').pop();

    return {
      success: (fn) => {
        let target_url;
        bilibili
          .wrap_wbi_request('https://api.bilibili.com/x/space/wbi/acc/info', {
            mid: artist_id,
          })
          .then((response) => {
            const info = {
              cover_img_url: response.data.data.face,
              title: response.data.data.name,
              id: `biartist_${artist_id}`,
              source_url: `https://space.bilibili.com/${artist_id}/#/audio`,
            };
            if (getParameterByName('list_id', url).split('_').length === 3) {
              return bilibili
                .wrap_wbi_request(
                  'https://api.bilibili.com/x/space/wbi/arc/search',
                  {
                    mid: artist_id,
                    pn: 1,
                    ps: 25,
                    order: 'click',
                    index: 1,
                  }
                )
                .then((res) => {
                  const tracks = res.data.data.list.vlist.map((item) =>
                    this.bi_convert_song2(item)
                  );
                  return fn({
                    tracks,
                    info,
                  });
                });
            }
            target_url = `https://api.bilibili.com/audio/music-service-c/web/song/upper?pn=1&ps=0&order=2&uid=${artist_id}`;
            return axios.get(target_url).then((res) => {
              const tracks = res.data.data.data.map((item) =>
                this.bi_convert_song(item)
              );
              return fn({
                tracks,
                info,
              });
            });
          });
      },
    };
  }

  static parse_url(url) {
    let result;
    const match = /\/\/www.bilibili.com\/audio\/am([0-9]+)/.exec(url);
    if (match != null) {
      const playlist_id = match[1];
      result = {
        type: 'playlist',
        id: `biplaylist_${playlist_id}`,
      };
    }
    return {
      success: (fn) => {
        fn(result);
      },
    };
  }

  static get_can_play_type(kind, variant) {
    if (!variant || typeof document === 'undefined') {
      return 'maybe';
    }
    const element = document.createElement(
      kind === 'video' ? 'video' : 'audio'
    );
    const mimeType = String(variant.mimeType || '');
    const codecs = String(variant.codecs || '');
    const type = codecs ? `${mimeType}; codecs="${codecs}"` : mimeType;
    return element.canPlayType(type);
  }

  static create_media_failure(error, fallback = {}) {
    const source = error && typeof error === 'object' ? error : {};
    const rawStatus = String(
      source.status || source.code || fallback.status || 'request-failed'
    );
    const status = /^[a-z0-9-]{1,64}$/i.test(rawStatus)
      ? rawStatus.toLowerCase()
      : 'request-failed';
    const httpStatus = Number(source.httpStatus || fallback.httpStatus || 0);
    const bilibiliCode = Number(
      source.bilibiliCode || fallback.bilibiliCode || 0
    );
    const permanentStatuses = [
      'auth-required',
      'invalid-bvid',
      'invalid-cid',
      'missing-cid',
      'no-audio-stream',
      'no-compatible-audio-stream',
      'not-found',
      'private-video',
    ];
    const isPermanent =
      permanentStatuses.includes(status) ||
      httpStatus === 404 ||
      httpStatus === 410 ||
      bilibiliCode === -404 ||
      bilibiliCode === -101;
    const retryable = !isPermanent && source.retryable !== false;
    let permanentKind = status;
    if (httpStatus === 404 || httpStatus === 410 || bilibiliCode === -404) {
      permanentKind = 'not-found';
    } else if (bilibiliCode === -101) {
      permanentKind = 'auth-required';
    }
    let fallbackKind = 'network';
    if (isPermanent) {
      fallbackKind = permanentKind;
    } else if (status === 'request-timeout') {
      fallbackKind = 'timeout';
    }
    const rawKind = String(source.kind || fallback.kind || fallbackKind);
    const safeKinds = [
      'auth-required',
      'invalid-bvid',
      'invalid-cid',
      'missing-cid',
      'no-audio-stream',
      'no-compatible-audio-stream',
      'not-found',
      'private-video',
      'timeout',
      'network',
      'rate-limited',
      'request-rejected',
      'server',
      'unavailable',
    ];
    const kind =
      !isPermanent && safeKinds.includes(rawKind) ? rawKind : fallbackKind;
    const messages = {
      'auth-required': 'This Bilibili resource requires account access.',
      'no-audio-stream': 'No playable Bilibili audio stream is available.',
      'no-compatible-audio-stream':
        'No compatible Bilibili audio stream is available.',
      'not-found': 'This Bilibili resource is no longer available.',
      'private-video': 'This Bilibili resource is private.',
      timeout: 'The Bilibili request timed out.',
      network: 'The network request to Bilibili failed.',
      unavailable: 'The Bilibili media request failed.',
    };
    return {
      stage: ['manifest', 'legacy-manifest'].includes(
        String(source.stage || fallback.stage)
      )
        ? String(source.stage || fallback.stage)
        : 'manifest',
      kind,
      status,
      httpStatus: Number.isSafeInteger(httpStatus) ? httpStatus : 0,
      bilibiliCode: Number.isSafeInteger(bilibiliCode) ? bilibiliCode : 0,
      retryable,
      // The main process sends a safe message. Legacy Axios errors may contain
      // request URLs, so this callback always uses a local fixed message.
      message: messages[kind] || messages.unavailable,
    };
  }

  static select_playable_audio_variant(manifest) {
    const variants = Array.isArray(manifest && manifest.audioVariants)
      ? manifest.audioVariants
      : [];
    const normalAudio = variants.filter(
      (variant) => variant.specialType === 'normal'
    );
    const playable = variants.filter(
      (variant) => this.get_can_play_type('audio', variant) !== ''
    );
    // The main process keeps this array quality-ranked. Prefer the best format
    // Chromium can really decode (including Dolby/Hi-Res when supported), then
    // fall back to a normal stream if codec probing is unavailable.
    return playable[0] || normalAudio[0] || variants[0];
  }

  static get_video_media_manifest(track, forceRefresh = false) {
    const idParts = this.get_video_id_parts(track && track.id);
    if (
      !idParts ||
      typeof MediaService === 'undefined' ||
      typeof MediaService.getBilibiliMediaManifest !== 'function'
    ) {
      return Promise.reject(
        new Error('Bilibili desktop media bridge is unavailable.')
      );
    }
    return MediaService.getBilibiliMediaManifest({
      bvid: idParts.bvid,
      cid: idParts.cid,
      forceRefresh,
    }).then((response) => {
      if (!response || response.ok !== true || !response.manifest) {
        throw this.create_media_failure(response, {
          kind: 'unavailable',
          stage: 'manifest',
          status: 'request-failed',
        });
      }
      return response.manifest;
    });
  }

  static bootstrap_video_track_legacy(track, success, failure) {
    const sound = {};
    const idParts = this.get_video_id_parts(track && track.id);
    if (!idParts) {
      failure(
        this.create_media_failure(
          {},
          {
            status: 'invalid-bvid',
            stage: 'legacy-manifest',
          }
        )
      );
      return;
    }
    const targetUrl = `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(
      idParts.bvid
    )}`;
    axios
      .get(targetUrl)
      .then((response) => {
        const pages =
          (response.data && response.data.data && response.data.data.pages) ||
          [];
        const page =
          pages.find((item) => Number(item.cid) === Number(idParts.cid)) ||
          pages[0];
        const cid = idParts.cid || (page && Number(page.cid));
        if (!cid) {
          failure(
            this.create_media_failure(
              {},
              {
                status: 'missing-cid',
                stage: 'legacy-manifest',
              }
            )
          );
          return null;
        }
        return axios.get(
          `https://api.bilibili.com/x/player/playurl?fnval=4048&bvid=${encodeURIComponent(
            idParts.bvid
          )}&cid=${cid}`
        );
      })
      .then((response) => {
        if (!response) {
          return;
        }
        const audio =
          response.data &&
          response.data.data &&
          response.data.data.dash &&
          Array.isArray(response.data.data.dash.audio)
            ? response.data.data.dash.audio
            : [];
        const variants = audio
          .map((variant) => ({
            ...variant,
            mimeType: variant.mimeType || 'audio/mp4',
            url: variant.baseUrl || variant.base_url,
            specialType: 'normal',
          }))
          .filter((variant) => Boolean(variant.url))
          .sort((left, right) => {
            const quality = Number(right.id || 0) - Number(left.id || 0);
            return (
              quality ||
              Number(right.bandwidth || 0) - Number(left.bandwidth || 0)
            );
          });
        const selected = variants.find(
          (variant) => this.get_can_play_type('audio', variant) !== ''
        );
        if (!selected) {
          failure(
            this.create_media_failure(
              {},
              {
                status: 'no-compatible-audio-stream',
                stage: 'legacy-manifest',
              }
            )
          );
          return;
        }
        sound.url = selected.url;
        sound.bitrate = BILIBILI_AUDIO_QUALITY_LABELS[selected.id] || '';
        sound.platform = 'bilibili';
        success(sound);
      })
      .catch((error) =>
        failure(
          this.create_media_failure(error, {
            stage: 'legacy-manifest',
          })
        )
      );
  }

  static bootstrap_track(track, success, failure, options = {}) {
    const trackId = String((track && track.id) || '');
    const videoIdParts = this.get_video_id_parts(trackId);
    if (trackId.startsWith('bitrack_v_')) {
      if (
        typeof isElectron === 'function' &&
        isElectron() &&
        typeof MediaService !== 'undefined' &&
        typeof MediaService.getBilibiliMediaManifest === 'function'
      ) {
        return this.get_video_media_manifest(
          track,
          options.forceRefresh === true
        )
          .then((manifest) => {
            const audio = this.select_playable_audio_variant(manifest);
            if (!audio || !audio.url) {
              throw this.create_media_failure(
                {},
                {
                  status: 'no-compatible-audio-stream',
                  stage: 'manifest',
                }
              );
            }
            // Bilibili returns several equivalent CDN routes for the same
            // stream. Preserve all of them so the player can recover when a
            // single MCDN node is unavailable.
            const urlCandidates = [
              audio.url,
              ...(Array.isArray(audio.backupUrls) ? audio.backupUrls : []),
            ].filter(Boolean);
            success({
              url: urlCandidates[0],
              urlCandidates: [...new Set(urlCandidates)],
              bitrate: audio.label || '',
              duration: this.parse_duration(manifest.duration),
              platform: 'bilibili',
              audioCacheDescriptor: {
                kind: 'video',
                bvid: videoIdParts.bvid,
                cid: Number(manifest.cid || videoIdParts.cid || 0),
                audioId: Number(audio.id || 0),
                codecs: String(audio.codecs || ''),
                mimeType: String(audio.mimeType || ''),
              },
            });
          })
          .catch((error) => failure(this.create_media_failure(error)));
      }
      return this.bootstrap_video_track_legacy(track, success, failure);
    }
    const sound = {};
    const song_id = track.id.slice('bitrack_'.length);
    const target_url = `https://www.bilibili.com/audio/music-service-c/web/url?sid=${song_id}`;
    return axios
      .get(target_url)
      .then((response) => {
        const data = response && response.data;
        if (data && Number(data.code) === 0) {
          const cdns = Array.isArray(data.data && data.data.cdns)
            ? data.data.cdns.filter((url) => typeof url === 'string' && url)
            : [];
          if (!cdns.length) {
            failure(
              this.create_media_failure(
                {},
                {
                  status: 'no-audio-stream',
                  stage: 'legacy-manifest',
                }
              )
            );
            return;
          }
          [sound.url] = cdns;
          sound.platform = 'bilibili';
          sound.audioCacheDescriptor = {
            kind: 'audio',
            sid: song_id,
          };
          success(sound);
          return;
        }
        failure(
          this.create_media_failure(
            {
              code: 'bilibili-api-error',
              bilibiliCode: Number(data && data.code) || 0,
              httpStatus: Number(response && response.status) || 0,
            },
            {
              stage: 'legacy-manifest',
            }
          )
        );
      })
      .catch((error) =>
        failure(
          this.create_media_failure(error, {
            stage: 'legacy-manifest',
          })
        )
      );
  }

  static search(url) {
    return {
      success: (fn) => {
        const keyword = getParameterByName('keywords', url);
        const curpage = getParameterByName('curpage', url);

        const target_url = `https://api.bilibili.com/x/web-interface/search/type?__refresh__=true&_extra=&context=&page=${curpage}&page_size=42&platform=pc&highlight=1&single_column=0&keyword=${encodeURIComponent(
          keyword
        )}&category_id=&search_type=video&dynamic_offset=0&preload=true&com2co=true`;

        const androidHttp = this.get_android_http_adapter();
        if (androidHttp) {
          const finishFailure = (error) =>
            fn({
              result: [],
              total: 0,
              error: this.create_android_search_failure(error),
            });
          const androidSearch =
            typeof androidHttp.request === 'function'
              ? androidHttp.request(
                  'bilibili.search',
                  { keyword, page: Number(curpage) || 1 },
                  { pageEpoch: 0 }
                )
              : androidHttp.get(target_url);
          androidSearch.then(
            (response) => {
              try {
                fn(
                  response && response.result
                    ? this.parse_android_typed_search_response(response)
                    : this.parse_android_search_response(response)
                );
              } catch (error) {
                finishFailure(error);
              }
            },
            (error) => finishFailure(error)
          );
          return;
        }

        const domain = `https://api.bilibili.com`;
        const cookieName = 'buvid3';
        const expire =
          (new Date().getTime() + 1e3 * 60 * 60 * 24 * 365 * 100) / 1000;

        cookieSet(
          {
            url: domain,
            name: cookieName,
            value: '0',
            expirationDate: expire,
            sameSite: 'no_restriction',
          },
          () => {
            axios
              .get(target_url, { withCredentials: true })
              .then((response) => {
                const result = response.data.data.result.map((song) =>
                  this.bi_convert_song2(song)
                );
                const total = response.data.data.numResults;
                return fn({
                  result,
                  total,
                });
              });
          }
        );
      },
    };
  }

  static lyric(url) {
    const trackId = getParameterByName('track_id', url);
    const cached = bilibiliLyricCache.get(trackId);
    return {
      success: (fn) => {
        if (cached) {
          fn(cached);
          return;
        }
        bilibili
          .resolve_lyric({
            trackId,
            lyricUrl: getParameterByName('lyric_url', url),
            title: getParameterByName('title', url),
            artist: getParameterByName('artist', url),
            duration: getParameterByName('duration', url),
            sourceUrl: getParameterByName('source_url', url),
          })
          .then((result) => {
            const safeResult = result || { lyric: '' };
            if (safeResult.lyric) {
              bilibiliLyricCache.set(trackId, safeResult);
            }
            fn(safeResult);
          })
          .catch(() => fn({ lyric: '' }));
      },
    };
  }

  static get_playlist(url) {
    const list_id = getParameterByName('list_id', url).split('_')[0];
    switch (list_id) {
      case 'biplaylist':
        return this.bi_get_playlist(url);
      case 'bialbum':
        return this.bi_album(url);
      case 'biartist':
        return this.bi_artist(url);
      case 'bitrack':
        return this.bi_track(url);
      default:
        return null;
    }
  }

  static get_playlist_filters() {
    return {
      success: (fn) => fn({ recommend: [], all: [] }),
    };
  }

  static get_user() {
    return {
      success: (fn) => {
        if (
          typeof MediaService === 'undefined' ||
          typeof MediaService.getBilibiliAuthState !== 'function'
        ) {
          fn({ status: 'fail', data: {} });
          return;
        }
        MediaService.getBilibiliAuthState()
          .then((response) => {
            const state = response && response.state;
            if (
              !response ||
              response.ok !== true ||
              !state ||
              !state.loggedIn
            ) {
              fn({ status: 'fail', data: {} });
              return;
            }
            fn({
              status: 'success',
              data: {
                is_login: true,
                avatar: state.face || 'images/placeholder.png',
                nickname: state.uname || '哔哩哔哩用户',
                vip_type: state.vipType || 0,
                vip_status: state.vipStatus || 0,
              },
            });
          })
          .catch(() => fn({ status: 'fail', data: {} }));
      },
    };
  }

  static get_login_url() {
    return `https://www.bilibili.com`;
  }

  static logout() {
    if (
      typeof MediaService !== 'undefined' &&
      typeof MediaService.logoutBilibili === 'function'
    ) {
      return MediaService.logoutBilibili();
    }
    return Promise.resolve({ ok: false, status: 'unsupported' });
  }

  // return {
  //   show_playlist: bi_show_playlist,
  //   get_playlist_filters,
  //   get_playlist,
  //   parse_url: bi_parse_url,
  //   bootstrap_track: bi_bootstrap_track,
  //   search: bi_search,
  //   lyric: bi_lyric,
  //   get_user: bi_get_user,
  //   get_login_url: bi_get_login_url,
  //   logout: bi_logout,
  // };
}
