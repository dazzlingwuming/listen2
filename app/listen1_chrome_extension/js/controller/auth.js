/* eslint-disable import/no-unresolved */
/* eslint-disable global-require */
/* global angular MediaService isElectron require notyf BilibiliQrCode */
angular.module('listenone').controller('AuthController', [
  '$scope',
  '$timeout',
  ($scope, $timeout) => {
    $scope.loginProgress = false;
    $scope.loginType = 'email';
    $scope.loginSourceList = MediaService.getLoginProviders().map(
      (i) => i.name
    );
    $scope.refreshAuthStatus = () => {
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

    $scope.bilibiliQr = {
      status: 'idle',
      sessionId: '',
      expiresAt: 0,
      secondsRemaining: 0,
      error: '',
    };
    let removeBilibiliQrListener = () => {};
    let qrCountdownPromise = null;

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
        MediaService.cancelBilibiliQrLogin($scope.bilibiliQr.sessionId);
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

    $scope.startBilibiliQrLogin = () => {
      if (!isElectron()) {
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
      const sessionId = $scope.bilibiliQr.sessionId;
      if (qrCountdownPromise) {
        $timeout.cancel(qrCountdownPromise);
        qrCountdownPromise = null;
      }
      if (sessionId) {
        MediaService.cancelBilibiliQrLogin(sessionId);
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
      removeBilibiliQrListener();
    });

    $scope.logout = (source) => {
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
