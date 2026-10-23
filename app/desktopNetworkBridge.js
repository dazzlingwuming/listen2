function createDesktopNetworkBridge({
  policy,
  ipcMain,
  getMainWindow,
  mainUrl,
  startUpdater,
}) {
  let updaterStarted = false;
  const denied = () => ({
    ok: false,
    status: "unavailable",
    scope: "application",
    error: "untrusted-source",
    errorCode: "untrusted-source",
  });
  function isTrusted(event) {
    const window = getMainWindow();
    if (
      !window ||
      window.isDestroyed() ||
      !event ||
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame
    ) {
      return false;
    }
    try {
      const actual = new URL(event.senderFrame.url);
      const expected = new URL(mainUrl);
      return (
        actual.protocol === "file:" &&
        actual.protocol === expected.protocol &&
        actual.host === expected.host &&
        actual.pathname === expected.pathname &&
        actual.search === expected.search
      );
    } catch (_) {
      return false;
    }
  }
  function maybeStartUpdater(state) {
    if (!state || !state.ok || updaterStarted) return;
    updaterStarted = true;
    // Update discovery is optional and cannot turn a successful policy save
    // into a network policy error or trigger multiple update requests.
    Promise.resolve()
      .then(startUpdater)
      .catch(() => {});
  }
  function getState(event) {
    return isTrusted(event) ? policy.getState() : denied();
  }
  async function applyConfig(event, config) {
    if (!isTrusted(event)) return denied();
    const result = await policy.applyConfig(config);
    maybeStartUpdater(result);
    return result;
  }
  async function handleLegacy(event, command, config) {
    if (!isTrusted(event)) return denied();
    const result =
      command === "update_proxy_config"
        ? await applyConfig(event, config)
        : getState(event);
    event.sender.send("proxyConfig", result.config || null);
    return result;
  }
  function register() {
    ipcMain.handle("network:getState", getState);
    ipcMain.handle("network:applyConfig", applyConfig);
  }
  return { register, getState, applyConfig, handleLegacy, maybeStartUpdater };
}

module.exports = { createDesktopNetworkBridge };
