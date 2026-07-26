/* eslint-disable no-underscore-dangle */
/* global MediaMetadata playerSendMessage MediaService */
/* global Howl Howler */
{
  function prepareAudioAnalysis(howl) {
    if (
      howl &&
      window.Listen1AudioAnalysis &&
      typeof window.Listen1AudioAnalysis.prepareHowl === 'function'
    ) {
      window.Listen1AudioAnalysis.prepareHowl(howl);
    }
  }

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
        }
      }, 1000 / rate);
    }

    get currentAudio() {
      return this.playlist[this.index];
    }

    get currentHowl() {
      return this.currentAudio && this.currentAudio.howl;
    }

    get playing() {
      return this.currentHowl ? this.currentHowl.playing() : false;
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

      let queue = this.shuffleIndices(candidates);
      if (!isFirstCycle && queue.length > 1 && queue[0] === currentIndex) {
        const swapIndex =
          1 + Math.floor(this._shuffle_random() * (queue.length - 1));
        queue[0] = queue[swapIndex];
        queue[swapIndex] = currentIndex;
      }

      const repeatsLastCycle =
        queue.length > 2 &&
        queue.length === this._shuffle_last_cycle.length &&
        queue.every((index, position) => {
          return index === this._shuffle_last_cycle[position];
        });
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
          if (!this.isPlayableIndex(nextIndex)) {
            continue;
          }
          this._shuffle_history.push(nextIndex);
          this._shuffle_history_index = this._shuffle_history.length - 1;
          return nextIndex;
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
      this.stopAll(); // stop the loadded track before remove list
      this.playlist = [];
      this.index = -1;
      this._media_retry_state = {};
      this.resetShuffleState();
      Howler.unload();
      this.sendPlaylistEvent();
      this.sendLoadEvent();
    }

    stopAll() {
      this.playlist.forEach((i) => {
        if (i.howl) {
          i.howl.stop();
        }
      });
    }

    setNewPlaylist(list) {
      if (list.length) {
        // stop current
        this.stopAll();
        Howler.unload();

        this._media_retry_state = {};
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

      const data = this.playlist[this.index];
      if (!data.howl || !this._media_uri_list[data.id]) {
        this.retrieveMediaUrl(this.index, true);
      } else {
        this.finishLoad(this.index, true);
      }
    }

    getMediaUrlCandidates(bootinfo) {
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

    unloadTrackHowl(track) {
      if (track && track.howl && typeof track.howl.unload === 'function') {
        track.howl.unload();
      }
      if (track) {
        track.howl = null;
      }
    }

    handleMediaLoadError(index, data, playNow, error) {
      if (!data || this.playlist[index] !== data) {
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

      playerSendMessage(this.mode, {
        type: 'BG_PLAYER:PLAY_FAILED',
        data: error,
      });
      this.setAudioDisabled(true, index);
      this.sendPlayingEvent('err');
      this.unloadTrackHowl(data);
      delete this._media_uri_list[data.id];
      this.clearMediaRetryState(data.id);
    }

    retrieveMediaUrl(index, playNow, options = {}) {
      const msg = {
        type: 'BG_PLAYER:RETRIEVE_URL',
        data: {
          ...this.playlist[index],
          howl: undefined,
          index,
          playNow,
        },
      };

      MediaService.bootstrapTrack(
        msg.data,
        (bootinfo) => {
          msg.type = 'BG_PLAYER:RETRIEVE_URL_SUCCESS';

          msg.data = { ...msg.data, ...bootinfo };

          this.playlist[index].bitrate = bootinfo.bitrate;
          this.playlist[index].platform = bootinfo.platform;

          const urlCandidates = this.getMediaUrlCandidates(bootinfo);
          if (!urlCandidates.length) {
            this.setAudioDisabled(true, msg.data.index);
            playerSendMessage(this.mode, {
              type: 'BG_PLAYER:RETRIEVE_URL_FAIL',
            });
            this.skip('next');
            return;
          }
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
        },
        () => {
          msg.type = 'BG_PLAYER:RETRIEVE_URL_FAIL';

          this.setAudioDisabled(true, msg.data.index);
          this.clearMediaRetryState(msg.data.id);
          playerSendMessage(this.mode, msg);

          this.skip('next');
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
      // stop when load new track to avoid multiple songs play in same time
      if (index !== this.index) {
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
        data.howl = new Howl({
          src: [self._media_uri_list[data.url || data.id]],
          format: 'mp3', // bypass Howl checking url extension, issue #1200
          volume: 1,
          mute: self.muted,
          html5: true, // Force to HTML5 so that the audio can stream in (best for large files).
          onplay() {
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
            self.currentAudio.disabled = false;
            self.sendPlayingEvent('Loaded');
          },
          onend() {
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
            navigator.mediaSession.playbackState = 'paused';
            self.sendPlayingEvent('Paused');
          },
          onstop() {
            self.sendPlayingEvent('Stopped');
          },
          onseek() {},
          onvolume() {},
          onloaderror(id, err) {
            self.handleMediaLoadError(index, data, playNow, err);
          },
          onplayerror(id, err) {
            playerSendMessage(self.mode, {
              type: 'BG_PLAYER:PLAY_FAILED',
              data: err,
            });
            self.currentAudio.disabled = true;
            self.sendPlayingEvent('err');
          },
        });
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
      this.currentHowl.pause();
    }

    /**
     * Skip to the next or previous track.
     * @param  {String} direction 'next' or 'prev'.
     */
    skip(direction) {
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
    }
    /**
     * Seek to a new position in the currently playing track.
     * @param {Number} seconds Seconds through the song to skip.
     */

    seekTime(seconds) {
      if (!this.currentHowl) return;
      const audio = this.currentHowl;
      audio.seek(seconds);
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
