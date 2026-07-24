/* eslint-disable no-unused-vars */
/* global isElectron getLocalStorageValue */
/*
build a bridge between UI and audio player

audio player has 2 modes, but share same protocol: front and background.

* front: audio player and UI are in same environment
* background: audio player is in background page.

*/

function getFrontPlayer() {
  return window.threadPlayer;
}

function getExtensionApi() {
  if (typeof chrome !== 'undefined' && chrome.runtime) {
    return chrome;
  }
  if (typeof browser !== 'undefined' && browser.runtime) {
    return browser;
  }
  return null;
}

function getLegacyBackgroundPage() {
  const extensionApi = getExtensionApi();
  if (
    !extensionApi ||
    !extensionApi.extension ||
    typeof extensionApi.extension.getBackgroundPage !== 'function'
  ) {
    return null;
  }
  return extensionApi.extension.getBackgroundPage();
}

function canUseBackgroundPlayer() {
  const backgroundPage = getLegacyBackgroundPage();
  return Boolean(backgroundPage && backgroundPage.threadPlayer);
}

function getPlayerMode() {
  return isElectron() ||
    getLocalStorageValue('enable_stop_when_close', true) ||
    !canUseBackgroundPlayer()
    ? 'front'
    : 'background';
}

function getBackgroundPlayer() {
  const backgroundPage = getLegacyBackgroundPage();
  return backgroundPage && backgroundPage.threadPlayer
    ? backgroundPage.threadPlayer
    : getFrontPlayer();
}

function getBackgroundPlayerAsync(callback) {
  return callback(getBackgroundPlayer());
}

function getPlayer(mode) {
  if (mode === 'front') {
    return getFrontPlayer();
  }
  if (mode === 'background') {
    return getBackgroundPlayer();
  }
  return undefined;
}

function getPlayerAsync(mode, callback) {
  if (mode === 'front') {
    const player = getFrontPlayer();
    return callback(player);
  }
  if (mode === 'background') {
    return getBackgroundPlayerAsync(callback);
  }
  return undefined;
}
const frontPlayerListener = [];
function addFrontPlayerListener(listener) {
  frontPlayerListener.push(listener);
}

function addBackgroundPlayerListener(listener) {
  const extensionApi = getExtensionApi();
  if (!extensionApi || !extensionApi.runtime.onMessage) {
    return addFrontPlayerListener(listener);
  }
  return extensionApi.runtime.onMessage.addListener((msg, sender, res) => {
    if (!msg.type.startsWith('BG_PLAYER:')) {
      return null;
    }
    return listener(msg, sender, res);
  });
}

function addPlayerListener(mode, listener) {
  if (mode === 'front') {
    return addFrontPlayerListener(listener);
  }
  if (mode === 'background') {
    return addBackgroundPlayerListener(listener);
  }
  return null;
}

function frontPlayerSendMessage(message) {
  if (frontPlayerListener !== []) {
    frontPlayerListener.forEach((listener) => {
      listener(message);
    });
  }
}

function backgroundPlayerSendMessage(message) {
  const extensionApi = getExtensionApi();
  if (!extensionApi || !extensionApi.runtime.sendMessage) {
    return frontPlayerSendMessage(message);
  }
  return extensionApi.runtime.sendMessage(message);
}

function playerSendMessage(mode, message) {
  if (mode === 'front') {
    frontPlayerSendMessage(message);
  }
  if (mode === 'background') {
    backgroundPlayerSendMessage(message);
  }
}
