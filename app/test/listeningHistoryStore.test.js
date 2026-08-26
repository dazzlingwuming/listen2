const assert = require("assert");
const { ListeningHistoryStore, qualificationThreshold } = require("../listeningHistoryStore");

class MemoryStore {
  constructor() {
    this.values = {};
  }
  get(key) {
    return this.values[key];
  }
  set(key, value) {
    this.values[key] = JSON.parse(JSON.stringify(value));
  }
}

const now = new Date(2026, 7, 26, 21, 0, 0).getTime();
const memory = new MemoryStore();
const history = new ListeningHistoryStore({ store: memory, now: () => now });
const track = {
  id: "bitrack_v_demo-1",
  source: "bilibili",
  title: "Demo",
  artist: "Artist",
  album: "Album",
  img_url: "https://example.test/cover.jpg",
  duration: 220,
};

assert.strictEqual(qualificationThreshold(220), 110);
assert.strictEqual(qualificationThreshold(1000), 240);
assert.strictEqual(qualificationThreshold(30), Infinity);

assert.deepStrictEqual(history.status().enabled, true);
let result = history.ingest({
  sessionId: "session-1",
  track,
  cumulativePlayedSeconds: 60,
  duration: 220,
  occurredAt: now,
});
assert.strictEqual(result.deltaPlayedSeconds, 60);
assert.strictEqual(result.qualified, false);

result = history.ingest({
  sessionId: "session-1",
  track,
  cumulativePlayedSeconds: 120,
  duration: 220,
  occurredAt: now,
});
assert.strictEqual(result.deltaPlayedSeconds, 60);
assert.strictEqual(result.qualified, true);

result = history.ingest({
  sessionId: "session-1",
  track,
  cumulativePlayedSeconds: 120,
  duration: 220,
  occurredAt: now,
});
assert.strictEqual(result.status, "duplicate");

history.ingest({
  sessionId: "session-2",
  track: { ...track, id: "bitrack_v_demo-2", title: "Second" },
  cumulativePlayedSeconds: 250,
  duration: 500,
  occurredAt: now + 3600000,
});

const summary = history.annualSummary(2026);
assert.strictEqual(summary.totalPlayedSeconds, 370);
assert.strictEqual(summary.playCount, 2);
assert.strictEqual(summary.uniqueTracks, 2);
assert.strictEqual(summary.uniqueArtists, 1);
assert.strictEqual(summary.topTracks[0].title, "Second");
assert.strictEqual(summary.months[7].playedSeconds, 370);
assert.strictEqual(summary.hours[21], 120);
assert.strictEqual(summary.hours[22], 250);

history.setEnabled(false);
result = history.ingest({
  sessionId: "session-3",
  track,
  cumulativePlayedSeconds: 200,
  duration: 220,
  occurredAt: now,
});
assert.strictEqual(result.status, "disabled");
assert.strictEqual(history.annualSummary(2026).totalPlayedSeconds, 370);

history.clear();
assert.strictEqual(history.status().enabled, false);
assert.strictEqual(history.annualSummary(2026).totalPlayedSeconds, 0);
console.log("listeningHistoryStore tests passed");
