import { ProviderClientError } from '../api/errors';
import { parseExactBilibiliTrackId } from '../api/ids';
import { getNetEaseLyric, getQqLyric, providerFor } from '../api/providers';
import type { Lyric, ProviderRequestOptions, Track } from '../types/provider';
import type { BilibiliLyricCandidate } from './types';

export const AUTO_MATCH_THRESHOLD = 0.93;
const MAX_CANDIDATES_PER_PROVIDER = 6;
const MAX_DISPLAY_CANDIDATES = 10;
const MAX_LYRIC_BYTES = 512 * 1024;

function bytes(value: string) {
  return encodeURIComponent(value).replace(/%[0-9a-f]{2}/gi, 'x').length;
}

function normalize(value: string) {
  return value
    .normalize('NFC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '')
    .trim();
}

function titleVariants(value: string) {
  const variants = new Set<string>();
  const add = (candidate: string) => {
    const normalized = normalize(candidate);
    if (normalized) variants.add(normalized);
  };
  add(value);
  value.split(/[-–—()[\]【】]/).forEach(add);
  return [...variants].slice(0, 8);
}

function ratio(left: string, right: string) {
  if (!left || !right) return 0;
  if (left === right) return 1;
  const short = left.length < right.length ? left : right;
  const long = left.length < right.length ? right : left;
  return long.includes(short) ? short.length / long.length : 0;
}

function hasTimedText(value: string) {
  // eslint-disable-next-line no-control-regex -- lyric boundary rejects unsafe controls.
  const unsafe = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value);
  return (
    bytes(value) <= MAX_LYRIC_BYTES &&
    !unsafe &&
    /\[\d{1,3}:[0-5]\d(?:\.\d{1,3})?\]/.test(value)
  );
}

export function scoreBilibiliCandidate(
  track: Track,
  candidate: Pick<BilibiliLyricCandidate, 'title' | 'artist' | 'durationMs'>,
  rank = 0,
) {
  const titles = titleVariants(track.title);
  const candidateTitle = normalize(candidate.title);
  const title = Math.max(
    0,
    ...titles.map(value => ratio(value, candidateTitle)),
  );
  const artist = ratio(normalize(track.artist), normalize(candidate.artist));
  const duration =
    track.durationMs && candidate.durationMs
      ? Math.max(
          0,
          1 -
            Math.abs(track.durationMs - candidate.durationMs) /
              Math.max(track.durationMs, candidate.durationMs),
        )
      : 0;
  const versionPenalty =
    /(?:live|cover|remix|伴奏|现场|翻唱)/i.test(candidate.title) &&
    !/(?:live|cover|remix|伴奏|现场|翻唱)/i.test(track.title)
      ? 0.2
      : 0;
  return Math.max(
    0,
    Math.min(
      1,
      title * 0.7 +
        artist * 0.18 +
        duration * 0.08 +
        Math.max(0, 0.04 - rank * 0.01) -
        versionPenalty,
    ),
  );
}

export function canAutoApplyBilibiliCandidate(
  track: Track,
  candidate: BilibiliLyricCandidate,
) {
  if (
    !track.durationMs ||
    !candidate.durationMs ||
    !hasTimedText(candidate.text)
  )
    return false;
  const title = Math.max(
    ...titleVariants(track.title).map(value =>
      ratio(value, normalize(candidate.title)),
    ),
  );
  const artist = ratio(normalize(track.artist), normalize(candidate.artist));
  const withinDuration =
    Math.abs(track.durationMs - candidate.durationMs) <=
    Math.max(10_000, track.durationMs * 0.1);
  return (
    title >= 0.92 &&
    artist >= 0.88 &&
    withinDuration &&
    candidate.matchScore >= AUTO_MATCH_THRESHOLD
  );
}

export async function findBilibiliLyricCandidates(
  track: Track,
  options?: ProviderRequestOptions,
): Promise<BilibiliLyricCandidate[]> {
  if (track.source !== 'bilibili' || !parseExactBilibiliTrackId(track.id)) {
    throw new ProviderClientError('UNKNOWN_TRACK', 'bilibili', 'lyric');
  }
  const providers = ['netease', 'qq'] as const;
  const settled = await Promise.allSettled(
    providers.map(async provider => {
      const page = await providerFor(provider).search(track.title, 1, options);
      const rows = page.results
        .filter(
          (item): item is Extract<typeof item, { kind: 'track' }> =>
            item.kind === 'track',
        )
        .slice(0, MAX_CANDIDATES_PER_PROVIDER);
      return Promise.all(
        rows.map(async (item, rank) => {
          const lyric =
            provider === 'netease'
              ? await getNetEaseLyric(item.track.id, options)
              : await getQqLyric(item.track.id, options);
          if (!lyric.text || !hasTimedText(lyric.text)) return null;
          const score = scoreBilibiliCandidate(track, item.track, rank);
          if (score < 0.3) return null;
          return {
            id: item.track.id,
            matchedProvider: provider,
            title: item.track.title,
            artist: item.track.artist,
            album: item.track.album,
            durationMs: item.track.durationMs,
            text: lyric.text,
            translation: lyric.translation,
            matchScore: score,
            hasTranslation: Boolean(lyric.translation),
          } as BilibiliLyricCandidate;
        }),
      );
    }),
  );
  const successes = settled.filter(
    (
      value,
    ): value is PromiseFulfilledResult<(BilibiliLyricCandidate | null)[]> =>
      value.status === 'fulfilled',
  );
  if (!successes.length)
    throw new ProviderClientError('PROVIDER_ERROR', 'bilibili', 'lyric', {
      retryable: true,
    });
  const seen = new Set<string>();
  return successes
    .flatMap(value => value.value)
    .filter((candidate): candidate is BilibiliLyricCandidate =>
      Boolean(candidate),
    )
    .sort((left, right) => right.matchScore - left.matchScore)
    .filter(
      candidate => !seen.has(candidate.id) && Boolean(seen.add(candidate.id)),
    )
    .slice(0, MAX_DISPLAY_CANDIDATES);
}

export async function resolveBilibiliLyric(
  track: Track,
  options?: ProviderRequestOptions,
): Promise<Lyric> {
  const exact = parseExactBilibiliTrackId(track.id);
  if (track.source !== 'bilibili' || !exact) {
    throw new ProviderClientError('UNKNOWN_TRACK', 'bilibili', 'lyric');
  }
  const candidates = await findBilibiliLyricCandidates(track, options);
  const automatic = candidates.find(candidate =>
    canAutoApplyBilibiliCandidate(track, candidate),
  );
  if (!automatic)
    throw new ProviderClientError('LYRIC_UNAVAILABLE', 'bilibili', 'lyric');
  const translationCandidate = candidates.find(
    candidate =>
      candidate.hasTranslation &&
      candidate.matchScore >= automatic.matchScore - 0.04,
  );
  return {
    trackId: exact.trackId,
    source: 'bilibili',
    text: automatic.text,
    translation: translationCandidate?.translation,
    provenance: {
      mode: 'auto',
      matchedProvider: automatic.matchedProvider,
      matchedCandidateId: automatic.id,
      matchScore: automatic.matchScore,
      ...(translationCandidate
        ? { translationProvider: translationCandidate.matchedProvider }
        : {}),
    },
  };
}
