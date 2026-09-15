import { parseExactBilibiliTrackId } from '../api/ids';
import type { SourceId } from '../types';

export type LyricSessionKey = Readonly<{
  source: SourceId;
  trackId: string;
  /** Exact Bilibili CID when lyrics require a selected video part. */
  partId: string | null;
  occurrenceId: string;
  revision: number;
}>;

export type LyricSessionState<T = unknown> = Readonly<{
  session?: LyricSessionKey;
  generation: number;
  status: 'idle' | 'loading' | 'ready' | 'error';
  value?: T;
  error?: string;
}>;

export type LyricSessionAction<T = unknown> =
  | { type: 'begin'; session: LyricSessionKey }
  | { type: 'resolve'; session: LyricSessionKey; generation: number; value: T }
  | { type: 'reject'; session: LyricSessionKey; generation: number; error: string }
  | { type: 'settle'; session: LyricSessionKey; generation: number };

/**
 * Construct a closed semantic key. The selected Bilibili CID is derived from
 * the canonical track identifier; titles, media URLs and queue indexes never
 * participate in lyric identity.
 */
export function createLyricSession(input: {
  source: SourceId;
  trackId: string;
  occurrenceId: string;
  revision: number;
}): LyricSessionKey | null {
  if (
    typeof input.trackId !== 'string' ||
    !input.trackId ||
    typeof input.occurrenceId !== 'string' ||
    !input.occurrenceId ||
    !Number.isSafeInteger(input.revision) ||
    input.revision < 0
  )
    return null;
  const exactPart =
    input.source === 'bilibili'
      ? parseExactBilibiliTrackId(input.trackId)
      : null;
  if (input.source === 'bilibili' && !exactPart) return null;
  return Object.freeze({
    source: input.source,
    trackId: input.trackId,
    partId: exactPart?.cid ?? null,
    occurrenceId: input.occurrenceId,
    revision: input.revision,
  });
}

export function lyricSessionKey(session: LyricSessionKey): string {
  return [
    session.source,
    session.trackId,
    session.partId ?? '-',
    session.occurrenceId,
    String(session.revision),
  ].join('|');
}

function matches(
  left: LyricSessionKey | undefined,
  right: LyricSessionKey,
): boolean {
  return Boolean(left && lyricSessionKey(left) === lyricSessionKey(right));
}

/** A late callback is a no-op unless it belongs to the current generation. */
export function reduceLyricSession<T>(
  state: LyricSessionState<T>,
  action: LyricSessionAction<T>,
): LyricSessionState<T> {
  if (action.type === 'begin')
    return {
      session: action.session,
      generation: state.generation + 1,
      status: 'loading',
    };
  if (!matches(state.session, action.session) || state.generation !== action.generation)
    return state;
  if (action.type === 'resolve')
    return {
      ...state,
      status: 'ready',
      value: action.value,
      error: undefined,
    };
  if (action.type === 'reject')
    return { ...state, status: 'error', error: action.error, value: undefined };
  return state.status === 'loading' ? { ...state, status: 'idle' } : state;
}
