/* eslint-disable no-param-reassign */
/* global angular i18next MediaService sourceList */

angular.module('listenone').controller('InstantSearchController', [
  '$scope',
  '$timeout',
  '$rootScope',
  ($scope, $timeout, $rootScope) => {
    const isAndroidTyped = () =>
      Boolean(
        window.Listen2AndroidHttpAdapter &&
          window.Listen2AndroidHttpAdapter.isAvailable &&
          window.Listen2AndroidHttpAdapter.isAvailable()
      );
    const cancelHandle = (handle) => {
      if (handle && typeof handle.cancel === 'function') handle.cancel();
    };
    const messageFor = (error, detail) => {
      const status = error && (error.status || error.code || error.kind);
      const messages = detail
        ? {
            'android-rpc-network': '网络连接不可用',
            'android-rpc-tls': '无法建立安全连接',
            'android-rpc-timeout': '读取分P超时',
            'android-rpc-malformed': '分P信息暂时无法识别',
            'invalid-part': '所选分P不可用',
          }
        : {
            'android-rpc-network': '网络连接不可用',
            'android-rpc-tls': '无法建立安全连接',
            'android-rpc-timeout': '搜索超时',
            'android-rpc-malformed': '搜索结果暂时无法识别',
            'android-rpc-provider-status': '匿名请求暂时被来源拒绝',
          };
      return (
        messages[status] ||
        (detail ? '分P信息暂时无法识别' : '搜索结果暂时无法识别')
      );
    };
    const consume = (handle, success, failure) => {
      if (!handle) {
        failure({ status: 'android-rpc-malformed' });
        return null;
      }
      if (typeof handle.success === 'function') {
        handle.success(success);
        if (typeof handle.error === 'function') handle.error(failure);
        return handle;
      }
      const promise = handle.promise || handle;
      if (promise && typeof promise.then === 'function') {
        return promise.then(success).catch(failure);
      }
      failure({ status: 'android-rpc-malformed' });
      return null;
    };
    let activeSearchHandle = null;
    let activeDetailHandle = null;
    let searchDeadline = null;
    let detailDeadline = null;
    let destroyed = false;

    $scope.originpagelog = { allmusic: 1 };
    sourceList.forEach((item) => {
      $scope.originpagelog[item.name] = 1;
    });
    $scope.sourceList = sourceList.filter((item) => item.searchable !== false);
    $scope.tab = sourceList[0].name;
    $scope.keywords = '';
    $scope.loading = false;
    $scope.curpagelog = { ...$scope.originpagelog };
    $scope.totalpagelog = { ...$scope.originpagelog };
    $scope.curpage = 1;
    $scope.totalpage = 1;
    $scope.searchType = 0;
    $scope.result = [];
    $scope.bilibiliSearch = {
      state: 'idle',
      epoch: 0,
      query: '',
      page: 1,
      priorQuery: '',
      priorRows: [],
      message: '',
    };
    $scope.bilibiliDetail = {
      state: 'idle',
      epoch: 0,
      track: null,
      bvid: '',
      parts: [],
      selectedCid: null,
      explicitSelection: false,
      message: '',
    };

    function clearSearchDeadline() {
      if (searchDeadline) {
        $timeout.cancel(searchDeadline);
        searchDeadline = null;
      }
    }
    function clearDetailDeadline() {
      if (detailDeadline) {
        $timeout.cancel(detailDeadline);
        detailDeadline = null;
      }
    }
    function currentSearch(epoch, query, page) {
      return (
        !destroyed &&
        $scope.bilibiliSearch.epoch === epoch &&
        $scope.bilibiliSearch.query === query &&
        $scope.bilibiliSearch.page === page
      );
    }
    function currentDetail(epoch, track) {
      return (
        !destroyed &&
        $scope.bilibiliDetail.epoch === epoch &&
        $scope.bilibiliDetail.track === track
      );
    }
    function settleSearch(epoch, query, page, state, message) {
      // A cancellation is terminal for this exact request identity. The
      // bridge may still deliver a late network reply after cancel(), but it
      // must never replace the user's visible cancelled state.
      if (
        !currentSearch(epoch, query, page) ||
        $scope.bilibiliSearch.state !== 'loading'
      )
        return false;
      clearSearchDeadline();
      activeSearchHandle = null;
      $scope.loading = false;
      $scope.bilibiliSearch.state = state;
      $scope.bilibiliSearch.message = message || '';
      return true;
    }
    function settleDetail(epoch, track, state, message) {
      if (!currentDetail(epoch, track)) return false;
      clearDetailDeadline();
      activeDetailHandle = null;
      $scope.bilibiliDetail.state = state;
      $scope.bilibiliDetail.message = message || '';
      return true;
    }
    function updateCurrentPage(value) {
      if (value === -1) {
        $scope.curpagelog = { ...$scope.originpagelog };
        $scope.curpage = 1;
      } else if (value >= 0) {
        $scope.curpagelog[$scope.tab] = value;
        $scope.curpage = value;
      } else $scope.curpage = $scope.curpagelog[$scope.tab];
    }
    function updateTotalPage(total) {
      if (total === -1) {
        $scope.totalpagelog = { ...$scope.originpagelog };
        $scope.totalpage = 1;
      } else if (total >= 0) {
        $scope.totalpage = Math.ceil(total / 20);
        $scope.totalpagelog[$scope.tab] = $scope.totalpage;
      } else $scope.totalpage = $scope.totalpagelog[$scope.tab];
    }
    function decorate(rows) {
      return (Array.isArray(rows) ? rows : []).map((row) => ({
        ...row,
        sourceName:
          row.source === 'bilibili' ? '哔哩哔哩' : i18next.t(row.source),
      }));
    }
    function legacySearch() {
      $rootScope.$broadcast('search:keyword_change', $scope.keywords);
      MediaService.search($scope.tab, {
        keywords: $scope.keywords,
        curpage: $scope.curpage,
        type: $scope.searchType,
      }).success((data) => {
        $scope.result = decorate(data.result);
        updateTotalPage(data.total);
        $scope.loading = false;
        const browser = document.querySelector('.site-wrapper-innerd');
        if (browser && typeof browser.scrollTo === 'function')
          browser.scrollTo({ top: 0 });
      });
    }
    function startBilibiliSearch(page) {
      const query = String($scope.keywords || '').trim();
      if (!query) {
        $scope.bilibiliSearch.state = 'idle';
        $scope.bilibiliSearch.message = '';
        $scope.loading = false;
        return;
      }
      cancelHandle(activeSearchHandle);
      clearSearchDeadline();
      const epoch = $scope.bilibiliSearch.epoch + 1;
      $scope.tab = 'bilibili';
      $scope.curpage = page || 1;
      $scope.bilibiliSearch = {
        ...$scope.bilibiliSearch,
        state: 'loading',
        epoch,
        query,
        page: $scope.curpage,
        priorQuery: $scope.bilibiliSearch.query,
        priorRows: $scope.result.slice(),
        message: '正在搜索哔哩哔哩…',
      };
      $scope.loading = true;
      const handle = MediaService.search('bilibili', {
        keywords: query,
        curpage: $scope.curpage,
        type: 0,
        pageEpoch: epoch,
      });
      activeSearchHandle = handle;
      searchDeadline = $timeout(() => {
        cancelHandle(handle);
        settleSearch(epoch, query, $scope.curpage, 'timeout', '搜索超时');
      }, 12000);
      consume(
        handle,
        (data) => {
          if (data && data.error) {
            if (
              !settleSearch(
                epoch,
                query,
                $scope.curpage,
                'error',
                messageFor(data.error, false)
              )
            )
              return;
            $scope.result = $scope.bilibiliSearch.priorRows.slice();
            return;
          }
          if (!settleSearch(epoch, query, $scope.curpage, 'content')) return;
          const rows = decorate(data && data.result);
          $scope.result = rows;
          updateTotalPage((data && data.total) || 0);
          $scope.bilibiliSearch.state = rows.length ? 'content' : 'empty';
          $scope.bilibiliSearch.message = rows.length ? '' : '没有找到结果';
        },
        (error) => {
          if (
            !settleSearch(
              epoch,
              query,
              $scope.curpage,
              'error',
              messageFor(error, false)
            )
          )
            return;
          $scope.result = $scope.bilibiliSearch.priorRows.slice();
        }
      );
    }
    $scope.submitBilibiliSearch = () => startBilibiliSearch(1);
    $scope.cancelBilibiliSearch = () => {
      const { epoch, query, page } = $scope.bilibiliSearch;
      cancelHandle(activeSearchHandle);
      settleSearch(epoch, query, page, 'cancelled', '已取消本次搜索');
    };
    $scope.retryBilibiliSearch = () => startBilibiliSearch(1);
    $scope.clearBilibiliSearch = () => {
      $scope.cancelBilibiliSearch();
      $scope.keywords = '';
      $scope.result = [];
      $scope.bilibiliSearch.state = 'idle';
      $scope.bilibiliSearch.message = '';
    };
    $scope.openBilibiliDetail = (track) => {
      if (!track || track.source !== 'bilibili') return;
      cancelHandle(activeDetailHandle);
      clearDetailDeadline();
      const epoch = $scope.bilibiliDetail.epoch + 1;
      $scope.bilibiliDetail = {
        ...$scope.bilibiliDetail,
        state: 'loading',
        epoch,
        track,
        bvid: '',
        parts: [],
        selectedCid: null,
        explicitSelection: false,
        message: '正在读取分P…',
      };
      const handle = MediaService.getVideoContext(track, { pageEpoch: epoch });
      activeDetailHandle = handle;
      detailDeadline = $timeout(() => {
        cancelHandle(handle);
        settleDetail(epoch, track, 'timeout', '读取分P超时');
      }, 12000);
      consume(
        handle,
        (detail) => {
          if (!settleDetail(epoch, track, 'content')) return;
          const parts = Array.isArray(detail && detail.parts)
            ? detail.parts
            : [];
          const selected = parts[0];
          $scope.bilibiliDetail = {
            ...$scope.bilibiliDetail,
            state: parts.length ? 'content' : 'error',
            bvid: (detail && detail.bvid) || '',
            parts,
            selectedCid: selected && selected.cid,
            message: parts.length ? '' : '分P信息暂时无法识别',
          };
        },
        (error) => settleDetail(epoch, track, 'error', messageFor(error, true))
      );
    };
    $scope.cancelBilibiliDetail = () => {
      const { epoch, track } = $scope.bilibiliDetail;
      cancelHandle(activeDetailHandle);
      settleDetail(epoch, track, 'cancelled', '已取消读取分P');
    };
    $scope.retryBilibiliDetail = () =>
      $scope.openBilibiliDetail($scope.bilibiliDetail.track);
    $scope.selectBilibiliPart = (cid) => {
      const part = $scope.bilibiliDetail.parts.find(
        (item) => String(item.cid) === String(cid)
      );
      if (!part) {
        $scope.bilibiliDetail.state = 'invalid-part';
        $scope.bilibiliDetail.message = '所选分P不可用';
        return;
      }
      $scope.bilibiliDetail = {
        ...$scope.bilibiliDetail,
        state: 'content',
        selectedCid: part.cid,
        explicitSelection: true,
        message: '',
      };
    };
    $scope.canPlaySelectedBilibiliPart = () => {
      const selected = $scope.bilibiliDetail.parts.find(
        (item) => String(item.cid) === String($scope.bilibiliDetail.selectedCid)
      );
      return Boolean(
        selected &&
          (selected.capability === 'playable' ||
            selected.capability === '可播放')
      );
    };
    $scope.playSelectedBilibiliPart = () => {
      if (!$scope.canPlaySelectedBilibiliPart()) {
        $scope.bilibiliDetail.state = 'invalid-part';
        $scope.bilibiliDetail.message = '所选分P不可用';
        return;
      }
      const selectedTrack = {
        ...$scope.bilibiliDetail.track,
        id: `${$scope.bilibiliDetail.track.id}-${$scope.bilibiliDetail.selectedCid}`,
      };
      if (typeof $scope.addAndPlay === 'function') {
        $scope.addAndPlay(selectedTrack);
        return;
      }
      $scope.$broadcast('player:play-bilibili-part', selectedTrack);
    };
    $scope.backFromBilibiliDetail = () => {
      $scope.cancelBilibiliDetail();
      $scope.bilibiliDetail.state = 'idle';
    };
    $scope.changeSourceTab = (newTab) => {
      $scope.cancelBilibiliSearch();
      $scope.tab = newTab;
      $scope.result = [];
      updateCurrentPage();
      updateTotalPage();
      if ($scope.keywords) {
        if (isAndroidTyped() && newTab === 'bilibili') startBilibiliSearch(1);
        else legacySearch();
      } else $scope.loading = false;
    };
    $scope.changeSearchType = (type) => {
      $scope.searchType = type;
      updateCurrentPage();
      updateTotalPage();
      if ($scope.keywords) legacySearch();
      else $scope.loading = false;
    };
    $scope.isActiveTab = (tab) => $scope.tab === tab;
    $scope.isSearchType = (type) => $scope.searchType === type;
    $scope.enterEvent = (event) => {
      const keycode = window.event ? event.keyCode : event.which;
      if (keycode === 13) {
        if (isAndroidTyped()) startBilibiliSearch(1);
        else legacySearch();
      }
    };
    $scope.nextPage = () => {
      if (isAndroidTyped() && $scope.tab === 'bilibili')
        return startBilibiliSearch($scope.curpage + 1);
      $scope.curpagelog[$scope.tab] += 1;
      $scope.curpage = $scope.curpagelog[$scope.tab];
      return legacySearch();
    };
    $scope.previousPage = () => {
      if (isAndroidTyped() && $scope.tab === 'bilibili')
        return startBilibiliSearch(Math.max(1, $scope.curpage - 1));
      $scope.curpagelog[$scope.tab] -= 1;
      $scope.curpage = $scope.curpagelog[$scope.tab];
      return legacySearch();
    };
    $scope.$watch('keywords', () => {});
    $scope.$on('$destroy', () => {
      destroyed = true;
      $scope.cancelBilibiliSearch();
      $scope.cancelBilibiliDetail();
      clearSearchDeadline();
      clearDetailDeadline();
    });
  },
]);
