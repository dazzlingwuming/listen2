const test = require("node:test");
const assert = require("node:assert/strict");
const {
  extractSeed,
  makePalette,
  contrast,
} = require("../listen1_chrome_extension/js/wallpaper_theme");
const {
  createWindowAppearance,
  normalizeOpacity,
} = require("../windowAppearance");
const rgb = (value) => value.match(/[a-f\d]{2}/gi).map((n) => parseInt(n, 16));
test("photographs produce their own hue and keep text and controls readable in both modes", () => {
  for (const color of [
    [24, 106, 184],
    [220, 120, 57],
    [196, 86, 167],
    [1, 1, 1],
    [255, 255, 255],
    [128, 128, 128],
  ]) {
    const pixels = new Uint8ClampedArray(
      Array.from({ length: 400 }, () => [...color, 255]).flat()
    );
    const seed = extractSeed(pixels);
    for (const mode of ["auto", "light", "dark"]) {
      const { variables: p } = makePalette(seed, mode);
      assert(contrast(rgb(p.text), rgb(p.surface)) >= 4.5);
      assert(contrast(rgb(p.muted), rgb(p.surface)) >= 4.5);
      assert(contrast(rgb(p.accent), rgb(p.surface)) >= 4.5);
      assert(contrast(rgb(p["on-accent"]), rgb(p.accent)) >= 4.5);
      assert(contrast(rgb(p["stage-text"]), rgb(p["stage-bg"])) >= 4.5);
    }
  }
  const ocean = extractSeed(new Uint8ClampedArray([20, 90, 180, 255]));
  const desert = extractSeed(new Uint8ClampedArray([200, 110, 40, 255]));
  assert(ocean.hue > 190 && ocean.hue < 240);
  assert(desert.hue > 10 && desert.hue < 50);
});
test("transparent images have a defined failure and bright images select light mode", () => {
  assert.throws(
    () => extractSeed(new Uint8ClampedArray([255, 0, 0, 0])),
    /invalid-image/
  );
  const seed = extractSeed(new Uint8ClampedArray([248, 242, 232, 255]));
  assert.equal(makePalette(seed).base, "light");
  assert.equal(makePalette(seed, "dark").base, "dark");
});
test("native window opacity is bounded, persisted and restricted to the player window", () => {
  const handlers = new Map();
  const saved = new Map([["windowOpacity", 75]]);
  const window = {
    isDestroyed: () => false,
    webContents: { mainFrame: {} },
    setOpacity(value) {
      this.opacity = value;
    },
  };
  const appearance = createWindowAppearance({
    ipcMain: { handle: (key, fn) => handlers.set(key, fn) },
    getWindow: () => window,
    store: {
      get: (key) => saved.get(key),
      set: (key, value) => saved.set(key, value),
    },
    platform: "win32",
  });
  appearance.apply();
  assert.equal(window.opacity, 0.75);
  const trusted = {
    sender: window.webContents,
    senderFrame: window.webContents.mainFrame,
  };
  const set = handlers.get("appearance:set-opacity");
  assert.equal(set({ sender: {} }, 10).ok, false);
  assert.equal(set(trusted, NaN).ok, false);
  assert.equal(set(trusted, 1).opacity, 45);
  assert.equal(window.opacity, 0.45);
  appearance.flush();
  assert.equal(saved.get("windowOpacity"), 45);
  assert.equal(set(trusted, 100).opacity, 100);
  appearance.flush();
  assert.equal(normalizeOpacity(undefined), 100);
});
