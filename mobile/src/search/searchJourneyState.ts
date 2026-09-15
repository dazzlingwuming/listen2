import type { SearchKind, SearchResult, SourceId } from '../types';

const MAX_QUERY_LENGTH = 160;
const MAX_ROWS = 200;
const MAX_PAGE = 100;

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
  | 'cancelled'
  | 'cancelled-more';

export type SearchJourneyState = {
  scope: SearchJourneyScope;
  rows: SearchResult[];
  page: number;
  cursor?: string;
  hasMore: boolean;
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

export type SearchJourneyEvent = SuccessEvent | CancelledEvent;

export function createSearchJourneyState(
  input: SearchJourneyScope &
    Partial<
      Pick<
        SearchJourneyState,
        | 'rows'
        | 'page'
        | 'cursor'
        | 'hasMore'
        | 'selectedIdentity'
        | 'scrollAnchor'
        | 'terminal'
      >
    >,
): SearchJourneyState {
  const query = input.query.trim().slice(0, MAX_QUERY_LENGTH);
  return {
    scope: { ...input, query },
    rows: uniqueRows(input.rows ?? []).slice(0, MAX_ROWS),
    page: clampPage(input.page ?? 0),
    cursor: safeCursor(input.cursor),
    hasMore: Boolean(input.hasMore),
    selectedIdentity: safeIdentity(input.selectedIdentity),
    scrollAnchor: safeScrollAnchor(input.scrollAnchor),
    terminal: input.terminal ?? 'guide',
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
  if (event.type === 'cancelled') {
    return {
      ...state,
      terminal:
        state.rows.length && event.page > 1 ? 'cancelled-more' : 'cancelled',
    };
  }
  const rows =
    event.page === 1
      ? uniqueRows(event.results).slice(0, MAX_ROWS)
      : uniqueRows([...state.rows, ...event.results]).slice(0, MAX_ROWS);
  return {
    ...state,
    rows,
    page: event.page,
    cursor: safeCursor(event.cursor),
    hasMore: Boolean(event.hasMore) && rows.length < MAX_ROWS,
    terminal: rows.length ? 'ready' : 'empty',
  };
}

export function searchResultIdentity(item: SearchResult): string {
  return item.kind === 'track'
    ? `track:${item.track.source}:${item.track.id}`
    : `playlist:${item.playlist.source}:${item.playlist.id}`;
}

function uniqueRows(rows: SearchResult[]): SearchResult[] {
  const identities = new Set<string>();
  return rows.filter(row => {
    const identity = searchResultIdentity(row);
    if (identities.has(identity)) return false;
    identities.add(identity);
    return true;
  });
}

function clampPage(value: number): number {
  return Number.isInteger(value) && value >= 0 && value <= MAX_PAGE ? value : 0;
}

function safeCursor(value?: string): string | undefined {
  return typeof value === 'string' && value.length <= 160 ? value : undefined;
}

function safeIdentity(value?: string): string | undefined {
  return typeof value === 'string' && value.length <= 256 ? value : undefined;
}

function safeScrollAnchor(value?: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.min(value, 1_000_000)
    : 0;
}
