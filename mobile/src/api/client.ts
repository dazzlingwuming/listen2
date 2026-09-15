import type {
  MediaDescriptor,
  DiscoverPage,
  DiscoverSource,
  Lyric,
  PlaylistDetail,
  ProviderRequestOptions,
  ProviderCapabilities,
  ProviderOperation,
  SearchPage,
  SearchRequestOptions,
  SourceId,
  Track,
} from '../types';
import { isSourceId } from '../types';
import { ProviderClientError, unavailable } from './errors';
import {
  parseExactBilibiliTrackId,
  sourceForPlaylistId,
  sourceForTrackId,
} from './ids';
import {
  getNetEaseLyric,
  getNetEaseDiscover,
  getQqLyric,
  getNetEasePlaylist,
  getKugouChart,
  getKugouDiscover,
  getKugouLyric,
  getKuwoLyric,
  providerFor,
} from './providers';
import { resolveBilibiliLyric } from '../bilibili/lyrics';
import { isNativePlaybackReady, resolveNativeMedia } from './nativePlayback';

const available = { status: 'available' } as const;
const unavailableRoute = {
  status: 'unavailable',
  reason: 'no-authorized-route',
  action: 'choose-another-source',
} as const;
const unverifiedRoute = {
  status: 'unverified',
  reason: 'unverified-route',
  action: 'return',
} as const;

type SourceCapabilityProjection = Readonly<{
  operations: ProviderCapabilities;
  /** Compatibility fields for legacy call sites; new screens use `operations`. */
  search: boolean;
  playlistSearch: boolean;
  playback: boolean;
  lyric: boolean;
  playlist: boolean;
  discover: boolean;
}>;

const capabilityProjection = (
  supported: Partial<Record<ProviderOperation, typeof available>>,
): SourceCapabilityProjection => {
  const operationKeys: ProviderOperation[] = [
    'search',
    'discover',
    'detail',
    'playback',
    'lyrics',
    'manual-lyrics',
    'offset',
    'login',
    'download',
    'mv',
    'playlist',
    'bootstrap',
    'lyric',
  ];
  const operations = Object.freeze(
    Object.fromEntries(
      operationKeys.map(operation => [
        operation,
        supported[operation] ??
          (operation === 'search' ? unavailableRoute : unverifiedRoute),
      ]),
    ) as ProviderCapabilities,
  );
  return Object.freeze({
    operations,
    search: operations.search.status === 'available',
    playlistSearch: operations.playlist.status === 'available',
    playback: operations.playback.status === 'available',
    lyric: operations.lyrics.status === 'available',
    playlist: operations.detail.status === 'available',
    discover: operations.discover.status === 'available',
  });
};

export const PROVIDER_CAPABILITIES: Readonly<
  Record<SourceId, SourceCapabilityProjection>
> = Object.freeze({
  netease: {
    ...capabilityProjection({
      search: available,
      discover: available,
      detail: available,
      ...(isNativePlaybackReady('netease') ? { playback: available } : {}),
      lyrics: available,
      playlist: available,
      ...(isNativePlaybackReady('netease') ? { bootstrap: available } : {}),
      lyric: available,
      download: available,
    }),
  },
  kugou: {
    ...capabilityProjection({
      search: available,
      discover: available,
      detail: available,
      ...(isNativePlaybackReady('kugou') ? { playback: available } : {}),
      ...(isNativePlaybackReady('kugou') ? { bootstrap: available } : {}),
      download: available,
    }),
  },
  kuwo: {
    ...capabilityProjection(isNativePlaybackReady('kuwo') ? { search: available, playback: available, bootstrap: available } : { search: available }),
  },
  qq: {
    ...capabilityProjection({
      search: available,
      lyrics: available,
      lyric: available,
      ...(isNativePlaybackReady('qq') ? { playback: available, bootstrap: available } : {}),
    }),
  },
  bilibili: {
    ...capabilityProjection({
      search: available,
      detail: available,
      ...(isNativePlaybackReady('bilibili') ? { playback: available } : {}),
      lyrics: available,
      'manual-lyrics': available,
      // This is an app-local, bounded timeline correction for the exact
      // Bilibili part. It does not authorize or alter provider transport.
      offset: available,
      login: available,
      mv: available,
      ...(isNativePlaybackReady('bilibili') ? { bootstrap: available } : {}),
      lyric: available,
    }),
  },
});

/**
 * The v0.8.2 mobile client shape, updated to use exact source IDs and bounded
 * adapters.  Keeping this facade deliberately small makes it easy for screens
 * to choose a provider without inheriting its HTTP details.
 */
export const providerClient = {
  async getDiscover(
    source: DiscoverSource,
    options?: ProviderRequestOptions,
  ): Promise<DiscoverPage> {
    if (source === 'netease') return getNetEaseDiscover(options);
    return getKugouDiscover(options);
  },

  async search(
    source: SourceId,
    query: string,
    page = 1,
    options?: SearchRequestOptions,
  ): Promise<SearchPage> {
    if (!isSourceId(source))
      throw new ProviderClientError('UNKNOWN_SOURCE', 'netease', 'search');
    return providerFor(source).search(query, page, options);
  },

  async getPlaylist(
    id: string,
    options?: ProviderRequestOptions,
  ): Promise<PlaylistDetail> {
    const source = sourceForPlaylistId(id);
    if (!source)
      throw new ProviderClientError('UNKNOWN_TRACK', 'netease', 'playlist');
    if (source === 'netease') return getNetEasePlaylist(id, options);
    if (id.startsWith('kgchart_')) return getKugouChart(id, options);
    throw unavailable(source, 'playlist', 'ROUTE_UNAVAILABLE');
  },

  async resolveMedia(
    track: Track,
    signal?: AbortSignal,
  ): Promise<MediaDescriptor> {
    const source = sourceForTrackId(track.id);
    if (!source || source !== track.source) {
      throw new ProviderClientError(
        'UNKNOWN_TRACK',
        track.source ?? 'netease',
        'bootstrap',
      );
    }
    if (!parseExactBilibiliTrackId(track.id) && source === 'bilibili')
      throw new ProviderClientError('UNKNOWN_TRACK', source, 'bootstrap');
    return resolveNativeMedia(track, signal);
  },

  async getLyric(
    trackOrId: Track | string,
    options?: ProviderRequestOptions,
  ): Promise<Lyric> {
    const id = typeof trackOrId === 'string' ? trackOrId : trackOrId.id;
    const source = sourceForTrackId(id);
    if (!source)
      throw new ProviderClientError('UNKNOWN_TRACK', 'netease', 'lyric');
    if (source === 'netease') return getNetEaseLyric(id, options);
    if (source === 'qq') return getQqLyric(id, options);
    if (source === 'bilibili') {
      if (typeof trackOrId === 'string') {
        throw unavailable(source, 'lyric', 'LYRIC_UNAVAILABLE');
      }
      return resolveBilibiliLyric(trackOrId, options);
    }
    // Deliberately dormant until device evidence validates each fixed route.
    if (source === 'kugou' || source === 'kuwo') {
      throw unavailable(source, 'lyric', 'LYRIC_UNAVAILABLE');
    }
    throw unavailable(source, 'lyric', 'LYRIC_UNAVAILABLE');
  },
};

/** Internal test seam; it is intentionally not used by production dispatch. */
export const dormantLyricAdapters = Object.freeze({
  getKugouLyric,
  getKuwoLyric,
});

export { ProviderClientError } from './errors';
