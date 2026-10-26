const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createDailyTheme,
  localDate,
} = require("../listen1_chrome_extension/js/daily_theme");
const tick = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const photo = (date = "2026-10-25", image = "original") => ({
  version: 1,
  date,
  sourceDate: date,
  image,
  title: "Landscape",
  copyright: "Credit",
});
const response = (status = "fresh", date = "2026-10-25", image) => ({
  ok: true,
  status,
  requestedDate: date,
  wallpaper: photo(date, image),
});
function fixture(overrides = {}) {
  let date = new Date(2026, 9, 25, 23, 59, 50);
  const calls = [];
  const states = [];
  const timers = new Map();
  const events = new Map();
  let nextTimer = 0;
  let cancels = 0;
  let prepares = 0;
  const target = {
    addEventListener: (key, fn) => events.set(key, fn),
    removeEventListener: (key) => events.delete(key),
  };
  const controller = createDailyTheme({
    request: (payload) => {
      calls.push(payload);
      return overrides.request
        ? overrides.request(payload, calls.length)
        : Promise.resolve(response());
    },
    cancel: () => {
      cancels += 1;
    },
    prepare: async (wallpaper) => {
      prepares += 1;
      if (overrides.prepare) return overrides.prepare(wallpaper);
      return {
        wallpaper: { ...wallpaper, image: `decoded:${wallpaper.image}` },
        palette: { base: "dark" },
      };
    },
    onChange: (state) => states.push(state),
    now: () => date,
    setTimer: (fn, delay) => {
      const id = ++nextTimer;
      timers.set(id, { fn, delay });
      return id;
    },
    clearTimer: (id) => timers.delete(id),
    windowTarget: target,
    documentTarget: target,
  });
  return {
    controller,
    calls,
    states,
    timers,
    events,
    setDate(value) {
      date = value;
    },
    get cancels() {
      return cancels;
    },
    get prepares() {
      return prepares;
    },
  };
}

test("inactive theme does no IPC; selection hydrates without network before refresh and decodes once", async () => {
  const f = fixture();
  f.controller.check();
  f.events.get("focus")();
  assert.equal(f.calls.length, 0);
  f.controller.select(true);
  await tick();
  assert.deepEqual(f.calls, [{ refresh: false }, { refresh: true }]);
  assert.equal(f.prepares, 1);
  assert.equal(f.states.at(-1).wallpaper.image, "decoded:original");
  assert.equal(f.states.at(-1).status, "fresh");
  f.controller.check();
  f.controller.select(true);
  assert.equal(f.calls.length, 2);
  f.controller.dispose();
  assert.equal(f.timers.size, 0);
  assert.equal(f.events.size, 0);
});

test("local date is calendar-based; midnight and focus refresh once and same-day focus does not", async () => {
  const f = fixture({
    request: () => Promise.resolve(response("fresh", "2026-10-26")),
  });
  const local = new Date(2026, 9, 25, 23, 59, 50);
  assert.equal(localDate(local), "2026-10-25");
  f.controller.select(true);
  await tick();
  assert.equal([...f.timers.values()][0].delay, 10000);
  f.setDate(new Date(2026, 9, 26, 0, 0, 5));
  f.events.get("focus")();
  f.events.get("visibilitychange")();
  await tick();
  assert.equal(f.calls.length, 3);
  f.events.get("focus")();
  assert.equal(f.calls.length, 3);
  // An active time-zone/clock change is detected by the bounded date timer.
  f.setDate(new Date(2026, 9, 25, 22, 0));
  [...f.timers.values()][0].fn();
  await tick();
  assert.equal(f.calls.length, 4);
  f.controller.dispose();
});

test("stale fallback remains usable; failed refresh retries after 30 minutes without a busy timer", async () => {
  const f = fixture({
    request: (payload) =>
      Promise.resolve(
        payload.refresh
          ? { ok: false, status: "unavailable" }
          : response("stale", "2026-10-24")
      ),
  });
  f.setDate(new Date(2026, 9, 25, 12, 0));
  f.controller.select(true);
  await tick();
  assert.equal(f.states.at(-1).status, "stale");
  assert.equal(f.states.at(-1).wallpaper.date, "2026-10-24");
  f.setDate(new Date(2026, 9, 25, 12, 29));
  f.events.get("focus")();
  assert.equal(f.calls.length, 2);
  f.setDate(new Date(2026, 9, 25, 12, 31));
  f.controller.check();
  await tick();
  assert.equal(f.calls.length, 3);
  assert([...f.timers.values()][0].delay >= 1000);
  f.controller.dispose();
});

test("missing cache and offline request keep selected fallback with unavailable state", async () => {
  const f = fixture({
    request: async () => ({ ok: false, status: "unavailable" }),
  });
  f.controller.select(true);
  await tick();
  assert.equal(f.states.at(-1).status, "unavailable");
  assert.equal(f.states.at(-1).wallpaper, null);
  f.controller.dispose();
});

test("deselection cancels immediately and neither late cache nor decode can replace another theme", async () => {
  const wait = deferred();
  const f = fixture({ request: () => wait.promise });
  f.controller.select(true);
  f.controller.select(false);
  assert.equal(f.cancels, 1);
  const count = f.states.length;
  wait.resolve(response());
  await tick();
  assert.equal(f.calls.length, 1);
  assert.equal(f.states.length, count);
  assert.equal(f.prepares, 0);
  assert.equal(f.timers.size, 0);
  f.controller.dispose();

  const decode = deferred();
  const g = fixture({ prepare: () => decode.promise });
  g.controller.select(true);
  await tick();
  g.controller.select(false);
  const stateCount = g.states.length;
  decode.resolve({ wallpaper: photo(), palette: {} });
  await tick();
  assert.equal(g.states.length, stateCount);
  assert.equal(g.calls.length, 1);
  g.controller.dispose();
});

test("invalid new image preserves last good image and reports stale", async () => {
  const f = fixture({
    request: (payload) =>
      Promise.resolve(
        response(
          payload.refresh ? "fresh" : "cached",
          "2026-10-25",
          payload.refresh ? "bad" : "good"
        )
      ),
    prepare: async (wallpaper) => {
      if (wallpaper.image === "bad") throw new Error("invalid-image");
      return { wallpaper, palette: {} };
    },
  });
  f.controller.select(true);
  await tick();
  assert.equal(f.states.at(-1).status, "stale");
  assert.equal(f.states.at(-1).wallpaper.image, "good");
  f.controller.dispose();
});
