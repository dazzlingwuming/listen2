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
  let nativeCurrentTrack = null;
  let nativeSelectedTrackId = '';
  const nativePageEpoch = Math.floor(Date.now() % 2147483647);
  let l1Player;

  const nativeTrackSelection = (track) => {
    const id = String(track && track.id ? track.id : '');
    const parts = /^bitrack_v_(BV[0-9A-Za-z]{6,32})-(\d+)$/.exec(id);
    const title =
      typeof (track && track.title) === 'string' ? track.title.trim() : '';
    const artist =
      typeof (track && track.artist) === 'string' ? track.artist.trim() : '';
    const durationMs = Math.max(
      0,
      Math.round(Number(track && track.duration) * 1000) || 0
    );
    if (
      !parts ||
      !title ||
      !artist ||
      title.length > 256 ||
      artist.length > 256
    )
      return null;
    return {
      source: 'bilibili',
      bvid: parts[1],
      cid: Number(parts[2]),
      title,
      artist,
      durationMs,
      mediaKind: 'audio',
    };
  };

  const nativeCommand = (command, payload) => {
    if (!androidPlayback) return Promise.resolve();
    return androidPlayback.command(command, payload).catch(() => null);
  };

  const nativeSelect = (track, action, playWhenReady) => {
    const selection = nativeTrackSelection(track);
    if (!androidPlayback || !selection) return Promise.resolve(null);
    nativeLogicalTracks.set(track.id, track);
    return androidPlayback
      .prepareSelection(selection)
      .then((prepared) =>
        androidPlayback.selectPrepared(prepared, { action, playWhenReady })
      )
      .then((snapshot) => {
        if (action === 'replace-current') {
          nativeCurrentTrack = track;
          nativeSelectedTrackId = track.id;
        }
        return snapshot;
      })
      .catch(() => null);
  };

  const syncNativeSnapshot = (snapshot) => {
    if (!snapshot || !androidPlayback) return;
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
    play() {
      if (androidPlayback) {
        if (
          nativeCurrentTrack &&
          nativeSelectedTrackId !== nativeCurrentTrack.id
        ) {
          nativeSelect(nativeCurrentTrack, 'replace-current', true);
        } else {
          nativeCommand('play', {});
        }
        return;
      }
      getPlayerAsync(mode, (player) => {
        player.play();
      });
    },
    pause() {
      if (androidPlayback) {
        nativeCommand('pause', {});
        return;
      }
      getPlayerAsync(mode, (player) => {
        player.pause();
      });
    },
    togglePlayPause() {
      if (androidPlayback) {
        nativeCommand(
          androidPlayback.getPlaybackSnapshot() &&
            androidPlayback.getPlaybackSnapshot().state === 'playing'
            ? 'pause'
            : 'play',
          {}
        );
        return;
      }
      getPlayerAsync(mode, (player) => {
        if (player.playing) {
          player.pause();
        } else {
          player.play();
        }
      });
    },
    playById(id) {
      if (androidPlayback) {
        nativeSelect(nativeLogicalTracks.get(id), 'replace-current', true);
        return;
      }
      getPlayerAsync(mode, (player) => {
        player.playById(id);
      });
    },
    loadById(idx) {
      if (androidPlayback) {
        nativeSelect(nativeLogicalTracks.get(idx), 'replace-current', false);
        return;
      }
      getPlayerAsync(mode, (player) => {
        player.loadById(idx);
      });
    },
    seek(per) {
      if (androidPlayback) {
        const snapshot = androidPlayback.getPlaybackSnapshot();
        const positionMs = Math.max(
          0,
          Math.round(Number(per) * Number(snapshot && snapshot.durationMs)) || 0
        );
        nativeCommand('seek', { positionMs });
        return;
      }
      getPlayerAsync(mode, (player) => {
        player.seek(per);
      });
    },
    next() {
      if (androidPlayback) {
        nativeCommand('next', {});
        return;
      }
      getPlayerAsync(mode, (player) => {
        player.skip('next');
      });
    },
    prev() {
      if (androidPlayback) {
        nativeCommand('previous', {});
        return;
      }
      getPlayerAsync(mode, (player) => {
        player.skip('prev');
      });
    },
    random() {
      if (androidPlayback) {
        nativeCommand('next', {});
        return;
      }
      getPlayerAsync(mode, (player) => {
        player.skip('random');
      });
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
          nativeCommand('mode', { mode: modeByInput[input] });
        return;
      }
      getPlayerAsync(mode, (player) => {
        // eslint-disable-next-line no-param-reassign
        player.loop_mode = input;
      });
    },
    mute() {
      if (androidPlayback) {
        nativeCommand('mute', { muted: true });
        return;
      }
      getPlayerAsync(mode, (player) => {
        player.mute();
      });
    },
    unmute() {
      if (androidPlayback) {
        nativeCommand('mute', { muted: false });
        return;
      }
      getPlayerAsync(mode, (player) => {
        player.unmute();
      });
    },
    toggleMute() {
      if (androidPlayback) {
        const snapshot = androidPlayback.getPlaybackSnapshot();
        nativeCommand('mute', { muted: !(snapshot && snapshot.muted) });
        return;
      }
      getPlayerAsync(mode, (player) => {
        if (player.muted) player.unmute();
        else player.mute();
      });
    },
    setVolume(per) {
      if (androidPlayback) {
        nativeCommand('volume', {
          volumePercent: Math.max(
            0,
            Math.min(100, Math.round(Number(per) || 0))
          ),
        });
        return;
      }
      getPlayerAsync(mode, (player) => {
        // eslint-disable-next-line no-param-reassign
        player.volume = per / 100;
      });
    },
    adjustVolume(increase) {
      if (androidPlayback) {
        const snapshot = androidPlayback.getPlaybackSnapshot();
        const current = Number(snapshot && snapshot.volumePercent) || 0;
        nativeCommand('volume', {
          volumePercent: Math.max(
            0,
            Math.min(100, current + (increase ? 10 : -10))
          ),
        });
        return;
      }
      getPlayerAsync(mode, (player) => {
        player.adjustVolume(increase);
      });
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
        nativeSelect(track, 'enqueue-next', false);
        return;
      }
      getPlayerAsync(mode, (player) => {
        player.enqueueNext(track);
      });
    },
    removePlayNextQueueEntry(queueId) {
      if (androidPlayback) {
        nativeCommand('remove', { occurrenceId: queueId });
        return;
      }
      getPlayerAsync(mode, (player) => {
        player.removePlayNextQueueEntry(queueId);
      });
    },
    movePlayNextQueueEntry(queueId, targetIndex) {
      if (androidPlayback) {
        nativeCommand('reorder', { occurrenceId: queueId, targetIndex });
        return;
      }
      getPlayerAsync(mode, (player) => {
        player.movePlayNextQueueEntry(queueId, targetIndex);
      });
    },
    clearPlayNextQueue() {
      if (androidPlayback) {
        nativeCommand('clear', {});
        return;
      }
      getPlayerAsync(mode, (player) => {
        player.clearPlayNextQueue();
      });
    },
    insertTrack(track, to_track, direction) {
      if (androidPlayback) {
        nativeSelect(track, 'enqueue-next', false);
        return;
      }
      getPlayerAsync(mode, (player) => {
        player.insertAudioByDirection(track, to_track, direction);
      });
    },
    removeTrack(index) {
      if (androidPlayback) {
        const queue = l1Player.status.playNextQueue || [];
        const entry = queue[Number(index)];
        if (entry) nativeCommand('remove', { occurrenceId: entry.queueId });
        return;
      }
      getPlayerAsync(mode, (player) => {
        player.removeAudio(index);
      });
    },
    addTracks(list) {
      if (androidPlayback) {
        (Array.isArray(list) ? list : []).forEach((track) =>
          nativeSelect(track, 'enqueue-next', false)
        );
        return;
      }
      getPlayerAsync(mode, (player) => {
        player.appendAudioList(list);
      });
    },
    clearPlaylist() {
      if (androidPlayback) {
        nativeCommand('clear', {});
        return;
      }
      getPlayerAsync(mode, (player) => {
        player.clearPlaylist();
      });
    },
    setNewPlaylist(list) {
      if (androidPlayback) {
        nativeLogicalTracks.clear();
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
        androidPlayback
          .connect({
            pageEpoch: nativePageEpoch,
            onSnapshot: syncNativeSnapshot,
          })
          .promise.catch(() => {});
        return;
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
