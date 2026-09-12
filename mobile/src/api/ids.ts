import type { SourceId } from '../types';

const TRACK_ID_PATTERNS: Readonly<Record<SourceId, RegExp>> = {
  netease: /^netrack_[1-9][0-9]{0,17}$/,
  kugou: /^kgtrack_[A-Za-z0-9]{8,128}$/,
  kuwo: /^kwtrack_[1-9][0-9]{0,17}$/,
  qq: /^qqtrack_[A-Za-z0-9_-]{1,128}$/,
  bilibili:
    /^(?:bitrack_[1-9][0-9]{0,17}|bitrack_v_BV[0-9A-Za-z]{6,32}(?:-[1-9][0-9]{0,18})?)$/,
};

const PLAYLIST_ID_PATTERNS: Readonly<Record<SourceId, RegExp>> = {
  netease: /^neplaylist_[1-9][0-9]{0,17}$/,
  kugou: /^kgplaylist_[1-9][0-9]{0,17}$/,
  kuwo: /^kwplaylist_[1-9][0-9]{0,17}$/,
  qq: /^qqplaylist_[1-9][0-9]{0,17}$/,
  bilibili: /^biplaylist_[1-9][0-9]{0,17}$/,
};

export function sourceForTrackId(value: string): SourceId | null {
  const sourceIds = Object.keys(TRACK_ID_PATTERNS) as SourceId[];
  return (
    sourceIds.find(source => TRACK_ID_PATTERNS[source].test(value)) ?? null
  );
}

export function sourceForPlaylistId(value: string): SourceId | null {
  const sourceIds = Object.keys(PLAYLIST_ID_PATTERNS) as SourceId[];
  return (
    sourceIds.find(source => PLAYLIST_ID_PATTERNS[source].test(value)) ?? null
  );
}

export function providerId(trackId: string): string {
  return trackId.slice(trackId.indexOf('_') + 1);
}
