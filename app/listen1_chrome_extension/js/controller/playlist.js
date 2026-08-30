/* eslint-disable no-unused-vars */
/* global angular MediaService sourceList */

angular.module('listenone').controller('PlayListController', [
  '$scope',
  '$timeout',
  ($scope, $timeout) => {
    $scope.result = [];
    $scope.tab = sourceList[0].name;
    $scope.sourceList = sourceList;
    $scope.playlistFilters = {};
    $scope.allPlaylistFilters = {};
    $scope.currentFilterId = '';
    $scope.loading = false;
    $scope.showMore = false;
    $scope.remoteHome = {
      state: 'idle',
      token: 0,
      source: '',
      message: '',
    };
    let initialPlaylistLoadPending = true;
    let activeHomeToken = null;
    let homeDeadline = null;
    let destroyed = false;

    const clearHomeDeadline = () => {
      if (homeDeadline) {
        $timeout.cancel(homeDeadline);
        homeDeadline = null;
      }
    };
    const cancelHomeToken = () => {
      if (activeHomeToken && typeof activeHomeToken.cancel === 'function') {
        activeHomeToken.cancel();
      }
      activeHomeToken = null;
    };
    const finalizeHome = (token, state, message) => {
      if (destroyed || $scope.remoteHome.token !== token) return false;
      clearHomeDeadline();
      activeHomeToken = null;
      $scope.loading = false;
      $scope.remoteHome = {
        ...$scope.remoteHome,
        state,
        message: message || '',
      };
      return true;
    };
    const uniqueRows = (rows) => {
      const seen = new Set();
      return (Array.isArray(rows) ? rows : []).filter((item) => {
        const id = item && (item.id || (item.info && item.info.id));
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
      });
    };

    const runAfterFirstPaint = (task) => {
      const scheduleIdle = () => {
        if (typeof window.requestIdleCallback === 'function') {
          window.requestIdleCallback(task, { timeout: 1800 });
          return;
        }
        window.setTimeout(task, 400);
      };
      if (typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(() =>
          window.requestAnimationFrame(scheduleIdle)
        );
        return;
      }
      scheduleIdle();
    };

    $scope.$on('infinite_scroll:hit_bottom', (event, data) => {
      if ($scope.loading === true) {
        return;
      }
      $scope.loading = true;
      const offset = $scope.result.length;
      MediaService.showPlaylistArray(
        $scope.tab,
        offset,
        $scope.currentFilterId
      ).success((res) => {
        $scope.result = uniqueRows($scope.result.concat(res.result));
        $scope.loading = false;
      });
    });

    $scope.loadPlaylist = () => {
      if (initialPlaylistLoadPending) {
        initialPlaylistLoadPending = false;
        runAfterFirstPaint($scope.loadPlaylist);
        return;
      }
      const offset = 0;
      cancelHomeToken();
      clearHomeDeadline();
      const token = $scope.remoteHome.token + 1;
      $scope.remoteHome = {
        ...$scope.remoteHome,
        state: 'loading',
        token,
        source: $scope.tab,
        message: '',
      };
      $scope.loading = true;
      $scope.showMore = false;
      const request = MediaService.showPlaylistArray(
        $scope.tab,
        offset,
        $scope.currentFilterId
      );
      activeHomeToken = request;
      homeDeadline = $timeout(() => {
        if (activeHomeToken && typeof activeHomeToken.cancel === 'function') {
          activeHomeToken.cancel();
        }
        finalizeHome(token, 'timeout', '内容加载超时');
      }, 12000);
      request.success((res) => {
        if (!finalizeHome(token, 'content')) return;
        const nextRows = uniqueRows(res && res.result);
        if (nextRows.length) {
          $scope.result = nextRows;
        }
        $scope.remoteHome.state = nextRows.length ? 'content' : 'empty';
      });
      if (typeof request.error === 'function') {
        request.error(() => finalizeHome(token, 'error', '内容暂时无法加载'));
      }

      if (
        $scope.playlistFilters[$scope.tab] === undefined &&
        $scope.allPlaylistFilters[$scope.tab] === undefined
      ) {
        MediaService.getPlaylistFilters($scope.tab).success((res) => {
          $scope.playlistFilters[$scope.tab] = res.recommend;
          $scope.allPlaylistFilters[$scope.tab] = res.all;
        });
      }
    };

    $scope.changeTab = (newTab) => {
      cancelHomeToken();
      clearHomeDeadline();
      $scope.tab = newTab;
      $scope.result = [];
      $scope.currentFilterId = '';
      $scope.loadPlaylist();
    };

    $scope.changeFilter = (filterId) => {
      cancelHomeToken();
      clearHomeDeadline();
      $scope.result = [];
      $scope.currentFilterId = filterId;
      $scope.loadPlaylist();
    };

    $scope.toggleMorePlaylists = () => {
      $scope.showMore = !$scope.showMore;
    };
    $scope.retryRemoteHome = () => $scope.loadPlaylist();
    $scope.$on('$destroy', () => {
      destroyed = true;
      cancelHomeToken();
      clearHomeDeadline();
    });
  },
]);
