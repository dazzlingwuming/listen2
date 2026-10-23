/* eslint-disable no-param-reassign */
/* global angular i18next MediaService sourceList */
angular.module('listenone').controller('InstantSearchController', [
  '$scope',
  '$timeout',
  '$rootScope',
  ($scope, $timeout, $rootScope) => {
    $scope.originpagelog = { allmusic: 1 };
    sourceList.forEach((item) => {
      $scope.originpagelog[item.name] = 1;
    });
    $scope.sourceList = sourceList.filter((item) => item.searchable !== false);
    $scope.tab = sourceList[0].name;
    $scope.keywords = '';
    $scope.loading = false;
    $scope.result = [];
    $scope.searchStatus = 'idle';
    $scope.curpagelog = { ...$scope.originpagelog };
    $scope.totalpagelog = { ...$scope.originpagelog };
    $scope.curpage = 1;
    $scope.totalpage = 1;
    $scope.searchType = 0;
    let version = 0;
    let scheduled;
    let deadline;
    let destroyed = false;
    function invalidate() {
      version += 1;
      $timeout.cancel(scheduled);
      $timeout.cancel(deadline);
      $scope.loading = false;
      $scope.searchStatus = 'idle';
    }
    function resetPages() {
      $scope.curpagelog = { ...$scope.originpagelog };
      $scope.totalpagelog = { ...$scope.originpagelog };
      $scope.curpage = 1;
      $scope.totalpage = 1;
    }
    function performSearch() {
      invalidate();
      const requestVersion = version;
      const source = $scope.tab;
      const options = {
        keywords: $scope.keywords.trim(),
        curpage: $scope.curpage,
        type: $scope.searchType,
      };
      $scope.result = [];
      if (!options.keywords) return;
      $scope.loading = true;
      $scope.searchStatus = 'loading';
      $rootScope.$broadcast('search:keyword_change', options.keywords);
      const current = () =>
        !destroyed &&
        version === requestVersion &&
        $scope.keywords.trim() === options.keywords &&
        $scope.tab === source &&
        $scope.searchType === options.type &&
        $scope.curpage === options.curpage;
      deadline = $timeout(() => {
        if (!current()) return;
        version += 1;
        $scope.loading = false;
        $scope.searchStatus = 'unavailable';
      }, 15000);
      const receive = (data) => {
        if (!current()) return;
        $scope.$evalAsync(() => {
          if (!current()) return;
          $timeout.cancel(deadline);
          const results = data && Array.isArray(data.result) ? data.result : [];
          $scope.result = results.map((item) => ({
            ...item,
            sourceName: i18next.t(item.source),
          }));
          $scope.totalpage = Math.max(
            1,
            Math.ceil((Number(data && data.total) || 0) / 20)
          );
          $scope.totalpagelog[source] = $scope.totalpage;
          $scope.searchStatus = results.length
            ? 'success'
            : (data && data.status) || 'empty';
          $scope.loading = false;
          const container =
            document.querySelector('.modern-body .site-wrapper-innerd') ||
            document.querySelector('.site-wrapper-innerd');
          if (container) container.scrollTo({ top: 0 });
        });
      };
      try {
        MediaService.search(source, options).success(receive);
      } catch (_) {
        receive({ result: [], total: 0, status: 'unavailable' });
      }
    }
    $scope.changeSourceTab = (source) => {
      $scope.tab = source;
      $scope.curpage = $scope.curpagelog[source] || 1;
      $scope.totalpage = $scope.totalpagelog[source] || 1;
      performSearch();
    };
    $scope.changeSearchType = (type) => {
      $scope.searchType = type;
      resetPages();
      performSearch();
    };
    $scope.isActiveTab = (tab) => $scope.tab === tab;
    $scope.isSearchType = (type) => $scope.searchType === type;
    $scope.$watch('keywords', () => {
      invalidate();
      resetPages();
      $scope.result = [];
      if ($scope.keywords.trim()) scheduled = $timeout(performSearch, 250);
    });
    $scope.enterEvent = (event) => {
      if ((event.keyCode || event.which) === 13) {
        resetPages();
        performSearch();
      }
    };
    $scope.retrySearch = performSearch;
    $scope.verifySearchSource = () =>
      MediaService.verifyNeteaseLyrics().then((state) => {
        if (state && state.ok && !destroyed && $scope.tab === 'netease')
          $scope.$evalAsync(performSearch);
      });
    $scope.searchFeedbackKey = () =>
      ({
        empty: '_SEARCH_EMPTY_RESULT',
        'verification-required': '_SEARCH_VERIFY_RESULT',
        'invalid-response': '_SEARCH_INVALID_RESULT',
        unavailable: '_SEARCH_UNAVAILABLE_RESULT',
      }[$scope.searchStatus] || '');
    $scope.nextPage = () => {
      if ($scope.loading || $scope.curpage >= $scope.totalpage) return;
      $scope.curpage += 1;
      $scope.curpagelog[$scope.tab] = $scope.curpage;
      performSearch();
    };
    $scope.previousPage = () => {
      if ($scope.loading || $scope.curpage <= 1) return;
      $scope.curpage -= 1;
      $scope.curpagelog[$scope.tab] = $scope.curpage;
      performSearch();
    };
    $scope.$on('$destroy', () => {
      destroyed = true;
      invalidate();
    });
  },
]);
