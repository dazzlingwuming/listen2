const HISTORY_KEY = "listeningHistoryV1";
const SCHEMA_VERSION = 1;
const MAX_SESSION_MARKERS = 2000;

function emptyState(now = Date.now()) {
  return {
    version: SCHEMA_VERSION,
    enabled: true,
    recordingSince: now,
    tracks: {},
    days: {},
    sessions: {},
  };
}

function finiteNonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function safeText(value, maxLength = 500) {
  return typeof value === "string" ? value.slice(0, maxLength) : "";
}

function safeKey(value, maxLength = 300) {
  const text = safeText(value, maxLength).trim();
  if (!text || ["__proto__", "constructor", "prototype"].includes(text)) {
    return "";
  }
  return text;
}

function localParts(timestamp) {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return {
    year: String(year),
    month: `${year}-${month}`,
    day: `${year}-${month}-${day}`,
    hour: date.getHours(),
  };
}

function normalizeState(input, now) {
  if (!input || input.version !== SCHEMA_VERSION) return emptyState(now);
  return {
    version: SCHEMA_VERSION,
    enabled: input.enabled !== false,
    recordingSince:
      Number.isFinite(input.recordingSince) && input.recordingSince > 0
        ? input.recordingSince
        : now,
    tracks: input.tracks && typeof input.tracks === "object" ? input.tracks : {},
    days: input.days && typeof input.days === "object" ? input.days : {},
    sessions:
      input.sessions && typeof input.sessions === "object" ? input.sessions : {},
  };
}

function qualificationThreshold(duration) {
  const seconds = finiteNonNegative(duration);
  if (seconds <= 30) return Infinity;
  return Math.min(seconds / 2, 240);
}

class ListeningHistoryStore {
  constructor({ store, now = () => Date.now() } = {}) {
    if (!store || typeof store.get !== "function" || typeof store.set !== "function") {
      throw new TypeError("A get/set store is required");
    }
    this.store = store;
    this.now = now;
  }

  read() {
    return normalizeState(this.store.get(HISTORY_KEY), this.now());
  }

  write(state) {
    this.store.set(HISTORY_KEY, state);
  }

  status() {
    const state = this.read();
    return {
      ok: true,
      supported: true,
      enabled: state.enabled,
      recordingSince: state.recordingSince,
    };
  }

  setEnabled(enabled) {
    const state = this.read();
    state.enabled = enabled !== false;
    this.write(state);
    return this.status();
  }

  ingest(payload = {}) {
    const state = this.read();
    if (!state.enabled) return { ok: true, status: "disabled" };
    const sessionId = safeKey(payload.sessionId, 160);
    const trackId = safeKey(payload.track && payload.track.id, 200);
    const source = safeKey(payload.track && payload.track.source, 40) || "unknown";
    const cumulative = finiteNonNegative(payload.cumulativePlayedSeconds);
    const timestamp = Number(payload.occurredAt) || this.now();
    const parts = localParts(timestamp);
    if (!sessionId || !trackId || !parts) {
      return { ok: false, status: "invalid-payload" };
    }

    const marker = state.sessions[sessionId] || {
      cumulativePlayedSeconds: 0,
      qualified: false,
      updatedAt: timestamp,
    };
    const delta = Math.max(0, cumulative - finiteNonNegative(marker.cumulativePlayedSeconds));
    const duration = finiteNonNegative(payload.duration || (payload.track && payload.track.duration));
    const becomesQualified =
      !marker.qualified && cumulative >= qualificationThreshold(duration);
    if (delta <= 0 && !becomesQualified) {
      return { ok: true, status: "duplicate", qualified: marker.qualified };
    }

    const key = `${source}:${trackId}`;
    const previous = state.tracks[key] || {
      id: trackId,
      source,
      title: "",
      artist: "",
      album: "",
      imgUrl: "",
      totalPlayedSeconds: 0,
      playCount: 0,
      years: {},
    };
    const snapshot = payload.track || {};
    Object.assign(previous, {
      title: safeText(snapshot.title) || previous.title,
      artist: safeText(snapshot.artist) || previous.artist,
      album: safeText(snapshot.album) || previous.album,
      imgUrl: safeText(snapshot.img_url || snapshot.imgUrl, 2000) || previous.imgUrl,
      duration: duration || previous.duration || 0,
      lastPlayedAt: timestamp,
      totalPlayedSeconds: finiteNonNegative(previous.totalPlayedSeconds) + delta,
      playCount: finiteNonNegative(previous.playCount) + (becomesQualified ? 1 : 0),
    });
    const yearStats = previous.years[parts.year] || {
      playedSeconds: 0,
      playCount: 0,
    };
    yearStats.playedSeconds += delta;
    if (becomesQualified) yearStats.playCount += 1;
    previous.years[parts.year] = yearStats;
    state.tracks[key] = previous;

    const day = state.days[parts.day] || {
      playedSeconds: 0,
      playCount: 0,
      hours: {},
    };
    day.playedSeconds += delta;
    if (becomesQualified) day.playCount += 1;
    day.hours[String(parts.hour)] =
      finiteNonNegative(day.hours[String(parts.hour)]) + delta;
    state.days[parts.day] = day;

    state.sessions[sessionId] = {
      cumulativePlayedSeconds: Math.max(
        cumulative,
        finiteNonNegative(marker.cumulativePlayedSeconds)
      ),
      qualified: marker.qualified || becomesQualified,
      updatedAt: timestamp,
    };
    const sessionIds = Object.keys(state.sessions);
    if (sessionIds.length > MAX_SESSION_MARKERS) {
      sessionIds
        .sort(
          (left, right) =>
            finiteNonNegative(state.sessions[left].updatedAt) -
            finiteNonNegative(state.sessions[right].updatedAt)
        )
        .slice(0, sessionIds.length - MAX_SESSION_MARKERS)
        .forEach((id) => delete state.sessions[id]);
    }
    this.write(state);
    return {
      ok: true,
      status: "recorded",
      deltaPlayedSeconds: delta,
      qualified: marker.qualified || becomesQualified,
    };
  }

  annualSummary(yearInput) {
    const state = this.read();
    const year = String(Number(yearInput) || new Date(this.now()).getFullYear());
    const tracks = Object.values(state.tracks)
      .map((track) => ({
        id: track.id,
        source: track.source,
        title: track.title,
        artist: track.artist,
        album: track.album,
        imgUrl: track.imgUrl,
        duration: track.duration || 0,
        playedSeconds: finiteNonNegative(track.years && track.years[year] && track.years[year].playedSeconds),
        playCount: finiteNonNegative(track.years && track.years[year] && track.years[year].playCount),
      }))
      .filter((track) => track.playedSeconds > 0 || track.playCount > 0)
      .sort(
        (left, right) =>
          right.playCount - left.playCount ||
          right.playedSeconds - left.playedSeconds ||
          left.title.localeCompare(right.title)
      );
    const artistMap = Object.create(null);
    tracks.forEach((track) => {
      const artist = track.artist || "Unknown artist";
      const item = artistMap[artist] || {
        artist,
        playedSeconds: 0,
        playCount: 0,
        trackIds: new Set(),
      };
      item.playedSeconds += track.playedSeconds;
      item.playCount += track.playCount;
      item.trackIds.add(`${track.source}:${track.id}`);
      artistMap[artist] = item;
    });
    const days = Object.keys(state.days)
      .filter((day) => day.startsWith(`${year}-`))
      .sort()
      .map((date) => ({ date, ...state.days[date] }));
    const months = Array.from({ length: 12 }, (_, index) => ({
      month: `${year}-${String(index + 1).padStart(2, "0")}`,
      playedSeconds: 0,
      playCount: 0,
    }));
    const hours = Array.from({ length: 24 }, () => 0);
    days.forEach((day) => {
      const month = Number(day.date.slice(5, 7)) - 1;
      if (months[month]) {
        months[month].playedSeconds += finiteNonNegative(day.playedSeconds);
        months[month].playCount += finiteNonNegative(day.playCount);
      }
      Object.keys(day.hours || {}).forEach((hour) => {
        if (hours[Number(hour)] !== undefined) {
          hours[Number(hour)] += finiteNonNegative(day.hours[hour]);
        }
      });
    });
    const totalPlayedSeconds = tracks.reduce(
      (sum, track) => sum + track.playedSeconds,
      0
    );
    const playCount = tracks.reduce((sum, track) => sum + track.playCount, 0);
    const mostActiveDay = days.reduce(
      (best, day) => (!best || day.playedSeconds > best.playedSeconds ? day : best),
      null
    );
    return {
      ok: true,
      year: Number(year),
      enabled: state.enabled,
      recordingSince: state.recordingSince,
      totalPlayedSeconds,
      playCount,
      uniqueTracks: tracks.length,
      uniqueArtists: Object.keys(artistMap).length,
      topTracks: tracks.slice(0, 20),
      topArtists: Object.values(artistMap)
        .map((artist) => ({ ...artist, uniqueTracks: artist.trackIds.size, trackIds: undefined }))
        .sort(
          (left, right) =>
            right.playCount - left.playCount || right.playedSeconds - left.playedSeconds
        )
        .slice(0, 20),
      months,
      hours,
      mostActiveDay,
    };
  }

  export() {
    return { ok: true, exportedAt: this.now(), data: this.read() };
  }

  clear() {
    const current = this.read();
    const next = emptyState(this.now());
    next.enabled = current.enabled;
    this.write(next);
    return { ok: true, recordingSince: next.recordingSince };
  }
}

module.exports = {
  HISTORY_KEY,
  ListeningHistoryStore,
  qualificationThreshold,
};
