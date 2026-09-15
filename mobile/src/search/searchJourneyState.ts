import type {
  PlaylistSummary,
  SearchKind,
  SearchResult,
  SourceId,
  Track,
} from '../types';
import { isSourceId } from '../types';

const MAX_QUERY_LENGTH = 160;
const MAX_ROWS = 200;
const MAX_PAGE = 100;
const MAX_CURSOR_LENGTH = 160;
const MAX_REQUEST_ID_LENGTH = 128;
const MAX_ID_LENGTH = 256;
const MAX_TEXT_LENGTH = 512;
const MAX_ARTWORK_LENGTH = 2048;
const MAX_SCROLL_ANCHOR = 1_000_000;
const MAX_GENERATION = 1_000_000_000;
const MAX_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

export type SearchJourneyScope = {
  source: SourceId;
  query: string;
  kind: SearchKind;
  requestId: string;
  generation: number;
};

export type SearchJourneyTerminal =
  | 'guide'
  | 'loading'
  | 'loading-more'
  | 'ready'
  | 'empty'
  | 'error'
  | 'error-more'
  | 'cancelled'
  | 'cancelled-more';

export type SearchJourneyState = {
  scope: SearchJourneyScope;
  rows: SearchResult[];
  page: number;
  cursor?: string;
  hasMore: boolean;
  /** The page that can be retried without changing source/query/kind. */
  retryPage?: number;
  selectedIdentity?: string;
  scrollAnchor: number;
  terminal: SearchJourneyTerminal;
};

/**
 * Flat, navigation-safe state. It contains only normalized semantic IDs and
 * bounded display data; provider transport never crosses the navigation
 * boundary.
 */
export type SearchJourneyRestorationDto = SearchJourneyScope & {
  rows: SearchResult[];
  page: number;
  cursor?: string;
  hasMore: boolean;
  retryPage?: number;
  selectedIdentity?: string;
  scrollAnchor: number;
  terminal: SearchJourneyTerminal;
};

type SuccessEvent = {
  type: 'success';
  requestId: string;
  generation: number;
  page: number;
  cursor?: string;
  hasMore?: boolean;
  results: SearchResult[];
};

type CancelledEvent = {
  type: 'cancelled';
  requestId: string;
  generation: number;
  page: number;
};

type FailedEvent = {
  type: 'failed';
  requestId: string;
  generation: number;
  page: number;
};

export type SearchJourneyEvent = SuccessEvent | CancelledEvent | FailedEvent;

export function createSearchJourneyState(
  input: SearchJourneyScope &
    Partial<
      Pick<
        SearchJourneyState,
        | 'rows'
        | 'page'
        | 'cursor'
        | 'hasMore'
        | 'retryPage'
        | 'selectedIdentity'
        | 'scrollAnchor'
        | 'terminal'
      >
    >,
): SearchJourneyState {
  const rows = uniqueRows(input.rows ?? []).slice(0, MAX_ROWS);
  const selectedIdentity = safeIdentity(input.selectedIdentity);
  const validSelectedIdentity =
    selectedIdentity &&
    rows.some(row => searchResultIdentity(row) === selectedIdentity)
      ? selectedIdentity
      : undefined;
  return {
    scope: {
      source: safeSource(input.source),
      query: safeQuery(input.query),
      kind: safeKind(input.kind),
      requestId: safeRequestId(input.requestId) ?? 'initial',
      generation: safeGeneration(input.generation),
    },
    rows,
    page: clampPage(input.page ?? 0),
    cursor: safeCursor(input.cursor),
    hasMore: Boolean(input.hasMore) && rows.length < MAX_ROWS,
    retryPage: safeRetryPage(input.retryPage),
    selectedIdentity: validSelectedIdentity,
    scrollAnchor: safeScrollAnchor(input.scrollAnchor),
    terminal: safeTerminal(input.terminal) ?? 'guide',
  };
}

export function reduceSearchJourney(
  state: SearchJourneyState,
  event: SearchJourneyEvent,
): SearchJourneyState {
  if (
    event.requestId !== state.scope.requestId ||
    event.generation !== state.scope.generation ||
    event.page < 1 ||
    event.page > MAX_PAGE
  ) {
    return state;
  }
  if (event.type === 'cancelled' || event.type === 'failed') {
    const hasPriorRows = state.rows.length > 0 && event.page > 1;
    return {
      ...state,
      retryPage: event.page,
      terminal:
        event.type === 'cancelled'
          ? hasPriorRows
            ? 'cancelled-more'
            : 'cancelled'
          : hasPriorRows
          ? 'error-more'
          : 'error',
    };
  }
  // A late first-page response from the same semantic request must not erase
  // an already committed later page. Different generations are rejected
  // above, while this protects an out-of-order page within one generation.
  if (event.page < state.page) return state;
  const rows =
    event.page === 1
      ? uniqueRows(event.results).slice(0, MAX_ROWS)
      : uniqueRows([...state.rows, ...event.results]).slice(0, MAX_ROWS);
  const selectedIdentity =
    state.selectedIdentity &&
    rows.some(row => searchResultIdentity(row) === state.selectedIdentity)
      ? state.selectedIdentity
      : undefined;
  return {
    ...state,
    rows,
    page: event.page,
    cursor: safeCursor(event.cursor),
    hasMore: Boolean(event.hasMore) && rows.length < MAX_ROWS,
    retryPage: undefined,
    selectedIdentity,
    terminal: rows.length ? 'ready' : 'empty',
  };
}

/** Create a sanitized flat DTO suitable for semantic navigation params. */
export function createSearchJourneyRestoration(
  state: SearchJourneyState,
): SearchJourneyRestorationDto {
  const safe = createSearchJourneyState({
    ...state.scope,
    rows: state.rows,
    page: state.page,
    cursor: state.cursor,
    hasMore: state.hasMore,
    retryPage: state.retryPage,
    selectedIdentity: state.selectedIdentity,
    scrollAnchor: state.scrollAnchor,
    terminal: state.terminal,
  });
  return {
    ...safe.scope,
    rows: safe.rows,
    page: safe.page,
    cursor: safe.cursor,
    hasMore: safe.hasMore,
    retryPage: safe.retryPage,
    selectedIdentity: safe.selectedIdentity,
    scrollAnchor: safe.scrollAnchor,
    terminal: safe.terminal,
  };
}

/**
 * Accept either the flat DTO or the historical `{ scope, ...state }` shape,
 * then return a new bounded DTO. Invalid required scope fields reject the
 * restoration instead of silently turning untrusted route data into a query.
 */
export function sanitizeSearchJourneyRestoration(
  value: unknown,
): SearchJourneyRestorationDto | null {
  const record = asRecord(value);
  if (!record) return null;
  const nestedScope = asRecord(record.scope);
  const source = nestedScope?.source ?? record.source;
  const query = nestedScope?.query ?? record.query;
  const kind = nestedScope?.kind ?? record.kind;
  const requestId = nestedScope?.requestId ?? record.requestId;
  const generation = nestedScope?.generation ?? record.generation;
  if (
    !isSourceId(source) ||
    typeof query !== 'string' ||
    !isSearchKind(kind) ||
    !isValidRequestId(requestId) ||
    !isValidGeneration(generation)
  ) {
    return null;
  }
  const rows = Array.isArray(record.rows)
    ? (record.rows as SearchResult[])
    : [];
  const terminal =
    typeof record.terminal === 'string'
      ? (record.terminal as SearchJourneyTerminal)
      : rows.length
      ? 'ready'
      : 'guide';
  return createSearchJourneyRestoration(
    createSearchJourneyState({
      source,
      query,
      kind,
      requestId,
      generation,
      rows,
      page: record.page as number,
      cursor: record.cursor as string | undefined,
      hasMore: record.hasMore as boolean,
      retryPage: record.retryPage as number,
      selectedIdentity: record.selectedIdentity as string | undefined,
      scrollAnchor: record.scrollAnchor as number,
      terminal,
    }),
  );
}

/** Restore only normalized semantic state; callers can skip a network request. */
export function restoreSearchJourneyState(
  value: unknown,
): SearchJourneyState | null {
  const dto = sanitizeSearchJourneyRestoration(value);
  if (!dto) return null;
  return createSearchJourneyState({
    ...dto,
    rows: dto.rows,
    page: dto.page,
    cursor: dto.cursor,
    hasMore: dto.hasMore,
    retryPage: dto.retryPage,
    selectedIdentity: dto.selectedIdentity,
    scrollAnchor: dto.scrollAnchor,
    terminal: dto.terminal,
  });
}

export function setSearchJourneySelection(
  state: SearchJourneyState,
  selectedIdentity?: string,
): SearchJourneyState {
  const safe = safeIdentity(selectedIdentity);
  if (safe && !state.rows.some(row => searchResultIdentity(row) === safe)) {
    return state;
  }
  return createSearchJourneyState({
    ...state.scope,
    rows: state.rows,
    page: state.page,
    cursor: state.cursor,
    hasMore: state.hasMore,
    retryPage: state.retryPage,
    selectedIdentity: safe,
    scrollAnchor: state.scrollAnchor,
    terminal: state.terminal,
  });
}

export function setSearchJourneyScrollAnchor(
  state: SearchJourneyState,
  scrollAnchor: number,
): SearchJourneyState {
  const bounded = safeScrollAnchor(scrollAnchor);
  if (bounded === state.scrollAnchor) return state;
  return createSearchJourneyState({
    ...state.scope,
    rows: state.rows,
    page: state.page,
    cursor: state.cursor,
    hasMore: state.hasMore,
    retryPage: state.retryPage,
    selectedIdentity: state.selectedIdentity,
    scrollAnchor: bounded,
    terminal: state.terminal,
  });
}

export function searchResultIdentity(item: SearchResult): string {
  return item.kind === 'track'
    ? `track:${item.track.source}:${item.track.id}`
    : `playlist:${item.playlist.source}:${item.playlist.id}`;
}

function uniqueRows(rows: readonly unknown[]): SearchResult[] {
  const identities = new Set<string>();
  const normalized: SearchResult[] = [];
  for (const row of rows) {
    const safe = safeSearchResult(row);
    if (!safe) continue;
    const identity = searchResultIdentity(safe);
    if (identities.has(identity)) continue;
    identities.add(identity);
    normalized.push(safe);
  }
  return normalized;
}

function safeSearchResult(value: unknown): SearchResult | null {
  const record = asRecord(value);
  if (!record) return null;
  if (record.kind === 'track') {
    const track = safeTrack(record.track);
    return track ? { kind: 'track', track } : null;
  }
  if (record.kind === 'playlist') {
    const playlist = safePlaylist(record.playlist);
    return playlist ? { kind: 'playlist', playlist } : null;
  }
  return null;
}

function safeTrack(value: unknown): Track | null {
  const record = asRecord(value);
  if (!record) return null;
  const id = safeSemanticId(record?.id);
  const source = record?.source;
  const title = safeText(record?.title);
  const artist = safeText(record?.artist);
  if (!id || !isSourceId(source) || !title || !artist) return null;
  const track: Track = { id, source, title, artist };
  const album = safeText(record.album);
  if (album) track.album = album;
  const durationMs = safeDuration(record.durationMs);
  if (durationMs !== undefined) track.durationMs = durationMs;
  const artworkUrl = safeArtwork(record.artworkUrl);
  if (artworkUrl) track.artworkUrl = artworkUrl;
  const providerAlbumId = safeSemanticId(record.providerAlbumId);
  if (providerAlbumId) track.providerAlbumId = providerAlbumId;
  return track;
}

function safePlaylist(value: unknown): PlaylistSummary | null {
  const record = asRecord(value);
  if (!record) return null;
  const id = safeSemanticId(record?.id);
  const source = record?.source;
  const title = safeText(record?.title);
  if (!id || !isSourceId(source) || !title) return null;
  const result: PlaylistSummary = { id, source, title };
  const author = safeText(record.author);
  if (author) result.author = author;
  const trackCount = safeCount(record.trackCount);
  if (trackCount !== undefined) result.trackCount = trackCount;
  const artworkUrl = safeArtwork(record.artworkUrl);
  if (artworkUrl) result.artworkUrl = artworkUrl;
  return result;
}

function safeScrollAnchor(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.min(value, MAX_SCROLL_ANCHOR)
    : 0;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function safeSource(value: unknown): SourceId {
  return isSourceId(value) ? value : 'netease';
}

function safeKind(value: unknown): SearchKind {
  return isSearchKind(value) ? value : 'track';
}

function isSearchKind(value: unknown): value is SearchKind {
  return value === 'track' || value === 'playlist';
}

function safeQuery(value: unknown): string {
  if (typeof value !== 'string' || hasControlCharacter(value)) return '';
  return value.trim().slice(0, MAX_QUERY_LENGTH);
}

function safeText(value: unknown, maximum = MAX_TEXT_LENGTH): string | null {
  if (typeof value !== 'string' || value.length > maximum) return null;
  const normalized = value.trim();
  return normalized && !hasControlCharacter(normalized) ? normalized : null;
}

function safeSemanticId(value: unknown): string | undefined {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_ID_LENGTH &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)
    ? value
    : undefined;
}

function safeRequestId(value: unknown): string | undefined {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_REQUEST_ID_LENGTH &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)
    ? value
    : undefined;
}

function isValidRequestId(value: unknown): value is string {
  return safeRequestId(value) !== undefined;
}

function safeGeneration(value: unknown): number {
  return isValidGeneration(value) ? value : 0;
}

function isValidGeneration(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= MAX_GENERATION
  );
}

function safeCursor(value: unknown): string | undefined {
  return typeof value === 'string' &&
    value.length <= MAX_CURSOR_LENGTH &&
    !hasControlCharacter(value)
    ? value
    : undefined;
}

function safeIdentity(value: unknown): string | undefined {
  return typeof value === 'string' &&
    value.length <= MAX_ID_LENGTH * 2 &&
    /^[A-Za-z]+:[A-Za-z0-9._:-]+:[A-Za-z0-9._:-]+$/.test(value)
    ? value
    : undefined;
}

function safeRetryPage(value: unknown): number | undefined {
  const page = clampPage(value);
  return page > 0 ? page : undefined;
}

function clampPage(value: unknown): number {
  return Number.isInteger(value) &&
    (value as number) >= 0 &&
    (value as number) <= MAX_PAGE
    ? (value as number)
    : 0;
}

function safeTerminal(value: unknown): SearchJourneyTerminal | undefined {
  return typeof value === 'string' &&
    [
      'guide',
      'loading',
      'loading-more',
      'ready',
      'empty',
      'error',
      'error-more',
      'cancelled',
      'cancelled-more',
    ].includes(value)
    ? (value as SearchJourneyTerminal)
    : undefined;
}

function safeDuration(value: unknown): number | undefined {
  return typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= MAX_DURATION_MS
    ? value
    : undefined;
}

function safeCount(value: unknown): number | undefined {
  return typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= MAX_ROWS * MAX_PAGE
    ? value
    : undefined;
}

function safeArtwork(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > MAX_ARTWORK_LENGTH) {
    return undefined;
  }
  try {
    const url = new URL(value);
    return url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.hash
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some(character => character.charCodeAt(0) <= 0x1f);
}
