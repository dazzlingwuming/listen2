import type { SourceId } from '../types';

const TRACK_ID_PATTERNS: Readonly<Record<SourceId, RegExp>> = {
  netease: /^netrack_[1-9][0-9]{0,17}$/,
  kugou: /^kgtrack_[A-Za-z0-9]{8,128}$/,
  kuwo: /^kwtrack_[1-9][0-9]{0,17}$/,
  qq: /^qqtrack_[A-Za-z0-9_-]{1,128}$/,
  bilibili:
    /^(?:bitrack_[1-9][0-9]{0,17}|bitrack_v_BV[0-9A-Za-z]{6,32}(?:-[1-9][0-9]{0,18})?)$/,
};

const PLAYLIST_ID_PREFIXES: Readonly<Record<SourceId, string>> = {
  netease: 'neplaylist_',
  kugou: 'kgplaylist_',
  kuwo: 'kwplaylist_',
  qq: 'qqplaylist_',
  bilibili: 'biplaylist_',
};

const KUGOU_CHART_ID_PREFIX = 'kgchart_';

/**
 * Preserve a provider collection ID's decimal representation before selecting
 * an adapter. This prevents unsafe JavaScript-number rounding from choosing a
 * different collection than the one the caller supplied.
 */
export function isCanonicalPositiveSafeIntegerText(
  value: unknown,
): value is string {
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,17}$/.test(value)) {
    return false;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 && String(parsed) === value;
}

function hasCollectionIdPrefix(value: string, prefix: string): boolean {
  return (
    value.startsWith(prefix) &&
    isCanonicalPositiveSafeIntegerText(value.slice(prefix.length))
  );
}

export function sourceForTrackId(value: string): SourceId | null {
  const sourceIds = Object.keys(TRACK_ID_PATTERNS) as SourceId[];
  return (
    sourceIds.find(source => TRACK_ID_PATTERNS[source].test(value)) ?? null
  );
}

export function sourceForPlaylistId(value: string): SourceId | null {
  if (hasCollectionIdPrefix(value, KUGOU_CHART_ID_PREFIX)) return 'kugou';
  const sourceIds = Object.keys(PLAYLIST_ID_PREFIXES) as SourceId[];
  return (
    sourceIds.find(source =>
      hasCollectionIdPrefix(value, PLAYLIST_ID_PREFIXES[source]),
    ) ?? null
  );
}

export function providerId(trackId: string): string {
  return trackId.slice(trackId.indexOf('_') + 1);
}
