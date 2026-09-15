import {
  PLAY_MODE,
  shuffleIndexes,
  type HistoryEntry,
  type PlayMode,
  type PlayerState,
  type PlayNextOccurrence,
} from './playerSlice';
import { isSourceId, type Track } from '../types/provider';
import type { PlayableTrack } from '../types/music';

const MAX_PLAYLIST_ITEMS = 1000;
const MAX_PLAY_NEXT_ITEMS = 200;
const MAX_HISTORY_ITEMS = 200;
let persistedOccurrenceSequence = 0;

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function string(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= max
    ? value
    : null;
}

function number(value: unknown, fallback = 0, maximum = 86_400): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(maximum, value))
    : fallback;
}

/** Copy only semantic fields so RNTP URLs, headers and native IDs never re-enter Redux. */
function sanitizeTrack(value: unknown): PlayableTrack | null {
  const candidate = record(value);
  if (!candidate) return null;
  const id = string(candidate.id, 256);
  const title = string(candidate.title, 512);
  const artist = string(candidate.artist, 512);
  if (!id || !title || !artist) return null;

  if (candidate.source === 'local') {
    // Player Redux persistence is portable semantic state. A document URI is
    // a revocable native grant, so a later launch must explicitly reselect it.
    return null;
  }

  if (!isSourceId(candidate.source)) return null;
  const track: Track = { id, source: candidate.source, title, artist };
  const album = string(candidate.album, 512);
  const artworkUrl = string(candidate.artworkUrl, 2048);
  const providerAlbumId = string(candidate.providerAlbumId, 256);
  const durationMs = number(candidate.durationMs, 0, 86_400_000);
  if (album) track.album = album;
  if (artworkUrl) track.artworkUrl = artworkUrl;
  if (providerAlbumId) track.providerAlbumId = providerAlbumId;
  if (durationMs) track.durationMs = durationMs;
  return track;
}

function occurrenceId(value: unknown, used: Set<string>): string {
  const supplied = string(value, 128);
  if (supplied && !used.has(supplied)) {
    used.add(supplied);
    return supplied;
  }
  let minted = '';
  do {
    persistedOccurrenceSequence += 1;
    minted = `restored-${persistedOccurrenceSequence.toString(36)}`;
  } while (used.has(minted));
  used.add(minted);
  return minted;
}

function sanitizeOccurrences(value: unknown): PlayNextOccurrence[] {
  if (!Array.isArray(value)) return [];
  const used = new Set<string>();
  const occurrences: PlayNextOccurrence[] = [];
  for (const item of value.slice(0, MAX_PLAY_NEXT_ITEMS)) {
    const candidate = record(item);
    const track = sanitizeTrack(candidate?.track ?? item);
    if (!track) continue;
    occurrences.push({
      ...track,
      occurrenceId: occurrenceId(candidate?.occurrenceId, used),
      track,
    });
  }
  return occurrences;
}

function validMode(value: unknown): PlayMode {
  return value === PLAY_MODE.LOOP ||
    value === PLAY_MODE.SHUFFLE ||
    value === PLAY_MODE.REPEAT_ONE
    ? value
    : PLAY_MODE.LOOP;
}

function validShuffleOrder(value: unknown, length: number): number[] {
  if (
    Array.isArray(value) &&
    value.length === length &&
    value.every(
      index => Number.isInteger(index) && index >= 0 && index < length,
    ) &&
    new Set(value).size === length
  )
    return value.slice();
  return shuffleIndexes(length, () => 0.5);
}

function sanitizeHistory(
  value: unknown,
  playlist: PlayableTrack[],
): HistoryEntry[] {
  if (!Array.isArray(value)) return [];
  const result: HistoryEntry[] = [];
  for (const item of value.slice(-MAX_HISTORY_ITEMS)) {
    const candidate = record(item);
    const track = sanitizeTrack(candidate?.track);
    const playlistIndex = candidate?.playlistIndex;
    const source = candidate?.source;
    const validPlaylistIndex =
      source === 'playlist' &&
      typeof playlistIndex === 'number' &&
      Number.isInteger(playlistIndex) &&
      playlistIndex >= 0 &&
      playlistIndex < playlist.length;
    const validPlayNextIndex =
      source === 'play-next' &&
      typeof playlistIndex === 'number' &&
      Number.isInteger(playlistIndex) &&
      playlistIndex >= -1 &&
      playlistIndex < playlist.length;
    if (!track || (!validPlaylistIndex && !validPlayNextIndex))
      continue;
    result.push({
      track,
      playlistIndex: playlistIndex as number,
      source,
      position: number(candidate?.position),
      occurrenceId: string(candidate?.occurrenceId, 128),
    });
  }
  return result;
}

/** Pure, version-independent inbound boundary for persisted player semantics. */
export function sanitizePlayerState(value: unknown): PlayerState {
  const source = record(value) || {};
  const playlist = Array.isArray(source.playlist)
    ? source.playlist
        .slice(0, MAX_PLAYLIST_ITEMS)
        .map(sanitizeTrack)
        .filter((track): track is PlayableTrack => Boolean(track))
    : [];
  const playNextQueue = sanitizeOccurrences(source.playNextQueue);
  const currentIndex =
    Number.isInteger(source.currentIndex) &&
    (source.currentIndex as number) >= 0 &&
    (source.currentIndex as number) < playlist.length
      ? (source.currentIndex as number)
      : -1;
  const currentSource: PlayerState['currentSource'] =
    source.currentSource === 'play-next' ? 'play-next' : 'playlist';
  const requestedCurrent = sanitizeTrack(
    source.currentTrack ?? source.nowPlaying,
  );
  const currentOccurrenceId = string(source.currentOccurrenceId, 128);
  const currentFromPlaylist =
    currentSource === 'playlist' && currentIndex >= 0
      ? playlist[currentIndex]
      : null;
  const currentFromOccurrence =
    currentSource === 'play-next' && currentOccurrenceId
      ? playNextQueue.find(item => item.occurrenceId === currentOccurrenceId)
          ?.track || null
      : null;
  const currentFromConsumedOccurrence =
    currentSource === 'play-next' && currentOccurrenceId
      ? requestedCurrent
      : null;
  const currentTrack =
    currentFromPlaylist && requestedCurrent?.id === currentFromPlaylist.id
      ? currentFromPlaylist
      : currentFromOccurrence &&
        requestedCurrent?.id === currentFromOccurrence.id
      ? currentFromOccurrence
      : currentFromConsumedOccurrence
      ? currentFromConsumedOccurrence
      : null;
  const normalizedCurrentSource = currentTrack ? currentSource : 'playlist';
  const normalizedIndex = currentTrack ? currentIndex : -1;
  const order = validShuffleOrder(source.shuffleOrder, playlist.length);
  const cursor =
    Number.isInteger(source.shuffleCursor) &&
    (source.shuffleCursor as number) >= 0 &&
    (source.shuffleCursor as number) < order.length
      ? (source.shuffleCursor as number)
      : -1;

  return {
    playlist,
    tracks: playlist,
    queue: playlist,
    nowPlaying: currentTrack,
    currentTrack,
    currentIndex: normalizedIndex,
    currentSource: normalizedCurrentSource,
    currentOccurrenceId:
      normalizedCurrentSource === 'play-next' ? currentOccurrenceId : null,
    playNextQueue,
    history: sanitizeHistory(source.history, playlist),
    playMode: validMode(source.playMode),
    shuffleOrder: order,
    shuffleCursor: cursor,
    // Rehydrate must always be user-resumed, never transport-autoplayed.
    isPlaying: false,
    position: number(source.position),
    duration: 0,
    bufferedPosition: 0,
    volume: Math.max(0, Math.min(1, number(source.volume, 1, 1))),
    muted: source.muted === true,
    error: null,
    transitionToken: 0,
    acceptedTransitionToken: 0,
  };
}

/** Named migration so tests and redux-persist use the exact same boundary. */
export function migratePlayerState(value: unknown): PlayerState {
  return sanitizePlayerState(value);
}
