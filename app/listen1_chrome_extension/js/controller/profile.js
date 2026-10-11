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
      { name: 'custom', displayId: '_PROXY_CUSTOM' },
    ];

    [$scope.proxyModeInput] = $scope.proxyModes;
    [$scope.proxyMode] = $scope.proxyModes;
    $scope.proxyProtocols = ['http', 'https', 'quic', 'socks4', 'socks5'];

    $scope.proxyProtocol = 'http';
    $scope.proxyRules = '';

    $scope.changeProxyProtocol = (newProtocol) => {
      $scope.proxyProtocol = newProtocol;
    };

    $scope.changeProxyMode = (newMode) => {
      $scope.proxyModeInput = newMode;
    };

    $scope.setProxyConfig = () => {
      const mode = $scope.proxyModeInput.name;
      $scope.proxyMode = $scope.proxyModeInput;
      const host = document.getElementById('proxy-rules-host').value;
      const port = document.getElementById('proxy-rules-port').value;
      $scope.proxyRules = `${$scope.proxyProtocol}://${host}:${port}`;
      if (isElectron()) {
        const message = 'update_proxy_config';
        const { ipcRenderer } = require('electron');
        if (mode === 'system' || mode === 'direct') {
          ipcRenderer.send('control', message, { mode });
        } else {
          ipcRenderer.send('control', message, {
            proxyRules: $scope.proxyRules,
          });
        }
      }
    };

    $scope.getProxyConfig = () => {
      if (isElectron()) {
        // get proxy config from main process
        const message = 'get_proxy_config';
        const { ipcRenderer } = require('electron');
        ipcRenderer.send('control', message);
      }
    };

    $scope.initProfile = () => {
      const url = `https://api.github.com/repos/listen1/listen1_chrome_extension/releases/latest`;
      axios.get(url).then((response) => {
        $scope.lastestVersion = response.data.tag_name;
      });

      $scope.getProxyConfig();
    };

    if (isElectron()) {
      const { ipcRenderer } = require('electron');

      ipcRenderer.on('proxyConfig', (event, config) => {
        // parse config
        if (config.mode === 'system' || config.mode === 'direct') {
          [$scope.proxyMode] = $scope.proxyModes.filter(
            (i) => i.name === config.mode
          );
          $scope.proxyModeInput = $scope.proxyMode;
          $scope.proxyRules = '';
        } else {
          [$scope.proxyMode] = $scope.proxyModes.filter(
            (i) => i.name === 'custom'
          );
          $scope.proxyModeInput = $scope.proxyMode;
          $scope.proxyRules = config.proxyRules;
          // rules = 'socks5://127.0.0.1:1080'
          const match = /(\w+):\/\/([\d.]+):(\d+)/.exec(config.proxyRules);
          const [, protocol, host, port] = match;

          $scope.proxyProtocol = protocol;
          document.getElementById('proxy-rules-host').value = host;
          document.getElementById('proxy-rules-port').value = port;
        }
      });
    }
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
    $scope.themeOptions = window.Listen2Appearance.themes;
    const supportedThemes = $scope.themeOptions.map((item) => item.id);
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
      const selected = $scope.themeOptions.find(
        (item) => item.id === normalizedTheme
      );
      $scope.theme = normalizedTheme;
      $scope.selectedTheme = selected;
      $scope.themeClass = {
        'theme-modern-light': selected.base === 'light',
        'theme-modern-dark': selected.base === 'dark',
        'theme-anime': Boolean(selected.assets),
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
    axios.get('images/feather-sprite.svg').then((res) => {
      const container = document.getElementById('feather-container');
      if (container) container.innerHTML = res.data;
    });
    $scope.setTheme(defaultTheme);
  },
]);
