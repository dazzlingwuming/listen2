/* eslint-disable no-param-reassign */
/* eslint-disable no-unused-vars */
/* global getParameterByName */
const defaultLocalMusicPlaylist = {
  tracks: [],
  info: {
    id: 'lmplaylist_reserve',
    cover_img_url: 'images/mycover.jpg',
    title: '本地音乐',
    source_url: '',
  },
};

class localmusic {
  static show_playlist(url, hm) {
    return {
      success: (fn) =>
        fn({
          result: [],
        }),
    };
  }

  static lm_get_playlist(url) {
    const list_id = getParameterByName('list_id', url);
    return {
      success: (fn) => {
        let playlist = localStorage.getObject(list_id);

        if (playlist === null || playlist === undefined) {
          playlist = defaultLocalMusicPlaylist;
        }
        fn(playlist);
      },
    };
  }

  static lm_album(url) {
    const album = getParameterByName('list_id', url).split('_').pop();
    return {
      success: (fn) => {
        const list_id = 'lmplaylist_reserve';
        let playlist = localStorage.getObject(list_id);

        if (playlist === null || playlist === undefined) {
          playlist = JSON.parse(JSON.stringify(defaultLocalMusicPlaylist));
          playlist.info.title = album;
        } else {
          playlist.info.title = album;
          playlist.tracks = playlist.tracks.filter((tr) => tr.album === album);
        }
        fn(playlist);
      },
    };
  }

  static lm_artist(url) {
    const artist = getParameterByName('list_id', url).split('_').pop();
    return {
      success: (fn) => {
        const list_id = 'lmplaylist_reserve';
        let playlist = localStorage.getObject(list_id);

        if (playlist === null || playlist === undefined) {
          playlist = JSON.parse(JSON.stringify(defaultLocalMusicPlaylist));
          playlist.info.title = artist;
        } else {
          playlist.info.title = artist;
          playlist.tracks = playlist.tracks.filter(
            (tr) => tr.artist === artist
          );
        }
        fn(playlist);
      },
    };
  }

  static bootstrap_track(track, success, failure) {
    const sound = {};
    sound.url = track.sound_url;
    sound.platform = 'localmusic';

    success(sound);
  }

  static get_android_http_adapter() {
    if (typeof window === 'undefined') return null;
    const adapter = window.Listen2AndroidHttpAdapter;
    if (
      !adapter ||
      typeof adapter.isAvailable !== 'function' ||
      typeof adapter.request !== 'function'
    ) {
      return null;
    }
    try {
      return adapter.isAvailable() ? adapter : null;
    } catch (error) {
      return null;
    }
  }

  static create_android_lyric_facade(handle) {
    const promise = handle.promise
      .then((response) => {
        const result = response && response.result;
        if (!result || typeof result !== 'object' || Array.isArray(result)) {
          throw new Error('Android local lyric response was invalid.');
        }
        if (result.status !== 'found' && result.status !== 'no-lyric') {
          throw new Error('Android local lyric status was invalid.');
        }
        return {
          lyric: typeof result.lyric === 'string' ? result.lyric : '',
          tlyric: typeof result.tlyric === 'string' ? result.tlyric : '',
          source: 'localmusic',
          status: result.status,
        };
      })
      .catch((error) => ({
        lyric: '',
        tlyric: '',
        error: {
          status:
            error && typeof error.code === 'string'
              ? error.code
              : 'android-rpc-local-lyric-unavailable',
          message: 'Local lyrics are unavailable on this Android device.',
        },
      }));
    return {
      requestId: handle.requestId,
      pageEpoch: handle.pageEpoch,
      cancel: handle.cancel,
      promise,
      then: promise.then.bind(promise),
      catch: promise.catch.bind(promise),
      success: (fn) => promise.then(fn),
    };
  }

  static lyric(url, options = {}) {
    const track_id = getParameterByName('track_id', url);
    const androidHttp = this.get_android_http_adapter();
    if (androidHttp && /^local\.track\.[a-f0-9]{64}$/.test(track_id || '')) {
      return this.create_android_lyric_facade(
        androidHttp.request(
          'local.lyric.primary',
          { localTrackId: track_id },
          {
            pageEpoch: Number.isInteger(options.pageEpoch)
              ? options.pageEpoch
              : 0,
          }
        )
      );
    }
    const playlist = localStorage.getObject('lmplaylist_reserve');
    const track =
      playlist && Array.isArray(playlist.tracks)
        ? playlist.tracks.find((item) => item.id === track_id)
        : null;
    let lyric = '';
    if (track && track.lyrics !== undefined) {
      [lyric] = track.lyrics;
    }
    return {
      success: (fn) =>
        fn({
          lyric,
          tlyric: '',
        }),
    };
  }

  static add_playlist(list_id, tracks) {
    if (typeof tracks === 'string') {
      tracks = JSON.parse(tracks);
    }
    let playlist = localStorage.getObject(list_id);
    if (playlist === null) {
      playlist = JSON.parse(JSON.stringify(defaultLocalMusicPlaylist));
    }
    const tracksIdSet = {};
    tracks.forEach((tr) => {
      tracksIdSet[tr.id] = true;
    });
    playlist.tracks = tracks.concat(
      playlist.tracks.filter((tr) => tracksIdSet[tr.id] !== true)
    );
    localStorage.setObject(list_id, playlist);

    return {
      success: (fn) => fn({ list_id, playlist }),
    };
  }

  static parse_url(url) {
    let result;
    return {
      success: (fn) => {
        fn(result);
      },
    };
  }

  static get_playlist(url) {
    const list_id = getParameterByName('list_id', url).split('_')[0];
    switch (list_id) {
      case 'lmplaylist':
        return this.lm_get_playlist(url);
      case 'lmartist':
        return this.lm_artist(url);
      case 'lmalbum':
        return this.lm_album(url);
      default:
        return null;
    }
  }

  static remove_from_playlist(list_id, track_id) {
    const playlist = localStorage.getObject(list_id);
    if (playlist == null) {
      return;
    }
    const newtracks = playlist.tracks.filter((item) => item.id !== track_id);
    playlist.tracks = newtracks;
    localStorage.setObject(list_id, playlist);

    // eslint-disable-next-line consistent-return
    return {
      success: (fn) => fn(),
    };
  }

  static get_playlist_filters() {
    return {
      success: (fn) => fn({ recommend: [], all: [] }),
    };
  }

  // return {
  //   show_playlist: lm_show_playlist,
  //   get_playlist_filters,
  //   get_playlist,
  //   parse_url: lm_parse_url,
  //   bootstrap_track: lm_bootstrap_track,
  //   search: lm_search,
  //   lyric: lm_lyric,
  //   add_playlist: lm_add_playlist,
  //   remove_from_playlist: lm_remove_from_playlist,
  // };
}
