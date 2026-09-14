export type BilibiliPublicStatus =
  | 'idle'
  | 'waiting'
  | 'scanned'
  | 'authenticated'
  | 'expired'
  | 'cancelled'
  | 'error'
  | 'unavailable';

export type BilibiliPublicState = {
  status: BilibiliPublicStatus;
  attemptId: string;
  expiresAt: number;
  qrPngDataUri: string;
  displayName?: string;
  avatarUrl?: string;
  retryable: boolean;
  nextAction: 'begin' | 'poll' | 'logout';
  errorCode?: string;
};

export type BilibiliPart = {
  cid: string;
  page: string;
  title: string;
  durationMs?: number;
};

export type BilibiliVideoDetail = {
  bvid: string;
  title: string;
  owner?: string;
  parts: BilibiliPart[];
};

export type BilibiliAudioRequest = { bvid: string; cid: string };
export type BilibiliAudioHandoff = BilibiliAudioRequest & {
  page: string;
  url: string;
  deadline: number;
  headers: Readonly<{ Referer: 'https://www.bilibili.com/' }>;
};

export type BilibiliMvQualityId =
  | 'auto'
  | '16'
  | '32'
  | '64'
  | '74'
  | '80'
  | '112'
  | '116'
  | '120'
  | '125'
  | '126'
  | '127';

/** Deliberately transport-free: a signed video URL cannot be represented in JS. */
export type BilibiliMvRequest = Readonly<{
  bvid: string;
  cid: string;
  qualityId?: BilibiliMvQualityId;
  preferredCodecs?: readonly ('avc1' | 'hev1' | 'hvc1' | 'av01')[];
  forceRefresh?: boolean;
}>;

export type BilibiliMvVariant = Readonly<{
  id: Exclude<BilibiliMvQualityId, 'auto'>;
  label: string;
  codec: 'avc1' | 'hev1' | 'hvc1' | 'av01';
  width: number;
  height: number;
}>;

export type BilibiliMvPublicState = Readonly<{
  state:
    | 'idle'
    | 'resolving'
    | 'ready'
    | 'playing'
    | 'paused'
    | 'refreshing'
    | 'error'
    | 'closed';
  handle?: string;
  bvid?: string;
  cid?: string;
  qualityId: BilibiliMvQualityId;
  variants: readonly BilibiliMvVariant[];
  positionMs: number;
  playIntent: boolean;
  refreshing: boolean;
  errorCode?: string;
}>;

export type BilibiliLyricCandidate = Readonly<{
  id: string;
  matchedProvider: 'netease' | 'qq';
  title: string;
  artist: string;
  album?: string;
  durationMs?: number;
  text: string;
  translation?: string;
  matchScore: number;
  hasTranslation: boolean;
}>;

export type BilibiliLyricCandidateResult = Readonly<{
  candidates: readonly BilibiliLyricCandidate[];
  partial: boolean;
  providerErrors: readonly Readonly<{
    provider: 'netease' | 'qq';
    stage: 'search' | 'lyric';
  }>[];
}>;
