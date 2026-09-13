import type {
  BootstrapTrack,
  DiscoverPage,
  DiscoverSource,
  Lyric,
  PlaylistDetail,
  ProviderRequestOptions,
  SearchPage,
  SearchRequestOptions,
  SourceId,
  Track,
} from '../types';
import { isSourceId } from '../types';
import { ProviderClientError, unavailable } from './errors';
import { sourceForPlaylistId, sourceForTrackId } from './ids';
import {
  bootstrapBilibiliTrack,
  bootstrapKugouTrack,
  bootstrapNetEaseTrack,
  getNetEaseLyric,
  getNetEaseDiscover,
  getQqLyric,
  getNetEasePlaylist,
  getKugouChart,
  getKugouDiscover,
  providerFor,
} from './providers';

export const PROVIDER_CAPABILITIES: Readonly<
  Record<
    SourceId,
    {
      search: boolean;
      playlistSearch: boolean;
      playback: boolean;
      lyric: boolean;
      playlist: boolean;
      discover: boolean;
    }
  >
> = Object.freeze({
  netease: {
    search: true,
    playlistSearch: true,
    playback: true,
    lyric: true,
    playlist: true,
    discover: true,
  },
  kugou: {
    search: true,
    playlistSearch: false,
    playback: true,
    lyric: false,
    playlist: false,
    discover: true,
  },
  kuwo: {
    search: true,
    playlistSearch: false,
    playback: false,
    lyric: false,
    playlist: false,
    discover: false,
  },
  qq: {
    search: true,
    playlistSearch: false,
    playback: false,
    lyric: true,
    playlist: false,
    discover: false,
  },
  bilibili: {
    search: true,
    playlistSearch: false,
    playback: true,
    lyric: false,
    playlist: false,
    discover: false,
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

  async bootstrapTrack(
    track: Track,
    _signal?: AbortSignal,
  ): Promise<BootstrapTrack> {
    const source = sourceForTrackId(track.id);
    if (!source || source !== track.source) {
      throw new ProviderClientError(
        'UNKNOWN_TRACK',
        track.source ?? 'netease',
        'bootstrap',
      );
    }
    if (source === 'bilibili') return bootstrapBilibiliTrack(track, _signal);
    if (source === 'kugou')
      return bootstrapKugouTrack(track, { signal: _signal });
    if (source === 'netease') return bootstrapNetEaseTrack(track, _signal);
    // QQ and Kuwo lack an approved fixed media-candidate contract.
    throw unavailable(source, 'bootstrap', 'PLAYBACK_UNAVAILABLE');
  },

  async getLyric(id: string, options?: ProviderRequestOptions): Promise<Lyric> {
    const source = sourceForTrackId(id);
    if (!source)
      throw new ProviderClientError('UNKNOWN_TRACK', 'netease', 'lyric');
    if (source === 'netease') return getNetEaseLyric(id, options);
    if (source === 'qq') return getQqLyric(id, options);
    throw unavailable(source, 'lyric', 'LYRIC_UNAVAILABLE');
  },
};

export { ProviderClientError } from './errors';
