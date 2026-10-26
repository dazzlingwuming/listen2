/* global module globalThis */
/* eslint-disable no-param-reassign, no-continue */
(function wallpaperThemeModule(root) {
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const hex = (rgb) =>
    `#${rgb.map((n) => Math.round(n).toString(16).padStart(2, '0')).join('')}`;
  function rgbToHsl(r, g, b) {
    [r, g, b] = [r, g, b].map((n) => n / 255);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    const l = (max + min) / 2;
    if (!delta) return [0, 0, l];
    let h = (r - g) / delta + 4;
    if (max === r) h = ((g - b) / delta + 6) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    return [h * 60, delta / (1 - Math.abs(2 * l - 1)), l];
  }
  function hslToRgb(h, s, l) {
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    const sectors = [
      [c, x, 0],
      [x, c, 0],
      [0, c, x],
      [0, x, c],
      [x, 0, c],
      [c, 0, x],
    ];
    const rgb = sectors[Math.min(5, Math.floor(h / 60))];
    return rgb.map((n) => Math.round((n + m) * 255));
  }
  function luminance(rgb) {
    const linear = rgb.map((n) => {
      const value = n / 255;
      return value <= 0.04045
        ? value / 12.92
        : ((value + 0.055) / 1.055) ** 2.4;
    });
    return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  }
  function contrast(a, b) {
    const x = luminance(a);
    const y = luminance(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }
  function readable(color, background, dark) {
    let result = color;
    for (let i = 0; i < 16 && contrast(result, background) < 4.5; i += 1) {
      result = result.map((n) =>
        Math.round(n * 0.85 + (dark ? 255 : 0) * 0.15)
      );
    }
    return result;
  }
  function extractSeed(pixels) {
    const buckets = new Map();
    let light = 0;
    let count = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] < 128) continue;
      const [h, s, l] = rgbToHsl(...pixels.slice(i, i + 3));
      light += l;
      count += 1;
      const key = Math.floor(h / 15);
      const weight =
        (0.12 + s * 0.88) * (0.3 + (1 - Math.abs(l - 0.5) * 2) * 0.7);
      const bucket = buckets.get(key) || { weight: 0, rgb: [0, 0, 0] };
      bucket.weight += weight;
      bucket.rgb = bucket.rgb.map(
        (n, channel) => n + pixels[i + channel] * weight
      );
      buckets.set(key, bucket);
    }
    if (!count) throw new Error('invalid-image');
    const ranked = [...buckets.values()].sort((a, b) => b.weight - a.weight);
    const tones = ranked.map((bucket) => ({
      weight: bucket.weight,
      hsl: rgbToHsl(...bucket.rgb.map((n) => n / bucket.weight)),
    }));
    const [hue, saturation] = tones[0].hsl;
    const second = tones.find((tone) => {
      const distance = Math.abs(tone.hsl[0] - hue);
      return (
        tone.weight > tones[0].weight * 0.3 &&
        tone.hsl[1] > 0.2 &&
        Math.min(distance, 360 - distance) > 35
      );
    });
    return {
      hue,
      saturation,
      accentHue: second ? second.hsl[0] : hue,
      accentSaturation: second ? second.hsl[1] : saturation,
      brightness: light / count,
    };
  }
  function makePalette(seed, mode = 'auto') {
    const dark =
      mode === 'dark' || (mode !== 'light' && seed.brightness < 0.62);
    const h = clamp(seed.hue, 0, 359.999);
    const s = clamp(seed.saturation * 0.5, 0, 0.38);
    const tone = (l) => hslToRgb(h, s, l);
    const bg = tone(dark ? 0.075 : 0.94);
    const surface = tone(dark ? 0.12 : 0.975);
    const accent = readable(
      hslToRgb(
        seed.accentHue,
        Math.min(seed.accentSaturation, 0.72),
        dark ? 0.74 : 0.34
      ),
      surface,
      dark
    );
    const stageBg = tone(0.065);
    const stageAccent = readable(
      hslToRgb(seed.accentHue, Math.min(seed.accentSaturation, 0.72), 0.76),
      stageBg,
      true
    );
    const variables = {
      bg: hex(bg),
      surface: hex(surface),
      raised: hex(tone(dark ? 0.17 : 0.995)),
      soft: hex(tone(dark ? 0.19 : 0.89)),
      hover: hex(tone(dark ? 0.24 : 0.84)),
      text: hex(readable(tone(dark ? 0.95 : 0.13), surface, dark)),
      muted: hex(readable(tone(dark ? 0.72 : 0.37), surface, dark)),
      subtle: hex(readable(tone(dark ? 0.66 : 0.41), surface, dark)),
      accent: hex(accent),
      'accent-rgb': accent.join(', '),
      'on-accent':
        contrast([15, 18, 21], accent) > contrast([255, 255, 255], accent)
          ? '#0f1215'
          : '#ffffff',
      'accent-soft': hex(tone(dark ? 0.24 : 0.86)),
      border: hex(tone(dark ? 0.25 : 0.8)),
      'border-strong': hex(tone(dark ? 0.4 : 0.62)),
      'stage-bg': hex(stageBg),
      'stage-rgb': stageBg.join(', '),
      'stage-accent': hex(stageAccent),
      'stage-accent-rgb': stageAccent.join(', '),
      'stage-text': hex(tone(0.95)),
      'stage-muted': hex(tone(0.76)),
    };
    return {
      base: dark ? 'dark' : 'light',
      variables,
      colors: [hex(bg), hex(accent), hex(tone(dark ? 0.95 : 0.13))],
    };
  }
  function imageFromUrl(url) {
    return new Promise((resolve, reject) => {
      const image = new root.Image();
      const timer = root.setTimeout(() => {
        image.src = '';
        reject(new Error('invalid-image'));
      }, 8000);
      image.onload = () => {
        root.clearTimeout(timer);
        resolve(image);
      };
      image.onerror = () => {
        root.clearTimeout(timer);
        reject(new Error('invalid-image'));
      };
      image.src = url;
    });
  }
  function recordFromImage(image, name) {
    if (!image.naturalWidth || !image.naturalHeight)
      throw new Error('invalid-image');
    const canvas = root.document.createElement('canvas');
    const scale = Math.min(
      1,
      1920 / Math.max(image.naturalWidth, image.naturalHeight)
    );
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    context.fillStyle = '#17191c';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const sample = root.document.createElement('canvas');
    sample.width = 64;
    sample.height = 64;
    const sampling = sample.getContext('2d', { willReadFrequently: true });
    sampling.drawImage(canvas, 0, 0, 64, 64);
    const seed = extractSeed(sampling.getImageData(0, 0, 64, 64).data);
    return {
      version: 1,
      image: canvas.toDataURL('image/webp', 0.88),
      seed,
      mode: 'auto',
      name: name.replace(/\.[^.]+$/, '').slice(0, 80),
    };
  }
  async function fromDataUrl(url) {
    if (
      typeof url !== 'string' ||
      url.length > 8 * 1024 * 1024 ||
      !/^data:image\/(jpeg|png|webp);base64,[A-Za-z\d+/=]+$/.test(url)
    )
      throw new Error('invalid-image');
    return recordFromImage(await imageFromUrl(url), 'Daily wallpaper');
  }
  async function fromFile(file) {
    if (!file || !/^image\/(png|jpeg|webp)$/.test(file.type))
      throw new Error('image-format');
    if (file.size > 20 * 1024 * 1024) throw new Error('image-size');
    const url = root.URL.createObjectURL(file);
    try {
      const image = await imageFromUrl(url);
      return recordFromImage(image, file.name);
    } finally {
      root.URL.revokeObjectURL(url);
    }
  }
  function storage(action, value) {
    return new Promise((resolve, reject) => {
      const request = root.indexedDB.open('listen2-appearance', 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore('wallpaper');
      request.onerror = () => reject(new Error('image-storage'));
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction(
          'wallpaper',
          action === 'get' ? 'readonly' : 'readwrite'
        );
        const objectStore = transaction.objectStore('wallpaper');
        let operation;
        if (action === 'get') operation = objectStore.get('current');
        else if (action === 'put')
          operation = objectStore.put(value, 'current');
        else operation = objectStore.delete('current');
        transaction.oncomplete = () => {
          database.close();
          resolve(operation.result);
        };
        const failure = () => {
          database.close();
          reject(new Error('image-storage'));
        };
        transaction.onabort = failure;
        transaction.onerror = failure;
      };
    });
  }
  async function load() {
    const record = await storage('get');
    if (!record) return null;
    if (
      record.version !== 1 ||
      typeof record.image !== 'string' ||
      record.image.length > 8 * 1024 * 1024 ||
      !/^data:image\/(webp|png);base64,[A-Za-z\d+/=]+$/.test(record.image) ||
      !record.seed ||
      ![
        'hue',
        'saturation',
        'accentHue',
        'accentSaturation',
        'brightness',
      ].every((key) => Number.isFinite(record.seed[key]))
    )
      throw new Error('invalid-image');
    return record;
  }
  const api = {
    extractSeed,
    makePalette,
    contrast,
    fromFile,
    fromDataUrl,
    load,
    save: (record) => storage('put', record),
    remove: () => storage('delete'),
  };
  if (root.document) root.Listen2Wallpaper = api;
  else if (typeof module !== 'undefined') module.exports = api;
})(typeof window === 'undefined' ? globalThis : window);
