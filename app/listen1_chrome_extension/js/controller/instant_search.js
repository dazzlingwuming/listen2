/* eslint-disable no-param-reassign */
/* global angular i18next MediaService MobileProviderRegistry sourceList */

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
    $scope.isAndroidTyped = isAndroidTyped;
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
    let detailDeadline = null;
    let destroyed = false;

    $scope.originpagelog = { allmusic: 1 };
    sourceList.forEach((item) => {
      $scope.originpagelog[item.name] = 1;
    });
    const registry = MobileProviderRegistry;
    const semanticLifecycle =
      registry &&
      typeof registry.createSemanticOperationLifecycle === 'function'
        ? registry.createSemanticOperationLifecycle({
            setTimeout: (callback, delay) => $timeout(callback, delay),
            clearTimeout: (timer) => $timeout.cancel(timer),
          })
        : null;
    const androidPrimarySources = () =>
      registry && Array.isArray(registry.primarySources)
        ? registry.primarySources
        : [];
    $scope.sourceList = isAndroidTyped()
      ? androidPrimarySources().map((source) => ({
          name: source.id,
          displayText: source.displayName,
          searchable: true,
        }))
      : sourceList.filter((item) => item.searchable !== false);
    $scope.tab = isAndroidTyped() ? 'netease' : sourceList[0].name;
    $scope.keywords = '';
    $scope.loading = false;
    $scope.curpagelog = { ...$scope.originpagelog };
    $scope.totalpagelog = { ...$scope.originpagelog };
    $scope.curpage = 1;
    $scope.totalpage = 1;
    $scope.searchType = 0;
    $scope.result = [];
    $scope.providerSearch = {
      sourceId: $scope.tab,
      sourceName: isAndroidTyped() ? '网易云音乐' : '',
      capability: null,
      capabilityEpoch: 0,
      state: isAndroidTyped() ? 'pending' : 'idle',
      epoch: 0,
      query: '',
      page: 1,
      message: '',
      action: '',
      skeletonRows: [],
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

    function clearDetailDeadline() {
      if (detailDeadline) {
        $timeout.cancel(detailDeadline);
        detailDeadline = null;
      }
    }
    function currentSearch(epoch, sourceId, query, page) {
      return (
        !destroyed &&
        $scope.providerSearch.epoch === epoch &&
        $scope.providerSearch.sourceId === sourceId &&
        $scope.providerSearch.query === query &&
        $scope.providerSearch.page === page
      );
    }
    function currentDetail(epoch, track) {
      return (
        !destroyed &&
        $scope.bilibiliDetail.epoch === epoch &&
        $scope.bilibiliDetail.track === track
      );
    }
    function settleSearch(
      epoch,
      sourceId,
      query,
      page,
      state,
      message,
      action
    ) {
      if (
        !currentSearch(epoch, sourceId, query, page) ||
        $scope.providerSearch.state !== 'loading'
      )
        return false;
      activeSearchHandle = null;
      $scope.loading = false;
      $scope.providerSearch = {
        ...$scope.providerSearch,
        state,
        message: message || '',
        action: action || '',
        skeletonRows: [],
      };
      return true;
    }

    function safeCapability(sourceId) {
      if (
        !isAndroidTyped() ||
        !MediaService ||
        typeof MediaService.getAndroidProviderCapabilities !== 'function'
      )
        return null;
      const matrix = MediaService.getAndroidProviderCapabilities() || {};
      return matrix[sourceId] || null;
    }
    function sourceName(sourceId) {
      const source = androidPrimarySources().find(
        (item) => item.id === sourceId
      );
      return source ? source.displayName : '音乐来源';
    }
    function setAndroidCapability(sourceId, matrix) {
      const capability =
        matrix && matrix[sourceId]
          ? matrix[sourceId]
          : safeCapability(sourceId);
      const current = $scope.providerSearch;
      if (!current || current.sourceId !== sourceId) return;
      if (
        capability &&
        Number.isSafeInteger(capability.capabilityEpoch) &&
        capability.capabilityEpoch < current.capabilityEpoch
      )
        return;
      const available = capability && capability.search === true;
      let capabilityState = current.state;
      if (['pending', 'idle', 'unavailable'].includes(current.state)) {
        capabilityState = available ? 'idle' : 'unavailable';
      }
      let capabilityMessage = current.message;
      let capabilityAction = current.action;
      if (capabilityState !== current.state || current.state === 'pending') {
        capabilityMessage = available
          ? ''
          : (capability && capability.safeReason) || '此音乐来源暂不支持搜索。';
        capabilityAction = available ? '' : '返回其他来源';
      }
      $scope.providerSearch = {
        ...current,
        sourceName:
          (capability && capability.displayName) || sourceName(sourceId),
        capability: capability || null,
        capabilityEpoch:
          capability && Number.isSafeInteger(capability.capabilityEpoch)
            ? capability.capabilityEpoch
            : current.capabilityEpoch,
        state: capabilityState,
        message: capabilityMessage,
        action: capabilityAction,
        skeletonRows:
          capabilityState === current.state ? current.skeletonRows : [],
      };
    }
    function refreshAndroidCapabilities() {
      if (!isAndroidTyped()) return;
      const apply = (matrix) => setAndroidCapability($scope.tab, matrix || {});
      const current = safeCapability($scope.tab);
      if (current) apply({ [$scope.tab]: current });
      if (
        MediaService &&
        typeof MediaService.startAndroidProviderCapabilities === 'function'
      ) {
        MediaService.startAndroidProviderCapabilities({
          pageEpoch: $scope.providerSearch.epoch,
        })
          .then(apply)
          .catch(() => apply({}));
      } else apply({});
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
    function startProviderSearch(page) {
      const query = String($scope.keywords || '').trim();
      if (!query) {
        $scope.providerSearch = {
          ...$scope.providerSearch,
          state: 'idle',
          query: '',
          message: '',
          action: '',
          skeletonRows: [],
        };
        $scope.loading = false;
        return;
      }
      cancelHandle(activeSearchHandle);
      const sourceId = $scope.tab;
      const capability = safeCapability(sourceId);
      const epoch = $scope.providerSearch.epoch + 1;
      $scope.curpage = page || 1;
      $scope.result = [];
      $scope.providerSearch = {
        ...$scope.providerSearch,
        sourceId,
        sourceName:
          (capability && capability.displayName) || sourceName(sourceId),
        capability,
        state: 'loading',
        epoch,
        query,
        page: $scope.curpage,
        message: `正在搜索${
          (capability && capability.displayName) || sourceName(sourceId)
        }…`,
        action: '取消搜索',
        skeletonRows: [0, 1, 2, 3],
      };
      $scope.loading = true;
      let displayRows = [];
      if (!semanticLifecycle) {
        settleSearch(
          epoch,
          sourceId,
          query,
          $scope.curpage,
          'unavailable',
          '此音乐来源暂不支持搜索。',
          '返回其他来源'
        );
        return;
      }
      const lifecycleHandle = semanticLifecycle.start({
        operation: 'search',
        sourceId,
        pageEpoch: epoch,
        deadlineMs: 12000,
        payload: { keyword: query, page: $scope.curpage },
        capabilities: { search: Boolean(capability && capability.search) },
        executor: (request, reply) => {
          const handle = MediaService.search(sourceId, {
            keywords: request.payload.keyword,
            curpage: request.payload.page,
            type: 0,
            pageEpoch: request.pageEpoch,
          });
          activeSearchHandle = handle;
          consume(
            handle,
            (data) => {
              if (data && data.error) {
                reply({
                  ...request,
                  terminal: 'error',
                  status: 'error',
                  code: 'PROVIDER_ERROR',
                  result: null,
                });
                return;
              }
              displayRows = decorate(data && data.result).map((row) => ({
                ...row,
                source: sourceId,
                sourceName: sourceName(sourceId),
              }));
              reply({
                ...request,
                terminal: 'ok',
                status: 'ok',
                code: null,
                result: {
                  rows: displayRows.slice(0, 50).map((row) => ({
                    sourceId,
                    itemId: String(row.id || ''),
                    title: String(row.title || ''),
                    artist: String(row.artist || ''),
                  })),
                },
              });
              // A provider handle may reply after its semantic lifecycle has
              // timed out or been cancelled. Only the still-current request
              // owns pagination as well as visible rows.
              if (currentSearch(epoch, sourceId, query, request.payload.page))
                updateTotalPage((data && data.total) || 0);
            },
            () =>
              reply({
                ...request,
                terminal: 'error',
                status: 'error',
                code: 'PROVIDER_ERROR',
                result: null,
              })
          );
          return () => cancelHandle(handle);
        },
      });
      activeSearchHandle = lifecycleHandle;
      lifecycleHandle.promise.then((terminal) => {
        if (!currentSearch(epoch, sourceId, query, $scope.curpage)) return;
        if (terminal.terminal === 'ok') {
          if (
            !settleSearch(
              epoch,
              sourceId,
              query,
              $scope.curpage,
              displayRows.length ? 'content' : 'empty',
              displayRows.length ? '' : '还没有搜索结果'
            )
          )
            return;
          $scope.result = displayRows;
          return;
        }
        const messages = {
          cancelled: '已取消本次搜索',
          timeout: `${sourceName(sourceId)}响应超时。请重试。`,
          unavailable: `${sourceName(sourceId)}暂不支持搜索。`,
          error: `${sourceName(
            sourceId
          )}暂时无法完成此操作。请检查网络后重试，或选择其他来源。`,
        };
        const action =
          terminal.terminal === 'unavailable' ? '返回其他来源' : '重试';
        settleSearch(
          epoch,
          sourceId,
          query,
          $scope.curpage,
          terminal.terminal,
          messages[terminal.terminal] || '搜索结果暂时无法识别',
          action
        );
      });
    }
    $scope.submitProviderSearch = () => startProviderSearch(1);
    $scope.cancelProviderSearch = () => {
      const { epoch, sourceId, query, page } = $scope.providerSearch;
      cancelHandle(activeSearchHandle);
      settleSearch(epoch, sourceId, query, page, 'cancelled', '已取消本次搜索');
    };
    $scope.retryProviderSearch = () => startProviderSearch(1);
    $scope.clearProviderSearch = () => {
      $scope.cancelProviderSearch();
      $scope.keywords = '';
      $scope.result = [];
      $scope.providerSearch = {
        ...$scope.providerSearch,
        state: 'idle',
        message: '',
        action: '',
        skeletonRows: [],
      };
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
    $scope.$on('android:search-back', (event, searchBack) => {
      if (
        !searchBack ||
        typeof searchBack !== 'object' ||
        $scope.bilibiliDetail.state === 'idle'
      ) {
        return;
      }
      $scope.backFromBilibiliDetail();
      searchBack.handled = true;
    });
    $scope.changeSourceTab = (newTab) => {
      if (isAndroidTyped()) {
        if (!androidPrimarySources().some((source) => source.id === newTab))
          return;
        $scope.cancelProviderSearch();
        const epoch = $scope.providerSearch.epoch + 1;
        $scope.tab = newTab;
        $scope.result = [];
        updateCurrentPage(-1);
        updateTotalPage(-1);
        $scope.providerSearch = {
          ...$scope.providerSearch,
          sourceId: newTab,
          sourceName: sourceName(newTab),
          capability: null,
          capabilityEpoch: $scope.providerSearch.capabilityEpoch,
          state: 'pending',
          epoch,
          query: String($scope.keywords || '').trim(),
          page: 1,
          message: '正在确认此音乐来源的可用能力…',
          action: '',
          skeletonRows: [],
        };
        refreshAndroidCapabilities();
        return;
      }
      $scope.tab = newTab;
      $scope.result = [];
      updateCurrentPage();
      updateTotalPage();
      if ($scope.keywords) {
        legacySearch();
      } else $scope.loading = false;
    };
    $scope.changeSearchType = (type) => {
      if (isAndroidTyped()) {
        // Phase 4 only proves typed song search. Do not let a visible legacy
        // playlist choice create an untyped fallback request or retain rows.
        $scope.cancelProviderSearch();
        $scope.searchType = 0;
        $scope.result = [];
        $scope.providerSearch = {
          ...$scope.providerSearch,
          epoch: $scope.providerSearch.epoch + 1,
          page: 1,
          state: 'idle',
          message: '',
          action: '',
          skeletonRows: [],
        };
        updateCurrentPage(-1);
        updateTotalPage(-1);
        return;
      }
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
        if (isAndroidTyped()) startProviderSearch(1);
        else legacySearch();
      }
    };
    $scope.nextPage = () => {
      if (isAndroidTyped()) return startProviderSearch($scope.curpage + 1);
      $scope.curpagelog[$scope.tab] += 1;
      $scope.curpage = $scope.curpagelog[$scope.tab];
      return legacySearch();
    };
    $scope.previousPage = () => {
      if (isAndroidTyped())
        return startProviderSearch(Math.max(1, $scope.curpage - 1));
      $scope.curpagelog[$scope.tab] -= 1;
      $scope.curpage = $scope.curpagelog[$scope.tab];
      return legacySearch();
    };
    $scope.$watch('keywords', (next, previous) => {
      if (!isAndroidTyped() || next === previous) return;
      const query = String(next || '').trim();
      if (query === $scope.providerSearch.query) return;
      $scope.cancelProviderSearch();
      $scope.result = [];
      $scope.providerSearch = {
        ...$scope.providerSearch,
        epoch: $scope.providerSearch.epoch + 1,
        query,
        page: 1,
        state: query ? 'idle' : 'idle',
        message: '',
        action: '',
        skeletonRows: [],
      };
    });
    $scope.$on('android:navigation-away', () => {
      if (isAndroidTyped()) $scope.cancelProviderSearch();
    });
    if (isAndroidTyped()) refreshAndroidCapabilities();
    $scope.$on('$destroy', () => {
      destroyed = true;
      $scope.cancelProviderSearch();
      $scope.cancelBilibiliDetail();
      clearDetailDeadline();
      if (semanticLifecycle)
        semanticLifecycle.destroy($scope.providerSearch.epoch);
    });
  },
]);
