/* eslint-disable no-underscore-dangle */
/* global MediaMetadata playerSendMessage MediaService */
/* global Howl Howler */
{
  const prepareAudioAnalysis = (howl) => {
    if (
      howl &&
      window.Listen1AudioAnalysis &&
      typeof window.Listen1AudioAnalysis.prepareHowl === 'function'
    ) {
      window.Listen1AudioAnalysis.prepareHowl(howl);
    }
  };

  /**
   * Player class containing the state of our playlist and where we are in it.
   * Includes all methods for playing, skipping, updating the display, etc.
   * @param {Array} playlist Array of objects with playlist song details ({title, file, howl}).
   */
  class Player {
    constructor() {
      this.playlist = [];
      this._shuffle_queue = [];
      this._shuffle_history = [];
      this._shuffle_history_index = -1;
      this._shuffle_first_cycle = true;
      this._shuffle_last_cycle = [];
      this._shuffle_random = Math.random;
      this.index = -1;
      this._loop_mode = 0;
      this._media_uri_list = {};
      this._media_retry_state = {};
      this._media_url_retry_timers = {};
      this._media_url_request_epoch = 0;
      this._media_url_request_tokens = {};
      this._media_resume_positions = {};
      this._playback_watch = null;
      this._playback_diagnostics = [];
      this._playback_session = 0;
      this._audio_output_rebuild_session_by_track = {};
      this.playedFrom = 0;
      this.mode = 'background';
      this.skipTime = 15;
    }

    setMode(newMode) {
      this.mode = newMode;
    }

    setRefreshRate(rate = 10) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = setInterval(() => {
        if (this.playing) {
          this.sendFrameUpdate();
          this.monitorPlaybackProgress();
        }
      }, 1000 / rate);
    }

    get currentAudio() {
      return this.playlist[this.index];
    }

    get currentHowl() {
      return this.currentAudio && this.currentAudio.howl;
    }

    getPlaybackDiagnostics() {
      return this._playback_diagnostics.map((entry) => ({ ...entry }));
    }

    static getPlaybackDiagnosticAudioOutput() {
      const analysis = window.Listen1AudioAnalysis;
      if (!analysis || typeof analysis.debug !== 'function') {
        return {};
      }
      try {
        const debug = analysis.debug();
        const output = debug && debug.output;
        if (!output || typeof output !== 'object') {
          return {};
        }
        return {
          audioOutputStatus:
            typeof output.status === 'string' ? output.status : undefined,
          audioOutputHint:
            typeof output.hint === 'string' ? output.hint : undefined,
        };
      } catch (error) {
        return {};
      }
    }

    recordPlaybackDiagnostic({ stage, kind, state, attempt, position } = {}) {
      const track = this.currentAudio;
      const node = this._playback_watch && this._playback_watch.node;
      const entry = {
        timestamp: Date.now(),
        trackId: track && track.id ? String(track.id).slice(0, 96) : undefined,
        stage: typeof stage === 'string' ? stage : undefined,
        kind: typeof kind === 'string' ? kind : undefined,
        state: typeof state === 'string' ? state : undefined,
        attempt: Number.isFinite(attempt) ? attempt : undefined,
        position: Number.isFinite(position)
          ? Math.max(0, position)
          : this.getPlaybackPosition(),
        readyState:
          node && Number.isFinite(node.readyState)
            ? node.readyState
            : undefined,
        networkState:
          node && Number.isFinite(node.networkState)
            ? node.networkState
            : undefined,
        ...Player.getPlaybackDiagnosticAudioOutput(),
      };
      Object.keys(entry).forEach((key) => {
        if (entry[key] === undefined) {
          delete entry[key];
        }
      });
      this._playback_diagnostics.push(entry);
      if (this._playback_diagnostics.length > 50) {
        this._playback_diagnostics.shift();
      }
    }

    get playing() {
      return this.currentHowl ? this.currentHowl.playing() : false;
    }

    static get PLAYBACK_STALL_TIMEOUT_MS() {
      return 5000;
    }

    static get MAX_MEDIA_URL_RETRIES() {
      return 2;
    }

    static get MAX_PLAYBACK_RECOVERY_ATTEMPTS() {
      return 3;
    }

    static get OUTPUT_ONLY_RECOVERY_INTERVAL_MS() {
      return 5000;
    }

    getPlaybackPosition(howl = this.currentHowl) {
      if (!howl || typeof howl.seek !== 'function') {
        return 0;
      }
      try {
        const position = howl.seek();
        return Number.isFinite(position) ? position : 0;
      } catch (error) {
        return 0;
      }
    }

    getHtml5MediaElement(howl = this.currentHowl) {
      if (!howl || !Array.isArray(howl._sounds)) {
        return null;
      }
      const sound = howl._sounds.find(
        (item) =>
          item &&
          item._node &&
          typeof item._node.addEventListener === 'function'
      );
      return sound ? sound._node : null;
    }

    clearPlaybackWatch() {
      const watch = this._playback_watch;
      if (watch && watch.node && watch.listeners) {
        Object.entries(watch.listeners).forEach(([event, listener]) => {
          watch.node.removeEventListener(event, listener);
        });
      }
      this._playback_watch = null;
    }

    resetPlaybackWatchProgress(position = this.getPlaybackPosition()) {
      const watch = this._playback_watch;
      if (!watch || watch.howl !== this.currentHowl) {
        return;
      }
      watch.lastPosition = position;
      watch.lastProgressAt = Date.now();
      watch.waitingSince = 0;
    }

    beginPlaybackWatch(howl, track) {
      if (!howl || !track || this.currentHowl !== howl) {
        return;
      }
      this.clearPlaybackWatch();
      const now = Date.now();
      const watch = {
        howl,
        track,
        index: this.index,
        node: this.getHtml5MediaElement(howl),
        listeners: {},
        lastPosition: this.getPlaybackPosition(howl),
        lastProgressAt: now,
        waitingSince: 0,
        recoveryAttempt: 0,
        outputRecoveryLastAt: now,
      };
      const isCurrentWatch = () =>
        this._playback_watch === watch &&
        this.currentHowl === howl &&
        this.currentAudio === track;
      const markWaiting = () => {
        if (isCurrentWatch()) {
          watch.waitingSince = watch.waitingSince || Date.now();
          this.recordPlaybackDiagnostic({
            stage: 'playback',
            kind: 'buffering',
            state: 'buffering',
            attempt: watch.recoveryAttempt,
            position: this.getPlaybackPosition(howl),
          });
          playerSendMessage(this.mode, {
            type: 'BG_PLAYER:PLAYBACK_RECOVERY',
            data: {
              ...Player.createPlaybackFailure(
                'playback',
                'buffering',
                true,
                watch.recoveryAttempt
              ),
              state: 'buffering',
              position: this.getPlaybackPosition(howl),
            },
          });
        }
      };
      const markProgress = () => {
        if (isCurrentWatch()) {
          const position = this.getPlaybackPosition(howl);
          if (Math.abs(position - watch.lastPosition) <= 0.05) {
            return;
          }
          const recovered = watch.recoveryAttempt > 0 || watch.waitingSince > 0;
          this.resetPlaybackWatchProgress(position);
          if (recovered) {
            this.recordPlaybackDiagnostic({
              stage: 'playback',
              kind: 'progress-resumed',
              state: 'recovered',
              attempt: watch.recoveryAttempt,
              position,
            });
            playerSendMessage(this.mode, {
              type: 'BG_PLAYER:PLAYBACK_RECOVERY',
              data: {
                ...Player.createPlaybackFailure(
                  'playback',
                  'progress-resumed',
                  true,
                  watch.recoveryAttempt
                ),
                state: 'recovered',
                position,
              },
            });
            watch.recoveryAttempt = 0;
          }
        }
      };
      watch.listeners = {
        waiting: markWaiting,
        stalled: markWaiting,
        playing: markProgress,
        progress: markProgress,
        timeupdate: markProgress,
        error: () => {
          if (isCurrentWatch()) {
            this.recoverStalledPlayback('media-error');
          }
        },
      };
      if (watch.node) {
        Object.entries(watch.listeners).forEach(([event, listener]) => {
          watch.node.addEventListener(event, listener);
        });
      }
      this._playback_watch = watch;
    }

    monitorPlaybackProgress() {
      const watch = this._playback_watch;
      if (
        !watch ||
        watch.howl !== this.currentHowl ||
        watch.track !== this.currentAudio ||
        !this.playing
      ) {
        return;
      }
      const now = Date.now();
      const position = this.getPlaybackPosition(watch.howl);
      if (
        this.isOutputOnlyRecovery(watch) &&
        now - watch.outputRecoveryLastAt >=
          Player.OUTPUT_ONLY_RECOVERY_INTERVAL_MS
      ) {
        this.recoverOutputOnly(watch, position);
        return;
      }
      if (this.shouldRecreateMediaElement(watch)) {
        watch.recoveryAttempt = Math.max(watch.recoveryAttempt, 1);
        this.markAudioOutputRebuild(watch);
        this.recordPlaybackDiagnostic({
          stage: 'playback',
          kind: 'audio-output',
          state: 'retrying',
          attempt: watch.recoveryAttempt,
          position,
        });
        playerSendMessage(this.mode, {
          type: 'BG_PLAYER:PLAYBACK_RECOVERY',
          data: {
            ...Player.createPlaybackFailure(
              'playback',
              'audio-output',
              true,
              watch.recoveryAttempt
            ),
            state: 'retrying',
            position,
          },
        });
        this.recreateCurrentMediaAt(watch, position, 'audio-output');
        return;
      }
      if (Math.abs(position - watch.lastPosition) > 0.05) {
        const recovered = watch.recoveryAttempt > 0 || watch.waitingSince > 0;
        this.resetPlaybackWatchProgress(position);
        if (recovered) {
          this.recordPlaybackDiagnostic({
            stage: 'playback',
            kind: 'progress-resumed',
            state: 'recovered',
            attempt: watch.recoveryAttempt,
            position,
          });
          playerSendMessage(this.mode, {
            type: 'BG_PLAYER:PLAYBACK_RECOVERY',
            data: {
              ...Player.createPlaybackFailure(
                'playback',
                'progress-resumed',
                true,
                watch.recoveryAttempt
              ),
              state: 'recovered',
              position,
            },
          });
          watch.recoveryAttempt = 0;
        }
        return;
      }
      if (now - watch.lastProgressAt >= Player.PLAYBACK_STALL_TIMEOUT_MS) {
        this.recoverStalledPlayback(
          watch.waitingSince ? 'stalled' : 'no-progress'
        );
      }
    }

    shouldRecreateMediaElement(watch) {
      if (!watch || !watch.track || !watch.track.id) {
        return false;
      }
      const { audioOutputHint } = Player.getPlaybackDiagnosticAudioOutput();
      return (
        audioOutputHint === 'recreate-media-element' &&
        this._audio_output_rebuild_session_by_track[watch.track.id] !==
          this._playback_session
      );
    }

    markAudioOutputRebuild(watch) {
      if (watch && watch.track && watch.track.id) {
        this._audio_output_rebuild_session_by_track[watch.track.id] =
          this._playback_session;
      }
    }

    isOutputOnlyRecovery(watch) {
      if (!watch || !watch.track || !watch.track.id) {
        return false;
      }
      const { audioOutputHint } = Player.getPlaybackDiagnosticAudioOutput();
      return (
        audioOutputHint === 'recreate-media-element' &&
        this._audio_output_rebuild_session_by_track[watch.track.id] ===
          this._playback_session
      );
    }

    static createPlaybackFailure(stage, kind, retryable, attempt, error) {
      const failure = {
        stage,
        kind,
        retryable,
        attempt,
      };
      if (error && typeof error === 'object') {
        const safeKinds = new Set([
          'auth-required',
          'invalid-bvid',
          'invalid-cid',
          'missing-cid',
          'network',
          'no-audio-stream',
          'no-compatible-audio-stream',
          'not-found',
          'private-video',
          'rate-limited',
          'request-rejected',
          'server',
          'timeout',
          'unavailable',
        ]);
        if (safeKinds.has(error.kind)) {
          failure.kind = error.kind;
        }
        if (
          typeof error.status === 'string' &&
          /^[a-z0-9-]{1,64}$/.test(error.status)
        ) {
          failure.status = error.status;
        }
        ['httpStatus', 'bilibiliCode'].forEach((field) => {
          if (Number.isSafeInteger(error[field])) {
            failure[field] = error[field];
          }
        });
      }
      if (error) {
        // Provider error messages can contain signed media URLs. Keep the
        // public event useful without exposing transient credentials.
        failure.message = 'Playback request failed';
      }
      return failure;
    }

    sendPlaybackFailure(stage, kind, retryable, attempt, error) {
      this.recordPlaybackDiagnostic({
        stage,
        kind,
        state: 'failed',
        attempt,
      });
      playerSendMessage(this.mode, {
        type: 'BG_PLAYER:PLAY_FAILED',
        data: Player.createPlaybackFailure(
          stage,
          kind,
          retryable,
          attempt,
          error
        ),
      });
    }

    static hasBufferedAudioAhead(node, position) {
      if (!node || !node.buffered || typeof node.buffered.length !== 'number') {
        return false;
      }
      try {
        for (let index = 0; index < node.buffered.length; index += 1) {
          if (
            node.buffered.start(index) <= position &&
            node.buffered.end(index) - position > 0.1
          ) {
            return true;
          }
        }
      } catch (error) {
        return false;
      }
      return false;
    }

    recoverStalledPlayback(kind) {
      const watch = this._playback_watch;
      if (
        !watch ||
        watch.howl !== this.currentHowl ||
        watch.track !== this.currentAudio
      ) {
        return;
      }
      const position = this.getPlaybackPosition(watch.howl);
      if (this.isOutputOnlyRecovery(watch)) {
        this.recoverOutputOnly(watch, position);
        return;
      }
      if (watch.recoveryAttempt >= Player.MAX_PLAYBACK_RECOVERY_ATTEMPTS) {
        this.recordPlaybackDiagnostic({
          stage: 'playback',
          kind,
          state: 'failed',
          attempt: watch.recoveryAttempt,
          position,
        });
        playerSendMessage(this.mode, {
          type: 'BG_PLAYER:PLAYBACK_RECOVERY',
          data: {
            ...Player.createPlaybackFailure(
              'playback',
              kind,
              false,
              watch.recoveryAttempt,
              'playback recovery exhausted'
            ),
            state: 'failed',
            position,
          },
        });
        this.sendPlaybackFailure(
          'playback',
          kind,
          false,
          watch.recoveryAttempt,
          'playback recovery exhausted'
        );
        if (this.currentHowl && typeof this.currentHowl.pause === 'function') {
          this.currentHowl.pause();
        }
        this.clearPlaybackWatch();
        this.sendPlayingEvent('err');
        return;
      }

      watch.recoveryAttempt += 1;
      this.recordPlaybackDiagnostic({
        stage: 'playback',
        kind,
        state: 'retrying',
        attempt: watch.recoveryAttempt,
        position,
      });
      playerSendMessage(this.mode, {
        type: 'BG_PLAYER:PLAYBACK_RECOVERY',
        data: {
          ...Player.createPlaybackFailure(
            'playback',
            kind,
            true,
            watch.recoveryAttempt
          ),
          state: 'retrying',
          position,
        },
      });

      if (watch.recoveryAttempt === 1) {
        const audioOutput = Player.ensureAudioOutput(watch.howl);
        if (
          audioOutput.requiresMediaElementRecreation &&
          this.shouldRecreateMediaElement(watch)
        ) {
          this.markAudioOutputRebuild(watch);
          this.recreateCurrentMediaAt(watch, position, 'audio-output');
          return;
        }
        this.recoverCurrentMediaNode(watch, position);
        return;
      }

      this.recreateCurrentMediaAt(watch, position, kind);
    }

    recoverOutputOnly(watch, position) {
      const activeWatch = watch;
      const now = Date.now();
      if (
        now - activeWatch.outputRecoveryLastAt <
        Player.OUTPUT_ONLY_RECOVERY_INTERVAL_MS
      ) {
        return;
      }
      activeWatch.outputRecoveryLastAt = now;
      if (
        activeWatch.recoveryAttempt >= Player.MAX_PLAYBACK_RECOVERY_ATTEMPTS
      ) {
        this.recordPlaybackDiagnostic({
          stage: 'playback',
          kind: 'audio-output',
          state: 'failed',
          attempt: activeWatch.recoveryAttempt,
          position,
        });
        playerSendMessage(this.mode, {
          type: 'BG_PLAYER:PLAYBACK_RECOVERY',
          data: {
            ...Player.createPlaybackFailure(
              'playback',
              'audio-output',
              false,
              activeWatch.recoveryAttempt
            ),
            state: 'failed',
            position,
          },
        });
        this.sendPlaybackFailure(
          'playback',
          'audio-output',
          false,
          activeWatch.recoveryAttempt
        );
        if (this.currentHowl && typeof this.currentHowl.pause === 'function') {
          this.currentHowl.pause();
        }
        this.clearPlaybackWatch();
        this.sendPlayingEvent('err');
        return;
      }

      activeWatch.recoveryAttempt += 1;
      this.recordPlaybackDiagnostic({
        stage: 'playback',
        kind: 'audio-output',
        state: 'retrying',
        attempt: activeWatch.recoveryAttempt,
        position,
      });
      playerSendMessage(this.mode, {
        type: 'BG_PLAYER:PLAYBACK_RECOVERY',
        data: {
          ...Player.createPlaybackFailure(
            'playback',
            'audio-output',
            true,
            activeWatch.recoveryAttempt
          ),
          state: 'retrying',
          position,
        },
      });
      this.recoverCurrentMediaNode(activeWatch, position);
    }

    recoverCurrentMediaNode(watch, position) {
      if (Player.hasBufferedAudioAhead(watch.node, position)) {
        const duration =
          this.currentHowl && typeof this.currentHowl.duration === 'function'
            ? this.currentHowl.duration()
            : 0;
        const nudgedPosition = Math.min(
          position + 0.05,
          Math.max(position, duration - 0.01)
        );
        if (typeof this.currentHowl.seek === 'function') {
          this.currentHowl.seek(nudgedPosition);
        }
      }
      if (watch.node && typeof watch.node.play === 'function') {
        const playResult = watch.node.play();
        if (playResult && typeof playResult.catch === 'function') {
          playResult.catch(() => {});
        }
      }
      this.resetPlaybackWatchProgress(this.getPlaybackPosition());
    }

    static ensureAudioOutput(howl) {
      const analysis = window.Listen1AudioAnalysis;
      if (!analysis || typeof analysis.ensureOutput !== 'function') {
        return { requiresMediaElementRecreation: false };
      }
      try {
        analysis.ensureOutput(howl);
      } catch (error) {
        // A capture failure is not proof that native HTML audio is broken.
      }
      const { audioOutputHint } = Player.getPlaybackDiagnosticAudioOutput();
      return {
        requiresMediaElementRecreation:
          audioOutputHint === 'recreate-media-element',
      };
    }

    recreateCurrentMediaAt(watch, position, kind) {
      this._media_resume_positions[watch.track.id] = position;
      this.handleMediaLoadError(
        watch.index,
        watch.track,
        true,
        Player.createPlaybackFailure(
          'playback',
          kind,
          true,
          watch.recoveryAttempt
        )
      );
    }

    // eslint-disable-next-line class-methods-use-this
    get muted() {
      return !!Howler._muted;
    }

    resetShuffleState(anchorIndex = this.index) {
      this._shuffle_queue = [];
      this._shuffle_first_cycle = true;
      this._shuffle_last_cycle = [];
      if (Number.isInteger(anchorIndex) && this.playlist[anchorIndex]) {
        this._shuffle_history = [anchorIndex];
        this._shuffle_history_index = 0;
      } else {
        this._shuffle_history = [];
        this._shuffle_history_index = -1;
      }
    }

    shuffleIndices(indices) {
      const result = indices.slice();
      for (let i = result.length - 1; i > 0; i -= 1) {
        // Fisher-Yates: every remaining position, including i, is selectable.
        const randomIndex = Math.floor(this._shuffle_random() * (i + 1));
        const value = result[i];
        result[i] = result[randomIndex];
        result[randomIndex] = value;
      }
      return result;
    }

    isPlayableIndex(index) {
      return Boolean(this.playlist[index] && !this.playlist[index].disabled);
    }

    buildShuffleQueue(currentIndex) {
      const isFirstCycle = this._shuffle_first_cycle;
      let candidates = this.playlist
        .map((_track, index) => index)
        .filter((index) => this.isPlayableIndex(index));

      // The song that was already playing counts as played in the first cycle.
      if (isFirstCycle) {
        candidates = candidates.filter((index) => index !== currentIndex);
        this._shuffle_first_cycle = false;
      }

      const queue = this.shuffleIndices(candidates);
      if (!isFirstCycle && queue.length > 1 && queue[0] === currentIndex) {
        const swapIndex =
          1 + Math.floor(this._shuffle_random() * (queue.length - 1));
        queue[0] = queue[swapIndex];
        queue[swapIndex] = currentIndex;
      }

      const repeatsLastCycle =
        queue.length > 2 &&
        queue.length === this._shuffle_last_cycle.length &&
        queue.every(
          (index, position) => index === this._shuffle_last_cycle[position]
        );
      if (repeatsLastCycle) {
        const lastIndex = queue.length - 1;
        const value = queue[lastIndex];
        queue[lastIndex] = queue[lastIndex - 1];
        queue[lastIndex - 1] = value;
      }

      this._shuffle_queue = queue;
      if (!isFirstCycle) {
        this._shuffle_last_cycle = queue.slice();
      }
    }

    syncShuffleHistory(currentIndex) {
      if (
        this._shuffle_history_index < 0 ||
        this._shuffle_history[this._shuffle_history_index] !== currentIndex
      ) {
        this.resetShuffleState(currentIndex);
      }
    }

    nextShuffleIndex(currentIndex) {
      this.syncShuffleHistory(currentIndex);

      while (this._shuffle_history_index < this._shuffle_history.length - 1) {
        this._shuffle_history_index += 1;
        const forwardIndex = this._shuffle_history[this._shuffle_history_index];
        if (this.isPlayableIndex(forwardIndex)) {
          return forwardIndex;
        }
      }

      // Usually one build is enough. A second build handles the first cycle
      // when the current song is the only playable item.
      for (let buildCount = 0; buildCount < 2; buildCount += 1) {
        if (this._shuffle_queue.length === 0) {
          this.buildShuffleQueue(currentIndex);
        }
        while (this._shuffle_queue.length > 0) {
          const nextIndex = this._shuffle_queue.shift();
          if (this.isPlayableIndex(nextIndex)) {
            this._shuffle_history.push(nextIndex);
            this._shuffle_history_index = this._shuffle_history.length - 1;
            return nextIndex;
          }
        }
      }

      return this.isPlayableIndex(currentIndex) ? currentIndex : -1;
    }

    previousShuffleIndex(currentIndex) {
      this.syncShuffleHistory(currentIndex);
      while (this._shuffle_history_index > 0) {
        this._shuffle_history_index -= 1;
        const previousIndex =
          this._shuffle_history[this._shuffle_history_index];
        if (this.isPlayableIndex(previousIndex)) {
          return previousIndex;
        }
      }
      return this.isPlayableIndex(currentIndex) ? currentIndex : -1;
    }

    insertAudio(audio, idx) {
      if (this.playlist.find((i) => audio.id === i.id)) return;

      const audioData = {
        ...audio,
        disabled: false, // avoid first time load block
        howl: null,
      };
      if (idx) {
        this.playlist.splice(idx, 0, [audio]);
      } else {
        this.playlist.push(audioData);
      }
      this.resetShuffleState(this.index);
      this.sendPlaylistEvent();
      this.sendLoadEvent();
    }

    static array_move(arr, old_index, new_index) {
      // https://stackoverflow.com/questions/5306680/move-an-array-element-from-one-array-position-to-another
      if (new_index >= arr.length) {
        let k = new_index - arr.length + 1;
        while (k > 0) {
          k -= 1;
          arr.push(undefined);
        }
      }
      arr.splice(new_index, 0, arr.splice(old_index, 1)[0]);
      return arr; // for testing
    }

    insertAudioByDirection(audio, to_audio, direction) {
      const originTrack = this.playlist[this.index];
      const index = this.playlist.findIndex((i) => i.id === audio.id);
      let insertIndex = this.playlist.findIndex((i) => i.id === to_audio.id);
      if (index === insertIndex) {
        return;
      }
      if (insertIndex > index) {
        insertIndex -= 1;
      }
      const offset = direction === 'top' ? 0 : 1;
      this.playlist = Player.array_move(
        this.playlist,
        index,
        insertIndex + offset
      );
      const foundOriginTrackIndex = this.playlist.findIndex(
        (i) => i.id === originTrack.id
      );
      if (foundOriginTrackIndex >= 0) {
        this.index = foundOriginTrackIndex;
      }

      this.resetShuffleState(this.index);
      this.sendPlaylistEvent();
      this.sendLoadEvent();
    }

    removeAudio(idx) {
      if (!this.playlist[idx]) {
        return;
      }
      const removedTrack = this.playlist[idx];
      this.clearMediaUrlRetryTimer(removedTrack.id);
      this.invalidateMediaUrlRequest(removedTrack.id);
      // restore playing status before change
      const isPlaying = this.playing;
      const { id: trackId } = this.currentAudio;

      if (isPlaying && this.playlist[idx].id === trackId) {
        this.pause();
      }

      this.playlist.splice(idx, 1);
      const newIndex = this.playlist.findIndex((i) => i.id === trackId);
      if (newIndex >= 0) {
        this.index = newIndex;
      } else {
        // current playing is deleted
        if (idx >= this.playlist.length) {
          this.index = this.playlist.length - 1;
        } else {
          this.index = idx;
        }
        if (isPlaying) {
          this.play();
        }
      }

      this.resetShuffleState(this.index);
      this.sendPlaylistEvent();
      this.sendLoadEvent();
    }

    appendAudioList(list) {
      if (!Array.isArray(list)) {
        return;
      }
      list.forEach((audio) => {
        this.insertAudio(audio);
      });
    }

    clearPlaylist() {
      this.clearPlaybackWatch();
      this.stopAll(); // stop the loadded track before remove list
      this.playlist = [];
      this.index = -1;
      this._media_retry_state = {};
      this._media_resume_positions = {};
      this._audio_output_rebuild_session_by_track = {};
      this._media_url_request_tokens = {};
      Object.values(this._media_url_retry_timers).forEach((timer) => {
        clearTimeout(timer);
      });
      this._media_url_retry_timers = {};
      this.resetShuffleState();
      Howler.unload();
      this.sendPlaylistEvent();
      this.sendLoadEvent();
    }

    stopAll() {
      this.clearPlaybackWatch();
      this.playlist.forEach((i) => {
        if (i.howl) {
          i.howl.stop();
        }
      });
    }

    setNewPlaylist(list) {
      if (list.length) {
        // stop current
        this.clearPlaybackWatch();
        this.stopAll();
        Howler.unload();

        this._media_retry_state = {};
        this._media_resume_positions = {};
        this._audio_output_rebuild_session_by_track = {};
        this._media_url_request_tokens = {};
        Object.values(this._media_url_retry_timers).forEach((timer) => {
          clearTimeout(timer);
        });
        this._media_url_retry_timers = {};
        this.playlist = list.map((audio) => ({
          ...audio,
          howl: null,
        }));
        this.index =
          this._loop_mode === 2
            ? Math.floor(this._shuffle_random() * this.playlist.length)
            : 0;
        this.resetShuffleState(this.index);
        this.load(this.index);
      }
      this.sendPlaylistEvent();
    }

    playById(id) {
      const idx = this.playlist.findIndex((audio) => audio.id === id);
      if (idx < 0) return;
      if (this._loop_mode === 2 && idx !== this.index) {
        this.resetShuffleState(idx);
      }
      this.play(idx);
    }

    loadById(id) {
      const idx = this.playlist.findIndex((audio) => audio.id === id);
      if (idx < 0) return;
      if (this._loop_mode === 2 && idx !== this.index) {
        this.resetShuffleState(idx);
      }
      this.load(idx);
    }

    /**
     * Play a song in the playlist.
     * @param  {Number} index Index of the song in the playlist
     * (leave empty to play the first or current).
     */
    play(idx) {
      this.load(idx);
      this._playback_session += 1;

      const data = this.playlist[this.index];
      if (!data.howl || !this._media_uri_list[data.id]) {
        this.retrieveMediaUrl(this.index, true);
      } else if (this.shouldRefreshMediaUrl(data)) {
        this.unloadTrackHowl(data);
        delete this._media_uri_list[data.id];
        this.clearMediaRetryState(data.id);
        this.retrieveMediaUrl(this.index, true, { forceRefresh: true });
      } else {
        this.finishLoad(this.index, true);
      }
    }

    static getMediaUrlDeadline(uri) {
      if (typeof uri !== 'string' || !uri) {
        return null;
      }
      try {
        const deadline = Number(new URL(uri).searchParams.get('deadline'));
        return Number.isFinite(deadline) && deadline > 0 ? deadline : null;
      } catch (error) {
        return null;
      }
    }

    shouldRefreshMediaUrl(track) {
      if (
        !track ||
        (track.source !== 'bilibili' &&
          !String(track.id || '').startsWith('bitrack_v_'))
      ) {
        return false;
      }
      const deadline = Player.getMediaUrlDeadline(
        this._media_uri_list[track.id]
      );
      return (
        deadline !== null && deadline <= Math.floor(Date.now() / 1000) + 300
      );
    }

    static getMediaUrlCandidates(bootinfo) {
      const candidateUrls = [
        bootinfo && bootinfo.url,
        ...(Array.isArray(bootinfo && bootinfo.urlCandidates)
          ? bootinfo.urlCandidates
          : []),
      ];
      return [
        ...new Set(
          candidateUrls
            .map((url) => (typeof url === 'string' ? url.trim() : ''))
            .filter(Boolean)
        ),
      ];
    }

    setMediaRetryState(track, candidates, options = {}) {
      if (!track || !track.id) {
        return;
      }
      this._media_retry_state[track.id] = {
        candidates,
        candidateIndex: 0,
        canForceRefresh: options.canForceRefresh === true,
        forceRefreshAttempted: options.forceRefreshAttempted === true,
      };
    }

    clearMediaRetryState(trackId) {
      delete this._media_retry_state[trackId];
    }

    clearMediaUrlRetryTimer(trackId) {
      const timer = this._media_url_retry_timers[trackId];
      if (timer) {
        clearTimeout(timer);
      }
      delete this._media_url_retry_timers[trackId];
    }

    beginMediaUrlRequest(trackId) {
      const token = this._media_url_request_epoch + 1;
      this._media_url_request_epoch = token;
      this._media_url_request_tokens[trackId] = token;
      return token;
    }

    invalidateMediaUrlRequest(trackId) {
      if (trackId) {
        delete this._media_url_request_tokens[trackId];
      }
    }

    isCurrentMediaUrlRequest(index, track, playNow, token) {
      return (
        Boolean(track) &&
        this._media_url_request_tokens[track.id] === token &&
        this.playlist[index] === track &&
        (!playNow || this.index === index)
      );
    }

    retryMediaUrl(index, playNow, retryAttempt, error, requestToken) {
      const track = this.playlist[index];
      if (!this.isCurrentMediaUrlRequest(index, track, playNow, requestToken)) {
        return;
      }
      const retryable =
        (!error || typeof error !== 'object' || error.retryable !== false) &&
        retryAttempt < Player.MAX_MEDIA_URL_RETRIES;
      const errorDetails = Player.createPlaybackFailure(
        'media-url',
        'retrieve-failed',
        retryable,
        retryAttempt + 1,
        error
      );
      this.recordPlaybackDiagnostic({
        stage: errorDetails.stage,
        kind: errorDetails.kind,
        state: retryable ? 'retrying' : 'failed',
        attempt: errorDetails.attempt,
      });
      const failure = Player.createPlaybackFailure(
        'media-url',
        'retrieve-failed',
        retryable,
        retryAttempt + 1,
        error
      );
      playerSendMessage(this.mode, {
        type: 'BG_PLAYER:RETRIEVE_URL_FAIL',
        data: failure,
      });
      if (!retryable) {
        this.invalidateMediaUrlRequest(track.id);
        this.setAudioDisabled(true, index);
        this.clearMediaRetryState(track.id);
        this.sendPlaybackFailure(
          'media-url',
          'retrieve-failed',
          false,
          retryAttempt + 1,
          error
        );
        this.sendPlayingEvent('err');
        return;
      }

      this.clearMediaUrlRetryTimer(track.id);
      const retry = () => {
        delete this._media_url_retry_timers[track.id];
        if (
          !this.isCurrentMediaUrlRequest(index, track, playNow, requestToken)
        ) {
          return;
        }
        this.retrieveMediaUrl(index, playNow, {
          forceRefresh: retryAttempt > 0,
          retryAttempt: retryAttempt + 1,
        });
      };
      const delay = retryAttempt === 0 ? 350 : 1000;
      this._media_url_retry_timers[track.id] = setTimeout(retry, delay);
    }

    unloadTrackHowl(track) {
      if (track && track.howl === this.currentHowl) {
        this.clearPlaybackWatch();
      }
      if (track && track.howl && typeof track.howl.unload === 'function') {
        track.howl.unload();
      }
      if (track) {
        Object.assign(track, { howl: null });
      }
    }

    handleMediaLoadError(index, data, playNow, error, sourceHowl) {
      if (
        !data ||
        this.playlist[index] !== data ||
        this.currentAudio !== data ||
        this.index !== index ||
        (sourceHowl && data.howl !== sourceHowl)
      ) {
        return;
      }

      const retryState = this._media_retry_state[data.id];
      if (
        retryState &&
        retryState.candidateIndex + 1 < retryState.candidates.length
      ) {
        retryState.candidateIndex += 1;
        this.unloadTrackHowl(data);
        this.setMediaURI(
          retryState.candidates[retryState.candidateIndex],
          data.id
        );
        this.finishLoad(index, playNow);
        return;
      }

      if (
        retryState &&
        retryState.canForceRefresh &&
        !retryState.forceRefreshAttempted
      ) {
        retryState.forceRefreshAttempted = true;
        this.unloadTrackHowl(data);
        delete this._media_uri_list[data.id];
        this.retrieveMediaUrl(index, playNow, { forceRefresh: true });
        return;
      }

      this.sendPlaybackFailure('media-load', 'load-failed', false, 1, error);
      this.setAudioDisabled(true, index);
      this.sendPlayingEvent('err');
      this.unloadTrackHowl(data);
      delete this._media_uri_list[data.id];
      this.clearMediaRetryState(data.id);
    }

    retrieveMediaUrl(index, playNow, options = {}) {
      const track = this.playlist[index];
      if (!track) {
        return;
      }
      this.clearMediaUrlRetryTimer(track.id);
      const requestToken = this.beginMediaUrlRequest(track.id);
      const msg = {
        type: 'BG_PLAYER:RETRIEVE_URL',
        data: {
          ...track,
          howl: undefined,
          index,
          playNow,
        },
      };

      MediaService.bootstrapTrack(
        msg.data,
        (bootinfo) => {
          if (
            !this.isCurrentMediaUrlRequest(index, track, playNow, requestToken)
          ) {
            return;
          }
          msg.type = 'BG_PLAYER:RETRIEVE_URL_SUCCESS';

          msg.data = { ...msg.data, ...bootinfo };

          this.playlist[index].bitrate = bootinfo.bitrate;
          this.playlist[index].platform = bootinfo.platform;

          const urlCandidates = Player.getMediaUrlCandidates(bootinfo);
          if (!urlCandidates.length) {
            this.retryMediaUrl(
              index,
              playNow,
              Number(options.retryAttempt || 0),
              'empty media URL response',
              requestToken
            );
            return;
          }
          this.clearMediaUrlRetryTimer(track.id);
          this.setMediaRetryState(msg.data, urlCandidates, {
            canForceRefresh:
              bootinfo.platform === 'bilibili' &&
              String(msg.data.id || '').startsWith('bitrack_v_'),
            forceRefreshAttempted: options.forceRefresh === true,
          });
          this.setMediaURI(urlCandidates[0], msg.data.id);
          this.setAudioDisabled(false, msg.data.index);
          this.finishLoad(msg.data.index, playNow);
          playerSendMessage(this.mode, msg);
          this.invalidateMediaUrlRequest(track.id);
        },
        (error) => {
          if (
            !this.isCurrentMediaUrlRequest(index, track, playNow, requestToken)
          ) {
            return;
          }
          this.retryMediaUrl(
            index,
            playNow,
            Number(options.retryAttempt || 0),
            error,
            requestToken
          );
        },
        { forceRefresh: options.forceRefresh === true }
      );
    }

    /**
     * Load a song from the playlist.
     * @param  {Number} index Index of the song in the playlist
     * (leave empty to load the first or current).
     */
    load(idx) {
      let index = typeof idx === 'number' ? idx : this.index;
      if (index < 0) return;
      if (!this.playlist[index]) {
        index = 0;
      }
      const previousTrack = this.currentAudio;
      // stop when load new track to avoid multiple songs play in same time
      if (index !== this.index) {
        this.clearPlaybackWatch();
        if (previousTrack) {
          this.clearMediaUrlRetryTimer(previousTrack.id);
          this.invalidateMediaUrlRequest(previousTrack.id);
        }
        Howler.unload();
      }
      this.index = index;

      this.sendLoadEvent();
    }

    finishLoad(index, playNow) {
      const data = this.playlist[index];

      // If we already loaded this track, use the current one.
      // Otherwise, setup and load a new Howl.
      const self = this;
      if (!data.howl) {
        let createdHowl;
        const isCurrentCreatedHowl = () =>
          data.howl === createdHowl &&
          self.currentAudio === data &&
          self.index === index;
        createdHowl = new Howl({
          src: [self._media_uri_list[data.url || data.id]],
          format: 'mp3', // bypass Howl checking url extension, issue #1200
          volume: 1,
          mute: self.muted,
          html5: true, // Force to HTML5 so that the audio can stream in (best for large files).
          onplay() {
            if (!isCurrentCreatedHowl()) {
              return;
            }
            const resumeAt = self._media_resume_positions[data.id];
            if (Number.isFinite(resumeAt) && resumeAt > 0) {
              self.currentHowl.seek(resumeAt);
              delete self._media_resume_positions[data.id];
            }
            self.beginPlaybackWatch(data.howl, data);
            prepareAudioAnalysis(self.currentHowl);
            if ('mediaSession' in navigator) {
              const { mediaSession } = navigator;
              mediaSession.playbackState = 'playing';
              mediaSession.metadata = new MediaMetadata({
                title: self.currentAudio.title,
                artist: self.currentAudio.artist,
                album: `Listen 1  •  ${(
                  self.currentAudio.album || '<???>'
                ).padEnd(100)}`,
                artwork: [
                  {
                    src: self.currentAudio.img_url,
                    sizes: '500x500',
                  },
                ],
              });
            }
            self.currentAudio.disabled = false;
            // Date.now() returns a millisecond timestamp that needs to be converted to a second timestamp
            self.playedFrom = Math.round(Date.now() / 1000);
            self.sendPlayingEvent('Playing');
          },
          onload() {
            if (!isCurrentCreatedHowl()) {
              return;
            }
            self.currentAudio.disabled = false;
            self.sendPlayingEvent('Loaded');
          },
          onend() {
            if (!isCurrentCreatedHowl()) {
              return;
            }
            self.clearPlaybackWatch();
            delete self._media_resume_positions[data.id];
            switch (self.loop_mode) {
              case 2:
                self.skip('random');
                break;

              case 1:
                self.play();
                break;

              case 0:
              default:
                self.skip('next');
                break;
            }
            self.sendPlayingEvent('Ended');
          },
          onpause() {
            if (!isCurrentCreatedHowl()) {
              return;
            }
            self.clearPlaybackWatch();
            navigator.mediaSession.playbackState = 'paused';
            self.sendPlayingEvent('Paused');
          },
          onstop() {
            if (!isCurrentCreatedHowl()) {
              return;
            }
            self.clearPlaybackWatch();
            self.sendPlayingEvent('Stopped');
          },
          onseek() {
            if (!isCurrentCreatedHowl()) {
              return;
            }
            self.resetPlaybackWatchProgress();
          },
          onvolume() {},
          onloaderror(id, err) {
            if (!isCurrentCreatedHowl()) {
              return;
            }
            self.handleMediaLoadError(index, data, playNow, err, createdHowl);
          },
          onplayerror(id, err) {
            if (!isCurrentCreatedHowl()) {
              return;
            }
            self.handleMediaLoadError(index, data, playNow, err, createdHowl);
          },
        });
        data.howl = createdHowl;
      }

      if (playNow) {
        if (this.playing && index === this.index) {
          return;
        }
        this.playlist.forEach((i) => {
          if (i.howl && i.howl !== this.currentHowl) {
            i.howl.stop();
          }
        });
        prepareAudioAnalysis(this.currentHowl);
        this.currentHowl.play();
      }
    }

    /**
     * Pause the currently playing track.
     */
    pause() {
      if (!this.currentHowl) return;

      // Puase the sound.
      this.clearPlaybackWatch();
      this.currentHowl.pause();
    }

    /**
     * Skip to the next or previous track.
     * @param  {String} direction 'next' or 'prev'.
     */
    skip(direction) {
      const previousTrack = this.currentAudio;
      this.clearPlaybackWatch();
      if (previousTrack) {
        this.clearMediaUrlRetryTimer(previousTrack.id);
        this.invalidateMediaUrlRequest(previousTrack.id);
      }
      Howler.unload();
      if (this.playlist.length === 0) return;

      const shuffleMode = this._loop_mode === 2 || direction === 'random';
      if (shuffleMode) {
        this.index =
          direction === 'prev'
            ? this.previousShuffleIndex(this.index)
            : this.nextShuffleIndex(this.index);
        if (this.index >= 0) {
          this.play(this.index);
          return;
        }
      } else {
        const offset = direction === 'prev' ? -1 : 1;
        let tryCount = 0;
        while (tryCount < this.playlist.length) {
          this.index =
            (this.index + offset + this.playlist.length) % this.playlist.length;
          if (this.isPlayableIndex(this.index)) {
            this.play(this.index);
            return;
          }
          tryCount += 1;
        }
      }

      playerSendMessage(this.mode, {
        type: 'BG_PLAYER:RETRIEVE_URL_FAIL_ALL',
      });
      this.sendLoadEvent();
    }

    set loop_mode(input) {
      const LOOP_MODE = {
        all: 0,
        one: 1,
        shuffle: 2,
      };
      let myMode = 0;
      if (typeof input === 'string') {
        myMode = LOOP_MODE[input];
      } else {
        myMode = input;
      }
      if (!Object.values(LOOP_MODE).includes(myMode)) {
        return;
      }
      if (myMode !== this._loop_mode) {
        this.resetShuffleState(this.index);
      }
      this._loop_mode = myMode;
    }

    get loop_mode() {
      return this._loop_mode;
    }

    /**
     * Set the volume and update the volume slider display.
     * @param  {Number} val Volume between 0 and 1.
     */
    set volume(val) {
      // Update the global volume (affecting all Howls).
      if (typeof val === 'number') {
        Howler.volume(val);
        this.sendVolumeEvent();
        this.sendFrameUpdate();
      }
    }

    // eslint-disable-next-line class-methods-use-this
    get volume() {
      return Howler.volume();
    }

    adjustVolume(inc) {
      this.volume = inc
        ? Math.min(this.volume + 0.1, 1)
        : Math.max(this.volume - 0.1, 0);
      this.sendVolumeEvent();
      this.sendFrameUpdate();
    }

    mute() {
      Howler.mute(true);
      playerSendMessage(this.mode, {
        type: 'BG_PLAYER:MUTE',
        data: true,
      });
    }

    unmute() {
      Howler.mute(false);
      playerSendMessage(this.mode, {
        type: 'BG_PLAYER:MUTE',
        data: false,
      });
    }

    /**
     * Seek to a new position in the currently playing track.
     * @param  {Number} per Percentage through the song to skip.
     */
    seek(per) {
      if (!this.currentHowl) return;

      // Get the Howl we want to manipulate.
      const audio = this.currentHowl;

      // Convert the percent into a seek position.
      // if (audio.playing()) {
      // }
      audio.seek(audio.duration() * per);
      this.resetPlaybackWatchProgress();
    }
    /**
     * Seek to a new position in the currently playing track.
     * @param {Number} seconds Seconds through the song to skip.
     */

    seekTime(seconds) {
      if (!this.currentHowl) return;
      const audio = this.currentHowl;
      audio.seek(seconds);
      this.resetPlaybackWatchProgress();
    }

    /**
     * Format the time from seconds to M:SS.
     * @param  {Number} secs Seconds to format.
     * @return {String}      Formatted time.
     */
    static formatTime(secs) {
      const minutes = Math.floor(secs / 60) || 0;
      const seconds = secs - minutes * 60 || 0;

      return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
    }

    setMediaURI(uri, url) {
      if (url) {
        this._media_uri_list[url] = uri;
      }
    }

    setAudioDisabled(disabled, idx) {
      if (this.playlist[idx]) {
        this.playlist[idx].disabled = disabled;
      }
    }

    async sendFrameUpdate() {
      const data = {
        id: this.currentAudio ? this.currentAudio.id : 0,
        duration: this.currentHowl ? this.currentHowl.duration() : 0,
        pos: this.currentHowl ? this.currentHowl.seek() : 0,
        playedFrom: this.playedFrom,
        playing: this.playing,
      };
      if ('setPositionState' in navigator.mediaSession) {
        navigator.mediaSession.setPositionState({
          duration: this.currentHowl ? this.currentHowl.duration() : 0,
          playbackRate: this.currentHowl ? this.currentHowl.rate() : 1,
          position: this.currentHowl ? this.currentHowl.seek() : 0,
        });
      }

      playerSendMessage(this.mode, {
        type: 'BG_PLAYER:FRAME_UPDATE',
        data,
      });
    }

    async sendPlayingEvent(reason = 'UNKNOWN') {
      playerSendMessage(this.mode, {
        type: 'BG_PLAYER:PLAY_STATE',
        data: {
          isPlaying: this.playing,
          reason,
        },
      });
    }

    async sendLoadEvent() {
      playerSendMessage(this.mode, {
        type: 'BG_PLAYER:LOAD',
        data: {
          currentPlaying: {
            ...this.currentAudio,
            howl: undefined,
          },
          playlist: {
            index: this.index,
            length: this.playlist.length,
          },
        },
      });
    }

    async sendVolumeEvent() {
      playerSendMessage(this.mode, {
        type: 'BG_PLAYER:VOLUME',
        data: this.volume * 100,
      });
    }

    async sendPlaylistEvent() {
      playerSendMessage(this.mode, {
        type: 'BG_PLAYER:PLAYLIST',
        data: this.playlist.map((audio) => ({ ...audio, howl: undefined })),
      });
    }
  }

  // Setup our new audio player class and pass it the playlist.

  const threadPlayer = new Player();
  threadPlayer.setRefreshRate();
  window.threadPlayer = threadPlayer;

  if ('mediaSession' in navigator) {
    const { mediaSession } = navigator;
    mediaSession.setActionHandler('play', () => {
      threadPlayer.play();
    });
    mediaSession.setActionHandler('pause', () => {
      threadPlayer.pause();
    });
    mediaSession.setActionHandler('seekforward', (details) => {
      // User clicked "Seek Forward" media notification icon.
      const { currentHowl } = threadPlayer;
      const skipTime = details.seekOffset || threadPlayer.skipTime;
      const newTime = Math.min(
        currentHowl.seek() + skipTime,
        currentHowl.duration()
      );
      threadPlayer.seekTime(newTime);
      threadPlayer.sendFrameUpdate();
    });
    mediaSession.setActionHandler('seekbackward', (details) => {
      // User clicked "Seek Backward" media notification icon.
      const { currentHowl } = threadPlayer;
      const skipTime = details.seekOffset || threadPlayer.skipTime;
      const newTime = Math.max(currentHowl.seek() - skipTime, 0);
      threadPlayer.seekTime(newTime);
      threadPlayer.sendFrameUpdate();
    });
    mediaSession.setActionHandler('seekto', (details) => {
      const { seekTime } = details;
      threadPlayer.seekTime(seekTime);
      threadPlayer.sendFrameUpdate();
    });
    mediaSession.setActionHandler('nexttrack', () => {
      threadPlayer.skip('next');
      threadPlayer.sendFrameUpdate();
    });
    mediaSession.setActionHandler('previoustrack', () => {
      threadPlayer.skip('prev');
      threadPlayer.sendFrameUpdate();
    });
  }
  playerSendMessage(this.mode, {
    type: 'BG_PLAYER:READY',
  });
}
