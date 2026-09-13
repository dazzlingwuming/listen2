import type {
  BootstrapTrack,
  DiscoverPage,
  DiscoverSection,
  Lyric,
  PlaylistDetail,
  PlaylistSummary,
  ProviderRequestOptions,
  SearchPage,
  SearchKind,
  SearchRequestOptions,
  SourceId,
  Track,
} from '../types';
import { ProviderClientError, unavailable } from './errors';
import { requestJson, requestMediaAvailability } from './http';

const PAGE_SIZE = 20;
const MAX_PAGE = 1_000;
const MAX_QUERY_BYTES = 256;
const MAX_ROWS = 50;

function utf8ByteLength(value: string): number {
  return encodeURIComponent(value).replace(/%[0-9a-f]{2}/gi, 'x').length;
}

interface ProviderAdapter {
  search(
    query: string,
    page: number,
    options?: SearchRequestOptions,
  ): Promise<SearchPage>;
}

const MAX_VIDEO_PAGES = 50;
const MAX_AUDIO_VARIANTS = 4;
const MAX_PLAYLIST_TRACKS = 1_000;
const MAX_DISCOVER_ROWS = 12;
const NETEASE_DETAIL_BATCH_SIZE = 50;
const MAX_DETAIL_CONCURRENCY = 3;
const MAX_KUGOU_DETAIL_PAGES = 40;
const MAX_LYRIC_CHARS = 512 * 1024;

function checkedSearchInput(
  source: SourceId,
  query: string,
  page: number,
): string {
  const normalized = query.trim();
  let byteLength = -1;
  try {
    byteLength = utf8ByteLength(normalized);
  } catch {
    // Lone UTF-16 surrogates cannot become a valid URL query.
  }
  if (
    !normalized ||
    byteLength < 0 ||
    byteLength > MAX_QUERY_BYTES ||
    page < 1 ||
    page > MAX_PAGE ||
    !Number.isInteger(page)
  ) {
    throw new ProviderClientError('INVALID_REQUEST', source, 'search', {
      retryable: false,
    });
  }
  return normalized;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown, maximum = 512): string | null {
  return typeof value === 'string' &&
    value.length <= maximum &&
    !/[\u0000-\u001f]/.test(value)
    ? value.trim()
    : null;
}

function positive(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : undefined;
}

function decimalPositive(value: unknown): number | undefined {
  if (typeof value === 'number') return positive(value);
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,17}$/.test(value))
    return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function cleanTitle(value: unknown): string | null {
  const candidate = text(value);
  return candidate ? candidate.replace(/<[^>]*>/g, '').trim() || null : null;
}

function safeArtwork(value: unknown): string | undefined {
  const candidate = text(value, 2048);
  if (!candidate) return undefined;
  try {
    const url = new URL(
      candidate.startsWith('//') ? `https:${candidate}` : candidate,
    );
    return url.protocol === 'https:' &&
      url.username === '' &&
      url.password === ''
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

function neteaseDiscoverSummary(value: unknown): PlaylistSummary | null {
  const row = asObject(value);
  const id = positive(row?.id);
  const title = text(row?.name);
  if (!id || !title) return null;
  return {
    id: `neplaylist_${id}`,
    source: 'netease',
    title,
    author: text(asObject(row?.creator)?.nickname) ?? undefined,
    trackCount: positive(row?.trackCount),
    artworkUrl: safeArtwork(row?.coverImgUrl ?? row?.picUrl),
  };
}

function kugouChartArtwork(value: unknown): string | undefined {
  const candidate = text(value, 2048);
  if (!candidate) return undefined;
  try {
    const url = new URL(candidate.replace('{size}', '400'));
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      url.hostname !== 'imge.kugou.com' ||
      url.port ||
      url.username ||
      url.password ||
      url.hash
    ) {
      return undefined;
    }
    return `https://imge.kugou.com${url.pathname}${url.search}`;
  } catch {
    return undefined;
  }
}

function kugouChartSummary(value: unknown): PlaylistSummary | null {
  const row = asObject(value);
  const id = decimalPositive(row?.rankid);
  const title = cleanTitle(row?.rankname);
  if (!id || !title) return null;
  return {
    id: `kgchart_${id}`,
    source: 'kugou',
    title,
    artworkUrl: kugouChartArtwork(row?.imgurl),
  };
}

function cancellation(error: unknown): boolean {
  return error instanceof ProviderClientError && error.code === 'CANCELLED';
}

async function mapSettledDiscoverSection(
  kind: 'featured' | 'charts',
  request: Promise<PlaylistSummary[]>,
): Promise<DiscoverSection> {
  try {
    return { kind, status: 'ready', items: await request };
  } catch (error) {
    if (cancellation(error)) throw error;
    return error instanceof ProviderClientError
      ? { kind, status: 'error', code: error.code, retryable: error.retryable }
      : { kind, status: 'error', code: 'NETWORK_ERROR', retryable: true };
  }
}

function boundedDiscoverRows(
  source: SourceId,
  rows: unknown,
  mapper: (row: unknown) => PlaylistSummary | null,
): PlaylistSummary[] {
  if (!Array.isArray(rows) || rows.length > MAX_DISCOVER_ROWS) {
    throw new ProviderClientError('INVALID_RESPONSE', source, 'discover');
  }
  const items = rows
    .map(mapper)
    .filter((item): item is PlaylistSummary => item !== null);
  if (rows.length > 0 && items.length === 0) {
    throw new ProviderClientError('INVALID_RESPONSE', source, 'discover');
  }
  return items;
}

/** Fixed, anonymous NetEase directory route. No caller transport crosses here. */
export async function getNetEaseDiscover(
  options?: ProviderRequestOptions,
): Promise<DiscoverPage> {
  const featured = (async (): Promise<PlaylistSummary[]> => {
    const params = new URLSearchParams({
      cat: '全部',
      order: 'hot',
      limit: String(MAX_DISCOVER_ROWS),
      offset: '0',
      total: 'true',
    });
    const root = asObject(
      await requestJson(
        { url: `https://music.163.com/api/playlist/list?${params}` },
        'netease',
        'discover',
        options,
      ),
    );
    if (root?.code !== 200) {
      throw new ProviderClientError('INVALID_RESPONSE', 'netease', 'discover');
    }
    return boundedDiscoverRows(
      'netease',
      root.playlists,
      neteaseDiscoverSummary,
    );
  })();
  const charts = (async (): Promise<PlaylistSummary[]> => {
    const root = asObject(
      await requestJson(
        { url: 'https://music.163.com/api/toplist' },
        'netease',
        'discover',
        options,
      ),
    );
    if (root?.code !== 200) {
      throw new ProviderClientError('INVALID_RESPONSE', 'netease', 'discover');
    }
    return boundedDiscoverRows('netease', root.list, neteaseDiscoverSummary);
  })();
  const sections = await Promise.all([
    mapSettledDiscoverSection('featured', featured),
    mapSettledDiscoverSection('charts', charts),
  ]);
  return { source: 'netease', sections };
}

export async function getKugouDiscover(
  options?: ProviderRequestOptions,
): Promise<DiscoverPage> {
  const charts = (async (): Promise<PlaylistSummary[]> => {
    const root = asObject(
      await requestJson(
        { url: 'https://m.kugou.com/rank/list?json=true' },
        'kugou',
        'discover',
        options,
      ),
    );
    const data = asObject(root?.data);
    const rows = data?.info ?? data?.list ?? asObject(root?.rank)?.list;
    return boundedDiscoverRows('kugou', rows, kugouChartSummary);
  })();
  return {
    source: 'kugou',
    sections: [
      { kind: 'featured', status: 'unavailable', reason: 'unverified-route' },
      await mapSettledDiscoverSection('charts', charts),
    ],
  };
}

function neteaseProviderId(value: string): string | null {
  const match = /^netrack_([1-9][0-9]{0,17})$/.exec(value);
  return match ? match[1] : null;
}

function kugouProviderId(value: string): string | null {
  const match = /^kgtrack_([A-Za-z0-9]{8,128})$/.exec(value);
  return match ? match[1] : null;
}

function qqProviderId(value: string): string | null {
  const match = /^qqtrack_([A-Za-z0-9_-]{1,128})$/.exec(value);
  return match ? match[1] : null;
}

function neteasePlaylistProviderId(value: string): string | null {
  const match = /^neplaylist_([1-9][0-9]{0,17})$/.exec(value);
  return match ? match[1] : null;
}

function kugouChartProviderId(value: string): string | null {
  const match = /^kgchart_([1-9][0-9]{0,17})$/.exec(value);
  return match ? match[1] : null;
}

function nonNegative(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

async function boundedConcurrentMap<T, R>(
  values: readonly T[],
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(values[index]);
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(MAX_DETAIL_CONCURRENCY, values.length) },
      () => worker(),
    ),
  );
  return results;
}

function requestedSearchKind(
  source: SourceId,
  options?: SearchRequestOptions,
): SearchKind {
  const kind = options?.kind ?? 'track';
  if (kind !== 'track' && kind !== 'playlist') {
    throw new ProviderClientError('INVALID_REQUEST', source, 'search', {
      retryable: false,
    });
  }
  if (kind === 'playlist' && source !== 'netease') {
    throw unavailable(source, 'search', 'ROUTE_UNAVAILABLE');
  }
  return kind;
}

function neteaseTrack(value: unknown): Track | null {
  const row = asObject(value);
  const id = positive(row?.id);
  const title = text(row?.name);
  const artists = Array.isArray(row?.ar)
    ? row?.ar
    : Array.isArray(row?.artists)
    ? row?.artists
    : [];
  const artist = text(asObject(artists[0])?.name);
  if (!id || !title || !artist) return null;
  const album = asObject(row?.al) ?? asObject(row?.album);
  return {
    id: `netrack_${id}`,
    source: 'netease',
    title,
    artist,
    album: text(album?.name) ?? undefined,
    durationMs: positive(row?.dt ?? row?.duration),
    artworkUrl: safeArtwork(album?.picUrl),
  };
}

function neteaseLyricText(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > MAX_LYRIC_CHARS) return null;
  // Keep line timing intact, but normalize legacy control/space artifacts.
  return value.replace(/\u0008/g, '').replace(/[\u2005]+/g, ' ');
}

function secondsToMs(value: unknown): number | undefined {
  const seconds =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^\d{1,5}$/.test(value)
      ? Number(value)
      : NaN;
  return Number.isInteger(seconds) && seconds > 0 && seconds <= 8 * 60 * 60
    ? seconds * 1000
    : undefined;
}

function trackPage(
  source: SourceId,
  query: string,
  pageNumber: number,
  total: unknown,
  tracks: Track[],
): SearchPage {
  return {
    source,
    query,
    page: pageNumber,
    total: Math.max(tracks.length, positive(total) ?? tracks.length),
    kind: 'track',
    results: tracks.map(track => ({ kind: 'track', track })),
  };
}

function playlistPage(
  source: SourceId,
  query: string,
  pageNumber: number,
  total: unknown,
  playlists: PlaylistSummary[],
): SearchPage {
  return {
    source,
    query,
    page: pageNumber,
    total: Math.max(playlists.length, positive(total) ?? playlists.length),
    kind: 'playlist',
    results: playlists.map(playlist => ({ kind: 'playlist', playlist })),
  };
}

function invalidResponse(source: SourceId): never {
  throw new ProviderClientError('INVALID_RESPONSE', source, 'search');
}

const netease: ProviderAdapter = {
  async search(query, pageNumber, options) {
    const value = checkedSearchInput('netease', query, pageNumber);
    const kind = requestedSearchKind('netease', options);
    const params = new URLSearchParams({
      s: value,
      type: kind === 'playlist' ? '1000' : '1',
      offset: String((pageNumber - 1) * PAGE_SIZE),
      limit: String(PAGE_SIZE),
    });
    const data = asObject(
      await requestJson(
        { url: `https://music.163.com/api/search/get/web?${params}` },
        'netease',
        'search',
        options,
      ),
    );
    const result = asObject(data?.result);
    if (kind === 'playlist') {
      const rows = result?.playlists;
      if (!Array.isArray(rows) || rows.length > MAX_ROWS)
        invalidResponse('netease');
      const playlists = rows.flatMap((entry): PlaylistSummary[] => {
        const row = asObject(entry);
        const id = positive(row?.id);
        const title = text(row?.name);
        if (!id || !title) return [];
        return [
          {
            id: `neplaylist_${id}`,
            source: 'netease',
            title,
            author: text(asObject(row?.creator)?.nickname) ?? undefined,
            trackCount: positive(row?.trackCount),
            artworkUrl: safeArtwork(row?.coverImgUrl),
          },
        ];
      });
      return playlistPage(
        'netease',
        value,
        pageNumber,
        result?.playlistCount,
        playlists,
      );
    }
    const songs = result?.songs;
    if (!Array.isArray(songs) || songs.length > MAX_ROWS)
      invalidResponse('netease');
    const tracks = songs.flatMap((song): Track[] => {
      const row = asObject(song);
      const id = positive(row?.id);
      const title = text(row?.name);
      const artists = Array.isArray(row?.artists) ? row?.artists : [];
      const artist = text(asObject(artists[0])?.name);
      if (!id || !title || !artist) return [];
      const album = asObject(row?.album);
      return [
        {
          id: `netrack_${id}`,
          source: 'netease',
          title,
          artist,
          album: text(album?.name) ?? undefined,
          durationMs: positive(row?.duration ?? row?.dt),
          artworkUrl: safeArtwork(album?.picUrl),
        },
      ];
    });
    return trackPage('netease', value, pageNumber, result?.songCount, tracks);
  },
};

/**
 * These NetEase GET routes are fixed, public HTTPS contracts. They do not
 * require generated cookies, caller headers, account tokens, or weapi/eapi.
 */
export async function bootstrapNetEaseTrack(
  track: Track,
  signal?: AbortSignal,
): Promise<BootstrapTrack> {
  const providerId =
    track.source === 'netease' ? neteaseProviderId(track.id) : null;
  if (!providerId)
    throw new ProviderClientError('UNKNOWN_TRACK', 'netease', 'bootstrap');
  const url = `https://music.163.com/song/media/outer/url?id=${providerId}.mp3`;
  await requestMediaAvailability(url, 'netease', 'bootstrap', { signal });
  return { trackId: track.id, source: 'netease', url };
}

export async function getNetEaseLyric(
  trackId: string,
  options?: ProviderRequestOptions,
): Promise<Lyric> {
  const providerId = neteaseProviderId(trackId);
  if (!providerId)
    throw new ProviderClientError('UNKNOWN_TRACK', 'netease', 'lyric');
  const params = new URLSearchParams({
    id: providerId,
    lv: '-1',
    tv: '-1',
  });
  const root = asObject(
    await requestJson(
      { url: `https://music.163.com/api/song/lyric?${params}` },
      'netease',
      'lyric',
      options,
    ),
  );
  const primary = asObject(root?.lrc);
  const translated = asObject(root?.tlyric);
  const lyric = primary ? neteaseLyricText(primary.lyric) : null;
  const translation = translated ? neteaseLyricText(translated.lyric) : null;
  if (lyric === null && translation === null && root?.nolyric !== true) {
    throw new ProviderClientError('INVALID_RESPONSE', 'netease', 'lyric');
  }
  return {
    trackId,
    source: 'netease',
    text: lyric ?? '',
    translation: translation || undefined,
  };
}

export async function getNetEasePlaylist(
  playlistId: string,
  options?: ProviderRequestOptions,
): Promise<PlaylistDetail> {
  const providerId = neteasePlaylistProviderId(playlistId);
  if (!providerId)
    throw new ProviderClientError('UNKNOWN_TRACK', 'netease', 'playlist');
  const params = new URLSearchParams({ id: providerId, n: '1000' });
  const root = asObject(
    await requestJson(
      { url: `https://music.163.com/api/v3/playlist/detail?${params}` },
      'netease',
      'playlist',
      options,
    ),
  );
  if (root?.code !== 200)
    throw new ProviderClientError('INVALID_RESPONSE', 'netease', 'playlist');
  const playlist = asObject(root.playlist);
  if (positive(playlist?.id) !== Number(providerId)) {
    throw new ProviderClientError('INVALID_RESPONSE', 'netease', 'playlist');
  }
  const title = text(playlist?.name);
  const rows = playlist?.trackIds;
  const declaredTrackCount = nonNegative(playlist?.trackCount);
  if (!title || !Array.isArray(rows) || declaredTrackCount === undefined) {
    throw new ProviderClientError('INVALID_RESPONSE', 'netease', 'playlist');
  }
  const allIds = rows.map(row => positive(asObject(row)?.id));
  if (allIds.some(id => !id) || new Set(allIds).size !== allIds.length) {
    throw new ProviderClientError('INVALID_RESPONSE', 'netease', 'playlist');
  }
  const acceptedIds = (allIds as number[]).slice(0, MAX_PLAYLIST_TRACKS);
  const batches: number[][] = [];
  for (
    let index = 0;
    index < acceptedIds.length;
    index += NETEASE_DETAIL_BATCH_SIZE
  ) {
    batches.push(acceptedIds.slice(index, index + NETEASE_DETAIL_BATCH_SIZE));
  }
  const hydrated = await boundedConcurrentMap(batches, async batch => {
    const ids = batch.map(id => String(id));
    const params = new URLSearchParams({
      c: JSON.stringify(batch.map(id => ({ id }))),
      ids: JSON.stringify(ids),
    });
    const detail = asObject(
      await requestJson(
        { url: `https://music.163.com/api/v3/song/detail?${params}` },
        'netease',
        'playlist',
        options,
      ),
    );
    if (detail?.code !== 200 || !Array.isArray(detail?.songs)) {
      throw new ProviderClientError('INVALID_RESPONSE', 'netease', 'playlist');
    }
    const expected = new Set(batch);
    const mapped = detail.songs.map(neteaseTrack);
    if (
      mapped.some(track => !track) ||
      new Set(mapped.map(track => track?.id)).size !== mapped.length ||
      mapped.some(
        track => !expected.has(Number(track?.id.slice('netrack_'.length))),
      )
    ) {
      throw new ProviderClientError('INVALID_RESPONSE', 'netease', 'playlist');
    }
    return mapped.filter((track): track is Track => track !== null);
  });
  const byId = new Map(
    hydrated
      .flat()
      .map(track => [Number(track.id.slice('netrack_'.length)), track]),
  );
  const tracks = acceptedIds.flatMap(id => {
    const track = byId.get(id);
    return track ? [track] : [];
  });
  return {
    id: playlistId,
    source: 'netease',
    title,
    tracks,
    completeness:
      rows.length <= MAX_PLAYLIST_TRACKS &&
      declaredTrackCount === acceptedIds.length &&
      tracks.length === acceptedIds.length
        ? 'complete'
        : 'partial',
    declaredTrackCount,
  };
}

function kugouChartTrack(value: unknown): Track | null {
  const row = asObject(value);
  const hash = text(row?.hash, 128);
  const title = cleanTitle(row?.songname);
  const authors = Array.isArray(row?.authors) ? row?.authors : [];
  const artist = cleanTitle(asObject(authors[0])?.author_name);
  if (!hash || !/^[A-Za-z0-9]{8,128}$/.test(hash) || !title || !artist) {
    return null;
  }
  return {
    id: `kgtrack_${hash}`,
    source: 'kugou',
    title,
    artist,
    durationMs: secondsToMs(row?.duration),
    artworkUrl: kugouChartArtwork(row?.img),
  };
}

interface KugouChartPage {
  total: number;
  pageSize: number;
  rows: unknown[];
}

async function getKugouChartPage(
  rankId: string,
  page: number,
  options?: ProviderRequestOptions,
): Promise<KugouChartPage> {
  const params = new URLSearchParams({
    rankid: rankId,
    page: String(page),
    json: 'true',
  });
  const root = asObject(
    await requestJson(
      { url: `https://m.kugou.com/rank/info/?${params}` },
      'kugou',
      'playlist',
      options,
    ),
  );
  const songs = asObject(root?.songs);
  const total = nonNegative(songs?.total);
  const pageSize = positive(songs?.pagesize);
  const rows = songs?.list;
  if (total === undefined || !pageSize || !Array.isArray(rows)) {
    throw new ProviderClientError('INVALID_RESPONSE', 'kugou', 'playlist');
  }
  return { total, pageSize, rows };
}

export async function getKugouChart(
  playlistId: string,
  options?: ProviderRequestOptions,
): Promise<PlaylistDetail> {
  const rankId = kugouChartProviderId(playlistId);
  if (!rankId) {
    throw new ProviderClientError('UNKNOWN_TRACK', 'kugou', 'playlist');
  }
  const first = await getKugouChartPage(rankId, 1, options);
  const expected = Math.min(first.total, MAX_PLAYLIST_TRACKS);
  const totalPages = Math.ceil(expected / first.pageSize);
  const pagesToRequest = Math.min(totalPages, MAX_KUGOU_DETAIL_PAGES);
  const pageNumbers = Array.from(
    { length: Math.max(0, pagesToRequest - 1) },
    (_, index) => index + 2,
  );
  const laterPages = await boundedConcurrentMap(pageNumbers, async page => {
    const result = await getKugouChartPage(rankId, page, options);
    if (result.total !== first.total || result.pageSize !== first.pageSize) {
      throw new ProviderClientError('INVALID_RESPONSE', 'kugou', 'playlist');
    }
    return result;
  });
  const tracks: Track[] = [];
  const seen = new Set<string>();
  for (const row of [first, ...laterPages].flatMap(page => page.rows)) {
    const track = kugouChartTrack(row);
    if (!track || seen.has(track.id)) continue;
    seen.add(track.id);
    if (tracks.length < MAX_PLAYLIST_TRACKS) tracks.push(track);
  }
  return {
    id: playlistId,
    source: 'kugou',
    title: `酷狗榜单 ${rankId}`,
    tracks,
    completeness:
      first.total <= MAX_PLAYLIST_TRACKS &&
      totalPages <= MAX_KUGOU_DETAIL_PAGES &&
      tracks.length === expected
        ? 'complete'
        : 'partial',
    declaredTrackCount: first.total,
  };
}

function safeKugouMediaUrl(value: unknown): string | null {
  const candidate = text(value, 2048);
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    return url.protocol === 'https:' &&
      url.hostname === 'sharefs.kugou.com' &&
      url.port === '' &&
      url.username === '' &&
      url.password === '' &&
      !url.hash
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

/**
 * Kugou returns an HTTPS media URL only for the exact requested hash. The
 * response URL is still constrained to Kugou-owned HTTPS hosts before it can
 * cross into the native player.
 */
export async function bootstrapKugouTrack(
  track: Track,
  options?: ProviderRequestOptions,
): Promise<BootstrapTrack> {
  const providerId =
    track.source === 'kugou' ? kugouProviderId(track.id) : null;
  if (!providerId)
    throw new ProviderClientError('UNKNOWN_TRACK', 'kugou', 'bootstrap');
  const params = new URLSearchParams({ cmd: 'playInfo', hash: providerId });
  const root = asObject(
    await requestJson(
      { url: `https://m.kugou.com/app/i/getSongInfo.php?${params}` },
      'kugou',
      'bootstrap',
      options,
    ),
  );
  const url = safeKugouMediaUrl(root?.url);
  if (!url) {
    if (positive(root?.pay_type) || positive(root?.privilege)) {
      throw new ProviderClientError(
        'MEMBERSHIP_REQUIRED',
        'kugou',
        'bootstrap',
      );
    }
    throw unavailable('kugou', 'bootstrap', 'PLAYBACK_UNAVAILABLE');
  }
  return { trackId: track.id, source: 'kugou', url };
}

/**
 * QQ lyrics use a fixed public endpoint and a fixed first-party Referer. No
 * login material, cookies, caller headers, or arbitrary lyric URL is used.
 */
export async function getQqLyric(
  trackId: string,
  options?: ProviderRequestOptions,
): Promise<Lyric> {
  const providerId = qqProviderId(trackId);
  if (!providerId)
    throw new ProviderClientError('UNKNOWN_TRACK', 'qq', 'lyric');
  const params = new URLSearchParams({
    songmid: providerId,
    g_tk: '5381',
    format: 'json',
    inCharset: 'utf8',
    outCharset: 'utf-8',
    nobase64: '1',
  });
  const root = asObject(
    await requestJson(
      {
        url: `https://i.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?${params}`,
        profile: 'qq',
      },
      'qq',
      'lyric',
      options,
    ),
  );
  const lyric = neteaseLyricText(root?.lyric);
  const translation = neteaseLyricText(root?.trans)?.replace(/\/\//g, '');
  if (root?.retcode !== 0 || (!lyric && !translation)) {
    throw unavailable('qq', 'lyric', 'LYRIC_UNAVAILABLE');
  }
  return {
    trackId,
    source: 'qq',
    text: lyric ?? '',
    translation: translation || undefined,
  };
}

const bilibili: ProviderAdapter = {
  async search(query, pageNumber, options) {
    const value = checkedSearchInput('bilibili', query, pageNumber);
    requestedSearchKind('bilibili', options);
    const params = new URLSearchParams({
      search_type: 'video',
      page: String(pageNumber),
      page_size: String(PAGE_SIZE),
      keyword: value,
      platform: 'pc',
    });
    const root = asObject(
      await requestJson(
        {
          url: `https://api.bilibili.com/x/web-interface/search/type?${params}`,
          profile: 'bilibili',
        },
        'bilibili',
        'search',
        options,
      ),
    );
    if (root?.code !== 0) invalidResponse('bilibili');
    const data = asObject(root.data);
    const rows = data?.result;
    if (!Array.isArray(rows) || rows.length > MAX_ROWS)
      invalidResponse('bilibili');
    const tracks = rows.flatMap((song): Track[] => {
      const row = asObject(song);
      const bvid = text(row?.bvid, 64);
      const title = cleanTitle(row?.title);
      const artist = cleanTitle(row?.author) ?? 'Bilibili';
      if (!bvid || !/^BV[0-9A-Za-z]{6,32}$/.test(bvid) || !title) return [];
      const duration = text(row?.duration, 16);
      return [
        {
          id: `bitrack_v_${bvid}`,
          source: 'bilibili',
          title,
          artist,
          durationMs: durationToMs(duration),
          artworkUrl: safeArtwork(row?.pic),
        },
      ];
    });
    return trackPage('bilibili', value, pageNumber, data?.numResults, tracks);
  },
};

function bilibiliPayloadError(value: unknown): never {
  const root = asObject(value);
  const code = root?.code;
  if (code === -101)
    throw new ProviderClientError('LOGIN_REQUIRED', 'bilibili', 'bootstrap');
  if (code === -403)
    throw new ProviderClientError('REGION_RESTRICTED', 'bilibili', 'bootstrap');
  throw new ProviderClientError('INVALID_RESPONSE', 'bilibili', 'bootstrap');
}

function parseBilibiliTrackId(
  trackId: string,
): { bvid: string; cid?: number } | null {
  const matched =
    /^bitrack_v_(BV[0-9A-Za-z]{6,32})(?:-([1-9][0-9]{0,18}))?$/.exec(trackId);
  if (!matched) return null;
  return { bvid: matched[1], cid: matched[2] ? Number(matched[2]) : undefined };
}

function safeBilibiliAudioUrl(value: unknown): string | null {
  const candidate = text(value, 2048);
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    const deadline = Number(url.searchParams.get('deadline'));
    return url.protocol === 'https:' &&
      (url.hostname === 'bilivideo.com' ||
        url.hostname.endsWith('.bilivideo.com')) &&
      url.username === '' &&
      url.password === '' &&
      !url.hash &&
      Number.isFinite(deadline) &&
      deadline > Math.floor(Date.now() / 1000)
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

/**
 * Bilibili is the only mobile bootstrap currently backed by two public, fixed
 * HTTPS routes. The detail request supplies/validates the CID before the
 * playurl request. No URL, header, cookie or CID is supplied by the caller.
 */
export async function bootstrapBilibiliTrack(
  track: Track,
  signal?: AbortSignal,
): Promise<BootstrapTrack> {
  const identity =
    track.source === 'bilibili' ? parseBilibiliTrackId(track.id) : null;
  if (!identity)
    throw new ProviderClientError('UNKNOWN_TRACK', 'bilibili', 'bootstrap');
  const detailQuery = new URLSearchParams({ bvid: identity.bvid });
  const detailRoot = asObject(
    await requestJson(
      {
        url: `https://api.bilibili.com/x/web-interface/view?${detailQuery}`,
        profile: 'bilibili',
      },
      'bilibili',
      'bootstrap',
      { signal },
    ),
  );
  if (detailRoot?.code !== 0) bilibiliPayloadError(detailRoot);
  const detail = asObject(detailRoot.data);
  if (detail?.bvid !== identity.bvid)
    throw new ProviderClientError('INVALID_RESPONSE', 'bilibili', 'bootstrap');
  const pages = detail?.pages;
  if (
    !Array.isArray(pages) ||
    pages.length === 0 ||
    pages.length > MAX_VIDEO_PAGES
  ) {
    throw unavailable('bilibili', 'bootstrap', 'PLAYBACK_UNAVAILABLE');
  }
  const selected =
    pages.map(asObject).find(entry => positive(entry?.cid) === identity.cid) ??
    (!identity.cid ? asObject(pages[0]) : null);
  const cid = positive(selected?.cid);
  if (!cid) throw unavailable('bilibili', 'bootstrap', 'PLAYBACK_UNAVAILABLE');
  const manifestQuery = new URLSearchParams({
    fnval: '16',
    fnver: '0',
    fourk: '1',
    bvid: identity.bvid,
    cid: String(cid),
  });
  const manifestRoot = asObject(
    await requestJson(
      {
        url: `https://api.bilibili.com/x/player/playurl?${manifestQuery}`,
        profile: 'bilibili',
      },
      'bilibili',
      'bootstrap',
      { signal },
    ),
  );
  if (manifestRoot?.code !== 0) bilibiliPayloadError(manifestRoot);
  const dash = asObject(asObject(manifestRoot.data)?.dash);
  const audio = dash?.audio;
  if (
    !Array.isArray(audio) ||
    audio.length === 0 ||
    audio.length > MAX_AUDIO_VARIANTS
  ) {
    throw unavailable('bilibili', 'bootstrap', 'PLAYBACK_UNAVAILABLE');
  }
  const url = audio
    .map(asObject)
    .filter(
      variant =>
        text(variant?.mimeType) === 'audio/mp4' &&
        (text(variant?.codecs) ?? '').startsWith('mp4a.'),
    )
    .sort(
      (left, right) => (positive(right?.id) ?? 0) - (positive(left?.id) ?? 0),
    )
    .map(variant => safeBilibiliAudioUrl(variant?.baseUrl ?? variant?.base_url))
    .find((candidate): candidate is string => candidate !== null);
  if (!url) throw unavailable('bilibili', 'bootstrap', 'PLAYBACK_UNAVAILABLE');
  return {
    trackId: track.id,
    source: 'bilibili',
    url,
    headers: {
      Referer: 'https://www.bilibili.com/',
    },
  };
}

const qq: ProviderAdapter = {
  async search(query, pageNumber, options) {
    const value = checkedSearchInput('qq', query, pageNumber);
    requestedSearchKind('qq', options);
    const body = JSON.stringify({
      comm: { ct: '19', cv: '1859', uin: '0' },
      req: {
        method: 'DoSearchForQQMusicDesktop',
        module: 'music.search.SearchCgiService',
        param: {
          grp: 1,
          num_per_page: PAGE_SIZE,
          page_num: pageNumber,
          query: value,
          search_type: 0,
        },
      },
    });
    const root = asObject(
      await requestJson(
        { url: 'https://u.y.qq.com/cgi-bin/musicu.fcg', method: 'POST', body },
        'qq',
        'search',
        options,
      ),
    );
    const result = asObject(asObject(root?.req)?.data);
    const bodyData = asObject(result?.body);
    const songs = asObject(bodyData?.song)?.list;
    if (!Array.isArray(songs) || songs.length > MAX_ROWS) invalidResponse('qq');
    const tracks = songs.flatMap((song): Track[] => {
      const row = asObject(song);
      const mid = text(row?.mid, 128);
      const title = cleanTitle(row?.name);
      const singers = Array.isArray(row?.singer) ? row?.singer : [];
      const artist = cleanTitle(asObject(singers[0])?.name);
      if (!mid || !/^[A-Za-z0-9_-]{1,128}$/.test(mid) || !title || !artist)
        return [];
      return [
        {
          id: `qqtrack_${mid}`,
          source: 'qq',
          title,
          artist,
          album: cleanTitle(asObject(row?.album)?.name) ?? undefined,
        },
      ];
    });
    return trackPage(
      'qq',
      value,
      pageNumber,
      asObject(result?.meta)?.sum,
      tracks,
    );
  },
};

const kugou: ProviderAdapter = {
  async search(query, pageNumber, options) {
    const value = checkedSearchInput('kugou', query, pageNumber);
    requestedSearchKind('kugou', options);
    const params = new URLSearchParams({
      keyword: value,
      page: String(pageNumber),
    });
    const root = asObject(
      await requestJson(
        { url: `https://songsearch.kugou.com/song_search_v2?${params}` },
        'kugou',
        'search',
        options,
      ),
    );
    const data = asObject(root?.data);
    const rows = data?.lists;
    if (!Array.isArray(rows) || rows.length > MAX_ROWS)
      invalidResponse('kugou');
    const tracks = rows.flatMap((song): Track[] => {
      const row = asObject(song);
      const hash = text(row?.FileHash ?? row?.hash, 128);
      const title = cleanTitle(row?.SongName ?? row?.songname);
      const artist = cleanTitle(row?.SingerName ?? row?.singername);
      if (!hash || !/^[A-Za-z0-9]{8,128}$/.test(hash) || !title || !artist)
        return [];
      return [
        {
          id: `kgtrack_${hash}`,
          source: 'kugou',
          title,
          artist,
          album: cleanTitle(row?.AlbumName) ?? undefined,
        },
      ];
    });
    return trackPage('kugou', value, pageNumber, data?.total, tracks);
  },
};

const kuwo: ProviderAdapter = {
  async search(query, pageNumber, options) {
    const value = checkedSearchInput('kuwo', query, pageNumber);
    requestedSearchKind('kuwo', options);
    const params = new URLSearchParams({
      vipver: '1',
      client: 'kt',
      ft: 'music',
      cluster: '0',
      strategy: '2012',
      encoding: 'utf8',
      rformat: 'json',
      mobi: '1',
      issubtitle: '1',
      show_copyright_off: '1',
      pn: String(pageNumber - 1),
      rn: String(PAGE_SIZE),
      all: value,
    });
    const root = asObject(
      await requestJson(
        {
          url: `https://www.kuwo.cn/search/searchMusicBykeyWord?${params}`,
        },
        'kuwo',
        'search',
        options,
      ),
    );
    const rows = root?.abslist;
    if (!Array.isArray(rows) || rows.length > MAX_ROWS) invalidResponse('kuwo');
    const tracks = rows.flatMap((song): Track[] => {
      const row = asObject(song);
      const id = decimalPositive(row?.DC_TARGETID);
      const title = cleanTitle(row?.NAME);
      const artist = cleanTitle(row?.ARTIST);
      if (!id || !title || !artist) return [];
      return [
        {
          id: `kwtrack_${id}`,
          source: 'kuwo',
          title,
          artist,
          album: cleanTitle(row?.ALBUM) ?? undefined,
          durationMs: secondsToMs(row?.DURATION),
          artworkUrl: safeArtwork(row?.hts_MVPIC),
        },
      ];
    });
    return trackPage('kuwo', value, pageNumber, Number(root?.HIT), tracks);
  },
};

export const PROVIDER_ADAPTERS: Readonly<Record<SourceId, ProviderAdapter>> = {
  netease,
  kugou,
  kuwo,
  qq,
  bilibili,
};

export function providerFor(source: SourceId): ProviderAdapter {
  return PROVIDER_ADAPTERS[source];
}

function durationToMs(value: string | null): number | undefined {
  if (!value || !/^\d{1,2}:\d{2}(?::\d{2})?$/.test(value)) return undefined;
  const units = value.split(':').map(Number);
  const seconds =
    units.length === 3
      ? units[0] * 3600 + units[1] * 60 + units[2]
      : units[0] * 60 + units[1];
  return seconds > 0 && seconds <= 8 * 60 * 60 ? seconds * 1000 : undefined;
}
