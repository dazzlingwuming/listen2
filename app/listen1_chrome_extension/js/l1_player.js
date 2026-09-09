/* eslint-disable no-param-reassign */
/* global getPlayer getPlayerAsync addPlayerListener getPlayerMode */
{
  const mode = getPlayerMode();
  const androidPlayback =
    typeof window !== 'undefined' &&
    window.Listen2AndroidHttpAdapter &&
    typeof window.Listen2AndroidHttpAdapter.isAvailable === 'function' &&
    window.Listen2AndroidHttpAdapter.isAvailable()
      ? window.Listen2AndroidHttpAdapter
      : null;
  const nativeLogicalTracks = new Map();
  const nativeTracksByOccurrence = new Map();
  let nativeCurrentTrack = null;
  let nativeSelectedTrackId = '';
  const nativePageEpoch = Math.floor(Date.now() % 2147483647);
  let nativeLyricSnapshot = null;
  let l1Player;

  const nativeTrackSelection = (track) => {
    let rawId = '';
    if (track && track.id) rawId = track.id;
    else if (track && track.localTrackId) rawId = track.localTrackId;
    const id = String(rawId);
    const title =
      typeof (track && track.title) === 'string' ? track.title.trim() : '';
    const artist =
      typeof (track && track.artist) === 'string' ? track.artist.trim() : '';
    const durationMs = Math.max(
      0,
      Number.isFinite(Number(track && track.durationMs))
        ? Math.round(Number(track.durationMs))
        : Math.round(Number(track && track.duration) * 1000) || 0
    );
    if (!title || !artist || title.length > 256 || artist.length > 256) {
      return null;
    }
    if (
      track &&
      track.source === 'local' &&
      /^local\.track\.[a-f0-9]{64}$/.test(id)
    ) {
      return {
        source: 'local',
        providerTrackId: id,
        providerPartId: 1,
        title,
        artist,
        durationMs,
        mediaKind: 'audio',
      };
    }
    const bilibili = /^bitrack_v_(BV[0-9A-Za-z]{6,32})-(\d+)$/.exec(id);
    if (bilibili) {
      return {
        source: 'bilibili',
        providerTrackId: bilibili[1],
        providerPartId: Number(bilibili[2]),
        title,
        artist,
        durationMs,
        mediaKind: 'audio',
      };
    }
    const bilibiliAudio = /^bitrack_([1-9][0-9]{0,17})$/.exec(id);
    if (bilibiliAudio) {
      return {
        source: 'bilibili',
        providerTrackId: bilibiliAudio[1],
        providerPartId: 1,
        title,
        artist,
        durationMs,
        mediaKind: 'audio',
      };
    }
    const netease = /^netrack_([1-9][0-9]{0,17})$/.exec(id);
    if (netease) {
      return {
        source: 'netease',
        providerTrackId: netease[1],
        // The bridge requires an explicit positive part identity even for
        // single-part tracks; native owns all later rendition choices.
        providerPartId: 1,
        title,
        artist,
        durationMs,
        mediaKind: 'audio',
      };
    }
    return null;
  };

  const nativeCommand = (command, payload) => {
    if (!androidPlayback) return Promise.resolve();
    return androidPlayback.command(command, payload);
  };

  const lyricSafeNativeSnapshot = (snapshot) => {
    const lyric = snapshot && snapshot.lyric;
    if (!snapshot || !lyric || typeof lyric !== 'object') return null;
    const string = (value, limit = 256) => {
      const text = typeof value === 'string' ? value : '';
      return text.length <= limit ? text : '';
    };
    const integer = (value) =>
      Number.isSafeInteger(Number(value)) && Number(value) >= 0
        ? Number(value)
        : 0;
    const trackHandle = string(lyric.trackHandle);
    const occurrenceId = string(lyric.occurrenceId);
    const source = string(lyric.source, 32);
    if (!trackHandle || !occurrenceId || !source) return null;
    return Object.freeze({
      pageEpoch: nativePageEpoch,
      revision: integer(snapshot.revision),
      positionMs: integer(snapshot.positionMs),
      durationMs: integer(snapshot.durationMs),
      state: string(snapshot.state, 32),
      source,
      providerTrackId: string(lyric.providerTrackId),
      providerPartId: integer(lyric.providerPartId),
      trackHandle,
      occurrenceId,
      selectionGeneration: integer(lyric.selectionGeneration),
      playbackRevision: integer(lyric.playbackRevision),
      capability: string(lyric.capability, 64),
      lyricState: string(lyric.state, 64),
    });
  };

  const nativeSelect = (track, action, playWhenReady) => {
    const selection = nativeTrackSelection(track);
    if (!androidPlayback || !selection) return Promise.resolve(null);
    nativeLogicalTracks.set(track.id, track);
    return androidPlayback
      .prepareSelection(selection)
      .then((prepared) => {
        nativeTracksByOccurrence.set(prepared.occurrenceId, track);
        return androidPlayback.selectPrepared(prepared, {
          action,
          playWhenReady,
        });
      })
      .then((snapshot) => {
        if (action === 'replace-current') {
          nativeCurrentTrack = track;
          nativeSelectedTrackId = track.id;
        }
        return snapshot;
      });
  };

  const syncNativeSnapshot = (snapshot) => {
    if (!snapshot || !androidPlayback) return;
    nativeLyricSnapshot = lyricSafeNativeSnapshot(snapshot);
    const currentOccurrence =
      Array.isArray(snapshot.queue) && snapshot.queue.length
        ? snapshot.queue[0] && snapshot.queue[0].occurrenceId
        : '';
    const currentTrack = nativeTracksByOccurrence.get(currentOccurrence);
    if (currentTrack) {
      nativeCurrentTrack = currentTrack;
      nativeSelectedTrackId = currentTrack.id;
    } else if (!currentOccurrence) {
      nativeCurrentTrack = null;
      nativeSelectedTrackId = '';
      nativeTracksByOccurrence.clear();
    }
    const playing = {
      id: nativeCurrentTrack ? nativeCurrentTrack.id : '',
      title: snapshot.metadata.title,
      artist: snapshot.metadata.artist,
      duration: snapshot.durationMs / 1000,
      pos: snapshot.positionMs / 1000,
      playing: snapshot.state === 'playing',
      state: snapshot.state,
    };
    l1Player.status.playing = playing;
    l1Player.status.muted = snapshot.muted;
    l1Player.status.volume = snapshot.volumePercent;
    l1Player.status.loop_mode = snapshot.mode;
    l1Player.status.playNextQueue = snapshot.queue.map((entry) => ({
      queueId: entry.occurrenceId,
      track: {
        title: entry.title,
        artist: entry.artist,
        duration: entry.durationMs / 1000,
      },
    }));
  };

  const myPlayer = getPlayer(mode);
  l1Player = {
    status: {
      muted: myPlayer.muted,
      volume: myPlayer.volume * 100,
      loop_mode: myPlayer.loop_mode,
      playing: myPlayer.playing,
      playNextQueue: [],
    },
    isNativePlayback() {
      return androidPlayback !== null;
    },
    getNativeLyricSnapshot() {
      return nativeLyricSnapshot;
    },
    play() {
      if (androidPlayback) {
        if (
          nativeCurrentTrack &&
          nativeSelectedTrackId !== nativeCurrentTrack.id
        ) {
          return nativeSelect(nativeCurrentTrack, 'replace-current', true);
        }
        return nativeCommand('play', {});
      }
      getPlayerAsync(mode, (player) => {
        player.play();
      });
      return Promise.resolve(null);
    },
    pause() {
      if (androidPlayback) {
        return nativeCommand('pause', {});
      }
      getPlayerAsync(mode, (player) => {
        player.pause();
      });
      return Promise.resolve(null);
    },
    togglePlayPause() {
      if (androidPlayback) {
        return nativeCommand(
          androidPlayback.getPlaybackSnapshot() &&
            androidPlayback.getPlaybackSnapshot().state === 'playing'
            ? 'pause'
            : 'play',
          {}
        );
      }
      getPlayerAsync(mode, (player) => {
        if (player.playing) {
          player.pause();
        } else {
          player.play();
        }
      });
      return Promise.resolve(null);
    },
    playById(id) {
      if (androidPlayback) {
        return nativeSelect(
          nativeLogicalTracks.get(id),
          'replace-current',
          true
        );
      }
      getPlayerAsync(mode, (player) => {
        player.playById(id);
      });
      return Promise.resolve(null);
    },
    loadById(idx) {
      if (androidPlayback) {
        return nativeSelect(
          nativeLogicalTracks.get(idx),
          'replace-current',
          false
        );
      }
      getPlayerAsync(mode, (player) => {
        player.loadById(idx);
      });
      return Promise.resolve(null);
    },
    seek(per) {
      if (androidPlayback) {
        const snapshot = androidPlayback.getPlaybackSnapshot();
        const positionMs = Math.max(
          0,
          Math.round(Number(per) * Number(snapshot && snapshot.durationMs)) || 0
        );
        return nativeCommand('seek', { positionMs });
      }
      getPlayerAsync(mode, (player) => {
        player.seek(per);
      });
      return Promise.resolve(null);
    },
    next() {
      if (androidPlayback) {
        return nativeCommand('next', {});
      }
      getPlayerAsync(mode, (player) => {
        player.skip('next');
      });
      return Promise.resolve(null);
    },
    prev() {
      if (androidPlayback) {
        return nativeCommand('previous', {});
      }
      getPlayerAsync(mode, (player) => {
        player.skip('prev');
      });
      return Promise.resolve(null);
    },
    random() {
      if (androidPlayback) {
        return nativeCommand('next', {});
      }
      getPlayerAsync(mode, (player) => {
        player.skip('random');
      });
      return Promise.resolve(null);
    },
    setLoopMode(input) {
      if (androidPlayback) {
        const modeByInput = {
          all: 'repeat-all',
          one: 'repeat-one',
          shuffle: 'shuffle',
          0: 'sequential',
          1: 'repeat-one',
          2: 'shuffle',
        };
        if (modeByInput[input] !== undefined)
          return nativeCommand('mode', { mode: modeByInput[input] });
        return Promise.resolve(null);
      }
      getPlayerAsync(mode, (player) => {
        // eslint-disable-next-line no-param-reassign
        player.loop_mode = input;
      });
      return Promise.resolve(null);
    },
    mute() {
      if (androidPlayback) {
        return nativeCommand('mute', { muted: true });
      }
      getPlayerAsync(mode, (player) => {
        player.mute();
      });
      return Promise.resolve(null);
    },
    unmute() {
      if (androidPlayback) {
        return nativeCommand('mute', { muted: false });
      }
      getPlayerAsync(mode, (player) => {
        player.unmute();
      });
      return Promise.resolve(null);
    },
    toggleMute() {
      if (androidPlayback) {
        const snapshot = androidPlayback.getPlaybackSnapshot();
        return nativeCommand('mute', { muted: !(snapshot && snapshot.muted) });
      }
      getPlayerAsync(mode, (player) => {
        if (player.muted) player.unmute();
        else player.mute();
      });
      return Promise.resolve(null);
    },
    setVolume(per) {
      if (androidPlayback) {
        return nativeCommand('volume', {
          volumePercent: Math.max(
            0,
            Math.min(100, Math.round(Number(per) || 0))
          ),
        });
      }
      getPlayerAsync(mode, (player) => {
        // eslint-disable-next-line no-param-reassign
        player.volume = per / 100;
      });
      return Promise.resolve(null);
    },
    adjustVolume(increase) {
      if (androidPlayback) {
        const snapshot = androidPlayback.getPlaybackSnapshot();
        const current = Number(snapshot && snapshot.volumePercent) || 0;
        return nativeCommand('volume', {
          volumePercent: Math.max(
            0,
            Math.min(100, current + (increase ? 10 : -10))
          ),
        });
      }
      getPlayerAsync(mode, (player) => {
        player.adjustVolume(increase);
      });
      return Promise.resolve(null);
    },
    addTrack(track) {
      if (androidPlayback) {
        nativeLogicalTracks.set(track.id, track);
        return;
      }
      getPlayerAsync(mode, (player) => {
        player.insertAudio(track);
      });
    },
    enqueueNext(track) {
      if (androidPlayback) {
        return nativeSelect(track, 'enqueue-next', false);
      }
      getPlayerAsync(mode, (player) => {
        player.enqueueNext(track);
      });
      return Promise.resolve(null);
    },
    removePlayNextQueueEntry(queueId) {
      if (androidPlayback) {
        return nativeCommand('remove', { occurrenceId: queueId });
      }
      getPlayerAsync(mode, (player) => {
        player.removePlayNextQueueEntry(queueId);
      });
      return Promise.resolve(null);
    },
    movePlayNextQueueEntry(queueId, targetIndex) {
      if (androidPlayback) {
        return nativeCommand('reorder', { occurrenceId: queueId, targetIndex });
      }
      getPlayerAsync(mode, (player) => {
        player.movePlayNextQueueEntry(queueId, targetIndex);
      });
      return Promise.resolve(null);
    },
    clearPlayNextQueue() {
      if (androidPlayback) {
        return nativeCommand('clear', {});
      }
      getPlayerAsync(mode, (player) => {
        player.clearPlayNextQueue();
      });
      return Promise.resolve(null);
    },
    insertTrack(track, to_track, direction) {
      if (androidPlayback) {
        return nativeSelect(track, 'enqueue-next', false);
      }
      getPlayerAsync(mode, (player) => {
        player.insertAudioByDirection(track, to_track, direction);
      });
      return Promise.resolve(null);
    },
    removeTrack(index) {
      if (androidPlayback) {
        const queue = l1Player.status.playNextQueue || [];
        const entry = queue[Number(index)];
        return entry
          ? nativeCommand('remove', { occurrenceId: entry.queueId })
          : Promise.resolve(null);
      }
      getPlayerAsync(mode, (player) => {
        player.removeAudio(index);
      });
      return Promise.resolve(null);
    },
    addTracks(list) {
      if (androidPlayback) {
        return (Array.isArray(list) ? list : []).reduce(
          (promise, track) =>
            promise.then(() => nativeSelect(track, 'enqueue-next', false)),
          Promise.resolve(null)
        );
      }
      getPlayerAsync(mode, (player) => {
        player.appendAudioList(list);
      });
      return Promise.resolve(null);
    },
    clearPlaylist() {
      if (androidPlayback) {
        return nativeCommand('clear', {});
      }
      getPlayerAsync(mode, (player) => {
        player.clearPlaylist();
      });
      return Promise.resolve(null);
    },
    setNewPlaylist(list) {
      if (androidPlayback) {
        nativeLogicalTracks.clear();
        nativeTracksByOccurrence.clear();
        (Array.isArray(list) ? list : []).forEach((track) =>
          nativeLogicalTracks.set(track.id, track)
        );
        nativeCurrentTrack =
          Array.isArray(list) && list.length ? list[0] : null;
        return;
      }
      getPlayerAsync(mode, (player) => {
        player.setNewPlaylist(list);
      });
    },
    getTrackById(id) {
      if (androidPlayback) return nativeLogicalTracks.get(id) || null;
      if (!l1Player.status.playlist) return null;
      return l1Player.status.playlist.find((track) => track.id === id);
    },
    connectPlayer() {
      if (androidPlayback) {
        return androidPlayback.connect({
          pageEpoch: nativePageEpoch,
          onSnapshot: syncNativeSnapshot,
        }).promise;
      }
      getPlayerAsync(mode, (player) => {
        if (!player.playing) {
          const localPlayerSettings = localStorage.getObject('player-settings');
          const savedPlaymode = Number(
            localPlayerSettings && localPlayerSettings.playmode
          );
          const loopModes = ['all', 'shuffle', 'one'];

          // Restore the loop mode before the playlist. In shuffle mode,
          // setNewPlaylist chooses a fresh first track, so do not overwrite it
          // with the last persisted track below.
          if (Number.isInteger(savedPlaymode) && loopModes[savedPlaymode]) {
            player.loop_mode = loopModes[savedPlaymode];
          }

          // Restore the queued tracks after restoring the playback mode.
          if (!player.playlist.length) {
            const localCurrentPlaying =
              localStorage.getObject('current-playing');
            if (localCurrentPlaying !== null) {
              localCurrentPlaying.forEach((i) => {
                i.disabled = false;
              });
              player.setNewPlaylist(localCurrentPlaying);
            }
          }

          if (localPlayerSettings !== null && player.loop_mode !== 2) {
            player.loadById(localPlayerSettings.nowplaying_track_id);
          }

          const savedPlayNextQueue = localStorage.getObject('play-next-queue');
          if (
            Array.isArray(savedPlayNextQueue) &&
            typeof player.setPlayNextQueue === 'function'
          ) {
            player.setPlayNextQueue(savedPlayNextQueue);
          }
        }

        player.sendPlaylistEvent();
        if (typeof player.sendPlayNextQueueEvent === 'function') {
          player.sendPlayNextQueueEvent();
        }
        player.sendPlayingEvent();
        player.sendLoadEvent();
      });
      return Promise.resolve(null);
    },
  };

  l1Player.injectDirectives = (ngApp) => {
    ngApp.directive('playFromPlaylist', () => ({
      restrict: 'EA',
      scope: {
        song: '=playFromPlaylist',
      },
      link(scope, element) {
        element.bind('click', () => {
          l1Player.playById(scope.song.id);
        });
      },
    }));

    ngApp.directive('nextTrack', () => ({
      restrict: 'EA',
      link(scope, element) {
        element.bind('click', () => {
          l1Player.next();
        });
      },
    }));

    ngApp.directive('prevTrack', () => ({
      restrict: 'EA',
      link(scope, element) {
        element.bind('click', () => {
          l1Player.prev();
        });
      },
    }));

    ngApp.directive('clearPlaylist', () => ({
      restrict: 'EA',
      link(scope, element) {
        element.bind('click', () => {
          l1Player.clearPlaylist();
        });
      },
    }));

    ngApp.directive('removeFromPlaylist', () => ({
      restrict: 'EA',
      scope: {
        song: '=removeFromPlaylist',
      },
      link(scope, element, attrs) {
        element.bind('click', () => {
          l1Player.removeTrack(attrs.index);
        });
      },
    }));

    ngApp.directive('playPauseToggle', () => ({
      restrict: 'EA',
      link(scope, element) {
        element.bind('click', () => {
          l1Player.togglePlayPause();
        });
      },
    }));
  };

  if (!androidPlayback)
    addPlayerListener(mode, (msg, sender, res) => {
      if (msg.type === 'BG_PLAYER:FRAME_UPDATE') {
        l1Player.status.playing = {
          ...l1Player.status.playing,
          ...msg.data,
        };
      } else if (msg.type === 'BG_PLAYER:PLAYLIST') {
        l1Player.status.playlist = msg.data || [];
      } else if (msg.type === 'BG_PLAYER:PLAY_NEXT_QUEUE') {
        l1Player.status.playNextQueue = msg.data || [];
        localStorage.setObject('play-next-queue', msg.data || []);
      }
      if (res !== undefined) {
        res();
      }
    });

  if (androidPlayback && typeof window.addEventListener === 'function') {
    window.addEventListener('pagehide', () => androidPlayback.detach(), {
      once: true,
    });
  }

  window.l1Player = l1Player;
}
