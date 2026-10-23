function normalizeOpacity(value) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.round(Math.min(100, Math.max(45, value)))
    : 100;
}
function createWindowAppearance({
  ipcMain,
  getWindow,
  store,
  platform = process.platform,
}) {
  const supported = platform === "win32" || platform === "darwin";
  let opacity = normalizeOpacity(store.get("windowOpacity"));
  let saveTimer;
  const state = () => ({ ok: true, supported, opacity });
  const trusted = (event) => {
    const window = getWindow();
    return (
      window &&
      !window.isDestroyed() &&
      event &&
      event.sender === window.webContents &&
      event.senderFrame === window.webContents.mainFrame
    );
  };
  function apply() {
    const window = getWindow();
    if (supported && window && !window.isDestroyed())
      window.setOpacity(opacity / 100);
  }
  function flush() {
    clearTimeout(saveTimer);
    store.set("windowOpacity", opacity);
  }
  ipcMain.handle("appearance:get-window", (event) =>
    trusted(event) ? state() : { ok: false }
  );
  ipcMain.handle("appearance:set-opacity", (event, value) => {
    if (!trusted(event) || typeof value !== "number" || !Number.isFinite(value))
      return { ok: false };
    opacity = normalizeOpacity(value);
    apply();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 250);
    return state();
  });
  return { apply, flush };
}
module.exports = { createWindowAppearance, normalizeOpacity };
