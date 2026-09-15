/**
 * Small, transport-free contract shared by the React Native screens and the
 * provider adapters.  IDs are semantic provider IDs, never URLs.
 */
export const SOURCE_IDS = [
  'netease',
  'kugou',
  'kuwo',
  'qq',
  'bilibili',
] as const;

export type SourceId = (typeof SOURCE_IDS)[number];
export type ProviderOperation =
  | 'search'
  | 'discover'
  | 'detail'
  | 'playback'
  | 'lyrics'
  | 'manual-lyrics'
  | 'offset'
  | 'login'
  | 'download'
  | 'mv'
  // Existing adapter names remain explicit compatibility aliases until all
  // callers move to the product-level operation vocabulary.
  | 'playlist'
  | 'bootstrap'
  | 'lyric';

export type ProviderOperationCapability =
  | { status: 'available' }
  | {
      status: 'unavailable' | 'unverified';
      reason: 'no-authorized-route' | 'unverified-route' | 'login-required';
      action: 'retry' | 'sign-in' | 'choose-another-source' | 'return';
    };

export type ProviderCapabilities = Readonly<
  Record<ProviderOperation, ProviderOperationCapability>
>;
export type SearchKind = 'track' | 'playlist';
export type DiscoverSource = 'netease' | 'kugou';
export type DiscoverSectionKind = 'featured' | 'charts';

export type DiscoverSection =
  | {
      kind: DiscoverSectionKind;
      status: 'ready';
      items: PlaylistSummary[];
    }
  | {
      kind: DiscoverSectionKind;
      status: 'error';
      code: ProviderErrorCode;
      retryable: boolean;
    }
  | {
      kind: DiscoverSectionKind;
      status: 'unavailable';
      reason: 'unverified-route';
    };

export interface DiscoverPage {
  source: DiscoverSource;
  sections: DiscoverSection[];
}

export function isSourceId(value: unknown): value is SourceId {
  return (
    typeof value === 'string' &&
    (SOURCE_IDS as readonly string[]).includes(value)
  );
}

export interface Track {
  id: string;
  source: SourceId;
  title: string;
  artist: string;
  album?: string;
  durationMs?: number;
  artworkUrl?: string;
  /** A semantic Kugou AlbumID; it is never a URL or transport field. */
  providerAlbumId?: string;
}

/** A compact, non-playable remote playlist identity returned by search. */
export interface PlaylistSummary {
  id: string;
  source: SourceId;
  title: string;
  author?: string;
  trackCount?: number;
  artworkUrl?: string;
}

/**
 * Search results are deliberately wrapped in a discriminated union so UI
 * callers cannot accidentally treat a playlist as a playable track.
 */
export type SearchResult =
  | { kind: 'track'; track: Track }
  | { kind: 'playlist'; playlist: PlaylistSummary };

export interface SearchPage {
  source: SourceId;
  query: string;
  page: number;
  total: number;
  kind: SearchKind;
  results: SearchResult[];
}

export interface PlaylistDetail {
  id: string;
  source: SourceId;
  title: string;
  tracks: Track[];
  completeness: 'complete' | 'partial';
  declaredTrackCount: number;
}

export interface Lyric {
  trackId: string;
  source: SourceId;
  text: string;
  translation?: string;
  provenance?: {
    mode: 'auto' | 'manual';
    matchedProvider: 'netease' | 'qq';
    matchedCandidateId: string;
    matchScore: number;
    translationProvider?: 'netease' | 'qq';
  };
}

export type MediaEntitlementStatus =
  | 'allowed'
  | 'requires-login'
  | 'membership-required'
  | 'region-blocked'
  | 'drm-unsupported'
  | 'expired'
  | 'provider-unavailable'
  | 'download-first';

export type MediaRendition = Readonly<{
  id: string;
  label: string;
  mimeType: string;
  container: string;
  codec: string;
  durationMs: number;
  sizeBytes?: number;
}>;

export type MediaPart = Readonly<{
  cid: string;
  page: string;
  title: string;
  durationMs?: number;
}>;

/**
 * Exact native-owned playback receipt. The only playable value is an
 * app-owned content URI backed by a short-lived native lease. Signed
 * transports, provider headers, cookies, candidates, and filesystem paths
 * never enter this type or any player-facing state.
 */
export interface MediaDescriptor {
  version: 1;
  requestId: string;
  source: SourceId;
  semanticTrackId: string;
  partId?: string;
  generation: number;
  playableUri: string;
  mimeType: string;
  container: string;
  codec: string;
  durationMs: number;
  sizeBytes?: number;
  selectedRenditionId: string;
  renditions: readonly MediaRendition[];
  parts?: readonly MediaPart[];
  entitlementStatus: 'allowed';
  leaseExpiresAt: number;
}

export type ProviderErrorCode =
  | 'INVALID_REQUEST'
  | 'UNKNOWN_SOURCE'
  | 'UNKNOWN_TRACK'
  | 'ROUTE_UNAVAILABLE'
  | 'PLAYBACK_UNAVAILABLE'
  | 'LYRIC_UNAVAILABLE'
  | 'REQUEST_TIMEOUT'
  | 'CANCELLED'
  | 'NETWORK_ERROR'
  | 'PROVIDER_ERROR'
  | 'INVALID_RESPONSE'
  | 'LOGIN_REQUIRED'
  | 'MEMBERSHIP_REQUIRED'
  | 'DRM_RESTRICTED'
  | 'REGION_RESTRICTED'
  | 'DOWNLOAD_FIRST'
  | 'API_LEVEL_UNSUPPORTED'
  | 'EXPIRED';

export interface ProviderErrorShape {
  code: ProviderErrorCode;
  source: SourceId;
  operation: ProviderOperation;
  retryable: boolean;
  /** A short, product-safe next action. Never contains provider response text. */
  action: 'retry' | 'select-another-track' | 'not-available';
}

export interface ProviderRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface SearchRequestOptions extends ProviderRequestOptions {
  /** Defaults to tracks. Only provider-approved kinds are selectable. */
  kind?: SearchKind;
}
