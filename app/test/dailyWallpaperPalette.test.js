const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(
  path.join(__dirname, "../listen1_chrome_extension/js/wallpaper_theme.js"),
  "utf8"
);
function fixture({ hang = false, bad = false } = {}) {
  const canvases = [];
  const timers = new Map();
  const revoked = [];
  let images = 0;
  const root = {
    document: {
      createElement: () => {
        const canvas = {
          getContext: () => ({
            fillRect() {},
            drawImage() {},
            getImageData: () => ({
              data: new Uint8ClampedArray([28, 90, 180, 255]),
            }),
          }),
          toDataURL: () => "data:image/webp;base64,ZGVjb2RlZA==",
        };
        canvases.push(canvas);
        return canvas;
      },
    },
    Image: class Image {
      constructor() {
        images += 1;
        this.naturalWidth = 3840;
        this.naturalHeight = 2160;
      }
      set src(value) {
        if (!value || hang) return;
        Promise.resolve().then(() => (bad ? this.onerror() : this.onload()));
      }
    },
    setTimeout: (fn) => {
      const id = Symbol();
      timers.set(id, fn);
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
    URL: {
      createObjectURL: () => "blob:photo",
      revokeObjectURL: (url) => revoked.push(url),
    },
  };
  vm.runInNewContext(source, { window: root });
  return {
    api: root.Listen2Wallpaper,
    canvases,
    timers,
    revoked,
    get images() {
      return images;
    },
  };
}

test("daily data URLs use the same bounded rasterization and contrast palette as personal images", async () => {
  const f = fixture();
  const record = await f.api.fromDataUrl("data:image/jpeg;base64,YWJj");
  assert.equal(f.canvases[0].width, 1920);
  assert.equal(f.canvases[0].height, 1080);
  assert.equal(f.canvases[1].width, 64);
  assert.equal(record.image, "data:image/webp;base64,ZGVjb2RlZA==");
  assert.equal(record.mode, "auto");
  const palette = f.api.makePalette(record.seed);
  const rgb = (value) =>
    value.match(/[a-f\d]{2}/gi).map((n) => parseInt(n, 16));
  assert(
    f.api.contrast(
      rgb(palette.variables.text),
      rgb(palette.variables.surface)
    ) >= 4.5
  );
  assert.equal(f.timers.size, 0);
  const personal = await f.api.fromFile({
    type: "image/jpeg",
    size: 300,
    name: "My photo.jpg",
  });
  assert.equal(personal.name, "My photo");
  assert.equal(personal.image, record.image);
  assert.deepEqual(f.revoked, ["blob:photo"]);
});

test("remote URLs, active formats, malformed and oversized data fail before image decoding", async () => {
  const f = fixture();
  for (const input of [
    "https://www.bing.com/image.jpg",
    "data:image/svg+xml;base64,YWJj",
    "data:image/jpeg;base64,<>",
    `data:image/jpeg;base64,${"A".repeat(8 * 1024 * 1024)}`,
  ])
    await assert.rejects(f.api.fromDataUrl(input), /invalid-image/);
  assert.equal(f.images, 0);
});

test("broken and hung decoders fail with bounded lifetime and revoke personal blob URLs", async () => {
  const bad = fixture({ bad: true });
  await assert.rejects(
    bad.api.fromFile({ type: "image/png", size: 300, name: "bad.png" }),
    /invalid-image/
  );
  assert.equal(bad.timers.size, 0);
  assert.deepEqual(bad.revoked, ["blob:photo"]);
  const hang = fixture({ hang: true });
  const pending = hang.api.fromDataUrl("data:image/png;base64,YWJj");
  [...hang.timers.values()][0]();
  await assert.rejects(pending, /invalid-image/);
});

test("daily stage text, muted text and accents stay readable over a white photograph", () => {
  const {
    makePalette,
    contrast,
  } = require("../listen1_chrome_extension/js/wallpaper_theme");
  const css = fs.readFileSync(
    path.join(
      __dirname,
      "../listen1_chrome_extension/css/theme-collection.css"
    ),
    "utf8"
  );
  const surface = css.match(
    /\.modern-body\.theme-daily \.now-playing-copy,[\s\S]*?background: rgba\(var\(--daily-stage-rgb, 20, 33, 43\), ([\d.]+)\)/
  );
  assert(surface, "daily text needs a photo-independent scrim");
  const opacity = Number(surface[1]);
  const rgb = (value) =>
    value.match(/[a-f\d]{2}/gi).map((n) => parseInt(n, 16));
  for (let hue = 0; hue < 360; hue += 15) {
    for (const saturation of [0, 0.5, 1]) {
      const p = makePalette({
        hue,
        saturation,
        accentHue: hue,
        accentSaturation: saturation,
        brightness: 0.95,
      }).variables;
      const worstBackground = rgb(p["stage-bg"]).map((n) =>
        Math.round(n * opacity + 255 * (1 - opacity))
      );
      for (const key of ["stage-text", "stage-muted", "stage-accent"])
        assert(
          contrast(rgb(p[key]), worstBackground) >= 4.5,
          `${hue}/${saturation}: ${key}`
        );
    }
  }
});
