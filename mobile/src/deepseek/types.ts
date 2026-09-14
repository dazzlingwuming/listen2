export type DeepSeekErrorCode =
  | 'CACHE_WRITE_FAILED'
  | 'CANCELLED'
  | 'CONFIGURE_UNAVAILABLE'
  | 'CONSENT_REQUIRED'
  | 'INVALID_ALIGNMENT'
  | 'INVALID_KEY'
  | 'INVALID_REQUEST'
  | 'INVALID_RESPONSE'
  | 'LYRIC_TOO_LARGE'
  | 'LYRIC_UNAVAILABLE'
  | 'MISSING_KEY'
  | 'NO_TIMED_LINES'
  | 'NOT_CACHED'
  | 'PROVIDER_ERROR'
  | 'RATE_LIMITED'
  | 'RESPONSE_TOO_LARGE'
  | 'SECURE_STORAGE_CORRUPT'
  | 'SECURE_STORAGE_UNAVAILABLE'
  | 'SERVICE_UNAVAILABLE'
  | 'STALE_IDENTITY'
  | 'TIMEOUT'
  | 'TOO_MANY_TIMED_LINES';

export interface DeepSeekConsent {
  readonly lyrics: boolean;
  readonly title: boolean;
  readonly artist: boolean;
  readonly possibleCost: boolean;
  readonly cancellation: boolean;
  readonly failureImpact: boolean;
  readonly acceptedAtEpochMs: number;
}

export interface DeepSeekStatus {
  readonly secureStorageAvailable: boolean;
  readonly hasApiKey: boolean;
  readonly errorCode?: DeepSeekErrorCode;
}

export interface DeepSeekConfigureStatus extends DeepSeekStatus {
  readonly status: 'configured' | 'cancelled';
}

export interface DeepSeekTranslateRequest {
  readonly operationId: string;
  readonly provider: 'netease' | 'qq';
  readonly sourceTrackId: string;
  readonly lyric: string;
  readonly title: string;
  readonly artist: string;
  readonly style: string;
  readonly lyricHash: string;
  readonly trackHash: string;
  readonly target: 'zh-CN';
  readonly consent: DeepSeekConsent;
  readonly allowNetwork: boolean;
  readonly forceRefresh: boolean;
}

export interface DeepSeekTranslateResult {
  readonly status: 'ok' | 'not-cached' | 'error' | 'cancelled';
  readonly errorCode?: DeepSeekErrorCode;
  readonly translation?: string;
  readonly lyricHash?: string;
  readonly trackHash?: string;
  readonly cacheHit: boolean;
}

export interface DeepSeekTestResult {
  readonly status: 'ok' | 'error' | 'cancelled';
  readonly errorCode?: DeepSeekErrorCode;
}
