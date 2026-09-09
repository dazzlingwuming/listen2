/* eslint-disable import/no-unresolved */
/* eslint-disable import/no-extraneous-dependencies */
/* eslint-disable global-require */
/* eslint-disable no-param-reassign */
/* global angular MediaService isElectron require notyf BilibiliQrCode */
angular.module('listenone').controller('AuthController', [
  '$scope',
  '$timeout',
  ($scope, $timeout) => {
    const isAndroidTyped = () =>
      Boolean(
        typeof isElectron === 'function' &&
          !isElectron() &&
          window.Listen2AndroidHttpAdapter &&
          window.Listen2AndroidHttpAdapter.isAvailable &&
          window.Listen2AndroidHttpAdapter.isAvailable()
      );
    const getAndroidAccount = () => {
      if (!isAndroidTyped()) return null;
      const adapter = window.Listen2AndroidHttpAdapter;
      return adapter && adapter.account ? adapter.account : null;
    };
    $scope.loginProgress = false;
    $scope.loginType = 'email';
    $scope.androidAccountState = {
      available: !isAndroidTyped(),
      message: '登录功能将在后续版本提供',
    };
    $scope.androidAccountUnavailable = () => {
      $scope.androidAccountState = {
        available: false,
        message: 'Android 账号与扫码登录 bridge 尚未验证，未发起登录。',
      };
      if (typeof notyf !== 'undefined' && typeof notyf.info === 'function') {
        notyf.info($scope.androidAccountState.message);
      }
    };
    $scope.loginSourceList = MediaService.getLoginProviders().map(
      (i) => i.name
    );
    let initialAuthRefreshPending = true;
    const runAfterFirstPaint = (task) => {
      const scheduleIdle = () => {
        if (typeof window.requestIdleCallback === 'function') {
          window.requestIdleCallback(task, { timeout: 2500 });
          return;
        }
        window.setTimeout(task, 600);
      };
      if (typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(() =>
          window.requestAnimationFrame(scheduleIdle)
        );
        return;
      }
      scheduleIdle();
    };
    $scope.refreshAuthStatus = () => {
      if (isAndroidTyped()) {
        $scope.refreshAndroidAccountStatus();
        return;
      }
      const refresh = () => {
        $scope.loginSourceList.map((source) =>
          MediaService.getUser(source).success((data) => {
            if (data.status === 'success') {
              $scope.setMusicAuth(source, data.data);
            } else {
              $scope.setMusicAuth(source, {});
            }
          })
        );
      };
      if (initialAuthRefreshPending) {
        initialAuthRefreshPending = false;
        runAfterFirstPaint(refresh);
        return;
      }
      refresh();
    };

    $scope.bilibiliQr = {
      status: 'idle',
      sessionId: '',
      expiresAt: 0,
      secondsRemaining: 0,
      error: '',
    };
    let removeBilibiliQrListener = () => {};
    let qrCountdownPromise = null;
    let androidQrPollPromise = null;

    function getBilibiliQrStatusText(status, error) {
      if (status === 'waiting') {
        return '请使用哔哩哔哩手机客户端扫码';
      }
      if (status === 'scanned') {
        return '已扫码，请在手机客户端确认登录';
      }
      if (status === 'expired') {
        return '二维码已过期，请刷新后重试';
      }
      if (status === 'success') {
        return '登录成功';
      }
      if (status === 'error') {
        return error === 'cookie-not-committed'
          ? '登录已确认，但会话未保存成功，请重新扫码'
          : '二维码登录暂时不可用，请重试';
      }
      return '';
    }

    function renderBilibiliQr(svg) {
      if (!svg || typeof document === 'undefined') {
        return;
      }
      $timeout(() => {
        document.querySelectorAll('.bilibili-qr-code').forEach((element) => {
          element.innerHTML = svg;
        });
      }, 0);
    }

    function updateBilibiliQr(state) {
      const safeState = state || {};
      const next = {
        ...$scope.bilibiliQr,
        ...safeState,
        status: safeState.status || $scope.bilibiliQr.status || 'idle',
        error: safeState.error || '',
      };
      next.statusText = getBilibiliQrStatusText(next.status, next.error);
      next.secondsRemaining = Math.max(
        0,
        Math.ceil((Number(next.expiresAt || 0) - Date.now()) / 1000)
      );
      $scope.bilibiliQr = next;
      if (safeState.qrUrl && typeof BilibiliQrCode !== 'undefined') {
        try {
          renderBilibiliQr(BilibiliQrCode.toSvg(safeState.qrUrl));
        } catch (error) {
          $scope.bilibiliQr = {
            ...next,
            status: 'error',
            error: 'qr-render-failed',
            statusText: getBilibiliQrStatusText('error', 'qr-render-failed'),
          };
        }
      }
      if (safeState.status === 'success' && safeState.auth) {
        $scope.setMusicAuth('bilibili', {
          is_login: true,
          avatar: safeState.auth.face || 'images/placeholder.png',
          nickname: safeState.auth.uname || '哔哩哔哩用户',
          vip_type: safeState.auth.vipType || 0,
          vip_status: safeState.auth.vipStatus || 0,
        });
        $scope.$broadcast('bilibili-auth:login-success');
        notyf.success('哔哩哔哩登录成功');
      }
    }

    function updateQrCountdown() {
      const activeStatuses = ['waiting', 'scanned'];
      if (!activeStatuses.includes($scope.bilibiliQr.status)) {
        qrCountdownPromise = null;
        return;
      }
      const secondsRemaining = Math.max(
        0,
        Math.ceil(
          (Number($scope.bilibiliQr.expiresAt || 0) - Date.now()) / 1000
        )
      );
      $scope.bilibiliQr.secondsRemaining = secondsRemaining;
      if (secondsRemaining === 0) {
        $scope.bilibiliQr.status = 'expired';
        $scope.bilibiliQr.statusText = getBilibiliQrStatusText('expired');
        if (isAndroidTyped()) {
          const account = getAndroidAccount();
          if (account && typeof account.cancel === 'function') {
            account.cancel($scope.bilibiliQr.sessionId).catch(() => {});
          }
        } else {
          MediaService.cancelBilibiliQrLogin($scope.bilibiliQr.sessionId);
        }
        qrCountdownPromise = null;
        return;
      }
      qrCountdownPromise = $timeout(updateQrCountdown, 1000);
    }

    function ensureBilibiliQrListener() {
      removeBilibiliQrListener();
      removeBilibiliQrListener = MediaService.onBilibiliQrState((state) => {
        $scope.$evalAsync(() => updateBilibiliQr(state));
      });
    }

    function applyAndroidAccountState(state) {
      const next = state || {};
      updateBilibiliQr({
        status: next.status || 'error',
        sessionId: next.sessionId || '',
        expiresAt: Number(next.expiresAtEpochMs || 0),
        qrUrl: next.qrUrl || '',
        error: next.status === 'unavailable' ? 'route-unavailable' : '',
      });
      if (next.status === 'authenticated') {
        $scope.setMusicAuth('bilibili', {
          is_login: true,
          avatar: 'images/placeholder.png',
          nickname: '哔哩哔哩已登录',
        });
        $scope.androidAccountState = {
          available: true,
          message: '已登录哔哩哔哩',
        };
        return false;
      }
      if (next.status === 'unavailable') {
        $scope.androidAccountState = {
          available: false,
          message: 'Android 账号服务当前不可用。',
        };
        return false;
      }
      return ['waiting', 'scanned'].includes(next.status);
    }

    function scheduleAndroidQrPoll() {
      if (androidQrPollPromise) $timeout.cancel(androidQrPollPromise);
      if (
        !isAndroidTyped() ||
        !['waiting', 'scanned'].includes($scope.bilibiliQr.status)
      )
        return;
      androidQrPollPromise = $timeout(() => {
        const account = getAndroidAccount();
        const { sessionId } = $scope.bilibiliQr;
        if (!account || !sessionId || typeof account.poll !== 'function')
          return;
        const handle = account.poll(sessionId);
        const request =
          handle && handle.promise ? handle.promise : Promise.resolve(handle);
        request
          .then((state) => {
            $scope.$evalAsync(() => {
              if (applyAndroidAccountState(state)) scheduleAndroidQrPoll();
            });
          })
          .catch(() => {
            $scope.$evalAsync(() =>
              updateBilibiliQr({ status: 'error', error: 'request-failed' })
            );
          });
      }, 1000);
    }

    $scope.refreshAndroidAccountStatus = () => {
      const account = getAndroidAccount();
      if (!account || typeof account.status !== 'function') {
        $scope.androidAccountState = {
          available: false,
          message: '登录功能将在后续版本提供',
        };
        return;
      }
      const handle = account.status();
      const request =
        handle && handle.promise ? handle.promise : Promise.resolve(handle);
      request
        .then((state) =>
          $scope.$evalAsync(() => {
            if (applyAndroidAccountState(state)) scheduleAndroidQrPoll();
          })
        )
        .catch(() => $scope.$evalAsync($scope.androidAccountUnavailable));
    };

    $scope.startAndroidBilibiliQrLogin = () => {
      const account = getAndroidAccount();
      if (!account || typeof account.begin !== 'function') {
        $scope.androidAccountUnavailable();
        return;
      }
      updateBilibiliQr({
        status: 'loading',
        sessionId: '',
        expiresAt: 0,
        error: '',
      });
      $scope.$broadcast('bilibili-auth:open-dialog');
      const handle = account.begin();
      const request =
        handle && handle.promise ? handle.promise : Promise.resolve(handle);
      request
        .then((state) =>
          $scope.$evalAsync(() => {
            if (applyAndroidAccountState(state)) scheduleAndroidQrPoll();
          })
        )
        .catch(() =>
          $scope.$evalAsync(() =>
            updateBilibiliQr({ status: 'error', error: 'request-failed' })
          )
        );
    };

    $scope.startBilibiliQrLogin = () => {
      if (!isElectron()) {
        if (isAndroidTyped()) $scope.startAndroidBilibiliQrLogin();
        return;
      }
      if (qrCountdownPromise) {
        $timeout.cancel(qrCountdownPromise);
        qrCountdownPromise = null;
      }
      ensureBilibiliQrListener();
      updateBilibiliQr({
        status: 'loading',
        sessionId: '',
        expiresAt: 0,
        error: '',
      });
      $scope.$broadcast('bilibili-auth:open-dialog');
      MediaService.beginBilibiliQrLogin()
        .then((response) => {
          $scope.$evalAsync(() => {
            if (!response || response.ok !== true || !response.state) {
              updateBilibiliQr({
                status: 'error',
                error: (response && response.status) || 'request-failed',
              });
              return;
            }
            updateBilibiliQr(response.state);
            if (qrCountdownPromise) {
              $timeout.cancel(qrCountdownPromise);
            }
            qrCountdownPromise = $timeout(updateQrCountdown, 1000);
          });
        })
        .catch(() => {
          $scope.$evalAsync(() => {
            updateBilibiliQr({ status: 'error', error: 'request-failed' });
          });
        });
    };

    $scope.refreshBilibiliQrLogin = () => $scope.startBilibiliQrLogin();

    $scope.cancelBilibiliQrLogin = () => {
      const { sessionId } = $scope.bilibiliQr;
      if (qrCountdownPromise) {
        $timeout.cancel(qrCountdownPromise);
        qrCountdownPromise = null;
      }
      if (androidQrPollPromise) {
        $timeout.cancel(androidQrPollPromise);
        androidQrPollPromise = null;
      }
      if (sessionId) {
        if (isAndroidTyped()) {
          const account = getAndroidAccount();
          if (account && typeof account.cancel === 'function')
            account.cancel(sessionId).catch(() => {});
        } else {
          MediaService.cancelBilibiliQrLogin(sessionId);
        }
      }
      $scope.bilibiliQr = {
        ...$scope.bilibiliQr,
        status: 'idle',
        sessionId: '',
        expiresAt: 0,
        secondsRemaining: 0,
        statusText: '',
      };
    };

    $scope.$on('bilibili-auth:dialog-closed', () => {
      $scope.cancelBilibiliQrLogin();
    });

    $scope.$on('$destroy', () => {
      if (qrCountdownPromise) {
        $timeout.cancel(qrCountdownPromise);
      }
      if (androidQrPollPromise) $timeout.cancel(androidQrPollPromise);
      removeBilibiliQrListener();
    });

    $scope.logout = (source) => {
      if (isAndroidTyped()) {
        if (source !== 'bilibili') {
          $scope.androidAccountUnavailable();
          return;
        }
        const account = getAndroidAccount();
        if (!account || typeof account.logout !== 'function') {
          $scope.androidAccountUnavailable();
          return;
        }
        const handle = account.logout();
        const request =
          handle && handle.promise ? handle.promise : Promise.resolve(handle);
        request
          .then((state) =>
            $scope.$evalAsync(() => {
              applyAndroidAccountState(state);
              $scope.setMusicAuth(source, {});
              notyf.success('已退出哔哩哔哩登录');
            })
          )
          .catch(() => $scope.$evalAsync($scope.androidAccountUnavailable));
        return;
      }
      if (source === 'bilibili') {
        MediaService.logoutBilibili().then(() => {
          $scope.$evalAsync(() => {
            $scope.setMusicAuth(source, {});
            notyf.success('已退出哔哩哔哩登录');
          });
        });
        return;
      }
      $scope.setMusicAuth(source, {});
      MediaService.logout(source);
    };

    $scope.is_login = (source) =>
      $scope.musicAuth[source] && $scope.musicAuth[source].is_login;

    $scope.musicAuth = {};

    $scope.setMusicAuth = (source, data) => {
      $scope.musicAuth[source] = data;
    };

    $scope.getLoginUrl = (source) => MediaService.getLoginUrl(source);

    $scope.openLogin = (source) => {
      if (isAndroidTyped()) {
        if (source === 'bilibili') $scope.startAndroidBilibiliQrLogin();
        else $scope.androidAccountUnavailable();
        return undefined;
      }
      if (source === 'bilibili') {
        $scope.startBilibiliQrLogin();
        return undefined;
      }
      const url = $scope.getLoginUrl(source);
      if (isElectron()) {
        const { ipcRenderer } = require('electron');
        return ipcRenderer.send('openUrl', url);
      }
      return window.open(url, '_blank');
    };

    $scope.launchLogin = (source) => {
      if (source === 'bilibili') {
        $scope.startBilibiliQrLogin();
        return;
      }
      $scope.openLogin(source);
      $scope.$broadcast('auth:open-login-dialog', source);
    };
  },
]);
