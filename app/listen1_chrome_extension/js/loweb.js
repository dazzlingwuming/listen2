/* global async LRUCache setPrototypeOfLocalStorage getLocalStorageValue */
/* global netease xiami qq kugou kuwo bilibili migu taihe localmusic myplaylist */
/* global isElectron require */
/* eslint-disable global-require */
/* eslint-disable import/no-extraneous-dependencies */

const PROVIDERS = [
  {
    name: 'netease',
    instance: netease,
    searchable: true,
    support_login: true,
    id: 'ne',
  },
  {
    name: 'xiami',
    instance: xiami,
    searchable: false,
    hidden: true,
    support_login: false,
    id: 'xm',
  },
  {
    name: 'qq',
    instance: qq,
    searchable: true,
    support_login: true,
    id: 'qq',
  },
  {
    name: 'kugou',
    instance: kugou,
    searchable: true,
    support_login: false,
    id: 'kg',
  },
  {
    name: 'kuwo',
    instance: kuwo,
    searchable: true,
    support_login: false,
    id: 'kw',
  },
  {
    name: 'bilibili',
    instance: bilibili,
    searchable: true,
    support_login: true,
    id: 'bi',
  },
  {
    name: 'migu',
    instance: migu,
    searchable: true,
    support_login: true,
    id: 'mg',
  },
  {
    name: 'taihe',
    instance: taihe,
    searchable: true,
    support_login: false,
    id: 'th',
  },
  {
    name: 'localmusic',
    instance: localmusic,
    searchable: false,
    hidden: true,
    support_login: false,
    id: 'lm',
  },
  {
    name: 'myplaylist',
    instance: myplaylist,
    searchable: false,
    hidden: true,
    support_login: false,
    id: 'my',
  },
];

function getProviderByName(sourceName) {
  return (PROVIDERS.find((i) => i.name === sourceName) || {}).instance;
}

function getAllProviders() {
  return PROVIDERS.filter((i) => !i.hidden).map((i) => i.instance);
}

function getAllSearchProviders() {
  return PROVIDERS.filter((i) => i.searchable).map((i) => i.instance);
}

function getProviderNameByItemId(itemId) {
  const prefix = itemId.slice(0, 2);
  return (PROVIDERS.find((i) => i.id === prefix) || {}).name;
}

function getProviderByItemId(itemId) {
  const prefix = itemId.slice(0, 2);
  return (PROVIDERS.find((i) => i.id === prefix) || {}).instance;
}

/* cache for all playlist request except myplaylist and localmusic */
const playlistCache = new LRUCache({
  max: 100,
  maxAge: 60 * 60 * 1000, // 1 hour cache expire
});

function queryStringify(options) {
  const query = JSON.parse(JSON.stringify(options));
  return new URLSearchParams(query).toString();
}

function getMachineTranslationIpcRenderer() {
  if (
    typeof isElectron !== 'function' ||
    !isElectron() ||
    typeof require !== 'function'
  ) {
    return null;
  }
  try {
    // Electron is supplied by the desktop parent package, not this extension.
    // eslint-disable-next-line import/no-unresolved
    return require('electron').ipcRenderer;
  } catch (error) {
    return null;
  }
}

function getBilibiliIpcRenderer() {
  return getMachineTranslationIpcRenderer();
}

function getDesktopLocalDataIpcRenderer() {
  return getMachineTranslationIpcRenderer();
}

function getBilibiliVideoCacheIdentity(track) {
  const trackId = String((track && track.id) || '');
  const match = /^bitrack_v_(BV[0-9A-Za-z]{10})(?:-(\d+))?$/.exec(trackId);
  if (!match) {
    const audioMatch = /^bitrack_(\d+)$/.exec(trackId);
    return audioMatch ? { trackId, kind: 'audio', sid: audioMatch[1] } : null;
  }
  const sourceUrl = String(
    (track && (track.source_url || track.sourceUrl)) || ''
  );
  const pageMatch = /[?&]p=(\d+)/.exec(sourceUrl);
  if (!match[2] && pageMatch && Number(pageMatch[1]) > 1) {
    return null;
  }
  return {
    trackId,
    kind: 'video',
    bvid: match[1],
    cid: Number(match[2] || 0),
  };
}

function lyricCacheRecordToResult(record, currentPromptFingerprint = '') {
  if (!record || !record.lyric) {
    return null;
  }
  const matchedTrack = record.matchedTrack || {};
  const machineTranslation = Object.values(record.translations || {})
    .filter(
      (translation) =>
        translation &&
        translation.tlyric &&
        translation.provider === 'deepseek' &&
        translation.promptVersion === 'deepseek-lyrics-v2' &&
        currentPromptFingerprint &&
        translation.promptFingerprint === currentPromptFingerprint
    )
    .sort(
      (left, right) =>
        Number(right.translatedAt || 0) - Number(left.translatedAt || 0)
    )[0];
  const sourceTlyric = record.tlyric || '';
  const usingMachineTranslation = Boolean(machineTranslation);
  return {
    lyric: record.lyric,
    tlyric: usingMachineTranslation ? machineTranslation.tlyric : sourceTlyric,
    sourceTlyric,
    source: record.source || '',
    matchedTitle: matchedTrack.title || '',
    matchedArtist: matchedTrack.artist || '',
    matchedAlbum: matchedTrack.album || '',
    matchedDuration: matchedTrack.duration || 0,
    matchedProvider: matchedTrack.provider || '',
    candidateId: matchedTrack.candidateId || '',
    selectedProvider: matchedTrack.selectedProvider || '',
    selectedCandidateId: matchedTrack.selectedCandidateId || '',
    translationProvider: usingMachineTranslation
      ? machineTranslation.provider || 'deepseek'
      : matchedTrack.translationProvider || '',
    translationEnriched: usingMachineTranslation
      ? false
      : matchedTrack.translationEnriched === true,
    machineTranslated: usingMachineTranslation,
    machineTranslationProvider: usingMachineTranslation
      ? machineTranslation.provider || 'deepseek'
      : '',
    machineTranslationTarget: usingMachineTranslation ? 'zh-CN' : '',
    machineTranslationDetectedSource: '',
    machineTranslationPromptFingerprint: usingMachineTranslation
      ? machineTranslation.promptFingerprint
      : '',
    sourceTranslationProvider: matchedTrack.translationProvider || '',
    sourceTranslationEnriched: matchedTrack.translationEnriched === true,
    sourceMachineTranslated: matchedTrack.machineTranslated === true,
    sourceMachineTranslationProvider:
      matchedTrack.machineTranslationProvider || '',
    sourceMachineTranslationTarget: matchedTrack.machineTranslationTarget || '',
    sourceMachineTranslationDetectedSource:
      matchedTrack.machineTranslationDetectedSource || '',
    lyricCacheRevision: Number(record.revision || 0),
    lyricCacheMode: record.mode || '',
    lyricCacheExpiresAt: Number(record.expiresAt || 0),
    lyricCacheTranslations: record.translations || {},
  };
}

function getLyricCacheIdentity(track) {
  const trackId = String((track && track.id) || '');
  const provider = getProviderByItemId(trackId);
  if (
    provider === bilibili &&
    typeof bilibili.get_manual_lyric_identity === 'function'
  ) {
    const identity = bilibili.get_manual_lyric_identity(trackId, track || {});
    if (identity && identity.isReliable && identity.key) {
      return { trackId: identity.key, canonicalKey: identity.key };
    }
  }
  return { trackId, canonicalKey: trackId };
}

setPrototypeOfLocalStorage();

// eslint-disable-next-line no-unused-vars
const MediaService = {
  getLoginProviders() {
    return PROVIDERS.filter((i) => !i.hidden && i.support_login);
  },
  search(source, options) {
    const url = `/search?${queryStringify(options)}`;
    if (source === 'allmusic') {
      // search all platform and merge result
      const callbackArray = getAllSearchProviders().map((p) => (fn) => {
        p.search(url).success((r) => {
          fn(null, r);
        });
      });
      return {
        success: (fn) =>
          async.parallel(callbackArray, (err, platformResultArray) => {
            // TODO: nicer pager, playlist support
            const result = {
              result: [],
              total: 1000,
              type: platformResultArray[0].type,
            };
            const maxLength = Math.max(
              ...platformResultArray.map((elem) => elem.result.length)
            );
            for (let i = 0; i < maxLength; i += 1) {
              platformResultArray.forEach((elem) => {
                if (i < elem.result.length) {
                  result.result.push(elem.result[i]);
                }
              });
            }
            return fn(result);
          }),
      };
    }
    const provider = getProviderByName(source);
    return provider.search(url);
  },

  showMyPlaylist() {
    return myplaylist.show_myplaylist('my');
  },

  showPlaylistArray(source, offset, filter_id) {
    const provider = getProviderByName(source);
    const url = `/show_playlist?${queryStringify({ offset, filter_id })}`;
    return provider.show_playlist(url);
  },

  getPlaylistFilters(source) {
    const provider = getProviderByName(source);
    return provider.get_playlist_filters();
  },

  getLyric(track_id, album_id, lyric_url, tlyric_url, trackInfo = {}) {
    const provider = getProviderByItemId(track_id);
    const url = `/lyric?${queryStringify({
      track_id,
      album_id,
      lyric_url,
      tlyric_url,
      title: trackInfo.title,
      artist: trackInfo.artist,
      duration: trackInfo.duration,
      source_url: trackInfo.source_url || trackInfo.sourceUrl || '',
    })}`;
    return provider.lyric(url);
  },

  getAudioCacheLookup(track) {
    const ipcRenderer = getDesktopLocalDataIpcRenderer();
    const identity = getBilibiliVideoCacheIdentity(track);
    if (!ipcRenderer || !identity) {
      return Promise.resolve({ ok: false, status: 'unsupported' });
    }
    return ipcRenderer.invoke(
      'audio-cache:lookup',
      identity.kind === 'audio'
        ? { trackId: identity.trackId, kind: 'audio', sid: identity.sid }
        : identity
    );
  },

  scheduleBilibiliAudioCache(track, descriptor) {
    const ipcRenderer = getDesktopLocalDataIpcRenderer();
    const identity = getBilibiliVideoCacheIdentity(track);
    if (!ipcRenderer || !identity || !descriptor) {
      return Promise.resolve({ ok: false, status: 'unsupported' });
    }
    return ipcRenderer.invoke('audio-cache:schedule-bilibili', {
      ...(descriptor.kind === 'audio'
        ? {
            trackId: identity.trackId,
            kind: 'audio',
            sid: String(descriptor.sid || identity.sid || ''),
          }
        : {
            trackId: identity.trackId,
            kind: 'video',
            bvid: String(descriptor.bvid || identity.bvid),
            cid: Number(descriptor.cid || 0),
            audioId: Number(descriptor.audioId || 0),
            codecs: String(descriptor.codecs || ''),
            mimeType: String(descriptor.mimeType || ''),
          }),
    });
  },

  invalidateAudioCache(cacheKey) {
    const ipcRenderer = getDesktopLocalDataIpcRenderer();
    if (!ipcRenderer || !cacheKey) {
      return Promise.resolve({ ok: false, status: 'unsupported' });
    }
    return ipcRenderer.invoke('audio-cache:invalidate', { cacheKey });
  },

  getAudioCacheStatus() {
    const ipcRenderer = getDesktopLocalDataIpcRenderer();
    if (!ipcRenderer) {
      return Promise.resolve({ ok: false, status: 'unsupported' });
    }
    return ipcRenderer.invoke('audio-cache:status');
  },

  configureAudioCache(settings = {}) {
    const ipcRenderer = getDesktopLocalDataIpcRenderer();
    if (!ipcRenderer) {
      return Promise.resolve({ ok: false, status: 'unsupported' });
    }
    return ipcRenderer.invoke('audio-cache:configure', settings);
  },

  clearAudioCache() {
    const ipcRenderer = getDesktopLocalDataIpcRenderer();
    if (!ipcRenderer) {
      return Promise.resolve({ ok: false, status: 'unsupported' });
    }
    return ipcRenderer.invoke('audio-cache:clear');
  },

  ingestListeningHistory(payload) {
    const ipcRenderer = getDesktopLocalDataIpcRenderer();
    if (!ipcRenderer) {
      return Promise.resolve({ ok: false, status: 'unsupported' });
    }
    return ipcRenderer.invoke('listening-history:ingest', payload);
  },

  getListeningHistoryStatus() {
    const ipcRenderer = getDesktopLocalDataIpcRenderer();
    if (!ipcRenderer) {
      return Promise.resolve({ ok: false, status: 'unsupported' });
    }
    return ipcRenderer.invoke('listening-history:status');
  },

  configureListeningHistory(enabled) {
    const ipcRenderer = getDesktopLocalDataIpcRenderer();
    if (!ipcRenderer) {
      return Promise.resolve({ ok: false, status: 'unsupported' });
    }
    return ipcRenderer.invoke('listening-history:configure', { enabled });
  },

  getAnnualListeningSummary(year) {
    const ipcRenderer = getDesktopLocalDataIpcRenderer();
    if (!ipcRenderer) {
      return Promise.resolve({ ok: false, status: 'unsupported' });
    }
    return ipcRenderer.invoke('listening-history:annual-summary', { year });
  },

  exportListeningHistory() {
    const ipcRenderer = getDesktopLocalDataIpcRenderer();
    if (!ipcRenderer) {
      return Promise.resolve({ ok: false, status: 'unsupported' });
    }
    return ipcRenderer.invoke('listening-history:export');
  },

  clearListeningHistory() {
    const ipcRenderer = getDesktopLocalDataIpcRenderer();
    if (!ipcRenderer) {
      return Promise.resolve({ ok: false, status: 'unsupported' });
    }
    return ipcRenderer.invoke('listening-history:clear');
  },

  deleteTrackLocalData(track) {
    const ipcRenderer = getDesktopLocalDataIpcRenderer();
    const identity = getBilibiliVideoCacheIdentity(track) || {};
    if (!ipcRenderer || !track || !track.id) {
      return Promise.resolve({ ok: false, status: 'unsupported' });
    }
    const lyricIdentity = getLyricCacheIdentity(track);
    return ipcRenderer.invoke('local-data:delete-track', {
      trackId: lyricIdentity.trackId,
      kind: identity.kind || '',
      sid: identity.sid || '',
      bvid: identity.bvid || '',
      cid: identity.cid || 0,
    });
  },

  getPersistentLyric(track) {
    const ipcRenderer = getDesktopLocalDataIpcRenderer();
    if (!ipcRenderer || !track || !track.id) {
      return Promise.resolve({
        ok: false,
        status: 'unsupported',
        record: null,
      });
    }
    const identity = getLyricCacheIdentity(track);
    const recordRequest = ipcRenderer.invoke('lyric-cache:get', identity);
    const configRequest = ipcRenderer
      .invoke('machine-translation:get-config')
      .catch(() => null);
    return Promise.all([recordRequest, configRequest]).then(
      ([response, configResponse]) => {
        const configuredPromptFingerprint = String(
          (configResponse &&
            configResponse.ok === true &&
            configResponse.config &&
            configResponse.config.promptFingerprint) ||
            ''
        );
        const promptFingerprint = /^[a-f0-9]{64}$/.test(
          configuredPromptFingerprint
        )
          ? configuredPromptFingerprint
          : '';
        return {
          ...(response || {}),
          result: lyricCacheRecordToResult(
            response && response.record,
            promptFingerprint
          ),
        };
      }
    );
  },

  putPersistentLyric(track, result, mode, expectedRevision = 0) {
    const ipcRenderer = getDesktopLocalDataIpcRenderer();
    if (!ipcRenderer || !track || !track.id || !result || !result.lyric) {
      return Promise.resolve({ ok: false, status: 'unsupported' });
    }
    const identity = getLyricCacheIdentity(track);
    const matchedTrack = {
      title: result.matchedTitle || '',
      artist: result.matchedArtist || '',
      album: result.matchedAlbum || '',
      duration: result.matchedDuration || 0,
      provider: result.matchedProvider || '',
      candidateId: result.candidateId || '',
      selectedProvider: result.selectedProvider || '',
      selectedCandidateId: result.selectedCandidateId || '',
      translationProvider: result.translationProvider || '',
      translationEnriched: result.translationEnriched === true,
      machineTranslated: result.machineTranslated === true,
      machineTranslationProvider: result.machineTranslationProvider || '',
      machineTranslationTarget: result.machineTranslationTarget || '',
      machineTranslationDetectedSource:
        result.machineTranslationDetectedSource || '',
    };
    return ipcRenderer.invoke('lyric-cache:put', {
      trackId: identity.trackId,
      canonicalKey: identity.canonicalKey,
      expectedRevision: Number(expectedRevision || 0),
      mode,
      record: {
        lyric: result.lyric,
        tlyric: result.tlyric || '',
        source: result.source || track.source || '',
        matchedTrack,
        expiresAt:
          mode === 'auto' ? Date.now() + 30 * 24 * 60 * 60 * 1000 : undefined,
      },
    });
  },

  clearPersistentLyric(track, expectedRevision) {
    const ipcRenderer = getDesktopLocalDataIpcRenderer();
    if (!ipcRenderer || !track || !track.id) {
      return Promise.resolve({ ok: false, status: 'unsupported' });
    }
    const identity = getLyricCacheIdentity(track);
    const payload = { trackId: identity.trackId };
    if (typeof expectedRevision === 'number') {
      payload.expectedRevision = expectedRevision;
    }
    return ipcRenderer.invoke('lyric-cache:clear', payload);
  },

  migrateLegacyBilibiliManualLyrics() {
    const ipcRenderer = getDesktopLocalDataIpcRenderer();
    if (!ipcRenderer || !bilibili || !bilibili.get_manual_lyric_selections) {
      return Promise.resolve({ ok: false, status: 'unsupported' });
    }
    const records = bilibili.get_manual_lyric_selections();
    const payload = Object.keys(records || {}).map((trackId) => ({
      trackId,
      record: {
        ...records[trackId],
        mode: 'manual',
        canonicalKey: trackId,
        manualLocked: true,
      },
    }));
    const batchSize = 200;
    const batches = [];
    for (let index = 0; index < payload.length; index += batchSize) {
      batches.push(payload.slice(index, index + batchSize));
    }
    return batches.reduce(
      (chain, recordsBatch) =>
        chain.then((summary) =>
          ipcRenderer
            .invoke('lyric-cache:migrate-legacy-bilibili-manual', {
              records: recordsBatch,
            })
            .then((response) => ({
              ok: summary.ok && response && response.ok === true,
              migrated:
                Number(summary.migrated || 0) +
                Number((response && response.migrated) || 0),
              skipped:
                Number(summary.skipped || 0) +
                Number((response && response.skipped) || 0),
              status: response && response.status,
            }))
        ),
      Promise.resolve({ ok: true, migrated: 0, skipped: 0 })
    );
  },

  searchLyricCandidates(trackInfo, query) {
    const provider = getProviderByItemId(trackInfo.id);
    if (!provider || typeof provider.search_lyric_candidates !== 'function') {
      return Promise.resolve([]);
    }
    return provider.search_lyric_candidates({
      query,
      title: trackInfo.title,
      artist: trackInfo.artist,
      duration: trackInfo.duration,
    });
  },

  searchSupplementalLyricCandidates(trackInfo, query) {
    const provider = getProviderByItemId(trackInfo.id);
    if (
      !provider ||
      typeof provider.search_supplemental_lyric_candidates !== 'function'
    ) {
      return Promise.resolve([]);
    }
    return provider.search_supplemental_lyric_candidates({
      query,
      title: trackInfo.title,
      artist: trackInfo.artist,
      duration: trackInfo.duration,
    });
  },

  getLyricSearchQuery(trackInfo) {
    const provider = getProviderByItemId(trackInfo.id);
    if (provider && typeof provider.get_lyric_search_query === 'function') {
      return provider.get_lyric_search_query(trackInfo);
    }
    return trackInfo.title || trackInfo.artist || '';
  },

  saveManualLyric(trackId, candidate, trackInfo = {}) {
    const provider = getProviderByItemId(trackId);
    if (provider && typeof provider.save_manual_lyric === 'function') {
      return provider.save_manual_lyric(trackId, candidate, trackInfo);
    }
    return { ok: false, status: 'unsupported' };
  },

  enrichManualLyricCandidate(trackInfo, candidate) {
    const provider = getProviderByItemId(trackInfo.id);
    if (
      provider &&
      typeof provider.enrich_manual_lyric_candidate === 'function'
    ) {
      return provider.enrich_manual_lyric_candidate(candidate, trackInfo);
    }
    return Promise.resolve(candidate);
  },

  getMachineTranslationConfig() {
    const ipcRenderer = getMachineTranslationIpcRenderer();
    if (!ipcRenderer) {
      return Promise.resolve({
        ok: false,
        status: 'unsupported',
      });
    }
    return ipcRenderer.invoke('machine-translation:get-config');
  },

  setMachineTranslationConfig(config) {
    const ipcRenderer = getMachineTranslationIpcRenderer();
    if (!ipcRenderer) {
      return Promise.resolve({
        ok: false,
        status: 'unsupported',
      });
    }
    return ipcRenderer.invoke('machine-translation:set-config', config || {});
  },

  testMachineTranslationConfig() {
    const ipcRenderer = getMachineTranslationIpcRenderer();
    if (!ipcRenderer) {
      return Promise.resolve({
        ok: false,
        status: 'unsupported',
      });
    }
    return ipcRenderer.invoke('machine-translation:test');
  },

  machineTranslateLyricCandidate(
    trackInfo,
    candidate,
    targetLanguage,
    options = {}
  ) {
    const ipcRenderer = getMachineTranslationIpcRenderer();
    if (!ipcRenderer || !candidate || !candidate.lyric) {
      return Promise.resolve({
        ...candidate,
        machineTranslationStatus: ipcRenderer ? 'empty-lyric' : 'unsupported',
      });
    }
    const lyricIdentity = getLyricCacheIdentity(trackInfo || {});
    return ipcRenderer
      .invoke('machine-translation:translate-lyrics', {
        lyric: candidate.lyric,
        title: candidate.title || trackInfo.title || '',
        artist: candidate.artist || trackInfo.artist || '',
        targetLanguage: targetLanguage || 'zh-CN',
        allowNetwork: options && options.allowNetwork === true,
        // This is deliberately opt-in: callers use it only after the user has
        // explicitly confirmed a retranslation, never for normal cache lookup.
        forceRefresh: options && options.forceRefresh === true,
        trackId: lyricIdentity.trackId,
        expectedRevision: Number(candidate.lyricCacheRevision || 0),
      })
      .then((response) => {
        if (
          !response ||
          response.ok !== true ||
          !String(response.tlyric || '').trim()
        ) {
          return {
            ...candidate,
            machineTranslationStatus:
              (response && response.status) || 'request-failed',
          };
        }
        return {
          ...candidate,
          tlyric: response.tlyric,
          translationProvider: response.provider || 'deepseek',
          translationEnriched: false,
          machineTranslated: true,
          machineTranslationProvider: response.provider || 'deepseek',
          machineTranslationTarget: response.targetLanguage || '',
          machineTranslationDetectedSource:
            response.detectedSourceLanguage || '',
          machineTranslationCached: response.cached === true,
          machineTranslationLineCount: Number(response.lineCount || 0),
          machineTranslationPromptFingerprint: response.promptFingerprint || '',
          machineTranslationStatus: 'translated',
        };
      })
      .catch(() => ({
        ...candidate,
        machineTranslationStatus: 'request-failed',
      }));
  },

  clearManualLyric(trackId, trackInfo = {}) {
    const provider = getProviderByItemId(trackId);
    if (provider && typeof provider.clear_manual_lyric === 'function') {
      return provider.clear_manual_lyric(trackId, trackInfo);
    }
    return { ok: false, status: 'unsupported' };
  },

  showFavPlaylist() {
    return myplaylist.show_myplaylist('favorite');
  },

  queryPlaylist(listId, type) {
    const result = myplaylist.myplaylist_containers(type, listId);
    return {
      success: (fn) => fn({ result }),
    };
  },

  getPlaylist(listId, useCache = true) {
    const provider = getProviderByItemId(listId);
    const url = `/playlist?list_id=${listId}`;
    let hit = null;
    if (useCache) {
      hit = playlistCache.get(listId);
    }

    if (hit) {
      return {
        success: (fn) => fn(hit),
      };
    }
    return {
      success: (fn) =>
        provider.get_playlist(url).success((playlist) => {
          if (provider !== myplaylist && provider !== localmusic) {
            playlistCache.set(listId, playlist);
          }
          fn(playlist);
        }),
    };
  },

  hydrateTrackDurations(listId, tracks) {
    const safeTracks = Array.isArray(tracks) ? tracks : [];
    const providerGroups = new Map();
    safeTracks.forEach((track) => {
      if (!track || Number(track.duration) > 0) return;
      const provider =
        getProviderByName(track.source) || getProviderByItemId(track.id);
      if (!provider || typeof provider.hydrate_track_durations !== 'function') {
        return;
      }
      if (!providerGroups.has(provider)) {
        providerGroups.set(provider, []);
      }
      providerGroups.get(provider).push(track);
    });
    const requests = Array.from(providerGroups.entries()).map(
      ([provider, providerTracks]) =>
        provider
          .hydrate_track_durations(providerTracks)
          .catch(() => providerTracks)
    );
    return Promise.all(requests).then(() => {
      if (
        String(listId || '').startsWith('myplaylist_') &&
        typeof myplaylist.update_track_durations === 'function'
      ) {
        myplaylist.update_track_durations(listId, safeTracks);
      }
      return safeTracks;
    });
  },

  clonePlaylist(id, type) {
    const provider = getProviderByItemId(id);
    const url = `/playlist?list_id=${id}`;
    return {
      success: (fn) => {
        provider.get_playlist(url).success((data) => {
          myplaylist.save_myplaylist(type, data);
          fn();
        });
      },
    };
  },

  getBilibiliAuthState() {
    const ipcRenderer = getBilibiliIpcRenderer();
    if (!ipcRenderer) {
      return Promise.resolve({ ok: false, status: 'unsupported' });
    }
    return ipcRenderer.invoke('bilibili-auth:get-state');
  },

  beginBilibiliQrLogin() {
    const ipcRenderer = getBilibiliIpcRenderer();
    if (!ipcRenderer) {
      return Promise.resolve({ ok: false, status: 'unsupported' });
    }
    return ipcRenderer.invoke('bilibili-auth:begin-qr');
  },

  cancelBilibiliQrLogin(sessionId) {
    const ipcRenderer = getBilibiliIpcRenderer();
    if (!ipcRenderer) {
      return Promise.resolve({ ok: false, status: 'unsupported' });
    }
    return ipcRenderer.invoke('bilibili-auth:cancel-qr', {
      sessionId: String(sessionId || ''),
    });
  },

  onBilibiliQrState(listener) {
    const ipcRenderer = getBilibiliIpcRenderer();
    if (!ipcRenderer || typeof listener !== 'function') {
      return () => {};
    }
    const wrapped = (event, state) => listener(state || {});
    ipcRenderer.on('bilibili-auth:qr-state', wrapped);
    return () => ipcRenderer.removeListener('bilibili-auth:qr-state', wrapped);
  },

  logoutBilibili() {
    const ipcRenderer = getBilibiliIpcRenderer();
    if (!ipcRenderer) {
      return Promise.resolve({ ok: false, status: 'unsupported' });
    }
    return ipcRenderer.invoke('bilibili-auth:logout');
  },

  getBilibiliMediaManifest(options) {
    const ipcRenderer = getBilibiliIpcRenderer();
    if (!ipcRenderer) {
      return Promise.resolve({ ok: false, status: 'unsupported' });
    }
    return ipcRenderer.invoke('bilibili-media:get-manifest', {
      bvid: String((options && options.bvid) || ''),
      cid: Number((options && options.cid) || 0),
      forceRefresh: Boolean(options && options.forceRefresh),
    });
  },

  clearBilibiliMediaManifest(options) {
    const ipcRenderer = getBilibiliIpcRenderer();
    if (!ipcRenderer) {
      return Promise.resolve({ ok: false, status: 'unsupported' });
    }
    return ipcRenderer.invoke('bilibili-media:clear-manifest', {
      bvid: String((options && options.bvid) || ''),
      cid: Number((options && options.cid) || 0),
    });
  },

  removeMyPlaylist(id, type) {
    myplaylist.remove_myplaylist(type, id);
    return {
      success: (fn) => fn(),
    };
  },

  addMyPlaylist(id, track) {
    const newPlaylist = myplaylist.add_track_to_myplaylist(id, track);
    return {
      success: (fn) => fn(newPlaylist),
    };
  },
  insertTrackToMyPlaylist(id, track, to_track, direction) {
    const newPlaylist = myplaylist.insert_track_to_myplaylist(
      id,
      track,
      to_track,
      direction
    );
    return {
      success: (fn) => fn(newPlaylist),
    };
  },
  addPlaylist(id, tracks) {
    const provider = getProviderByItemId(id);
    return provider.add_playlist(id, tracks);
  },

  removeTrackFromMyPlaylist(id, track) {
    myplaylist.remove_track_from_myplaylist(id, track);
    return {
      success: (fn) => fn(),
    };
  },

  removeTrackFromPlaylist(id, track) {
    const provider = getProviderByItemId(id);
    return provider.remove_from_playlist(id, track);
  },

  createMyPlaylist(title, track) {
    myplaylist.create_myplaylist(title, track);
    return {
      success: (fn) => {
        fn();
      },
    };
  },
  insertMyplaylistToMyplaylists(
    playlistType,
    playlistId,
    toPlaylistId,
    direction
  ) {
    const newPlaylists = myplaylist.insert_myplaylist_to_myplaylists(
      playlistType,
      playlistId,
      toPlaylistId,
      direction
    );
    return {
      success: (fn) => fn(newPlaylists),
    };
  },
  editMyPlaylist(id, title, coverImgUrl) {
    myplaylist.edit_myplaylist(id, title, coverImgUrl);
    return {
      success: (fn) => fn(),
    };
  },

  parseURL(url) {
    return {
      success: (fn) => {
        const providers = getAllProviders();
        Promise.all(
          providers.map(
            (provider) =>
              new Promise((res, rej) =>
                provider.parse_url(url).success((r) => {
                  if (r !== undefined) {
                    return rej(r);
                  }
                  return res(r);
                })
              )
          )
        )
          .then(() => fn({}))
          .catch((result) => fn({ result }));
      },
    };
  },

  mergePlaylist(source, target) {
    const tarData = localStorage.getObject(target).tracks;
    const srcData = localStorage.getObject(source).tracks;
    tarData.forEach((tarTrack) => {
      if (!srcData.find((srcTrack) => srcTrack.id === tarTrack.id)) {
        myplaylist.add_track_to_myplaylist(source, tarTrack);
      }
    });
    return {
      success: (fn) => fn(),
    };
  },

  bootstrapTrack(
    track,
    playerSuccessCallback,
    playerFailCallback,
    bootstrapOptions = {}
  ) {
    const successCallback = playerSuccessCallback;
    const sound = {};
    function failureCallback(originalError = {}) {
      if (localStorage.getObject('enable_auto_choose_source') === false) {
        playerFailCallback(originalError);
        return;
      }
      const trackPlatform = getProviderNameByItemId(track.id);
      const failover_source_list = getLocalStorageValue(
        'auto_choose_source_list',
        ['kuwo', 'qq', 'migu']
      ).filter((i) => i !== trackPlatform);

      const getUrlPromises = failover_source_list.map(
        (source) =>
          new Promise((resolve, reject) => {
            if (track.source === source) {
              // come from same source, no need to check
              resolve();
              return;
            }
            // TODO: better query method
            const keyword = `${track.title} ${track.artist}`;
            const curpage = 1;
            const url = `/search?keywords=${keyword}&curpage=${curpage}&type=0`;
            const provider = getProviderByName(source);
            provider.search(url).success((data) => {
              for (let i = 0; i < data.result.length; i += 1) {
                const searchTrack = data.result[i];
                // compare search track and track to check if they are same
                // TODO: better similar compare method (duration, md5)
                if (
                  !searchTrack.disable &&
                  searchTrack.title === track.title &&
                  searchTrack.artist === track.artist
                ) {
                  provider.bootstrap_track(
                    searchTrack,
                    (response) => {
                      sound.url = response.url;
                      sound.bitrate = response.bitrate;
                      sound.platform = response.platform;
                      reject(sound); // Use Reject to return immediately
                    },
                    resolve
                  );
                  return;
                }
              }
              resolve(sound);
            });
          })
      );
      // TODO: Use Promise.any() in ES2021 replace the tricky workaround
      Promise.all(getUrlPromises)
        .then(() => playerFailCallback(originalError))
        .catch((response) => {
          playerSuccessCallback(response);
        });
    }

    const provider = getProviderByName(track.source);

    provider.bootstrap_track(
      track,
      successCallback,
      failureCallback,
      bootstrapOptions
    );
  },

  login(source, options) {
    const url = `/login?${queryStringify(options)}`;
    const provider = getProviderByName(source);

    return provider.login(url);
  },
  getUser(source) {
    const provider = getProviderByName(source);
    return provider.get_user();
  },
  getLoginUrl(source) {
    const provider = getProviderByName(source);
    return provider.get_login_url();
  },
  getUserCreatedPlaylist(source, options) {
    const provider = getProviderByName(source);
    const url = `/get_user_create_playlist?${queryStringify(options)}`;

    return provider.get_user_created_playlist(url);
  },
  getUserFavoritePlaylist(source, options) {
    const provider = getProviderByName(source);
    const url = `/get_user_favorite_playlist?${queryStringify(options)}`;

    return provider.get_user_favorite_playlist(url);
  },
  getRecommendPlaylist(source) {
    const provider = getProviderByName(source);

    return provider.get_recommend_playlist();
  },
  logout(source) {
    const provider = getProviderByName(source);

    return provider.logout();
  },
};

// eslint-disable-next-line no-unused-vars
const loWeb = MediaService;
