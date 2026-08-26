/* eslint-disable import/no-unresolved */
/* eslint-disable import/no-extraneous-dependencies */
/* eslint-disable global-require */
/* eslint-disable no-shadow */
/* eslint-disable no-unused-vars */
/* eslint-disable no-param-reassign */
/* global angular notyf i18next MediaService l1Player hotkeys isElectron require GithubClient lastfm playlistBackup */
// control main view of page, it can be called any place
angular.module('listenone').controller('NavigationController', [
  '$scope',
  '$timeout',
  '$rootScope',
  ($scope, $timeout, $rootScope) => {
    $rootScope.page_title = { title: 'Listen 1', artist: '', status: '' }; // eslint-disable-line no-param-reassign
    $scope.window_url_stack = [];
    $scope.window_poped_url_stack = [];
    $scope.current_tag = 2;
    $scope.is_window_hidden = 1;
    $scope.is_dialog_hidden = 1;
    $scope.tag_params = {};

    $scope.songs = [];
    $scope.current_list_id = -1;

    $scope.dialog_song = '';
    $scope.dialog_type = 0;
    $scope.dialog_title = '';
    $scope.playlistBackupImportLoading = false;
    $scope.playlistBackupFileLoading = false;
    $scope.gistRestoreLoading = false;
    $scope.pendingPlaylistBackup = null;
    let gistRestoreRequestId = 0;
    let backupDialogRequestId = 0;

    $scope.isDoubanLogin = false;

    $scope.lastfm = lastfm;

    $scope.isOpenSidebar = true;

    $scope.$on('bilibili-auth:open-dialog', () => {
      $scope.showDialog(13, 'bilibili');
    });

    $scope.$on('bilibili-auth:login-success', () => {
      $scope.closeDialog();
    });

    $scope.$on('auth:open-login-dialog', (event, source) => {
      $scope.showDialog(11, source);
    });

    $scope.$on('isdoubanlogin:update', (event, data) => {
      $scope.isDoubanLogin = data;
    });

    // isOpenSidebar

    if (localStorage.getObject('openSidebar') !== null) {
      $scope.isOpenSidebar = localStorage.getObject('openSidebar');
    }
    $scope.openSidebar = () => {
      $scope.isOpenSidebar = !$scope.isOpenSidebar;
      localStorage.setObject('openSidebar', $scope.isOpenSidebar);
    };
    // tag
    $scope.showTag = (tag_id, tag_params) => {
      $scope.current_tag = tag_id;
      $scope.is_window_hidden = 1;
      $scope.window_url_stack = [];
      $scope.window_poped_url_stack = [];
      $scope.tag_params = tag_params;
      if (tag_id === 6) {
        $rootScope.$broadcast('myplatform:update', tag_params.user);
      }
      $scope.closeWindow();
    };

    $scope.$on('search:keyword_change', (event, data) => {
      $scope.showTag(3);
    });

    // playlist window
    $scope.resetWindow = (offset) => {
      if (offset === undefined) {
        offset = 0;
      }
      $scope.cover_img_url = 'images/loading.svg';
      $scope.playlist_title = '';
      $scope.playlist_source_url = '';
      $scope.songs = [];
      $scope.window_type = 'list';
      $timeout(() => {
        document.getElementsByClassName('browser')[0].scrollTop = offset;
      }, 0);
    };

    const hydrateVisibleTrackDurations = (listId, tracks) => {
      if (
        !MediaService ||
        typeof MediaService.hydrateTrackDurations !== 'function'
      ) {
        return;
      }
      MediaService.hydrateTrackDurations(listId, tracks)
        .then((hydratedTracks) => {
          if ($scope.list_id !== listId) return;
          $scope.$evalAsync(() => {
            $scope.songs = hydratedTracks;
          });
        })
        .catch(() => {});
    };

    $scope.closeWindow = (offset) => {
      if (offset === undefined) {
        offset = 0;
      }
      $scope.is_window_hidden = 1;
      $scope.resetWindow(offset);
      $scope.window_url_stack = [];
      $scope.window_poped_url_stack = [];
    };

    function refreshWindow(url, offset = 0) {
      if (url === '/now_playing') {
        $scope.window_type = 'track';
        return;
      }
      const listId = new URL(url, window.location).searchParams.get('list_id');
      MediaService.getPlaylist(listId).success((data) => {
        $scope.songs = data.tracks;
        $scope.list_id = data.info.id;
        $scope.cover_img_url = data.info.cover_img_url;
        $scope.playlist_title = data.info.title;
        $scope.playlist_source_url = data.info.source_url;
        $scope.is_mine = data.info.id.slice(0, 2) === 'my';
        $scope.is_local = data.info.id.slice(0, 2) === 'lm';
        hydrateVisibleTrackDurations(data.info.id, data.tracks);
        $timeout(() => {
          document.getElementsByClassName('browser')[0].scrollTop = offset;
        }, 0);
      });
    }
    $scope.popWindow = () => {
      if ($scope.window_url_stack.length === 0) {
        return;
      }
      let poped = $scope.window_url_stack.pop();
      if ($scope.getCurrentUrl() === '/now_playing') {
        poped = $scope.window_url_stack.pop();
      }
      $scope.window_poped_url_stack.push(poped.url);
      if ($scope.window_url_stack.length === 0) {
        $scope.closeWindow(poped.offset);
      } else {
        $scope.resetWindow(poped.offset);
        const lastWindow = $scope.window_url_stack.slice(-1)[0];
        refreshWindow(lastWindow.url, poped.offset);
      }
    };

    $scope.toggleNowPlaying = () => {
      if ($scope.getCurrentUrl() === '/now_playing') {
        $scope.popWindow();
        return;
      }
      if (!$scope.menuHidden) {
        $scope.togglePlaylist();
      }
      // save current scrolltop
      $scope.is_window_hidden = 0;
      $scope.resetWindow();

      $scope.window_url_stack.push({
        url: '/now_playing',
        offset: document.getElementsByClassName('browser')[0].scrollTop,
      });
      $scope.window_poped_url_stack = [];

      $scope.window_type = 'track';
    };

    $scope.forwardWindow = () => {
      if ($scope.window_poped_url_stack.length === 0) {
        return;
      }

      $scope.resetWindow();
      const url = $scope.window_poped_url_stack.pop();
      $scope.window_url_stack.push({
        url,
        offset: 0,
      });
      refreshWindow(url);
    };

    $scope.getCurrentUrl = () =>
      ($scope.window_url_stack.slice(-1)[0] || {}).url;

    $scope.showPlaylist = (list_id, useCache) => {
      $scope.clearFilter();
      const url = `/playlist?list_id=${list_id}`;
      // save current scrolltop
      const offset = document.getElementsByClassName('browser')[0].scrollTop;
      if ($scope.getCurrentUrl() === url) {
        return;
      }
      $scope.is_window_hidden = 0;
      $scope.resetWindow();

      if ($scope.getCurrentUrl() === '/now_playing') {
        // if now playing is top, pop it
        $scope.window_url_stack.pop();
      }
      $scope.window_url_stack.push({ url, offset });
      $scope.window_poped_url_stack = [];

      const listId = new URL(url, window.location).searchParams.get('list_id');
      MediaService.getPlaylist(listId, useCache).success((data) => {
        if (data.status === '0') {
          notyf.info(data.reason);
          $scope.popWindow();
          return;
        }
        $scope.songs = data.tracks;
        $scope.cover_img_url = data.info.cover_img_url;
        $scope.playlist_title = data.info.title;
        $scope.playlist_source_url = data.info.source_url;
        $scope.list_id = data.info.id;
        $scope.is_mine = data.info.id.slice(0, 2) === 'my';
        $scope.is_local = data.info.id.slice(0, 2) === 'lm';
        hydrateVisibleTrackDurations(data.info.id, data.tracks);

        MediaService.queryPlaylist(data.info.id, 'favorite').success((res) => {
          // success 函数可能在异步回调中执行，需要手动触发脏检查
          $timeout(() => {
            $scope.is_favorite = res.result;
          }, 0);
        });

        $scope.window_type = 'list';
      });
    };

    $scope.directplaylist = (list_id) => {
      MediaService.getPlaylist(list_id).success((data) => {
        $scope.songs = data.tracks;
        $scope.list_id = data.info.id;
        $scope.current_list_id = list_id;
        hydrateVisibleTrackDurations(data.info.id, data.tracks);
        l1Player.setNewPlaylist($scope.songs);
        l1Player.play();
      });
    };

    $scope.showDialog = (dialog_type, data) => {
      $scope.is_dialog_hidden = 0;
      $scope.dialog_data = data;
      const dialogWidth = 400;
      const dialogHeight = 430;
      const left = window.innerWidth / 2 - dialogWidth / 2;
      const top = window.innerHeight / 2 - dialogHeight / 2;

      $scope.myStyle = {
        left: `${left}px`,
        top: `${top}px`,
      };
      $scope.dialog_type = dialog_type;
      if (dialog_type === 0) {
        $scope.dialog_title = i18next.t('_ADD_TO_PLAYLIST');
        $scope.dialog_song = data;
        MediaService.showMyPlaylist().success((res) => {
          $scope.myplaylist = res.result;
        });
      }

      // if (dialog_type === 2) {
      //   $scope.dialog_title = '登录豆瓣';
      //   $scope.dialog_type = 2;
      // }

      if (dialog_type === 3) {
        $scope.dialog_title = i18next.t('_EDIT_PLAYLIST');
        $scope.dialog_cover_img_url = data.cover_img_url;
        $scope.dialog_playlist_title = data.playlist_title;
      }
      if (dialog_type === 4) {
        $scope.dialog_title = i18next.t('_CONNECT_TO_LASTFM');
      }
      if (dialog_type === 5) {
        $scope.dialog_title = i18next.t('_OPEN_PLAYLIST');
      }
      if (dialog_type === 6) {
        $scope.dialog_title = i18next.t('_IMPORT_PLAYLIST');
        MediaService.showMyPlaylist().success((res) => {
          $scope.myplaylist = res.result;
        });
      }
      if (dialog_type === 7) {
        $scope.dialog_title = i18next.t('_CONNECT_TO_GITHUB');
      }
      if (dialog_type === 8) {
        $scope.dialog_title = i18next.t('_EXPORT_TO_GITHUB_GIST');
        GithubClient.gist.listExistBackup().then(
          (res) => {
            $scope.myBackup = res;
          },
          (err) => {
            $scope.myBackup = [];
          }
        );
      }
      if (dialog_type === 10) {
        $scope.dialog_title = i18next.t('_RECOVER_FROM_GITHUB_GIST');
        backupDialogRequestId += 1;
        const requestId = backupDialogRequestId;
        GithubClient.gist.listExistBackup().then(
          (res) => {
            if (
              $scope.dialog_type !== 10 ||
              requestId !== backupDialogRequestId
            ) {
              return;
            }
            $scope.myBackup = res;
          },
          () => {
            if (
              $scope.dialog_type !== 10 ||
              requestId !== backupDialogRequestId
            ) {
              return;
            }
            $scope.myBackup = [];
          }
        );
      }
      if (dialog_type === 14) {
        $scope.dialog_title = i18next.t('_RECOVER_OVERWRITE_TITLE');
      }
      if (dialog_type === 11) {
        $scope.dialog_title = i18next.t('_LOGIN');
      }
      if (dialog_type === 12) {
        $scope.dialog_title = i18next.t('_PROXY_CONFIG');
      }
      if (dialog_type === 13) {
        $scope.dialog_title = '哔哩哔哩扫码登录';
      }
    };

    $scope.onSidebarPlaylistDrop = (
      playlistType,
      list_id,
      data,
      dataType,
      direction
    ) => {
      if (playlistType === 'my' && dataType === 'application/listen1-song') {
        $scope.addMyPlaylist(list_id, data);
      } else if (
        (playlistType === 'my' &&
          dataType === 'application/listen1-myplaylist') ||
        (playlistType === 'favorite' &&
          dataType === 'application/listen1-favoriteplaylist')
      ) {
        MediaService.insertMyplaylistToMyplaylists(
          playlistType,
          data.info.id,
          list_id,
          direction
        ).success(() => {
          if (playlistType === 'my') {
            $rootScope.$broadcast('myplaylist:update');
          }
          if (playlistType === 'favorite') {
            $rootScope.$broadcast('favoriteplaylist:update');
          }
        });
      }
    };
    $scope.playlistFilter = { key: '' };

    $scope.clearFilter = () => {
      $scope.playlistFilter.key = '';
    };
    $scope.fieldFilter = (song) => {
      if ($scope.playlistFilter.key === '') {
        return true;
      }
      return (
        song.title.includes($scope.playlistFilter.key) ||
        song.artist.includes($scope.playlistFilter.key) ||
        (song.album && song.album.includes($scope.playlistFilter.key))
      );
    };
    $scope.onPlaylistSongDrop = (list_id, song, data, dataType, direction) => {
      if (dataType === 'application/listen1-song') {
        // insert song
        MediaService.insertTrackToMyPlaylist(
          list_id,
          data,
          song,
          direction
        ).success((playlist) => {
          $scope.closeDialog();
          if (list_id === $scope.list_id) {
            $scope.$evalAsync(() => {
              $scope.songs = playlist.tracks;
            });
          }
        });
      }
    };

    $scope.onCurrentPlayingSongDrop = (song, data, dataType, direction) => {
      if (dataType === 'application/listen1-song') {
        l1Player.insertTrack(data, song, direction);
      }
    };

    $scope.playById = (id) => {
      l1Player.playById(id);
    };

    $scope.addAndPlay = (song) => {
      l1Player.addTrack(song);
      l1Player.playById(song.id);
    };

    $scope.addMyPlaylist = (option_id, song) => {
      MediaService.addMyPlaylist(option_id, song).success((playlist) => {
        notyf.success(i18next.t('_ADD_TO_PLAYLIST_SUCCESS'));
        $scope.closeDialog();
        // add to current playing list
        if (option_id === $scope.current_list_id) {
          l1Player.addTrack($scope.dialog_song);
        }
        if (option_id === $scope.list_id) {
          $scope.songs = playlist.tracks;
        }
      });
    };

    $scope.chooseDialogOption = (option_id) => {
      $scope.addMyPlaylist(option_id, $scope.dialog_song);
    };

    $scope.newDialogOption = (option) => {
      $scope.dialog_type = option;
    };

    $scope.cancelNewDialog = (option) => {
      $scope.dialog_type = option;
    };

    $scope.createAndAddPlaylist = () => {
      MediaService.createMyPlaylist(
        $scope.newlist_title,
        $scope.dialog_song
      ).success(() => {
        $rootScope.$broadcast('myplaylist:update');
        notyf.success(i18next.t('_ADD_TO_PLAYLIST_SUCCESS'));
        $scope.closeDialog();
      });
    };

    $scope.editMyPlaylist = () => {
      MediaService.editMyPlaylist(
        $scope.list_id,
        $scope.dialog_playlist_title,
        $scope.dialog_cover_img_url
      ).success(() => {
        $rootScope.$broadcast('myplaylist:update');
        $scope.playlist_title = $scope.dialog_playlist_title;
        $scope.cover_img_url = $scope.dialog_cover_img_url;
        notyf.success(i18next.t('_EDIT_PLAYLIST_SUCCESS'));
        $scope.closeDialog();
      });
    };

    $scope.mergePlaylist = (target_list_id) => {
      notyf.info(i18next.t('_IMPORTING_PLAYLIST'));
      MediaService.mergePlaylist($scope.list_id, target_list_id).success(() => {
        notyf.success(i18next.t('_IMPORTING_PLAYLIST_SUCCESS'));
        $scope.closeDialog();
        $scope.popWindow();
        $scope.showPlaylist($scope.list_id);
      });
    };

    $scope.removeSongFromPlaylist = (song, list_id) => {
      let removeFunc = null;
      if (list_id.slice(0, 2) === 'my') {
        removeFunc = MediaService.removeTrackFromMyPlaylist;
      } else if (list_id.slice(0, 2) === 'lm') {
        removeFunc = MediaService.removeTrackFromPlaylist;
      }

      removeFunc(list_id, song.id).success(() => {
        // remove song from songs
        const index = $scope.songs.indexOf(song);
        if (index > -1) {
          $scope.songs.splice(index, 1);
        }
        notyf.success(i18next.t('_REMOVE_SONG_FROM_PLAYLIST_SUCCESS'));
      });
    };

    $scope.closeDialog = () => {
      const closingDialogType = $scope.dialog_type;
      $scope.is_dialog_hidden = 1;
      $scope.dialog_type = 0;
      if (closingDialogType === 10) {
        gistRestoreRequestId += 1;
        $scope.gistRestoreLoading = false;
      }
      if (closingDialogType === 14) {
        $scope.pendingPlaylistBackup = null;
      }
      if (closingDialogType === 13) {
        $scope.$emit('bilibili-auth:dialog-closed');
      }
      // update lastfm status if not authorized
      if (lastfm.isAuthRequested()) {
        lastfm.updateStatus();
      }
    };

    $scope.setCurrentList = (list_id) => {
      $scope.current_list_id = list_id;
    };

    $scope.playMylist = (list_id) => {
      l1Player.setNewPlaylist($scope.songs);
      l1Player.play();
      $scope.setCurrentList(list_id);
    };

    $scope.addMylist = (list_id) => {
      $timeout(() => {
        // add songs to playlist
        l1Player.addTracks($scope.songs);
        notyf.success(i18next.t('_ADD_TO_QUEUE_SUCCESS'));
      }, 0);
    };

    $scope.clonePlaylist = (list_id) => {
      MediaService.clonePlaylist(list_id, 'my').success(() => {
        $rootScope.$broadcast('myplaylist:update');
        $scope.closeWindow();
        notyf.success(i18next.t('_ADD_TO_PLAYLIST_SUCCESS'));
      });
    };

    $scope.removeMyPlaylist = (list_id) => {
      MediaService.removeMyPlaylist(list_id, 'my').success(() => {
        $rootScope.$broadcast('myplaylist:update');
        $scope.closeDialog();
        $scope.closeWindow();
        notyf.success(i18next.t('_REMOVE_PLAYLIST_SUCCESS'));
      });
    };

    $scope.downloadFile = (fileName, fileType, content) => {
      window.URL = window.URL || window.webkitURL;
      const blob = new Blob([content], {
        type: fileType,
      });
      const link = document.createElement('a');
      link.download = fileName;
      link.href = window.URL.createObjectURL(blob);
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      link.remove();
    };

    function getPlaylistBackupApi() {
      if (
        typeof playlistBackup === 'undefined' ||
        !playlistBackup ||
        typeof playlistBackup.createBackup !== 'function' ||
        typeof playlistBackup.importBackup !== 'function'
      ) {
        throw new Error(i18next.t('_PLAYLIST_BACKUP_IMPORT_FAILED'));
      }
      return playlistBackup;
    }

    function backupSummaryValue(summary, name) {
      const value = Number((summary || {})[name]);
      return Number.isFinite(value) ? value : 0;
    }

    function getMaxPlaylistBackupBytes() {
      const backupApi = getPlaylistBackupApi();
      const configuredLimit = Number(backupApi.MAX_BACKUP_BYTES);
      return Number.isFinite(configuredLimit) && configuredLimit > 0
        ? configuredLimit
        : 5 * 1024 * 1024;
    }

    function getPlaylistBackupFailureMessage(error) {
      if (
        error &&
        (error.code === 'BACKUP_ROLLBACK_FAILED' ||
          (Array.isArray(error.rollbackErrors) &&
            error.rollbackErrors.length > 0))
      ) {
        return i18next.t('_PLAYLIST_BACKUP_PARTIAL_WRITE_FAILURE');
      }
      return error && error.message
        ? `${i18next.t('_PLAYLIST_BACKUP_IMPORT_FAILED')} ${error.message}`
        : i18next.t('_PLAYLIST_BACKUP_IMPORT_FAILED');
    }

    function showPlaylistBackupSummary(summary) {
      notyf.success(
        i18next.t('_PLAYLIST_BACKUP_IMPORT_SUMMARY', {
          added: backupSummaryValue(summary, 'added'),
          skipped: backupSummaryValue(summary, 'skipped'),
          conflicts: backupSummaryValue(summary, 'conflicts'),
          favorites: backupSummaryValue(summary, 'favorites'),
        })
      );
    }

    function importPlaylistBackup(data, mode) {
      if ($scope.playlistBackupImportLoading) {
        return false;
      }

      $scope.playlistBackupImportLoading = true;
      notyf.info(i18next.t('_IMPORTING_PLAYLIST'));
      try {
        const summary = getPlaylistBackupApi().importBackup(
          localStorage,
          data,
          {
            mode,
          }
        );
        $rootScope.$broadcast('myplaylist:update');
        $rootScope.$broadcast('favoriteplaylist:update');
        notyf.dismissAll();
        showPlaylistBackupSummary(summary);
        return true;
      } catch (error) {
        notyf.dismissAll();
        notyf.error(getPlaylistBackupFailureMessage(error));
        return false;
      } finally {
        $scope.playlistBackupImportLoading = false;
      }
    }

    function preparePlaylistBackupReplace(data, source) {
      $scope.pendingPlaylistBackup = { data, source };
      $scope.showDialog(14, $scope.pendingPlaylistBackup);
    }

    $scope.confirmPlaylistBackupReplace = () => {
      const pending = $scope.pendingPlaylistBackup;
      if (!pending || !pending.data) {
        $scope.closeDialog();
        return;
      }
      $scope.pendingPlaylistBackup = null;
      $scope.closeDialog();
      importPlaylistBackup(pending.data, 'replace');
    };

    $scope.cancelPlaylistBackupReplace = () => {
      $scope.pendingPlaylistBackup = null;
      $scope.closeDialog();
    };

    $scope.backupMySettings = () => {
      let backup = null;
      try {
        backup = getPlaylistBackupApi().createBackup(localStorage);
      } catch (error) {
        notyf.warning(i18next.t('_PLAYLIST_BACKUP_IMPORT_FAILED'));
        return;
      }

      const content = JSON.stringify(backup);
      $scope.downloadFile('listen1_backup.json', 'application/json', content);
    };

    $scope.importMySettings = (event) => {
      const fileObject = event.target.files[0];
      const mode = event.target.dataset.backupImportMode || 'merge';
      event.target.value = '';
      if (!fileObject || $scope.playlistBackupFileLoading) {
        return;
      }
      let maxBackupBytes = 0;
      try {
        maxBackupBytes = getMaxPlaylistBackupBytes();
      } catch (error) {
        notyf.error(getPlaylistBackupFailureMessage(error));
        return;
      }
      if (fileObject.size > maxBackupBytes) {
        notyf.warning(
          i18next.t('_PLAYLIST_BACKUP_FILE_TOO_LARGE', {
            maxSize: Math.floor(maxBackupBytes / (1024 * 1024)),
          })
        );
        return;
      }
      $scope.playlistBackupFileLoading = true;
      const reader = new FileReader();
      let fileReadFailed = false;
      reader.onerror = () => {
        fileReadFailed = true;
        $scope.$evalAsync(() => {
          $scope.playlistBackupFileLoading = false;
          notyf.warning(i18next.t('_PLAYLIST_BACKUP_FILE_READ_FAILED'));
        });
      };
      reader.onloadend = (readerEvent) => {
        $scope.$evalAsync(() => {
          $scope.playlistBackupFileLoading = false;
          if (
            fileReadFailed ||
            readerEvent.target.readyState !== FileReader.DONE
          ) {
            return;
          }
          let data = null;
          try {
            data = JSON.parse(readerEvent.target.result);
          } catch (error) {
            notyf.warning(i18next.t('_PLAYLIST_BACKUP_FILE_INVALID'));
            return;
          }

          if (mode === 'replace') {
            preparePlaylistBackupReplace(data, 'local-file');
            return;
          }
          importPlaylistBackup(data, 'merge');
        });
      };
      reader.readAsText(fileObject);
    };

    $scope.gistBackupLoading = false;
    $scope.backupMySettings2Gist = (gistId, isPublic) => {
      let gistFiles = null;
      try {
        gistFiles = GithubClient.gist.json2gist(
          getPlaylistBackupApi().createBackup(localStorage)
        );
      } catch (error) {
        notyf.warning(i18next.t('_PLAYLIST_BACKUP_IMPORT_FAILED'));
        return;
      }
      $scope.gistBackupLoading = true;
      GithubClient.gist.backupMySettings2Gist(gistFiles, gistId, isPublic).then(
        () => {
          notyf.dismissAll();
          notyf.success('成功导出我的歌单到Gist');
          $scope.gistBackupLoading = false;
        },
        (err) => {
          notyf.dismissAll();
          notyf.warning('导出我的歌单失败，检查后重试');
          $scope.gistBackupLoading = false;
        }
      );
      notyf.info('正在导出我的歌单到Gist...');
    };

    $scope.importMySettingsFromGist = (gistId, mode = 'merge') => {
      if ($scope.gistRestoreLoading || $scope.playlistBackupImportLoading) {
        return;
      }
      gistRestoreRequestId += 1;
      const requestId = gistRestoreRequestId;
      $scope.gistRestoreLoading = true;
      GithubClient.gist
        .importMySettingsFromGist(gistId)
        .then((raw) => GithubClient.gist.gist2json(raw))
        .then((data) => {
          $scope.$evalAsync(() => {
            if (requestId !== gistRestoreRequestId) {
              return;
            }
            if (mode === 'replace') {
              preparePlaylistBackupReplace(data, 'gist');
              return;
            }
            importPlaylistBackup(data, 'merge');
          });
        })
        .catch((error) => {
          $scope.$evalAsync(() => {
            if (requestId !== gistRestoreRequestId) {
              return;
            }
            notyf.dismissAll();
            const status =
              error && error.response && Number(error.response.status);
            if (
              status === 404 ||
              (error && error.code === 'BACKUP_FILE_MISSING')
            ) {
              notyf.warning(i18next.t('_PLAYLIST_BACKUP_GIST_NOT_FOUND'));
              return;
            }
            if (
              error &&
              (error.code === 'INVALID_JSON' ||
                error.code === 'BACKUP_JSON_INVALID')
            ) {
              notyf.warning(i18next.t('_PLAYLIST_BACKUP_FILE_INVALID'));
              return;
            }
            notyf.warning(i18next.t('_PLAYLIST_BACKUP_GIST_FAILED'));
          });
        })
        .finally(() => {
          $scope.$evalAsync(() => {
            if (requestId === gistRestoreRequestId) {
              $scope.gistRestoreLoading = false;
            }
          });
        });
      notyf.info('正在从Gist导入我的歌单...');
    };

    $scope.showShortcuts = () => {};

    // description: '快速搜索',
    hotkeys('f', () => {
      $scope.showTag(3);
      $timeout(() => {
        document.getElementById('search-input').focus();
      }, 0);
    });

    $scope.openUrl = (url) => {
      MediaService.parseURL(url).success((data) => {
        const { result } = data;
        if (result !== undefined) {
          $scope.showPlaylist(result.id);
        } else {
          notyf.info(i18next.t('_FAIL_OPEN_PLAYLIST_URL'));
        }
      });
    };

    $scope.favoritePlaylist = (list_id) => {
      if ($scope.is_favorite) {
        $scope.removeFavoritePlaylist(list_id);
        $scope.is_favorite = 0;
      } else {
        $scope.addFavoritePlaylist(list_id);
        $scope.is_favorite = 1;
      }
    };
    $scope.addFavoritePlaylist = (list_id) => {
      MediaService.clonePlaylist(list_id, 'favorite').success((addResult) => {
        $rootScope.$broadcast('favoriteplaylist:update');
        notyf.success(i18next.t('_FAVORITE_PLAYLIST_SUCCESS'));
      });
    };

    $scope.removeFavoritePlaylist = (list_id) => {
      MediaService.removeMyPlaylist(list_id, 'favorite').success(() => {
        $rootScope.$broadcast('favoriteplaylist:update');
        // $scope.closeWindow();
        notyf.success(i18next.t('_UNFAVORITE_PLAYLIST_SUCCESS'));
      });
    };

    $scope.addLocalMusic = (list_id) => {
      if (isElectron()) {
        const remote = require('@electron/remote');
        const remoteFunctions = remote.require('./functions.js');
        remote.dialog
          .showOpenDialog({
            title: '添加歌曲',
            properties: ['openFile', 'multiSelections'],
            filters: [
              {
                name: 'Music Files',
                extensions: ['flac', 'mp3', 'mp4', 'ogg', 'wav', 'webm'],
              },
            ],
          })
          .then((result) => {
            if (result.canceled) {
              return;
            }

            result.filePaths.forEach((fp) => {
              remoteFunctions.readAudioTags(fp).then((md) => {
                const track = {
                  id: `lmtrack_${fp}`,
                  title: md.common.title,
                  artist: md.common.artist,
                  artist_id: `lmartist_${md.common.artist}`,
                  album: md.common.album,
                  album_id: `lmalbum_${md.common.album}`,
                  source: 'localmusic',
                  source_url: '',
                  img_url: '',
                  lyrics: md.common.lyrics,
                  duration: Number(md.format && md.format.duration) || 0,
                  // url: "lmtrack_"+fp,
                  sound_url: `file://${fp}`,
                };

                const list_id = 'lmplaylist_reserve';
                MediaService.addPlaylist(list_id, [track]).success((res) => {
                  const { playlist } = res;
                  $scope.songs = playlist.tracks;
                  $scope.list_id = playlist.info.id;
                  $scope.cover_img_url = playlist.info.cover_img_url;
                  $scope.playlist_title = playlist.info.title;
                  $scope.playlist_source_url = playlist.info.source_url;
                  $scope.is_mine = playlist.info.id.slice(0, 2) === 'my';
                  $scope.is_local = playlist.info.id.slice(0, 2) === 'lm';
                  $scope.$evalAsync();
                });
              });
            });
          })
          .catch((err) => {
            // console.log(err);
          });
      }
    };
  },
]);
