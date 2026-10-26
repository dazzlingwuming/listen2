/* eslint-disable import/no-extraneous-dependencies */
/* eslint-disable import/no-unresolved */
/* eslint-disable global-require */
/* eslint-disable no-undef */
/* eslint-disable no-param-reassign */
/* global angular i18next sourceList platformSourceList */
angular.module('listenone').controller('ProfileController', [
  '$scope',
  ($scope) => {
    let defaultLang = 'zh-CN';
    const supportLangs = ['zh-CN', 'en-US'];
    if (supportLangs.indexOf(navigator.language) !== -1) {
      defaultLang = navigator.language;
    }
    if (supportLangs.indexOf(localStorage.getObject('language')) !== -1) {
      defaultLang = localStorage.getObject('language');
    }
    $scope.lastestVersion = '';
    $scope.theme = '';
    $scope.proxyModes = [
      { name: 'system', displayId: '_PROXY_SYSTEM' },
      { name: 'direct', displayId: '_PROXY_DIRECT' },
      { name: 'enhanced-direct', displayId: '_PROXY_ENHANCED_DIRECT' },
      { name: 'custom', displayId: '_PROXY_CUSTOM' },
    ];

    $scope.proxyModeInput = null;
    $scope.proxyMode = null;
    $scope.proxyNetworkAvailable = isElectron();
    $scope.proxyStatePending = $scope.proxyNetworkAvailable;
    $scope.proxyApplyPending = false;
    $scope.proxyStateKnown = false;
    $scope.proxyFeedbackKey = $scope.proxyNetworkAvailable
      ? '_PROXY_STATE_LOADING'
      : '_PROXY_STATE_DESKTOP_ONLY';
    $scope.proxyProtocols = ['http', 'https', 'quic', 'socks4', 'socks5'];

    $scope.proxyProtocol = 'http';
    $scope.proxyRules = '';

    $scope.changeProxyProtocol = (newProtocol) => {
      $scope.proxyProtocol = newProtocol;
    };

    $scope.changeProxyMode = (newMode) => {
      $scope.proxyModeInput = newMode;
    };

    let proxyRequestVersion = 0;
    const proxyConfigMode = (config) => {
      if (!config || typeof config !== 'object') return null;
      if (
        config.mode === 'system' ||
        config.mode === 'direct' ||
        config.mode === 'enhanced-direct'
      ) {
        return config.mode;
      }
      if (config.mode === 'custom' && typeof config.proxyRules === 'string') {
        return 'custom';
      }
      return typeof config.proxyRules === 'string' ? 'custom' : null;
    };
    const updateProxyMode = (config) => {
      const modeName = proxyConfigMode(config);
      if (!modeName) return false;
      [$scope.proxyMode] = $scope.proxyModes.filter(
        (item) => item.name === modeName
      );
      $scope.proxyModeInput = $scope.proxyMode;
      $scope.proxyRules = modeName === 'custom' ? config.proxyRules : '';
      if (modeName === 'custom') {
        const match = /(\w+):\/\/([^:/]+):(\d+)/.exec(config.proxyRules);
        if (match) {
          const [, protocol, host, port] = match;
          $scope.proxyProtocol = protocol;
          const hostInput = document.getElementById('proxy-rules-host');
          const portInput = document.getElementById('proxy-rules-port');
          if (hostInput) hostInput.value = host;
          if (portInput) portInput.value = port;
        }
      }
      $scope.proxyStateKnown = true;
      return true;
    };
    const applyProxyState = (state) => {
      const mode = state && proxyConfigMode(state.config);
      if (
        !state ||
        state.scope !== 'application' ||
        !mode ||
        Boolean(state.enhancedDirect) !== (mode === 'enhanced-direct')
      ) {
        return false;
      }
      updateProxyMode(state.config);
      if (state.ok === true) {
        $scope.proxyFeedbackKey =
          {
            'enhanced-direct': '_PROXY_STATE_ENHANCED_ACTIVE',
            direct: '_PROXY_STATE_DIRECT_ACTIVE',
            custom: '_PROXY_STATE_CUSTOM_ACTIVE',
          }[mode] || '_PROXY_STATE_SYSTEM_ACTIVE';
      }
      return true;
    };
    const clearProxyState = () => {
      $scope.proxyMode = null;
      $scope.proxyModeInput = null;
      $scope.proxyRules = '';
      $scope.proxyStateKnown = false;
    };
    const currentProxyConfig = () => {
      if (!$scope.proxyStateKnown || !$scope.proxyMode) return null;
      return $scope.proxyMode.name === 'custom'
        ? { proxyRules: $scope.proxyRules }
        : { mode: $scope.proxyMode.name };
    };
    const sameProxyConfig = (left, right) => {
      const leftMode = proxyConfigMode(left);
      const rightMode = proxyConfigMode(right);
      if (!leftMode || leftMode !== rightMode) return false;
      return leftMode === 'custom'
        ? left.proxyRules === right.proxyRules
        : leftMode === rightMode;
    };
    const reportProxyFailure = (state, previousConfig) => {
      if (applyProxyState(state)) {
        const rollbackCodes = new Set([
          'invalid-config',
          'policy-apply-failed',
          'resolver-check-failed',
          'resolver-check-timeout',
          'persist-failed',
        ]);
        const restored =
          state.ok === false &&
          rollbackCodes.has(state.errorCode) &&
          sameProxyConfig(previousConfig, state.config);
        $scope.proxyFeedbackKey = restored
          ? '_PROXY_ERROR_RESTORED'
          : '_PROXY_ERROR_APPLIED_WITH_WARNING';
        return;
      }
      clearProxyState();
      $scope.proxyFeedbackKey = '_PROXY_ERROR_UNCONFIRMED';
    };
    const invokeNetwork = (method, config) => {
      if (!isElectron()) return Promise.reject(new Error('desktop-only'));
      const { ipcRenderer } = require('electron');
      return method === 'get'
        ? ipcRenderer.invoke('network:getState')
        : ipcRenderer.invoke('network:applyConfig', config);
    };
    const updateInDigest = (callback) =>
      new Promise((resolve) => {
        const update = () => resolve(callback());
        if (typeof $scope.$applyAsync === 'function') {
          $scope.$applyAsync(update);
        } else {
          update();
        }
      });
    const applyProxyConfig = (config, closeOnSuccess) => {
      if (!isElectron() || $scope.proxyApplyPending)
        return Promise.resolve(false);
      proxyRequestVersion += 1;
      const requestVersion = proxyRequestVersion;
      const previousConfig = currentProxyConfig();
      $scope.proxyStatePending = false;
      $scope.proxyApplyPending = true;
      $scope.proxyFeedbackKey = '_PROXY_STATE_APPLYING';
      return invokeNetwork('apply', config)
        .then((state) =>
          updateInDigest(() => {
            if (requestVersion !== proxyRequestVersion) return false;
            if (!state || state.ok !== true) {
              reportProxyFailure(state, previousConfig);
              return false;
            }
            if (!applyProxyState(state)) {
              clearProxyState();
              $scope.proxyFeedbackKey = '_PROXY_ERROR_UNCONFIRMED';
              return false;
            }
            $scope.proxyFeedbackKey = '_PROXY_STATE_APPLIED';
            if (closeOnSuccess && typeof $scope.closeDialog === 'function') {
              $scope.closeDialog();
            }
            return true;
          })
        )
        .catch(() =>
          updateInDigest(() => {
            if (requestVersion === proxyRequestVersion) {
              clearProxyState();
              $scope.proxyFeedbackKey = '_PROXY_ERROR_UNCONFIRMED';
            }
            return false;
          })
        )
        .finally(() =>
          updateInDigest(() => {
            if (requestVersion === proxyRequestVersion) {
              $scope.proxyApplyPending = false;
            }
          })
        );
    };
    $scope.setProxyConfig = () => {
      const mode = $scope.proxyModeInput && $scope.proxyModeInput.name;
      if (!mode) return Promise.resolve(false);
      if (mode === 'custom') {
        const hostInput = document.getElementById('proxy-rules-host');
        const portInput = document.getElementById('proxy-rules-port');
        const host = hostInput && hostInput.value;
        const port = portInput && portInput.value;
        if (!host || !/^\d+$/.test(port || '')) {
          $scope.proxyFeedbackKey = '_PROXY_ERROR_RESTORED';
          return Promise.resolve(false);
        }
        const proxyRules = `${$scope.proxyProtocol}://${host}:${port}`;
        return applyProxyConfig({ proxyRules }, true);
      }
      return applyProxyConfig({ mode }, true);
    };
    $scope.applyEnhancedDirect = () =>
      applyProxyConfig({ mode: 'enhanced-direct' }, false);
    $scope.restoreSystemProxy = () =>
      applyProxyConfig({ mode: 'system' }, false);

    $scope.getProxyConfig = () => {
      if (!isElectron() || $scope.proxyApplyPending)
        return Promise.resolve(false);
      proxyRequestVersion += 1;
      const requestVersion = proxyRequestVersion;
      $scope.proxyStatePending = true;
      $scope.proxyFeedbackKey = '_PROXY_STATE_LOADING';
      return invokeNetwork('get')
        .then((state) =>
          updateInDigest(() => {
            if (requestVersion !== proxyRequestVersion) return false;
            if (!state || state.ok !== true) {
              if (applyProxyState(state)) {
                reportProxyFailure(state, null);
              } else {
                clearProxyState();
                $scope.proxyFeedbackKey = '_PROXY_STATE_UNKNOWN';
              }
              return false;
            }
            if (!applyProxyState(state)) {
              clearProxyState();
              $scope.proxyStateKnown = false;
              $scope.proxyFeedbackKey = '_PROXY_STATE_UNKNOWN';
              return false;
            }
            return true;
          })
        )
        .catch(() =>
          updateInDigest(() => {
            if (requestVersion === proxyRequestVersion) {
              clearProxyState();
              $scope.proxyFeedbackKey = '_PROXY_STATE_UNKNOWN';
            }
            return false;
          })
        )
        .finally(() =>
          updateInDigest(() => {
            if (requestVersion === proxyRequestVersion) {
              $scope.proxyStatePending = false;
            }
          })
        );
    };
    $scope.retryProxyState = $scope.getProxyConfig;
    $scope.proxyFeedbackText = () =>
      // eslint-disable-next-line no-underscore-dangle
      $scope[$scope.proxyFeedbackKey] || $scope._PROXY_STATE_UNKNOWN || '';

    $scope.initProfile = () => {
      const url = `https://api.github.com/repos/listen1/listen1_chrome_extension/releases/latest`;
      axios.get(url).then((response) => {
        $scope.lastestVersion = response.data.tag_name;
      });

      $scope.getProxyConfig();
    };
    $scope.setLang = (langKey) => {
      // You can change the language during runtime
      i18next.changeLanguage(langKey).then((t) => {
        axios.get('i18n/zh-CN.json').then((res) => {
          Object.keys(res.data).forEach((key) => {
            $scope[key] = t(key);
          });
          sourceList.forEach((item) => {
            item.displayText = t(item.displayId);
          });
          platformSourceList.forEach((item) => {
            item.displayText = t(item.displayId);
          });
          $scope.proxyModes.forEach((item) => {
            item.displayText = t(item.displayId);
          });
        });
        localStorage.setObject('language', langKey);
      });
    };
    $scope.setLang(defaultLang);

    const themeMigrationKey = 'modernThemeMigrationV2';
    const legacyThemeMap = {
      white: 'white2',
      black: 'black2',
    };
    const availableThemes = window.Listen2Appearance.themes.filter(
      (item) => !item.desktopOnly || isElectron()
    );
    const wallpaper = window.Listen2Wallpaper;
    let dailyTheme = null;
    $scope.dailyWallpaper = null;
    $scope.dailyThemeStatus = '_DAILY_THEME_LOADING';
    function refreshThemeOptions() {
      $scope.themeOptions = availableThemes.filter(
        (item) => item.id !== 'custom' || $scope.customWallpaper
      );
    }
    refreshThemeOptions();
    $scope.themeFilters = window.Listen2Appearance.filters;
    $scope.themeFilter = 'all';
    $scope.setThemeFilter = (filter) => {
      if ($scope.themeFilters.includes(filter)) $scope.themeFilter = filter;
    };
    $scope.matchesThemeFilter = (item) =>
      window.Listen2Appearance.matchesFilter(item, $scope.themeFilter);
    const supportedThemes = availableThemes.map((item) => item.id);
    const savedTheme = localStorage.getObject('theme');
    const fallbackTheme = savedTheme === null ? 'sakura' : 'black2';
    const defaultTheme =
      legacyThemeMap[savedTheme] ||
      (supportedThemes.includes(savedTheme) ? savedTheme : fallbackTheme);
    localStorage.setObject(themeMigrationKey, true);
    $scope.performanceMode = window.Listen2Appearance.mode;
    $scope.showCharacterArt =
      localStorage.getObject('showCharacterArt') !== false;
    $scope.setPerformanceMode = (value) => {
      window.Listen2Appearance.setMode(value);
      $scope.performanceMode = window.Listen2Appearance.mode;
    };
    $scope.setCharacterArt = (value) => {
      $scope.showCharacterArt = Boolean(value);
      localStorage.setObject('showCharacterArt', $scope.showCharacterArt);
    };
    $scope.setTheme = (theme) => {
      const normalizedTheme =
        legacyThemeMap[theme] ||
        (supportedThemes.includes(theme) ? theme : 'black2');
      const selected = availableThemes.find(
        (item) => item.id === normalizedTheme
      );
      $scope.theme = normalizedTheme;
      $scope.selectedTheme = selected;
      $scope.themeSceneUrl = selected.scene
        ? `images/themes/${selected.scene}-scene.webp`
        : '';
      if (selected.id === 'custom')
        $scope.themeSceneUrl =
          ($scope.customWallpaper && $scope.customWallpaper.image) || '';
      if (selected.id === 'daily')
        $scope.themeSceneUrl = $scope.dailyWallpaper
          ? $scope.dailyWallpaper.image
          : 'images/themes/ocean-scene.webp';
      if (dailyTheme) dailyTheme.select(selected.id === 'daily');
      $scope.themeClass = {
        'theme-modern-light': selected.base === 'light',
        'theme-modern-dark': selected.base === 'dark',
        'theme-anime': Boolean(selected.assets),
        'theme-designed': Boolean(selected.edition),
        'theme-scenic': Boolean(selected.scene),
        [`theme-${selected.id}`]: true,
      };
      document.getElementById('theme-css').href =
        selected.base === 'light' ? 'css/iparanoid2.css' : 'css/origin2.css';
      document.getElementById('common-css').href = 'css/common2.css';
      localStorage.setObject('theme', normalizedTheme);
      // Notify canvas palettes after Angular has applied the theme class.
      $scope.$evalAsync(() =>
        window.requestAnimationFrame(() => window.Listen2Appearance.publish())
      );
    };
    // Daily work starts only through selection. The lifecycle is ready before
    // the saved theme is restored, including when daily is the saved theme.
    if (isElectron() && window.Listen2DailyTheme && wallpaper) {
      const { ipcRenderer } = require('electron');
      dailyTheme = window.Listen2DailyTheme.createDailyTheme({
        request: (payload) =>
          ipcRenderer.invoke('daily-wallpaper:get', payload),
        cancel: () => ipcRenderer.send('daily-wallpaper:cancel'),
        prepare: async (record) => {
          const image = await wallpaper.fromDataUrl(record.image);
          return {
            wallpaper: { ...record, image: image.image },
            palette: wallpaper.makePalette(image.seed, 'auto'),
          };
        },
        onChange: (state) =>
          $scope.$evalAsync(() => {
            if ($scope.theme !== 'daily') return;
            $scope.dailyThemeStatus =
              {
                loading: '_DAILY_THEME_LOADING',
                fresh: '_DAILY_THEME_FRESH',
                cached: '_DAILY_THEME_CACHED',
                stale: '_DAILY_THEME_STALE',
                unavailable: '_DAILY_THEME_UNAVAILABLE',
              }[state.status] || '_DAILY_THEME_LOADING';
            if (!state.wallpaper || !state.palette) return;
            const theme = availableThemes.find((item) => item.id === 'daily');
            theme.base = state.palette.base;
            theme.colors = state.palette.colors;
            Object.entries(state.palette.variables).forEach(([key, value]) => {
              document.documentElement.style.setProperty(
                `--daily-${key}`,
                value
              );
            });
            document.documentElement.style.setProperty(
              '--daily-wallpaper',
              `url("${state.wallpaper.image}")`
            );
            $scope.dailyWallpaper = state.wallpaper;
            if ($scope.theme === 'daily') $scope.setTheme('daily');
          }),
      });
      $scope.$on('$destroy', () => dailyTheme.dispose());
    }
    axios.get('images/feather-sprite.svg').then((res) => {
      const container = document.getElementById('feather-container');
      if (container) container.innerHTML = res.data;
    });
    $scope.setTheme(defaultTheme);

    $scope.customWallpaper = null;
    $scope.customWallpaperBusy = true;
    $scope.customWallpaperError = '';
    function showWallpaperError(error) {
      const keys = {
        'image-format': '_WALLPAPER_FORMAT_ERROR',
        'image-size': '_WALLPAPER_SIZE_ERROR',
        'invalid-image': '_WALLPAPER_INVALID_ERROR',
      };
      $scope.customWallpaperError =
        keys[error.message] || '_WALLPAPER_STORAGE_ERROR';
    }
    function installWallpaper(record, select) {
      const palette = wallpaper.makePalette(record.seed, record.mode);
      const theme = window.Listen2Appearance.themes.find(
        (item) => item.id === 'custom'
      );
      theme.base = palette.base;
      theme.colors = palette.colors;
      Object.entries(palette.variables).forEach(([key, value]) => {
        document.documentElement.style.setProperty(`--custom-${key}`, value);
      });
      document.documentElement.style.setProperty(
        '--custom-wallpaper',
        `url("${record.image}")`
      );
      $scope.customWallpaper = record;
      $scope.customPalette = palette;
      refreshThemeOptions();
      if (select || $scope.theme === 'custom') $scope.setTheme('custom');
    }
    $scope.chooseWallpaper = () =>
      document.getElementById('custom-wallpaper-file').click();
    $scope.importWallpaper = async (file) => {
      if (!file || $scope.customWallpaperBusy) return;
      $scope.$evalAsync(() => {
        $scope.customWallpaperBusy = true;
        $scope.customWallpaperError = '';
      });
      try {
        const record = await wallpaper.fromFile(file);
        await wallpaper.save(record);
        $scope.$evalAsync(() => installWallpaper(record, true));
      } catch (error) {
        $scope.$evalAsync(() => showWallpaperError(error));
      } finally {
        $scope.$evalAsync(() => {
          $scope.customWallpaperBusy = false;
        });
      }
    };
    $scope.setWallpaperMode = async (mode) => {
      if (
        !$scope.customWallpaper ||
        $scope.customWallpaperBusy ||
        !['auto', 'light', 'dark'].includes(mode)
      )
        return;
      $scope.customWallpaperBusy = true;
      $scope.customWallpaperError = '';
      const record = { ...$scope.customWallpaper, mode };
      try {
        await wallpaper.save(record);
        $scope.$evalAsync(() => installWallpaper(record, true));
      } catch (error) {
        $scope.$evalAsync(() => showWallpaperError(error));
      } finally {
        $scope.$evalAsync(() => {
          $scope.customWallpaperBusy = false;
        });
      }
    };
    $scope.removeWallpaper = async () => {
      if ($scope.customWallpaperBusy) return;
      $scope.customWallpaperBusy = true;
      $scope.customWallpaperError = '';
      try {
        await wallpaper.remove();
        $scope.$evalAsync(() => {
          if ($scope.theme === 'custom') $scope.setTheme('black2');
          $scope.customWallpaper = null;
          refreshThemeOptions();
          document.documentElement.style.removeProperty('--custom-wallpaper');
        });
      } catch (error) {
        $scope.$evalAsync(() => showWallpaperError(error));
      } finally {
        $scope.$evalAsync(() => {
          $scope.customWallpaperBusy = false;
        });
      }
    };
    Promise.resolve(wallpaper ? wallpaper.load() : null)
      .then((record) => {
        $scope.$evalAsync(() => {
          if (record) installWallpaper(record, defaultTheme === 'custom');
          else if ($scope.theme === 'custom') $scope.setTheme('black2');
        });
      })
      .catch((error) =>
        $scope.$evalAsync(() => {
          showWallpaperError(error);
          if ($scope.theme === 'custom') $scope.setTheme('black2');
        })
      )
      .finally(() =>
        $scope.$evalAsync(() => {
          $scope.customWallpaperBusy = false;
        })
      );

    $scope.windowAppearance = { supported: false, transparency: 0 };
    if (isElectron()) {
      const { ipcRenderer } = require('electron');
      ipcRenderer
        .invoke('appearance:get-window')
        .then((state) => {
          if (!state || !state.ok) return;
          $scope.$evalAsync(() => {
            $scope.windowAppearance.supported = state.supported;
            $scope.windowAppearance.transparency = 100 - state.opacity;
          });
        })
        .catch(() => {});
      $scope.setWindowTransparency = () => {
        ipcRenderer
          .invoke(
            'appearance:set-opacity',
            100 - Number($scope.windowAppearance.transparency)
          )
          .catch(() => {});
      };
    }
  },
]);
