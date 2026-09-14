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

export type BilibiliAudioRequest = { bvid: string; cid: string; page: string };
export type BilibiliAudioHandoff = BilibiliAudioRequest & {
  url: string;
  deadline: number;
  headers: Readonly<{ Referer: 'https://www.bilibili.com/' }>;
};
