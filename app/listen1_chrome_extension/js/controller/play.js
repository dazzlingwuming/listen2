/* eslint-disable no-param-reassign */
/* eslint-disable no-shadow */
/* eslint-disable import/no-extraneous-dependencies */
/* eslint-disable import/no-unresolved */
/* eslint-disable global-require */
/* eslint no-use-before-define: ["error", { "functions": false }] */
/* global angular notyf i18next MediaService l1Player hotkeys GithubClient isElectron require getLocalStorageValue getPlayer getPlayerAsync getPlayerMode canUseBackgroundPlayer addPlayerListener smoothScrollTo lastfm BilibiliMvPlayer Listen1AudioAnalysis */

function getCSSStringFromSetting(setting) {
  let { backgroundAlpha } = setting;
  if (backgroundAlpha === 0) {
    // NOTE: background alpha 0 results total transparent
    // which will cause mouse leave event not trigger
    // correct in windows platform for lyic window if disable
    // hardware accelerate
    backgroundAlpha = 0.01;
  }
  return `div.content.lyric-content{
      font-size: ${setting.fontSize}px;
      color: ${setting.color};
      background: rgba(36, 36, 36, ${backgroundAlpha});
    }
    div.content.lyric-content span.contentTrans {
      font-size: ${setting.fontSize - 4}px;
      line-height: 1.28;
      margin-top: 3px;
      opacity: 0.76;
      font-weight: 500;
    }
    `;
}

function useModernTheme() {
  const defaultTheme = localStorage.getObject('theme');
  return window.Listen2Appearance.isModernTheme(defaultTheme);
}

function getSafeIndex(index, length) {
  if (index < 0) {
    const r = index % length;
    if (r < 0) {
      return length + (index % length);
    }
    return r;
  }
  if (index > length - 1) {
    return index % length;
  }
  return index;
}

function formatSecond(posSec) {
  if (typeof posSec === 'string' && /^\d{1,3}:\d{2}(?::\d{2})?$/.test(posSec)) {
    return posSec;
  }
  const seconds = Number(posSec);
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--';
  const whole = Math.floor(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const tail = String(whole % 60).padStart(2, '0');
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${tail}`
    : `${minutes}:${tail}`;
}

function hasMeaningfulLyricText(value) {
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

function buildSourceTranslationSnapshot(track, result) {
  const safeResult = result || {};
  const trackId = track && track.id;
  if (!trackId) {
    return null;
  }
  if (hasMeaningfulLyricText(safeResult.sourceTlyric)) {
    return {
      trackId,
      tlyric: safeResult.sourceTlyric,
      translationProvider: safeResult.sourceTranslationProvider || '',
      translationEnriched: safeResult.sourceTranslationEnriched === true,
      machineTranslated: safeResult.sourceMachineTranslated === true,
      machineTranslationProvider:
        safeResult.sourceMachineTranslationProvider || '',
      machineTranslationTarget: safeResult.sourceMachineTranslationTarget || '',
      machineTranslationDetectedSource:
        safeResult.sourceMachineTranslationDetectedSource || '',
    };
  }
  if (
    !safeResult.machineTranslated &&
    hasMeaningfulLyricText(safeResult.tlyric)
  ) {
    return {
      trackId,
      tlyric: safeResult.tlyric,
      translationProvider: safeResult.translationProvider || '',
      translationEnriched: safeResult.translationEnriched === true,
      machineTranslated: false,
      machineTranslationProvider: '',
      machineTranslationTarget: '',
      machineTranslationDetectedSource: '',
    };
  }
  return null;
}

function restoreSourceTranslationResult(result, snapshot) {
  return {
    ...(result || {}),
    tlyric: snapshot.tlyric,
    translationProvider: snapshot.translationProvider || '',
    translationEnriched: snapshot.translationEnriched === true,
    machineTranslated: snapshot.machineTranslated === true,
    machineTranslationProvider: snapshot.machineTranslationProvider || '',
    machineTranslationTarget: snapshot.machineTranslationTarget || '',
    machineTranslationDetectedSource:
      snapshot.machineTranslationDetectedSource || '',
    machineTranslationPromptFingerprint: '',
  };
}

function decorateLyricCandidate(candidate) {
  return {
    ...candidate,
    hasTranslation: hasMeaningfulLyricText(candidate && candidate.tlyric),
  };
}

function classifyNativeLyricState(input) {
  const value = input || {};
  if (value.identityAccepted !== true) return 'stale';
  const terminal = String(value.terminalStatus || '');
  if (
    [
      'no-lyric',
      'provider-refusal',
      'timeout',
      'cancelled',
      'schema-error',
    ].includes(terminal)
  ) {
    return terminal;
  }
  const lines = Math.max(0, Number(value.lineCount) || 0);
  const timedLines = Math.max(0, Number(value.timedLineCount) || 0);
  if (!lines) return 'no-lyric';
  const durationMs = Math.max(0, Number(value.durationMs) || 0);
  const matchedDurationMs = Math.max(0, Number(value.matchedDurationMs) || 0);
  const mismatchTolerance = Math.max(10000, durationMs * 0.1);
  if (
    durationMs > 0 &&
    matchedDurationMs > 0 &&
    Math.abs(durationMs - matchedDurationMs) > mismatchTolerance
  ) {
    return 'duration-mismatch';
  }
  if (timedLines >= 3 && timedLines / lines >= 0.6) return 'synchronized';
  return timedLines > 0 ? 'insufficient-timestamp' : 'text-only';
}

function normalizeLyricTerminalStatus(value) {
  const status = String(value || '');
  if (/cancel/i.test(status)) return 'cancelled';
  if (/timeout/i.test(status)) return 'timeout';
  if (/refus|denied|entitlement/i.test(status)) return 'provider-refusal';
  return status;
}

function compareLyricCandidates(left, right) {
  const scoreDifference =
    Number(right.matchScore || 0) - Number(left.matchScore || 0);
  if (Math.abs(scoreDifference) <= 0.04) {
    const translationDifference =
      Number(right.hasTranslation === true) -
      Number(left.hasTranslation === true);
    if (translationDifference !== 0) {
      return translationDifference;
    }
  }
  return scoreDifference;
}

angular.module('listenone').controller('PlayController', [
  '$scope',
  '$timeout',
  '$log',
  '$anchorScroll',
  '$location',
  '$rootScope',
  ($scope, $timeout, $log, $anchorScroll, $location, $rootScope) => {
    $scope.menuHidden = true;
    $scope.volume = l1Player.status.volume;
    $scope.mute = l1Player.status.muted;
    $scope.settings = {
      playmode: 0,
      nowplaying_track_id: -1,
    };
    $scope.lyricArray = [];
    $scope.lyricLineNumber = -1;
    $scope.lyricLineNumberTrans = -1;
    $scope.hasLyricTranslation = false;
    $scope.lastTrackId = null;
    $scope.playNextQueue = l1Player.status.playNextQueue || [];
    $scope.formatTrackDuration = formatSecond;
    $scope.removePlayNextQueueEntry = (queueId) =>
      l1Player.removePlayNextQueueEntry(queueId);
    $scope.clearPlayNextQueue = () => l1Player.clearPlayNextQueue();
    $scope.movePlayNextQueueEntry = (queueId, index) =>
      l1Player.movePlayNextQueueEntry(queueId, index);

    $scope.enableGloablShortcut = false;
    $scope.isChrome = !isElectron();
    const isAndroidTranslationSurface = () =>
      Boolean(
        !isElectron() &&
          typeof window !== 'undefined' &&
          window.Listen2AndroidHttpAdapter &&
          typeof window.Listen2AndroidHttpAdapter.isAvailable === 'function' &&
          window.Listen2AndroidHttpAdapter.isAvailable()
      );
    $scope.isAndroidSurface = isAndroidTranslationSurface;
    $scope.isMac = false;

    $scope.currentDuration = '0:00';
    $scope.currentDurationSeconds = 0;
    $scope.currentPosition = '0:00';
    $scope.lyricOffsetMs = 0;
    $scope.lyricSource = '';
    $scope.lyricMatchedTrack = '';
    $scope.lyricTranslationSource = '';
    $scope.currentLyricResult = null;
    $scope.lyricPickerOpen = false;
    $scope.lyricSearch = { title: '', artist: '' };
    $scope.lyricSearchSubmitted = null;
    $scope.lyricSearchResults = [];
    $scope.lyricSearchState = 'idle';
    $scope.lyricSearchPending = false;
    $scope.neteaseLyricVerificationPending = false;
    $scope.neteaseLyricVerificationError = '';
    $scope.foregroundPlaybackState = 'idle';
    $scope.foregroundPlaybackFailure = null;
    const androidPlaybackAdapter =
      typeof window !== 'undefined' &&
      window.Listen2AndroidHttpAdapter &&
      typeof window.Listen2AndroidHttpAdapter.isAvailable === 'function' &&
      window.Listen2AndroidHttpAdapter.isAvailable()
        ? window.Listen2AndroidHttpAdapter
        : null;
    let androidPlaybackRefreshTimer = null;
    let androidPlaybackLastAnnouncementRevision = 0;
    let androidPlaybackReturnFocus = null;
    let playControllerDestroyed = false;
    $scope.androidPlaybackEnabled = Boolean(androidPlaybackAdapter);
    $scope.androidPlaybackDetailOpen = false;
    $scope.androidUi = {
      tab: 'cover', settingsOpen: false,
      showTranslation: localStorage.getObject('android-lyric-show-translation') !== false,
      lyricFontSize: Number(localStorage.getObject('android-lyric-font-size')) || 22,
    };
    $scope.androidRecentTracks = [];
    $scope.androidTrackDisplay = (track) => MediaService.getMobileTrackDisplay(
      track || $scope.currentPlaying || $scope.androidPlaybackSnapshot.metadata
    );
    $scope.setAndroidLyricFontSize = (size) => {
      $scope.androidUi.lyricFontSize = Math.max(16, Math.min(30, Number(size) || 22));
      localStorage.setObject('android-lyric-font-size', $scope.androidUi.lyricFontSize);
    };
    $scope.setAndroidLyricTranslationVisible = (visible) => {
      $scope.androidUi.showTranslation = Boolean(visible);
      localStorage.setObject('android-lyric-show-translation', $scope.androidUi.showTranslation);
    };
    $scope.openAndroidAppSettings = (page = '') => {
      $scope.androidPlaybackDetailOpen = false;
      $scope.androidUi.settingsOpen = false;
      $rootScope.$broadcast('android:open-settings', page);
    };
    $scope.playAndroidRecent = (track) => {
      l1Player.addTrack(track);
      return l1Player.playById(track.id);
    };
    $scope.androidPlaybackCommandPending = '';
    $scope.androidPlaybackSeekDraft = null;
    $scope.androidPlaybackSeekAdjusting = false;
    $scope.androidPlaybackSeekUnavailable = false;
    $scope.androidPlaybackVolumeDraft = 100;
    $scope.androidPlaybackBusy = true;
    $scope.androidPlaybackRetryAttempt = 1;
    $scope.androidPlaybackRetryMax = 2;
    $scope.androidPlaybackQueue = [];
    $scope.androidPlaybackSnapshot = {
      revision: 0,
      state: 'connecting',
      metadata: { title: '', artist: '', artworkState: 'bundled-placeholder' },
      positionMs: 0,
      durationMs: 0,
      volumePercent: 100,
      muted: false,
      mode: 'sequential',
      actions: {},
      queue: [],
      recovery: { status: 'connecting', retryable: false },
    };

    function isAndroidPlaybackActionAvailable(action) {
      return (
        $scope.androidPlaybackEnabled &&
        $scope.androidPlaybackSnapshot &&
        $scope.androidPlaybackSnapshot.actions &&
        (['mode', 'volume', 'mute'].includes(action)
          ? $scope.androidPlaybackSnapshot.revision > 0
          : $scope.androidPlaybackSnapshot.actions[action] === true)
      );
    }

    function androidPlaybackStateCopy(snapshot) {
      const safeSnapshot = snapshot || {};
      const recovery = safeSnapshot.recovery || {};
      if (!safeSnapshot.revision) return '正在连接播放器…';
      if (safeSnapshot.state === 'error') {
        const status = String(recovery.status || '');
        if (status === 'media-network-unavailable')
          return '音频网络连接失败，请稍后重试';
        if (/^bilibili-(detail|manifest|legacy)-http-0$/.test(status))
          return '网络连接失败，暂时无法播放这首歌曲';
        if (
          /^bilibili-(detail|manifest|legacy)-(http-(403|412|429)|provider--?\d{1,7})$/.test(
            status
          )
        )
          return '来源暂时拒绝提供这首歌曲的音频';
        if (/^bilibili-(detail|manifest)-map-/.test(status))
          return '来源返回的音频信息暂时无法使用';
        if (status === 'candidate-rejected') return '音频地址暂时无法使用';
        return '当前歌曲暂时无法播放';
      }
      if (recovery.status === 'buffering') return '正在缓冲…';
      if (recovery.status === 'retrying') {
        return `正在尝试恢复播放（${$scope.androidPlaybackRetryAttempt}/${$scope.androidPlaybackRetryMax}）…`;
      }
      if (recovery.status === 'interrupted') return '播放已暂停';
      if (recovery.status === 'restored') return '已恢复播放队列';
      if (safeSnapshot.state === 'resolving') return '正在准备播放…';
      if (safeSnapshot.state === 'playing') return '正在播放';
      if (safeSnapshot.state === 'paused') return '已暂停';
      return '还没有正在播放的内容';
    }

    $scope.androidPlaybackStateCopy = () =>
      androidPlaybackStateCopy($scope.androidPlaybackSnapshot);
    $scope.androidPlaybackHasCurrent = () =>
      Boolean(
        $scope.androidPlaybackSnapshot &&
          $scope.androidPlaybackSnapshot.metadata &&
          $scope.androidPlaybackSnapshot.metadata.title
      );
    $scope.androidPlaybackCan = (action) =>
      isAndroidPlaybackActionAvailable(action) &&
      !$scope.androidPlaybackCommandPending;
    $scope.androidPlaybackModeLabel = () => {
      const labels = {
        sequential: '顺序播放',
        'repeat-one': '单曲循环',
        shuffle: '随机播放',
      };
      return labels[$scope.androidPlaybackSnapshot.mode] || '顺序播放';
    };
    $scope.androidPlaybackElapsed = () =>
      formatSecond(
        Number($scope.androidPlaybackSnapshot.positionMs || 0) / 1000
      );
    $scope.androidPlaybackDuration = () =>
      formatSecond(
        Number($scope.androidPlaybackSnapshot.durationMs || 0) / 1000
      );
    $scope.androidPlaybackSeekValue = () => {
      if ($scope.androidPlaybackSeekDraft !== null) {
        return $scope.androidPlaybackSeekDraft;
      }
      return Number($scope.androidPlaybackSnapshot.positionMs || 0);
    };

    function applyAndroidPlaybackSnapshot(snapshot) {
      if (!androidPlaybackAdapter || !snapshot) return;
      const revision = Number(snapshot.revision || 0);
      if (
        revision &&
        revision < Number($scope.androidPlaybackSnapshot.revision || 0)
      ) {
        return;
      }
      const metadata = snapshot.metadata || {};
      const safeSnapshot = {
        revision,
        state: snapshot.state || 'idle',
        metadata: {
          title: typeof metadata.title === 'string' ? metadata.title : '',
          artist: typeof metadata.artist === 'string' ? metadata.artist : '',
          artworkState:
            typeof metadata.artworkState === 'string'
              ? metadata.artworkState
              : 'bundled-placeholder',
        },
        positionMs: Math.max(0, Number(snapshot.positionMs) || 0),
        durationMs: Math.max(0, Number(snapshot.durationMs) || 0),
        volumePercent: Math.max(
          0,
          Math.min(100, Number(snapshot.volumePercent) || 0)
        ),
        muted: snapshot.muted === true,
        mode: snapshot.mode || 'sequential',
        currentOccurrenceId: snapshot.lyric ? snapshot.lyric.occurrenceId : '',
        actions:
          snapshot.actions && typeof snapshot.actions === 'object'
            ? snapshot.actions
            : {},
        queue: Array.isArray(snapshot.queue) ? snapshot.queue : [],
        recovery:
          snapshot.recovery && typeof snapshot.recovery === 'object'
            ? snapshot.recovery
            : { status: 'ready', retryable: false },
      };
      $scope.androidPlaybackSnapshot = safeSnapshot;
      if (typeof l1Player.getNativeCurrentTrack === 'function') {
        const track = l1Player.getNativeCurrentTrack();
        if (track) {
          if (!$scope.currentPlaying || $scope.currentPlaying.id !== track.id) {
            $scope.androidRecentTracks = l1Player.getNativeRecentTracks();
          }
          $scope.currentPlaying = track;
          if (!track.img_url && !track.androidArtworkRequested && track.source === 'bilibili' &&
              typeof MediaService.getVideoContext === 'function') {
            track.androidArtworkRequested = true;
            MediaService.getVideoContext(track).then((context) => {
              if (!context || !context.img_url || playControllerDestroyed) return;
              $scope.$evalAsync(() => {
                track.img_url = context.img_url;
                l1Player.rememberNativeTrackMetadata(track);
                $scope.androidRecentTracks = l1Player.getNativeRecentTracks();
              });
            }).catch(() => {});
          }
        }
        else if (!safeSnapshot.metadata.title) $scope.currentPlaying = null;
      }
      $scope.androidPlaybackQueue = safeSnapshot.queue;
      $scope.androidPlaybackVolumeDraft = safeSnapshot.volumePercent;
      $scope.androidPlaybackBusy =
        !safeSnapshot.revision || safeSnapshot.state === 'resolving';
      $scope.androidPlaybackCommandPending = '';
      $scope.androidPlaybackSeekDraft = safeSnapshot.positionMs;
      $scope.androidUi.seekMs = safeSnapshot.positionMs;
      $scope.androidPlaybackSeekAdjusting = false;
      $scope.androidPlaybackSeekUnavailable = false;
      if (revision > androidPlaybackLastAnnouncementRevision) {
        androidPlaybackLastAnnouncementRevision = revision;
      }
      // The Android renderer may display state, but its page player never owns
      // lyric time. Consume only the facade's accepted Media3 projection.
      if (typeof $scope.syncAndroidLyricClock === 'function') {
        $scope.syncAndroidLyricClock();
      }
    }

    $scope.applyAndroidPlaybackSnapshot = applyAndroidPlaybackSnapshot;

    function refreshAndroidPlaybackSnapshot() {
      if (!androidPlaybackAdapter || playControllerDestroyed) return;
      const snapshot = androidPlaybackAdapter.getPlaybackSnapshot();
      if (snapshot) {
        $scope.$evalAsync(() => applyAndroidPlaybackSnapshot(snapshot));
      }
      androidPlaybackRefreshTimer = $timeout(
        refreshAndroidPlaybackSnapshot,
        350
      );
    }

    $scope.sendAndroidPlaybackCommand = (command, payload = {}) => {
      if (
        !androidPlaybackAdapter ||
        $scope.androidPlaybackCommandPending ||
        !isAndroidPlaybackActionAvailable(command)
      ) {
        return Promise.resolve(null);
      }
      $scope.androidPlaybackCommandPending = command;
      return androidPlaybackAdapter
        .command(command, payload)
        .then((snapshot) => {
          $scope.$evalAsync(() => applyAndroidPlaybackSnapshot(snapshot));
          return snapshot;
        })
        .catch(() => {
          $scope.$evalAsync(() => {
            $scope.androidPlaybackCommandPending = '';
          });
          return null;
        });
    };

    $scope.toggleAndroidPlayback = () => {
      const snapshot = $scope.androidPlaybackSnapshot;
      return $scope.sendAndroidPlaybackCommand(
        snapshot.state === 'playing' ? 'pause' : 'play'
      );
    };
    $scope.cycleAndroidPlaybackMode = () => {
      const order = ['sequential', 'shuffle', 'repeat-one'];
      const index = order.indexOf($scope.androidPlaybackSnapshot.mode);
      return $scope.sendAndroidPlaybackCommand('mode', {
        mode: order[(index + 1) % order.length],
      });
    };
    $scope.openAndroidPlaybackModes = () => {
      $scope.androidUi.modeError = '';
      $scope.androidUi.modeMenuOpen = true;
    };
    $scope.chooseAndroidPlaybackMode = (mode) => {
      if (!['sequential', 'shuffle', 'repeat-one'].includes(mode)) return;
      $scope.androidUi.modeError = '';
      $scope.sendAndroidPlaybackCommand('mode', { mode }).then((snapshot) => $scope.$evalAsync(() => {
        if (snapshot) $scope.androidUi.modeMenuOpen = false;
        else $scope.androidUi.modeError = '切换未完成，请再试一次。';
      }));
    };
    $scope.adjustAndroidPlaybackVolume = (event) => {
      const rawValue = event && event.target ? event.target.value : event;
      const value = Math.max(0, Math.min(100, Number(rawValue) || 0));
      return $scope.sendAndroidPlaybackCommand('volume', {
        volumePercent: value,
      });
    };
    $scope.toggleAndroidPlaybackMute = () =>
      $scope.sendAndroidPlaybackCommand('mute', {
        muted: !$scope.androidPlaybackSnapshot.muted,
      });
    $scope.previewAndroidSeek = (event) => {
      $scope.androidPlaybackSeekDraft = Math.max(
        0,
        Math.min(
          Number($scope.androidPlaybackSnapshot.durationMs || 0),
          Number(event.target.value) || 0
        )
      );
      $scope.androidPlaybackSeekAdjusting = true;
    };
    $scope.commitAndroidSeek = (draft = $scope.androidPlaybackSeekDraft) => {
      if (!isAndroidPlaybackActionAvailable('seek')) {
        $scope.androidPlaybackSeekUnavailable = true;
        return Promise.resolve(null);
      }
      // The range input lives inside ng-if's child scope. Pass its draft
      // explicitly so the parent controller does not seek to the old snapshot.
      const requestedPosition = Number(draft);
      if (!Number.isFinite(requestedPosition)) return Promise.resolve(null);
      const positionMs = Math.max(0, Math.round(requestedPosition));
      $scope.androidPlaybackSeekAdjusting = true;
      return $scope.sendAndroidPlaybackCommand('seek', { positionMs });
    };
    $scope.openAndroidPlayerDetail = (event) => {
      if (!$scope.androidPlaybackHasCurrent()) return;
      androidPlaybackReturnFocus = event && event.currentTarget;
      $scope.androidPlaybackDetailOpen = true;
    };
    $scope.closeAndroidPlayerDetail = () => {
      $scope.androidPlaybackDetailOpen = false;
      $scope.androidUi.settingsOpen = false;
      if ($scope.lyricPickerOpen) $scope.closeLyricPicker();
      $timeout(() => {
        if (
          androidPlaybackReturnFocus &&
          document.contains(androidPlaybackReturnFocus)
        ) {
          androidPlaybackReturnFocus.focus();
        }
      });
    };
    $scope.androidQueueSheetOpen = false;
    $scope.androidQueueView = { limit: 80, editing: false, error: '' };
    $scope.playAndroidQueueEntry = (entry) => {
      $scope.androidQueueView.error = '';
      sendAndroidQueueCommand('jump', { occurrenceId: entry.occurrenceId })
        .then((snapshot) => $scope.$evalAsync(() => {
          if (!snapshot) $scope.androidQueueView.error = '这首歌曲暂时无法播放，请重试。';
        }));
    };
    $scope.androidQueueConfirmation = {
      open: false,
      kind: '',
      entry: null,
    };
    let androidQueueReturnFocus = null;
    let androidQueueConfirmationReturnFocus = null;
    let androidQueueDragOccurrenceId = '';

    function focusAndroidQueueTarget(selector) {
      $timeout(() => {
        const target = document.querySelector(selector);
        if (target) target.focus();
      });
    }

    function sendAndroidQueueCommand(command, payload) {
      if (
        !androidPlaybackAdapter ||
        $scope.androidPlaybackCommandPending ||
        !$scope.androidPlaybackSnapshot.revision
      ) {
        return Promise.resolve(null);
      }
      $scope.androidPlaybackCommandPending = `queue:${command}`;
      return androidPlaybackAdapter
        .command(command, payload)
        .then((snapshot) => {
          $scope.$evalAsync(() => applyAndroidPlaybackSnapshot(snapshot));
          return snapshot;
        })
        .catch(() => {
          $scope.$evalAsync(() => {
            $scope.androidPlaybackCommandPending = '';
          });
          return null;
        });
    }

    $scope.retryAndroidPlayback = () => {
      const currentOccurrence = $scope.androidPlaybackQueue[0];
      if (
        !isAndroidPlaybackActionAvailable('retry') ||
        !currentOccurrence ||
        !currentOccurrence.occurrenceId
      ) {
        return Promise.resolve(null);
      }
      return sendAndroidQueueCommand('retry', {
        occurrenceId: currentOccurrence.occurrenceId,
      });
    };

    $scope.openAndroidQueueSheet = (event) => {
      if (!$scope.androidPlaybackDetailOpen) return;
      androidQueueReturnFocus = event && event.currentTarget;
      $scope.androidQueueSheetOpen = true;
      $scope.androidQueueView = { limit: 80, editing: false, error: '' };
      focusAndroidQueueTarget(
        '[data-android-queue-sheet] [data-android-queue-close]'
      );
    };
    $scope.closeAndroidQueueSheet = () => {
      if ($scope.androidQueueConfirmation.open) {
        $scope.closeAndroidQueueConfirmation(true);
      }
      $scope.androidQueueSheetOpen = false;
      $timeout(() => {
        if (
          androidQueueReturnFocus &&
          document.contains(androidQueueReturnFocus)
        ) {
          androidQueueReturnFocus.focus();
        }
      });
    };
    $scope.requestAndroidQueueMove = (entry, targetIndex) => {
      const sourceIndex = $scope.androidPlaybackQueue.findIndex(
        (candidate) => candidate.occurrenceId === (entry && entry.occurrenceId)
      );
      if (
        sourceIndex < 0 ||
        targetIndex < 0 ||
        targetIndex >= $scope.androidPlaybackQueue.length ||
        sourceIndex === targetIndex
      ) {
        return Promise.resolve(null);
      }
      return sendAndroidQueueCommand('reorder', {
        occurrenceId: entry.occurrenceId,
        targetIndex,
      });
    };
    $scope.startAndroidQueueDrag = (entry, event) => {
      androidQueueDragOccurrenceId = entry && entry.occurrenceId;
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData(
          'text/plain',
          androidQueueDragOccurrenceId || ''
        );
      }
    };
    $scope.dropAndroidQueueAt = (entry, event) => {
      event.preventDefault();
      const occurrenceId =
        (event.dataTransfer && event.dataTransfer.getData('text/plain')) ||
        androidQueueDragOccurrenceId;
      androidQueueDragOccurrenceId = '';
      const source = $scope.androidPlaybackQueue.find(
        (candidate) => candidate.occurrenceId === occurrenceId
      );
      const targetIndex = $scope.androidPlaybackQueue.findIndex(
        (candidate) => candidate.occurrenceId === (entry && entry.occurrenceId)
      );
      return $scope.requestAndroidQueueMove(source, targetIndex);
    };
    $scope.requestAndroidQueueRemove = (entry, event) => {
      if (!entry || !entry.occurrenceId) return;
      androidQueueConfirmationReturnFocus = event && event.currentTarget;
      $scope.androidQueueConfirmation = { open: true, kind: 'remove', entry };
      focusAndroidQueueTarget(
        '[data-android-queue-confirmation] [data-android-queue-confirm]'
      );
    };
    $scope.requestAndroidQueueClear = (event) => {
      if (!$scope.androidPlaybackQueue.length) return;
      androidQueueConfirmationReturnFocus = event && event.currentTarget;
      $scope.androidQueueConfirmation = {
        open: true,
        kind: 'clear',
        entry: null,
      };
      focusAndroidQueueTarget(
        '[data-android-queue-confirmation] [data-android-queue-confirm]'
      );
    };
    $scope.closeAndroidQueueConfirmation = (restoreFocus) => {
      const wasOpen = $scope.androidQueueConfirmation.open;
      $scope.androidQueueConfirmation = { open: false, kind: '', entry: null };
      if (
        restoreFocus &&
        wasOpen &&
        androidQueueConfirmationReturnFocus &&
        document.contains(androidQueueConfirmationReturnFocus)
      ) {
        $timeout(() => androidQueueConfirmationReturnFocus.focus());
      }
    };
    $scope.confirmAndroidQueueMutation = () => {
      const confirmation = $scope.androidQueueConfirmation;
      if (!confirmation.open) return Promise.resolve(null);
      const command = confirmation.kind === 'clear' ? 'clear' : 'remove';
      const payload =
        command === 'clear'
          ? {}
          : {
              occurrenceId:
                confirmation.entry && confirmation.entry.occurrenceId,
            };
      if (!payload.occurrenceId && command === 'remove')
        return Promise.resolve(null);
      return sendAndroidQueueCommand(command, payload).then((snapshot) => {
        if (snapshot) $scope.closeAndroidQueueConfirmation(true);
        return snapshot;
      });
    };
    $scope.handleAndroidQueueKeydown = (event) => {
      if (event.key === 'Escape' || event.keyCode === 27) {
        event.preventDefault();
        if ($scope.androidQueueConfirmation.open) {
          $scope.closeAndroidQueueConfirmation(true);
        } else {
          $scope.closeAndroidQueueSheet();
        }
        return;
      }
      if (event.key !== 'Tab') return;
      const dialog = event.currentTarget;
      const focusable = Array.from(
        dialog.querySelectorAll('button:not([disabled]), input:not([disabled])')
      ).filter((element) => element.offsetParent !== null);
      if (!focusable.length) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    $scope.handleAndroidPlayerBack = (event) => {
      // Also guard the declarative player key handler, not just the document listener.
      if (event.defaultPrevented || (event.type === 'keydown' && event.key !== 'Escape' && event.keyCode !== 27)) return false;
      if (!$scope.androidPlaybackEnabled) return false;
      if ($scope.androidUi.modeMenuOpen) {
        event.preventDefault();
        $scope.androidUi.modeMenuOpen = false;
        return true;
      }
      if ($scope.androidQueueConfirmation.open) {
        event.preventDefault();
        $scope.closeAndroidQueueConfirmation(true);
        return true;
      }
      if ($scope.androidQueueSheetOpen) {
        event.preventDefault();
        $scope.closeAndroidQueueSheet();
        return true;
      }
      if (!$scope.androidPlaybackDetailOpen) return false;
      event.preventDefault();
      if ($scope.lyricPickerOpen) {
        $scope.closeLyricPicker();
        return true;
      }
      if ($scope.androidUi.settingsOpen) {
        $scope.androidUi.settingsOpen = false;
        return true;
      }
      $scope.closeAndroidPlayerDetail();
      return true;
    };
    const handleAndroidPlayerKeydown = (event) => {
      // IME input (including Enter and composition key 229) is never Back.
      if (event.defaultPrevented || (event.key !== 'Escape' && event.keyCode !== 27)) return;
      if ($scope.handleAndroidPlayerBack(event)) $scope.$evalAsync(() => {});
    };
    $scope.$on('android:playback-back', (angularEvent, playbackBack) => {
      if (!playbackBack || typeof playbackBack !== 'object') return;
      playbackBack.handled = $scope.handleAndroidPlayerBack({
        preventDefault() {},
      });
    });
    $scope.primaryLyricState = {
      state: 'idle',
      trackId: '',
      token: 0,
    };

    $scope.lyricTranslationLookupPending = false;
    $scope.lyricTranslationConfirmOpen = false;
    $scope.lyricTranslationConfirmPending = false;
    $scope.lyricTranslationConfirmError = '';
    $scope.lyricTranslationConfirmMode = 'translate';
    $scope.lyricTranslationConsent = {
      lyrics: false,
      title: false,
      artist: false,
      possibleCost: false,
      cancellation: false,
      failureImpact: false,
    };
    let activeLyricTranslationHandle = null;
    $scope.lyricTranslationSourceSnapshot = null;
    $scope.lyricPickerModal = false;
    $scope.machineTranslationConfig = {
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      targetLanguage: 'zh-CN',
      hasApiKey: false,
      secureStorageAvailable: null,
      nativeClientAvailable: false,

      apiKeyInput: '',
      defaultStyleHint: '',
      effectiveStyleHint: '',
      styleHint: '',
      maxStyleHintChars: 1200,
      promptVersion: '',
      promptFingerprint: '',
      immutableSystemPrompt: '',
      promptTemplatePreview: '',
    };
    $scope.machineTranslationConfigPending = false;
    $scope.machineTranslationTestState = { state: 'idle', message: '' };
    $scope.machineTranslationRulesOpen = false;
    $scope.audioCacheSettings = {
      supported: false,
      enabled: true,
      capacityBytes: 2 * 1024 * 1024 * 1024,
      usedBytes: 0,
      readyEntries: 0,
      queuedEntries: 0,
      lastError: '',
      loudnessNormalizationEnabled: true,
      loudnessReadyEntries: 0,
      loudnessPendingEntries: 0,
      loudnessFailedEntries: 0,
    };
    $scope.audioCacheCapacityOptions = [
      { value: 1024 * 1024 * 1024, label: '1 GB' },
      { value: 2 * 1024 * 1024 * 1024, label: '2 GB' },
      { value: 5 * 1024 * 1024 * 1024, label: '5 GB' },
      { value: 10 * 1024 * 1024 * 1024, label: '10 GB' },
      { value: null, label: '∞' },
    ];
    $scope.audioCacheActionPending = false;
    $scope.audioCacheManager = {
      loading: false,
      deleting: false,
      query: '',
      sort: 'recent',
      filter: 'all',
      entries: [],
      tasks: [],
      taskPending: {},
      selected: {},
      deleteConfirmationOpen: false,
      pendingDeleteEntries: [],
      error: '',
    };
    $scope.audioCacheSortOptions = [
      { value: 'recent', label: i18next.t('_AUDIO_CACHE_SORT_RECENT') },
      { value: 'oldest', label: i18next.t('_AUDIO_CACHE_SORT_OLDEST') },
      { value: 'largest', label: i18next.t('_AUDIO_CACHE_SORT_LARGEST') },
      { value: 'cached', label: i18next.t('_AUDIO_CACHE_SORT_CACHED') },
      { value: 'title', label: i18next.t('_AUDIO_CACHE_SORT_TITLE') },
    ];
    $scope.audioEffects = {
      open: false,
      selectedPreset: 'original',
      activePreset: 'original',
      lastActivePreset: 'original',
      supported: null,
      degraded: false,
      error: '',
      pending: false,
    };
    $scope.audioEffectPresets = [
      {
        id: 'original',
        labelKey: '_AUDIO_EFFECT_PRESET_ORIGINAL',
        descriptionKey: '_AUDIO_EFFECT_PRESET_ORIGINAL_DESCRIPTION',
      },
      {
        id: 'clear-vocals',
        labelKey: '_AUDIO_EFFECT_PRESET_CLEAR_VOCALS',
        descriptionKey: '_AUDIO_EFFECT_PRESET_CLEAR_VOCALS_DESCRIPTION',
      },
      {
        id: 'deep-bass',
        labelKey: '_AUDIO_EFFECT_PRESET_DEEP_BASS',
        descriptionKey: '_AUDIO_EFFECT_PRESET_DEEP_BASS_DESCRIPTION',
      },
      {
        id: 'airy',
        labelKey: '_AUDIO_EFFECT_PRESET_AIRY',
        descriptionKey: '_AUDIO_EFFECT_PRESET_AIRY_DESCRIPTION',
      },
      {
        id: 'warm',
        labelKey: '_AUDIO_EFFECT_PRESET_WARM',
        descriptionKey: '_AUDIO_EFFECT_PRESET_WARM_DESCRIPTION',
      },
      {
        id: 'hifi-live',
        labelKey: '_AUDIO_EFFECT_PRESET_HIFI_LIVE',
        descriptionKey: '_AUDIO_EFFECT_PRESET_HIFI_LIVE_DESCRIPTION',
      },
      {
        id: 'immersive-3d',
        labelKey: '_AUDIO_EFFECT_PRESET_IMMERSIVE_3D',
        descriptionKey: '_AUDIO_EFFECT_PRESET_IMMERSIVE_3D_DESCRIPTION',
        headphoneOnly: true,
      },
      {
        id: 'night',
        labelKey: '_AUDIO_EFFECT_PRESET_NIGHT',
        descriptionKey: '_AUDIO_EFFECT_PRESET_NIGHT_DESCRIPTION',
      },
    ];
    $scope.annualListening = {
      loading: false,
      enabled: true,
      year: new Date().getFullYear(),
      recordingSince: 0,
      summary: null,
    };
    $scope.formatListeningTime = (seconds) => {
      const totalMinutes = Math.floor(Math.max(0, Number(seconds) || 0) / 60);
      if (totalMinutes < 60) return `${totalMinutes} ${i18next.t('_MINUTES')}`;
      const hours = Math.floor(totalMinutes / 60);
      const minutes = totalMinutes % 60;
      return `${hours}h ${minutes}m`;
    };
    $scope.refreshAnnualListeningSummary = () => {
      if (!isElectron()) return;
      $scope.annualListening.loading = true;
      Promise.all([
        MediaService.getListeningHistoryStatus(),
        MediaService.getAnnualListeningSummary($scope.annualListening.year),
      ])
        .then(([status, summary]) => {
          $scope.$evalAsync(() => {
            $scope.annualListening.enabled = status.enabled !== false;
            $scope.annualListening.recordingSince = status.recordingSince || 0;
            $scope.annualListening.summary =
              summary && summary.ok ? summary : null;
          });
        })
        .finally(() => {
          $scope.$evalAsync(() => {
            $scope.annualListening.loading = false;
          });
        });
    };
    $scope.updateListeningHistoryEnabled = () => {
      MediaService.configureListeningHistory($scope.annualListening.enabled)
        .then(() => $scope.refreshAnnualListeningSummary())
        .catch(() => {});
    };
    $scope.exportListeningHistory = () => {
      MediaService.exportListeningHistory().then((result) => {
        if (!result || !result.ok) return;
        const blob = new Blob([JSON.stringify(result, null, 2)], {
          type: 'application/json',
        });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `listen2-listening-history-${Date.now()}.json`;
        link.click();
        URL.revokeObjectURL(link.href);
      });
    };
    $scope.clearListeningHistory = () => {
      // eslint-disable-next-line no-alert
      if (!window.confirm(i18next.t('_ANNUAL_RECAP_CLEAR_CONFIRM'))) return;
      MediaService.clearListeningHistory().then(() =>
        $scope.refreshAnnualListeningSummary()
      );
    };
    $scope.bilibiliMv = {
      available: false,
      active: false,
      loading: false,
      error: '',
      selectedVariantKey: '',
      videoVariants: [],
    };

    const LYRIC_OFFSET_STORAGE_KEY = 'bilibili-lyric-offsets';
    const MAX_LYRIC_OFFSET_MS = 60000;
    let lyricRequestToken = 0;
    let lyricSearchToken = 0;
    let neteaseLyricVerificationToken = 0;
    let activeLyricSearch = null;
    let activeLyricSearchKey = '';
    $scope.lyricSearchSources = [];
    let manualLyricResolveToken = 0;
    let manualLyricSelectionToken = 0;
    let lyricTranslationRequestToken = 0;
    let nativeLyricRequestIdentity = null;
    let activeNativeLyricIdentity = null;
    let nativeLyricOffsetPending = null;
    let nativeManualLyricPending = null;
    let nativeManualLyricClearPending = null;
    let bilibiliMvPlayer = null;
    let lastMvPosition = 0;
    const AUDIO_CACHE_STATUS_POLL_MS = 2000;
    let audioCacheStatusPollTimer = null;

    function setPrimaryLyricState(track, state) {
      if (!track || !track.id) return;
      $scope.primaryLyricState = {
        state,
        trackId: track.id,
        token: lyricRequestToken,
      };
    }

    function getNativeLyricIdentity() {
      if (
        !androidPlaybackAdapter ||
        !l1Player ||
        typeof l1Player.getNativeLyricSnapshot !== 'function'
      ) {
        return null;
      }
      const snapshot = l1Player.getNativeLyricSnapshot();
      if (
        !snapshot ||
        !snapshot.pageEpoch ||
        !snapshot.trackHandle ||
        !snapshot.occurrenceId ||
        !snapshot.source ||
        !Number.isSafeInteger(Number(snapshot.selectionGeneration)) ||
        !Number.isSafeInteger(Number(snapshot.playbackRevision))
      ) {
        return null;
      }
      return snapshot;
    }

    function getCurrentLyricTrack(track) {
      const snapshot = getNativeLyricIdentity();
      if (!androidPlaybackAdapter || !snapshot) return track;
      return {
        ...track,
        pageEpoch: snapshot.pageEpoch,
        nativeLyricIdentity: {
          selectionIdentity: snapshot.trackHandle,
          selectionRevision: snapshot.selectionGeneration,
          selectionToken: snapshot.occurrenceId,
        },
      };
    }

    function canUseManualLyric(track) {
      if (!track || !track.id) return false;
      if (!androidPlaybackAdapter) {
        // eslint-disable-next-line no-use-before-define
        return isBilibiliTrack(track);
      }
      const snapshot = getNativeLyricIdentity();
      return Boolean(
        snapshot &&
          snapshot.source === track.source &&
          String(snapshot.capability || '').includes('manual')
      );
    }

    function isSameNativeLyricSelection(left, right) {
      return Boolean(
        left &&
          right &&
          left.pageEpoch === right.pageEpoch &&
          left.source === right.source &&
          left.trackHandle === right.trackHandle &&
          left.occurrenceId === right.occurrenceId &&
          Number(left.selectionGeneration) === Number(right.selectionGeneration)
      );
    }

    function isCurrentNativeLyricIdentity(identity) {
      const current = getNativeLyricIdentity();
      return Boolean(
        identity &&
          current &&
          isSameNativeLyricSelection(identity, current) &&
          Number(identity.playbackRevision) <= Number(current.playbackRevision)
      );
    }

    function syncAndroidLyricClock() {
      const snapshot = getNativeLyricIdentity();
      if (!snapshot) return;
      if (!isSameNativeLyricSelection(activeNativeLyricIdentity, snapshot)) {
        activeNativeLyricIdentity = snapshot;
        nativeLyricRequestIdentity = null;
        lyricRequestToken += 1;
        $scope.lyricLineNumber = -1;
        $scope.lyricLineNumberTrans = -1;
        const track = $scope.currentPlaying;
        if (track && track.id) {
          resetLyricDisplay();
          $scope.lyricOffsetMs = getTrackLyricOffset(track.id);
          setPrimaryLyricState(track, 'loading');
          requestTrackLyric(track);
        }
      }
      if (
        nativeLyricOffsetPending &&
        isSameNativeLyricSelection(
          nativeLyricOffsetPending.identity,
          snapshot
        ) &&
        Number(snapshot.playbackRevision) >
          Number(nativeLyricOffsetPending.revision)
      ) {
        $scope.lyricOffsetMs = nativeLyricOffsetPending.offsetMs;
        nativeLyricOffsetPending = null;
      }
      if (
        nativeManualLyricPending &&
        isSameNativeLyricSelection(
          nativeManualLyricPending.identity,
          snapshot
        ) &&
        Number(snapshot.playbackRevision) >
          Number(nativeManualLyricPending.revision)
      ) {
        const pending = nativeManualLyricPending;
        nativeManualLyricPending = null;
        // eslint-disable-next-line no-use-before-define
        applyLyricResult(pending.track, pending.result);
      }
      if (
        nativeManualLyricClearPending &&
        isSameNativeLyricSelection(
          nativeManualLyricClearPending.identity,
          snapshot
        ) &&
        Number(snapshot.playbackRevision) >
          Number(nativeManualLyricClearPending.revision)
      ) {
        const pending = nativeManualLyricClearPending;
        nativeManualLyricClearPending = null;
        // eslint-disable-next-line no-use-before-define
        requestTrackLyric(pending.track);
      }
      if (!Array.isArray($scope.lyricArray) || !$scope.lyricArray.length) {
        return;
      }
      const currentMs =
        Math.max(0, Number(snapshot.positionMs) || 0) +
        (Number($scope.lyricOffsetMs) || 0);
      let activeOriginal = null;
      let activeTranslation = null;
      $scope.lyricArray.forEach((line) => {
        if (currentMs < Number(line.seconds || 0)) return;
        if (line.translationFlag === true) activeTranslation = line;
        else activeOriginal = line;
      });
      const previousLine = $scope.lyricLineNumber;
      $scope.lyricLineNumber = activeOriginal ? activeOriginal.lineNumber : -1;
      $scope.lyricLineNumberTrans = activeTranslation
        ? activeTranslation.lineNumber
        : -1;
      if ($scope.androidUi.tab === 'lyrics' && previousLine !== $scope.lyricLineNumber) {
        $timeout(() => {
          const container = document.querySelector('.android-player-lyrics');
          const line = container && container.querySelector(`[data-line="${$scope.lyricLineNumber}"]`);
          if (line) container.scrollTo({
            top: Math.max(0, container.scrollTop + line.getBoundingClientRect().top
              - container.getBoundingClientRect().top - container.clientHeight * 0.35),
            behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
          });
        }, 0, false);
      }
    }

    $scope.syncAndroidLyricClock = syncAndroidLyricClock;

    $scope.toggleAndroidLyricCalibration = () => {
      $scope.androidUi.calibrationOpen = !$scope.androidUi.calibrationOpen;
      $timeout(() => {
        $scope.lyricLineNumber = -1;
        syncAndroidLyricClock();
      }, 0);
    };

    function isCurrentPrimaryLyricState(track, requestToken) {
      return (
        !playControllerDestroyed &&
        // The legacy resolver below owns the active lyric token.
        // eslint-disable-next-line no-use-before-define
        isCurrentLyricRequest(track, requestToken) &&
        $scope.primaryLyricState.trackId === track.id &&
        $scope.primaryLyricState.token === requestToken
      );
    }

    $scope.openPrimaryLyrics = () => {
      const track = $scope.currentPlaying;
      if (androidPlaybackAdapter) {
        $scope.androidPlaybackDetailOpen = true;
        $scope.androidUi.tab = 'lyrics';
        if (!track || !track.id) return;
        $scope.lyricLineNumber = -1;
        syncAndroidLyricClock();
        if ($scope.primaryLyricState.trackId !== track.id || $scope.primaryLyricState.state === 'idle')
          requestTrackLyric(track);
        return;
      }
      if (!track || !track.id) return;
      if (
        $scope.window_type !== 'track' &&
        typeof $scope.toggleNowPlaying === 'function'
      ) {
        $scope.toggleNowPlaying();
      }
      if (
        $scope.primaryLyricState.trackId !== track.id ||
        $scope.primaryLyricState.state === 'idle'
      ) {
        // eslint-disable-next-line no-use-before-define
        requestTrackLyric(track);
      }
    };

    $scope.cancelPrimaryLyrics = () => {
      lyricRequestToken += 1;
      const track = $scope.currentPlaying;
      if (track && track.id) {
        setPrimaryLyricState(track, 'idle');
      }
    };

    $scope.retryPrimaryLyrics = () => {
      if ($scope.currentPlaying && $scope.currentPlaying.id) {
        // eslint-disable-next-line no-use-before-define
        requestTrackLyric($scope.currentPlaying);
      }
    };
    const inheritedCloseDialog = $scope.closeDialog;
    if (typeof inheritedCloseDialog === 'function') {
      $scope.closeDialog = () => {
        $scope.audioCacheActionPending = false;
        inheritedCloseDialog();
      };
    }
    const legacyBilibiliLyricMigration = isElectron()
      ? MediaService.migrateLegacyBilibiliManualLyrics().catch(() => null)
      : Promise.resolve(null);
    if (isElectron()) {
      MediaService.syncAudioCachePlaylistMembership().catch(() => null);
      $scope.$on('myplaylist:update', () => {
        MediaService.syncAudioCachePlaylistMembership()
          .then(() => $scope.refreshAudioCacheInventory())
          .catch(() => null);
      });
    }

    function cancelAudioCacheStatusPoll() {
      if (!audioCacheStatusPollTimer) return;
      $timeout.cancel(audioCacheStatusPollTimer);
      audioCacheStatusPollTimer = null;
    }

    function scheduleAudioCacheStatusPoll(status) {
      const shouldPoll =
        !playControllerDestroyed &&
        isElectron() &&
        status &&
        status.supported !== false &&
        (Number(status.queuedEntries) > 0 ||
          (status.loudnessNormalizationEnabled !== false &&
            Number(status.loudnessPendingEntries) > 0) ||
          Boolean(document.querySelector('[data-audio-cache-library-page]')));
      if (!shouldPoll) {
        cancelAudioCacheStatusPoll();
        return;
      }
      if (audioCacheStatusPollTimer) return;
      audioCacheStatusPollTimer = $timeout(
        () => {
          audioCacheStatusPollTimer = null;
          if (!playControllerDestroyed) {
            $scope.refreshAudioCacheStatus();
            if (
              !document.hidden &&
              document.querySelector('[data-audio-cache-library-page]')
            ) {
              $scope.refreshAudioCacheInventory();
            }
          }
        },
        AUDIO_CACHE_STATUS_POLL_MS,
        false
      );
    }

    function applyAudioCacheStatus(response) {
      if (!response || response.ok !== true) {
        $scope.audioCacheSettings = {
          ...$scope.audioCacheSettings,
          lastError: (response && response.status) || 'request-failed',
        };
        cancelAudioCacheStatusPoll();
        return false;
      }
      $scope.audioCacheSettings = {
        ...$scope.audioCacheSettings,
        ...response,
        supported: response.supported !== false,
      };
      if (isElectron()) {
        const player = getPlayer(getPlayerMode());
        if (
          player &&
          typeof player.setLoudnessNormalizationEnabled === 'function'
        ) {
          player.setLoudnessNormalizationEnabled(
            $scope.audioCacheSettings.loudnessNormalizationEnabled !== false
          );
        }
      }
      scheduleAudioCacheStatusPoll($scope.audioCacheSettings);
      return true;
    }

    $scope.formatAudioCacheBytes = (value) => {
      const bytes = Math.max(0, Number(value) || 0);
      if (bytes >= 1024 * 1024 * 1024) {
        return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
      }
      if (bytes >= 1024 * 1024) {
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
      }
      return `${Math.round(bytes / 1024)} KB`;
    };

    $scope.refreshAudioCacheStatus = () => {
      if (!isElectron()) {
        return Promise.resolve(null);
      }
      if ($scope.audioCacheActionPending) {
        scheduleAudioCacheStatusPoll($scope.audioCacheSettings);
        return Promise.resolve(null);
      }
      return MediaService.getAudioCacheStatus()
        .then((response) => {
          $scope.$evalAsync(() => applyAudioCacheStatus(response));
          return response;
        })
        .catch(() => {
          cancelAudioCacheStatusPoll();
          $scope.$evalAsync(() => {
            $scope.audioCacheSettings.lastError = 'request-failed';
          });
          return null;
        });
    };

    function updateAudioCacheSettings(patch) {
      if (!isElectron() || $scope.audioCacheActionPending) {
        return;
      }
      $scope.audioCacheActionPending = true;
      MediaService.configureAudioCache(patch)
        .then((response) => {
          $scope.$evalAsync(() => {
            $scope.audioCacheActionPending = false;
            if (!applyAudioCacheStatus(response)) {
              notyf.error(
                $scope.audioCacheErrorLabel(response && response.status)
              );
              $scope.refreshAudioCacheStatus();
            }
            $scope.refreshAudioCacheInventory();
          });
        })
        .catch(() => {
          $scope.$evalAsync(() => {
            $scope.audioCacheActionPending = false;
            $scope.audioCacheSettings.lastError = 'request-failed';
            notyf.error(i18next.t('_AUDIO_CACHE_FAILURE_NOTICE'));
          });
        });
    }

    $scope.updateAudioCacheEnabled = () =>
      updateAudioCacheSettings({ enabled: $scope.audioCacheSettings.enabled });
    $scope.updateAudioCacheCapacity = () =>
      updateAudioCacheSettings({
        capacityBytes: $scope.audioCacheSettings.capacityBytes,
      });
    $scope.updateLoudnessNormalizationEnabled = () =>
      updateAudioCacheSettings({
        loudnessNormalizationEnabled:
          $scope.audioCacheSettings.loudnessNormalizationEnabled,
      });
    $scope.loudnessNormalizationStatus = () =>
      i18next.t('_LOUDNESS_NORMALIZATION_STATUS', {
        ready: $scope.audioCacheSettings.loudnessReadyEntries || 0,
        pending: $scope.audioCacheSettings.loudnessPendingEntries || 0,
        failed: $scope.audioCacheSettings.loudnessFailedEntries || 0,
      });

    const AUDIO_EFFECT_STORAGE_KEY = 'listen2-audio-effect-settings';
    const AUDIO_EFFECT_PRESET_IDS = $scope.audioEffectPresets.map(
      (preset) => preset.id
    );

    function hasAudioEffectPreset(presetId) {
      return AUDIO_EFFECT_PRESET_IDS.includes(presetId);
    }

    function getAudioEffectsApi() {
      if (typeof Listen1AudioAnalysis === 'undefined') return null;
      if (
        typeof Listen1AudioAnalysis.setEffectPreset !== 'function' ||
        typeof Listen1AudioAnalysis.getEffectState !== 'function'
      ) {
        return null;
      }
      return Listen1AudioAnalysis;
    }

    function setAudioEffectsState(response, requestedPreset) {
      const safeRequestedPreset = hasAudioEffectPreset(requestedPreset)
        ? requestedPreset
        : $scope.audioEffects.selectedPreset;
      const safeActivePreset = hasAudioEffectPreset(response && response.preset)
        ? response.preset
        : 'original';
      const supported = response && response.supported !== false;
      $scope.audioEffects = {
        ...$scope.audioEffects,
        selectedPreset: safeRequestedPreset,
        activePreset: safeActivePreset,
        lastActivePreset:
          safeActivePreset === 'original'
            ? $scope.audioEffects.lastActivePreset
            : safeActivePreset,
        supported,
        degraded: Boolean(response && response.degraded),
        error: (response && response.error) || '',
        pending: false,
      };
    }

    function persistAudioEffectPreset(presetId) {
      try {
        localStorage.setObject(AUDIO_EFFECT_STORAGE_KEY, { preset: presetId });
        return true;
      } catch (error) {
        return false;
      }
    }

    function getStoredAudioEffectPreset() {
      try {
        const stored = localStorage.getObject(AUDIO_EFFECT_STORAGE_KEY);
        return stored && hasAudioEffectPreset(stored.preset)
          ? stored.preset
          : 'original';
      } catch (error) {
        return 'original';
      }
    }

    function getAudioEffectFailureMessage(error) {
      if (error === 'unsupported')
        return i18next.t('_AUDIO_EFFECT_UNSUPPORTED');
      if (error === 'invalid-preset') {
        return i18next.t('_AUDIO_EFFECT_INVALID_PRESET');
      }
      return i18next.t('_AUDIO_EFFECT_UNAVAILABLE');
    }

    function syncAudioEffectState() {
      const api = getAudioEffectsApi();
      if (!isElectron() || !api) {
        setAudioEffectsState(
          {
            ok: false,
            preset: 'original',
            supported: false,
            degraded: true,
            error: 'unsupported',
          },
          $scope.audioEffects.selectedPreset
        );
        return null;
      }
      try {
        const response = api.getEffectState();
        setAudioEffectsState(response, $scope.audioEffects.selectedPreset);
        return response;
      } catch (error) {
        setAudioEffectsState(
          {
            ok: false,
            preset: 'original',
            supported: false,
            degraded: true,
            error: 'effect-unavailable',
          },
          $scope.audioEffects.selectedPreset
        );
        return null;
      }
    }

    $scope.audioEffectPresetLabel = (presetId) => {
      const preset = $scope.audioEffectPresets.find(
        (item) => item.id === presetId
      );
      return i18next.t(
        (preset && preset.labelKey) || '_AUDIO_EFFECT_PRESET_ORIGINAL'
      );
    };

    $scope.audioEffectPresetDescription = (presetId) => {
      const preset = $scope.audioEffectPresets.find(
        (item) => item.id === presetId
      );
      return i18next.t(
        (preset && preset.descriptionKey) ||
          '_AUDIO_EFFECT_PRESET_ORIGINAL_DESCRIPTION'
      );
    };

    $scope.audioEffectStatus = () => {
      const state = $scope.audioEffects;
      if (state.supported === false)
        return getAudioEffectFailureMessage(state.error);
      if (state.degraded) return i18next.t('_AUDIO_EFFECT_DEGRADED');
      if (state.activePreset === 'original') {
        return i18next.t('_AUDIO_EFFECT_ORIGINAL_STATUS');
      }
      return i18next.t('_AUDIO_EFFECT_ACTIVE_STATUS', {
        effect: $scope.audioEffectPresetLabel(state.activePreset),
      });
    };

    $scope.toggleAudioEffectsPanel = () => {
      $scope.audioEffects.open = !$scope.audioEffects.open;
      if ($scope.audioEffects.open) syncAudioEffectState();
    };

    $scope.selectAudioEffectPreset = (presetId, options = {}) => {
      if (!hasAudioEffectPreset(presetId) || $scope.audioEffects.pending)
        return;
      const shouldNotify = options.silent !== true;
      $scope.audioEffects = {
        ...$scope.audioEffects,
        selectedPreset: presetId,
        pending: true,
      };
      if (
        options.persist !== false &&
        !persistAudioEffectPreset(presetId) &&
        shouldNotify
      ) {
        notyf.warning(i18next.t('_AUDIO_EFFECT_SAVE_FAILED'));
      }

      const api = getAudioEffectsApi();
      if (!isElectron() || !api) {
        setAudioEffectsState(
          {
            ok: false,
            preset: 'original',
            supported: false,
            degraded: true,
            error: 'unsupported',
          },
          presetId
        );
        if (shouldNotify)
          notyf.warning(getAudioEffectFailureMessage('unsupported'));
        return;
      }
      try {
        const response = api.setEffectPreset(presetId);
        setAudioEffectsState(response, presetId);
        if (!response || response.ok !== true) {
          if (shouldNotify) {
            notyf.warning(
              response && response.degraded
                ? i18next.t('_AUDIO_EFFECT_DEGRADED')
                : getAudioEffectFailureMessage(response && response.error)
            );
          }
          return;
        }
        if (shouldNotify && presetId !== 'original') {
          notyf.success(
            i18next.t('_AUDIO_EFFECT_ACTIVE_STATUS', {
              effect: $scope.audioEffectPresetLabel(response.preset),
            })
          );
        }
      } catch (error) {
        setAudioEffectsState(
          {
            ok: false,
            preset: 'original',
            supported: false,
            degraded: true,
            error: 'effect-unavailable',
          },
          presetId
        );
        if (shouldNotify) notyf.warning(getAudioEffectFailureMessage());
      }
    };

    $scope.compareAudioEffectWithOriginal = () => {
      const { activePreset, lastActivePreset, selectedPreset } =
        $scope.audioEffects;
      const restorePreset =
        lastActivePreset && lastActivePreset !== 'original'
          ? lastActivePreset
          : selectedPreset;
      $scope.selectAudioEffectPreset(
        activePreset === 'original' ? restorePreset : 'original',
        { persist: false }
      );
    };

    $scope.audioEffectComparisonLabel = () =>
      $scope.audioEffects.activePreset === 'original'
        ? i18next.t('_AUDIO_EFFECT_RESTORE')
        : i18next.t('_AUDIO_EFFECT_COMPARE_ORIGINAL');

    $scope.restoreStoredAudioEffect = () => {
      const presetId = getStoredAudioEffectPreset();
      $scope.audioEffects.selectedPreset = presetId;
      $scope.selectAudioEffectPreset(presetId, {
        silent: true,
        persist: false,
      });
    };

    $scope.requestClearAudioCache = () => {
      if ($scope.audioCacheActionPending || !isElectron()) return;
      $scope.showDialog(15);
    };
    $scope.cancelClearAudioCache = () => {
      $scope.closeDialog();
    };
    $scope.confirmClearAudioCache = () => {
      if ($scope.audioCacheActionPending) return;
      $scope.audioCacheActionPending = true;
      MediaService.clearAudioCache()
        .then((response) => {
          $scope.$evalAsync(() => {
            $scope.audioCacheActionPending = false;
            $scope.closeDialog();
            $scope.refreshAudioCacheStatus();
            $scope.refreshAudioCacheInventory();
            if (!response || response.ok !== true) {
              notyf.error(
                $scope.audioCacheErrorLabel(response && response.status)
              );
            }
          });
        })
        .catch(() => {
          $scope.$evalAsync(() => {
            $scope.audioCacheActionPending = false;
            notyf.error(i18next.t('_AUDIO_CACHE_FAILURE_NOTICE'));
          });
        });
    };

    function getMyPlaylistTrackIds() {
      const result = new Set();
      const playlistIds = localStorage.getObject('playerlists');
      (Array.isArray(playlistIds) ? playlistIds : []).forEach((playlistId) => {
        const playlist = localStorage.getObject(playlistId);
        (playlist && Array.isArray(playlist.tracks)
          ? playlist.tracks
          : []
        ).forEach((track) => {
          if (track && track.id) result.add(String(track.id));
        });
      });
      return result;
    }

    function decorateAudioCacheEntries(entries) {
      const playlistTrackIds = getMyPlaylistTrackIds();
      return (Array.isArray(entries) ? entries : []).map((entry) => ({
        ...entry,
        inMyPlaylists: (entry.trackIds || []).some((trackId) =>
          playlistTrackIds.has(String(trackId))
        ),
      }));
    }

    $scope.refreshAudioCacheInventory = () => {
      if (!isElectron() || $scope.audioCacheManager.loading) {
        return Promise.resolve(null);
      }
      $scope.audioCacheManager.loading = true;
      $scope.audioCacheManager.error = '';
      return MediaService.listAudioCache()
        .then((response) => {
          $scope.$evalAsync(() => {
            $scope.audioCacheManager.loading = false;
            if (!response || response.ok !== true) {
              $scope.audioCacheManager.error =
                (response && response.status) || 'request-failed';
              return;
            }
            $scope.audioCacheManager.tasks = response.tasks || [];
            $scope.audioCacheSettings.usedBytes = response.usedBytes || 0;
            scheduleAudioCacheStatusPoll($scope.audioCacheSettings);
            $scope.audioCacheManager.entries = decorateAudioCacheEntries(
              response.entries
            );
            const available = new Set(
              $scope.audioCacheManager.entries.map((entry) => entry.cacheKey)
            );
            Object.keys($scope.audioCacheManager.selected).forEach(
              (cacheKey) => {
                if (!available.has(cacheKey)) {
                  delete $scope.audioCacheManager.selected[cacheKey];
                }
              }
            );
          });
          return response;
        })
        .catch(() => {
          $scope.$evalAsync(() => {
            $scope.audioCacheManager.loading = false;
            $scope.audioCacheManager.error = 'request-failed';
          });
          return null;
        });
    };

    $scope.audioCacheTaskLabel = (state) =>
      i18next.t(
        {
          queued: '_CACHE_TASK_QUEUED',
          downloading: '_CACHE_TASK_DOWNLOADING',
          cancelling: '_CACHE_TASK_CANCELLING',
          failed: '_CACHE_TASK_FAILED',
        }[state] || '_CACHE_TASK_QUEUED'
      );

    $scope.audioCacheErrorLabel = (code) => {
      const messages = {
        'capacity-exhausted': '_CACHE_ERROR_CAPACITY',
        'downloaded-items-exceed-capacity': '_CACHE_ERROR_CAPACITY',
        ENOSPC: '_CACHE_ERROR_DISK',
        EACCES: '_CACHE_ERROR_PERMISSION',
        EPERM: '_CACHE_ERROR_PERMISSION',
        'file-busy': '_CACHE_ERROR_BUSY',
        'in-use': '_CACHE_ERROR_BUSY',
        timeout: '_CACHE_ERROR_TIMEOUT',
        'queue-full': '_CACHE_ERROR_QUEUE',
      };
      return i18next.t(messages[code] || '_CACHE_ERROR_GENERIC');
    };

    $scope.updateAudioCacheTask = (task, action) => {
      if (!task || $scope.audioCacheManager.taskPending[task.cacheKey]) return;
      $scope.audioCacheManager.taskPending[task.cacheKey] = true;
      MediaService.updateAudioCacheTask(task.cacheKey, action)
        .then((response) => {
          if (!response || !response.ok)
            notyf.error(
              $scope.audioCacheErrorLabel(response && response.status)
            );
        })
        .catch(() => notyf.error($scope.audioCacheErrorLabel()))
        .finally(() =>
          $scope.$evalAsync(() => {
            delete $scope.audioCacheManager.taskPending[task.cacheKey];
            $scope.refreshAudioCacheInventory();
            $scope.refreshAudioCacheStatus();
          })
        );
    };

    $scope.openAudioCacheLibrary = () => {
      $rootScope.$broadcast('audio-cache:open');
    };

    $scope.visibleAudioCacheEntries = () => {
      const query = String($scope.audioCacheManager.query || '')
        .trim()
        .toLocaleLowerCase();
      const entries = $scope.audioCacheManager.entries.filter((entry) => {
        const filter = $scope.audioCacheManager.filter || 'all';
        if (filter === 'downloaded' && !entry.downloaded) {
          return false;
        }
        if (filter === 'playlist' && entry.retention !== 'playlist') {
          return false;
        }
        if (filter === 'temporary' && entry.retention !== 'temporary') {
          return false;
        }
        if (!query) return true;
        return [entry.title, entry.artist, ...(entry.trackIds || [])]
          .join(' ')
          .toLocaleLowerCase()
          .includes(query);
      });
      const { sort } = $scope.audioCacheManager;
      return [...entries].sort((left, right) => {
        if (sort === 'oldest') {
          return left.lastAccessedAt - right.lastAccessedAt;
        }
        if (sort === 'largest') return right.byteLength - left.byteLength;
        if (sort === 'cached') return right.cachedAt - left.cachedAt;
        if (sort === 'title') {
          return String(left.title || '').localeCompare(
            String(right.title || '')
          );
        }
        return right.lastAccessedAt - left.lastAccessedAt;
      });
    };

    $scope.formatAudioCacheDate = (value) => {
      const date = new Date(Number(value));
      return Number.isFinite(date.getTime())
        ? new Intl.DateTimeFormat(i18next.language || undefined, {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
          }).format(date)
        : '—';
    };

    $scope.audioCacheSelectedEntries = () =>
      $scope.audioCacheManager.entries.filter(
        (entry) => $scope.audioCacheManager.selected[entry.cacheKey]
      );

    $scope.audioCacheSelectedBytes = () =>
      $scope
        .audioCacheSelectedEntries()
        .reduce((total, entry) => total + Number(entry.byteLength || 0), 0);

    $scope.setAudioCacheDownloaded = (entry, downloaded) => {
      if (!entry || !entry.cacheKey || $scope.audioCacheManager.deleting) {
        return;
      }
      let retention = 'temporary';
      if (downloaded) retention = 'download';
      else if (entry.inMyPlaylists) retention = 'playlist';
      $scope.audioCacheManager.deleting = true;
      MediaService.setAudioCacheRetention(entry.cacheKey, retention)
        .then((response) => {
          $scope.$evalAsync(() => {
            $scope.audioCacheManager.deleting = false;
            if (!response || response.ok !== true) {
              notyf.error(i18next.t('_AUDIO_CACHE_FAILURE_NOTICE'));
              return;
            }
            $scope.audioCacheManager.entries.forEach((current) => {
              if (current.cacheKey === entry.cacheKey) {
                current.retention = retention;
                current.downloaded = retention === 'download';
              }
            });
            $scope.refreshAudioCacheStatus();
          });
        })
        .catch(() => {
          $scope.$evalAsync(() => {
            $scope.audioCacheManager.deleting = false;
            notyf.error(i18next.t('_AUDIO_CACHE_FAILURE_NOTICE'));
          });
        });
    };

    $scope.playAudioCacheEntry = (entry) => {
      if (!entry || entry.playable !== true) {
        notyf.info(i18next.t('_AUDIO_CACHE_NOT_PLAYABLE'));
        return;
      }
      const track = MediaService.getAudioCachePlayableTrack(entry);
      if (!track) {
        notyf.info(i18next.t('_AUDIO_CACHE_NOT_PLAYABLE'));
        return;
      }
      l1Player.setNewPlaylist([track]);
      l1Player.play();
    };

    $scope.selectVisibleAudioCacheEntries = () => {
      $scope.visibleAudioCacheEntries().forEach((entry) => {
        $scope.audioCacheManager.selected[entry.cacheKey] = true;
      });
    };

    $scope.clearAudioCacheSelection = () => {
      $scope.audioCacheManager.selected = {};
    };

    $scope.requestDeleteAudioCacheEntries = (entries) => {
      const requested = (Array.isArray(entries) ? entries : []).filter(
        (entry) => entry && entry.cacheKey
      );
      if (!requested.length || $scope.audioCacheManager.deleting) return;
      $scope.audioCacheManager.pendingDeleteEntries = requested;
      $scope.audioCacheManager.deleteConfirmationOpen = true;
    };

    $scope.requestDeleteSelectedAudioCacheEntries = () => {
      $scope.requestDeleteAudioCacheEntries($scope.audioCacheSelectedEntries());
    };

    $scope.cancelDeleteAudioCacheEntries = () => {
      $scope.audioCacheManager.deleteConfirmationOpen = false;
      $scope.audioCacheManager.pendingDeleteEntries = [];
    };

    $scope.pendingAudioCacheDeleteBytes = () =>
      $scope.audioCacheManager.pendingDeleteEntries.reduce(
        (total, entry) => total + Number(entry.byteLength || 0),
        0
      );

    $scope.confirmDeleteAudioCacheEntries = () => {
      const entries = [...$scope.audioCacheManager.pendingDeleteEntries];
      if (!entries.length || $scope.audioCacheManager.deleting) return;
      $scope.audioCacheManager.deleting = true;
      $scope.audioCacheActionPending = true;
      entries
        .reduce(
          (promise, entry) =>
            promise.then((results) =>
              MediaService.deleteAudioCacheEntry(entry.cacheKey).then(
                (response) => [...results, response]
              )
            ),
          Promise.resolve([])
        )
        .then((responses) => {
          $scope.$evalAsync(() => {
            $scope.audioCacheManager.deleting = false;
            $scope.audioCacheActionPending = false;
            $scope.refreshAudioCacheInventory();
            $scope.refreshAudioCacheStatus();
            if (responses.some((response) => !response || !response.ok)) {
              const failure = responses.find(
                (response) => !response || !response.ok
              );
              notyf.error(
                $scope.audioCacheErrorLabel(failure && failure.status)
              );
              return;
            }
            $scope.cancelDeleteAudioCacheEntries();
            $scope.clearAudioCacheSelection();
          });
        })
        .catch(() => {
          $scope.$evalAsync(() => {
            $scope.audioCacheManager.deleting = false;
            $scope.audioCacheActionPending = false;
            $scope.refreshAudioCacheInventory();
            $scope.refreshAudioCacheStatus();
            notyf.error(i18next.t('_AUDIO_CACHE_FAILURE_NOTICE'));
          });
        });
    };

    $scope.requestDeleteCurrentTrackLocalData = () => {
      if (
        $scope.audioCacheActionPending ||
        !isElectron() ||
        !$scope.currentPlaying ||
        !$scope.currentPlaying.id
      ) {
        return;
      }
      $scope.showDialog(16);
    };
    $scope.cancelDeleteCurrentTrackLocalData = () => {
      $scope.closeDialog();
    };
    $scope.confirmDeleteCurrentTrackLocalData = () => {
      const track = $scope.currentPlaying;
      if (!track || !track.id || $scope.audioCacheActionPending) return;
      $scope.audioCacheActionPending = true;
      MediaService.deleteTrackLocalData(track)
        .then((response) => {
          $scope.$evalAsync(() => {
            $scope.audioCacheActionPending = false;
            if (!response || response.ok !== true) {
              notyf.error(i18next.t('_AUDIO_CACHE_FAILURE_NOTICE'));
              return;
            }
            // eslint-disable-next-line no-use-before-define
            saveTrackLyricOffset(track.id, 0);
            $scope.lyricOffsetMs = 0;
            if (response.partial === true) {
              notyf.warning(i18next.t('_AUDIO_CACHE_FAILURE_NOTICE'));
            }
            $scope.closeDialog();
            $scope.refreshAudioCacheStatus();
          });
        })
        .catch(() => {
          $scope.$evalAsync(() => {
            $scope.audioCacheActionPending = false;
            notyf.error(i18next.t('_AUDIO_CACHE_FAILURE_NOTICE'));
          });
        });
    };

    function getLyricOffsets() {
      return localStorage.getObject(LYRIC_OFFSET_STORAGE_KEY) || {};
    }

    function getTrackLyricOffset(trackId) {
      const value = Number(getLyricOffsets()[trackId]);
      return Number.isFinite(value)
        ? Math.max(-MAX_LYRIC_OFFSET_MS, Math.min(MAX_LYRIC_OFFSET_MS, value))
        : 0;
    }

    function saveTrackLyricOffset(trackId, offsetMs) {
      if (!trackId || !trackId.startsWith('bitrack_')) {
        return;
      }
      const offsets = getLyricOffsets();
      if (offsetMs === 0) {
        delete offsets[trackId];
      } else {
        offsets[trackId] = offsetMs;
      }
      const trackIds = Object.keys(offsets);
      while (trackIds.length > 100) {
        delete offsets[trackIds.shift()];
      }
      localStorage.setObject(LYRIC_OFFSET_STORAGE_KEY, offsets);
    }

    $scope.adjustLyricOffset = (deltaMs) => {
      const track = $scope.currentPlaying;
      if (!track || !track.id || !canUseManualLyric(track)) {
        return;
      }
      const step = Number(deltaMs || 0);
      if (!Number.isFinite(step) || step === 0) return;
      if (!androidPlaybackAdapter || track.id.startsWith('bitrack_')) {
        $scope.lyricOffsetMs = Math.max(
          -MAX_LYRIC_OFFSET_MS,
          Math.min(MAX_LYRIC_OFFSET_MS, $scope.lyricOffsetMs + step)
        );
        $scope.lyricLineNumber = -1;
        $scope.lyricLineNumberTrans = -1;
        saveTrackLyricOffset(track.id, $scope.lyricOffsetMs);
        if (androidPlaybackAdapter) syncAndroidLyricClock();
        return;
      }
      if (nativeLyricOffsetPending) return;
      const identity = getNativeLyricIdentity();
      const offsetMs = Math.max(
        -10000,
        Math.min(10000, (Number($scope.lyricOffsetMs) || 0) + step)
      );
      const result = MediaService.setLyricOffset(
        track.id,
        offsetMs,
        getCurrentLyricTrack(track)
      );
      if (!result || !result.promise) return;
      const pending = {
        identity,
        offsetMs,
        revision: identity.playbackRevision,
      };
      nativeLyricOffsetPending = pending;
      result.promise.catch(() => {
        if (nativeLyricOffsetPending === pending)
          nativeLyricOffsetPending = null;
      });
    };

    $scope.resetLyricOffset = () => {
      const current = $scope.lyricOffsetMs;
      if (current !== 0) $scope.adjustLyricOffset(-current);
    };

    $scope.lyricOffsetLabel = () => {
      const offset = Number($scope.lyricOffsetMs) || 0;
      if (offset === 0) {
        return '0.0s';
      }
      const sign = offset > 0 ? '+' : '−';
      return `${sign}${(Math.abs(offset) / 1000).toFixed(1)}s`;
    };

    $scope.currentIndex = 0;
    $scope.staged_playlist = [];
    $scope.getSongIdByIndex = (index) => {
      const songId =
        $scope.playlist[getSafeIndex(index, $scope.playlist.length)].id;
      return `${songId}_${index}`;
    };

    $scope.refreshStage = () => {
      if ($scope.playlist === undefined) {
        return;
      }
      const STAGED_LENGTH = 5;
      let i = $scope.currentIndex - 2;
      $scope.staged_playlist = [];
      while ($scope.staged_playlist.length < STAGED_LENGTH) {
        const song = $scope.playlist[getSafeIndex(i, $scope.playlist.length)];
        if (!song) {
          break;
        }
        $scope.staged_playlist.push({ ...song, stageId: `${song.id}_${i}` });
        i += 1;
      }
    };

    if (!$scope.isChrome) {
      // eslint-disable-next-line no-undef
      $scope.isMac = process.platform === 'darwin';
    }

    function switchMode(mode) {
      // playmode 0:loop 1:shuffle 2:repeat one
      switch (mode) {
        case 0:
          l1Player.setLoopMode('all');
          break;
        case 1:
          l1Player.setLoopMode('shuffle');
          break;
        case 2:
          l1Player.setLoopMode('one');
          break;
        default:
      }
    }

    function getMachineTranslationTargetLanguage() {
      return 'zh-CN';
    }

    function getMachineTranslationErrorMessage(
      status,
      operation = 'translate'
    ) {
      const messages = {
        'missing-api-key': '_MACHINE_TRANSLATION_MISSING_KEY',
        'invalid-api-key': '_MACHINE_TRANSLATION_INVALID_KEY',
        'secure-storage-unavailable':
          '_MACHINE_TRANSLATION_SECURE_STORAGE_UNAVAILABLE',
        'quota-exceeded': '_MACHINE_TRANSLATION_ACCOUNT_LIMIT',
        'rate-limited': '_MACHINE_TRANSLATION_RATE_LIMITED',
        'request-timeout': '_MACHINE_TRANSLATION_TIMEOUT',
        'line-count-mismatch': '_MACHINE_TRANSLATION_ALIGNMENT_FAILED',
        'invalid-line-map': '_MACHINE_TRANSLATION_ALIGNMENT_FAILED',
        'missing-line': '_MACHINE_TRANSLATION_ALIGNMENT_FAILED',
        'empty-content': '_MACHINE_TRANSLATION_EMPTY_CONTENT',
        refused: '_MACHINE_TRANSLATION_REFUSED',
        'invalid-response-json': '_MACHINE_TRANSLATION_RESPONSE_JSON_FAILED',
        'invalid-json': '_MACHINE_TRANSLATION_MODEL_JSON_FAILED',
        'unexpected-test-result': '_MACHINE_TRANSLATION_TEST_RESULT_FAILED',
        'invalid-response': '_MACHINE_TRANSLATION_INVALID_RESPONSE',
        'invalid-alignment': '_MACHINE_TRANSLATION_ALIGNMENT_FAILED',
        'unexpected-finish-reason': '_MACHINE_TRANSLATION_FINISH_FAILED',
        'same-language': '_MACHINE_TRANSLATION_SAME_LANGUAGE',
        'not-cached': '_MACHINE_TRANSLATION_NOT_CACHED',
        'bad-request': '_MACHINE_TRANSLATION_INVALID_REQUEST',
        'invalid-request': '_MACHINE_TRANSLATION_INVALID_REQUEST',
        'invalid-style-hint': '_MACHINE_TRANSLATION_INVALID_STYLE_HINT',
        'unsupported-target-language':
          '_MACHINE_TRANSLATION_UNSUPPORTED_TARGET_LANGUAGE',
        'lyric-too-large': '_MACHINE_TRANSLATION_INVALID_REQUEST',
        'too-many-timed-lines': '_MACHINE_TRANSLATION_INVALID_REQUEST',
        'lyric-line-too-long': '_MACHINE_TRANSLATION_INVALID_REQUEST',
        'response-too-large': '_MACHINE_TRANSLATION_INVALID_RESPONSE',
        'server-error': '_MACHINE_TRANSLATION_SERVICE_UNAVAILABLE',
        'service-unavailable': '_MACHINE_TRANSLATION_SERVICE_UNAVAILABLE',
        'insufficient-balance': '_MACHINE_TRANSLATION_ACCOUNT_LIMIT',
      };
      const knownStatus = Object.prototype.hasOwnProperty.call(
        messages,
        status
      );
      const messageKey =
        status === 'request-timeout' && operation === 'test'
          ? '_MACHINE_TRANSLATION_TEST_TIMEOUT'
          : (knownStatus && messages[status]) ||
            (operation === 'test'
              ? '_MACHINE_TRANSLATION_TEST_FAILED'
              : '_MACHINE_TRANSLATION_FAILED');
      return `${i18next.t(messageKey)} [${
        knownStatus ? status : 'request-failed'
      }]`;
    }

    function applyMachineTranslationConfigResponse(response) {
      if (!response || response.ok !== true || !response.config) {
        return false;
      }
      $scope.machineTranslationConfig = {
        ...$scope.machineTranslationConfig,
        ...response.config,
      };
      if (isAndroidTranslationSurface()) {
        // The settings page is a descendant controller. Broadcast public state
        // only; never include the still-filled API key input in an event.
        $rootScope.$broadcast('android:deepseek-config-changed', {
          hasApiKey: $scope.machineTranslationConfig.hasApiKey === true,
          secureStorageAvailable:
            $scope.machineTranslationConfig.secureStorageAvailable === true,
          nativeClientAvailable:
            $scope.machineTranslationConfig.nativeClientAvailable === true,
        });
      }
      return true;
    }

    $scope.machineTranslationStyleSummary = () =>
      $scope.machineTranslationConfig.effectiveStyleHint ||
      $scope.machineTranslationConfig.defaultStyleHint ||
      i18next.t('_MACHINE_TRANSLATION_STYLE_DEFAULT');

    $scope.lyricMachineTranslationLabel = () => {
      const provider = $scope.lyricMachineTranslationProvider || 'DeepSeek';
      const model = $scope.machineTranslationConfig.model || '';
      return model ? `${provider} · ${model}` : provider;
    };

    $scope.toggleMachineTranslationRules = () => {
      $scope.machineTranslationRulesOpen = !$scope.machineTranslationRulesOpen;
    };

    function loadMachineTranslationConfig() {
      if (!isElectron() && !isAndroidTranslationSurface()) {
        return Promise.resolve(false);
      }
      return MediaService.getMachineTranslationConfig()
        .then((response) => {
          $scope.$evalAsync(() => {
            applyMachineTranslationConfigResponse(response);
          });
          return response && response.ok === true;
        })
        .catch(() => false);
    }

    $scope.refreshMachineTranslationConfig = () =>
      loadMachineTranslationConfig();

    function saveMachineTranslationConfig(
      showNotice,
      {
        includeApiKey = true,
        includeStyleHint = true,
        noticeKey,
        keepPending = false,
      } = {}
    ) {
      if (!isElectron() && !isAndroidTranslationSurface()) {
        return Promise.resolve(false);
      }
      $scope.machineTranslationConfigPending = true;
      const payload = {};
      if (
        includeApiKey &&
        String($scope.machineTranslationConfig.apiKeyInput || '').trim()
      ) {
        payload.apiKey = $scope.machineTranslationConfig.apiKeyInput.trim();
      }
      if (includeStyleHint) {
        payload.styleHint = String(
          $scope.machineTranslationConfig.styleHint || ''
        );
      }
      return MediaService.setMachineTranslationConfig(payload)
        .then((response) => {
          $scope.$evalAsync(() => {
            if (!keepPending) $scope.machineTranslationConfigPending = false;
            if (!applyMachineTranslationConfigResponse(response)) {
              if (showNotice) {
                notyf.error(
                  getMachineTranslationErrorMessage(
                    (response && response.status) || 'request-failed'
                  )
                );
              }
              return;
            }
            if (payload.apiKey) {
              $scope.machineTranslationConfig.apiKeyInput = '';
            }
            if (showNotice) {
              notyf.success(
                i18next.t(noticeKey || '_MACHINE_TRANSLATION_SETTINGS_SAVED')
              );
            }
          });
          return (
            response || {
              ok: false,
              status: 'request-failed',
            }
          );
        })
        .catch(() => {
          $scope.$evalAsync(() => {
            if (!keepPending) $scope.machineTranslationConfigPending = false;
            if (showNotice) {
              notyf.error(i18next.t('_MACHINE_TRANSLATION_FAILED'));
            }
          });
          return {
            ok: false,
            status: 'request-failed',
          };
        });
    }

    $scope.saveMachineTranslationApiKey = () =>
      saveMachineTranslationConfig(true, {
        includeApiKey: true,
        includeStyleHint: false,
      });

    $scope.saveMachineTranslationStyle = () =>
      saveMachineTranslationConfig(true, {
        includeApiKey: false,
        includeStyleHint: true,
        noticeKey: '_MACHINE_TRANSLATION_STYLE_SAVED',
      });

    $scope.restoreDefaultMachineTranslationStyle = () => {
      if ($scope.machineTranslationConfigPending) {
        return;
      }
      $scope.machineTranslationConfig.styleHint = '';
      saveMachineTranslationConfig(true, {
        includeApiKey: false,
        includeStyleHint: true,
        noticeKey: '_MACHINE_TRANSLATION_STYLE_SAVED',
      });
    };

    $scope.openDeepSeekApiPage = () => {
      const url = 'https://platform.deepseek.com/api_keys';
      if (isElectron()) {
        const { shell } = require('electron');
        shell.openExternal(url);
        return;
      }
      if (isAndroidTranslationSurface()) {
        window.location.href = url;
        return;
      }
      window.open(url, '_blank');
    };

    $scope.clearMachineTranslationApiKey = () => {
      if (
        (!isElectron() && !isAndroidTranslationSurface()) ||
        $scope.machineTranslationConfigPending
      ) {
        return;
      }
      $scope.machineTranslationConfigPending = true;
      MediaService.setMachineTranslationConfig({
        clearApiKey: true,
      })
        .then((response) => {
          $scope.$evalAsync(() => {
            $scope.machineTranslationConfigPending = false;
            if (!applyMachineTranslationConfigResponse(response)) {
              notyf.error(i18next.t('_MACHINE_TRANSLATION_FAILED'));
              return;
            }
            $scope.machineTranslationConfig.apiKeyInput = '';
            notyf.success(i18next.t('_MACHINE_TRANSLATION_KEY_CLEARED'));
          });
        })
        .catch(() => {
          $scope.$evalAsync(() => {
            $scope.machineTranslationConfigPending = false;
            notyf.error(i18next.t('_MACHINE_TRANSLATION_FAILED'));
          });
        });
    };

    $scope.testMachineTranslationConfig = () => {
      if ($scope.machineTranslationConfigPending) {
        return;
      }
      $scope.machineTranslationTestState = { state: 'loading', message: '' };
      const reportTestFailure = (status) => {
        const invalidResponse = [
          'invalid-json',
          'invalid-response',
          'invalid-alignment',
          'unexpected-finish-reason',
        ].includes(status);
        const message = invalidResponse
          ? i18next.t('_MACHINE_TRANSLATION_TEST_INVALID_RESPONSE')
          : getMachineTranslationErrorMessage(status || 'request-failed', 'test');
        $scope.machineTranslationTestState = { state: 'error', message };
        notyf.error(message);
      };
      saveMachineTranslationConfig(false, { keepPending: true }).then((saveResponse) => {
        if (!saveResponse || saveResponse.ok !== true) {
          $scope.$evalAsync(() => { $scope.machineTranslationConfigPending = false; reportTestFailure(saveResponse && saveResponse.status); });
          return;
        }
        $scope.machineTranslationConfigPending = true;
        MediaService.testMachineTranslationConfig()
          .then((response) => {
            $scope.$evalAsync(() => {
              $scope.machineTranslationConfigPending = false;
              if (!response || response.ok !== true) {
                reportTestFailure(response && response.status);
                return;
              }
              const message = i18next.t('_MACHINE_TRANSLATION_TEST_SUCCESS');
              $scope.machineTranslationTestState = { state: 'success', message };
              notyf.success(message);
            });
          })
          .catch(() => {
            $scope.$evalAsync(() => {
              $scope.machineTranslationConfigPending = false;
              reportTestFailure('request-failed');
            });
          });
      });

    };

    $scope.loadLocalSettings = () => {
      const defaultSettings = {
        playmode: 0,
        nowplaying_track_id: -1,
        volume: 90,
      };
      const localSettings = localStorage.getObject('player-settings');
      if (localSettings === null) {
        $scope.settings = defaultSettings;
        $scope.saveLocalSettings();
      } else {
        $scope.settings = localSettings;
      }
      // apply settings
      // Native playback restores its own Room-backed mode and volume. Sending
      // renderer defaults before the Media3 session attaches creates stale,
      // rejected startup commands and must not override native truth.
      if (!androidPlaybackAdapter) switchMode($scope.settings.playmode);

      $scope.volume = $scope.settings.volume;
      if ($scope.volume === null) {
        $scope.volume = 90;
        $scope.saveLocalSettings();
      } else if (!androidPlaybackAdapter) {
        l1Player.setVolume($scope.volume);
      }
      $scope.enableGlobalShortCut = localStorage.getObject(
        'enable_global_shortcut'
      );
      $scope.enableLyricFloatingWindow = localStorage.getObject(
        'enable_lyric_floating_window'
      );
      $scope.enableLyricTranslation = localStorage.getObject(
        'enable_lyric_translation'
      );
      $scope.enableLyricFloatingWindowTranslation = localStorage.getObject(
        'enable_lyric_floating_window_translation'
      );
      $scope.enableAutoChooseSource = getLocalStorageValue(
        'enable_auto_choose_source',
        true
      );
      $scope.autoChooseSourceList = getLocalStorageValue(
        'auto_choose_source_list',
        ['kuwo', 'qq', 'migu']
      );
      $scope.enableStopWhenClose =
        isElectron() ||
        !canUseBackgroundPlayer() ||
        getLocalStorageValue('enable_stop_when_close', true);
      $scope.enableNowplayingCoverBackground = getLocalStorageValue(
        'enable_nowplaying_cover_background',
        false
      );
      $scope.enableNowplayingBitrate = getLocalStorageValue(
        'enable_nowplaying_bitrate',
        false
      );
      $scope.enableNowplayingPlatform = getLocalStorageValue(
        'enable_nowplaying_platform',
        false
      );

      const defaultFloatWindowSetting = {
        fontSize: 20,
        color: '#ffffff',
        backgroundAlpha: 0.2,
      };

      $scope.floatWindowSetting = getLocalStorageValue(
        'float_window_setting',
        defaultFloatWindowSetting
      );

      $scope.applyGlobalShortcut();
      $scope.openLyricFloatingWindow();
      loadMachineTranslationConfig();
      $scope.restoreStoredAudioEffect();
    };

    // electron global shortcuts
    $scope.applyGlobalShortcut = (toggle) => {
      if (!isElectron()) {
        return;
      }
      let message = '';
      if (toggle === true) {
        $scope.enableGlobalShortCut = !$scope.enableGlobalShortCut;
      }
      if ($scope.enableGlobalShortCut === true) {
        message = 'enable_global_shortcut';
      } else {
        message = 'disable_global_shortcut';
      }

      // check if globalShortcuts is allowed
      localStorage.setObject(
        'enable_global_shortcut',
        $scope.enableGlobalShortCut
      );

      const { ipcRenderer } = require('electron');
      ipcRenderer.send('control', message);
    };

    $scope.openLyricFloatingWindow = (toggle) => {
      if (!isElectron()) {
        return;
      }
      let message = '';
      if (toggle === true) {
        $scope.enableLyricFloatingWindow = !$scope.enableLyricFloatingWindow;
      }
      if ($scope.enableLyricFloatingWindow === true) {
        message = 'enable_lyric_floating_window';
      } else {
        message = 'disable_lyric_floating_window';
      }
      localStorage.setObject(
        'enable_lyric_floating_window',
        $scope.enableLyricFloatingWindow
      );
      const { ipcRenderer } = require('electron');
      ipcRenderer.send(
        'control',
        message,
        getCSSStringFromSetting($scope.floatWindowSetting)
      );
    };

    if (isElectron()) {
      const { webFrame, ipcRenderer } = require('electron');
      // webFrame.setVisualZoomLevelLimits(1, 3);
      ipcRenderer.on('setZoomLevel', (event, level) => {
        webFrame.setZoomLevel(level);
      });
      ipcRenderer.on('lyricWindow', (event, arg) => {
        if (arg === 'float_window_close') {
          $scope.openLyricFloatingWindow(true);
        } else if (
          arg === 'float_window_font_small' ||
          arg === 'float_window_font_large'
        ) {
          const MIN_FONT_SIZE = 12;
          const MAX_FONT_SIZE = 50;
          const offset = arg === 'float_window_font_small' ? -1 : 1;
          $scope.floatWindowSetting.fontSize += offset;
          if ($scope.floatWindowSetting.fontSize < MIN_FONT_SIZE) {
            $scope.floatWindowSetting.fontSize = MIN_FONT_SIZE;
          } else if ($scope.floatWindowSetting.fontSize > MAX_FONT_SIZE) {
            $scope.floatWindowSetting.fontSize = MAX_FONT_SIZE;
          }
        } else if (
          arg === 'float_window_background_light' ||
          arg === 'float_window_background_dark'
        ) {
          const MIN_BACKGROUND_ALPHA = 0;
          const MAX_BACKGROUND_ALPHA = 1;
          const offset = arg === 'float_window_background_light' ? -0.1 : 0.1;
          $scope.floatWindowSetting.backgroundAlpha += offset;
          if (
            $scope.floatWindowSetting.backgroundAlpha < MIN_BACKGROUND_ALPHA
          ) {
            $scope.floatWindowSetting.backgroundAlpha = MIN_BACKGROUND_ALPHA;
          } else if (
            $scope.floatWindowSetting.backgroundAlpha > MAX_BACKGROUND_ALPHA
          ) {
            $scope.floatWindowSetting.backgroundAlpha = MAX_BACKGROUND_ALPHA;
          }
        } else if (arg === 'float_window_font_change_color') {
          const floatWindowlyricColors = [
            '#ffffff',
            '#65d29f',
            '#3c87eb',
            '#ec63af',
            '#4f5455',
            '#eb605b',
          ];
          const currentIndex = floatWindowlyricColors.indexOf(
            $scope.floatWindowSetting.color
          );
          const nextIndex = (currentIndex + 1) % floatWindowlyricColors.length;
          $scope.floatWindowSetting.color = floatWindowlyricColors[nextIndex];
        }
        localStorage.setObject(
          'float_window_setting',
          $scope.floatWindowSetting
        );
        const { ipcRenderer } = require('electron');
        const message = 'update_lyric_floating_window_css';
        ipcRenderer.send(
          'control',
          message,
          getCSSStringFromSetting($scope.floatWindowSetting)
        );
      });
    }

    $scope.saveLocalSettings = () => {
      localStorage.setObject('player-settings', $scope.settings);
    };

    $scope.changePlaymode = () => {
      const playmodeCount = 3;
      $scope.settings.playmode = ($scope.settings.playmode + 1) % playmodeCount;
      switchMode($scope.settings.playmode);
      $scope.saveLocalSettings();
    };

    $rootScope.openGithubAuth = GithubClient.github.openAuthUrl;
    $rootScope.GithubLogout = () => {
      GithubClient.github.logout();
      $scope.$evalAsync(() => {
        $scope.githubStatus = 0;
        $scope.githubStatusText = GithubClient.github.getStatusText();
      });
    };
    $rootScope.updateGithubStatus = () => {
      GithubClient.github.updateStatus((data) => {
        $scope.$evalAsync(() => {
          $scope.githubStatus = data;
          $scope.githubStatusText = GithubClient.github.getStatusText();
        });
      });
    };

    $scope.togglePlaylist = () => {
      const anchor = `song${l1Player.status.playing.id}`;
      $scope.menuHidden = !$scope.menuHidden;
      if (!$scope.menuHidden) {
        $timeout(() => {
          const list = document.querySelector('.modern-body .menu-list');
          const index = ($scope.playlist || []).findIndex(
            (song) => song.id === l1Player.status.playing.id
          );
          if (list && index >= 0)
            list.dispatchEvent(
              new CustomEvent('listen2-scroll-index', { detail: index })
            );
          else $anchorScroll(anchor);
        });
      }
    };

    $scope.toggleMuteStatus = () => {
      // mute function is indeed toggle mute status.
      l1Player.toggleMute();
    };

    $scope.myProgress = 0;
    $scope.changingProgress = false;

    const unavailablePlaybackKinds = new Set([
      'auth-required',
      'invalid-bvid',
      'invalid-cid',
      'missing-cid',
      'no-audio-stream',
      'no-compatible-audio-stream',
      'not-found',
      'private-video',
    ]);
    let lastPlaybackNotice = { key: '', timestamp: 0 };
    const showPlaybackNotice = (key, type = 'info') => {
      const timestamp = Date.now();
      if (
        lastPlaybackNotice.key === key &&
        timestamp - lastPlaybackNotice.timestamp < 800
      ) {
        return;
      }
      lastPlaybackNotice = { key, timestamp };
      if (type === 'success') {
        notyf.dismissAll();
        notyf.success(i18next.t(key));
        return;
      }
      notyf[type](i18next.t(key), true);
    };
    const getPlaybackFailureMessageKey = (failure = {}) => {
      if (
        failure.kind === 'rate-limited' ||
        failure.kind === 'request-rejected'
      ) {
        return '_PLAYBACK_RATE_LIMITED';
      }
      if (unavailablePlaybackKinds.has(failure.kind)) {
        return '_PLAYBACK_SOURCE_UNAVAILABLE';
      }
      if (failure.retryable === false) {
        return '_PLAYBACK_RECOVERY_FAILED';
      }
      return '_COPYRIGHT_ISSUE';
    };
    $scope.playbackFailureNotice = (failure) => {
      showPlaybackNotice(getPlaybackFailureMessageKey(failure), 'warning');
    };
    $scope.playbackRetryNotice = (failure = {}) => {
      const key =
        failure.kind === 'rate-limited' || failure.kind === 'request-rejected'
          ? '_PLAYBACK_RATE_LIMITED'
          : '_PLAYBACK_RETRYING';
      showPlaybackNotice(key);
    };
    $scope.playbackRecoveryNotice = (recovery = {}) => {
      switch (recovery.state) {
        case 'buffering':
          showPlaybackNotice('_PLAYBACK_BUFFERING');
          break;
        case 'retrying':
          showPlaybackNotice('_PLAYBACK_RETRYING');
          break;
        case 'recovered':
          showPlaybackNotice('_PLAYBACK_RECOVERED', 'success');
          break;
        case 'failed':
          showPlaybackNotice('_PLAYBACK_RECOVERY_FAILED', 'warning');
          break;
        default:
          break;
      }
    };
    $scope.copyrightNotice = () => {
      $scope.playbackFailureNotice({});
    };
    $scope.failAllNotice = () => {
      notyf.warning(i18next.t('_FAIL_ALL_NOTICE'), true);
    };

    $rootScope.$on('dragbar:myprogress', (event, data) => {
      $scope.$evalAsync(() => {
        // should use apply to force refresh ui
        $scope.myProgress = data;

        const posSec = Math.floor(
          ($scope.currentDurationSeconds * $scope.myProgress) / 100
        );
        const posStr = formatSecond(posSec);

        $scope.currentPosition = posStr;
      });
    });

    $rootScope.$on('dragbar:changing_progress', (event, data) => {
      $scope.$evalAsync(() => {
        // should use apply to force refresh ui
        $scope.changingProgress = data;
      });
    });

    function parseLyric(lyric, tlyric) {
      const lines = lyric.split('\n');
      let result = [];
      const timeResult = [];

      if (typeof tlyric !== 'string') {
        tlyric = '';
      }
      const linesTrans = tlyric.split('\n');
      const resultTrans = [];
      const timeResultTrans = [];
      if (tlyric === '') {
        linesTrans.splice(0);
      }

      function rightPadding(str, length, padChar) {
        const newstr = str + new Array(length - str.length + 1).join(padChar);
        return newstr;
      }

      const process =
        (result, timeResult, translationFlag) => (line, index) => {
          const tagReg = /\[\D*:([^\]]+)\]/g;
          const tagRegResult = tagReg.exec(line);
          if (tagRegResult) {
            const lyricObject = {};
            lyricObject.seconds = 0;
            [lyricObject.content] = tagRegResult;
            result.push(lyricObject);
            return;
          }

          const timeReg = /\[(\d{2,})\:(\d{2})(?:\.(\d{1,3}))?\]/g; // eslint-disable-line no-useless-escape

          let timeRegResult = null;
          // eslint-disable-next-line no-cond-assign
          while ((timeRegResult = timeReg.exec(line)) !== null) {
            const htmlUnescapes = {
              '&amp;': '&',
              '&lt;': '<',
              '&gt;': '>',
              '&quot;': '"',
              '&#39;': "'",
              '&apos;': "'",
            };
            timeResult.push({
              content: line
                .replace(/\[(\d{2,}):(\d{2})(?:\.(\d{1,3}))?\]/g, '')
                .replace(
                  /&(?:amp|lt|gt|quot|#39|apos);/g,
                  (match) => htmlUnescapes[match]
                )
                .replace(/<\d{1,3}:\d{2}(?:\.\d{1,3})?>/g, ''),
              seconds:
                parseInt(timeRegResult[1], 10) * 60 * 1000 + // min
                parseInt(timeRegResult[2], 10) * 1000 + // sec
                (timeRegResult[3]
                  ? parseInt(rightPadding(timeRegResult[3], 3, '0'), 10)
                  : 0), // microsec
              translationFlag,
              index,
            });
          }
        };

      lines.forEach(process(result, timeResult, false));
      linesTrans.forEach(process(resultTrans, timeResultTrans, true));

      // sort time line
      result = timeResult.concat(timeResultTrans).sort((a, b) => {
        const keyA = a.seconds;
        const keyB = b.seconds;

        // Compare the 2 dates
        if (keyA < keyB) return -1;
        if (keyA > keyB) return 1;
        if (a.translationFlag !== b.translationFlag) {
          if (a.translationFlag === false) {
            return -1;
          }
          return 1;
        }
        if (a.index < b.index) return -1;
        if (a.index > b.index) return 1;
        return 0;
      });
      // disable tag info, because music provider always write
      // tag info in lyric timeline.
      // result.push.apply(result, timeResult);
      // result = timeResult; // executed up there

      for (let i = 0; i < result.length; i += 1) {
        result[i].lineNumber = i;
      }

      return result;
    }

    function isBilibiliTrack(track) {
      return (
        track &&
        (track.source === 'bilibili' ||
          String(track.id || '').startsWith('bitrack_'))
      );
    }

    function isBilibiliVideoTrack(track) {
      return Boolean(track && String(track.id || '').startsWith('bitrack_v_'));
    }

    function getBilibiliMvPlayer() {
      if (!isElectron() || typeof BilibiliMvPlayer === 'undefined') {
        return null;
      }
      if (!bilibiliMvPlayer) {
        bilibiliMvPlayer = new BilibiliMvPlayer((state) => {
          $scope.$evalAsync(() => {
            $scope.bilibiliMv = {
              ...$scope.bilibiliMv,
              ...state,
            };
          });
        });
      }
      return bilibiliMvPlayer;
    }

    $scope.canPlayBilibiliMv = () =>
      isElectron() && isBilibiliVideoTrack($scope.currentPlaying);

    $scope.getBilibiliMvErrorText = () => {
      const code = String($scope.bilibiliMv.error || '');
      const messages = {
        'unsupported-video-codec': '当前电脑不支持此视频编码，已继续音频播放。',
        'video-load-timeout': 'MV 加载超时，已继续音频播放。',
        'video-load-failed': 'MV 加载失败，已继续音频播放。',
        'video-playback-failed': 'MV 播放失败，已继续音频播放。',
        'manifest-refresh-failed': 'MV 地址刷新失败，已继续音频播放。',
      };
      return messages[code] || 'MV 暂时不可用，已继续音频播放。';
    };

    $scope.toggleBilibiliMv = () => {
      const player = getBilibiliMvPlayer();
      if (!player || !$scope.canPlayBilibiliMv()) {
        return;
      }
      if ($scope.bilibiliMv.active || $scope.bilibiliMv.loading) {
        $scope.closeBilibiliMv();
        return;
      }
      const track = $scope.currentPlaying;
      const position = Number(
        (l1Player.status.playing && l1Player.status.playing.pos) ||
          lastMvPosition ||
          0
      );
      player.open(track, position, Boolean($scope.isPlaying)).then((opened) => {
        if (!opened && $scope.bilibiliMv.error) {
          notyf.info($scope.getBilibiliMvErrorText());
        }
      });
    };

    $scope.closeBilibiliMv = () => {
      const player = getBilibiliMvPlayer();
      if (player) {
        player.close();
      }
    };

    $scope.changeBilibiliMvQuality = () => {
      const player = getBilibiliMvPlayer();
      const key = $scope.bilibiliMv.selectedVariantKey;
      if (!player || !key) {
        return;
      }
      player.switchQuality(key).then((switched) => {
        if (!switched) {
          notyf.info($scope.getBilibiliMvErrorText());
        }
      });
    };

    $scope.toggleBilibiliMvFullscreen = () => {
      const player = getBilibiliMvPlayer();
      if (player) {
        player.toggleFullscreen();
      }
    };

    function getCurrentLyricLine(lineNumber) {
      if (!Array.isArray($scope.lyricArray) || lineNumber < 0) {
        return null;
      }
      return (
        $scope.lyricArray.find((line) => line.lineNumber === lineNumber) || null
      );
    }

    function refreshFloatingLyric() {
      if (!isElectron()) {
        return;
      }
      const currentLine = getCurrentLyricLine($scope.lyricLineNumber);
      const currentTranslation = getCurrentLyricLine(
        $scope.lyricLineNumberTrans
      );
      const { ipcRenderer } = require('electron');
      ipcRenderer.send('currentLyric', {
        lyric: currentLine ? currentLine.content : '',
        tlyric:
          $scope.enableLyricFloatingWindowTranslation === true &&
          currentTranslation
            ? currentTranslation.content
            : '',
      });
    }

    function resetLyricDisplay() {
      $scope.lyricArray = [];
      $scope.lyricLineNumber = -1;
      $scope.lyricLineNumberTrans = -1;
      $scope.hasLyricTranslation = false;
      $scope.lyricSource = '';
      $scope.lyricMatchedTrack = '';
      $scope.lyricTranslationSource = '';
      $scope.lyricMachineTranslationProvider = '';
      $scope.currentLyricResult = null;
      $scope.lyricPersistenceState = 'idle';
      refreshFloatingLyric();
      const lyricElement =
        document.querySelector('.playsong-detail .detail-songinfo .lyric') ||
        document.querySelector('.lyric');
      if (lyricElement) {
        smoothScrollTo(lyricElement, 0, 300);
      }
    }

    function applyLyricResult(track, result) {
      if (!$scope.currentPlaying || $scope.currentPlaying.id !== track.id) {
        return false;
      }
      const safeResult = result || {};
      const lyricArray = safeResult.lyric
        ? parseLyric(safeResult.lyric, safeResult.tlyric)
        : [];
      const originalLines = lyricArray.filter(
        (line) => line.translationFlag !== true
      );
      const timedOriginalLines = originalLines.filter(
        (line) => Number(line.seconds) > 0 || Number(line.seconds) === 0
      );
      const terminalStatus = String(safeResult.status || safeResult.code || '');
      const classified = classifyNativeLyricState({
        lineCount: originalLines.length || (safeResult.lyric ? 1 : 0),
        timedLineCount: timedOriginalLines.length,
        durationMs: androidPlaybackAdapter
          ? Number((getNativeLyricIdentity() || {}).durationMs)
          : Math.round(Number(track.duration || 0) * 1000),
        matchedDurationMs: Math.round(
          Number(safeResult.matchedDuration || safeResult.duration || 0) * 1000
        ),
        identityAccepted:
          !androidPlaybackAdapter ||
          (nativeLyricRequestIdentity &&
            isCurrentNativeLyricIdentity(nativeLyricRequestIdentity)),
        terminalStatus: normalizeLyricTerminalStatus(terminalStatus),
      });
      if (
        !['synchronized', 'text-only', 'insufficient-timestamp'].includes(
          classified
        )
      ) {
        if (classified !== 'stale') setPrimaryLyricState(track, classified);
        return false;
      }
      resetLyricDisplay();
      $scope.currentLyricResult = { ...safeResult };
      $scope.lyricPersistenceState = Number(safeResult.lyricCacheRevision) > 0
        ? 'saved' : 'idle';
      $scope.lyricSource = safeResult.source || track.source || '';
      $scope.lyricMatchedTrack = [
        safeResult.matchedTitle,
        safeResult.matchedArtist,
      ]
        .filter(Boolean)
        .join(' · ');
      $scope.lyricArray = lyricArray;
      $scope.hasLyricTranslation = $scope.lyricArray.some(
        (line) =>
          line.translationFlag === true &&
          String(line.content || '').trim().length > 0
      );
      let lyricTranslationSource = '';
      if (safeResult.machineTranslated) {
        lyricTranslationSource = 'machine';
      } else if ($scope.hasLyricTranslation) {
        lyricTranslationSource = 'catalog';
      }
      $scope.lyricTranslationSource = lyricTranslationSource;
      $scope.lyricMachineTranslationProvider =
        safeResult.machineTranslationProvider ||
        (safeResult.machineTranslated
          ? safeResult.translationProvider || 'DeepSeek'
          : '');
      setPrimaryLyricState(track, classified);
      if (androidPlaybackAdapter) $timeout(syncAndroidLyricClock, 0);
      return true;
    }

    function lyricResultToCandidate(track, result) {
      const safeResult = result || {};
      return {
        id: safeResult.candidateId || track.id,
        provider:
          safeResult.matchedProvider || safeResult.translationProvider || '',
        title: safeResult.matchedTitle || track.title || '',
        artist: safeResult.matchedArtist || track.artist || '',
        album: safeResult.matchedAlbum || track.album || '',
        duration: safeResult.matchedDuration || track.duration || 0,
        lyric: safeResult.lyric || '',
        tlyric: safeResult.tlyric || '',
        sourceTlyric: safeResult.sourceTlyric || '',
        sourceTranslationProvider: safeResult.sourceTranslationProvider || '',
        sourceTranslationEnriched:
          safeResult.sourceTranslationEnriched === true,
        sourceMachineTranslated: safeResult.sourceMachineTranslated === true,
        sourceMachineTranslationProvider:
          safeResult.sourceMachineTranslationProvider || '',
        sourceMachineTranslationTarget:
          safeResult.sourceMachineTranslationTarget || '',
        sourceMachineTranslationDetectedSource:
          safeResult.sourceMachineTranslationDetectedSource || '',
        matchScore: safeResult.matchScore || 1,
        selectedProvider: safeResult.selectedProvider || '',
        selectedCandidateId: safeResult.selectedCandidateId || '',
        translationProvider: safeResult.translationProvider || '',
        translationEnriched: safeResult.translationEnriched === true,
        machineTranslated: safeResult.machineTranslated === true,
        machineTranslationProvider: safeResult.machineTranslationProvider || '',
        machineTranslationTarget: safeResult.machineTranslationTarget || '',
        machineTranslationDetectedSource:
          safeResult.machineTranslationDetectedSource || '',
        machineTranslationPromptFingerprint:
          safeResult.machineTranslationPromptFingerprint || '',
        lyricCacheRevision: Number(safeResult.lyricCacheRevision || 0),
      };
    }

    function candidateToLyricResult(candidate, originalResult, source) {
      const safeCandidate = candidate || {};
      return {
        ...(originalResult || {}),
        lyric: safeCandidate.lyric || '',
        tlyric: safeCandidate.tlyric || '',
        sourceTlyric: safeCandidate.sourceTlyric || '',
        sourceTranslationProvider:
          safeCandidate.sourceTranslationProvider || '',
        sourceTranslationEnriched:
          safeCandidate.sourceTranslationEnriched === true,
        sourceMachineTranslated: safeCandidate.sourceMachineTranslated === true,
        sourceMachineTranslationProvider:
          safeCandidate.sourceMachineTranslationProvider || '',
        sourceMachineTranslationTarget:
          safeCandidate.sourceMachineTranslationTarget || '',
        sourceMachineTranslationDetectedSource:
          safeCandidate.sourceMachineTranslationDetectedSource || '',
        source:
          source || (originalResult && originalResult.source) || 'bilibili',
        matchedTitle: safeCandidate.title || '',
        matchedArtist: safeCandidate.artist || '',
        matchedAlbum: safeCandidate.album || '',
        matchedDuration: safeCandidate.duration || 0,
        matchedProvider: safeCandidate.provider || '',
        candidateId: safeCandidate.id || '',
        selectedProvider: safeCandidate.selectedProvider || '',
        selectedCandidateId: safeCandidate.selectedCandidateId || '',
        translationProvider: safeCandidate.translationProvider || '',
        translationEnriched: safeCandidate.translationEnriched === true,
        machineTranslated: safeCandidate.machineTranslated === true,
        machineTranslationProvider:
          safeCandidate.machineTranslationProvider || '',
        machineTranslationTarget: safeCandidate.machineTranslationTarget || '',
        machineTranslationDetectedSource:
          safeCandidate.machineTranslationDetectedSource || '',
        machineTranslationPromptFingerprint:
          safeCandidate.machineTranslationPromptFingerprint || '',
        machineTranslationStatus: safeCandidate.machineTranslationStatus || '',
        lyricCacheRevision: Number(safeCandidate.lyricCacheRevision || 0),
      };
    }

    function resolveCandidateTranslation(track, candidate) {
      return MediaService.enrichManualLyricCandidate(track, candidate)
        .catch(() => candidate)
        .then((sourceCandidate) => {
          const resolvedCandidate = decorateLyricCandidate(
            sourceCandidate || candidate
          );
          if (resolvedCandidate.hasTranslation) {
            return resolvedCandidate;
          }
          // Android sends a complete lyric only after the explicit consent
          // dialog; automatic lookup must never create a billable request.
          if (isAndroidTranslationSurface()) {
            return resolvedCandidate;
          }
          return MediaService.machineTranslateLyricCandidate(
            track,
            resolvedCandidate,
            getMachineTranslationTargetLanguage(),
            { allowNetwork: false }
          ).then(decorateLyricCandidate);
        });
    }

    function notifyTranslationResult(candidate) {
      if (candidate.machineTranslated) {
        notyf.success(
          i18next.t('_MACHINE_TRANSLATION_READY', {
            source:
              candidate.machineTranslationProvider ||
              candidate.translationProvider ||
              'DeepSeek',
          })
        );
        return;
      }
      if (candidate.translationEnriched) {
        notyf.success(
          i18next.t('_LYRIC_TRANSLATION_ENRICHED', {
            source: candidate.translationProvider || candidate.provider,
          })
        );
      }
    }

    function isManualLyricSource(source) {
      return source === 'manual-selection' || source === 'lrclib-manual';
    }

    function getLyricStorageFailureMessage(result) {
      const status = (result && result.status) || '';
      const messages = {
        'storage-corrupted': '_LYRIC_SAVE_STORAGE_CORRUPTED',
        'storage-unavailable': '_LYRIC_SAVE_STORAGE_UNAVAILABLE',
        'storage-write-failed': '_LYRIC_SAVE_STORAGE_WRITE_FAILED',
        'ambiguous-track': '_LYRIC_SAVE_AMBIGUOUS_TRACK',
        'invalid-selection': '_LYRIC_SAVE_INVALID_SELECTION',
        unsupported: '_LYRIC_SAVE_UNSUPPORTED',
      };
      return i18next.t(messages[status] || '_LYRIC_SAVE_FAILED');
    }

    function saveManualLyricOrNotify(track, candidate) {
      const result = MediaService.saveManualLyric(
        track.id,
        candidate,
        getCurrentLyricTrack(track)
      );
      if (result && result.promise) return result.promise;
      if (!result || result.ok !== true) {
        notyf.warning(getLyricStorageFailureMessage(result));
        return false;
      }
      return true;
    }

    function persistManualLyric(
      track,
      candidate,
      expectedRevision = 0,
      selectionToken = manualLyricSelectionToken
    ) {
      const result = candidateToLyricResult(
        candidate,
        null,
        'manual-selection'
      );
      if (!isElectron()) {
        const saved = saveManualLyricOrNotify(track, candidate);
        const savedPromise = saved && typeof saved.then === 'function'
          ? saved.then((response) => ({ ...response, record: null }))
          : Promise.resolve(saved ? { ok: true, record: null } : { ok: false });
        return savedPromise.then((response) => {
          if (!response.ok || !isAndroidTranslationSurface()) return response;
          return persistAndroidLyric(track, result, 'manual');
        });
      }
      return MediaService.putPersistentLyric(
        track,
        result,
        'manual',
        expectedRevision
      ).then((response) => {
        if (
          response &&
          response.ok !== true &&
          response.status === 'stale-revision' &&
          selectionToken === manualLyricSelectionToken &&
          Number.isFinite(Number(response.currentRevision))
        ) {
          return MediaService.putPersistentLyric(
            track,
            result,
            'manual',
            Number(response.currentRevision)
          );
        }
        return response;
      });
    }

    function clearManualLyricOrNotify(track) {
      const result = MediaService.clearManualLyric(
        track.id,
        getCurrentLyricTrack(track)
      );
      if (result && result.promise) return result.promise;
      if (!result || result.ok !== true) {
        notyf.warning(getLyricStorageFailureMessage(result));
        return false;
      }
      return true;
    }

    let lyricTranslationConfirmTrigger = null;

    function resetLyricTranslationConfirmation(restoreFocus = false) {
      if (
        activeLyricTranslationHandle &&
        typeof activeLyricTranslationHandle.cancel === 'function'
      ) {
        activeLyricTranslationHandle.cancel();
      }
      activeLyricTranslationHandle = null;
      lyricTranslationRequestToken += 1;
      $scope.lyricTranslationConfirmOpen = false;
      $scope.lyricTranslationConfirmPending = false;
      $scope.lyricTranslationConfirmError = '';
      $scope.lyricTranslationConfirmMode = 'translate';
      $scope.lyricTranslationConsent = {
        lyrics: false,
        title: false,
        artist: false,
        possibleCost: false,
        cancellation: false,
        failureImpact: false,
      };
      const trigger = lyricTranslationConfirmTrigger;
      lyricTranslationConfirmTrigger = null;
      if (restoreFocus && trigger && document.contains(trigger)) {
        $timeout(() => trigger.focus());
      }
    }

    $scope.closeLyricTranslationConfirmation = () => {
      resetLyricTranslationConfirmation(true);
    };

    $scope.$on('android:close-transient-overlay', () => {
      if ($scope.lyricTranslationConfirmOpen) {
        resetLyricTranslationConfirmation(false);
      }
    });

    $scope.handleLyricTranslationConfirmationKeydown = (event) => {
      const isEscape = event.key === 'Escape' || event.keyCode === 27;
      if (isEscape) {
        event.preventDefault();
        $scope.closeLyricTranslationConfirmation();
        return;
      }
      if (event.key !== 'Tab') {
        return;
      }
      const dialog = event.currentTarget;
      const focusable = Array.from(
        dialog.querySelectorAll(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])'
        )
      ).filter((element) => element.offsetParent !== null);
      if (!focusable.length) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    $scope.lyricTranslationConfirmationTitle = () =>
      i18next.t(
        $scope.lyricTranslationConfirmMode === 'retranslate'
          ? '_MACHINE_TRANSLATION_RETRANSLATE_CONFIRM_TITLE'
          : '_MACHINE_TRANSLATION_CONFIRM_TITLE'
      );

    $scope.lyricTranslationConfirmationDescription = () =>
      i18next.t(
        $scope.lyricTranslationConfirmMode === 'retranslate'
          ? '_MACHINE_TRANSLATION_RETRANSLATE_CONFIRM_DESCRIPTION'
          : '_MACHINE_TRANSLATION_CONFIRM_DESCRIPTION'
      );

    $scope.lyricTranslationConfirmationAction = () =>
      i18next.t(
        $scope.lyricTranslationConfirmMode === 'retranslate'
          ? '_MACHINE_TRANSLATION_RETRANSLATE_CONFIRM_ACTION'
          : '_MACHINE_TRANSLATION_CONFIRM_ACTION'
      );

    $scope.cancelCurrentLyricTranslation = () => {
      if (
        activeLyricTranslationHandle &&
        typeof activeLyricTranslationHandle.cancel === 'function'
      ) {
        activeLyricTranslationHandle.cancel();
      }
      activeLyricTranslationHandle = null;
      if ($scope.lyricTranslationConfirmOpen) {
        resetLyricTranslationConfirmation(true);
      }
    };

    function openLyricTranslationConfirmation(mode = 'translate') {
      const track = $scope.currentPlaying;
      const originalResult = $scope.currentLyricResult;
      if (!isBilibiliTrack(track) || !originalResult || !originalResult.lyric) {
        notyf.info(i18next.t('_LYRIC_TRANSLATION_UNAVAILABLE'));
        return;
      }
      if (!isElectron() && !isAndroidTranslationSurface()) {
        notyf.info(i18next.t('_LYRIC_TRANSLATION_UNAVAILABLE'));
        return;
      }
      if ($scope.lyricTranslationConfirmPending) {
        return;
      }
      lyricTranslationConfirmTrigger = document.activeElement;
      $scope.lyricTranslationConfirmMode =
        mode === 'retranslate' ? 'retranslate' : 'translate';
      $scope.lyricTranslationConsent = {
        lyrics: false,
        title: false,
        artist: false,
        possibleCost: false,
        cancellation: false,
        failureImpact: false,
      };
      $scope.lyricTranslationConfirmOpen = true;
      $scope.lyricTranslationConfirmError = '';
      $timeout(() => {
        const confirmButton = document.querySelector(
          '[data-lyric-translation-confirm] .lyric-translation-confirm-action'
        );
        if (confirmButton) {
          confirmButton.focus();
        }
      });
    }

    $scope.requestAiLyricRetranslation = () => {
      if ($scope.lyricTranslationLookupPending) {
        return;
      }
      openLyricTranslationConfirmation('retranslate');
    };

    $scope.requestAndroidLyricTranslation = () => {
      if (!$scope.machineTranslationConfig.hasApiKey) {
        $scope.openAndroidAppSettings('translation');
        return;
      }
      openLyricTranslationConfirmation(
        $scope.lyricTranslationSource === 'machine' ? 'retranslate' : 'translate'
      );
    };

    $scope.restoreSourceLyricTranslation = () => {
      const track = $scope.currentPlaying;
      let snapshot = $scope.lyricTranslationSourceSnapshot;
      if (!snapshot || !track || snapshot.trackId !== track.id) {
        snapshot = buildSourceTranslationSnapshot(
          track,
          $scope.currentLyricResult
        );
      }
      if (
        !snapshot ||
        !track ||
        snapshot.trackId !== track.id ||
        !snapshot.tlyric ||
        !$scope.currentLyricResult
      ) {
        return;
      }
      applyLyricResult(
        track,
        restoreSourceTranslationResult($scope.currentLyricResult, snapshot)
      );
      $scope.lyricTranslationSourceSnapshot = null;
      $scope.enableLyricTranslation = true;
      localStorage.setObject('enable_lyric_translation', true);
      notyf.success(i18next.t('_MACHINE_TRANSLATION_SOURCE_RESTORED'));
    };

    function getPersistentLyricTrack(track) {
      return {
        ...track,
        pageEpoch:
          (nativeLyricRequestIdentity &&
            nativeLyricRequestIdentity.pageEpoch) ||
          track.pageEpoch,
      };
    }

    $scope.confirmCurrentLyricTranslation = () => {
      const track = $scope.currentPlaying;
      const originalResult = $scope.currentLyricResult;
      if (
        (!isElectron() && !isAndroidTranslationSurface()) ||
        !isBilibiliTrack(track) ||
        !originalResult ||
        !originalResult.lyric ||
        $scope.lyricTranslationConfirmPending
      ) {
        return;
      }
      manualLyricResolveToken += 1;
      lyricTranslationRequestToken += 1;
      const requestToken = lyricTranslationRequestToken;
      const source = $scope.lyricSource || originalResult.source;
      const retranslate = $scope.lyricTranslationConfirmMode === 'retranslate';
      let sourceTranslationSnapshot = buildSourceTranslationSnapshot(
        track,
        originalResult
      );
      if (
        !sourceTranslationSnapshot &&
        $scope.lyricTranslationSourceSnapshot &&
        $scope.lyricTranslationSourceSnapshot.trackId === track.id
      ) {
        sourceTranslationSnapshot = $scope.lyricTranslationSourceSnapshot;
      }
      $scope.lyricTranslationConfirmPending = true;
      $scope.lyricTranslationConfirmError = '';
      const candidate = lyricResultToCandidate(track, originalResult);
      const translationHandle = MediaService.machineTranslateLyricCandidate(
        track,
        candidate,
        getMachineTranslationTargetLanguage(),
        {
          allowNetwork: true,
          forceRefresh: retranslate,
          styleHint: $scope.machineTranslationConfig.styleHint || '',
          ...(isAndroidTranslationSurface()
            ? {
                consent: {
                  lyrics: true,
                  title: true,
                  artist: true,
                  possibleCost: true,
                  cancellation: true,
                  failureImpact: true,
                  acceptedAtEpochMs: Date.now(),
                },
              }
            : {}),
        }
      );
      activeLyricTranslationHandle = translationHandle;
      translationHandle
        .then(decorateLyricCandidate)
        .then((resolvedCandidate) => {
          $scope.$evalAsync(() => {
            if (
              requestToken !== lyricTranslationRequestToken ||
              !$scope.currentPlaying ||
              $scope.currentPlaying.id !== track.id
            ) {
              return;
            }
            $scope.lyricTranslationConfirmPending = false;
            activeLyricTranslationHandle = null;
            if (!resolvedCandidate.hasTranslation) {
              $scope.lyricTranslationConfirmError =
                getMachineTranslationErrorMessage(
                  resolvedCandidate.machineTranslationStatus || 'request-failed'
                );
              notyf.error($scope.lyricTranslationConfirmError);
              return;
            }
            if (
              isManualLyricSource(source) &&
              !saveManualLyricOrNotify(track, resolvedCandidate)
            ) {
              return;
            }
            const translatedResult = candidateToLyricResult(
              resolvedCandidate,
              originalResult,
              source
            );
            applyLyricResult(track, translatedResult);
            if (isAndroidTranslationSurface()) {
              persistAndroidLyric(track, translatedResult, 'auto');
            }
            $scope.lyricTranslationSourceSnapshot = sourceTranslationSnapshot;
            $scope.enableLyricTranslation = true;
            localStorage.setObject('enable_lyric_translation', true);
            if (isAndroidTranslationSurface()) {
              $scope.setAndroidLyricTranslationVisible(true);
            }
            $scope.lyricTranslationConfirmOpen = false;
            $scope.lyricTranslationConfirmError = '';
            $scope.lyricTranslationConsent = {
              lyrics: false,
              title: false,
              artist: false,
              possibleCost: false,
              cancellation: false,
              failureImpact: false,
            };
            notifyTranslationResult(resolvedCandidate);
          });
        })
        .catch(() => {
          $scope.$evalAsync(() => {
            if (requestToken !== lyricTranslationRequestToken) {
              return;
            }
            $scope.lyricTranslationConfirmPending = false;
            activeLyricTranslationHandle = null;
            $scope.lyricTranslationConfirmError = i18next.t(
              '_MACHINE_TRANSLATION_FAILED'
            );
            notyf.error($scope.lyricTranslationConfirmError);
          });
        });
    };

    function isCurrentLyricRequest(track, requestToken) {
      return (
        requestToken === lyricRequestToken &&
        $scope.currentPlaying &&
        $scope.currentPlaying.id === track.id &&
        (!androidPlaybackAdapter ||
          (nativeLyricRequestIdentity &&
            isCurrentNativeLyricIdentity(nativeLyricRequestIdentity)))
      );
    }

    function getProviderLyric(track) {
      return new Promise((resolve) => {
        MediaService.getLyric(
          track.id,
          track.album_id,
          track.lyric_url,
          track.tlyric_url,
          {
            ...track,
            pageEpoch:
              (nativeLyricRequestIdentity &&
                nativeLyricRequestIdentity.pageEpoch) ||
              track.pageEpoch,
            nativeLyricIdentity: nativeLyricRequestIdentity,
            lyricIdentity: nativeLyricRequestIdentity,
          }
        ).success((result) => resolve(result || { lyric: '' }));
      });
    }

    function applyAutomaticLyricTranslation(track, result, requestToken) {
      if (
        !isBilibiliTrack(track) ||
        !result ||
        !result.lyric ||
        hasMeaningfulLyricText(result.tlyric)
      ) {
        return;
      }
      $scope.lyricTranslationLookupPending = true;
      const candidate = lyricResultToCandidate(track, result);
      resolveCandidateTranslation(track, candidate)
        .then((resolvedCandidate) => {
          $scope.$evalAsync(() => {
            if (!isCurrentLyricRequest(track, requestToken)) return;
            $scope.lyricTranslationLookupPending = false;
            if (!resolvedCandidate.hasTranslation) return;
            const translatedResult = candidateToLyricResult(
              resolvedCandidate,
              result
            );
            applyLyricResult(track, translatedResult);
            if (isAndroidTranslationSurface()) {
              persistAndroidLyric(track, translatedResult, 'auto');
            }
          });
        })
        .catch(() => {
          $scope.$evalAsync(() => {
            if (requestToken === lyricRequestToken) {
              $scope.lyricTranslationLookupPending = false;
            }
          });
        });
    }

    function persistAndroidLyric(track, result, mode) {
      $scope.lyricPersistenceState = 'saving';
      return MediaService.putPersistentLyric(
        getPersistentLyricTrack(track), result, mode
      ).catch(() => ({ ok: false })).then((saved) => {
        $scope.$evalAsync(() => {
          if (!$scope.currentPlaying || $scope.currentPlaying.id !== track.id ||
              !$scope.currentLyricResult || $scope.currentLyricResult.lyric !== result.lyric ||
              ($scope.currentLyricResult.tlyric || '') !== (result.tlyric || '')) return;
          $scope.lyricPersistenceState = saved && saved.ok ? 'saved' : 'error';
          if (saved && saved.ok && saved.record) {
            $scope.currentLyricResult.lyricCacheRevision = saved.record.revision;
          }
        });
        return saved;
      });
    }

    $scope.retryAndroidLyricSave = () => {
      if ($scope.currentPlaying && $scope.currentLyricResult) {
        persistAndroidLyric($scope.currentPlaying, $scope.currentLyricResult, 'auto');
      }
    };

    function persistAutomaticLyric(track, result, expectedRevision) {
      if (
        (!isElectron() && !isAndroidTranslationSurface()) ||
        !result ||
        !result.lyric
      ) {
        return Promise.resolve(null);
      }
      if (isAndroidTranslationSurface()) return persistAndroidLyric(track, result, 'auto');
      return MediaService.putPersistentLyric(
        getPersistentLyricTrack(track),
        result,
        'auto',
        expectedRevision
      ).catch(() => null);
    }

    function requestTrackLyric(track, forceRefresh = false) {
      if (!track || !track.id) {
        return;
      }
      manualLyricResolveToken += 1;
      resetLyricTranslationConfirmation();
      $scope.lyricTranslationLookupPending = false;
      lyricRequestToken += 1;
      const requestToken = lyricRequestToken;
      nativeLyricRequestIdentity = androidPlaybackAdapter
        ? getNativeLyricIdentity()
        : null;
      if (androidPlaybackAdapter && !nativeLyricRequestIdentity) {
        setPrimaryLyricState(track, 'unavailable');
        return;
      }
      // Keep current readable lyrics while a current native request settles;
      // only the accepted identity may replace them.
      if (!androidPlaybackAdapter) resetLyricDisplay();
      setPrimaryLyricState(track, 'loading');
      if (!isElectron()) {
        (forceRefresh ? Promise.resolve(null) :
          MediaService.getPersistentLyric(getPersistentLyricTrack(track)))
          .catch(() => ({ ok: false, result: null, record: null }))
          .then((cacheResponse) => {
            if (!isCurrentLyricRequest(track, requestToken)) return null;
            const cached = cacheResponse && cacheResponse.result;
            if (cached) {
              $scope.$evalAsync(() => {
                if (isCurrentLyricRequest(track, requestToken)) {
                  applyLyricResult(track, cached);
                }
              });
              return null;
            }
            return getProviderLyric(track).then((result) => ({
              result,
              expectedRevision: Number(
                (cacheResponse &&
                  cacheResponse.record &&
                  cacheResponse.record.revision) ||
                  0
              ),
            }));
          })
          .then((remote) => {
            if (!remote || !isCurrentLyricRequest(track, requestToken)) return;
            const result = remote.result || { lyric: '' };
            if (!isCurrentLyricRequest(track, requestToken)) return;
            $scope.$evalAsync(() => {
              if (!isCurrentLyricRequest(track, requestToken)) return;
              applyLyricResult(track, result);
              applyAutomaticLyricTranslation(track, result, requestToken);
            });
            persistAutomaticLyric(track, result, remote.expectedRevision).catch(
              () => null
            );
          })
          .catch(() => {
            $scope.$evalAsync(() => {
              if (isCurrentPrimaryLyricState(track, requestToken)) {
                setPrimaryLyricState(track, 'error');
              }
            });
          });
        return;
      }

      legacyBilibiliLyricMigration
        .then(() => MediaService.getPersistentLyric(track))
        .catch(() => ({ ok: false, record: null }))
        .then((cacheResponse) => {
          if (!isCurrentLyricRequest(track, requestToken)) return null;
          const cached = cacheResponse && cacheResponse.result;
          if (cached) {
            $scope.$evalAsync(() => {
              if (isCurrentLyricRequest(track, requestToken)) {
                applyLyricResult(track, cached);
              }
            });
            if (cached.lyricCacheMode === 'manual') return null;
            if (
              cached.lyricCacheExpiresAt &&
              cached.lyricCacheExpiresAt > Date.now()
            ) {
              return null;
            }
          }
          return getProviderLyric(track).then((result) => ({
            result,
            expectedRevision: Number(
              (cacheResponse &&
                cacheResponse.record &&
                cacheResponse.record.revision) ||
                0
            ),
          }));
        })
        .then((remote) => {
          if (!remote || !isCurrentLyricRequest(track, requestToken)) return;
          const result = remote.result || { lyric: '' };
          $scope.$evalAsync(() => {
            if (!isCurrentLyricRequest(track, requestToken)) return;
            applyLyricResult(track, result);
            applyAutomaticLyricTranslation(track, result, requestToken);
          });
          persistAutomaticLyric(track, result, remote.expectedRevision).then(
            (persisted) => {
              if (
                !persisted ||
                persisted.ok !== true ||
                !persisted.record ||
                !isCurrentLyricRequest(track, requestToken)
              ) {
                return;
              }
              $scope.$evalAsync(() => {
                if (isCurrentLyricRequest(track, requestToken)) {
                  $scope.currentLyricResult = {
                    ...$scope.currentLyricResult,
                    lyricCacheRevision: persisted.record.revision,
                    lyricCacheMode: persisted.record.mode,
                    lyricCacheExpiresAt: persisted.record.expiresAt || 0,
                  };
                }
              });
            }
          );
        })
        .catch(() => {
          $scope.$evalAsync(() => {
            if (isCurrentPrimaryLyricState(track, requestToken)) {
              setPrimaryLyricState(track, 'error');
            }
          });
        });
    }

    $scope.openLyricPicker = () => {
      const track = $scope.currentPlaying;
      if (!canUseManualLyric(track)) {
        return;
      }
      $scope.editLyricSearch();
      const isNewTrack = $scope.lyricPickerTrackId !== track.id;
      $scope.lyricPickerOpen = true;
      $scope.lyricPickerModal =
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(max-width: 760px)').matches;
      if (isNewTrack || !$scope.lyricSearch.title) {
        $scope.lyricPickerTrackId = track.id;
        $scope.lyricSearch.title =
          MediaService.getLyricSearchQuery(track) || track.title || '';
        $scope.lyricSearch.artist = '';
        $scope.lyricSearchResults = [];
        $scope.lyricSearchState = 'idle';
      }
      $scope.lyricSearchSources = [];
      $scope.lyricSearchSubmitted = null;
      $scope.lyricSearchState = 'idle';
      $scope.lyricSearchPending = false;
      $scope.lyricSearchPartial = false;
      $timeout(() => {
        const input = document.querySelector(
          androidPlaybackAdapter
            ? '.android-lyric-picker .lyric-picker-search input'
            : '.modern-body .lyric-picker-search input'
        );
        if (input) {
          input.focus();
        }
      });
    };

    $scope.closeLyricPicker = () => {
      if (activeLyricSearch) activeLyricSearch.cancel();
      resetNeteaseLyricVerification();
      const shouldRestoreFocus = $scope.lyricPickerOpen;
      lyricSearchToken += 1;
      $scope.lyricPickerOpen = false;
      $scope.lyricPickerModal = false;
      $scope.lyricSearchState = 'idle';
      $scope.lyricSearchPending = false;
      if (shouldRestoreFocus) {
        $timeout(() => {
          const trigger = document.querySelector(
            '.modern-body .lyric-search-trigger'
          );
          if (trigger) {
            trigger.focus();
          }
        });
      }
    };

    $scope.handleLyricPickerKeydown = (event) => {
      const isEscape = event.key === 'Escape' || event.keyCode === 27;
      if (isEscape) {
        event.preventDefault();
        event.stopPropagation();
        $scope.closeLyricPicker();
        return;
      }
      const isTab = event.key === 'Tab' || event.keyCode === 9;
      if (!isTab) {
        return;
      }
      const panel = document.querySelector('.modern-body .lyric-picker');
      if (!panel) {
        return;
      }
      const focusable = Array.from(
        panel.querySelectorAll(
          'button:not([disabled]), input:not([disabled]), summary, [tabindex]:not([tabindex="-1"])'
        )
      ).filter(
        (element) =>
          element.offsetWidth > 0 ||
          element.offsetHeight > 0 ||
          element.getClientRects().length > 0
      );
      if (focusable.length === 0) {
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    $scope.$on('$destroy', () => {
      lyricSearchToken += 1;
      resetNeteaseLyricVerification();
      if (activeLyricSearch) activeLyricSearch.cancel();
    });

    const searchAndroidLyricCandidates = () => {
      const track = $scope.currentPlaying;
      const query = String($scope.lyricSearch.title || '').trim();
      if (!canUseManualLyric(track) || !query) {
        $scope.lyricSearchResults = [];
        $scope.lyricSearchState = 'empty';
        $scope.lyricSearchPending = false;
        return;
      }
      lyricSearchToken += 1;
      const searchToken = lyricSearchToken;
      const trackId = track.id;
      const identity = getNativeLyricIdentity();
      const lyricTrack = getCurrentLyricTrack(track);
      const candidatesById = new Map();
      let completedRequests = 0;
      let failedRequests = 0;
      $scope.lyricSearchResults = [];
      $scope.lyricSearchState = 'loading';
      $scope.lyricSearchPending = true;

      const requests = [
        () => MediaService.searchLyricCandidates(lyricTrack, query),
        () => MediaService.searchSupplementalLyricCandidates(lyricTrack, query),
      ];
      const settleRequest = (results, failed) => {
        completedRequests += 1;
        if (failed) {
          failedRequests += 1;
        }
        if (Array.isArray(results)) {
          results.forEach((candidate) => {
            if (candidate && candidate.id) {
              candidatesById.set(
                candidate.id,
                decorateLyricCandidate(candidate)
              );
            }
          });
        }
        $scope.$evalAsync(() => {
          if (
            searchToken !== lyricSearchToken ||
            !$scope.currentPlaying ||
            $scope.currentPlaying.id !== trackId ||
            !$scope.lyricPickerOpen ||
            (androidPlaybackAdapter && !isCurrentNativeLyricIdentity(identity))
          ) {
            return;
          }
          $scope.lyricSearchResults = Array.from(candidatesById.values());
          $scope.lyricSearchResults.sort(compareLyricCandidates);
          $scope.lyricSearchPending = completedRequests < requests.length;
          if ($scope.lyricSearchResults.length > 0) {
            $scope.lyricSearchState = 'results';
          } else if ($scope.lyricSearchPending) {
            $scope.lyricSearchState = 'loading';
          } else {
            $scope.lyricSearchState = failedRequests > 0 ? 'error' : 'empty';
          }
        });
      };

      requests.forEach((loadCandidates) => {
        Promise.resolve()
          .then(loadCandidates)
          .then((results) => settleRequest(results, false))
          .catch(() => settleRequest([], true));
      });
    };

    $scope.submitAndroidLyricSearch = (event) => {
      event.preventDefault();
      event.stopPropagation();
      if ($scope.lyricSearchPending) return;
      const input = event.target.querySelector('input');
      if (input) input.blur();
      searchAndroidLyricCandidates();
    };

    $scope.editLyricSearch = () => {
      const sourceDetails = document.querySelector('.lyric-source-details');
      if (sourceDetails) sourceDetails.open = false;
      lyricSearchToken += 1;
      if (activeLyricSearch) activeLyricSearch.cancel();
      activeLyricSearch = null;
      activeLyricSearchKey = '';
      resetNeteaseLyricVerification();
      $scope.lyricSearchResults = [];
      $scope.lyricSearchSources = [];
      $scope.lyricSearchSubmitted = null;
      $scope.lyricSearchPending = false;
      $scope.lyricSearchPartial = false;
      $scope.lyricSearchState = 'edited';

    };

    $scope.searchLyricCandidates = (force = false) => {
      if (androidPlaybackAdapter) return searchAndroidLyricCandidates();
      const track = $scope.currentPlaying;
      const title = String($scope.lyricSearch.title || '').trim();
      const artist = String($scope.lyricSearch.artist || '').trim();
      if (!track || !title) {
        $scope.lyricSearchState = 'required';
        return;
      }
      const key = JSON.stringify([track.id, title, artist]);
      if (
        !force &&
        activeLyricSearch &&
        activeLyricSearchKey === key &&
        $scope.lyricSearchPending
      )
        return;
      if (activeLyricSearch) activeLyricSearch.cancel();
      activeLyricSearchKey = key;
      const sourceDetails = document.querySelector('.lyric-source-details');
      if (sourceDetails) sourceDetails.open = false;
      resetNeteaseLyricVerification();
      lyricSearchToken += 1;
      const searchToken = lyricSearchToken;
      $scope.lyricSearchSubmitted = { title, artist };
      $scope.lyricSearchResults = [];
      $scope.lyricSearchSources = [];
      $scope.lyricSearchState = 'loading';
      $scope.lyricSearchPending = true;
      $scope.lyricSearchPartial = false;
      activeLyricSearch = MediaService.searchLyrics(
        track,
        { title, artist },
        {
          force,
          onUpdate: (result) =>
            $scope.$evalAsync(() => {
              if (
                searchToken !== lyricSearchToken ||
                !$scope.currentPlaying ||
                $scope.currentPlaying.id !== track.id ||
                !$scope.lyricPickerOpen ||
                String($scope.lyricSearch.title || '').trim() !== title ||
                String($scope.lyricSearch.artist || '').trim() !== artist
              )
                return;
              $scope.lyricSearchResults = result.candidates
                .map(decorateLyricCandidate)
                .sort(compareLyricCandidates);
              $scope.lyricSearchSources = result.sources;
              $scope.lyricSearchPending = result.pending;
              const failed = result.sources.filter(
                (source) =>
                  !['loading', 'success', 'empty', 'no-synced-lyrics'].includes(
                    source.status
                  )
              ).length;
              $scope.lyricSearchPartial =
                failed > 0 && failed < result.sources.length;
              if (result.candidates.length) $scope.lyricSearchState = 'results';
              else if (result.pending) $scope.lyricSearchState = 'loading';
              else if (failed) $scope.lyricSearchState = 'error';
              else {
                $scope.lyricSearchState = result.sources.some(
                  (source) => source.status === 'no-synced-lyrics'
                )
                  ? 'no-synced'
                  : 'empty';
              }
            }),
        }
      );
    };
    $scope.lyricSourceStatus = (source) => {
      const status = source.status.toUpperCase().replace(/-/g, '_');
      const stage = ['catalog', 'lyrics'].includes(source.stage)
        ? source.stage.toUpperCase()
        : '';
      if (
        stage &&
        ['LOADING', 'EMPTY', 'UNAVAILABLE', 'INVALID_RESPONSE'].includes(status)
      ) {
        return i18next.t(`_LYRIC_${stage}_${status}`);
      }
      const message = i18next.t(`_LYRIC_SOURCE_${status}`);
      return stage && status !== 'NO_SYNCED_LYRICS'
        ? `${i18next.t(`_LYRIC_STAGE_${stage}`)}: ${message}`
        : message;
    };

    function resetNeteaseLyricVerification() {
      neteaseLyricVerificationToken += 1;
      $scope.neteaseLyricVerificationPending = false;
      $scope.neteaseLyricVerificationError = '';
    }

    $scope.canVerifyNeteaseLyrics = (source) =>
      !$scope.isChrome &&
      source &&
      source.source === '网易云' &&
      source.status === 'verification-required';

    $scope.verifyNeteaseLyrics = (source) => {
      const track = $scope.currentPlaying;
      const title = String($scope.lyricSearch.title || '');
      const artist = String($scope.lyricSearch.artist || '');
      if (
        !$scope.canVerifyNeteaseLyrics(source) ||
        $scope.neteaseLyricVerificationPending ||
        !$scope.lyricPickerOpen ||
        !isBilibiliTrack(track) ||
        !title.trim() ||
        !$scope.lyricSearchSources.includes(source)
      ) {
        return Promise.resolve(null);
      }
      const searchToken = lyricSearchToken;
      neteaseLyricVerificationToken += 1;
      const verificationToken = neteaseLyricVerificationToken;
      $scope.neteaseLyricVerificationPending = true;
      $scope.neteaseLyricVerificationError = '';
      return MediaService.verifyNeteaseLyrics().then((response) => {
        $scope.$evalAsync(() => {
          if (verificationToken !== neteaseLyricVerificationToken) return;
          $scope.neteaseLyricVerificationPending = false;
          if (
            searchToken !== lyricSearchToken ||
            !$scope.lyricPickerOpen ||
            !$scope.currentPlaying ||
            $scope.currentPlaying.id !== track.id ||
            String($scope.lyricSearch.title || '') !== title ||
            String($scope.lyricSearch.artist || '') !== artist
          ) {
            return;
          }
          // Closing the official window only makes a retry possible; the new
          // search must determine whether the platform accepted verification.
          if (response && response.ok && response.status === 'retry-ready') {
            $scope.searchLyricCandidates(true);
            return;
          }
          let message = '_LYRIC_VERIFY_UNAVAILABLE';
          if (response && response.status === 'verification-unavailable') {
            message = '_LYRIC_VERIFY_EXPIRED';
          } else if (response && response.status === 'already-open') {
            message = '_LYRIC_VERIFY_ALREADY_OPEN';
          }
          $scope.neteaseLyricVerificationError = i18next.t(message);
        });
      });
    };

    $scope.chooseLyricCandidate = (candidate) => {
      const track = $scope.currentPlaying;
      if (!canUseManualLyric(track) || !candidate || !candidate.lyric) {
        return;
      }
      const selectedCandidate = decorateLyricCandidate(candidate);
      const selectionToken = manualLyricSelectionToken + 1;
      manualLyricSelectionToken = selectionToken;
      const expectedRevision = Number(
        ($scope.currentLyricResult &&
          $scope.currentLyricResult.lyricCacheRevision) ||
          0
      );
      const identity = getNativeLyricIdentity();
      persistManualLyric(
        track,
        selectedCandidate,
        expectedRevision,
        selectionToken
      )
        .then((persisted) => {
          if (selectionToken !== manualLyricSelectionToken) {
            return Promise.resolve(null);
          }
          if (!persisted || persisted.ok !== true) {
            notyf.warning(getLyricStorageFailureMessage(persisted));
            return Promise.resolve(null);
          }
          if (
            androidPlaybackAdapter &&
            !isCurrentNativeLyricIdentity(identity)
          ) {
            return Promise.resolve(null);
          }
          manualLyricResolveToken += 1;
          const resolveToken = manualLyricResolveToken;
          lyricRequestToken += 1;
          const manualResult = {
            lyric: selectedCandidate.lyric,
            tlyric: selectedCandidate.tlyric || '',
            source: 'manual-selection',
            matchedTitle: selectedCandidate.title,
            matchedArtist: selectedCandidate.artist,
            translationProvider: selectedCandidate.translationProvider || '',
            machineTranslated: selectedCandidate.machineTranslated === true,
            machineTranslationProvider:
              selectedCandidate.machineTranslationProvider || '',
            lyricCacheRevision:
              (persisted.record && persisted.record.revision) || 0,
            lyricCacheMode: 'manual',
          };
          if (androidPlaybackAdapter) {
            // A saved lyric is valid for this selection even while paused;
            // it must not wait for a new Media3 clock revision to become visible.
            nativeLyricRequestIdentity = identity;
            applyLyricResult(track, manualResult);
          } else {
            applyLyricResult(track, manualResult);
          }
          $scope.closeLyricPicker();
          $scope.$evalAsync();
          if (selectedCandidate.hasTranslation) return Promise.resolve(null);
          $scope.lyricTranslationLookupPending = true;
          return resolveCandidateTranslation(track, selectedCandidate).then(
            (result) => ({ result, resolveToken, persisted, selectionToken })
          );
        })
        .then((translation) => {
          if (!translation) return;
          $scope.$evalAsync(() => {
            if (
              translation.resolveToken !== manualLyricResolveToken ||
              translation.selectionToken !== manualLyricSelectionToken ||
              !$scope.currentPlaying ||
              $scope.currentPlaying.id !== track.id
            ) {
              return;
            }
            $scope.lyricTranslationLookupPending = false;
            const enrichedCandidate = decorateLyricCandidate(
              translation.result || selectedCandidate
            );
            if (!enrichedCandidate.hasTranslation) {
              return;
            }
            persistManualLyric(
              track,
              enrichedCandidate,
              Number(
                (translation.persisted.record &&
                  translation.persisted.record.revision) ||
                  0
              ),
              translation.selectionToken
            ).then((saved) => {
              if (!saved || saved.ok !== true) return;
              $scope.$evalAsync(() => {
                if (
                  translation.selectionToken === manualLyricSelectionToken &&
                  $scope.currentPlaying &&
                  $scope.currentPlaying.id === track.id
                ) {
                  applyLyricResult(
                    track,
                    candidateToLyricResult(
                      enrichedCandidate,
                      null,
                      'manual-selection'
                    )
                  );
                  notifyTranslationResult(enrichedCandidate);
                }
              });
            });
          });
        })
        .catch(() => {
          $scope.$evalAsync(() => {
            $scope.lyricTranslationLookupPending = false;
          });
        });
    };

    $scope.restoreAutoLyric = () => {
      const track = $scope.currentPlaying;
      if (!canUseManualLyric(track)) {
        return;
      }
      manualLyricResolveToken += 1;
      manualLyricSelectionToken += 1;
      $scope.lyricTranslationLookupPending = false;
      const nativeIdentity = getNativeLyricIdentity();
      const clearResult = isElectron()
        ? MediaService.clearPersistentLyric(
            track,
            Number(
              ($scope.currentLyricResult &&
                $scope.currentLyricResult.lyricCacheRevision) ||
                0
            )
          )
        : (() => {
            const cleared = clearManualLyricOrNotify(track);
            return cleared && typeof cleared.then === 'function'
              ? cleared
              : Promise.resolve(
                  cleared
                    ? { ok: true }
                    : { ok: false, status: 'request-failed' }
                );
          })();
      clearResult.then((response) => {
        if (!response || response.ok !== true) {
          notyf.warning(getLyricStorageFailureMessage(response));
          return;
        }
        if (isElectron()) {
          // Old Bilibili selections are retained only for migration. Remove an
          // alias as well so the provider cannot reintroduce it as "auto".
          clearManualLyricOrNotify(track);
        }
        $scope.$evalAsync(() => {
          $scope.closeLyricPicker();
          if (!androidPlaybackAdapter || isCurrentNativeLyricIdentity(nativeIdentity)) {
            requestTrackLyric(track, isAndroidTranslationSurface());
          }
        });
      });
    };

    $scope.formatLyricCandidateDuration = (duration) => {
      const seconds = Math.round(Number(duration) || 0);
      return seconds > 0 ? formatSecond(seconds) : '—';
    };

    const mode = getPlayerMode();

    getPlayer(mode).setMode(mode);
    if (mode === 'front') {
      if (!isElectron() && canUseBackgroundPlayer()) {
        // avoid background keep playing when change to front mode
        getPlayerAsync('background', (player) => {
          player.pause();
        });
      }
    }

    addPlayerListener(mode, (msg, sender, sendResponse) => {
      if (
        typeof msg.type === 'string' &&
        msg.type.split(':')[0] === 'BG_PLAYER'
      ) {
        switch (msg.type.split(':').slice(1).join('')) {
          case 'READY': {
            break;
          }
          case 'PLAY_FAILED': {
            $scope.playbackFailureNotice(msg.data);
            break;
          }

          case 'PLAYBACK_RECOVERY': {
            $scope.playbackRecoveryNotice(msg.data);
            break;
          }

          case 'FOREGROUND_PLAYBACK_STATE': {
            const state = msg.data || {};
            $scope.$evalAsync(() => {
              if (
                !$scope.currentPlaying ||
                state.trackId !== $scope.currentPlaying.id
              ) {
                return;
              }
              $scope.foregroundPlaybackState = state.state || 'error';
              $scope.foregroundPlaybackFailure =
                state.failure && typeof state.failure === 'object'
                  ? { kind: state.failure.kind || '' }
                  : null;
            });
            break;
          }

          case 'VOLUME': {
            $scope.$evalAsync(() => {
              $scope.volume = msg.data;
            });
            break;
          }

          case 'FRAME_UPDATE': {
            // 'currentTrack:position'
            // update lyric position
            if (!l1Player.status.playing.id) break;
            const currentSeconds = msg.data.pos;
            lastMvPosition = Number(currentSeconds || 0);
            if (bilibiliMvPlayer) {
              bilibiliMvPlayer.sync(
                $scope.currentPlaying,
                lastMvPosition,
                Boolean($scope.isPlaying)
              );
            }
            let lastObject = null;
            let lastObjectTrans = null;
            $scope.lyricArray.forEach((lyric) => {
              const lyricTime = (lyric.seconds + $scope.lyricOffsetMs) / 1000;
              if (currentSeconds >= lyricTime) {
                if (lyric.translationFlag !== true) {
                  lastObject = lyric;
                } else {
                  lastObjectTrans = lyric;
                }
              }
            });
            const originalLineChanged =
              lastObject && lastObject.lineNumber !== $scope.lyricLineNumber;
            const nextTranslationLineNumber = lastObjectTrans
              ? lastObjectTrans.lineNumber
              : -1;
            const translationLineChanged =
              nextTranslationLineNumber !== $scope.lyricLineNumberTrans;

            if (originalLineChanged) {
              const lineElement = document.querySelector(
                `.playsong-detail .detail-songinfo .lyric p[data-line="${lastObject.lineNumber}"]`
              );
              const lyricElement = document.querySelector(
                '.playsong-detail .detail-songinfo .lyric'
              );

              if (
                lineElement &&
                lyricElement &&
                lyricElement.offsetHeight > 0 &&
                !document.hidden
              ) {
                const windowHeight = lyricElement.offsetHeight;

                const adjustOffset = 30;
                const offset =
                  lineElement.offsetTop - windowHeight / 2 + adjustOffset;
                smoothScrollTo(lyricElement, offset, 500);
              }

              $scope.lyricLineNumber = lastObject.lineNumber;
            }
            if (translationLineChanged) {
              $scope.lyricLineNumberTrans = nextTranslationLineNumber;
            }
            if (originalLineChanged || translationLineChanged) {
              refreshFloatingLyric();
            }

            // 'currentTrack:duration'
            (() => {
              const durationSec = Math.floor(msg.data.duration);
              const durationStr = `${Math.floor(durationSec / 60)}:${`0${
                durationSec % 60
              }`.substr(-2)}`;
              if (
                msg.data.duration === 0 ||
                $scope.currentDuration === durationStr
              ) {
                return;
              }
              $scope.currentDuration = durationStr;
              $scope.currentDurationSeconds = msg.data.duration;
            })();

            // 'track:progress'
            if ($scope.changingProgress === false) {
              $scope.$evalAsync(() => {
                if (msg.data.duration === 0) {
                  $scope.myProgress = 0;
                } else {
                  $scope.myProgress = (msg.data.pos / msg.data.duration) * 100;
                }
                const posSec = Math.floor(msg.data.pos);
                const posStr = formatSecond(posSec);
                $scope.currentPosition = posStr;
              });
            }
            break;
          }

          case 'LOAD': {
            const previousTrackId =
              $scope.currentPlaying && $scope.currentPlaying.id;
            $scope.currentPlaying = msg.data.currentPlaying;
            const isVideoTrack = isBilibiliVideoTrack(msg.data.currentPlaying);
            if (
              bilibiliMvPlayer &&
              previousTrackId !== msg.data.currentPlaying.id &&
              ($scope.bilibiliMv.active || $scope.bilibiliMv.loading)
            ) {
              bilibiliMvPlayer.close();
            }
            $scope.bilibiliMv = {
              ...$scope.bilibiliMv,
              available: isElectron() && isVideoTrack,
              error: isVideoTrack ? $scope.bilibiliMv.error : '',
            };
            const { length, index } = msg.data.playlist;

            if (useModernTheme()) {
              $scope.currentIndex = index;
              $scope.refreshStage(index, length);
            }

            if (useModernTheme()) {
              const rotatemark = document.getElementById('rotatemark');
              const circlmark = document.getElementById('circlmark');
              if (rotatemark !== null && circlmark !== null) {
                circlmark.classList.add('circlmark');
                rotatemark.classList.add('rotatemark');
                circlmark.addEventListener('animationend', () => {
                  circlmark.classList.remove('circlmark');
                });
                rotatemark.addEventListener('animationend', () => {
                  rotatemark.classList.remove('rotatemark');
                });
              }
            }

            if (msg.data.currentPlaying.id === undefined) {
              break;
            }
            $scope.currentPlaying.platformText = i18next.t(
              $scope.currentPlaying.platform
            );
            $scope.myProgress = 0;
            if ($scope.lastTrackId === msg.data.currentPlaying.id) {
              break;
            }
            const current = localStorage.getObject('player-settings') || {};
            current.nowplaying_track_id = msg.data.currentPlaying.id;
            localStorage.setObject('player-settings', current);
            const track = msg.data.currentPlaying;
            $scope.foregroundPlaybackState = isVideoTrack
              ? 'resolving'
              : 'idle';
            $scope.foregroundPlaybackFailure = null;
            $scope.lyricOffsetMs = getTrackLyricOffset(track.id);
            lyricSearchToken += 1;
            resetNeteaseLyricVerification();
            resetLyricTranslationConfirmation();
            $scope.lyricTranslationSourceSnapshot = null;
            $scope.lyricPickerOpen = false;
            $scope.lyricPickerModal = false;
            if (activeLyricSearch) activeLyricSearch.cancel();
            lyricSearchToken += 1;
            $scope.lyricPickerTrackId = '';
            $scope.lyricSearch.title = '';
            $scope.lyricSearch.artist = '';
            $scope.lyricSearchSubmitted = null;
            $scope.lyricSearchSources = [];
            $scope.lyricSearchPartial = false;
            $scope.lyricSearchResults = [];
            $scope.lyricSearchState = 'idle';
            $scope.lyricSearchPending = false;
            $rootScope.page_title = {
              title: track.title,
              artist: track.artist,
              status: 'playing',
            };
            if (lastfm.isAuthorized()) {
              lastfm.sendNowPlaying(track.title, track.artist, () => {});
            }
            requestTrackLyric(track);
            $scope.lastTrackId = msg.data.currentPlaying.id;
            // The audio graph belongs to the currently loaded media element.
            // Reapply the persisted preference after every track handoff so a
            // graph rebuilt by the player never silently loses the effect.
            $scope.restoreStoredAudioEffect();
            if (isElectron()) {
              const { ipcRenderer } = require('electron');
              ipcRenderer.send('currentLyric', track.title);
              ipcRenderer.send('trackPlayingNow', track);
            }
            break;
          }

          case 'MUTE': {
            // 'music:mute'
            $scope.$evalAsync(() => {
              $scope.mute = msg.data;
            });
            break;
          }

          case 'PLAYLIST': {
            // 'player:playlist'
            $scope.$evalAsync(() => {
              $scope.playlist = msg.data;
              $scope.refreshStage();
              localStorage.setObject('current-playing', msg.data);
            });

            break;
          }

          case 'PLAY_NEXT_QUEUE': {
            $scope.$evalAsync(() => {
              $scope.playNextQueue = msg.data || [];
            });
            break;
          }

          case 'PLAY_STATE': {
            // 'music:isPlaying'
            $scope.$evalAsync(() => {
              $scope.isPlaying = !!msg.data.isPlaying;
            });
            if (bilibiliMvPlayer) {
              bilibiliMvPlayer.sync(
                $scope.currentPlaying,
                lastMvPosition,
                Boolean(msg.data.isPlaying)
              );
            }
            let title = 'Listen 1';
            if ($rootScope.page_title !== undefined) {
              title = '';
              if (msg.data.isPlaying) {
                $rootScope.page_title.status = 'playing';
              } else {
                $rootScope.page_title.status = 'paused';
              }
              if ($rootScope.page_title.status !== '') {
                if ($rootScope.page_title.status === 'playing') {
                  title += '▶ ';
                } else if ($rootScope.page_title.status === 'paused') {
                  title += '❚❚ ';
                }
              }
              title += $rootScope.page_title.title;
              if ($rootScope.page_title.artist !== '') {
                title += ` - ${$rootScope.page_title.artist}`;
              }
            }

            $rootScope.document_title = title;
            if (isElectron()) {
              const { ipcRenderer } = require('electron');
              if (msg.data.isPlaying) {
                ipcRenderer.send('isPlaying', true);
              } else {
                ipcRenderer.send('isPlaying', false);
              }
            }

            if (msg.data.reason === 'Ended') {
              if (!lastfm.isAuthorized()) {
                break;
              }
              // send lastfm scrobble
              const track = l1Player.getTrackById(l1Player.status.playing.id);
              lastfm.scrobble(
                l1Player.status.playing.playedFrom,
                track.title,
                track.artist,
                track.album,
                () => {}
              );
            }

            break;
          }
          case 'RETRIEVE_URL_SUCCESS': {
            $scope.currentPlaying = msg.data;
            // update translate whenever set value
            $scope.currentPlaying.platformText = i18next.t(
              $scope.currentPlaying.platform
            );
            break;
          }
          case 'RETRIEVE_URL_FAIL': {
            if (msg.data && msg.data.retryable === true) {
              $scope.playbackRetryNotice(msg.data);
            } else {
              $scope.playbackFailureNotice(msg.data);
            }
            break;
          }
          case 'RETRIEVE_URL_FAIL_ALL': {
            $scope.failAllNotice();
            break;
          }
          default:
            break;
        }
      }
      if (sendResponse !== undefined) {
        sendResponse();
      }
    });

    // connect player should run after all addListener function finished
    const playerConnection = l1Player.connectPlayer();
    if (playerConnection && typeof playerConnection.catch === 'function') {
      playerConnection.catch(() => {
        if (!androidPlaybackAdapter || playControllerDestroyed) return;
        $scope.$evalAsync(() => {
          $scope.androidPlaybackBusy = false;
        });
      });
    }
    if (androidPlaybackAdapter) {
      refreshAndroidPlaybackSnapshot();
      document.addEventListener('keydown', handleAndroidPlayerKeydown);
      $scope.$on('$destroy', () => {
        playControllerDestroyed = true;
        if (androidPlaybackRefreshTimer) {
          $timeout.cancel(androidPlaybackRefreshTimer);
          androidPlaybackRefreshTimer = null;
        }
        document.removeEventListener('keydown', handleAndroidPlayerKeydown);
      });
    }

    // define keybind
    // description: '播放/暂停',
    hotkeys('p', l1Player.togglePlayPause);

    hotkeys('esc', () => {
      if ($scope.bilibiliMv.active || $scope.bilibiliMv.loading) {
        $scope.$evalAsync(() => $scope.closeBilibiliMv());
      }
    });

    // description: '上一首',
    hotkeys('[', l1Player.prev);

    // description: '下一首',
    hotkeys(']', l1Player.next);

    // description: '静音/取消静音',
    hotkeys('m', l1Player.toggleMute);

    // description: '打开/关闭播放列表',
    hotkeys('l', $scope.togglePlaylist);

    // description: '切换播放模式（顺序/随机/单曲循环）',
    hotkeys('s', $scope.changePlaymode);

    // description: '音量增加',
    hotkeys('u', () => {
      $timeout(() => {
        l1Player.adjustVolume(true);
      });
    });

    // description: '音量减少',
    hotkeys('d', () => {
      $timeout(() => {
        l1Player.adjustVolume(false);
      });
    });

    $scope.toggleLyricTranslation = () => {
      if (!$scope.hasLyricTranslation) {
        if ($scope.lyricTranslationLookupPending) {
          return;
        }
        openLyricTranslationConfirmation();
        return;
      }
      $scope.enableLyricTranslation = !$scope.enableLyricTranslation;
      localStorage.setObject(
        'enable_lyric_translation',
        $scope.enableLyricTranslation
      );
    };

    $scope.toggleLyricFloatingWindowTranslation = () => {
      $scope.enableLyricFloatingWindowTranslation =
        !$scope.enableLyricFloatingWindowTranslation;
      localStorage.setObject(
        'enable_lyric_floating_window_translation',
        $scope.enableLyricFloatingWindowTranslation
      );
      refreshFloatingLyric();
    };

    if (isElectron()) {
      require('electron').ipcRenderer.on('globalShortcut', (event, message) => {
        if (message === 'right') {
          l1Player.next();
        } else if (message === 'left') {
          l1Player.prev();
        } else if (message === 'space') {
          l1Player.togglePlayPause();
        }
      });
    }

    $scope.setAutoChooseSource = (toggle) => {
      if (toggle === true) {
        $scope.enableAutoChooseSource = !$scope.enableAutoChooseSource;
      }
      localStorage.setObject(
        'enable_auto_choose_source',
        $scope.enableAutoChooseSource
      );
    };

    $scope.enableSource = (source) => {
      if ($scope.autoChooseSourceList.indexOf(source) > -1) {
        return;
      }
      $scope.autoChooseSourceList = [...$scope.autoChooseSourceList, source];
      localStorage.setObject(
        'auto_choose_source_list',
        $scope.autoChooseSourceList
      );
    };

    $scope.disableSource = (source) => {
      if ($scope.autoChooseSourceList.indexOf(source) === -1) {
        return;
      }
      $scope.autoChooseSourceList = $scope.autoChooseSourceList.filter(
        (i) => i !== source
      );
      localStorage.setObject(
        'auto_choose_source_list',
        $scope.autoChooseSourceList
      );
    };

    $scope.setStopWhenClose = (status) => {
      $scope.enableStopWhenClose = canUseBackgroundPlayer() ? status : true;
      localStorage.setObject(
        'enable_stop_when_close',
        $scope.enableStopWhenClose
      );
    };

    $scope.setNowplayingCoverBackground = (toggle) => {
      if (toggle === true) {
        $scope.enableNowplayingCoverBackground =
          !$scope.enableNowplayingCoverBackground;
      }
      localStorage.setObject(
        'enable_nowplaying_cover_background',
        $scope.enableNowplayingCoverBackground
      );
    };
    $scope.setNowplayingBitrate = (toggle) => {
      if (toggle === true) {
        $scope.enableNowplayingBitrate = !$scope.enableNowplayingBitrate;
      }
      localStorage.setObject(
        'enable_nowplaying_bitrate',
        $scope.enableNowplayingBitrate
      );
    };
    $scope.setNowplayingPlatform = (toggle) => {
      if (toggle === true) {
        $scope.enableNowplayingPlatform = !$scope.enableNowplayingPlatform;
      }
      localStorage.setObject(
        'enable_nowplaying_platform',
        $scope.enableNowplayingPlatform
      );
    };

    const onAudioCacheChanged = () => {
      if (!playControllerDestroyed) $scope.refreshAudioCacheStatus();
    };
    if (isElectron()) {
      window.addEventListener(
        'listen2-audio-cache-changed',
        onAudioCacheChanged
      );
      $scope.refreshAudioCacheStatus();
    }

    $scope.$on('$destroy', () => {
      window.removeEventListener(
        'listen2-audio-cache-changed',
        onAudioCacheChanged
      );
      playControllerDestroyed = true;
      lyricRequestToken += 1;
      cancelAudioCacheStatusPoll();
      if (bilibiliMvPlayer) {
        bilibiliMvPlayer.destroy();
        bilibiliMvPlayer = null;
      }
    });
  },
]);
